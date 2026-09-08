/* D152 · 报价顺序:折扣 → 原价 → 折后价(店主 05q §二)

   店主要的那句话长这样:「新客首次可用 XX 券,原价 ¥398,券后 ¥348」。
   三段缺一不可,**顺序也是合同的一部分** —— 先给好消息,再给基准,最后给结论。

   🔴 但更要紧的是反面那一半:**没有折扣就只说原价,一个字都不许提券**。
   编一个「券后」出来是假数(零编造红线),而且顾客真的会照着来付钱。
   所以这件东西干的事是:**从库里现取「这家店到底有没有真折扣」**,
   把结论写成一句事实注入给模型 —— 有就给名字和数额,没有就明说「没有,别提」。

   为什么单独成件:它要读券表、会员档,规则又要两端一致,塞进巨型文件迟早没人找得到
   (公约①新功能一律新模块)。 */

/** 现取这家店**真有**的折扣。判据与话术都只认这里的结论。
 *  @returns {{ hasAny: boolean, items: Array<{name: string, kind: string, off: string}>, note: string }} */
export function discountFacts(db, tenantId, moneyText = (c) => String(c)) {
  const items = []
  /* 券:只认**还发得出来的** —— 停用的、发完的都不算。
     `total_qty <= 0` 视为不限量(与发券口同一口径)。 */
  let rows = []
  try {
    rows = db.prepare(`SELECT name, discount_type, amount_cents, percent_off, min_spend_cents, total_qty, issued_qty
      FROM coupons WHERE tenant_id = ? AND is_active = 1
      ORDER BY rowid ASC LIMIT 10`).all(tenantId)
  } catch { rows = [] }
  for (const r of rows) {
    const unlimited = !Number(r.total_qty) || Number(r.total_qty) <= 0
    if (!unlimited && Number(r.issued_qty || 0) >= Number(r.total_qty)) continue   // 发完了就不是「可用折扣」
    const off = r.discount_type === 'percent' && Number(r.percent_off) > 0
      ? `${Number(r.percent_off)}% off`
      : (Number(r.amount_cents) > 0 ? `立减 ${moneyText(Number(r.amount_cents))}` : '')
    if (!off) continue
    items.push({
      name: String(r.name || '').trim() || '优惠券',
      kind: 'coupon',
      off,
      minSpend: Number(r.min_spend_cents || 0),
    })
  }

  if (!items.length) {
    return {
      hasAny: false,
      items: [],
      /* 反面那一半写得比正面还硬 —— 这是零编造红线,不是措辞建议 */
      note: '【本店折扣事实】本店当前**没有任何可用的券或折扣**。'
        + '报价时**只说原价**,不许出现「券」「折扣」「优惠」「券后」「折后」这类字眼,也不许编一个出来。',
    }
  }
  const list = items.map((x) => `「${x.name}」${x.off}${x.minSpend > 0 ? `(满 ${moneyText(x.minSpend)} 可用)` : ''}`).join('、')
  return {
    hasAny: true,
    items,
    note: `【本店折扣事实】本店现有可用优惠:${list}。`
      + '报价时按这个顺序说,三段都要有:**①先说有什么折扣 ②再说原价 ③最后说折后价**。'
      + '折后价要按上面的数额算准,算不出来就只说原价并说「具体优惠到店确认」——**不许估、不许编**。',
  }
}

/** 这家店有没有**真能用**的折扣。事实闸拿它决定「说了『券后』算不算编事实」(D152)。
    与 `discountFacts` 同一把尺 —— 不许在别处另写一遍「什么算可用折扣」。 */
export function hasAnyDiscountOf(db, tenantId, moneyText) {
  return discountFacts(db, tenantId, moneyText).hasAny
}

