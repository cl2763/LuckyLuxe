/* AI 修图入口三态(店主 11m §三 批,2026-09-22)
 *
 * ══ 三态 ══
 *   `off`  整张卡**不存在**(不是灰着) · `soon` 淡态 + 敬请期待,点击只 toast **不跳页** · `on` 真入口
 *
 * 🔴 **`on` 现在谁也拨不到**:流程(选图/预设/对比三步)等 12a 两轮评测,本批只做壳。
 *    壳上如果能拨到 on,商家点进去就是空页面 —— **那是假入口**(「不可用即不呈现,呈现即说明」)。
 *    流程上线那天把 `ON_READY` 翻成 true,这道 409 自动让路。 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const codeOnly = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

let checks = 0, failed = 0
function check(name, ok, extra = '') {
  checks++
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { failed++; console.log(`not ok ${checks} - ${name}${extra ? ' :: ' + extra : ''}`) }
}
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-owner-token': TOKEN }
async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
  let data = null
  try { data = await r.json() } catch { data = null }
  return { status: r.status, data }
}
const setState = (tid, state) => req(`/platform/tenants/${tid}/ai-retouch`, { method: 'PUT', body: JSON.stringify({ state }) })
const todoKeys = async () => ((await req('/admin/dashboard/todo')).data?.items || []).map((x) => x.key)
const firstTodo = async () => ((await req('/admin/dashboard/todo')).data?.items || [])[0] || null

/* ══ ① 默认最严:新租户建出来就是 off ══ */
const tid = `airet-${Date.now().toString(36)}`
const created = await req('/platform/tenants', {
  method: 'POST',
  body: JSON.stringify({ name: 'AI修图三态验店', id: tid, plan: 'free', initialTerm: 'trial30', currency: 'CNY', timezone: 'Asia/Shanghai' }),
})
check('①a 夹具:建店成功', created.status === 201, String(created.status))
const g0 = await req(`/platform/tenants/${tid}/ai-retouch`)
check('①b 🔴 **新租户默认 off**(默认最严,不是「没配置所以放行」)', g0.data?.state === 'off', JSON.stringify(g0.data))
check('①c 三态就是 off/soon/on 三个,不多不少',
  JSON.stringify(g0.data?.states) === JSON.stringify(['off', 'soon', 'on']), JSON.stringify(g0.data?.states))
check('①d `onReady` 现在是 false(流程未上线)', g0.data?.onReady === false, String(g0.data?.onReady))

/* ══ ② 🔴 拨 on 必须 409 —— 这是本批最要紧的一条 ══ */
const on1 = await setState(tid, 'on')
check('②a 🔴 **拨 on → 409**(流程没做出来,拨到 on 商家点进去是空页面=假入口)',
  on1.status === 409 && on1.data?.error?.code === 'AI_RETOUCH_NOT_READY', `${on1.status} ${JSON.stringify(on1.data)}`)
const afterOn = await req(`/platform/tenants/${tid}/ai-retouch`)
check('②b 🔴 409 之后状态**没被改脏**(拒绝要干净,不许写一半)', afterOn.data?.state === 'off', String(afterOn.data?.state))
const bad = await setState(tid, 'zzz')
check('②c 乱值 → 400', bad.status === 400, String(bad.status))
const noTok = await fetch(`${BASE}/platform/tenants/${tid}/ai-retouch`).then((r) => r.status)
check('②d 越权:不带平台令牌 → 401', noTok === 401, String(noTok))
const noTenant = await req('/platform/tenants/no-such-tenant-x/ai-retouch')
check('②e 异常输入:租户不存在 → 404', noTenant.status === 404, String(noTenant.status))

/* ══ ③ 行为层:三态在「今日要处理」里各长什么样 ══
   用**默认租户**(dashboard 那几个口按当前租户上下文走),三态各跑一遍。 */
const DEF = 'lucky-luxe'
await setState(DEF, 'off')
const keysOff = await todoKeys()
check('③a 🔴 **off:整张卡不存在**(不是灰着,是列表里根本没有这一项)',
  !keysOff.includes('aiRetouch'), JSON.stringify(keysOff))
check('③a反 🟢 **阳性对照**:别的待办还在(证明 ③a 的「没有」不是整个接口空了)',
  keysOff.length >= 1, JSON.stringify(keysOff))

await setState(DEF, 'soon')
const keysSoon = await todoKeys()
const card = await firstTodo()
check('③b 🔴 **soon:卡出现,而且排第一张**(店主批的位置)',
  keysSoon[0] === 'aiRetouch', JSON.stringify(keysSoon))
check('③c 🔴 **soon 的 `to` 是空** —— 点击不跳页(跳过去是空页面,那是假入口)',
  card?.to === '', JSON.stringify(card))
check('③d soon 标了 soon,并带后端出的三句(前端零拼串)',
  card?.soon === true && card?.label === 'AI 修图' && card?.badge === '敬请期待' && String(card?.hint || '').length > 0,
  JSON.stringify(card))
check('③e 🟢 soon 那张不带数字(它不是催人的事,`n` 不渲染)', card?.n === 0, String(card?.n))

await setState(DEF, 'off')
check('③f 🔴 拨回 off → 卡又消失(三态是活的,不是只进不出)',
  !(await todoKeys()).includes('aiRetouch'))

/* ══ ④ 两端渲染:老板端与员工端都出,且句子只有一处来源 ══ */
const wxml = read('miniprogram/pages/merchant/home/index.wxml')
check('④a 老板端那一列:`soon` 有淡态类,badge 渲染的是后端给的字段',
  /class="dh-todo \{\{item\.urgent[^"]*item\.soon\?'soon'/.test(wxml) && /\{\{item\.badge\}\}/.test(wxml), '')
check('④b 老板端:`soon` 那张**不渲染数字**', /wx:if="\{\{!item\.soon\}\}" class="dh-todo-n"/.test(wxml))
check('④c 🔴 **员工端也出这张卡**(店主批:技师看得到)', /wx:if="\{\{aiRetouch\}\}"/.test(wxml))
check('④d 🔴 员工端渲染的是**同一份后端数据**(aiRetouch.label/badge/hint),没有第二处文案',
  /\{\{aiRetouch\.label\}\}/.test(wxml) && /\{\{aiRetouch\.badge\}\}/.test(wxml) && /\{\{aiRetouch\.hint\}\}/.test(wxml))
const pageJs = codeOnly(read('miniprogram/pages/merchant/home/index.js'))
check('④e 🔴 点击分支:`soon` 只 toast,**在取 `k` 之前就 return**(不会走到跳页那一行)',
  /dataset\.soon\) === 1\)[\s\S]{0,180}?showToast[\s\S]{0,80}?return/.test(pageJs), '')
check('④f toast 的话来自后端 `hint`,不是写死的一句', /dataset\.hint \|\|/.test(pageJs))
check('④g 员工端那张卡的数据取自 `todo.items` 里 key==="aiRetouch" 那一条(同源)',
  /x\.key === 'aiRetouch'/.test(pageJs))

/* ══ ⑤ `on` 态渲染本批不写 —— 写了就是假入口 ══ */
check('⑤a 🔴 前端没有任何 `on` 态的跳页路径(流程没做出来,壳上不许有路)',
  !/ai-retouch[^'"]*index/.test(wxml) && !/pages\/merchant\/ai-retouch/.test(pageJs),
  (pageJs.match(/.{0,40}ai-retouch.{0,40}/g) || []).join(' | '))
const gateSrc = read('apps/api/ai-retouch-gate.mjs')
check('⑤b 🔴 `ON_READY` 是**一处真相** —— 流程上线那天只改这一个常量',
  /export const ON_READY = false/.test(gateSrc))
check('⑤c 🟢 反向守:值不在三态里(没配/被改坏)一律当 off,不是「读不出来就放行」',
  /AI_RETOUCH_STATES\.includes\(v\) \? v : AI_RETOUCH_DEFAULT/.test(gateSrc))

/* ══ ⑥ 条数自守(判据五)══ */
const EXPECTED_CHECKS = 26
if (checks !== EXPECTED_CHECKS) {
  console.error(`not ok - 🔴 断言条数对不上:实跑 ${checks} 条,应为 ${EXPECTED_CHECKS} 条(判据五)。`)
  process.exit(1)
}
if (failed) { console.error(`\n❌ AI 修图三态:${failed}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ AI 修图入口三态 ${checks} 条全过(与声明的 ${EXPECTED_CHECKS} 条一致)`)
