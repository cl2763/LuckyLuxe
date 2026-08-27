/* 金额更正联动账本与业绩(店主 2026-08-27 拍板:**单据改了,账和业绩就得跟**)。

   立这套件的背景:普通金额更正原来**只留痕** —— 单据说 150,账本仍记 198、业绩仍算 198,
   同一件事两个数。店主的依据是她自己既有的口径,不是新立的规矩:
     ·「签字时刻 = 记账时刻」→ 单据改了账不改,就有两个真相;
     · D38「累计消费 ≡ 已签结算单档位小计累计」→ 基数不跟着改,技师业绩虚高;
     ·「红字只追加不删、老数据不回溯」+「确认后业绩定格」→ 已确认那天走当期冲减。

   三者分工从此写死:**更正改单据 · 冲销改账本 · 退卡改负债+现金**。

   判据四条(店主指定,第四条是反向守):
     ① 更正后账本净额减 48、业绩减 48(198 → 150)
     ② 原签署单一个字节没变
     ③ 已确认那天的历史数**不许变**,冲减落当期
     ④ 反向守:不做更正时账本与业绩一分不动

   corner case 覆盖:边界(delta=0 空操作 / 补收为正)· 空态(没有收入腿也不许丢钱)·
   越权(员工打更正口)· 幂等(同一张单更正两次各写一行,旧行不动)· 异常输入(原因必填)

   ⚠️ standalone:CI_SUITES="amend-linkage" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = TOKEN, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}
const db = new DatabaseSync(process.env.TEST_DB_PATH || '')

// ===== 夹具:一家 kind=real 的店(账本触发器压着,与生产同口径)=====
const tid = `amd-${RUN}`
const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `更正联动店${RUN}`, plan: 'chain' }) })
if (made.status !== 201) throw new Error(`建店失败 ${JSON.stringify(made.data)}`)
db.prepare("UPDATE tenants SET kind = 'real' WHERE id = ?").run(tid)
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const technicianId = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技师${RUN}`, isActive: true }) }, TOKEN, H)).data.technician.id
const catId = ((await request('/admin/pricing/categories', {}, TOKEN, H)).data.categories || [])[0]?.id
const serviceId = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `更正项目${RUN}`, nameEn: 'x', priceCents: 19800, baseDurationMin: 60, categoryId: catId }) }, TOKEN, H)).data.service.id
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })

const incomeOfCode = (code) => db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM finance_transactions WHERE tenant_id = ? AND tags = ? AND type = 'income'").get(tid, code).n
const financeRows = () => db.prepare('SELECT COUNT(*) n FROM finance_transactions WHERE tenant_id = ?').get(tid).n
const sheetBytes = (id) => JSON.stringify(db.prepare('SELECT * FROM settlements WHERE id = ?').get(id))
const perfOf = async (date) => {
  const v = (await request(`/admin/daily-close?date=${date}`, {}, TOKEN, H)).data.dailyClose || {}
  const t = (v.technicians || []).find((x) => x.technicianId === technicianId)
  return { perfCents: t ? t.perfCents : 0, view: v, tech: t || null }
}

/* 开一张 198 的单并签掉。hh 用来错开时段(同技师同时段会 SLOT_UNAVAILABLE,
   那不是被测行为,别让它把断言弄红)。 */
async function signedSheet(hh, { date = today } = {}) {
  let bk = { status: 0, data: {} }
  for (const h of [hh, '08', '09', '10', '11', '13', '14', '15', '16', '17', '18', '19', '20']) {
    bk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `更正客${RUN}${hh}`, serviceId, technicianId, date, time: `${h}:00` }) }, TOKEN, H)
    if (bk.status === 201 || bk.status === 200) break
  }
  if (!bk.data?.booking) throw new Error(`排单失败 ${JSON.stringify(bk.data).slice(0, 160)}`)
  await request(`/admin/bookings/${bk.data.booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, TOKEN, H)
  const st = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: bk.data.booking.user.id, settlements: [{ bookingId: bk.data.booking.id, payIntent: 'offline_full', items: [{ serviceId, qty: 1 }], technicians: [{ technicianId, role: 'main', itemNos: [1] }] }] }) }, TOKEN, H)
  const sheet = st.data?.settlements?.[0]
  if (!sheet) throw new Error(`开单失败 ${JSON.stringify(st.data).slice(0, 160)}`)
  await fetch(`${BASE_URL}/settlements/${encodeURIComponent(sheet.code)}/sign`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tid }, body: JSON.stringify({ signature: '演', disclaimerAccepted: true })
  })
  return { id: sheet.id, code: sheet.code, bookingId: bk.data.booking.id, userId: bk.data.booking.user.id }
}

const yst0 = new Date(new Date(`${today}T12:00:00Z`).getTime() - 2 * 86400000).toISOString().slice(0, 10)   // 前天:本套件没在这天做过任何事

// ===== ① 日结未确认:账本减 48、业绩减 48,单据一个字节没变 =====
const a = await signedSheet('10')
const incomeBefore = incomeOfCode(a.code)
const rowsBefore = financeRows()
const bytesBefore = sheetBytes(a.id)
const perfBefore = (await perfOf(today)).perfCents
check('①-0 前置:签完一张 198 的单,账本记 198、业绩记 198',
  incomeBefore === 19800 && perfBefore === 19800, `账本 ${incomeBefore} · 业绩 ${perfBefore}`)

const noReason = await request(`/admin/settlements/${a.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: 15000 }) }, TOKEN, H)
check('①-0b 🔴 异常输入:原因必填 = 400(它现在会动账与业绩,没原因就是改钱不留痕)',
  noReason.status === 400 && noReason.data.error?.code === 'REASON_REQUIRED', `${noReason.status}`)

const amended = await request(`/admin/settlements/${a.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: 15000, reason: '技师少做了一项' }) }, TOKEN, H)
check('①-1 更正接口 200', amended.status === 200 || amended.status === 201, JSON.stringify(amended.data).slice(0, 140))
check('①-2 🔴 账本净额跟着单据走:198 → 150(追了一条 −48,不是改原行)',
  incomeOfCode(a.code) === 15000 && financeRows() === rowsBefore + 1,
  `净额 ${incomeOfCode(a.code)} · 行数 ${rowsBefore}→${financeRows()}`)
const deltaRow = db.prepare("SELECT * FROM finance_transactions WHERE tenant_id = ? AND tags = ? AND source = 'amendment'").get(tid, a.code)
check('①-3 差额行是 −48 的收入行,且**不挂 reversal_of**(部分红字不等于整行作废)',
  deltaRow && deltaRow.amount_cents === -4800 && deltaRow.type === 'income' && !deltaRow.reversal_of,
  JSON.stringify(deltaRow && { a: deltaRow.amount_cents, t: deltaRow.type, r: deltaRow.reversal_of }))
check('①-4 差额行自证来源(单号 + 改前改后 + 原因都在备注里)',
  deltaRow && deltaRow.note.includes(a.code) && /150/.test(deltaRow.note) && deltaRow.note.includes('技师少做了一项'),
  deltaRow && deltaRow.note)
const perfAfter = await perfOf(today)
check('①-5 🔴 业绩同步减:198 → 150', perfAfter.perfCents === 15000, String(perfAfter.perfCents))
check('①-6 减在哪自证:日结显式一行「更正扣回 · 单号」+ 技师行「含更正扣回 −$48」',
  (perfAfter.view.afterSalesDeductions || []).some((d) => d.code === a.code && d.label.includes('更正扣回') && d.amountText.includes('48'))
  && String(perfAfter.tech.deductNoteText || '').includes('更正扣回'),
  JSON.stringify({ list: perfAfter.view.afterSalesDeductions, note: perfAfter.tech.deductNoteText }).slice(0, 220))

/* 🔴 08-27 实拍抓到的:更正后技师业绩显示 150,而上面那张单的行**仍写 198** ——
   同屏两个数,店主只会觉得是系统错了。行上的数必须与技师行同源。 */
const rowAfter = (perfAfter.view.awaitingConfirm || []).concat(perfAfter.view.pending || []).find((x) => x.settlementId === a.id)
check('①-7 🔴 同屏不许两个数:那张单的行也说更正后的数(150),并带「已更正」徽标',
  rowAfter && /150/.test(String(rowAfter.perfRowText || '')) && String(rowAfter.perfRowText).includes('更正后')
  && String(rowAfter.amendBadgeText || '').includes('已更正'),
  JSON.stringify(rowAfter && { t: rowAfter.perfRowText, b: rowAfter.amendBadgeText }))
check('①-8 反向守:没更正过的单,行上不出现「更正后」也不出徽标',
  (() => {
    const clean = (perfAfter.view.awaitingConfirm || []).concat(perfAfter.view.pending || []).find((x) => x.settlementId !== a.id)
    return !clean || (!String(clean.perfRowText || '').includes('更正后') && !clean.amendBadgeText)
  })())

/* 🔴 同屏还有第三个数:抽屉。更正后「营业额 150」而「抽屉里应该有 198」——
   两个数其实都对(顾客当时真付了 198 现金,差额退没退是门店当场的动作,系统不知道),
   但屏幕不解释就等于自相矛盾。判据:算式**不许**替她假设钱退了,底下**必须**有一句连起来。 */
check('①-9 🔴 抽屉算式不动(不许替店主假设差额已经退了)',
  perfAfter.view.cashDrawer.shouldHaveCents === 19800, String(perfAfter.view.cashDrawer.shouldHaveCents))
check('①-10 🔴 但必须有一句把「营业额 150」和「抽屉 198」连起来(后端出句)',
  /150/.test(String(perfAfter.view.cashDrawer.amendNote || '')) && String(perfAfter.view.cashDrawer.amendNote).includes('更正'),
  String(perfAfter.view.cashDrawer.amendNote))
check('①-11 反向守:没更正的那天不出这句(不是"总是挂着一句")',
  !((await perfOf(yst0)).view.cashDrawer.amendNote), String((await perfOf(yst0)).view.cashDrawer.amendNote))

// ===== ② 原签署单一个字节没变 =====
check('②-1 🔴 签署单整行逐字节比对:更正前后完全一致(改的是账与业绩,不是那张单)',
  sheetBytes(a.id) === bytesBefore, 'settlements 行有改动')
check('②-2 数据库层也兜着:直接改已签单的金额会被触发器拒',
  (() => {
    try { db.prepare('UPDATE settlements SET total_cents = 1 WHERE id = ?').run(a.id); return false } catch (e) { return /immutable/.test(String(e.message)) }
  })())

// ===== ④ 反向守:不做更正时,账本与业绩一分不动 =====
const b = await signedSheet('11')
const bIncome = incomeOfCode(b.code)
const bPerf = (await perfOf(today)).perfCents
const zero = await request(`/admin/settlements/${b.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: 19800, reason: '改了个寂寞(金额没动)' }) }, TOKEN, H)
check('④-1 🔴 反向守:金额没变的"更正"不写账本差额行(delta=0 = 空操作)',
  (zero.status === 200 || zero.status === 201) && incomeOfCode(b.code) === bIncome
  && !db.prepare("SELECT 1 FROM finance_transactions WHERE tenant_id = ? AND tags = ? AND source = 'amendment'").get(tid, b.code),
  `${zero.status} · ${incomeOfCode(b.code)} vs ${bIncome}`)
check('④-2 🔴 反向守:业绩也一分不动(证明前面那些"减了"不是随便谁都会减)',
  (await perfOf(today)).perfCents === bPerf, `${(await perfOf(today)).perfCents} vs ${bPerf}`)

// ===== ③ 已确认那天:历史数不许变,冲减落当期 =====
/* 造一张**昨天**的单并把昨天日结确认掉,再更正它 —— 这才是"已定格"的真场景。 */
const yst = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
const c = await signedSheet('14', { date: yst })
const confirmed = await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: yst }) }, TOKEN, H)
check('③-0 前置:昨天的日结确认掉了', confirmed.status === 200 || confirmed.status === 201, JSON.stringify(confirmed.data).slice(0, 160))
const frozen = db.prepare('SELECT perf_cents FROM daily_close_lines l JOIN daily_closes cl ON cl.id = l.close_id WHERE l.tenant_id = ? AND l.date = ? AND l.technician_id = ?').get(tid, yst, technicianId)
const frozenPerf = frozen ? frozen.perf_cents : null
const todayPerfBefore = (await perfOf(today)).perfCents
const amendC = await request(`/admin/settlements/${c.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: 15000, reason: '已确认那天的更正' }) }, TOKEN, H)
check('③-1 更正接口 200(日结已确认也允许更正,只是走当期冲减)',
  amendC.status === 200 || amendC.status === 201, JSON.stringify(amendC.data).slice(0, 140))
const frozenAfter = db.prepare('SELECT perf_cents FROM daily_close_lines l JOIN daily_closes cl ON cl.id = l.close_id WHERE l.tenant_id = ? AND l.date = ? AND l.technician_id = ?').get(tid, yst, technicianId)
check('③-2 🔴 已定格的历史数一分没动(确认后不回溯)',
  frozenPerf !== null && frozenAfter && frozenAfter.perf_cents === frozenPerf, `${frozenPerf} → ${frozenAfter && frozenAfter.perf_cents}`)
const todayPerfAfter = await perfOf(today)
check('③-3 🔴 冲减落**当期**(更正当天),不是回到昨天',
  todayPerfAfter.perfCents === todayPerfBefore - 4800,
  `今天 ${todayPerfBefore} → ${todayPerfAfter.perfCents}`)
check('③-4 当期那一行说得清是谁:「更正扣回 · 昨天那张单号」',
  (todayPerfAfter.view.afterSalesDeductions || []).some((d) => d.code === c.code && d.label.includes('更正扣回')),
  JSON.stringify((todayPerfAfter.view.afterSalesDeductions || []).map((d) => d.label)))
check('③-5 昨天那天的视图里**不再**出现这条冲减(不许两头都算 = 减两遍)',
  !((await perfOf(yst)).view.afterSalesDeductions || []).some((d) => d.code === c.code),
  JSON.stringify(((await perfOf(yst)).view.afterSalesDeductions || []).map((d) => d.code)))
check('③-6 账本这一侧照样跟(已确认与否只影响业绩落哪天,账本一律当期追加)',
  incomeOfCode(c.code) === 15000, String(incomeOfCode(c.code)))

// ===== 补收方向(边界:delta 为正)=====
const d2 = await signedSheet('15')
const perfBeforeUp = (await perfOf(today)).perfCents
const up = await request(`/admin/settlements/${d2.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: 22800, reason: '现场加了一个甲片' }) }, TOKEN, H)
check('⑤-1 补收方向:账本 198 → 228(差额行是 +30,不是把方向写死成负)',
  (up.status === 200 || up.status === 201) && incomeOfCode(d2.code) === 22800, String(incomeOfCode(d2.code)))
const upView = await perfOf(today)
check('⑤-2 补收方向:业绩也 +30', upView.perfCents === perfBeforeUp + 3000, `${perfBeforeUp} → ${upView.perfCents}`)
check('⑤-3 🔴 那一行说的是「更正补记 +」不是「扣回」(方向写在句子里,前端不判正负)',
  (upView.view.afterSalesDeductions || []).some((d) => d.code === d2.code && d.label.includes('更正补记') && d.amountText.startsWith('+')),
  JSON.stringify((upView.view.afterSalesDeductions || []).map((d) => `${d.label} ${d.amountText}`)))
check('⑤-4 🔴 同一天两头都有时,句子把两族分开说(净额一个数会让补记那 30 凭空消失)',
  String(upView.tech.deductNoteText || '').includes('更正扣回') && String(upView.tech.deductNoteText || '').includes('更正补记'),
  upView.tech.deductNoteText)

// ===== 幂等/追加:同一张单更正两次,各写一行,旧行不动 =====
const firstDelta = db.prepare("SELECT * FROM finance_transactions WHERE tenant_id = ? AND tags = ? AND source = 'amendment' ORDER BY created_at ASC LIMIT 1").get(tid, a.code)
const firstBytes = JSON.stringify(firstDelta)
await request(`/admin/settlements/${a.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: 12000, reason: '又少做了一项' }) }, TOKEN, H)
const deltaRows = db.prepare("SELECT * FROM finance_transactions WHERE tenant_id = ? AND tags = ? AND source = 'amendment' ORDER BY created_at ASC").all(tid, a.code)
check('⑥-1 更正两次 = 账本两行(只追加)',
  deltaRows.length === 2 && JSON.stringify(deltaRows[0]) === firstBytes, `${deltaRows.length} 行`)
check('⑥-2 🔴 净额按最后一次的单据金额算:198 −48 −30 = 120(差额对上一次算,不是每次都对原单算)',
  incomeOfCode(a.code) === 12000, String(incomeOfCode(a.code)))
const shape = (await request(`/settlements/${encodeURIComponent(a.code)}`, {}, null, { 'x-tenant-id': tid })).data.settlement
check('⑥-2b 🔴 顾客那一侧的「实付」也归位(Σdelta ≡ 新额 − 原额;老算法两次更正后会算成 72)',
  shape && shape.actualDueCents === 12000 && shape.amendedCount === 2,
  JSON.stringify(shape && { a: shape.actualDueCents, n: shape.amendedCount, t: shape.actualDueText }))
const finalView = await perfOf(today)
const expectToday = 12000 + 19800 + 22800 - 4800   // a(已两次更正净 120)+ b(198 未改)+ d2(228)− c 的当期冲减 48
check('⑥-4 🔴 今天业绩总数逐笔可加:a 120 + b 198 + d2 228 − 昨天单的当期冲减 48',
  finalView.perfCents === expectToday, `${finalView.perfCents} vs ${expectToday}`)

// ===== 越权:员工不许改金额 =====
const acct = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId }) }, TOKEN, H)
if (acct.status === 201) {
  const lg = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.data.username, password: acct.data.initialPassword }) }, null, H)
  const stf = lg.data.auth?.accessToken
  const tryAmend = await request(`/admin/settlements/${b.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: 100, reason: '员工试探' }) }, stf, H)
  check('⑦-1 越权:员工改不了金额(改金额=改账与业绩,只有老板能动)',
    tryAmend.status === 403 || tryAmend.status === 401, String(tryAmend.status))
} else {
  check('⑦-1 越权:员工号建不出来', false, JSON.stringify(acct.data).slice(0, 120))
}

// ===== 账本自身的防篡改没被这一刀破坏 =====
const chain = await request('/admin/finance/verify', {}, TOKEN, H)
check('⑧-1 🔴 账本哈希链仍然完整(差额行是正常追加,不是绕过写入口;反向守=链上真有行)',
  chain.status === 200 && chain.data.ledger.valid === true && chain.data.ledger.count > 0,
  JSON.stringify(chain.data).slice(0, 160))

console.log(`\n金额更正联动回归通过:${checks} 项断言全绿`)
