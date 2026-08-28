/* 开单三条路由(preview / 建单 / 列表)—— 2026-08-29 批次三从 local-server.mjs 搬出,**只搬不改**。

   为什么这一刀:网页开单(上线前必办)落地时 local-server 又要涨,《棘轮律》只许降不许升;
   而且这三条正是「结算开单」域的路由层,与 refund-routes / store-content-routes 同一个道理:
   路由赖在一万八千行里就是「改一处漏一处」的土壤。
   门禁扫描器(test-auth-surface)扫 local-server + 全部 *-routes.mjs,本文件天生在扫描面里。 */
export function createSettlementRoutes({ apiError, json, readBody, db, currentTenantId, computeSettlement, createSettlementGroup, serializeSettlement, isUserBound, storedValueBalanceDetail }) {
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
  /* 屏 0:「结算单已推送待签」状态下可**撤回改单**。
     只撤未签的;已签一律不可撤(账本只追加、已签不可改),要改走金额更正链。
     撤回时把挂在这张单上的券一并放开,不然那张券会被一张作废单永远占着。 */
    return false
  }
  return { route }
}
