/* 日结「哪一单算哪一天」的归属口径 —— 从 local-server.mjs 搬出(公约①②,2026-08-27)。

   这四个函数是**日结归属的唯一实现**:日结区、业绩、工资、排行都按它算「今天有哪些单」。
   口径本身没动(店主 2026-08-10 拍板:日结归属 = **服务发生日**,收入流水仍按签字时刻),
   只是从一万八千行的文件里挪出来 —— 归属算错一天,业绩和工资就整天错位,它值得单独一个文件。 */
export function createDailyCloseScope({ db, localParts, tenantTimezone }) {
  // 当天签署的服务单(按门店时区判定「当天」,不用裸 UTC 日期)
  /* 🔴 日结归属 = **服务发生日**(店主 2026-08-10 拍板 ②,《财务记账总逻辑》v1.5 §六,
     取代此前的"按签字日归集")。某天的日结区只留痕**服务发生在那一天**的单 ——
     当晚签、次晨签、数日后补签,一律记回服务那一天,不许把晚签的单堆到签字那天
     (否则日积月累越滚越多,店主看到的"今天"永远混着前几天的尾巴)。
     **两条轴分开**:收入流水仍按签字时刻(§三 不变),日结/业绩/工资按服务日。
     服务发生日:挂了预约的取预约开始时间;即时单(没挂预约)取开单时间 —— 开单当天就是服务当天。 */
  function settlementServiceDate(row, tenantId) {
    const tz = tenantTimezone(tenantId)
    const bk = row.booking_id ? db.prepare('SELECT appointment_start FROM bookings WHERE id = ?').get(row.booking_id) : null
    const at = (bk && bk.appointment_start) || row.created_at
    return at ? localParts(new Date(at), tz).date : ''
  }

  function signedSettlementsOn(date, tenantId) {
    return db.prepare("SELECT * FROM settlements WHERE tenant_id = ? AND status = 'signed' AND signed_at IS NOT NULL ORDER BY signed_at ASC")
      .all(tenantId)
      .filter((row) => settlementServiceDate(row, tenantId) === date)
  }

  /* 日结行的主标识时间(店主 2026-08-09 口头修订 v6 合同):行首显示 HH:MM + 顾客 + 技师,
     单号从行内去掉(签署单弹窗/详情里保留)。时区在**后端**折算,前端只显示 —— 与门店时区纪律一致。
     有预约的取预约开始时间(店主看的是"几点那一单");没预约的直接单取签署时刻。 */
  function settlementRowTime(row) {
    const bk = row.booking_id ? db.prepare('SELECT appointment_start FROM bookings WHERE id = ?').get(row.booking_id) : null
    const at = (bk && bk.appointment_start) || row.signed_at || row.created_at
    if (!at) return ''
    return localParts(new Date(at), tenantTimezone(row.tenant_id)).time.slice(0, 5)
  }

  /* 跨零点单的自解释标注(店主 2026-08-10 拍板)。
     口径不变:签字时刻 = 记账时刻,按门店时区落自然日。但「台面说本日休息、日结却有 2 单」
     这种画面必须一眼看懂 —— 2026-08-10 就是这么来的:08-09 晚 20:10/21:10 的两单,
     店主在 08-10 凌晨 1:25/1:33 才签,于是记在 08-10 的账上。
     行上标一句「昨日 21:10 单 · 今晨签」,日期口径差异就自解释了。 */
  /* 日结归属改服务日之后,这行小注的语义**反过来了**:
     以前是"这单的服务发生在别的天"(因为日结按签字日归);
     现在日结日 ≡ 服务日,需要解释的变成**签字晚于服务日**那一种 —— 「次晨补签」「隔 2 天补签」。
     服务当天就签掉的单不加任何小注(绝大多数单都是这种,不打扰)。 */
  function settlementCrossDayNote(row, closeDate) {
    const tz = tenantTimezone(row.tenant_id)
    if (!row.signed_at || !closeDate) return ''
    const serviceDay = settlementServiceDate(row, tz ? row.tenant_id : row.tenant_id)
    if (serviceDay !== closeDate) return ''            // 不属于这一天,不该出现在这里
    const signParts = localParts(new Date(row.signed_at), tz)
    if (signParts.date === serviceDay) return ''       // 当天签,没什么好解释的
    const gap = Math.round((new Date(`${signParts.date}T00:00:00Z`) - new Date(`${serviceDay}T00:00:00Z`)) / 86400000)
    const signHour = Number(signParts.time.slice(0, 2))
    if (gap === 1 && signHour < 6) return '次晨补签'
    if (gap === 1) return '次日补签'
    return `隔 ${gap} 天补签`
  }

  return { settlementServiceDate, signedSettlementsOn, settlementRowTime, settlementCrossDayNote }
}
