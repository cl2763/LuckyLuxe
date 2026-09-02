/* 退卡 / 账户调整 / 员工「我的客人」的**路由层**(2026-08-27 从 local-server.mjs 搬出)。

   为什么单独成模块(公约①②):这一族的实现早就在 ./account-refund.mjs 与 ./staff-scope.mjs 里了,
   只有 8 个 `if (req.method === ...)` 还赖在那个一万八千行的文件里 —— 那正是「改一处漏一处」的土壤。
   本批动的就是这个领域,按「边改边拆」把它整族搬过来。

   🔴 搬家的代价要自己付:门禁扫描器(test-auth-surface)原来只读 local-server.mjs,
   路由一搬出去就等于**从扫描面里消失**,而套件照样全绿 —— 那是最坏的一种"绿"。
   所以同批把扫描器改成读 local-server.mjs + 全部 `*-routes.mjs`,并加了一条**路由条数下限**断言:
   下次再有人把路由搬走却忘了让扫描器跟上,条数掉下来立刻红。 */
export function createRefundRoutes({ apiError, json, readBody, refundApi, staffScope, usableTimecardsOf, svReversal }) {
  async function route(req, res, ctx) {
    const { path, query, adminSession, requireRefundRight } = ctx
    /* 裁定2(08-30d 准开口):错记充值整笔冲销 —— 合同五条见 ./stored-value-reversal.mjs。
       权限与退卡同门(老板 + 财务钥匙:/admin/stored-value 前缀天然在钥匙闸内)。 */
    const svRevMatch = path.match(/^\/admin\/stored-value\/txns\/([^/]+)\/reverse$/)
    if (req.method === 'POST' && svRevMatch) {
      requireRefundRight()
      const r = svReversal.reverseRechargeTxn({
        txnId: decodeURIComponent(svRevMatch[1]),
        tenantId: ctx.tenantId,
        operator: adminSession.email || adminSession.username || 'owner',
        reason: (await readBody(req)).reason   // D122:事由必填,后端硬拦
      })
      json(res, 201, r)
      return true
    }
    /* S2批①(规则⑥ 收编):手动耗卡=账目风险口,永久关闭 —— 扣卡只在结算单签字时刻由引擎自动做。 */
    if (req.method === 'POST' && path === '/admin/stored-value/consume') {
      throw apiError(410, 'MANUAL_CONSUME_GONE', '手动耗卡已取消:储值扣款只随结算单签字自动入账。')
    }
    if (req.method === 'GET' && path === '/admin/account-adjust/facts') {
      requireRefundRight()
      const uid = String(query.userId || '').trim()
      if (!uid) throw apiError(400, 'BAD_REQUEST', 'userId 必填。')
      const facts = refundApi.refundFacts(uid)
      // 黄条句也后端给:前端把当前填的金额带上来,越过「实付可退」才有话
      json(res, 200, { facts, bonusWarning: query.amountCents ? refundApi.bonusWarningText(uid, query.amountCents) : '' })
      return true
    }
    if (req.method === 'POST' && path === '/admin/stored-value/refund') {
      requireRefundRight()
      const b = await readBody(req)
      json(res, 201, refundApi.refundStoredValue({
        userId: String(b.userId || '').trim(),
        amountCents: b.amountCents ?? (b.amount === undefined ? undefined : Number(b.amount) * 100),
        payChannel: b.payChannel, reason: b.reason, requestId: b.requestId,
        operator: adminSession.email || adminSession.username || adminSession.role || 'owner'
      }))
      return true
    }
    // v1.2 ④ 员工只读「我的客人」:实现在 ./staff-scope.mjs,这里只门禁 + 分发
    const myCustMatch = path.match(/^\/admin\/my-customers(?:\/([^/]+))?$/)
    if (req.method === 'GET' && myCustMatch) {
      if (adminSession.role !== 'owner' && adminSession.role !== 'staff') throw apiError(403, 'FORBIDDEN', '需要登录商家后台。')
      if (myCustMatch[1] && adminSession.role !== 'staff') throw apiError(403, 'FORBIDDEN', '这条只给员工端用。')
      json(res, 200, myCustMatch[1]
        ? staffScope.myCustomerDetail(adminSession, myCustMatch[1])
        : staffScope.myCustomers(adminSession, query))
      return true
    }
    const custCardsMatch = path.match(/^\/admin\/customers\/([^/]+)\/timecards$/)
    if (req.method === 'GET' && custCardsMatch) {
      requireRefundRight()
      json(res, 200, { timecards: usableTimecardsOf(custCardsMatch[1]) })
      return true
    }
    const tcFactsMatch = path.match(/^\/admin\/timecards\/([^/]+)\/refund-facts$/)
    if (req.method === 'GET' && tcFactsMatch) {
      requireRefundRight()
      json(res, 200, { facts: refundApi.timecardRefundFacts(tcFactsMatch[1]) })
      return true
    }
    const tcRefundMatch = path.match(/^\/admin\/timecards\/([^/]+)\/refund$/)
    if (req.method === 'POST' && tcRefundMatch) {
      requireRefundRight()
      const b = await readBody(req)
      json(res, 201, refundApi.refundTimecard({
        cardId: tcRefundMatch[1], times: b.times,
        amountCents: b.amountCents ?? (b.amount === undefined ? undefined : Number(b.amount) * 100),
        payChannel: b.payChannel, reason: b.reason,
        operator: adminSession.email || adminSession.username || adminSession.role || 'owner'
      }))
      return true
    }
    return false
  }
  return { route }
}
