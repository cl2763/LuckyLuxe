/* 顾客端订单表达域(徽标 / 副行 / 金额句 / 售后按钮位)——从 local-server.mjs 搬出。
   公约②「边改边拆」:D70 这一刀动的就是这块(售后按钮前置改读状态机),按约定顺手把域搬出来。
   **行为一字未改**:整段原样搬,依赖由调用方注入(与 after-sales.mjs 同一模式,避免循环引用)。

   这块干的事只有一件:同一张单在**列表 / 详情 / 两端**要说同一句话,
   所以句子在这里唯一成型,前端只渲染不拼串(「后端出句」)。 */
/* 🔴 D71(店主 2026-08-24 立案):订单「来源渠道」的人话句 —— **后端唯一出口,零编造**。

   立案背景:网页端原来这么写(apps/web 里那份 bookingSource):
     没有真来源 → `channels[hashText(publicCode) % channels.length]`
   —— 按订单号哈希**编一个**「美团 / 小红书 / 抖音」出来给店主看。
   店主可能据此判断渠道效果做投放决策,危害比一般假数更重(假数回落第五例)。

   现在:有真值 → 有就说(库里存的中文渠道名直接用;机器码翻成人话);
         没真值 → 「未记录来源」。**一律不编。** */
const SOURCE_TEXT = {
  owner_direct: '老板直接排单',
  settlement_instant: '开单即时创建',
  miniapp: '小程序自助',
  wechat_miniprogram: '小程序自助',
  web: '网页自助',
  ai_booking_draft: 'AI 助手代下',
  admin_booking_draft: '后台代下',
  'demo-seed': '演示数据',
  demo: '演示数据'
}

export function bookingSourceText(raw) {
  const v = String(raw || '').trim()
  if (!v) return '未记录来源'          // 零回落律:拿不到真值就如实说,不许拿别的字段顶上
  return SOURCE_TEXT[v] || v          // 不认识的值原样透出(那也是真值),就是不编
}

export function createOrderBadges({ db, bookingState, afterSalesProgress, amendmentShape, formatMoneyCents, groupMainItemCount, groupFirstMainName }) {
  function customerOrderBadges(row) {
    const stl = db.prepare("SELECT * FROM settlements WHERE booking_id = ? AND status = 'signed' ORDER BY signed_at DESC LIMIT 1").get(row.id)
    /* 🔴 合同⑤(08-24):售后不再占主状态 —— 判据改读**售后轨道字段**。
       旧判据 row.status === 'AFTER_SALES' 在主状态回归 COMPLETED 后会全部失灵(徽标掉回"已签署")。 */
    const isAfterSales = Boolean(row.after_sales_status)
    /* B 部:徽标按完成态细分 —— 售后中(待处理/处理中)/ 售后已解决 / 售后已关闭。
       同一状态机三端渲染:这里的文案就是顾客看到的那句(B⓪)。 */
    const asDone = isAfterSales ? (row.after_sales_status === 'resolved' ? 'resolved' : (row.after_sales_status === 'closed' ? 'closed' : '')) : ''
    const asBadge = asDone === 'resolved' ? '售后已解决' : (asDone === 'closed' ? '售后已关闭' : '售后中')
    const asKind = asDone === 'resolved' ? 'signed' : (asDone === 'closed' ? 'amended' : 'aftersales')
    const asNote = asDone === 'resolved' ? (row.after_sales_result ? `已解决:${row.after_sales_result}` : '售后已解决') : (asDone === 'closed' ? '售后已关闭' : '已转人工客服跟进')
    if (!stl) {
      /* 🔴 假数回落全仓审计(店主 08-23 立永久律,D66→D69→couponCount 同族三案后升级):
         **顾客能看见的数字,拿不到真值就显示「—」或如实说明,一律不许回落到别的字段。**
         附加:**没有签署单的单子不许出现「已结清」这类完成态金额句。**
         此前这里回空串,前端就自己拿预约标价(service_price_cents)拼出「已结清 ¥198」——
         系统各处都认为这单没消费(积分/累计消费/成长值全 0),只有这张卡片说收过钱(D69)。
         现在金额句一律后端唯一给出,前端零分支:有句就渲染,没句就不显示金额行。
         措辞与详情页同源(order-detail「本单未产生结算单」),同一事实两处说同一句话。 */
      /* 「完全没开单」与「开了单还没签字」是两件事,不许说同一句话:
         有未签单的完成单,顾客端待签卡已置顶催签,这里说「服务确认单待签字」。 */
      const pendingSheet = db.prepare("SELECT code FROM settlements WHERE booking_id = ? AND status NOT IN ('voided','signed','amended') ORDER BY rowid DESC LIMIT 1").get(row.id)
      const noSheetAmountText = (row.status === 'COMPLETED' || isAfterSales)
        ? (pendingSheet ? '服务确认单待签字' : '本单未产生结算单')
        : (['CANCELLED', 'NO_SHOW'].includes(row.status)
          ? `总价 ${formatMoneyCents(row.service_price_cents || 0, row.tenant_id, 'auto')}`
          : (row.deposit_cents
            ? `定金 ${formatMoneyCents(row.deposit_cents, row.tenant_id, 'auto')} 已付 · 到店应付 ${formatMoneyCents(row.final_due_cents || 0, row.tenant_id, 'auto')}`
            : `到店应付 ${formatMoneyCents(row.final_due_cents ?? row.service_price_cents ?? 0, row.tenant_id, 'auto')}`))
      return {
        listBadgeText: isAfterSales ? asBadge : '',
        listBadgeKind: isAfterSales ? asKind : '',
        listNote: isAfterSales ? asNote : '',
        listTitleText: '',
        // 拍板③:未签署单不出售后发起按钮;存量无签署单的售后单=进度卡照旧(老数据只读不回溯)
        afterSalesAction: '', afterSalesActionText: '',
        actualDueText: '', actualDueCents: null,
        listAmountText: noSheetAmountText,
        ...(isAfterSales ? { afterSales: afterSalesProgress(row) } : {})
      }
    }
    /* 批③首件 B1/B5:售后按钮位与句子后端唯一(拍板③:仅已签署可发起;B5:一单一条进行中)——
       start=「有疑问,去售后」(已完成+已签署,或售后已结案可再发起);progress=「查看售后进度」。 */
    /* 🔴 D70(店主 08-24):发起售后的前置(已完成 + 已签署 + 没有进行中的售后)**只有状态机一份**。
       这里原来自己又写了一遍 `(status==='COMPLETED'||isAfterSales) && stl` —— 与状态机分叉两套判定,
       顾客端按钮出不出与后端闸门允不允许可以对不上。现在只问状态机。 */
    const asInProgress = bookingState.isAfterSalesOpen(row)
    const canOpenAfterSales = bookingState.allowedActions(row, { actor: 'customer' }).some((a) => a.key === 'openAfterSales')
    const afterSalesAction = asInProgress ? 'progress' : (canOpenAfterSales ? 'start' : '')
    const amd = amendmentShape(stl)
    /* ㋉ 店主三拍(08-22)之 C5(拍案一):列表金额=**实付现金**,与单据头条「本单到店支付」同源
       (Σoffline 腿;㋆ 矩阵常驻恒等保证头条=offline Σ,所以这里读腿=读头条)。
       价值总额(结算合计)不再在列表裸出(D65-b L2 同族收口):售后行原「总价 <合计>」同刀换源,
       前缀随之改「已结清」——「总价」二字配现金数就是说谎,同一事实处处说同一句话。
       D66 途中修(店主双服务单实测抓的):一张预约可挂**多张**已签单(双服务一次开两组),
       只取最新一张=卡上少一半钱 —— 实付现金按「挂本预约的全部已签单」Σ,一张不漏一分不重。 */
    const cashDueCents = db.prepare(`SELECT COALESCE(SUM(p.amount_cents),0) AS n FROM settlement_payments p
      JOIN settlements s ON s.id = p.settlement_id
      WHERE s.booking_id = ? AND s.status = 'signed' AND p.leg = 'offline'`).get(row.id).n
    /* D1 修订(店主 08-22 二拍)+D68 口径澄清(08-23):「等N项」的 N=**主项目数量**
       (groupMainItemCount 唯一出口:加项/自选/购卡不计,大类不是计数单位);N≥2 才出「首项目 等N项」。 */
    const grpCount = groupMainItemCount(stl.group_id, row.tenant_id)
    const grpFirstName = grpCount >= 2 ? groupFirstMainName(stl.group_id, row.tenant_id) : ''
    // 售后 > 已更正 > 已签署(售后是当前最要紧的状态,压在最上面)
    const badge = isAfterSales ? asBadge : (amd.amendBadgeText || '已签署')
    const kind = isAfterSales ? asKind : (amd.amendedCount ? 'amended' : 'signed')
    return {
      listBadgeText: badge,
      listBadgeKind: kind,
      listNote: isAfterSales ? asNote : (amd.amendedCount ? '已签署 · 点开看更正明细' : '已签署'),
      // 批③首件 B1/B5:售后按钮位(后端唯一;'' = 不出按钮)
      afterSalesAction,
      afterSalesActionText: afterSalesAction === 'progress' ? '查看售后进度' : (afterSalesAction === 'start' ? '有疑问,去售后' : ''),
      settlementCode: stl.code,
      /* 规则③:右侧金额取实际应付**只在有更正时**。没更正的单前缀词一个字不动 ——
         否则「已结清 ¥198」会被换成光秃秃的「¥198」,那就不是「列表项保持现状」了(D2-03)。 */
      actualDueCents: amd.amendedCount ? amd.actualDueCents : null,
      actualDueText: amd.amendedCount ? amd.actualDueText : '',
      /* 闭环③「同一个事实处处说同一句话」:没更正的已签单,列表金额以前取的是**预约上的服务底价**
         (service_price_cents),而单据上是结算合计 —— 会员档位/折扣/加项一进来两个数就对不上:
         列表写「已结清 ¥198」、点开确认单写「合计 ¥128」,顾客看两个数字。
         金额一律以结算单为准,由后端拼好整串下发(前缀词保持现状,只把数换对)。 */
      listAmountText: amd.amendedCount ? '' : (
        isAfterSales || row.status === 'COMPLETED'
          ? `已结清 ${formatMoneyCents(cashDueCents, row.tenant_id, 'auto')}`
          : formatMoneyCents(cashDueCents, row.tenant_id, 'auto')
      ),
      listTitleText: grpCount >= 2 ? `${grpFirstName} 等${grpCount}项` : '',
      /* 屏 D3 售后进度三步(发起 → 跟进中 → 结果)。文案与时间全后端给;
         未完成时结果行显示「—」(规则④ 沿用现行口径,退款凭据只记售后单内)。 */
      ...(isAfterSales ? { afterSales: afterSalesProgress(row) } : {})
    }
  }

  return { customerOrderBadges }
}
