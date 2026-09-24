/* 🔴 此脚本永不对生产跑(J-114,店主 2026-09-22 立) —— 它会凭空造出人或钱。 */
/* CI 专用:给沙箱种上那四套判据要的夹具(夜班令15 §二「(丙)」)
 *
 * 🔴 为什么要有它:CI 上 `apps/api/sandbox-data/` 不存在(gitignore),`ensureSandbox()` 起的是**空库** ——
 * 沙箱服务是好的,缺的是**夹具数据**(09y §一 裁定;夜15 §一 用「下游跑了」那条正例证过)。
 * 于是 `correction-reason` / `tenant-ownership` / `tier-label` / `demo-mark` 四套造不出阳性,
 * 按 J-58①「造不出阳性不许说验过」只能红。
 *
 * 🔴 两条护栏一个字没动:
 *   ① 种的是**临时 DATA_DIR**(不碰仓内 sandbox-data、不碰 4128);
 *   ② 那个临时目录**以 `sandbox-data` 收尾** —— 种子自带的 `requireSandbox()` 只认路径里这一段,
 *      于是「只种临时目录」与「只许沙箱」同时成立,**不用改任何护栏**。
 * 🔴 夹具一律**走正门**(J-60):租户与顾客都用产品自己的 `/platform/*` 口,不直接写库。
 * 🔴 目标(库路径 / 基址)一律走 `requireTarget` —— 第一版我写成 .sh 并自己拼路径,
 *    `test-db-target-guard ①c/①d` 当场点名 5 个解析点。**咬得对:自己解析目标就得自己被守住。**
 */
import { existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { requireTarget, requireSandbox, resolveDbPath } from './db-target.mjs'

import { assertNotProductionByPath } from './never-on-production.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SB_DIR = requireTarget({
  envName: 'SANDBOX_DATA_DIR=<临时沙箱数据目录,必须以 sandbox-data 收尾>',
  value: process.env.SANDBOX_DATA_DIR,
  hint: '(CI 上用 $RUNNER_TEMP/ll-ci-sandbox/sandbox-data;本机不要指向仓内 sandbox-data)',
})
/* 🔴 J-114 运行时闸(11l §四)· 接的是上面 requireTarget **已经验过的那个值**,
   不自己再读一次 env —— `test-db-target-guard` ①d 按**解析点**判:
   每多一处裸 `process.env.<目标>` 就是一个没被守住的解析点,而那正是 03q 那次「本机库又被写了」的通道。 */
assertNotProductionByPath(SB_DIR)
const BASE = requireTarget({
  envName: 'SEED_BASE_URL=<沙箱基址>',
  value: process.env.SEED_BASE_URL,
  hint: '(CI 上是 http://127.0.0.1:4310 —— 由本脚本自己起的那一台)',
})

const sh = (cmd, args, env) => new Promise((res) => {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' })
  p.on('exit', (c) => res(c ?? 1))
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(SB_DIR, { recursive: true })
console.log(`① 起沙箱 → ${SB_DIR}`)
spawn('bash', ['start-sandbox.sh', SB_DIR], { cwd: join(ROOT, 'apps/api'), detached: true, stdio: 'ignore' }).unref()
let alive = false
for (let i = 0; i < 60 && !alive; i += 1) {
  try { const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) }); alive = r.ok } catch { /* 还没起来 */ }
  if (!alive) await sleep(1000)
}
if (!alive) { console.error(`🔴 沙箱拉不起来(${BASE})`); process.exit(1) }
console.log('   ✅ 沙箱活着')

/* 🔴 库路径**问活着的那台服务要**,不在这里拼 —— 拼一次就多一个「硬编码目标」
   (`test-db-target-guard ①d` 现场点名过),而且拼错了不报错。同 J-62②:从事实那一头读回来。 */
const DB = await resolveDbPath(BASE)
requireSandbox(DB, 'ci-seed-sandbox')          // 路径里必须带 /sandbox-data/,不然当场拒
console.log(`   服务自报库路径:${DB}`)

console.log('② 种样本单 + demo_seed(seed-demo-rich,自带 requireSandbox 护栏)')
if (await sh('node', ['tools/seed-demo-rich.mjs'], { SEED_DB: DB })) { console.error('🔴 seed-demo-rich 失败'); process.exit(1) }

console.log('③ 建 B 店(jics-nail)+ 一个顾客 —— 🔴 走正门(J-60),用产品自己的平台口')
const { requireOwnerToken } = await import(join(ROOT, 'apps/api/owner-token.mjs'))
const TOK = requireOwnerToken({ dataDir: SB_DIR })
/* 🔴 造景全族的规矩:走 HTTP 就必须发 `x-demo-seed` —— 种出来的行要能被认出是造的,
   否则它们在库里与真顾客长得一模一样(《假数回落红线》那一族)。
   `test-demo-mark ④` 白名单式扫这一条,当场点名过我这支。**咬得对。** */
const H = { 'content-type': 'application/json', 'x-demo-seed': 'ci-seed-sandbox', authorization: `Bearer ${TOK}` }
for (const tenant of [
  {id: 'jics-nail', name: "Jie's Nail 小婕"},
  {id: 'demo-lucky-luxe', name: 'CI 会员等级检查店', kind: 'demo'},
]) {
  const created = await fetch(`${BASE}/platform/tenants`, { method: 'POST', headers: H, body: JSON.stringify({ ...tenant, plan: 'chain', currency: 'CNY', timezone: 'Asia/Shanghai' }) })
  if (![200, 201, 409].includes(created.status)) { console.error(`🔴 建租户 ${tenant.id} 失败 ${created.status}`); process.exit(1) }
  console.log(`   建租户 ${tenant.id} → ${created.status}`)
  if (tenant.kind === 'demo') {
    const tagged = await fetch(`${BASE}/platform/tenants/${tenant.id}/kind`, {method:'PATCH', headers:H,
      body:JSON.stringify({kind:'demo', reason:'CI 临时夹具：会员等级校验'})})
    if (!tagged.ok) {console.error(`🔴 标记演示夹具失败 ${tagged.status}`); process.exit(1)}
  }
}
let r = await fetch(`${BASE}/platform/tenants/jics-nail/import/customers`, { method: 'POST', headers: H, body: JSON.stringify({ dryRun: false, rows: [{ displayName: 'CI 夹具顾客', phone: '13900000001' }] }) })
if (!r.ok) { console.error(`🔴 导顾客失败 ${r.status} ${(await r.text()).slice(0, 200)}`); process.exit(1) }
console.log(`   导顾客 → ${r.status}`)

console.log('④ 🔴 逐项验夹具真的在 —— 不验就等于没种')
if (!existsSync(DB)) { console.error(`🔴 库文件不在:${DB}`); process.exit(1) }
const d = new DatabaseSync(DB, { readOnly: true })
const n = (s) => { try { return d.prepare(s).get().n } catch { return -1 } }
const b = n("SELECT COUNT(*) n FROM users WHERE tenant_id='jics-nail'")
const a = n("SELECT COUNT(*) n FROM bookings WHERE tenant_id='lucky-luxe' AND user_id IS NOT NULL")
const m = n('SELECT COUNT(*) n FROM bookings WHERE demo_seed IS NOT NULL')
const tierTenant = n("SELECT COUNT(*) n FROM tenants WHERE id='demo-lucky-luxe' AND kind='demo' AND status='active'")
d.close()
console.log(`   B店顾客=${b} · A店样本单=${a} · demo_seed=${m} · 会员等级检查店=${tierTenant}`)
if (b < 1 || a < 1 || m < 1 || tierTenant !== 1) { console.error('🔴 夹具没齐 —— 四套判据照样造不出阳性,不许假装种好了'); process.exit(1) }
console.log('   ✅ 四样夹具都在')
