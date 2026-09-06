/* D145 常驻套件 —— 采集态「这句是给槽、是在问、还是在收尾」

   锚就是 05o §二 那张表(Cowork 逐句读五通 v2 读出来的七处),**一句都不许改写**:
   通一「大概要多久」/「好的谢谢你啦」· 通二「预算不多,能推荐吗」·
   通四「还是改成美睫吧」「那周日行吗」· 通五「谢谢」。

   两层:
   ① 单元层 —— `classifyTurn` / `slotEcho` 是纯函数,逐句锚死,跑得飞快;
   ② 行为层 —— 真接口喂那几句,看**这一轮出没出问号**。
   单元绿而行为红是常有的事(接错了、没接上),所以两层都要。

   造病用产品代码自带的 `DEGRADED_FOR_KNIFE`(退化成「只认 slot」= D145 修复前的行为),
   不另写一份平行实现 —— 平行实现验的是判据自己。 */
import { assertTestTarget } from './test-guard.mjs'
import { classifyTurn, slotEcho, TURN_TEXT, TURN_KINDS, DEGRADED_FOR_KNIFE } from './turn-classify.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const RUN = Date.now().toString(36)
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ── 锚:七句原文 → 该分到哪一档 ─────────────────────────────
   `gaveSlot` 是调用方(状态机)给的:那一句有没有真的填上槽。 */
const ANCHORS = [
  ['通一', '大概要多久', false, 'question'],
  ['通一', '好的谢谢你啦', false, 'farewell'],
  ['通二', '预算不多,能推荐吗', false, 'budget'],
  ['通二', '那个最便宜的是哪种', false, 'budget'],
  ['通四', '还是改成美睫吧', true, 'slot'],
  ['通四', '那周日行吗', true, 'slot'],
  ['通五', '谢谢', false, 'farewell'],
  ['补', '我再想想', false, 'hesitate'],
  ['补', '会不会很快就掉', false, 'question'],
]
const wrong = ANCHORS.filter(([, t, g, want]) => classifyTurn(t, { gaveSlot: g }) !== want)
check(`① 七句锚(+2 补)逐句分对 —— 共 ${ANCHORS.length} 句`,
  wrong.length === 0,
  wrong.map(([tong, t, g, want]) => `${tong}「${t}」期望 ${want} 实际 ${classifyTurn(t, { gaveSlot: g })}`).join(' | '))

/* 反向守:分类不许把「确认+给时间」这种话吃成道别 —— 那会把顾客的单弄丢 */
check('①b 反向守:「那就 10:30,谢谢」是给槽,不是道别(锚在句首才分得开)',
  classifyTurn('那就 10:30,谢谢', { gaveSlot: true }) === 'slot',
  classifyTurn('那就 10:30,谢谢', { gaveSlot: true }))
check('①c 反向守:空串与纯标点回 other,不回任何一个会「出句」的档',
  classifyTurn('', {}) === 'other' && classifyTurn('。。。', {}) === 'other')
check('①d 白名单式:任何输入的返回值都必须落在 TURN_KINDS 里(新档忘登记即红)',
  ['大概要多久', '谢谢', '我再想想', '预算不多', '嗯', 'ok', '周日'].every((t) => TURN_KINDS.includes(classifyTurn(t, {}))))

/* ── slotEcho:槽变了要说出来(通四那两句的正解)──────────────── */
const e1 = slotEcho({ serviceType: '美甲' }, { serviceType: '美睫' }, 'zh')
check('② 复述·改项目:「还是改成美睫吧」→ 回句里出现「改成美睫了」',
  e1.includes('改成美睫了'), e1)
const e2 = slotEcho({ serviceType: '美睫' }, { serviceType: '美睫', date: '2026-09-13' }, 'zh')
check('②b 复述·加日期:新给的日期要复述出来', e2.includes('2026-09-13'), e2)
check('②c 没变化就不复述(不许每轮都念一遍)',
  slotEcho({ serviceType: '美睫' }, { serviceType: '美睫' }, 'zh') === '',
  slotEcho({ serviceType: '美睫' }, { serviceType: '美睫' }, 'zh'))
check('②d 复述句自己不带问号(它是陈述,问句在后面那一格)', !/[??]/.test(e1 + e2), e1 + e2)

/* ── 出句:道别/犹豫两档这一轮一个问号都不许出 ──────────────── */
for (const kind of ['farewell', 'hesitate']) {
  const zh = TURN_TEXT[kind].zh
  const en = TURN_TEXT[kind].en
  check(`③ ${kind} 出句中英都在,且**不含问号**(这一档的要害就是别再问)`,
    Boolean(zh) && Boolean(en) && !/[??]/.test(zh) && !/\?/.test(en), `${zh} | ${en}`)
}

/* ── ④ 造病验红:退化成「只认 slot」= D145 修复前 ──────────────
   《判据律》:这条判据在缺陷存在时会不会照样绿?—— 现在就把缺陷造出来看。 */
DEGRADED_FOR_KNIFE.on = true
console.log('   [刀] 注入=classifyTurn 退化成「只认 slot / 其余 other」(D145 修复前的行为)')
const degraded = ANCHORS.filter(([, t, g, want]) => classifyTurn(t, { gaveSlot: g }) !== want)
check(`④ 🔴 刀落下去,${ANCHORS.length} 句里至少 4 句掉档(实际掉 ${degraded.length} 句)—— 掉不动说明这把刀根本没在守`,
  degraded.length >= 4, degraded.map(([, t]) => t).join(' | '))
check('④b 刀落下时,道别与犹豫都退回 other(正是「见谁都追下一格」的那个状态)',
  classifyTurn('好的谢谢你啦', { gaveSlot: false }) === 'other'
  && classifyTurn('我再想想', { gaveSlot: false }) === 'other')
DEGRADED_FOR_KNIFE.on = false
console.log('   [刀] 已还原')
check('④c 还原后立刻回绿(刀不许留在库里)',
  ANCHORS.every(([, t, g, want]) => classifyTurn(t, { gaveSlot: g }) === want))

/* ── ⑤ 行为层:真接口喂那几句,看这一轮出没出问号 ────────────── */
const chat = async (tid, ext, message) => {
  const r = await fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token', 'x-admin-tenant-id': tid },
    body: JSON.stringify({ externalUserId: ext, message })
  })
  try { return await r.json() } catch { return null }
}
const sayOf = (d) => String(d?.reply?.data?.answerZh || '')
{
  const tid = 'lucky-luxe'
  const uid = `d145-${RUN}`
  /* 先把人带进采集态(说项目、说要约)—— 造景归造景,不能直接喂第七句就断言 */
  await chat(tid, uid, '我想做美甲')
  const mid = await chat(tid, uid, '想问问价格')
  check('⑤0 造景:两轮之后机器确实在采集态(在问东西)—— 不在采集态,下面验的就不是这件事',
    /[??]/.test(sayOf(mid)) || Boolean(sayOf(mid)), sayOf(mid).slice(0, 60))

  const bye = await chat(tid, uid, '好的谢谢你啦')
  const byeTxt = sayOf(bye)
  check('⑤a 🔴 顾客道别 → 这一轮**不许再问**(五通里它回的是「请问是否有断甲?」)',
    Boolean(byeTxt) && !/[??]/.test(byeTxt), byeTxt.slice(0, 90))
  check('⑤b 反向守:道别那一轮**有话说**(整句空也叫「没问」,那是把功能拦没了)',
    byeTxt.trim().length >= 4, byeTxt)

  const uid2 = `d145b-${RUN}`
  await chat(tid, uid2, '我想做美睫')
  const hes = await chat(tid, uid2, '我再想想')
  const hesTxt = sayOf(hes)
  check('⑤c 🔴 顾客犹豫 → 让开一轮,不追下一格',
    Boolean(hesTxt) && !/[??]/.test(hesTxt), hesTxt.slice(0, 90))
}

console.log(`\n[D145 采集态分类] 锚 ${ANCHORS.length} 句 · 复述 · 两档出句无问号 · 造病退化验红 · 行为层道别/犹豫`)
if (fails.length) {
  console.error(`\n❌ test-turn-classify ${fails.length}/${n} 项未过`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`\n✅ test-turn-classify 通过 ${n} 项`)
