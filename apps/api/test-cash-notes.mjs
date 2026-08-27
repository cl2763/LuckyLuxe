/* D79 · 线下现金腿(日结手记)—— 店主 2026-08-28 排进批次二第②件。

   病:「今晚数钱按这个数」只算系统内的现金进出(到店支付 + 现金充值 − 现金退卡)。
   买材料付的现金、早上放的备用金、找零、金额更正后当场退的差额 —— 系统一个都不知道,
   于是那个数永远等不于抽屉。店主对不上账时不会怀疑"系统少算一腿",**她会怀疑店员**。

   店主给的判据(原样落在这里):
     · 手记一笔 −50 → 应有数**跟着减 50**;
     · **反向守**:不记时应有数**一分不动**(否则"这个数总在变"也能让它绿)。

   另加三族(都是从既有律推的,不是我临时想的):
     · 后端最终闸:备注必填 / 0 元 / 类型非法 / 超上限 —— 接口直调一律拦(前端拦只算体验);
     · 只追加不修改:冲销是**追加一条反向行**,原始那条还在,净额回到没记过的状态;
     · 手记**不进损益、不进营业额、不进业绩**(它是抽屉腿,不是收入)。

   ⚠️ standalone:CI_SUITES="cash-notes" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}

const tid = `cash-${RUN}`
const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `现金腿店${RUN}`, plan: 'chain' }) })
if (made.status !== 201) throw new Error(`建店失败 ${JSON.stringify(made.data)}`)
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const today = (await request('/admin/store-clock', {}, PLATFORM, H)).data.today
const drawerOf = async (date = today) => (await request(`/admin/daily-close?date=${date}`, {}, PLATFORM, H)).data.dailyClose.cashDrawer
const closeOf = async (date = today) => (await request(`/admin/daily-close?date=${date}`, {}, PLATFORM, H)).data.dailyClose

/* ===== ① 反向守先做:一笔手记都没有时,基线是多少、算式长什么样 ===== */
const base = await drawerOf()
check('① 反向守基线:没有手记时,算式里没有「现金手记」这一行',
  !(base.rows || []).some((r) => String(r.label).includes('现金手记')), JSON.stringify(base.rows))
const baseCents = base.shouldHaveCents
const baseAgain = await drawerOf()
check('① 反向守:不记手记时,应有数一分不动(连读两次相同)',
  baseAgain.shouldHaveCents === baseCents, `${baseCents} → ${baseAgain.shouldHaveCents}`)

/* ===== ② 店主判据本体:手记一笔 −50 → 应有数跟着减 50 ===== */
const add1 = await request('/admin/cash-notes', {
  method: 'POST', body: JSON.stringify({ date: today, kind: 'expense', amountCents: -5000, note: `买卸甲棉${RUN}` })
}, PLATFORM, H)
check('② 记一笔 −50 成功', add1.status === 201 && add1.data.note.amountCents === -5000, JSON.stringify(add1.data).slice(0, 160))
const afterOut = await drawerOf()
check('② 🔴 店主判据:应有数**正好减了 50**(不是"变了一下")',
  afterOut.shouldHaveCents === baseCents - 5000, `基线 ${baseCents} → 现在 ${afterOut.shouldHaveCents}`)
check('② 算式里多出「现金手记(1 笔)」且是减号(数字要能自证来源)',
  (afterOut.rows || []).some((r) => r.label === '现金手记(1 笔)' && r.sign === '−' && r.amountCents === 5000),
  JSON.stringify(afterOut.rows))

/* ===== ③ 正的那一半:备用金放进抽屉 +200 ===== */
await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify({ date: today, kind: 'float', amountCents: 20000, note: `早上放备用金${RUN}` }) }, PLATFORM, H)
const afterIn = await drawerOf()
check('③ 再记 +200:应有数 = 基线 − 50 + 200(两笔一起算,不是只认最后一笔)',
  afterIn.shouldHaveCents === baseCents - 5000 + 20000, `${afterIn.shouldHaveCents}`)
check('③ 净额为正时算式行变加号', (afterIn.rows || []).some((r) => r.label === '现金手记(2 笔)' && r.sign === '+' && r.amountCents === 15000),
  JSON.stringify(afterIn.rows))

/* ===== ④ 手记不许碰收入 / 营业额 / 业绩 ===== */
const dc = await closeOf()
check('④ 手记不进损益:抽屉的收入影响仍恒为 0', dc.cashDrawer.incomeImpactCents === 0, String(dc.cashDrawer.incomeImpactCents))
check('④ 手记不进营业额(顶部三小格里的营业额没被它动过)',
  (dc.headline || []).find((h) => h.key === 'revenue')?.value === (dc.headline || []).find((h) => h.key === 'revenue')?.value
  && dc.revenueCents === 0, String(dc.revenueCents))
check('④ 手记不进业绩(本日技师业绩合计仍为 0)',
  (dc.technicians || []).reduce((n, t) => n + (t.perfCents || 0), 0) === 0,
  JSON.stringify((dc.technicians || []).map((t) => t.perfCents)))

/* ===== ⑤ 后端最终闸(前端拦只算体验)===== */
const gates = [
  ['备注空白', { date: today, kind: 'expense', amountCents: -100, note: '   ' }],
  ['金额 0', { date: today, kind: 'expense', amountCents: 0, note: 'x' }],
  ['类型非法', { date: today, kind: 'steal', amountCents: -100, note: 'x' }],
  ['超上限', { date: today, kind: 'expense', amountCents: -100000001, note: 'x' }],
  ['日期格式不对', { date: '08/28', kind: 'expense', amountCents: -100, note: 'x' }],
  ['备注超长', { date: today, kind: 'expense', amountCents: -100, note: 'x'.repeat(121) }]
]
for (const [label, body] of gates) {
  const r = await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify(body) }, PLATFORM, H)
  check(`⑤ 后端闸「${label}」→ 4xx(${r.status})`, r.status >= 400 && r.status < 500, JSON.stringify(r.data).slice(0, 120))
}
const afterGates = await drawerOf()
check('⑤ 被拒的六次一分钱都没写进去(应有数与拒之前相同)',
  afterGates.shouldHaveCents === afterIn.shouldHaveCents, `${afterIn.shouldHaveCents} → ${afterGates.shouldHaveCents}`)

/* ===== ⑥ 只追加不修改:冲销 = 追加一条反向行 ===== */
const noteId = add1.data.note.id
const rev = await request(`/admin/cash-notes/${noteId}/reverse`, { method: 'POST', body: JSON.stringify({}) }, PLATFORM, H)
check('⑥ 冲销成功,且冲销行金额与原条相反', rev.status === 201 && rev.data.note.amountCents === 5000 && rev.data.note.isReversal === true,
  JSON.stringify(rev.data).slice(0, 160))
const afterRev = await drawerOf()
check('⑥ 冲销之后:应有数回到"没记过那 50"的状态(基线 + 200)',
  afterRev.shouldHaveCents === baseCents + 20000, String(afterRev.shouldHaveCents))
const list = (await request(`/admin/cash-notes?date=${today}`, {}, PLATFORM, H)).data.items
check('⑥ 原始那条**还在**(只追加不删除:3 条记录 = 2 笔 + 1 冲销)',
  list.length === 3 && list.some((x) => x.id === noteId), JSON.stringify(list.map((x) => [x.kind, x.amountCents])))
check('⑥ 同一条不许冲两次', (await request(`/admin/cash-notes/${noteId}/reverse`, { method: 'POST', body: JSON.stringify({}) }, PLATFORM, H)).status === 409)
check('⑥ 冲销行本身不许再冲', (await request(`/admin/cash-notes/${rev.data.note.id}/reverse`, { method: 'POST', body: JSON.stringify({}) }, PLATFORM, H)).status === 409)

/* ===== ⑦ 门禁:读写两道闸分别验 ===== */
check('⑦ 未登录 GET → 401', (await request(`/admin/cash-notes?date=${today}`, {}, null, H)).status === 401)
check('⑦ 未登录 POST → 401', (await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify({ date: today, kind: 'expense', amountCents: -1, note: 'x' }) }, null, H)).status === 401)

/* ===== ⑧ 租户隔离:甲店的手记不许算进乙店的抽屉 ===== */
const tidB = `cash-b-${RUN}`
await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tidB, name: `现金腿乙${RUN}`, plan: 'chain' }) })
const HB = { 'x-admin-tenant-id': tidB, 'x-tenant-id': tidB }
const bDrawer = (await request(`/admin/daily-close?date=${today}`, {}, PLATFORM, HB)).data.dailyClose.cashDrawer
check('⑧ 乙店抽屉里没有甲店的手记', !(bDrawer.rows || []).some((r) => String(r.label).includes('现金手记')), JSON.stringify(bDrawer.rows))
check('⑧ 乙店手记列表为空', (await request(`/admin/cash-notes?date=${today}`, {}, PLATFORM, HB)).data.items.length === 0)

/* ===== ⑨ 跨日:昨天的手记不许算进今天 ===== */
const yesterday = new Date(`${today}T12:00:00Z`)
yesterday.setUTCDate(yesterday.getUTCDate() - 1)
const yday = yesterday.toISOString().slice(0, 10)
await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify({ date: yday, kind: 'expense', amountCents: -9999, note: `昨天的${RUN}` }) }, PLATFORM, H)
const todayAfterY = await drawerOf()
check('⑨ 昨天记的手记不影响今天的应有数(日界要对)',
  todayAfterY.shouldHaveCents === afterRev.shouldHaveCents, `${afterRev.shouldHaveCents} → ${todayAfterY.shouldHaveCents}`)
const ydayDrawer = await drawerOf(yday)
check('⑨ 昨天那天自己看得到那一笔', (ydayDrawer.rows || []).some((r) => r.label === '现金手记(1 笔)' && r.amountCents === 9999),
  JSON.stringify(ydayDrawer.rows))

/* ===== ⑨b 与金额更正的接缝(08-27 店主登记的那一行:更正后的现金找补走这个口)=====
   判据两向:更正额还没记进手记 → 那句话要告诉她"实际应是多少";记进去了 → 必须改口,
   不许一边说"抽屉已经算进去了"一边又说"实际应是另一个数"(屏幕上不许有解释不了的数)。 */
{
  const amendDay = today
  const noteBefore = (await drawerOf(amendDay)).amendNote || ''
  check('⑨b 这一天没有金额更正,所以那句解释不该挂着(反向守)', noteBefore === '', noteBefore)
}

/* ===== ⑩ 运行时取证:两端**服务端真发出来的**那份代码,都读同一个后端出口 ===== */
const servedDcr = await fetch(`${BASE_URL}/web/daily-close-rows.js`).then((r) => r.text())
check('⑩ 网页日结(实发资源):手记入口在,且写口打的是 /admin/cash-notes',
  servedDcr.includes("request('/admin/cash-notes'") && servedDcr.includes('data-cash-note-reverse'))
check('⑩ 网页手记金额框不是 type=number(钱的输入框那条族规)',
  /id="dcNoteAmount"[^>]*type="text"/.test(servedDcr) && /id="dcNoteAmount"[^>]*inputmode="decimal"/.test(servedDcr),
  (servedDcr.match(/<input id="dcNoteAmount"[^>]*>/) || ['(没找到)'])[0])

console.log(`\n✅ test-cash-notes 通过 ${checks} 项`)
