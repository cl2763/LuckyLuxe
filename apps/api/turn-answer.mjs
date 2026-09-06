/* D145 后半 · 「先答,再至多一问」—— 答从数据里来,不从模型嘴里来

   `turn-classify.mjs` 只回答「这一句是哪一档」;**这一件回答「那该说什么」**。
   两件分开是刻意的:分类可以纯函数逐句挨刀,取数要注入依赖 —— 混在一起就两头都不好验。

   ══ 四条,都走事实闸(05p §一 的表)══
   | 顾客说 | 答从哪来 | 取不到时 |
   |---|---|---|
   | 「大概要多久」 | 价目 `base_duration_min` | 知识库「时长」条目 → 都没有就「我帮您问技师」 |
   | 「预算不多能推荐吗」 | 本店价目按 `price_cents` 升序前 1–2 项(排除 `price_mode=quote`) | 「我帮您问技师」 |
   | 「会不会很快掉」等体验类 | 知识库条目(商家填的) | 「我帮您问技师」——**不转人工** |
   | 确认之后又说定金政策 | 会话级 `policyShownAt`,预约路与报价路共用 | 第二次只说「定金规则同上」 |

   ══ 一条贯穿的律 ══
   **取不到数就明说「我帮您问技师」,绝不编。**
   这既是《假数回落红线》(拿不到真值就如实说,不许回落到别的字段),
   也是这四条判据能证伪的地方:造病删掉知识库条目 → 必须回「问技师」,
   而不是回一句听起来很像的通用话术。

   ══ 语气(05p 补一:店主读完 18 条的评语「事实上没什么大问题,语气要温和一些、不要太正式」)══
   这里所有出句都按那条口径写:不用「您好!」开场、不堆「请问/请您」、口语、短。
   机器只排得掉明显的公文腔(判据在 `test-turn-answer` 里),像不像温和仍由店主打分。 */
import { cheapestItems, isQuoteItem, QUOTE_ONLY_TEXT } from './price-mode.mjs'

/* 「问时长」的形状 —— 与 turn-classify 的 QUESTION 不同:那个管「是不是在问」,这个管「在问哪一件」 */
const ASK_DURATION = /(多久|多长时间|要多少时间|几个小时|多少分钟|耗时|做完要|时间长不长)/
/* 体验类:效果能维持多久、疼不疼、伤不伤 —— 商家在知识库里填过就照答,没填就问技师 */
/* 🔴 首版写的是 `会?不会?掉` —— 它要求「掉」**紧跟**在「会不会」后面,
   而顾客说的是「会不会**很快就**掉」,中间隔着三个字,一次都没命中(判据 ①j 当场揪出)。
   改成允许中间隔几个字:`会不会[^,。!?]{0,8}掉`。这类「中间插了副词」的漏配是中文正则最常见的坑。 */
const ASK_EXPERIENCE = /(能维持|维持多久|持久|保持多久|掉不掉|会不会[^,,。!!??]{0,8}掉|多久[^,,。!!??]{0,4}掉|疼不疼|会不会疼|伤不伤|伤甲|伤眼|安全吗|敏感)/

export function createTurnAnswer(deps) {
  const { listItems, matchKb, money } = deps
  for (const [name, fn] of Object.entries(deps)) {
    if (typeof fn !== 'function') throw new Error(`createTurnAnswer 缺依赖或类型不对:${name}`)
  }

  /* 取不到数时统一这一句 —— **一处出口**,判据只认它 */
  const ASK_ARTIST = {
    zh: '这个我帮您问一下技师,回头给您准信儿~',
    en: "Let me check with the artist and get back to you."
  }

  /* ① 多久 —— 先看这一单已经对上的项目,没对上就看店里同类项目的时长范围 */
  function answerDuration({ serviceName = '', tenantId } = {}) {
    const items = listItems(tenantId).filter((i) => (i.item_kind || 'main') !== 'addon')
    const named = serviceName
      ? items.find((i) => String(i.name_zh || '').includes(serviceName) || serviceName.includes(String(i.name_zh || '')))
      : null
    const mins = Number(named?.base_duration_min || 0)
    if (mins > 0) {
      return { text: `${named.name_zh}大概 ${mins} 分钟左右哦。`, en: `${named.name_en || named.name_zh} takes about ${mins} minutes.`, source: 'price_list' }
    }
    /* 没对上具体项目:知识库里商家填过「时长」就用商家的话 */
    const kb = matchKb(tenantId, '时长 多久')
    if (kb) return { text: String(kb.answer_zh || '').trim(), en: String(kb.answer_en || '').trim(), source: 'kb' }
    /* 都没有:**报店里的真实范围**,这仍然是从库里来的数,不是编的 */
    const spans = items.map((i) => Number(i.base_duration_min || 0)).filter((x) => x > 0)
    if (spans.length) {
      const lo = Math.min(...spans)
      const hi = Math.max(...spans)
      // 只有一个项目时别说「90–90 分钟」——同一个数写两遍是机器味
      const span = lo === hi ? `${lo} 分钟左右` : `${lo}–${hi} 分钟`
      const spanEn = lo === hi ? `about ${lo} minutes` : `about ${lo}–${hi} minutes`
      return { text: `看做什么项目,店里的项目大概 ${span}。`, en: `Depends on the service — ours run ${spanEn}.`, source: 'price_list_range' }
    }
    return { text: ASK_ARTIST.zh, en: ASK_ARTIST.en, source: 'ask_artist' }
  }

  /* ② 预算 —— 最便宜的 1–2 项。金额走 `money()`(全仓金额唯一出口,拿不到币种回空串) */
  function answerCheapest({ tenantId } = {}) {
    const items = listItems(tenantId).filter((i) => (i.item_kind || 'main') !== 'addon')
    const picks = cheapestItems(items, 2)
    /* 🔴 金额拿不到就**整句不出** —— 宁可说「问技师」,也不出一个没有币种的裸数字(D140 同族) */
    const lines = picks
      .map((i) => ({ name: String(i.name_zh || ''), price: money(Number(i.price_cents || 0), tenantId) }))
      .filter((x) => x.name && x.price)
    if (!lines.length) return { text: ASK_ARTIST.zh, en: ASK_ARTIST.en, source: 'ask_artist' }
    const zh = lines.length === 1
      ? `我们这儿最实惠的是${lines[0].name} ${lines[0].price}。`
      : `我们这儿最实惠的是${lines[0].name} ${lines[0].price},其次是${lines[1].name} ${lines[1].price}。`
    const en = lines.map((x) => `${x.name} ${x.price}`).join(', ')
    return { text: zh, en: `Our most affordable options: ${en}.`, source: 'price_list', picks }
  }

  /* ③ 体验类 —— 商家在知识库填过就答,没填就问技师。**一个「人工」都不许出** */
  function answerExperience({ text = '', tenantId } = {}) {
    const kb = matchKb(tenantId, text)
    if (kb) return { text: String(kb.answer_zh || '').trim(), en: String(kb.answer_en || '').trim(), source: 'kb' }
    return { text: ASK_ARTIST.zh, en: ASK_ARTIST.en, source: 'ask_artist' }
  }

  /* 派发:分类给了档,这里给句子。回 null = 这一档不归我答(调用方照原流程走)。 */
  function answerForTurn(kind, ctx = {}) {
    const t = String(ctx.text || '')
    if (kind === 'budget') return answerCheapest(ctx)
    if (kind !== 'question') return null
    /* 🔴 体验类**排在时长前面**:「能维持多久」两条都命中,但顾客问的是「做完能撑多久」,
       不是「做这个要坐多久」。先判时长会把它答成工时,答非所问换了个花样而已。 */
    if (ASK_EXPERIENCE.test(t)) return answerExperience(ctx)
    if (ASK_DURATION.test(t)) return answerDuration(ctx)
    return null
  }

  return { answerForTurn, answerDuration, answerCheapest, answerExperience, ASK_ARTIST }
}

/* ── 政策一会话一次(05p §一 第四条)────────────────────────────
   案底:通三顾客说「好的,就这个时间」,机器把定金政策**整段又说了一遍**。
   病 5 治的是报价路,预约路没落。这里做成**与路无关**的一个小闸:
   谁要出政策原文,先问一句「这个会话说过没有」。

   判据形状:同一会话政策原文第二次 **0 命中**,且第二次出的是「定金规则同上」。
   注意判「说过没有」,不判「上次说的还在不在上下文里」——《幂等判据律》同一条:
   会被别的正常操作改掉的量,不能当判据。 */
export const POLICY_AGAIN_TEXT = { zh: '定金规则同上哦~', en: 'Deposit terms are the same as above.' }

export function policyOnce(state = {}) {
  const shown = Boolean(String(state.policyShownAt || '').trim())
  return {
    shown,
    /* 调用方拿它决定说全文还是说「同上」;`patch` 合进 statePatch 即可 */
    patch: shown ? {} : { policyShownAt: new Date().toISOString() },
    text: shown ? POLICY_AGAIN_TEXT.zh : '',
    textEn: shown ? POLICY_AGAIN_TEXT.en : ''
  }
}

export { isQuoteItem, QUOTE_ONLY_TEXT }
