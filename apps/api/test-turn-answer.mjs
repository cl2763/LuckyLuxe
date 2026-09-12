/* D145 后半常驻套件 —— 「先答,再至多一问」的**答**对不对(05p §一 那张表逐行)

   与 `test-turn-classify` 的分工:那一把验「这句是哪一档」,这一把验「那一档答了什么」。
   分类对了、答错了,顾客看到的照样是答非所问 —— 所以两把都要。

   三层:
   ① 单元层:注入假价目/假知识库,答案能逐字锚死(最快、最能证伪);
   ② 行为层:自己建一家店、写进已知的价目,真接口喂那几句 —— 数字必须与库里一致;
   ③ 造病层:把知识库条目拿走 / 把最便宜那项标成 `price_mode='quote'`,判据必须红。

   贯穿的那条律:**取不到数就说「我帮您问技师」,绝不编**。
   所以每一条正向判据都配一条「没有数据时不许出数字」的反向判据。 */
import { assertTestTarget } from './test-guard.mjs'
import { createTurnAnswer, policyOnce, POLICY_AGAIN_TEXT } from './turn-answer.mjs'
import { cheapestItems, isQuoteItem, normalizePriceMode } from './price-mode.mjs'
import { buildKnowledgeContext, TONE_GUIDE, TONE_GUIDE_EN } from './kb-utils.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.OWNER_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
async function request(path, options = {}, token = PLATFORM, tid = '') {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(tid ? { 'x-admin-tenant-id': tid } : {}),
      ...(options.headers || {})
    }
  })
  let data = null
  try { data = await r.json() } catch { data = null }
  return { status: r.status, data }
}

/* ══ ① 单元层:假价目 / 假知识库 ══════════════════════════════ */
const ITEMS = [
  { name_zh: '试甲甲', item_kind: 'main', price_cents: 29800, base_duration_min: 90, price_mode: 'fixed' },
  { name_zh: '试甲乙', item_kind: 'main', price_cents: 19800, base_duration_min: 60, price_mode: 'fixed' },
  { name_zh: '试定制', item_kind: 'main', price_cents: 100, base_duration_min: 200, price_mode: 'quote' },
  { name_zh: '试加项', item_kind: 'addon', price_cents: 100, base_duration_min: 0, price_mode: 'fixed' }
]
const KB = [{ keywords: '维持,掉,多久掉', answer_zh: '一般三到四周,看护理。', answer_en: 'About 3-4 weeks.' }]
const mk = ({ items = ITEMS, kb = KB, money = ((c) => `¥${c / 100}`) } = {}) => createTurnAnswer({
  listItems: () => items,
  matchKb: (_t, text) => kb.find((r) => String(r.keywords || '').split(',').some((k) => k && String(text).includes(k))) || null,
  money: (c) => money(c)
})

{
  const A = mk()
  const dur = A.answerDuration({ serviceName: '试甲甲' })
  check('①a 时长:对上项目 → 报**那个项目的** base_duration_min(90),不是别的项目的',
    dur.text.includes('90') && dur.source === 'price_list', JSON.stringify(dur))
  const durAny = A.answerDuration({ serviceName: '' })
  check('①b 时长:没对上具体项目 → 报店里真实范围 60–200(仍是库里的数,不是编的)',
    durAny.text.includes('60') && durAny.text.includes('200'), JSON.stringify(durAny))
  const durNone = mk({ items: [], kb: [] }).answerDuration({ serviceName: '' })
  check('①c 🔴 时长:一条数据都没有 → **说「问技师」,不出任何数字**',
    durNone.source === 'ask_artist' && !/\d/.test(durNone.text), JSON.stringify(durNone))

  const cheap = A.answerCheapest({})
  check('①d 预算:最便宜的是「试甲乙 ¥198」(按 price_cents 升序,不看三档价)',
    cheap.text.includes('试甲乙') && cheap.text.includes('¥198'), cheap.text)
  check('①e 🔴 预算:**`price_mode=quote` 的项不许参与排序**(试定制只要 ¥1,却压根没有价可比)',
    !cheap.text.includes('试定制'), cheap.text)
  check('①f 预算:加项不进推荐(顾客问的是做什么项目,不是加什么)',
    !cheap.text.includes('试加项'), cheap.text)
  /* D145 尾巴(五通 v3 通二:连问两句预算,机器一字不差重复同一句)。
     函数这一层已经会换说法了 —— 但**调用方还喂不进 `lastReply`**(报价路那份 state 里取不到
     上一句我们说的话,两种取法都试过、都取不到)。所以这条**只到函数层**,
     行为层仍会重复,如实登记在回执残留里,不假装修好了。 */
  const firstSay = A.answerCheapest({}).text
  const againSay = A.answerCheapest({ lastReply: firstSay }).text
  check('①k D145 尾巴(函数层):上一句已经点过那个项目名 → 换个说法,不一字不差重复',
    againSay !== firstSay && againSay.includes('试甲乙'), `${firstSay} || ${againSay}`)
  check('①l 反向守:上一句没点过 → 照常说完整那句(别为了不重复把话说短了)',
    A.answerCheapest({ lastReply: '随便一句别的话' }).text === firstSay)

  const cheapNoMoney = mk({ money: () => '' }).answerCheapest({})
  check('①g 🔴 预算:金额出口回空串(没配币种)→ **整句改成「问技师」,不出裸数字**',
    cheapNoMoney.source === 'ask_artist', cheapNoMoney.text)

  const exp = A.answerExperience({ text: '会不会很快就掉' })
  check('①h 体验:知识库有条目 → 用商家自己的话', exp.text.includes('三到四周') && exp.source === 'kb', exp.text)
  const expNone = mk({ kb: [] }).answerExperience({ text: '会不会很快就掉' })
  check('①i 🔴 体验:知识库没条目 → 说「问技师」,而且**一个「人工」都不许出**',
    expNone.source === 'ask_artist' && !expNone.text.includes('人工'), expNone.text)

  check('①j 派发:budget → 最便宜;question+多久 → 时长;question+体验 → 知识库;其余回 null(让开)',
    A.answerForTurn('budget', {})?.source === 'price_list'
    && ['price_list', 'price_list_range'].includes(A.answerForTurn('question', { text: '大概要多久' })?.source)
    && A.answerForTurn('question', { text: '会不会很快就掉' })?.source === 'kb'
    && A.answerForTurn('question', { text: '你们几个人' }) === null
    && A.answerForTurn('farewell', { text: '谢谢' }) === null)
}

/* ══ 政策一会话一次 ══════════════════════════════════════════ */
{
  const first = policyOnce({})
  check('②a 政策第一次:`shown=false`,并给出「记一笔」的 patch(不留痕就等于没数)',
    first.shown === false && Boolean(first.patch.policyShownAt), JSON.stringify(first))
  const second = policyOnce({ policyShownAt: first.patch.policyShownAt })
  check('②b 🔴 政策第二次:`shown=true`,出的是「定金规则同上」,**不再是整段原文**',
    second.shown === true && second.text === POLICY_AGAIN_TEXT.zh, JSON.stringify(second))
  check('②c 幂等判据律:判的是「说过没有」,不是「上次那句还在不在上下文里」',
    policyOnce({ policyShownAt: '2020-01-01T00:00:00.000Z' }).shown === true)
}

/* ══ D146 price_mode 归一 ═══════════════════════════════════ */
{
  check('③a 归一 fail-closed:只有明写 quote 才是 quote(空/乱值/undefined 一律 fixed)',
    normalizePriceMode('quote') === 'quote' && normalizePriceMode('QUOTE') === 'quote'
    && ['', null, undefined, 'x', 0].every((v) => normalizePriceMode(v) === 'fixed'))
  check('③b 两种命名都认(库行 price_mode / 序列化后 priceMode)',
    isQuoteItem({ price_mode: 'quote' }) && isQuoteItem({ priceMode: 'quote' }) && !isQuoteItem({}))
  check('③c 同价时按名字定序(不定序判据就抓不稳)',
    cheapestItems([{ name_zh: 'B', price_cents: 100 }, { name_zh: 'A', price_cents: 100 }], 1)[0].name_zh === 'A')
}

/* ══ ② 行为层:自建一家店,数字必须与库里一致 ══════════════════ */
const TID = `ta-${RUN}`
const made = await request('/platform/tenants', {
  method: 'POST',
  body: JSON.stringify({ id: TID, name: `答句店${RUN}`, plan: 'chain', currency: 'CNY', timezone: 'Asia/Shanghai', city: `测试路 ${RUN}` })
})
check('④0 造景:建店成功(造不出来按红,不许「造不出来就当过了」)', made.status === 201, `status=${made.status}`)
if (made.status === 201) {
  await request('/admin/tenant/entitlements', { method: 'POST', body: JSON.stringify({}) }, PLATFORM, TID)
  await request('/admin/tenant/entitlements', {
    method: 'PUT', body: JSON.stringify({ feature: 'ai_customer_service', enabled: true })
  }, PLATFORM, TID)
  const cat = (await request('/admin/pricing/categories', {}, PLATFORM, TID)).data?.categories?.[0]
  const mkItem = (nameZh, cents, mins) => request('/admin/pricing/items', {
    method: 'POST',
    body: JSON.stringify({ nameZh, nameEn: nameZh, type: 'NAIL', itemKind: 'main', categoryId: cat?.id, unit: 'once',
      listPriceCents: cents, baseDurationMin: mins, depositCents: 0, isActive: true })
  }, PLATFORM, TID)
  await mkItem(`便宜款${RUN}`, 12800, 60)
  await mkItem(`贵款${RUN}`, 88800, 180)
  const chat = async (uid, message) => (await request('/admin/wechat/mock-chat-message', {
    method: 'POST', body: JSON.stringify({ externalUserId: uid, message })
  }, PLATFORM, TID)).data
  const sayOf = (d) => String(d?.reply?.data?.answerZh || '')

  const uid = `ta-b-${RUN}`
  await chat(uid, '我想做美甲')
  const budget = sayOf(await chat(uid, '预算不多,能推荐吗'))
  check('④a 🔴 预算:回复里出现**库里那个最便宜项的名字与价**(¥128,不是 ¥888)',
    budget.includes(`便宜款${RUN}`) && budget.includes('128'), budget.slice(0, 120))
  check('④b 🔴 境内店金额是 **¥**,不是 $ / CAD(币种红线)',
    /[¥￥]/.test(budget) && !/CAD|\$/.test(budget), budget.slice(0, 120))
  check('④c 先答**再至多一问**:整句里问号 ≤ 1(答完只许再问一格)',
    (budget.match(/[??]/g) || []).length <= 1, budget.slice(0, 140))

  const uid2 = `ta-d-${RUN}`
  await chat(uid2, '我想做美甲')
  const dur = sayOf(await chat(uid2, '大概要多久'))
  check('④d 🔴 时长:回复里的数字来自库(60 或 180 或它们组成的范围),不是编的',
    /60|180/.test(dur), dur.slice(0, 120))

  /* 语气(05p 补一:店主「语气要温和一些、不要太正式」)——
     机器只排得掉明显的公文腔,像不像温和由店主打分。 */
  for (const [label, txt] of [['预算句', budget], ['时长句', dur]]) {
    check(`④e 语气·${label}:不以「您好!」「尊敬的」开场,且「请问」≤1 次`,
      !/^\s*(您好[!!]|尊敬的|亲爱的用户)/.test(txt) && (txt.match(/请问/g) || []).length <= 1,
      txt.slice(0, 100))
  }

  /* ══ ③ 造病层:把最便宜那项标成 quote → 推荐必须换人 ══ */
  const items = (await request('/admin/pricing/items', {}, PLATFORM, TID)).data?.items || []
  const cheapItem = items.find((i) => i.nameZh === `便宜款${RUN}`)
  check('⑤0 造病前置:找得到那一项(找不到=下面的刀没落下去,不算验过)', Boolean(cheapItem), `items=${items.length}`)
  if (cheapItem) {
    console.log(`   [刀] 注入=把「便宜款${RUN}」标成 price_mode=quote(它就不该再出现在「最便宜」里)`)
    const patched = await request(`/admin/pricing/items/${cheapItem.id}`, {
      method: 'PATCH', body: JSON.stringify({ priceMode: 'quote' })
    }, PLATFORM, TID)
    check('⑤a 刀落得下去:接口收得下 priceMode=quote(收不下说明 D146 那一列没接通)',
      [200, 201].includes(patched.status) && patched.data?.item?.priceMode === 'quote',
      `status=${patched.status} 回 ${JSON.stringify(patched.data?.item?.priceMode)}`)
    /* 🔴 D146 的另一半:**发给模型的价目里,需报价的项不许带价格**。
       只把它从「最便宜」里挑掉不够 —— 事实闸看到 `price: 0` 就有据可依地报「¥0」。 */
    const facts = (await request('/admin/kb', {}, PLATFORM, TID)).data
    const listed = ((facts?.liveFacts?.priceList?.items) || []).find((x) => x.nameZh === `便宜款${RUN}`)
    check('⑤a2 造病前置:那一项在发给模型的价目里找得到(找不到 = 下面两条什么都没验)',
      Boolean(listed), JSON.stringify((facts?.liveFacts?.priceList?.items || []).map((x) => x.nameZh)).slice(0, 120))
    check('⑤a3 🔴 需报价的项**整个 price 字段都不下发**(不是下发 0)',
      listed ? listed.price === undefined : false, JSON.stringify(listed))
    check('⑤a4 反向守:它得有一句话说明为什么没价(只是没价 = 模型会自己猜)',
      listed ? /技师|报价/.test(String(listed.priceNote || '')) : false, JSON.stringify(listed?.priceNote))

    const uid3 = `ta-k-${RUN}`
    await chat(uid3, '我想做美甲')
    const after = sayOf(await chat(uid3, '预算不多,能推荐吗'))
    check('⑤b 🔴 刀落下后:「最便宜」里**不许再有它**,改报下一个有价的',
      !after.includes(`便宜款${RUN}`), after.slice(0, 120))
    await request(`/admin/pricing/items/${cheapItem.id}`, {
      method: 'PATCH', body: JSON.stringify({ priceMode: 'fixed' })
    }, PLATFORM, TID)
    console.log('   [刀] 已还原')
    const uid4 = `ta-r-${RUN}`
    await chat(uid4, '我想做美甲')
    const back = sayOf(await chat(uid4, '预算不多,能推荐吗'))
    check('⑤c 还原后立刻回绿(刀不许留在库里)', back.includes(`便宜款${RUN}`), back.slice(0, 120))
  }
}

/* ══ ⑥ 语气(05p 补一:店主亲审 18 条后的口径「温和一些、不要太正式」)══
   机器只排得掉明显的公文腔;像不像温和由店主打分。这里两层:
   ① 静态:口吻那一条**真的进了发给模型的提示词**(不在提示词里 = 等于没这条规矩);
   ② 造病:把它从提示词里拿掉 → ① 必须红(拿不掉说明我验的根本不是那一处)。 */
{
  const ctx = buildKnowledgeContext({ message: '你们几点开门' })
  check('⑥a 口吻条真的在发给模型的中文提示词里(且摆在开头的自然语言里,不是埋在 JSON 字段中)',
    String(ctx.promptTextZh || '').includes(TONE_GUIDE)
    && String(ctx.promptTextZh || '').indexOf(TONE_GUIDE) < 200,
    String(ctx.promptTextZh || '').slice(0, 80))
  check('⑥b 英文提示词同样带口吻条(两语一处真相,别只治中文)',
    String(ctx.promptTextEn || '').includes(TONE_GUIDE_EN))
  check('⑥c 三店共用同一条,**不带店名**(它讲的是怎么说话,不是你是哪家店)',
    !/LUVIA|半径|Jic|小婕|北京旗舰/.test(TONE_GUIDE), TONE_GUIDE)
  console.log('   [刀] 注入=把口吻条从提示词里抠掉(模拟「这条规矩没写进去」)')
  const stripped = String(ctx.promptTextZh || '').replace(TONE_GUIDE, '')
  check('⑥d 🔴 刀落下去:抠掉之后 ⑥a 那条判据必须红 —— 不红说明我验的不是那一处',
    !stripped.includes(TONE_GUIDE))
  console.log('   [刀] 已还原(只动了本地副本,提示词本身没碰)')
}

console.log(`\n[D145 后半] 时长/预算/体验三条答从库来 · 取不到就问技师 · 政策一会话一次 · `
  + `D146 quote 不进推荐(造病验红)· 语气不公文腔`)
if (fails.length) {
  console.error(`\n❌ test-turn-answer ${fails.length}/${n} 项未过`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`\n✅ test-turn-answer 通过 ${n} 项`)
