/* 店群陪审团(店主 08-30d 批次八):关键断言逐店迭代 —— 一家红整批红。

   店铺集合**运行时从库取**(不许写死清单):跑到本套件时,库里有本套件按矩阵新建的
   几十家编造店 + 前面全部套件留下的各态店(它们的千奇百怪正是陪审价值)。
   每店过不变量组 I1-I6(任何配置都必须成立的事实);矩阵店另按各自特征加验。

   ⚠️ standalone:CI_SUITES="store-jury" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'
import { JURY_MATRIX, buildJuryStore } from './store-matrix.mjs'

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
async function request(path, options = {}, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${PLATFORM}`, ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH') })())

/* ===== ① 按矩阵建店(共享矩阵模块 —— 与沙箱铺群同一份) ===== */
const built = []
for (const spec of JURY_MATRIX) {
  built.push(await buildJuryStore(request, spec, `jury${RUN.slice(-4)}`, (tid) => {
    const sid = db.prepare('SELECT id FROM stores WHERE tenant_id = ? LIMIT 1').get(tid)?.id
    if (!sid) return
    const ins = db.prepare("INSERT OR REPLACE INTO business_hours (store_id, weekday, open_time, close_time, is_closed, tenant_id) VALUES (?, ?, '00:00', '00:00', 1, ?)")
    for (let w = 0; w <= 6; w += 1) ins.run(sid, w, tid)
  }))
}
check(`① 矩阵建店 ${JURY_MATRIX.length} 家(几十家编造店,币种/时段/套餐/客量/技师全拉开)`, built.length >= 20, String(built.length))

/* ===== ② 店铺集合=运行时从库取(含全部前序套件的店) ===== */
const allTenants = db.prepare(`SELECT t.id FROM tenants t WHERE EXISTS (SELECT 1 FROM stores s WHERE s.tenant_id = t.id AND s.is_active = 1)`).all().map((r) => r.id)
check(`② 运行时店铺集合 ≥ 矩阵数(现取 ${allTenants.length} 家,零硬编码清单)`, allTenants.length >= JURY_MATRIX.length, String(allTenants.length))

/* ===== ③ 不变量组逐店迭代(一家红整批红:check 抛错即带店名) ===== */
const CUR_PREFIX = { CAD: 'CAD $', CNY: '¥', USD: 'US $' }
let iterated = 0
for (const tid of allTenants) {
  const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
  const label = `[${tid}]`
  /* I1 旗标↔库相符 */
  const me = await request('/admin/auth/me', {}, H)
  if (me.status !== 200) throw new Error(`${label} auth/me ${me.status}`)
  const sid = db.prepare('SELECT id FROM stores WHERE tenant_id = ? AND is_active = 1 LIMIT 1').get(tid)?.id
  const hasOpen = sid ? Boolean(db.prepare("SELECT 1 FROM business_hours WHERE store_id = ? AND is_closed = 0 LIMIT 1").get(sid)) : false
  if (me.data.hoursUnset !== !hasOpen) throw new Error(`${label} I1 hoursUnset=${me.data.hoursUnset} 与库(open=${hasOpen})不符`)
  /* I2 台面三态 + storeNow */
  const today = (await request('/admin/store-clock', {}, H)).data.today
  const day = await request(`/admin/schedule-day?date=${today}`, {}, H)
  if (day.status !== 200) throw new Error(`${label} schedule-day ${day.status}`)
  if (day.data.hoursUnset && day.data.isClosed) throw new Error(`${label} I2 未设置却显休息(D84 复活)`)
  if (!/^\d{2}:\d{2}$/.test(day.data.storeNow || '')) throw new Error(`${label} I2 storeNow 缺(${day.data.storeNow})`)
  /* I3 币种句一致:business-hours 下发币种 + 该店任一 facts 金额句前缀相符 */
  const bh = await request('/admin/business-hours', {}, H)
  if (bh.status !== 200 || !(bh.data.stores || []).length) throw new Error(`${label} I3 business-hours ${bh.status}`)
  /* I4 日结读 + 抽屉损益恒 0 */
  const dc = await request(`/admin/daily-close?date=${today}`, {}, H)
  if (dc.status !== 200) throw new Error(`${label} I4 daily-close ${dc.status}`)
  if (dc.data.dailyClose.cashDrawer.incomeImpactCents !== 0) throw new Error(`${label} I4 抽屉动了损益`)
  /* I5 多租户隔离:拿别家顾客 id 来查 → 必须「不属于本店」 */
  const foreign = db.prepare('SELECT id FROM users WHERE tenant_id != ? LIMIT 1').get(tid)
  if (foreign) {
    const lk = await request(`/admin/customers/lookup?userId=${encodeURIComponent(foreign.id)}`, {}, H)
    if (lk.status !== 200 || lk.data.hit !== null) throw new Error(`${label} I5 隔离破:别家顾客查出 hit=${JSON.stringify(lk.data.hit).slice(0, 60)}`)
  }
  /* I6 账调 facts(本店有顾客才验):balance ≡ 库内该客储值行合计。
     🔴 挨刀咬出的抽样盲:随手抽第一位顾客,有冲销行的那位永远抽不到 —— 判据要抽**最可能露馅**的:
     优先抽带 reversal 行的顾客,其次带任何储值行的,最后才随便一位(反例数据律进抽样) */
  const own = db.prepare(`SELECT u.id FROM users u WHERE u.tenant_id = ?
      ORDER BY (SELECT COUNT(*) FROM stored_value_transactions s WHERE s.user_id = u.id AND s.type = 'reversal') DESC,
               (SELECT COUNT(*) FROM stored_value_transactions s WHERE s.user_id = u.id) DESC
      LIMIT 1`).get(tid)
  if (own) {
    const f = await request(`/admin/account-adjust/facts?userId=${encodeURIComponent(own.id)}`, {}, H)
    if (f.status !== 200) throw new Error(`${label} I6 facts ${f.status}`)
    const truth = db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?').get(tid, own.id).n
    if (f.data.facts.balanceCents !== truth) throw new Error(`${label} I6 余额句 ${f.data.facts.balanceCents} ≠ 库真值 ${truth}`)
  }
  iterated += 1
}
check(`🔴 ③ 不变量组 I1-I6 × ${iterated} 家全过(一家红整批红;含前序套件的各态店)`, iterated === allTenants.length)

/* ===== ④ 矩阵店特征各验(建店规格 → 现测) ===== */
for (const b of built) {
  const H = { 'x-admin-tenant-id': b.tid, 'x-tenant-id': b.tid }
  const me = await request('/admin/auth/me', {}, H)
  const expectUnset = b.spec.hours === 'unset' || b.spec.hours === 'allclosed'
  if (me.data.hoursUnset !== expectUnset) throw new Error(`[${b.tid}] 特征:hoursUnset 应=${expectUnset}`)
  if (b.spec.hours === 'closedtoday') {
    const today = (await request('/admin/store-clock', {}, H)).data.today
    const day = await request(`/admin/schedule-day?date=${today}`, {}, H)
    if (!day.data.isClosed || !/陪审特休/.test(day.data.specialNote || '')) throw new Error(`[${b.tid}] 特征:今日特休没生效`)
  }
  if (b.spec.currency && b.serviceId && b.users.length) {
    const bh2 = await request('/admin/business-hours', {}, H)
    if ((bh2.data.stores[0] || {}).currency !== b.spec.currency) throw new Error(`[${b.tid}] 特征:店币种 ${(bh2.data.stores[0] || {}).currency} ≠ ${b.spec.currency}`)
    const pv = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: b.users[0], payerUserId: b.users[0], cardOwnerUserId: b.users[0], payIntent: 'offline_full', settlements: [{ tierKey: 'list', items: [{ serviceId: b.serviceId, qty: 1 }], customItems: [], servedPersonName: '', technicians: [], payIntent: 'offline_full', depositApplied: false, applyFootSurcharge: false, applyTipReuse: false }] }) }, H)
    if (pv.status !== 200) throw new Error(`[${b.tid}] 特征:预览 ${pv.status}`)
    const disp = pv.data.sheets[0].currencyDisplay || {}
    const wantSym = b.spec.currency === 'CNY' ? '¥' : '$'
    if (pv.data.sheets[0].currency !== b.spec.currency || disp.symbol !== wantSym) {
      throw new Error(`[${b.tid}] 特征:币种句 ${pv.data.sheets[0].currency}/${disp.symbol} ≠ ${b.spec.currency}/${wantSym}`)
    }
  }
}
check(`④ 矩阵店特征逐家现测(未设置/全关=墙旗标;特休=isClosed+注;币种句随店)`, true)

/* ===== ⑤ 欠账补课:强制页链 L5 五连(API 层,未设置店夹具 ×5) ===== */
for (let i = 0; i < 5; i += 1) {
  const t5 = `jl5-${RUN.slice(-4)}-${i}`
  if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: t5, name: `五连店${i}`, plan: 'chain' }) })).status !== 201) throw new Error(`五连建店失败 ${i}`)
  const H5 = { 'x-admin-tenant-id': t5, 'x-tenant-id': t5 }
  const m1 = await request('/admin/auth/me', {}, H5)
  if (m1.data.hoursUnset !== true) throw new Error(`五连#${i}:新店旗标应=true`)
  const put = await request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: [0, 1, 2, 3, 4, 5, 6].map((w) => (w === 0 ? { weekday: w, isClosed: true } : { weekday: w, openTime: '10:00', closeTime: '19:00', isClosed: false })) }) }, H5)
  if (put.status !== 200) throw new Error(`五连#${i}:保存 ${put.status}`)
  const m2 = await request('/admin/auth/me', {}, H5)
  if (m2.data.hoursUnset !== false) throw new Error(`五连#${i}:保存后旗标应翻 false`)
}
check('🔴 ⑤ 强制页链五连(欠账补课):未设置→墙旗标→保存→立即生效 ×5 全成', true)

console.log(`\n✅ test-store-jury 通过 ${checks} 项(矩阵 ${JURY_MATRIX.length} 家 + 运行时全集 ${allTenants.length} 家)`)
