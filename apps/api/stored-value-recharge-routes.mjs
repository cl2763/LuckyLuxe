export function createStoredValueRechargeRoutes({db,apiError,readBody,json,currentTenantId,isUserBound,DATA_SCOPE_NAME,giftSnapshotOfPackage,actorOf,insertStoredValueTransaction,storedValueOverview,storedValueBalanceCents,pricingTransactions}) {
  const readInput=async req=>{const value=await readBody(req);if(!value||typeof value!=='object'||Array.isArray(value))throw apiError(400,'BAD_REQUEST','请求内容须为对象。');return value}
  return async function(req,res,{path,adminSession}) {
  if (req.method === 'POST' && path === '/admin/stored-value/recharge') {
    if (adminSession.role !== 'owner' && adminSession.role !== 'staff') {
      throw apiError(403, 'FORBIDDEN', '需要老板或员工权限。')
    }
    const body = await readInput(req)
    const userId = String(body.userId || '').trim()
    const user = db.prepare('SELECT id, display_name FROM users WHERE id = ? AND tenant_id = ?').get(userId, currentTenantId())
    if (!user) throw apiError(404, 'NOT_FOUND', 'Member not found.')
    /* D25(《财务总逻辑》3-1b,店主 2026-08-12 拍板):未绑定微信的轻档案不可充值 ——
       防"空充值"挂在无主档案上;技师/老板同受约束,两端入口的禁用态只是体验,这里才是闸。 */
    if (!isUserBound(userId) && !((DATA_SCOPE_NAME === 'sandbox' || DATA_SCOPE_NAME === 'ci') && db.prepare('SELECT kind FROM tenants WHERE id = ?').get(currentTenantId())?.kind === 'demo' && /^demo-openid-[a-z0-9-]+$/i.test(String(db.prepare('SELECT wechat_open_id FROM users WHERE id = ?').get(userId)?.wechat_open_id || '')) && body.note === '演示储值')) {
      throw apiError(400, 'UNBOUND_NO_RECHARGE', '请先让顾客扫码绑定(会员码/签署码)再充值。')
    }
    const selectedPackage=body.packageId?db.prepare("SELECT * FROM membership_packages WHERE id=? AND tenant_id=? AND kind='recharge' AND is_active=1").get(String(body.packageId),currentTenantId()):null
    if(body.packageId&&!selectedPackage)throw apiError(404,'PACKAGE_NOT_FOUND','充值套餐不存在或已下架。')
    const giftItems=giftSnapshotOfPackage(selectedPackage)
    const amountCents = selectedPackage ? selectedPackage.price_cents : Number(body.amountCents ?? Number(body.amount || 0) * 100)
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100000000) throw apiError(400, 'BAD_REQUEST', '充值金额须大于 0，最多两位小数，且不超过 100 万。')

    // 经手技师:这笔充值/耗卡算谁促成,薪资的充值/耗卡提成据此计算。
    // 技师会话:经手人**强制=当前技师**(留痕口径,不认 body 传谁)
    const svTech = adminSession.role === 'staff'
      ? String(adminSession.technicianId || '')
      : String(body.technicianId || '').trim()
    if (svTech && !db.prepare('SELECT 1 FROM technicians WHERE id = ? AND tenant_id = ?').get(svTech, currentTenantId())) {
      throw apiError(404, 'NOT_FOUND', '经手技师不存在。')
    }
    /* S2批①(规则④ 赠送口径):充 X 赠 Y —— 赠送=营销让利,独立 bonus 行入储值负债,
       单独列示;永不计实收(本就不进 finance)/业绩与提成(按 type='recharge' 统计,bonus 天然排除)/积分基数。
       🔴 2026-08-27 事务扫查出来的:这两行原来是**两次裸 INSERT,中间没有事务** ——
       第二行要是挂了(触发器 ABORT、磁盘满、进程被杀),顾客钱收了、赠送没到账,
       而且账面上看不出少了什么。按《动钱多步写律》包成一个事务:要么两行都在,要么一行都没有。 */
    const bonusCents = selectedPackage ? selectedPackage.bonus_cents : Number(body.bonusCents || 0)
    if(!Number.isSafeInteger(bonusCents)||bonusCents<0||bonusCents>100000000)throw apiError(400,'BAD_REQUEST','赠送金额无效。')
    const svOperator = actorOf(adminSession)   // J-105 第一批:储值操作人
    const receipt=pricingTransactions.run({tenantId:currentTenantId(),userId,body,admin:adminSession,source:'recharge',execute:()=>{
    db.exec('SAVEPOINT standalone_recharge')
    try {
      const recharge=insertStoredValueTransaction({
        userId,
        type: 'recharge', giftItems,
        amountCents,
        payChannel: String(body.payChannel || 'unknown'),
        note: String(body.note || ''),
        createdBy: svOperator,
        technicianId: svTech || null
      })
      let bonus=null
      if (bonusCents > 0) {
        bonus=insertStoredValueTransaction({
          userId,
          type: 'bonus',
          amountCents: bonusCents,
          payChannel: 'marketing',
          note: `充值赠送(营销让利)${body.note ? ' · ' + String(body.note) : ''}`.slice(0, 200),
          createdBy: svOperator,
          technicianId: svTech || null
        })
      }
      db.exec('RELEASE standalone_recharge')
      return {rechargeTxnId:recharge.id,bonusTxnId:bonus?.id||null,amountCents,bonusCents,giftItems}
    } catch (error) {
      db.exec('ROLLBACK TO standalone_recharge; RELEASE standalone_recharge')
      throw error
    }

    }})
    json(res, 201, { ...receipt, storedValue: storedValueOverview(), balanceCents: storedValueBalanceCents(userId) });return true
  }
    return false
  }
}
