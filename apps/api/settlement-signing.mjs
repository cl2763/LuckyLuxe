/** Shared signing ledger; person documents can commit multiple service components atomically. */
export function createSettlementSigner({db,storedValueBalanceDetail,apiError,iso,todayOf,randomId,insertFinanceTransaction,timecardExpired,timecardRemainingOf,insertStoredValueTransaction,logCouponGrant,formatMoneyCents,settleDepositReceiptsOnSign,renderSettlementSnapshotSvg,serializeSettlement,cosPutObject,settlementRead}) {
function signLedger(row, { signature, signedBy = '', strokes = [], withinTransaction = false, finalizeDeposit = true, couponLogDiscountCents = null }) {
  const tenantId = row.tenant_id
  const legs = db.prepare("SELECT * FROM settlement_payments WHERE settlement_id = ? AND leg IN ('stored_value','migrate_stored') ORDER BY rowid ASC").all(row.id)
  const needStored = legs.reduce((sum, l) => sum + l.amount_cents, 0)
  const balance = storedValueBalanceDetail(row.user_id, tenantId)
  /* B3-1 随单充值:签字时刻「充+赠」先入账再烧储值,余额校验按充后口径 */
  const scRecharge = row.recharge_json ? (() => { try { return JSON.parse(row.recharge_json) } catch { return null } })() : null
  const pendingRecharge = scRecharge ? Math.max(0, (scRecharge.amountCents || 0) + (scRecharge.bonusCents || 0)) : 0
  if (needStored > balance.totalCents + pendingRecharge) {
    throw apiError(400, 'INSUFFICIENT_BALANCE',
      `储值余额不足(需 ${needStored / 100},现有 ${(balance.totalCents + pendingRecharge) / 100}${pendingRecharge ? '(含本单随签充值)' : ''}),请回到结算页改支付构成。`)
  }
  /* 规则⑤ 核销留痕:**签字成功那一刻**券才核销。签字前退出/改单,券一直是 active,
     自然就回到券包里了 —— 不需要"释放"动作,也就不存在忘记释放这回事。
     签的这一刻再校验一次:过期了或在别处核销了就拦下,不让顾客签一个抵不了的数。 */
  let couponGrant = null
  if (row.coupon_grant_id) {
    couponGrant = db.prepare('SELECT * FROM coupon_grants WHERE id = ? AND tenant_id = ?').get(row.coupon_grant_id, tenantId)
    if (!couponGrant || couponGrant.status !== 'active') {
      throw apiError(400, 'COUPON_UNUSABLE', '所选优惠券已不可用(过期或已在别处核销),请回到服务单重新选券。')
    }
    if (couponGrant.expires_at && String(couponGrant.expires_at) < iso(new Date())) {
      throw apiError(400, 'COUPON_UNUSABLE', '所选优惠券已过期,请回到服务单重新选券。')
    }
  }
  if(withinTransaction) {
    const legacy=legs.filter(l=>l.leg==='migrate_stored').reduce((n,l)=>n+l.amount_cents,0)
    const normal=legs.filter(l=>l.leg==='stored_value').reduce((n,l)=>n+l.amount_cents,0)
    if(legacy>balance.legacyCents||normal>balance.normalCents+pendingRecharge)throw apiError(409,'BALANCE_ALLOCATION_CHANGED','账户余额构成已变化，请重新核对支付方式。')
  }
  let rechargeTxnId=null,bonusTxnId=null
  const now = iso(new Date())
  db.exec(withinTransaction ? 'SAVEPOINT signed_component' : 'BEGIN IMMEDIATE')
  try {
    /* 预嘱②(幂等第二道闸):路由层 ALREADY_SIGNED 挡串行双击;这里在 BEGIN IMMEDIATE 串行化后
       复读状态,挡并发双签——两道闸分立,双击/重试永远只扣一次(储值与次卡同受保护)。 */
    const freshStatus = db.prepare('SELECT status FROM settlements WHERE id = ?').get(row.id)
    if (!freshStatus || freshStatus.status !== 'pending_sign') {
      throw apiError(400, 'ALREADY_SIGNED', '这张单已经签过了。')
    }
    /* B3 现场购卡:签字时刻按快照建卡(当场核销第 1 次=used_times 直落 1;新卡无并发面)。
       购卡价=预收负债(卡行本身即负债记录,与充值同构不写收入行);核销第 1 次照常确认收入。 */
    if (row.purchase_json) {
      const pur = JSON.parse(row.purchase_json)
      const exp = pur.validDays
        ? (() => { const d = new Date(`${todayOf(tenantId)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(pur.validDays)); return d.toISOString().slice(0, 10) })()
        : null
      db.prepare(`INSERT INTO member_timecards (id, tenant_id, user_id, package_id, name, total_times, used_times, price_cents, project_group, expires_at, source_settlement_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
        .run(randomId('tcard'), tenantId, row.user_id, pur.packageId, pur.name, pur.timesCount, pur.priceCents, pur.projectGroup || null, exp, row.id, now)
      const purLeg = db.prepare("SELECT * FROM settlement_payments WHERE settlement_id = ? AND leg = 'times_card'").get(row.id)
      if (purLeg) {
        db.prepare("UPDATE settlement_payments SET status = 'paid' WHERE id = ?").run(purLeg.id)
        insertFinanceTransaction({
          type: 'income', source: 'settlement', category: '服务收入-次卡核销', tags: row.code,
          amountCents: purLeg.amount_cents, payChannel: 'times_card', occurredOn: todayOf(tenantId),
          note: `服务单 ${row.code} · ${purLeg.note || '现场购卡核销'}`, createdBy: signedBy || 'customer_sign', tenantId
        })
      }
    }
    /* B② 次卡扣次:签字时刻乐观锁(Cowork 预嘱并发形)——WHERE used_times = nth-1,
       被别的单抢先用掉即 changes=0 → 409,单据不作废,改支付构成可再签(预嘱① 出路)。 */
    if (row.timecard_id) {
      const card = db.prepare('SELECT * FROM member_timecards WHERE id = ? AND tenant_id = ?').get(row.timecard_id, tenantId)
      if (!card) throw apiError(400, 'TIMECARD_UNUSABLE', '这张次卡已不存在——请回到服务单改支付构成再签(单据不作废)。')
      const migratedService = db.prepare("SELECT kind,review_json FROM migration_asset_activations WHERE id=? AND tenant_id=? AND kind IN ('service','paid_service')").get(card.id,tenantId)
      if(migratedService){
        const item=db.prepare("SELECT service_id FROM settlement_items WHERE settlement_id=? AND kind='timecard'").get(row.id)
        if(!item || item.service_id!==JSON.parse(migratedService.review_json).serviceId) throw apiError(409,'TIMECARD_SERVICE_NOT_ALLOWED','赠卡对应服务不一致，请重新核对结算单。')
      }
      if (timecardExpired(card)) throw apiError(400, 'TIMECARD_EXPIRED', '这张次卡已过期——请回到服务单改支付构成再签(单据不作废)。')
      // Draft validation is not enough: remaining rights can be refunded before signing.
      if (card.user_id !== row.user_id) throw apiError(409, 'TIMECARD_NOT_OWNER', '次卡归属已变化，请重新核对本单顾客。')
      // A draft records the expected use number. A later consumption invalidates it,
      // even if that consumption also exhausts the card; refunds alone retain USED_UP.
      if (card.used_times !== Number(row.timecard_nth) - 1) throw apiError(409, 'TIMECARD_RACE', '次卡在开单后已有新的核销，请返回服务单重新核对支付方式。')
      if (timecardRemainingOf(card) <= 0) throw apiError(409, 'TIMECARD_USED_UP', '这张次卡的剩余次数已用完或已退，请返回服务单重新选择支付方式。')
      const deduct = db.prepare('UPDATE member_timecards SET used_times = used_times + 1 WHERE id = ? AND tenant_id = ? AND user_id = ? AND used_times = ? AND total_times - used_times - COALESCE(refunded_times, 0) > 0')
        .run(row.timecard_id, tenantId, row.user_id, Number(row.timecard_nth) - 1)
      if (!deduct.changes) {
        throw apiError(409, 'TIMECARD_RACE', '这张次卡的剩余次数刚被另一张单用掉——请回到服务单改支付构成再签(单据不作废)。')
      }
      const tcLeg = db.prepare("SELECT * FROM settlement_payments WHERE settlement_id = ? AND leg = 'times_card'").get(row.id)
      if (tcLeg) {
        db.prepare("UPDATE settlement_payments SET status = 'paid' WHERE id = ?").run(tcLeg.id)
        // 规则⑦:核销=按折算单价确认收入(负债转收入),单列类目供日结;payChannel=times_card 不混现金实收。
        // tenantId 必传:签署页=公开路由没进租户闸门,不传会记到旗舰店账上(insertFinanceTransaction 注释点名的坑,套件 ㊻ 咬过一次)
        if (!migratedService || migratedService.kind==='paid_service') insertFinanceTransaction({
          type: 'income', source: 'settlement', category: '服务收入-次卡核销', tags: row.code,
          amountCents: tcLeg.amount_cents, payChannel: 'times_card', occurredOn: todayOf(tenantId),
          note: `服务单 ${row.code} · ${tcLeg.note || '次卡核销'}`, createdBy: signedBy || 'customer_sign', tenantId
        })
      }
    }
    /* B3-1 随单充值(挂单随签):签字这一刻充值行才入账——顺序在烧储值之前,
       「充完即抵本单」的钱先到再烧,余额永不瞬时为负。与单独代充同构:
       充=预收负债不写收入行(规则④),赠=bonus 行营销让利(永不计实收/业绩/提成/积分);
       tenantId 必传(D53:签署页=公开路由,不传记到旗舰店账上)。 */
    if (scRecharge && scRecharge.amountCents > 0) {
      const rechargeTxn=insertStoredValueTransaction({
        userId: row.user_id, type: 'recharge', amountCents: scRecharge.amountCents, giftItems:scRecharge.giftItems||[],
        payChannel: scRecharge.payChannel || 'cash',
        note: `随单充值 · 服务单 ${row.code}${scRecharge.packageName ? ' · ' + scRecharge.packageName : ''}`,
        createdBy: signedBy || 'customer_sign', technicianId: scRecharge.technicianId || null, tenantId, createdAt: now,
        customerConfirmedAt: now // 随单充值=顾客亲签,入账即确认(B3-3 回执确认只针对单独代充)
      })
      rechargeTxnId=rechargeTxn.id
      if (scRecharge.bonusCents > 0) {
        const bonusTxn=insertStoredValueTransaction({
          userId: row.user_id, type: 'bonus', amountCents: scRecharge.bonusCents,
          payChannel: 'marketing',
          note: `充值赠送(营销让利) · 服务单 ${row.code}`,
          createdBy: signedBy || 'customer_sign', technicianId: scRecharge.technicianId || null, tenantId, createdAt: now
        })
        bonusTxnId=bonusTxn.id
      }
    }
    for (const leg of legs) {
      if (leg.amount_cents <= 0) continue
      db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bucket)
        VALUES (?, ?, ?, 'consume', ?, 'stored_value', ?, ?, ?, ?)`)
        .run(randomId('sv'), tenantId, row.user_id, -Math.abs(leg.amount_cents),
          `服务单 ${row.code} 结算扣卡`, signedBy || row.user_id, now, leg.leg === 'migrate_stored' ? 'legacy' : 'normal')
      db.prepare("UPDATE settlement_payments SET status = 'paid' WHERE id = ?").run(leg.id)
      // 迁移桶是老店欠顾客的服务,不是本店收入 —— 只有新桶进财务
      if (leg.leg === 'stored_value') {
        /* D53(B② 施工中扫出的同病):此处原漏传 tenantId——签署页是公开路由,不传=耗卡收入记到旗舰店账上。
           潜伏未炸:生产至今 0 签署单;套件此前未覆盖「非旗舰租户签储值单查本租户账」位面(㊻ 已补)。 */
        insertFinanceTransaction({
          type: 'income', source: 'settlement', category: '服务收入-耗卡', tags: row.code,
          amountCents: leg.amount_cents, payChannel: 'stored_value', occurredOn: todayOf(tenantId),
          note: `服务单 ${row.code}`, createdBy: signedBy || 'customer_sign', tenantId
        })
      }
    }
    db.prepare("UPDATE settlement_payments SET status = 'awaiting' WHERE settlement_id = ? AND leg = 'offline' AND status = 'pending'").run(row.id)
    /* B3-1:充后余额在签字这一刻冻结进快照列——余额是活的,快照上的「充后余额」必须是签字瞬间那个数,
       事后重渲染不许再算(同笔迹一个道理)。 */
    if (scRecharge) {
      const frozen = storedValueBalanceDetail(row.user_id, tenantId).totalCents
      db.prepare('UPDATE settlements SET recharge_json = ? WHERE id = ?')
        .run(JSON.stringify({ ...scRecharge, afterBalanceCents: frozen }), row.id)
    }
    if (couponGrant) {
      db.prepare("UPDATE coupon_grants SET status = 'used', used_at = ?, settlement_id = ?, settlement_code = ? WHERE id = ? AND status = 'active'")
        .run(now, row.id, row.code, couponGrant.id)
      logCouponGrant({
        tenantId, grantId: couponGrant.id, action: 'redeemed', settlementCode: row.code,
        detail: `签署核销,抵扣 ${formatMoneyCents(couponLogDiscountCents??row.coupon_discount_cents, tenantId, 'auto')}`, actor: signedBy || 'customer_sign'
      })
    }
    db.prepare("UPDATE settlements SET status = 'signed', signature_data = ?, signed_at = ?, disclaimer_accepted = 1, updated_at = ? WHERE id = ?")
      .run(String(signature).slice(0, 200), now, now, row.id)
    // 结算 → 订单:签署驱动 COMPLETED(合同②「单据自动为已签署/已完成」)
    if (row.booking_id) {
      db.prepare("UPDATE bookings SET status = 'COMPLETED', updated_at = ? WHERE id = ? AND status IN ('PENDING_PAYMENT','CONFIRMED')").run(now, row.booking_id)
    }
    /* 🔴 合同②(店主 08-24 拍 A 案):**入账唯一路径 = 签署**,全额到店单同样;按钮入账路径退役。
       定金腿与储值腿在下面各自转收入;这里补的是**到店现金腿**——它原来签署时不记账本,
       靠「已完成」按钮按**预约标价**记(所以才有 D70 那个重复入账的口子)。
       口径含义(必须说清):签署即确认收入 = 现金还没实际收到也算当期收入(权责发生制);
       金额按**结算单的到店应收**(offline 腿合计),不是预约标价 —— 与 D65 头条「本单到店支付」同源。
       幂等:同一单已有未冲销的 booking/settlement 收入就不再记(与 recordBookingIncome 同一把闸)。 */
    /* ⚠️ offline 腿里**混着三种钱**:服务现金 + 购卡现金 + 随单充值现金
       (computeSettlement:totalCents = 服务小计 − 定金抵扣 − 券 + 购卡 + 充值,三者一起分腿)。
       只有服务那部分是**收入**:充值是负债(耗卡时才转收入)、购卡也是预收 —— 这是店主的账本红线。
       第一版我记了整条腿,套件 ㋀ 当场咬出来:一张随单充值单同时冒出「服务收入-到店 300」和「耗卡 301」。 */
    const rechargeCash = (() => { try { const r = JSON.parse(row.recharge_json || 'null'); return Math.max(0, Math.round(r?.amountCents || 0)) } catch { return 0 } })()
    const purchaseCash = (() => { try { const p2 = JSON.parse(row.purchase_json || 'null'); return Math.max(0, Math.round(p2?.priceCents || 0)) } catch { return 0 } })()
    const offlineRaw = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM settlement_payments WHERE settlement_id = ? AND leg = 'offline'").get(row.id).n
    const offlineDue = Math.max(0, offlineRaw - rechargeCash - purchaseCash)
    if (offlineDue > 0) {
      const dup = db.prepare(`
        SELECT 1 FROM finance_transactions t
        WHERE t.booking_id IS ? AND t.tags = ? AND t.type = 'income' AND t.source = 'settlement'
          AND NOT EXISTS (SELECT 1 FROM finance_transactions r WHERE r.reversal_of = t.id)
        LIMIT 1
      `).get(row.booking_id || null, row.code)
      if (!dup) {
        insertFinanceTransaction({
          tenantId, type: 'income', source: 'settlement', tags: row.code,
          category: '服务收入-到店', amountCents: offlineDue, payChannel: 'offline',
          occurredOn: todayOf(tenantId), bookingId: row.booking_id || null,
          note: `服务单 ${row.code} 签署入账(到店应收)`, createdBy: signedBy || 'customer_sign'
        })
      }
    }
    /* 定金兑现(拍板 A · §五):抵扣开的店定金已经在 computeSettlement 里抵掉应收了,
       这里只把记录标成已兑现;抵扣关的店在这一刻把定金转成当期「定金收入」。
       两种都不进业绩 —— 分成基数恒等于档位小计,与定金无关。 */
    if(finalizeDeposit)settleDepositReceiptsOnSign(row, signedBy || 'customer_sign')
    // 组内全部签完,组才算完成
    const unsigned = db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE group_id = ? AND status <> 'signed'").get(row.group_id).n
    db.prepare('UPDATE settlement_groups SET status = ?, updated_at = ? WHERE id = ?').run(unsigned === 0 ? 'signed' : 'pending_sign', now, row.group_id)
    db.exec(withinTransaction ? 'RELEASE signed_component' : 'COMMIT')
  } catch (error) {
    db.exec(withinTransaction ? 'ROLLBACK TO signed_component; RELEASE signed_component' : 'ROLLBACK')
    throw error
  }
  return { now, needStored, rechargeTxnId, bonusTxnId }
}
async function signSettlement(row, { signature, signedBy = '', strokes = [] }) {
  const tenantId = row.tenant_id
  const {now,needStored}=signLedger(row,{signature,signedBy,strokes})
  // 快照:签完立刻把整张单连同笔迹渲染成 SVG。这是唯一签署凭证 ——
  // 结算数据随时可重渲染,笔迹只在签的这一瞬间存在,过后补不了,所以必须在这里生成。
  const signedRow = db.prepare('SELECT * FROM settlements WHERE id = ?').get(row.id)
  const snapshotSvg = renderSettlementSnapshotSvg(serializeSettlement(signedRow, { includeSignature: true }), { strokes, signedAt: now })
  const objectKey = `settlements/${tenantId}/${signedRow.code}.svg`
  const url = await cosPutObject(objectKey, snapshotSvg, 'image/svg+xml')
  // COS 没配 / 上传失败 → inline 入库标 storage=inline,后续可迁移,绝不因存储故障拦签署
  db.prepare('UPDATE settlements SET snapshot_url = ?, snapshot_inline = ?, snapshot_storage = ?, snapshot_at = ? WHERE id = ?')
    .run(url || null, url ? null : snapshotSvg, url ? 'cos' : 'inline', now, row.id)

  const fresh = db.prepare('SELECT * FROM settlements WHERE id = ?').get(row.id)
  return {
    settlement: serializeSettlement(fresh),
    snapshot: { storage: fresh.snapshot_storage, url: settlementRead.url(fresh.code), at: fresh.snapshot_at, bytes: snapshotSvg.length },
    storedDeductedCents: needStored,
    groupAllSigned: db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE group_id = ? AND status <> 'signed'").get(row.group_id).n === 0
  }
}

return {signLedger,signSettlement}
}
