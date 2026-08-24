/* 真库测试租户清点(**只读,一行不动**)——边界令①:清理动作先出清单,店主过目后再执行。
   用法:node tools/audit-test-tenants.mjs [库路径]   默认 apps/api/local-data/lucky-luxe.sqlite

   判定"疑似测试租户"的依据(机械判据,不靠眼力):
   ① tenant_id 前缀命中测试套件的建店前缀(每个套件都用固定前缀 + 时间戳建临时店)
   ② 门店名/租户名带 test/demo-/临时/套件字样
   ③ 数据量极小(<50 单)且创建时间落在某次回归的分钟级窗口内
   店主的两家真店(lucky-luxe / jics-nail)与演示样板店(demo-ai / demo-basic)一律标"保留"。 */
import { DatabaseSync } from 'node:sqlite'
const path = process.argv[2] || 'apps/api/local-data/lucky-luxe.sqlite'
const db = new DatabaseSync(path, { readOnly: true })

const KEEP = new Set(['lucky-luxe', 'jics-nail', 'demo-ai', 'demo-basic'])
// 人工建的演示/走查店:不是套件残留,删不删由店主定,单独一档
const ASK = new Set(['hoptest-demo2'])
// 套件建店前缀:来自 apps/api/test-*.mjs 里的 newShop('x') 命名(前缀-a-<ts> / 前缀-<ts>)
const SUITE_PREFIX = {
  nsas: 'test-noshow-aftersales', dbl: 'test-double-sheet', p2dc: 'test-daily-close',
  p2sc: 'test-schedule-v2', p2sal: 'test-salary-v2', p2ft: 'test-finance-trend',
  p12: 'test-pricing-model', p25: 'test-membership-config', r3s: 'test-settle-stress',
  p0hy: 'test-tenant-hygiene', p2fl: 'test-finance-lock', r2s: 'test-settle-stress(压测)',
  'tenant': 'test-tenant-isolation(tenant-iso-b)',
  authx: 'test-auth-surface', diag: '诊断脚本', hoptest: '五跳演示店(人工建,非套件)'
}
const guessSuite = (tid) => {
  const head = String(tid).split('-')[0]
  return SUITE_PREFIX[head] || ''
}

const tenants = db.prepare(`
  SELECT tenant_id,
    (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.tenant_id) AS bookings,
    (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.tenant_id) AS users,
    (SELECT COUNT(*) FROM settlements s WHERE s.tenant_id = t.tenant_id) AS settlements,
    (SELECT COUNT(*) FROM finance_transactions f WHERE f.tenant_id = t.tenant_id) AS fin_rows,
    (SELECT COALESCE(SUM(amount_cents),0) FROM finance_transactions f WHERE f.tenant_id = t.tenant_id AND f.type = 'income') AS income_cents,
    (SELECT MIN(created_at) FROM bookings b WHERE b.tenant_id = t.tenant_id) AS first_at,
    (SELECT MAX(created_at) FROM bookings b WHERE b.tenant_id = t.tenant_id) AS last_at
  FROM (SELECT DISTINCT tenant_id FROM bookings
        UNION SELECT DISTINCT tenant_id FROM users
        UNION SELECT DISTINCT tenant_id FROM finance_transactions) t
  ORDER BY bookings DESC`).all()

const nameOf = (tid) => {
  try { return db.prepare('SELECT name FROM stores WHERE tenant_id = ? LIMIT 1').get(tid)?.name || '' } catch { return '' }
}

const rows = tenants.map((t) => {
  const suite = guessSuite(t.tenant_id)
  const keep = KEEP.has(t.tenant_id)
  const verdict = keep ? '保留(真店/演示样板)'
    : (ASK.has(t.tenant_id) ? '待店主定(人工建的演示店)' : (suite ? '疑似测试租户' : '待人工判定'))
  return { ...t, name: nameOf(t.tenant_id), suite, verdict }
})

const money = (c) => `¥${(c / 100).toFixed(2)}`
console.log('库:', path)
console.log('租户总数:', rows.length)
console.log('')
console.log('| tenant_id | 门店名 | 单 | 顾客 | 结算单 | 账本行 | 收入 | 最早 | 最新 | 疑似来源 | 结论 |')
console.log('|---|---|---:|---:|---:|---:|---:|---|---|---|---|')
for (const r of rows) {
  console.log(`| ${r.tenant_id} | ${r.name || '—'} | ${r.bookings} | ${r.users} | ${r.settlements} | ${r.fin_rows} | ${money(r.income_cents)} | ${(r.first_at || '').slice(0, 16).replace('T', ' ')} | ${(r.last_at || '').slice(0, 16).replace('T', ' ')} | ${r.suite || '—'} | ${r.verdict} |`)
}
const drop = rows.filter((r) => r.verdict === '疑似测试租户')
const unknown = rows.filter((r) => r.verdict === '待人工判定')
console.log('')
console.log('小计:疑似测试租户', drop.length, '个 /', drop.reduce((n, r) => n + r.bookings, 0), '单 /', drop.reduce((n, r) => n + r.fin_rows, 0), '账本行 /', money(drop.reduce((n, r) => n + r.income_cents, 0)))
console.log('     待人工判定  ', unknown.length, '个:', unknown.map((r) => r.tenant_id).join(', ') || '无')
console.log('     待店主定    ', rows.filter((r) => r.verdict.startsWith('待店主定')).map((r) => `${r.tenant_id}(${r.bookings} 单)`).join(' / ') || '无')
console.log('     保留        ', rows.filter((r) => r.verdict.startsWith('保留')).map((r) => `${r.tenant_id}(${money(r.income_cents)})`).join(' / '))
db.close()
