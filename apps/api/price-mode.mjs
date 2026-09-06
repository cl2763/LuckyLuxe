/* D146 · 「需报价」是一列,不是靠价格猜出来的(店主 05o 裁 → 05p §二 落地)

   ══ 为什么非立这一列不可 ══
   05o 那批要给北京店造「1–2 个需报价项目」,做不出来 —— 全仓**没有**表示「这项要技师看了才报价」的字段。
   当时能想到的两条路都是错的:
   · 拿 `price_cents = 0` 顶 —— 0 在本仓**已经有含义**:「本店制作免卸甲」就是真的免费。
     一个字段回答两个问题,下一个 bug 必从那儿长出来(《一个字段只许回答一个问题》)。
   · 拿名字里带「定制」猜 —— 判据锚在会变的字面量上,商家改个名就失灵。
   所以加一列 `services.price_mode`:**`fixed` = 有价照报 · `quote` = 需技师报价,AI 一个数字都不许出**。

   ══ 谁认这一列 ══
   · 报价路(`quote-intake`):`quote` 项 → 走报价采集,不报数;
   · 预约采集(`booking-intake` ③):项目对到价目时,`quote` 项交给报价采集;
   · D145 后半的「最便宜的是哪种」:**`quote` 项不参与排序** —— 它压根没有价可比。

   ══ 迁移 ══
   `local-server.mjs` 的 ALTER 清单里一条 `ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'fixed'`,
   CREATE TABLE 里同一列(公约⑧:只写 CREATE 等于只对全新库生效,老库不会跟上;
   `test-schema-consistency` 会把两条路的 schema 逐列 diff)。
   DEFAULT `'fixed'` 是**列级业务默认**(存量项目本来就都是有价的),不是租户默认 —— 店主 05p §二 明许。 */

export const PRICE_MODES = ['fixed', 'quote']

/* 归一:库里读出来的行、接口收进来的 body,都从这一处过。
   拿不准一律回 `fixed` —— **fail-closed 朝「照常报价」那侧**:
   把一个本该报价的项目误判成 quote,顾客会被无谓地转进报价采集(体验差但不出错数);
   反过来把 quote 误判成 fixed 才是真事故(AI 会报一个不该存在的数)。
   所以**只有明确写着 quote 的才是 quote**。 */
export function normalizePriceMode(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === 'quote' ? 'quote' : 'fixed'
}

/* 一行(库行或序列化后的对象)是不是需报价项。两种命名都收:
   库行是 `price_mode`,接口序列化后是 `priceMode` —— 调用方不该记得自己手上是哪一种。 */
export function isQuoteItem(row = {}) {
  return normalizePriceMode(row.price_mode ?? row.priceMode) === 'quote'
}

/* 报价路的出句:需报价项**不许出数字**,只说要技师确认。
   句子在这里长一次(后端唯一出口),两端同一句。 */
export const QUOTE_ONLY_TEXT = {
  zh: (name) => `${name}要技师看过您的甲面/眼型才好报价,我把需求整理给技师,回头给您准数。`,
  en: (name) => `${name} needs the artist to take a look before quoting — I'll pass your details along and come back with the exact price.`
}

/* 「有价可比」的项目集合 —— D145 后半「最便宜的是哪种」用它。
   为什么单独出一个函数而不是让调用方自己 filter:
   **判据要能验「quote 项没混进去」**,而混没混进去取决于这一处的过滤条件;
   过滤条件散在各调用点,就没有一处可以挨刀。 */
export function pricedOnly(rows = []) {
  return rows.filter((r) => !isQuoteItem(r) && Number(r.price_cents ?? r.priceCents ?? 0) > 0)
}

/* 最便宜的 N 项(默认 2)。**只按 `price_cents` 升序** —— 不看三档价:
   顾客问「最便宜的是哪种」,问的是这家店的门槛价,不是他能不能拿到会员价。
   同价时按名字定序,免得每次调用顺序不同、判据抓不稳。 */
export function cheapestItems(rows = [], n = 2) {
  return pricedOnly(rows)
    .slice()
    .sort((a, b) => {
      const pa = Number(a.price_cents ?? a.priceCents ?? 0)
      const pb = Number(b.price_cents ?? b.priceCents ?? 0)
      if (pa !== pb) return pa - pb
      return String(a.name_zh ?? a.nameZh ?? '').localeCompare(String(b.name_zh ?? b.nameZh ?? ''))
    })
    .slice(0, Math.max(1, n))
}
