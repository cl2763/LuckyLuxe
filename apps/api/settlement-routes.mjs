/* 开单与预览路由(preview / 建单 / 列表 / preview-card)—— 2026-08-29 批次三从 local-server.mjs 搬出,**只搬不改**。

   为什么这一刀:网页开单(上线前必办)落地时 local-server 又要涨,《棘轮律》只许降不许升;
   而且这三条正是「结算开单」域的路由层,与 refund-routes / store-content-routes 同一个道理:
   路由赖在一万八千行里就是「改一处漏一处」的土壤。
   门禁扫描器(test-auth-surface)扫 local-server + 全部 *-routes.mjs,本文件天生在扫描面里。 */
export function createSettlementRoutes({ apiError, json, readBody, db, currentTenantId, computeSettlement, createSettlementGroup, serializeSettlement, isUserBound, storedValueBalanceDetail, tenantTimezone, localParts, formatMoneyCents, groupMainItemCount, assertStaff }) {
  async function route(req, res, ctx) {
    const { path, query, adminSession } = ctx
  if (req.method === 'POST' && path === '/admin/settlements/preview') {
    // 技师端表单实时试算:不落库,金额口径与正式开单完全一致
    const body = await readBody(req)
    /* 分组完整版(图 v2.2):settlements 数组 = 组级预览。
       每组各走一遍 computeSettlement(引擎不动),组级合计与支付分解**全部在这里加总**——
       前端零运算的红线靠这个口子兑现;储值抵扣按整单合计一次算(单级支付菜单)。 */
    if (Array.isArray(body.settlements) && body.settlements.length) {
      const tenantId = currentTenantId()
      const payerId = String(body.payerUserId || body.userId || body.cardOwnerUserId || '').trim() || null
      /* D60(店主 08-22 抓出:组级预览 868 vs 落库腿 1228 分叉):组级支付分解不再独立重算——
         **组级=Σ各 sheet 腿**(与 createSettlementGroup 完全同口径:同一循环、同一顺序、同一余额线程),
         预览承诺的每一分钱就是建单落库、签字兑现的那一分钱。单一事实源=sheet 级引擎。 */
      let plannedStoredInGroup = 0
      let pendingAvailInGroup = 0   // D64:组内挂充未用余量前向传递(与建单同一循环口径)
      const sheets = body.settlements.map((sheet) => {
        const computed = computeSettlement({
          ...sheet, tenantId,
          userId: payerId || sheet.userId, payerUserId: payerId || sheet.payerUserId,
          bookingId: sheet.bookingId,
          payIntent: sheet.payIntent || body.payIntent,
          plannedStoredCents: plannedStoredInGroup,
          pendingRechargeAvailableCents: pendingAvailInGroup
        })
        plannedStoredInGroup += (computed.payment && computed.payment.sharedStoredUsedCents) || 0
        pendingAvailInGroup = (computed.payment && computed.payment.pendingRechargeUnusedCents) || 0
        return computed
      })
      const sum = (k) => sheets.reduce((n, x) => n + (x[k] || 0), 0)
      const paySum = (k) => sheets.reduce((n, x) => n + ((x.payment && x.payment[k]) || 0), 0)
      const totalCents = sum('totalCents')
      const timecardCoverCents = sheets.reduce((n, x) => n + ((x.timecard && x.timecard.coverCents) || 0), 0)
      const rechargeCents = sheets.reduce((n, x) => n + (x.rechargeCents || 0), 0)
      const pendingRechargeCents = paySum('pendingRechargeCents')
      const storedUsedCents = paySum('storedUsedCents')
      const offlineDueCents = paySum('offlineCents')
      // 起始共享余额(未被组内任何单占用前)——payer 的真实现余额
      const balance0 = payerId ? storedValueBalanceDetail(payerId, tenantId) : { totalCents: 0, legacyCents: 0, normalCents: 0 }
      // D60 自证:现场购卡组级合计(「购卡款不许隐身进应收」——前端显式行数据源)
      const purchaseSum = sheets.reduce((n, x) => n + (x.purchaseCents || 0), 0)
      json(res, 200, {
        sheets,
        group: {
          listTotalCents: sum('listTotalCents'),
          subtotalCents: sum('subtotalCents'),
          discountTotalCents: sum('discountTotalCents'),
          couponDiscountCents: sum('couponDiscountCents'),
          depositDeductCents: sum('depositDeductCents'),
          depositReceiptCents: sum('depositReceiptCents'),
          totalCents,
          payment: {
            plan: ['balance_plus_offline', 'recharge_then_balance', 'offline_full'].includes(body.payIntent) ? body.payIntent : 'balance_plus_offline',
            // 组级腿=各 sheet 腿原样拼接(带组内序号),不再另算一套
            legs: sheets.flatMap((x, i) => (x.payment.legs || []).map((l) => ({ ...l, sheetIndex: i }))),
            balanceAvailableCents: balance0.totalCents,
            storedUsedCents,
            offlineDueCents,
            // B②:组级次卡抵扣合计(前端自证行「次卡抵扣 −X」;0=无核销组,前端不渲染)
            timecardCoverCents,
            // B3-1:组级随单充值三行分行数字(实收/充后余额);0=无充值,前端不渲染
            rechargeCents,
            pendingRechargeCents,
            // D60:购卡款组级合计(显式行「现场购卡 +X(购卡款,预收)」数据源)
            purchaseCents: purchaseSum,
            afterRechargeBalanceCents: rechargeCents ? balance0.totalCents + pendingRechargeCents - storedUsedCents : null,
            shortfallCents: Math.max(0, (totalCents - timecardCoverCents) - balance0.totalCents - pendingRechargeCents)
          }
        }
      })
      return true
    }
    json(res, 200, { settlement: computeSettlement({ ...body, tenantId: currentTenantId() }) })
    return true
  }
  if (req.method === 'POST' && path === '/admin/settlements') {
    if (adminSession.role !== 'owner' && adminSession.role !== 'staff') throw apiError(403, 'FORBIDDEN', '需要员工或老板权限。')
    const body = await readBody(req)
    /* D121:开单口把演示批次名带进去 —— 即时单内部会自建一条预约,
       那条预约是造景最常走的路(seed-bigdemo 的订单流就走这里),漏了它整批就认不出来。
       用 `__demoSeed` 这个内部字段传:createSettlementGroup 拿不到 req。 */
    body.__demoSeed = String(req.headers['x-demo-seed'] || '').trim() || null
    json(res, 201, createSettlementGroup(body, adminSession))
    return true
  }
  if (req.method === 'GET' && path === '/admin/settlements') {
    const tid = currentTenantId()
    const rows = query.groupId
      ? db.prepare('SELECT * FROM settlements WHERE tenant_id = ? AND group_id = ? ORDER BY rowid ASC').all(tid, query.groupId)
      : (query.bookingId
        ? db.prepare('SELECT * FROM settlements WHERE tenant_id = ? AND booking_id = ? ORDER BY rowid DESC').all(tid, query.bookingId)
        : db.prepare('SELECT * FROM settlements WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 60').all(tid))
    /* D9 规则⑤:前端要按「归属顾客是否已绑微信」决定签署路(未绑定只有扫码一条路),
       绑定状态随单下发 —— 不让前端自己再查一遍档案。 */
    json(res, 200, { settlements: rows.map((r) => ({ ...serializeSettlement(r), customerBound: isUserBound(r.user_id) })) })
    return true
  }
  if (req.method === 'GET' && path.startsWith('/admin/settlements/') && path.endsWith('/preview-card')) {
    const id = decodeURIComponent(path.split('/')[3] || '')
    const one = db.prepare('SELECT * FROM settlements WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
      || db.prepare('SELECT * FROM settlements WHERE code = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!one) throw apiError(404, 'NOT_FOUND', '找不到这张结算单。')
    assertStaff(adminSession, one)
    let rows = one.group_id
      ? db.prepare("SELECT * FROM settlements WHERE tenant_id = ? AND group_id = ? AND status <> 'voided' ORDER BY rowid ASC").all(currentTenantId(), one.group_id)
      : (one.status === 'voided' ? [] : [one])
    if (!rows.length) throw apiError(410, 'SHEET_VOIDED', '这张结算单已撤回,没有可预览的单据。')
    const marks = ['①', '②', '③', '④', '⑤']
    const user = one.user_id ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(one.user_id) : null
    const tz = tenantTimezone(one.tenant_id)
    const stamp = (at) => { if (!at) return ''; const p = localParts(new Date(at), tz); return `${p.date} ${p.time.slice(0, 5)}` }
    const groups = rows.map((r, i) => {
      const techs = db.prepare('SELECT t.name FROM settlement_technicians st JOIN technicians t ON t.id = st.technician_id WHERE st.settlement_id = ? ORDER BY st.rowid ASC').all(r.id).map((x) => x.name)
      const lines = db.prepare('SELECT * FROM settlement_items WHERE settlement_id = ? ORDER BY item_no ASC').all(r.id)
        .filter((l) => l.kind !== 'rule')
        .map((l) => ({
          no: l.item_no, name: l.name_snapshot, qty: l.qty,
          amountCents: l.amount_cents, listAmountCents: l.list_amount_cents,
          strike: l.list_amount_cents !== l.amount_cents, isFree: Boolean(l.is_free)
        }))
      return {
        title: `项目${marks[i] || i + 1} ${lines[0] ? lines[0].name : ''}${techs.length ? ' · ' + techs.join('/') : ''}${r.served_person_name ? ' · 被服务者:' + r.served_person_name : ''}`,
        tierKey: r.price_tier_used, lines
      }
    })
    const sum = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0)
    const allSigned = rows.every((r) => r.status === 'signed' || r.status === 'amended')
    /* 储值抵扣行:已签单的扣卡在留痕账本里(结算扣卡),按组内各单号合出来;
       待签单按计划腿(与预览/建单同源)——资金时序审计(08-22)后组卡三行全走腿。 */
    const codes = rows.map((r) => r.code)
    let storedCents = 0
    for (const c of codes) {
      const row = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) s FROM stored_value_transactions WHERE tenant_id = ? AND type = 'consume' AND note = ?").get(one.tenant_id, `服务单 ${c} 结算扣卡`)
      storedCents += Math.abs(row.s || 0)
    }
    /* 全组合审计(店主 08-22 五步总纲)抓出:原 dueCents=Σtotal−已烧储值,**漏减次卡腿与待签储值计划腿**
       (纯核销组卡显 180 应 0;店主组合显 1408 应 868=矩阵 35/40 红全在此位面)。
       修=应收唯一事实源=**线下腿 Σ**(五步⑤:现金收差额),与开单预览/建单腿同一条数。 */
    const legAgg = db.prepare(`SELECT p.leg, COALESCE(SUM(p.amount_cents),0) AS n FROM settlement_payments p
      WHERE p.settlement_id IN (${rows.map(() => '?').join(',')}) GROUP BY p.leg`).all(...rows.map((r) => r.id))
    const legOf = (k) => (legAgg.find((x) => x.leg === k) || {}).n || 0
    const offlineDueCents = legOf('offline')
    const plannedStoredCents = legOf('stored_value') + legOf('migrate_stored')
    /* D60(店主 08-22 抓出「P1RA 弹窗 1408」):这张卡是**整组**单据卡,「到店应收」是组合计——
       但界面从单行点进来时没说这是组卡,388 的单看到 1408 无从自证。修:①组卡明示(共 N 张+逐张状态行);
       ②购卡款/充值实收显式行(不许隐身进应收);③应收行改名「组合计应收」并逐张可对。 */
    const purchaseSumCents = rows.reduce((n, r) => { try { return n + ((JSON.parse(r.purchase_json || 'null') || {}).priceCents || 0) } catch { return n } }, 0)
    const rechargeSumCents = rows.reduce((n, r) => { try { return n + ((JSON.parse(r.recharge_json || 'null') || {}).amountCents || 0) } catch { return n } }, 0)
    /* D63:组内有待签单没用储值、而该客有余额 → 组卡显式句(定稿句,不许静默) */
    const pendingNoStored = rows.some((r) => r.status === 'pending_sign'
      && !db.prepare("SELECT 1 FROM settlement_payments WHERE settlement_id = ? AND leg IN ('stored_value','migrate_stored') AND amount_cents > 0 LIMIT 1").get(r.id))
    const custBalCents = pendingNoStored ? storedValueBalanceDetail(one.user_id, one.tenant_id).totalCents : 0
    const storedUnusedNotice = pendingNoStored && custBalCents > 0
      ? `该客有储值余额 ${formatMoneyCents(custBalCents, one.tenant_id, 'auto')},本单未使用`
      : ''
    json(res, 200, {
      card: {
        settlementId: one.id,
        code: one.code,
        operatorText: one.created_by || '历史未记录',
        codes,
        statusKey: allSigned ? 'signed' : 'pending',
        statusText: allSigned ? '已签署' : '已结算 · 待签',
        // 组卡自证:共几张+逐张(单号/金额/签署态)——「到店应收」是这几张的合计,不是点进来那一张的
        groupNote: rows.length > 1 ? `本次到店共 ${rows.length} 份服务确认单` : '',
        storedUnusedNotice,
        /* D65-b(店主拍板):逐张行金额=该张头条「本单到店支付」(五步⑤现金)——
           Σ逐张行=组头条,肉眼可加;价值总额不再以裸数字出现。 */
        sheetRows: rows.length > 1 ? rows.map((r) => ({
          code: r.code,
          operatorText: r.created_by || '历史未记录',
          cashDueCents: db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM settlement_payments WHERE settlement_id = ? AND leg = 'offline'").get(r.id).n,
          statusText: r.status === 'signed' || r.status === 'amended' ? '已签' : '待签'
        })) : [],
        customerName: (user && user.display_name) || '顾客',
        createdAt: stamp(one.created_at),
        groups,
        totals: {
          listTotalCents: sum('list_total_cents'),
          subtotalCents: sum('subtotal_cents'),
          discountTotalCents: sum('discount_total_cents') + sum('coupon_discount_cents'),
          couponDiscountCents: sum('coupon_discount_cents'),
          depositDeductCents: sum('deposit_deduct_cents'),
          // D60 自证行:购卡款/充值实收显式(0=不渲染);应收=Σ线下腿(五步⑤,与预览/建单同源)
          purchaseCents: purchaseSumCents,
          rechargeCents: rechargeSumCents,
          // 储值抵扣行=已烧(已签)+计划(待签)——组卡上储值行与应收行加总可自证 Σtotal
          storedDeductCents: storedCents + (allSigned ? 0 : plannedStoredCents),
          timecardCoverCents: legOf('times_card'),
          dueCents: offlineDueCents,
          // D4(08-22 裁)→D68 文案(08-23 拍):汇总行=「到店服务项目(N)」,N=主项目数(非张数);金额不变
          dueLabel: rows.length > 1 ? `到店服务项目(${groupMainItemCount(one.group_id, one.tenant_id)})` : '本单到店支付'
        },
        signature: allSigned ? { name: (user && user.display_name) || '', signedAt: stamp(rows[0].signed_at), hasImage: rows.some((r) => r.snapshot_url || r.snapshot_inline || r.signature_data) } : null
      }
    })
    return true
  }
  /* 屏 0:「结算单已推送待签」状态下可**撤回改单**。
     只撤未签的;已签一律不可撤(账本只追加、已签不可改),要改走金额更正链。
     撤回时把挂在这张单上的券一并放开,不然那张券会被一张作废单永远占着。 */
    return false
  }
  return { route }
}
