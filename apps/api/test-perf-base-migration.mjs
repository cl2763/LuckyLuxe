/* 分成基数迁移回归(2026-08-09,店主拍板:基数一律 = 档位小计)。

   验的是 migratePerfBaseToSubtotal() 这段一次性迁移本身 —— 它只在启动时跑,
   所以这个套件自己起一份实例、造出「旧口径」的数据、把实例重启一次,再看迁移把数据改对了没有。

   造旧数据的方式是**直连库改成旧口径**(perf_base=应收、分成按应收摊、日结快照按应收),
   等于把 08-09 之前的生产/演示库还原出来,再让新代码去迁。

   两条硬断言(店主点名要的):
     ① 迁移后 perf_base_cents ≡ subtotal_cents,一张不落;分成合计也必须正好等于新基数
     ② **无定金无券的单迁移前后逐分不变** —— 那种单档位小计本来就等于应收
   外加:已确认日结的 daily_close_lines 快照跟着刷新(排行/工资试算/员工端都读这张表)。 */
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PERF_BASE_TEST_PORT || '4178'
const BASE = `http://127.0.0.1:${PORT}`
const PLATFORM = 'owner-demo-token'
const RUN = Date.now().toString(36)
const DATA_DIR = mkdtempSync(join(tmpdir(), 'll-perfbase-'))
const DB_PATH = join(DATA_DIR, 'lucky-luxe.sqlite')

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

let child = null
async function boot() {
  child = spawn(process.execPath, [join(here, 'local-server.mjs')], {
    env: { ...process.env, DATA_DIR, PORT, ALLOW_DEMO_ADMIN_LOGIN: 'true', OWNER_TOKEN: PLATFORM },
    stdio: 'ignore'
  })
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch { /* 还没起来 */ }
  }
  throw new Error('实例 30 秒内没起来')
}
async function halt() {
  if (!child) return
  child.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 800))
  try { child.kill('SIGKILL') } catch { /* 已退出 */ }
  child = null
}

const keys = new Map()
async function req(path, options = {}, token = PLATFORM) {
  const fk = token ? keys.get(token) : null
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(fk ? { 'x-finance-key': fk } : {}),
      ...(options.headers || {})
    }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: res.status, data }
}

async function main() {
  await boot()

  // ---- 建店 + 价目 + 顾客 + 技师 ----
  const tenantId = `pbm-${RUN}`
  const created = await req('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tenantId, name: `基数店${RUN}`, plan: 'chain' }) })
  const { username, initialPassword } = created.data.owner
  const first = await req('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pb-${RUN}9x`
  await req('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const token = (await req('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)).data.auth.accessToken
  const unlock = await req('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) keys.set(token, unlock.data.financeKey)

  const cat = (await req('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail', name: '美甲' }) }, token)).data.category
  const svc = (await req('/admin/pricing/items', {
    method: 'POST',
    body: JSON.stringify({ nameZh: '主项目', type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 20000, memberPriceCents: 20000 })
  }, token)).data.item
  await req('/admin/deposit-config', { method: 'PUT', body: JSON.stringify({ config: { enabled: true, deductible: true, mode: 'fixed', fixedAmountCents: 5000 } }) }, token)

  const imp = await req(`/platform/tenants/${tenantId}/import/customers`, {
    method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `客${RUN}`, phone: `1390${RUN.slice(-7)}`, balanceCents: 0 }] })
  })
  const user = imp.data.users[0].userId
  const techA = (await req(`/platform/tenants/${tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `甲${RUN}` }) })).data.technician
  const techB = (await req(`/platform/tenants/${tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `乙${RUN}` }) })).data.technician

  /* 单 A:带定金(¥200 档位小计 − ¥50 定金 = ¥150 应收),双技师 70/30
     单 B:无定金无券(¥200 全额),单技师 —— 用它验「迁移前后逐分不变」
     v1.2 §五 补拍①:抵扣依据＝收取记录,所以单 A 要挂一张**标记过已收定金**的预约。 */
  const bkA = (await req('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: user, serviceId: svc.id, technicianId: techA.id, date: new Date().toLocaleDateString('en-CA'), time: '13:10', durationMin: 60, depositPaid: false })
  }, token)).data.booking
  await req(`/admin/bookings/${bkA.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, token)
  const group = await req('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [
        { bookingId: bkA.id, tierKey: 'list', depositApplied: true, items: [{ serviceId: svc.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }, { technicianId: techB.id, role: 'assist', itemNos: [1] }] },
        { tierKey: 'list', depositApplied: false, items: [{ serviceId: svc.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }
      ]
    })
  }, token)
  const [withDeposit, noDeposit] = group.data.settlements
  check('单 A 带定金:档位小计 ¥200 / 应收 ¥150', withDeposit.subtotalCents === 20000 && withDeposit.totalCents === 15000,
    JSON.stringify({ s: withDeposit.subtotalCents, t: withDeposit.totalCents }))
  check('单 B 无定金无券:档位小计 = 应收 ¥200', noDeposit.subtotalCents === 20000 && noDeposit.totalCents === 20000)

  for (const sheet of [withDeposit, noDeposit]) {
    const signed = await req(`/settlements/${sheet.code}/sign`, {
      method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '客', strokes: [[{ x: 5, y: 5 }, { x: 20, y: 20 }]] })
    }, null)
    if (signed.status !== 200) throw new Error(`签字失败: ${JSON.stringify(signed.data)}`)
  }
  await req(`/admin/settlements/${withDeposit.id}/allocate`, {
    method: 'POST', body: JSON.stringify({ shares: [{ technicianId: techA.id, pct: 70 }, { technicianId: techB.id, pct: 30 }] })
  }, token)
  const today = (await req('/admin/daily-close', {}, token)).data.dailyClose.date
  const confirmed = await req('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, token)
  check('日结已确认', confirmed.data.status === 'confirmed', JSON.stringify(confirmed.data).slice(0, 200))

  await halt()

  /* ---- 把库改回「旧口径」:基数 = 应收,分成按应收摊,日结快照按应收 ---- */
  const db = new DatabaseSync(DB_PATH)
  db.prepare('UPDATE settlements SET perf_base_cents = total_cents WHERE tenant_id = ?').run(tenantId)
  // 单 A 旧分成:15000 × 70/30 = 10500 / 4500
  db.prepare("UPDATE settlement_technicians SET share_cents = 10500 WHERE settlement_id = ? AND role = 'main'").run(withDeposit.id)
  db.prepare("UPDATE settlement_technicians SET share_cents = 4500 WHERE settlement_id = ? AND role = 'assist'").run(withDeposit.id)
  const closeId = db.prepare('SELECT id FROM daily_closes WHERE tenant_id = ? AND date = ?').get(tenantId, today).id
  db.prepare('UPDATE daily_close_lines SET perf_cents = 30500 WHERE close_id = ? AND technician_id = ?').run(closeId, techA.id) // 10500 + 20000
  db.prepare('UPDATE daily_close_lines SET perf_cents = 4500 WHERE close_id = ? AND technician_id = ?').run(closeId, techB.id)
  const beforeNoDeposit = db.prepare('SELECT perf_base_cents, total_cents, subtotal_cents FROM settlements WHERE id = ?').get(noDeposit.id)
  check('旧口径已还原:单 A 基数 = 应收 ¥150', db.prepare('SELECT perf_base_cents FROM settlements WHERE id = ?').get(withDeposit.id).perf_base_cents === 15000)
  check('旧口径下单 B 基数本来就 = 档位小计(无定金无券)',
    beforeNoDeposit.perf_base_cents === beforeNoDeposit.subtotal_cents && beforeNoDeposit.perf_base_cents === beforeNoDeposit.total_cents,
    JSON.stringify(beforeNoDeposit))
  db.close()

  /* ---- 重启 = 迁移跑一遍 ---- */
  await boot()
  const db2 = new DatabaseSync(DB_PATH)
  const bad = db2.prepare('SELECT COUNT(*) AS n FROM settlements WHERE perf_base_cents <> subtotal_cents').get().n
  check('① 迁移后 perf_base ≡ 档位小计(全库一张不落)', bad === 0, `还有 ${bad} 张不一致`)
  const a = db2.prepare('SELECT perf_base_cents FROM settlements WHERE id = ?').get(withDeposit.id)
  check('① 带定金的单基数升到档位小计 ¥200', a.perf_base_cents === 20000, String(a.perf_base_cents))
  const shares = db2.prepare('SELECT role, share_cents FROM settlement_technicians WHERE settlement_id = ? ORDER BY rowid ASC').all(withDeposit.id)
  const sum = shares.reduce((n, s) => n + s.share_cents, 0)
  check('① 分成按原比例重算且合计正好等于新基数', sum === 20000 && shares[0].share_cents === 14000 && shares[1].share_cents === 6000,
    JSON.stringify(shares))
  const afterNoDeposit = db2.prepare('SELECT perf_base_cents, total_cents FROM settlements WHERE id = ?').get(noDeposit.id)
  check('② 无定金无券的单迁移前后逐分不变',
    afterNoDeposit.perf_base_cents === beforeNoDeposit.perf_base_cents && afterNoDeposit.total_cents === beforeNoDeposit.total_cents,
    JSON.stringify({ before: beforeNoDeposit, after: afterNoDeposit }))
  const lines = db2.prepare('SELECT technician_id, perf_cents FROM daily_close_lines WHERE close_id = ?').all(closeId)
  const byTech = {}
  for (const l of lines) byTech[l.technician_id] = l.perf_cents
  check('日结快照跟着刷新:甲 = 14000 + 20000 = ¥340', byTech[techA.id] === 34000, String(byTech[techA.id]))
  check('日结快照跟着刷新:乙 = ¥60', byTech[techB.id] === 6000, String(byTech[techB.id]))
  db2.close()

  // 排行 / 工资试算读的是同一张快照,所以数字必须一致(同源,不是两套算法算出一样)
  const rank = await req(`/admin/perf-ranking?metric=perf&period=day&date=${today}`, {}, token)
  const rankA = (rank.data.ranking.ranking || []).find((r) => r.technicianId === techA.id)
  check('排行与刷新后的日结同源一致', rankA && rankA.perfCents === 34000, JSON.stringify(rankA))

  // 幂等:再重启一次,数字一分不动
  await halt()
  await boot()
  const db3 = new DatabaseSync(DB_PATH)
  const again = db3.prepare('SELECT perf_base_cents FROM settlements WHERE id = ?').get(withDeposit.id).perf_base_cents
  const againLines = db3.prepare('SELECT perf_cents FROM daily_close_lines WHERE close_id = ? AND technician_id = ?').get(closeId, techA.id).perf_cents
  db3.close()
  check('迁移幂等:再跑一遍数字不动', again === 20000 && againLines === 34000, JSON.stringify({ again, againLines }))

  console.log(`\n分成基数迁移回归通过:${checks} 项断言全绿`)
}

main()
  .then(async () => { await halt(); rmSync(DATA_DIR, { recursive: true, force: true }) })
  .catch(async (error) => {
    await halt()
    rmSync(DATA_DIR, { recursive: true, force: true })
    console.error(`\n✗ ${error.message}`)
    process.exit(1)
  })
