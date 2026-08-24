/* 订单状态机(店主 2026-08-24 合同,D70 修法)——**唯一实现**。

   立这个模块的原因:D70 开检查明,网页端「已完成」「已取消」两颗裸按钮零状态判断,
   任何状态的单都能点:已售后的单点一下就从售后分组消失、已完成的单点「已取消」会冲销掉已确认的收入。
   根因不是规则写错,是**这两颗按钮从来没写过规则**,而后端只白名单校验了"值合法",
   没有校验"从这个态能不能去那个态"。

   🔴 硬约束(店主定):**路由里不许出现任何状态判断** ——
   合法前置、能做什么动作、动作后去哪,全部住在这里;路由只做三件事:取参 → 调状态机 → 回结果。
   前端同理:按钮显隐从 allowedActions 推导,页面里不许写 if 补按钮(这是「后端出句」在动作层的同构)。

   ===== 店主合同五条(原话为准,不许改写)=====
   ①未签署只有「取消订单」
   ②顾客签署确认单即入账,单据自动为已签署/已完成——「已完成」按钮删除,入账不再依赖任何按钮
   ③已签署单唯一入口「去售后」(顾客自提;提不了则商家端/网页端代提)
   ④售后中,详情页同时展示售后详情+订单详情,唯一动作「结束售后」,不许出现取消/完成等其他按钮
   ⑤售后不改写主状态,列表"售后"分组改按售后字段筛
*/

/* 主状态:**AFTER_SALES 不再是主状态**(合同⑤)——售后是挂在已完成单上的一条并行轨道,
   记在 after_sales_status 里,不覆盖主状态。 */
export const BOOKING_STATES = ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED']

/* 售后轨道(与主状态并行,不互相覆盖) */
export const AFTER_SALES_STATES = [null, 'pending', 'processing', 'resolved', 'closed']
const AFTER_SALES_OPEN = ['pending', 'processing']   // "售后中"= 这两个态

/* 动作表:每条 = 谁能点 / 从哪些态能点 / 额外前置 / 点完去哪 / 有什么副作用。
   label 由后端给(前端零拼串);actor 决定这个动作出现在谁的界面上。 */
export const BOOKING_ACTIONS = {
  cancel: {
    label: '取消订单',
    actors: ['customer', 'merchant'],
    from: ['PENDING_PAYMENT', 'CONFIRMED'],   // 合同①:未签署(=还没完成)只有这一个动作
    to: 'CANCELLED',
    blockedWhenAfterSalesOpen: true
  },
  confirmArrival: {
    label: '确认到店',
    actors: ['merchant'],
    from: ['PENDING_PAYMENT'],
    to: 'CONFIRMED',
    blockedWhenAfterSalesOpen: true
  },
  /* 裁 A(店主 08-24):合同① 的本意是"未签署前不许有会改写账的完成类按钮",不是"只能有一个按钮"。
     爽约是真实业务事实(连着定金没收链),保留 —— 但**必须同样走状态机**:
     原来它自己一条路由改主状态、零前置校验,已完成/已取消/售后中的单都能标一遍。 */
  noShow: {
    label: '标记爽约',
    actors: ['merchant'],
    /* 前置=**还没发生、也还没终结**的单:待付定金的也会不来(到店打卡那条线就能判到迟到超宽限),
       所以两个态都算数;已完成/已取消/已过期/售后中一律挡掉(原来这几种全都能标一次)。 */
    from: ['PENDING_PAYMENT', 'CONFIRMED'],
    to: 'CANCELLED',                           // 爽约=一种取消(带 no_show_at 标与定金没收链)
    ownerOnly: true,
    blockedWhenAfterSalesOpen: true
  },
  /* 裁 A 之二:「爽约后的可用动作一并收敛」—— 处置定金也从状态机出,
     不再由两端各写一份 `depositDisposal.state === 'pending'` 的 if(网页/小程序原来各一份)。
     金额进 label(后端出句),前端零拼串。 */
  disposeDeposit: {
    label: '处置定金',
    actors: ['merchant'],
    from: ['CANCELLED'],
    to: null,                                  // 处置动的是定金负债,不动主状态
    ownerOnly: true,
    requiresNoShowPendingDeposit: true
  },
  openAfterSales: {
    label: '去售后',                            // 合同③:已签署单的唯一入口
    actors: ['customer', 'merchant'],
    from: ['COMPLETED'],
    to: null,                                  // 合同⑤:**不改写主状态**,只开售后轨道
    requiresSignedSheet: true,
    blockedWhenAfterSalesOpen: true            // 一单同时只一条进行中
  },
  /* 合同②:「已完成」**按钮**删除 —— 但"把单置为已完成"本身还得有路可走
     (签署驱动、数据迁移、测试夹具)。所以它是 internal:**不出现在任何人的 allowedActions 里**
     (前端永远拿不到这颗按钮),但系统内部调用合法。入账已与它彻底脱钩:置完成不再记任何收入。 */
  markCompleted: {
    label: '标记完成(系统)',
    actors: [],
    internal: true,
    from: ['PENDING_PAYMENT', 'CONFIRMED'],
    to: 'COMPLETED'
  },
  /* 裁 B(店主 08-24):三步链(写进展/标记已解决/关闭)收掉,**留痕挂到这个出口**:
     按钮守合同④(售后中只有这一颗),过程守审计(点结束必须填处理结果,写进 after_sales_events)。
     两头不亏 —— 不许无痕迹地"变绿"(原 B④ 那条红线原样保住)。 */
  endAfterSales: {
    label: '结束售后',                          // 合同④:售后中唯一动作
    actors: ['merchant'],
    from: ['COMPLETED'],
    to: null,
    requiresAfterSalesOpen: true,
    requiresNote: true,                        // 处理结果必填(顾客端展示的就是这段)
    noteMissing: ['RESULT_REQUIRED', '处理结果必填 —— 不许无痕迹地"变绿"(B④)。']
  }
}

/* 合同②:签署即完成即入账 —— 这不是"动作",是签署的必然结果,所以不放进 ACTIONS(没有按钮)。
   这里只给一个判定:这单该不该被签署自动置为已完成。 */
export function shouldAutoComplete(booking) {
  return Boolean(booking) && ['PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status)
}

export function isAfterSalesOpen(booking) {
  return AFTER_SALES_OPEN.includes(booking?.after_sales_status || '')
}

export function createBookingState({ db, noShowPendingDepositText } = {}) {
  const hasSignedSheet = (bookingId) => Boolean(
    db.prepare("SELECT 1 FROM settlements WHERE booking_id = ? AND status IN ('signed','amended') LIMIT 1").get(bookingId)
  )

  /* 出口一:这单现在能做哪些动作。**按钮显隐只能从这里推导。**
     actor: 'customer' | 'merchant';role: 'owner' | 'staff'(仅老板的动作按它收) */
  function allowedActions(booking, { actor = 'merchant', role = 'owner' } = {}) {
    if (!booking) return []
    const out = []
    const asOpen = isAfterSalesOpen(booking)
    for (const [key, def] of Object.entries(BOOKING_ACTIONS)) {
      if (!def.actors.includes(actor)) continue
      if (def.ownerOnly && role !== 'owner') continue
      if (!def.from.includes(booking.status)) continue
      if (def.blockedWhenAfterSalesOpen && asOpen) continue      // 合同④:售后中只剩「结束售后」
      if (def.requiresAfterSalesOpen && !asOpen) continue
      if (def.requiresSignedSheet && !hasSignedSheet(booking.id)) continue
      let label = def.label
      if (def.requiresNoShowPendingDeposit) {
        // 没爽约、或这单压根没收过定金、或已经处置过 → 不出这颗按钮(A⓪:不处置没收过的钱)
        const text = booking.no_show_at && typeof noShowPendingDepositText === 'function' ? noShowPendingDepositText(booking) : ''
        if (!text) continue
        label = `${def.label}(${text} 待处置)`
      }
      out.push({ key, label })
    }
    return out
  }

  /* 出口二:后端前置校验。前端收敛了也挡不住直打接口,这里才是闸。 */
  function assertTransition(booking, actionKey, { actor = 'merchant', role = 'owner', apiError, note } = {}) {
    /* 错误码是**对外契约**,不能因为内部重构而变(前端和既有断言都认它):
       未签署不能发起售后 → 沿用 400 AFTER_SALES_NEEDS_SIGNED;
       其余非法转移 → 409 ILLEGAL_TRANSITION。 */
    const err = (code, msg, httpStatus = 409) => {
      if (typeof apiError === 'function') throw apiError(httpStatus, code, msg)
      const e = new Error(msg); e.code = code; throw e
    }
    const def = BOOKING_ACTIONS[actionKey]
    if (!def) err('UNKNOWN_ACTION', `没有「${actionKey}」这个动作。`)
    if (!booking) err('NOT_FOUND', '找不到这张单。')
    /* internal 动作(签署驱动/迁移/夹具):没有按钮,但系统内部合法 —— 只校验前置态 */
    if (def.internal) {
      if (!def.from.includes(booking.status)) err('ILLEGAL_TRANSITION', `这张单现在是「${booking.status}」,不能做「${def.label}」。`)
      return def
    }
    const ok = allowedActions(booking, { actor, role }).some((a) => a.key === actionKey)
    if (!ok) {
      const why = !def.from.includes(booking.status)
        ? `这张单现在是「${booking.status}」,不能做「${def.label}」。`
        : (def.requiresSignedSheet && !hasSignedSheet(booking.id)
          ? '这张单还没有已签署的结算单,不能发起售后。'
          : (def.requiresAfterSalesOpen ? '这张单没有进行中的售后。' : `售后处理中,现在只能「结束售后」。`))
      if (def.requiresSignedSheet && !hasSignedSheet(booking.id) && def.from.includes(booking.status)) {
        err('AFTER_SALES_NEEDS_SIGNED', why, 400)
      }
      if (def.requiresNoShowPendingDeposit && def.from.includes(booking.status)) {
        err('NO_PENDING_DEPOSIT', booking.no_show_at ? '这张单没有待处置的定金。' : '这张预约没有被标记爽约,不能处置定金。', 400)
      }
      err('ILLEGAL_TRANSITION', why)
    }
    /* 必填字段的校验也住在这里 —— 路由只负责把用户填的字传进来(路由零判断)。
       note === undefined 表示调用方不经手文本(内部调用),不触发必填。 */
    if (def.requiresNote && note !== undefined && !String(note).trim()) {
      const [code, msg] = def.noteMissing || ['NOTE_REQUIRED', '这个动作必须填一句说明。']
      err(code, msg, 400)
    }
    return def
  }

  function nextStatus(actionKey) {
    const def = BOOKING_ACTIONS[actionKey]
    return def && def.to ? def.to : null
  }

  /* 出口三:执行动作 —— 状态变更**与副作用**都在这里。
     副作用能力(删占位/冲销收入/写留痕/时间戳)由调用方注入,所以本模块仍然不直接碰这些实现;
     但"哪个动作会产生哪些副作用"这条知识住在这里,路由里不留任何分发 if。 */
  function applyTransition(booking, actionKey, { now, note = '', actorEmail = '', deleteSlots, reverseIncome, writeHistory, updateBooking, noShowFields, writeAfterSalesEvent } = {}) {
    const def = BOOKING_ACTIONS[actionKey]
    const next = nextStatus(actionKey)
    if (actionKey === 'openAfterSales') {
      // 合同⑤:售后不改写主状态,只开售后轨道;发起原因写进 history(唯一持有链)
      updateBooking({ after_sales_status: 'pending', after_sales_result: null, updated_at: now })
      writeHistory({ from: booking.status, to: 'AFTER_SALES', note: note || '商家标记转入售后', at: now })
      return { statusChanged: false, afterSalesOpened: true }
    }
    if (actionKey === 'endAfterSales') {
      /* 裁 B:审计留痕跟着出口走 —— 原来三步链的 resolve 会写一行 after_sales_events,
         收掉三步链后这行必须由这里补上,否则"过程留痕"就断了(顾客端时间线也少一节)。 */
      if (typeof writeAfterSalesEvent === 'function') writeAfterSalesEvent({ kind: 'resolve', text: note, at: now })
      updateBooking({ after_sales_status: 'resolved', after_sales_result: note || '', updated_at: now })
      writeHistory({ from: booking.status, to: booking.status, note: `售后结束:${note || '已处理'}`, at: now })
      return { statusChanged: false, afterSalesClosed: true }
    }
    if (actionKey === 'noShow') {
      /* 爽约 = 取消 + 留下 no_show_at 标(定金处置入口只对已爽约的单开)+ 按店配扣定金。
         扣多少由调用方算(取店配 noShowForfeitPct),这里只负责"什么时候写、写哪些字段"。 */
      deleteSlots()
      reverseIncome(actorEmail)
      updateBooking(Object.assign({ status: 'CANCELLED', updated_at: now }, noShowFields ? noShowFields() : {}))
      writeHistory({ from: booking.status, to: 'CANCELLED', note: note || '顾客爽约(或迟到超过宽限)', at: now })
      return { statusChanged: true, to: 'CANCELLED', noShow: true, label: def.label }
    }
    if (!next) return { statusChanged: false }
    if (['CANCELLED', 'EXPIRED'].includes(next)) {
      deleteSlots()
      // 合同②:按钮入账已退役;冲销保留 —— 取消/过期要把已入账的收入红字冲掉(账目自洽,不是入账路径)
      reverseIncome(actorEmail)
    }
    updateBooking({ status: next, updated_at: now })
    return { statusChanged: true, to: next, label: def.label }
  }

  return { allowedActions, assertTransition, nextStatus, applyTransition, hasSignedSheet, isAfterSalesOpen, shouldAutoComplete }
}
