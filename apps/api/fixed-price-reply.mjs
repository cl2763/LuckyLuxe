/* D152 正面 · AI 直接报 `price_mode=fixed` 的价(店主 05s §二 裁待裁 #8)

   店主问的是「AI 到底许不许自己报价」。**D146 已经答了一半**:
   `services.price_mode` 分 `fixed | quote` —— `quote` 项目的价格**根本不下发模型**,
   所以它本来就报不出数字;`fixed` 项目的价格是下发的。裁下来就是:

   · 命中 **`fixed`** 项目 → **AI 直接报**,顺序 **折扣 → 原价 → 折后价**;**不进报价采集**;
   · 命中 **`quote`** 或没命中具体项目 → 照旧走采集、最后转人工不报数字;
     但有新客券时**先说一句**「新客首次有 XX 券可用,具体价格技师看过后报」。

   ══ 为什么这一句由**规则**出,不交给模型 ══
   段 7b 试过交给模型:三段式的顺序在事实里写着,但**引擎根本走不到报价那一步**
   (问价先进采集、最后转人工)。而且钱的话交给模型 = 每次措辞都可能不一样、数字可能算错。
   这一句里每个数字都从库里来、折后价当场算 —— 算不出来就只说原价(不许估、不许编)。 */

/** 顾客这句话有没有点到某个**在售项目**。
 *  匹配的是项目名里的**实词**,不做模糊猜:猜错了就是报错价。
 *  @param items `[{ id, name, priceCents, priceMode, durationMin }]`
 *  @returns 命中的那个,或 null */
export function matchService(text = '', items = []) {
  const t = String(text || '')
  if (!t) return null
  let best = null
  for (const it of items) {
    const name = String(it.name || '').trim()
    if (name.length < 2) continue
    /* 整名命中优先;整名没中就看去掉修饰后的核心词(「精致单色」→「单色」) */
    const core = name.replace(/^(精致|基础|经典|高级|定制|日式|法式加钻)/, '')
    const hit = t.includes(name) ? name.length : (core.length >= 2 && t.includes(core) ? core.length : 0)
    if (hit > (best ? best.hit : 0)) best = { ...it, hit }
  }
  return best
}

/* 🔴 05s 补一 §二①(店主在北京店当顾客亲测出来的):
   「精致单色多少钱?」有券,「你们最便宜的美甲多少钱」**没券** ——
   同一家店同一个项目,顾客换个问法答案就变。
   病因:那条路没点名项目,`matchService` 命中不了,于是掉回报价采集自己答。
   裁:**凡是答案会落到一个 `fixed` 项目的问价,都走同一个出口**。
   这里补的就是「问的是最便宜/最贵/推荐,没点名字」那一类。 */
const RANK = [
  { re: /最便宜|最实惠|便宜(点|一点|的)|最低|入门|性价比/, pick: 'cheapest' },
  { re: /最贵|最好的|最高端|顶配/, pick: 'priciest' },
]
/* 大类词 → `services.type`。顾客说「美甲」就只在美甲里挑,别把美睫的价报过去。 */
const CATEGORY = [
  { re: /美甲|指甲|甲油|做甲/, type: 'NAIL' },
  { re: /美睫|睫毛|嫁接/, type: 'LASH' },
]

/** 问的是「最便宜/最贵的 X」时,挑出该报的那个 `fixed` 项目 + 陪衬的第二个。
 *  @returns {{ top, second }|null} */
export function pickByRank(text = '', items = [], contextType = '') {
  const t = String(text || '')
  const rank = RANK.find((r) => r.re.test(t))
  if (!rank) return null
  /* 🔴 D176(店主 05u §三 亲读 v5 通二):上文在说**美睫**(刚报过「裸感自然睫 CAD $198」),
     顾客接着问「那个最便宜的是哪种」,AI 却答「手部基础护理 $88」——
     **跨了品类,还和自己上一句的 $198 打架**。
     病因:品类只从**当句**认。而「最便宜的」这句话里根本没有品类词,于是掉回全店挑。
     裁:当句没说品类,就用**会话里已经确定的那个**(采集状态的 serviceType,
     或最近一次自己报过的那个项目的 type);两个都没有才全店挑。 */
  const cat = CATEGORY.find((c) => c.re.test(t))
    || (contextType ? { type: String(contextType).toUpperCase() } : null)
  const pool = items
    .filter((i) => i.priceMode === 'fixed' && Number(i.priceCents) > 0)
    .filter((i) => (cat ? String(i.type || '').toUpperCase() === cat.type : true))
    .sort((a, b) => Number(a.priceCents) - Number(b.priceCents))
  if (!pool.length) return null
  const ordered = rank.pick === 'cheapest' ? pool : [...pool].reverse()
  return { top: ordered[0], second: ordered[1] || null }
}

/** 折后价:能算准才给,算不准就不给(不许估)。
 *  只算**门槛够得着**的券;百分比与立减各算各的,取对顾客最省的那一张。 */
export function bestDiscount(priceCents, discountItems = []) {
  let best = null
  for (const d of discountItems) {
    if (Number(d.minSpend || 0) > Number(priceCents)) continue     // 门槛不够,这张用不上
    const m = /(\d+(?:\.\d+)?)%\s*off/i.exec(String(d.off || ''))
    let cut = 0
    if (m) cut = Math.round(Number(priceCents) * (Number(m[1]) / 100))
    else {
      const a = /(\d[\d,]*(?:\.\d+)?)/.exec(String(d.off || '').replace(/[^\d.,]/g, ' '))
      if (a) cut = Math.round(Number(String(a[1]).replace(/,/g, '')) * 100)
    }
    if (cut > 0 && cut < Number(priceCents) && (!best || cut > best.cut)) best = { ...d, cut }
  }
  return best
}

/** 三段式那一句。**没折扣就只说原价**,一个「券」字都不出现。
 *  @returns {string} */
export function fixedPriceSentence({ service, discounts = [], money, lang = 'zh' }) {
  if (!service || service.priceCents === undefined || service.priceCents === null) return ''
  const price = Number(service.priceCents)
  const name = service.name
  const dur = service.durationMin ? `,大概 ${service.durationMin} 分钟` : ''
  const best = bestDiscount(price, discounts)
  if (!best) {
    /* 无折扣:只报原价。**不许出现券/折扣/优惠/券后**(零编造红线,反面刀已在守) */
    return lang === 'en'
      ? `${name} is ${money(price)}${service.durationMin ? `, about ${service.durationMin} min` : ''}.`
      : `${name}原价 ${money(price)}${dur}。`
  }
  const after = price - best.cut
  /* 顺序就是店主要的:①先说折扣 ②再说原价 ③最后说折后价 */
  return lang === 'en'
    ? `We have "${best.name}" (${best.off}) — ${name} is ${money(price)}, ${money(after)} after the coupon.`
    : `现在有「${best.name}」${best.off},${name}原价 ${money(price)},券后 ${money(after)}${dur}。`
}

/** `quote` 项目那条路上的一句话:**先说有券,再说价格要技师看**(不出数字)。
 *  ——「折扣事实注入在这条路上就有人听了」那句话的落法。 */
export function quotePathDiscountLine(discounts = [], lang = 'zh') {
  /* 🔴 D165(店主 05s 补四 亲测):这句以前**写了却没人调** ——
     「手绘定制多少钱」只回了一个采集问句,顾客问的是价,却一个字没答到价上。
     没券也要出后半句:**「具体价格要技师看过后报」** —— 那才是对「多少钱」的回答。 */
  const tail = lang === 'en' ? 'the exact price needs a technician to confirm.' : '具体价格要技师看过后报给您。'
  if (!discounts.length) return lang === 'en' ? `This one ${tail}` : `这款${tail}`
  const d = discounts[0]
  return lang === 'en'
    ? `We do have "${d.name}" (${d.off}) available; ${tail}`
    : `现在有「${d.name}」${d.off}可以用;${tail}`
}

/** 接线用的那一层:从库里现取 `fixed` 项目与本店折扣,拼出该发的那一句。
 *  没命中 / 不是问价 / 命中的是 `quote` 项目 → 回 `null`,让原流程照旧走。
 *  放这儿而不是放 `local-server.mjs`:巨型文件只许搬出(公约③),
 *  而且这一段的全部逻辑本来就属于 D152 这个域。 */
export function fixedPriceAnswer({ db, tenantId, discountFacts, money }, { text, priceIntent, contextType = '' }) {
  if (!priceIntent) return null
  const rows = db.prepare(`SELECT id, name_zh, price_cents, base_duration_min, price_mode, type FROM services
    WHERE tenant_id = ? AND is_active = 1 AND (item_kind IS NULL OR item_kind = 'main')`).all(tenantId)
  const items = rows.map((r) => ({ id: r.id, name: r.name_zh, priceCents: r.price_cents,
    durationMin: r.base_duration_min, priceMode: r.price_mode || 'fixed', type: r.type }))
  /* 两条路都归这个出口:①顾客点了名 ②顾客问「最便宜/最贵的」。
     ②那条以前掉回报价采集自己答,于是同一个项目有时带券有时不带(05s 补一 §二①)。 */
  const named = matchService(text, items)
  /* D176:把「会话里已经确定的品类」带进去 —— 当句没说品类时用它,别掉回全店 */
  const ranked = (!named || named.priceMode !== 'fixed') ? pickByRank(text, items, contextType) : null
  const hit = (named && named.priceMode === 'fixed' && named.priceCents) ? named : (ranked ? ranked.top : null)
  if (!hit || hit.priceMode !== 'fixed' || !hit.priceCents) return null
  const facts = discountFacts(db, tenantId, money)
  const tail = (r, lang) => (r && r.second
    ? (lang === 'en' ? ` Next up is ${r.second.name} at ${money(r.second.priceCents)}.` : `其次是${r.second.name} ${money(r.second.priceCents)}。`)
    : '')
  const zh = fixedPriceSentence({ service: hit, discounts: facts.items, money, lang: 'zh' })
  if (!zh) return null
  return { source: 'fixed_price_direct', data: { intent: 'pricing', answerZh: zh + tail(ranked, 'zh'),
    answerEn: fixedPriceSentence({ service: hit, discounts: facts.items, money, lang: 'en' }) + tail(ranked, 'en'),
    handoffRequired: false } }
}


/** D165 · `quote` 项目问价时,把那半句放在采集问句**前面**:先答价这件事,再问表项。
 *  只看**当句**是不是在问价 —— `state.priceIntent` 是粘的,后面几轮会一直为真,
 *  拿它当条件的话每一轮都会重复贴一遍(现测见过)。 */
export function withQuotePriceLine(collectReply, { text = '', lang = 'zh', discounts = [] } = {}) {
  if (!/多少钱|什么价|价格|价位|报价|几多钱/.test(String(text))) return collectReply
  const line = quotePathDiscountLine(discounts, lang)
  const zh0 = collectReply?.data?.answerZh || ''
  if (!line || zh0.includes(line)) return collectReply
  return { ...collectReply, data: { ...collectReply.data, answerZh: `${line} ${zh0}`.trim() } }
}
