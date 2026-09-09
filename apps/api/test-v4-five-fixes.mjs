/* 05s §四 · 六通 v4 读出来的五病 + §二 D152 正面(店主 2026-09-08)

   五病都是**同一类**:机器把话说完了,却没说到顾客问的那件事上 ——
   要么答非所问(D158/D162)、要么答完还追着问表项(D159)、
   要么合并了却没答全(D160)、要么把告别当新问题(D161)。

   本刀两层:
   ① **纯函数逐句对** —— 出句的规矩都在模块里,喂进去比字;
   ② **行为层**(要测试库)—— 真发一句,看引擎走的是哪条路、答出来的是哪一句。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget, isTestTarget } from './test-guard.mjs'
import { answered, reaskText, repeatPre, sameTopic } from './repeat-guard.mjs'
import { farewellText, hygiene, isFarewell, stripIntakeTail } from './reply-hygiene.mjs'
import { bestDiscount, fixedPriceSentence, matchService, pickByRank, quotePathDiscountLine } from './fixed-price-reply.mjs'
import { availabilityAnswer, classifyInterrupt, discountAnswer, durationAnswer, fullBooked, intakeInterruptDeps, pendingQuestion, resumeText, withResume } from './intake-interrupt.mjs'
import { fixWeekdays } from './date-human.mjs'
import { dedupeTail } from './reply-hygiene.mjs'
import { applyRepeatGuard } from './repeat-guard.mjs'
import { looksConfirm } from './booking-intake.mjs'
import { depositBrief } from './deposit-brief.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const money = (c) => `¥${(c / 100).toFixed(0)}`

/* ═══ D158 · D150 误伤:同一档 ≠ 同一件事 ═══
   v4 通二原文:「那个最便宜的是哪种」被当成复读,换成一句空话。 */
check('D158 ①「大概要多久」与「那个最便宜的是哪种」**不算同一件事**',
  sameTopic('大概要多久', '那个最便宜的是哪种') === false)
check('D158 ①b 真正同一件事仍然认得出来', sameTopic('做美睫多少钱', '美睫价格多少') === true)
check('D158 ② 上一答**本来就是个反问**时,顾客再问不算复读',
  answered('您最在意的是价格、时间,还是效果呢?') === false)
check('D158 ②b 上一答给了数字才算「答过」', answered('裸感自然睫 ¥198,大概 120 分钟') === true)
check('D158 ③ 🔴 换答法**必须仍然带着上一答**,不许把答案换成一句反问',
  reaskText('zh', '裸感自然睫 ¥198').startsWith('裸感自然睫 ¥198')
  && reaskText('zh', '裸感自然睫 ¥198').includes('最在意'),
  reaskText('zh', '裸感自然睫 ¥198'))

/* 🔴 K26 咬出来的判据缺口(刀落了却没红):上面几条验的是**纯函数**,
   而病在**接线**上 —— 把 `repeatPre` 里那句 `if (!sameTopic(...)) break` 删掉,
   纯函数照样对、判据照样绿。所以这里直接**跑 `repeatPre`**,用一个假 db 喂历史。
   判据律:验的必须是「病存在时会红」的那一层。 */
const fakeDb = (customerRows, assistantRows) => ({
  prepare: (sql) => ({
    all: () => (/role = 'assistant'/.test(sql) ? assistantRows : customerRows),
    get: () => (/role = 'assistant'/.test(sql) ? assistantRows[0] : customerRows[0]),
  }),
})
/* 🔴 两句必须**同一档**,不然断在档上、`sameTopic` 根本没被问到 ——
   第一版夹具就是这么白跑的:一句 question 一句 budget,刀落了判据照样绿。
   这里两句都判成 question,分不分得开只剩 `sameTopic` 说了算。 */
const kindOf = () => 'question'
check('D158 ④ 🔴 接线层:同档但换了话题 → run 回到 1(不再当复读)',
  repeatPre({ db: fakeDb([{ content: '大概要多久' }], [{ id: 'a1', content: '120 分钟' }]),
    conversationId: 'c', tenantId: 't', text: '你们几点关门', classifyTurn: kindOf }).run === 1)
check('D158 ④b 接线层:真的同一件事连着问 → run 累加(守还在)',
  repeatPre({ db: fakeDb([{ content: '做美睫多少钱' }], [{ id: 'a1', content: '裸感自然睫 198,大概 120 分钟' }]),
    conversationId: 'c', tenantId: 't', text: '美睫价格多少', classifyTurn: kindOf }).run === 2)

/* ═══ D159 · 答完不许再追着问表项 ═══ */
check('D159 ① 转人工句后面拼的采集问句被砍掉',
  stripIntakeTail('这个我帮您问一下技师~ 请问这次是否需要下睫毛服务?').text === '这个我帮您问一下技师~')
check('D159 ② 事实答句(带数字)后面的采集问句也砍',
  stripIntakeTail('120–150 分钟。 请问是否需要卸甲?').cut === true)
check('D159 ③ 🔴 反向守:**本来就只是一句采集问句**的,一个字都不许动',
  stripIntakeTail('请问这次是否需要卸甲?').cut === false)
check('D159 ④ 反向守:普通答句没有尾巴时不动它',
  stripIntakeTail('我们家周二到周日 10:00–19:00 营业。').cut === false)

/* ═══ D161 · 待人工态下的告别 ═══ */
check('D161 ①「谢谢」认得出是告别', isFarewell('谢谢') && isFarewell('好的谢谢') && isFarewell('bye'))
check('D161 ②「谢谢,那定金多少?」**不是**告别(带问号)', isFarewell('谢谢,那定金多少?') === false)
check('D161 ③ 🔴 待人工态 + 顾客告别 → 回告别句,**不再重复转人工**',
  (() => { const h = hygiene({ text: '这个我帮您问一下,确认清楚再回复您', customerText: '谢谢', status: 'needs_human' })
    return h.why === 'farewell-in-handoff' && h.text === farewellText('zh') && !/问一下/.test(h.text) })())
check('D161 ④ 反向守:不是待人工态就不改(正常聊天里说谢谢照常走)',
  hygiene({ text: '好的~', customerText: '谢谢', status: 'ai_replied' }).why === '')

/* ═══ D152 正面 · fixed 项目直接报价(§二 裁待裁 #8)═══ */
const svc = { id: 's1', name: '精致单色', priceCents: 29800, priceMode: 'fixed', durationMin: 90 }
const coup = [{ name: '新客首单立减 50', off: '立减 ¥50', minSpend: 0 }]
check('D152 ① 命中项目名', matchService('精致单色多少钱?', [svc]).id === 's1')
check('D152 ①b 去掉修饰也命中(「单色」→「精致单色」)', matchService('单色多少钱', [svc]) !== null)
check('D152 ② 🔴 三段顺序:折扣 → 原价 → 折后价,数字对得上账',
  (() => { const s = fixedPriceSentence({ service: svc, discounts: coup, money })
    return s.indexOf('立减') < s.indexOf('原价') && s.indexOf('原价') < s.indexOf('券后')
      && s.includes('¥298') && s.includes('¥248') })(),
  fixedPriceSentence({ service: svc, discounts: coup, money }))
check('D152 ③ 🔴 无券只说原价,**一个「券」字都不出现**',
  (() => { const s = fixedPriceSentence({ service: svc, discounts: [], money })
    return s.includes('¥298') && !/券|折扣|优惠|折后/.test(s) })(),
  fixedPriceSentence({ service: svc, discounts: [], money }))
check('D152 ④ 门槛够不着的券**不算**(满 300 减 50 用不到 ¥298 的单上)',
  bestDiscount(29800, [{ name: '满300减50', off: '立减 ¥50', minSpend: 30000 }]) === null)
check('D152 ⑤ 折后价算不准就不给(off 解不出数额时不返回)',
  bestDiscount(29800, [{ name: '神秘券', off: '看心情', minSpend: 0 }]) === null)
check('D152 ⑥ `quote` 那条路只说有券、**不出数字**',
  (() => { const s = quotePathDiscountLine(coup)
    return s.includes('新客首单立减 50') && !/\d+\s*元|¥\s*\d{2,}/.test(s.replace('立减 ¥50', '')) })(),
  quotePathDiscountLine(coup))

/* ═══ 05s 补一 §二 · 店主在北京店当顾客亲测出来的两处 ═══ */
const pool = [
  { id: 'n1', name: '精致单色', priceCents: 29800, priceMode: 'fixed', durationMin: 90, type: 'NAIL' },
  { id: 'n2', name: '猫眼渐变', priceCents: 39800, priceMode: 'fixed', durationMin: 120, type: 'NAIL' },
  { id: 'l1', name: '单根嫁接', priceCents: 19800, priceMode: 'fixed', durationMin: 120, type: 'LASH' },
  { id: 'q1', name: '手绘定制', priceCents: 69800, priceMode: 'quote', durationMin: 150, type: 'NAIL' },
]
check('补一①  🔴「最便宜的美甲」挑的是**美甲里**最便宜那个(不许把美睫的价报过去)',
  (() => { const r = pickByRank('你们最便宜的美甲多少钱', pool); return r && r.top.id === 'n1' && r.second.id === 'n2' })(),
  JSON.stringify(pickByRank('你们最便宜的美甲多少钱', pool)))
check('补一①b 不带大类词时在全部 fixed 里挑最便宜',
  pickByRank('最便宜的多少钱', pool)?.top?.id === 'l1')
check('补一①c 「最贵的」挑另一头', pickByRank('最贵的美甲多少钱', pool)?.top?.id === 'n2')
check('补一①d 🔴 `quote` 项目**不许**被挑中(它的价格根本没下发模型)',
  pickByRank('最贵的美甲多少钱', pool)?.top?.priceMode === 'fixed')
check('补一①e 不是「最…」的问法就不走这条路(别抢点名那一路)',
  pickByRank('精致单色多少钱', pool) === null)
check('补一② 🔴 店主亲测那句原文:价格答完拼的采集问句被砍掉',
  stripIntakeTail('我们这儿最实惠的是精致单色 ¥298,其次是猫眼渐变 ¥398。 请问这款是做本甲还是需要延长?').cut === true)
/* 🔴 全半角:现测栽过一次 —— 文件里的全角标点在编辑中变成了半角,`？`(U+FF1F) 根本不匹配,
   于是合并那条回复的采集尾巴照样发出去。这两条专守这件事。 */
check('补一②b 全角问号收尾的采集尾巴也砍(U+FF1F)',
  stripIntakeTail('周二至周日20:00关门。预约定金¥50。停车挺方便。想约哪天做指甲还是睫毛呀\uff1f').cut === true)
check('补一②c 全角问号的「谢谢?」不算告别(带问号就是在问)',
  isFarewell('谢谢\uff1f') === false)

/* ═══ D162 + D157 · 采集中断口(店主 05s 补二 §三 裁待裁 #10)═══ */
check('D162 ① 三类各认得出来',
  classifyInterrupt('明天下午三点有位吗') === 'availability'
  && classifyInterrupt('有优惠吗') === 'discount'
  && classifyInterrupt('大概要多久') === 'duration')
check('D162 ①b 不是这三类就不抢(回 null,原流程照旧)',
  classifyInterrupt('我想做美甲') === null && classifyInterrupt('好的') === null)
check('D162 ② 🔴 答完把采集问句**原样**接回去(不重写那一句)',
  resumeText('现在有「新客券」立减 ¥50。', '请问是否需要卸甲?') === '现在有「新客券」立减 ¥50。 那我们接着说,请问是否需要卸甲?')
check('D162 ②b 没答出来就不接(空答案不许硬凑一句)', resumeText('', '请问是否需要卸甲?') === '')
/* 🔴 可约:**只许报 `getAvailability` 返回的时段**。这里用一个假的查询口喂各种返回,
   验的是「它照着回的什么说」——编时段的话这几条会当场红。 */
const availDeps = (res) => ({ getAvailability: () => res, storeId: 's', serviceId: 'v', date: '2026-09-09',
  humanDate: (d) => d, todayISO: '2026-09-08' })
check('D162 ③ 有位:报的是**它返回的那两个时段**',
  availabilityAnswer({ ...availDeps({ closed: false, slots: [{ technician: {}, slots: ['10:00', '10:30', '11:00'] }] }) })
    === '2026-09-09还有 10:00、10:30 有位。')
check('D162 ③b 🔴 时段是**按技师分组**的,不是一维表 —— 切错了会切出乱码(现测栽过)',
  !/ect\]/.test(availabilityAnswer({ ...availDeps({ closed: false, slots: [{ technician: {}, slots: ['10:00'] }] }) })))
check('D162 ③c 没位 → 说没位 + **两个真替代**(替代也来自同一个真函数)',
  (() => { let n = 0
    const dep = { getAvailability: () => (n++ === 0 ? { closed: false, slots: [] } : { closed: false, slots: [{ slots: ['16:30'] }] }),
      storeId: 's', serviceId: 'v', date: '2026-09-09', humanDate: (d) => d, todayISO: '2026-09-08' }
    const t = availabilityAnswer(dep)
    return t.includes('已经约满') && t.includes('最近有位的是') && t.includes('16:30') })())
check('D162 ③d 店休 → 说店休(不许说成「约满」,一句一因)',
  availabilityAnswer({ ...availDeps({ closed: true, slots: [] }) }).includes('门店休息'))
check('D162 ④ 优惠:有券说券名,没券**说没有**(不许编一个)',
  discountAnswer({ hasAny: true, items: [{ name: '新客券', off: '立减 ¥50' }] }).includes('新客券')
  && discountAnswer({ hasAny: false, items: [] }).includes('没有'))
check('D162 ⑤ 🔴 时长:点了名就用那一个项目的时长(不许拿别的项目顶)',
  durationAnswer({ name: '精致单色', durationMin: 90 }).includes('90'))
/* ═══ D166(店主 05s 补四 那四轮的**真出口**,05t 段 5 定位到行)═══
   顾客说的「手绘定制」在价目表里没有这个名字(北京店叫「参考图定制款」)——
   于是「点名」这条走不通,旧写法回空串让开,这一轮掉进报价采集模板:
   答了**跨大类的 90–180 分钟**,还另起一个新问题(而上一问根本没答)。
   裁:点不了名就答**采集里已定的那个大类**的真实区间,再把待答那句原样接回。 */
check('D166 ① 点不了名 + 没有大类 → 仍然不答(不许拿全店范围顶上;零编造)',
  durationAnswer({ name: '', durationMin: 0 }, 'zh', null) === '')
check('D166 ② 点不了名但采集已定大类 → 答**该大类**的真实区间',
  durationAnswer({ name: '' }, 'zh', { mins: [90, 120, 150], label: '美甲' }) === '美甲的项目大概 90–150 分钟。')
check('D166 ③ 大类里只有一个时长 → 不说「90–90」(同一个数写两遍是机器味)',
  durationAnswer({ name: '' }, 'zh', { mins: [90], label: '美睫' }).includes('90 分钟左右'))
check('D166 ④ 点了名优先于大类区间(名字在,就不该退回范围)',
  durationAnswer({ name: '猫眼渐变', durationMin: 100 }, 'zh', { mins: [90, 180], label: '美甲' }).includes('猫眼渐变'))
check('D166 ⑤ 大类只认 NAIL/LASH,别的类型不给区间(不确定还报范围 = 又一次答非所问)',
  (() => {
    const deps = intakeInterruptDeps({ db: { prepare: () => ({ all: () => [
      { id: 's1', name_zh: '甲', base_duration_min: 90, price_mode: 'fixed', type: 'NAIL' },
      { id: 's2', name_zh: '睫', base_duration_min: 60, price_mode: 'fixed', type: 'LASH' },
    ] }) }, tenantId: 't', today: '2026-09-09', getAvailability: () => ({}), humanDate: () => '',
      discountFacts: () => ({}), matchService: () => null, parseBookingDate: () => '', formatMoneyCents: () => '',
      firstActiveStoreId: () => 's', firstActiveService: () => ({ id: 'x' }), serviceType: 'care' })
    return deps.scopedRange() === null
  })())
/* D164 之后 `withResume` 多收一个「待答那句」参数(它不再从模板里猜),这条跟着改口径:
   仍然守「其它字段原样保留」,但接回那句由调用方给。 */
check('D162 ⑥ 合成时保留原 reply 的其它字段,只换文本那一格',
  (() => { const r = withResume({ source: 'collect_template', data: { intent: 'x', answerZh: '请问是否需要卸甲?' } },
    { kind: 'discount', answer: '现在有「新客券」立减 ¥50。' }, 'zh', '请问是否需要卸甲?')
    return r.data.intent === 'x' && r.source.includes('interrupt_discount') && r.data.answerZh.includes('那我们接着说') })())

/* ═══ D173(店主 05v 补三 §二 §三)· v5 通三那三行当夹具 ═══
   89 行「明天(9月9日,周三)」· 93 行「9月9日(周一)门店休息」· 97 行 顾客确认句被吞。 */
check('D173 上① 出口把写错的星期改成算出来的那个(不是删掉整句 —— 顾客要拿它对日历)',
  (() => { const r = hygiene({ text: '9月9日(周一) 门店休息哦,换一天好吗?', customerText: '下午三点',
    status: 'ai_replied', lang: 'zh', source: 'booking_intake', todayISO: '2026-09-08' })
    return r.text.includes('9月9日(周三)') && /weekday-fixed/.test(r.why) })())
check('D173 上② 对的那句一个字不动',
  hygiene({ text: '好的,明天(9月9日,周三) 可以。', customerText: '明天', status: 'ai_replied',
    lang: 'zh', source: 'x', todayISO: '2026-09-08' }).text === '好的,明天(9月9日,周三) 可以。')
check('D173 上③ 这条不认 ISO 形状 —— 模型自己写的那种也咬得住(v5 那个洞就在这儿)',
  fixWeekdays('9月9日(周一)门店休息', '2026-09-08').fixed.length === 1
  && fixWeekdays('2026-09-09 门店休息', '2026-09-08').fixed.length === 0)
check('D173 上④ ISO 日期在**出口**也变人话(原来只挂在 booking-intake 一条路上)',
  hygiene({ text: '好的,2026-09-12 可以。', customerText: '周六', status: 'ai_replied',
    lang: 'zh', source: 'x', todayISO: '2026-09-08' }).text.includes('这周六(9月12日)'))
check('D173 下① 店休那句自带两个真替代日(走的是中断口那份 fullBooked,同一份实现)',
  (() => {
    const av = ({ date }) => ({ closed: date === '2026-09-09', slots: [{ technician: 'A', slots: ['10:00', '11:00'] }] })
    const r = fullBooked('9月9日(周三)', { getAvailability: av, storeId: 's', serviceId: 'x',
      date: '2026-09-09', humanDate: (d) => d, todayISO: '2026-09-08' }, 'zh', true)
    return String(r).includes('门店休息') && (r.alts || []).length === 2 })())
check('D173 下② 替代日**带得出来**(存进状态,下一句确认时不许现编)',
  (() => {
    const av = ({ date }) => ({ closed: date === '2026-09-09', slots: [{ technician: 'A', slots: ['10:00'] }] })
    const r = fullBooked('x', { getAvailability: av, storeId: 's', serviceId: 'x', date: '2026-09-09',
      humanDate: (d) => d, todayISO: '2026-09-08' }, 'zh', true)
    return r.alts.every((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.date) && /^\d{2}:\d{2}$/.test(a.time)) })())
check('D173 下③ 确认句判断复用全仓那一个 looksConfirm(不自己再写一条正则)',
  looksConfirm('好的,就这个时间') === true && looksConfirm('我想约周六') === false)

const intakeSrc = readFileSync(join(ROOT, 'apps/api/booking-intake.mjs'), 'utf8')
const intakeCode = intakeSrc.replace(/\/\*[\s\S]*?\*\//g, '')
check('D173 下④ 店休那句**只有一处出**(现查全仓原来有三处各写了一遍,改一处等于没改)',
  (intakeCode.match(/门店休息哦,换一天好吗/g) || []).length === 1
  && (intakeCode.match(/closedDayReply\(/g) || []).length >= 4)
check('D173 下⑤ 确认句那一支排在「再问一遍缺的格」**前面**(排后面就永远轮不到它)',
  intakeCode.indexOf('bookingClosedAlts') < intakeCode.indexOf("!gaveSlot && stage === 'collecting' && looksConfirm(text)"))
check('D173 下⑥ 替代日从状态里取,**不许现编**(取不到就照旧问哪天)',
  /const closedAlts = Array\.isArray\(s\.bookingClosedAlts\)/.test(intakeCode)
  && /if \(!slots\.date && closedAlts\.length && isConfirm\)/.test(intakeCode))
check('D173 附 出口把连着说两遍的同一句去掉(重放时看见「要我先帮您留着吗?」说了两遍)',
  dedupeTail('定金 ¥50。要我先帮您留着吗? 要我先帮您留着吗?').split('要我先帮您留着吗').length === 2)

/* ═══ D187(v6 重放通三时自己看见的:一条回复里同一句问了两遍)═══
   两层病,缺一层就不红:①去重那一刀放在「采集模板早退」后面,而重复恰恰出自采集模板;
   ②去重不报 `why`,壳里 `if (h.why)` 把改好的文本原样扔了。 */
const DUP = '9月10日(周四) 15:00 有位子。定金 ¥50(到店付);提前 24 小时可全退。要我先帮您留着吗? 要我先帮您留着吗?'
check('D187 ① 采集模板的回复里同一句连着两遍 → 去掉后一遍(这条路以前整段早退,刀落不到)',
  (() => { const r = hygiene({ text: DUP, customerText: '下午三点', status: 'ai', source: 'collect_template', todayISO: '2026-09-09' })
    return (r.text.match(/要我先帮您留着吗/g) || []).length === 1 })())
check('D187 ② 去重必须报进 why(不报 = 壳里那句 `if (h.why)` 会把它扔掉)',
  /dup-sentence-cut/.test(hygiene({ text: DUP, customerText: '下午三点', status: 'ai', source: 'collect_template', todayISO: '2026-09-09' }).why))
check('D187 ③ 壳按「文本变没变」落地,不按「它有没有报告自己变了」',
  (() => { const r = applyRepeatGuard({ db: null, iso: () => '', getWecomConversation: () => null,
      hygiene: ({ text }) => ({ text: String(text).replace('两遍', '一遍'), why: '' }), todayISO: () => '2026-09-09' },
    { inbound: { content: 'x', lang: 'zh' }, result: { reply: { data: { answerZh: '同一句问了两遍' } } },
      pre: { run: false, lastText: '' }, conversationId: 'c', tenantId: 't' })
    return (r?.reply?.data?.answerZh || '') === '同一句问了一遍' })())
check('D187 ④ 去重是减法,不许顺手改排版(句号后面不许自己长出空格)',
  !/。\s/.test(dedupeTail('有位子。定金 ¥50。')) && dedupeTail('有位子。定金 ¥50。') === '有位子。定金 ¥50。')
check('D187 ⑤ 不误伤「两句相似但不同」的问句',
  dedupeTail('要我帮您留着吗?要我帮您约周六吗?') === '要我帮您留着吗?要我帮您约周六吗?')

/* ═══ D174 / D176(店主 05u §三 亲读 v5 读出来的另两条)═══ */
check('D174 ① 顾客告别、机器一句话都没有时,出口补一句告别 —— **静默一律算红**',
  (() => {
    const r = applyRepeatGuard({ db: null, iso: () => '', getWecomConversation: () => null, hygiene: null },
      { inbound: { content: '谢谢', lang: 'zh' }, result: { reply: { data: { answerZh: '' } } },
        pre: { run: false, lastText: '' }, conversationId: 'c', tenantId: 't' })
    const zh = r?.reply?.data?.answerZh || ''
    return zh.length > 0 && /不客气|随时/.test(zh) })())
check('D174 ② 不是告别就不硬塞话(空就是空,别为了「有回复」编一句)',
  (() => {
    const r = applyRepeatGuard({ db: null, iso: () => '', getWecomConversation: () => null, hygiene: null },
      { inbound: { content: '这个多少钱', lang: 'zh' }, result: { reply: { data: { answerZh: '' } } },
        pre: { run: false, lastText: '' }, conversationId: 'c', tenantId: 't' })
    return !(r?.reply?.data?.answerZh || '') })())
const RANK_ITEMS = [
  { id: 'a', name: '手部基础护理', priceCents: 8800, priceMode: 'fixed', type: 'NAIL' },
  { id: 'b', name: '裸感自然睫', priceCents: 19800, priceMode: 'fixed', type: 'LASH' },
  { id: 'c', name: '轻盈浓密睫', priceCents: 26800, priceMode: 'fixed', type: 'LASH' },
]
check('D176 ① 上文在说美睫 → 「最便宜的是哪种」只在美睫里挑(v5 通二那条:跨了品类还和自己上一句打架)',
  pickByRank('那个最便宜的是哪种', RANK_ITEMS, 'lash')?.top?.name === '裸感自然睫')
check('D176 ② 当句明说品类时**当句优先**(上文是美睫,这句问美甲 → answer 美甲)',
  pickByRank('最便宜的美甲多少钱', RANK_ITEMS, 'lash')?.top?.name === '手部基础护理')
check('D176 ③ 上文也没有品类 → 才全店挑(不许因为没上下文就不答)',
  pickByRank('那个最便宜的是哪种', RANK_ITEMS)?.top?.name === '手部基础护理')

/* ═══ D164 / D165 · 店主 05s 补四 四轮亲测当夹具 ═══ */
check('D164 ① 待答那句从**会话流水**取(最近一条 AI 的采集问句尾巴)',
  pendingQuestion('请问这款是做本甲还是需要延长\uff1f') === '请问这款是做本甲还是需要延长\uff1f')
check('D164 ①b 🔴 中断过一次之后,取到的**还是同一句**(顾客没答就不许往前跳)',
  pendingQuestion('现在有「开业礼」立减 ¥50。 那我们接着说,请问这款是做本甲还是需要延长\uff1f')
    === '请问这款是做本甲还是需要延长\uff1f')
check('D164 ①c 上一句不是采集问句 → 空(拿不到就别说「接着说」)',
  pendingQuestion('我们家 20:00 关门。') === '')
check('D164 ② 🔴 接不到待答那句时**一个字都不加**(店主亲测轮3:接了个空的「那我们接着说,」)',
  (() => { const r = withResume({ source: 'collect_template', data: { answerZh: '请问是否需要卸甲\uff1f' } },
    { kind: 'discount', answer: '现在有「开业礼」立减 ¥50。' }, 'zh', '')
    return r.data.answerZh === '现在有「开业礼」立减 ¥50。' && !r.data.answerZh.includes('接着说') })())
check('D164 ②b 接得到就原样接回**那一句**,不是模板算出来的下一问',
  withResume({ source: 'collect_template', data: { answerZh: '请问是否需要卸甲\uff1f' } },
    { kind: 'discount', answer: '现在有券。' }, 'zh', '请问这款是做本甲还是需要延长\uff1f')
    .data.answerZh === '现在有券。 那我们接着说,请问这款是做本甲还是需要延长\uff1f')
check('D165 🔴 `quote` 项目问价:**没券也要说「具体价格技师看过后报」**(顾客问的是价,不能只回一个问句)',
  (() => { const no = quotePathDiscountLine([], 'zh'); const yes = quotePathDiscountLine(coup, 'zh')
    return no.includes('技师') && yes.includes('新客首单立减 50') && yes.includes('技师') })(),
  quotePathDiscountLine([], 'zh'))

/* ═══ 通三 · 定金一句话说清(≤120 字)═══ */
const depCfg = { enabled: true, mode: 'fallback', fallbackAmountCents: 5000, deductible: false,
  cancelPolicy: { refundable: true, freeCancelHours: 24, lateForfeitPct: 50, noShowForfeitPct: 100 } }
const depMoney = (c) => `¥${(c / 100).toFixed(0)}`
check('通三 ① 🔴 对顾客那句定金 ≤120 字', depositBrief(depCfg, depMoney).length <= 120,
  `${depositBrief(depCfg, depMoney).length} 字:${depositBrief(depCfg, depMoney)}`)
check('通三 ②数字全来自配置(金额 / 小时 / 罚则),一个都不编',
  (() => { const t = depositBrief(depCfg, depMoney); return t.includes('¥50') && t.includes('24 小时') && t.includes('扣一半') })())
check('通三 ③ 没配退款规则就**整句不提退款**(不许编一个 24 小时)',
  !/退/.test(depositBrief({ ...depCfg, cancelPolicy: {} }, depMoney)))
check('通三 ④ 不收定金的店说自己的那句', depositBrief({ enabled: false }, depMoney).includes('不收定金'))

/* 接线:那条路真的排在报价采集**之前** */
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
check('D152 ⑦ 接线排在报价采集之前(不然照旧被采集吃掉)',
  srv.indexOf('fixedPriceAnswer(') > 0 && srv.indexOf('fixedPriceAnswer(') < srv.indexOf('quoteIntakeReply(\'manual_special_review\''))

/* ═══ 行为层 ═══ */
const onTest = await isTestTarget(BASE_URL)
if (!onTest) {
  console.log(`⚠️  [v4-five-fixes] ${BASE_URL} 不是测试库 —— **行为层本轮未跑**(不是通过)`)
} else {
  await assertTestTarget(BASE_URL)
  const db = new DatabaseSync(process.env.TEST_DB_PATH)
  const RUN = `v5-${Date.now().toString(36)}`
  const say = (uid, msg) => fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ message: msg, lang: 'zh', externalUserId: uid }),
  }).then((r) => r.json()).then((j) => ({ src: j?.reply?.source || '', text: String(j?.reply?.data?.answerZh || ''), status: j?.conversation?.status || '' }))

  /* 造景:本轮专用的一个 fixed 项目(名字带执行随机段,跑完删掉) */
  const tid = db.prepare('SELECT tenant_id FROM services WHERE is_active = 1 LIMIT 1').get()?.tenant_id
  check('造景自证:测试库里取得到一家有项目的店', Boolean(tid), String(tid))
  if (tid) {
    const sid = `svc-${RUN}`
    const name = `判据单色${RUN.slice(-4)}`
    /* 🔴 **整行照抄一条现成的**再改四个字段 —— 判据不猜 schema。
       前两次就是靠猜列名栽的(先缺 `type`、再缺 `category`);
       services 有几十列、还有 NOT NULL,一列一列补必然还漏。 */
    const src0 = db.prepare("SELECT * FROM services WHERE tenant_id = ? AND is_active = 1 AND (item_kind IS NULL OR item_kind = 'main') LIMIT 1").get(tid)
    const cols = Object.keys(src0)
    const row = { ...src0, id: sid, name_zh: name, price_cents: 29800, base_duration_min: 90, price_mode: 'fixed', sort_order: 999 }
    db.prepare(`INSERT INTO services (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => row[c]))
    const r1 = await say(`${RUN}-a`, `${name}多少钱?`)
    /* 🔴 判据不锚币符:CI 那家店是加元、沙箱北京店是人民币 —— 锚 `¥` 就等于把币种写进判据。
       要证的是「走了直报那条路 + 报的是库里那个价」,所以只看**路**与**数字**。 */
    check('行为 ① 🔴 问 fixed 项目的价 → **直接报**,不进报价采集',
      r1.src === 'fixed_price_direct' && /298/.test(r1.text) && /原价/.test(r1.text), JSON.stringify(r1))
    check('行为 ①b 那一句里没有采集问句的尾巴', !/是否需要卸甲|本甲还是延长/.test(r1.text), r1.text)
    /* 收尾:判据自己造的项目自己删(夹具不收尾 = 判据非幂等) */
    db.prepare('DELETE FROM services WHERE id = ?').run(sid)
    check('行为 ②收尾:造的项目已删干净',
      db.prepare('SELECT COUNT(*) AS n FROM services WHERE id = ?').get(sid).n === 0)
  }
  db.close()
}

console.log(`\n[v4 五病 + D152 正面] D158 误伤 · D159 尾巴 · D161 告别 · D152 三段式`)
if (fails.length) { console.error(`\n❌ test-v4-five-fixes ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-v4-five-fixes 通过 ${n} 项`)
