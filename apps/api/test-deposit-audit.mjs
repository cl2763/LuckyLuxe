/* 定金守恒 · 定时自检(店主 2026-08-29 两票之一)。

   店主原话规格:每日日结确认后后台自动跑;**平 = 什么都不显示;不平 = 日结页红字
   「定金对不上,差 $X」(后端出句)**。

   判据两向(店主给的):
     · 造一笔故意不平的 → 红字出现且**金额对**;
     · 平的日子 → 日结页**零新增元素**(响应里连字段都没有,不是空字符串)。
   变异:摘掉调度 → 断言红(在交付流程里做,此套件守行为)。

   ⚠️ standalone:CI_SUITES="deposit-audit" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'

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

const tid = `depaud-${RUN}`
if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `守恒店${RUN}`, plan: 'chain' }) })).status !== 201) throw new Error('建店失败')
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const today = (await request('/admin/store-clock', {}, PLATFORM, H)).data.today
const dcOf = async () => (await request(`/admin/daily-close?date=${today}`, {}, PLATFORM, H)).data.dailyClose

/* ===== ① 平的那一向:确认日结 → 响应里连 depositAlert 字段都没有 ===== */
const confirm1 = await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, PLATFORM, H)
check('① 空店日结确认成功(自检同步跑了)', confirm1.status === 200 && confirm1.data.confirmed === true, JSON.stringify(confirm1.data).slice(0, 120))
const flat = await dcOf()
check('🔴 ① 平的日子:响应里**没有 depositAlert 字段**(不是空字符串,是根本不出现)',
  !('depositAlert' in flat), JSON.stringify(Object.keys(flat)).slice(0, 200))
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH') })())
const auditRow = db.prepare('SELECT deposit_audit_json FROM daily_closes WHERE tenant_id = ? AND date = ?').get(tid, today)
check('① 但审计**确实跑了并落了库**(平≠没审;哪天审的、审出什么,和日结钉在一起)',
  Boolean(auditRow?.deposit_audit_json) && JSON.parse(auditRow.deposit_audit_json).brokenCount === 0,
  String(auditRow?.deposit_audit_json))

/* ===== ② 不平的那一向:造一笔「负债减少了却没有等额收入」 =====
   直插一条已兑现(settled_settlement_id 非空)的 receipt,金额 $77,不给收入行 ——
   这正是守恒审计要抓的病。deposit_receipts 的锁锁的是改列,INSERT 留痕是合法的。 */
db.prepare(`INSERT INTO deposit_receipts (id, tenant_id, booking_id, user_id, kind, amount_cents, pay_channel, settled_settlement_id, actor, created_at)
  VALUES (?, ?, ?, ?, 'receipt', 7700, 'offline', ?, 'test-fixture', ?)`)
  .run(`depr-${RUN}`, tid, `bk-${RUN}`, `u-${RUN}`, `stl-${RUN}`, new Date().toISOString())
const reconfirm = await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, PLATFORM, H)
check('② 再确认一次(重开免了:同日重复确认走 UPDATE,自检重跑)', reconfirm.status === 200)
const broken = await dcOf()
check('🔴 ② 不平:红字出现,句子后端出、**金额正好是差的 $77**',
  broken.depositAlert && broken.depositAlert.missingCents === 7700
  && broken.depositAlert.text.includes('定金对不上') && /(?:^|[^0-9])77(?:[^0-9]|$)/.test(broken.depositAlert.text),
  JSON.stringify(broken.depositAlert))
check('② 笔数也对(1 笔)', broken.depositAlert.brokenCount === 1, String(broken.depositAlert?.brokenCount))

/* ===== ③ 修好之后回平:补上等额收入行 → 重确认 → 红字消失 ===== */
const repair = await request('/admin/finance/deposit-conservation/repair', { method: 'POST', body: JSON.stringify({}) }, PLATFORM, H)
check('③ 修复口把缺的收入行补上了', repair.status === 200 && repair.data.ok === true, JSON.stringify(repair.data).slice(0, 160))
await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, PLATFORM, H)
const fixed = await dcOf()
check('🔴 ③ 回平:红字整个消失(字段不出现),不是留一条「差 $0」', !('depositAlert' in fixed), JSON.stringify(fixed.depositAlert || null))

/* ===== ④ 运行时取证:两端实发资源里,红字都是**条件渲染**(平的日子零新增元素) ===== */
const servedDcr = await fetch(`${BASE_URL}/web/daily-close-rows.js`).then((r) => r.text())
check('④ 网页(实发资源):红字锚点在场且被 v.depositAlert 条件包着',
  servedDcr.includes('dc-deposit-alert') && servedDcr.includes('v.depositAlert ?'))
const { readFileSync } = await import('node:fs')
const miniDc = readFileSync(new URL('../../miniprogram/utils/dailyclose.js', import.meta.url), 'utf8')
const miniWxml = readFileSync(new URL('../../miniprogram/pages/merchant/daily-close/index.wxml', import.meta.url), 'utf8')
check('④ 小程序:同一句后端出句进 view model,wxml 上 wx:if 条件渲染',
  miniDc.includes('dc.depositAlert ? dc.depositAlert.text') && miniWxml.includes('wx:if="{{v.depositAlert}}"'))

console.log(`\n✅ test-deposit-audit 通过 ${checks} 项`)
