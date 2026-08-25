/* 生产例外七条 · 会红的断言(店主 2026-08-25「乙线开锁」立)。

   这套件验的是**铺演示数据的脚本能不能被拦住**,以及拦住它的两道锁是不是各自独立。
   判据律:全部**真调用** —— 真起进程跑 tools/seed-demo-twin.mjs、真打接口,
   不读代码不扫全文(读代码的判据在缺陷存在时照样绿)。

   corner case 覆盖:
   ① 越权:平台口不带令牌 / 商家令牌 → 401
   ② 边界:--production-seed 缺 --tenant、缺 --confirm-name、名字打错一个字
   ③ 异常输入:目标租户根本不存在(黑名单里的不存在租户照样拦)
   ④ 幂等:七条全过的真跑,连跑两遍第二遍**一行不写**
   ⑤ 空态:全新演示店从零铺满(目录 + 两位顾客 + 资产)
   ⑥ 财务红线:铺完真店(lucky-luxe)五项一分不动

   ⚠️ standalone 跑法:
     rm -rf /tmp/ll-sg && mkdir /tmp/ll-sg
     DATA_DIR=/tmp/ll-sg PORT=4301 node local-server.mjs &
     TEST_BASE_URL=http://127.0.0.1:4301 node apps/api/test-demo-seed-guard.mjs */
import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTestTarget } from './test-guard.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)                    // 套件永远不许写真库
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SEEDER = join(ROOT, 'tools/seed-demo-twin.mjs')
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}
/* 真起一个进程跑脚本 —— 判据是它的退出码与吐出来的话,不是源码长什么样 */
function runSeeder(args, env = {}) {
  return new Promise((resolve) => {
    execFile('node', [SEEDER, ...args], {
      cwd: ROOT, timeout: 180000,
      env: { ...process.env, SEED_BASE_URL: env.BASE || BASE_URL, OWNER_TOKEN: PLATFORM }
    }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }))
  })
}
/* 夹具说明:**测试库上建的店 kind 一律是 'test'**(D73 三条判据的第一条),
   而且 setTenantKind 明确不许把 test 改成别的。所以要造一家 kind='demo' 的店只能直接拨库 ——
   这是夹具,不是绕过门禁:门禁本身在下面用真调用逐条验。 */
const DB_PATH = process.env.TEST_DB_PATH || ''
function setKind(id, kind) {
  if (!DB_PATH) throw new Error('本套件需要 TEST_DB_PATH(run-all-tests.sh 会导出;standalone 请手动指到测试库)')
  const db = new DatabaseSync(DB_PATH)
  try { db.prepare('UPDATE tenants SET kind = ? WHERE id = ?').run(kind, id) } finally { db.close() }
}
async function newTenant(id, name, kind) {
  const r = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name, plan: 'chain', initialTerm: 'year', currency: 'CAD', timezone: 'America/Toronto' }) })
  if (r.status !== 201) throw new Error(`建店失败 ${id}: ${JSON.stringify(r.data)}`)
  setKind(id, kind)
  return r.data
}
const statsOf = async (t) => (await request(`/platform/tenants/${t}/stats`)).data.stats

const DEMO_ID = `demo-seedguard-${RUN_ID}`
const DEMO_NAME = `试跑演示店-${RUN_ID}`
const REAL_ID = `seedguard-real-${RUN_ID}`
const REAL_NAME = `真店-${RUN_ID}`
await newTenant(DEMO_ID, DEMO_NAME, 'demo')
await newTenant(REAL_ID, REAL_NAME, 'real')

// ══ 第①条:默认边界一行没改 —— 非本机 BASE 不带 --production-seed = 拒绝,且**一个请求都不发**
{
  const r = await runSeeder([], { BASE: 'https://production.invalid' })
  check('①非本机BASE不带--production-seed=拒绝', r.code !== 0 && /第①条/.test(r.out), r.out.slice(0, 200))
  // 判据能证伪:要是它真去连了,吐的会是网络错误(fetch failed / ENOTFOUND),不会是第①条措辞
  check('①拒绝发生在发请求之前(没有网络错误痕迹)', !/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(r.out), r.out.slice(0, 200))
}
{
  const r = await runSeeder(['--production-seed'])
  check('①--production-seed缺--tenant=拒绝', r.code !== 0 && /第①条/.test(r.out), r.out.slice(0, 200))
}

// ══ 第④条:店名手打确认
{
  const r = await runSeeder(['--production-seed', '--tenant', DEMO_ID])
  check('④缺--confirm-name=拒绝', r.code !== 0 && /第④条/.test(r.out), r.out.slice(0, 200))
}
{
  const r = await runSeeder(['--production-seed', '--tenant', DEMO_ID, '--confirm-name', `${DEMO_NAME}x`, '--dry-run'])
  check('④店名差一个字=拒绝', r.code !== 0 && /第④条/.test(r.out), r.out.slice(0, 200))
}

// ══ 第②条:kind=real 一律拒绝(名字里没有 demo 字样也罢、有也罢,认的是归属)
{
  const r = await runSeeder(['--production-seed', '--tenant', REAL_ID, '--confirm-name', REAL_NAME, '--dry-run'])
  check('②目标kind=real=拒绝', r.code !== 0 && /第②条/.test(r.out), r.out.slice(0, 200))
}

// ══ 第③条:真店黑名单**独立生效** —— 判据:jics-nail 在这个库里**根本不存在**。
//    没有第③条的话,不存在的租户会走「现建一家」那条路(见下面的对照组),绝不会报拒绝。
{
  const r = await runSeeder(['--production-seed', '--tenant', 'jics-nail', '--confirm-name', '小婕美甲', '--dry-run'])
  check('③黑名单租户(本库不存在)=拒绝', r.code !== 0 && /第③条/.test(r.out), r.out.slice(0, 200))
  check('③报的是黑名单那条,不是②', !/第②条/.test(r.out), r.out.slice(0, 200))
}
{
  // 对照组:同样不存在、但不在黑名单里的 id → 门禁放行(证明上一条的拒绝确实来自黑名单)
  const r = await runSeeder(['--production-seed', '--tenant', `demo-notexist-${RUN_ID}`, '--confirm-name', '随便一家新店', '--dry-run'])
  check('③对照组:不存在且非黑名单=放行(将新建)', r.code === 0 && /将新建/.test(r.out), r.out.slice(0, 300))
}

// ══ 七条全满足 → 放行(空态:全新演示店从零铺满;真跑,不是试跑)
const realBefore = await statsOf('lucky-luxe')
const opsBefore = (await request('/platform/ops-log')).data.logs.length
{
  const r = await runSeeder(['--production-seed', '--tenant', DEMO_ID, '--confirm-name', DEMO_NAME])
  check('七条全满足=放行并跑完', r.code === 0, r.out.slice(-400))
  check('⑤跑前自动备份且路径进了回报', /⑤ 已备份:\S+\.sqlite/.test(r.out), r.out.slice(0, 400))
  check('⑥跑后对账真店五项零差异', /零差异/.test(r.out), r.out.slice(-400))
  check('⑦落 platform_ops_log', /⑦ 已落 platform_ops_log/.test(r.out), r.out.slice(-400))
  const seeded = await statsOf(DEMO_ID)
  check('空态铺满:演示店有了顾客与已签署单', seeded.users >= 2 && seeded.settlements >= 3, JSON.stringify(seeded))
}
// ⑥ 的独立复核:真店五项由**这套件自己**再量一遍(不信脚本自报)
{
  const after = await statsOf('lucky-luxe')
  for (const k of ['incomeCents', 'financeRows', 'bookings', 'users', 'settlements']) {
    check(`⑥真店 lucky-luxe.${k} 一分不动`, after[k] === realBefore[k], `${realBefore[k]} → ${after[k]}`)
  }
}
// ⑦ 的独立复核:日志行必须写清哪家店 + 铺了多少 + 备份路径
{
  const logs = (await request('/platform/ops-log')).data.logs
  const row = logs.find((l) => l.action === 'demo_seed' && l.tenant_id === DEMO_ID)
  check('⑦日志确有 demo_seed 一行', Boolean(row), JSON.stringify(logs.slice(0, 2)))
  check('⑦日志写清了操作者/时间/店/量/备份路径',
    row.operator === 'platform' && Boolean(row.created_at) && /结算单/.test(row.detail) && /backups\/\S+\.sqlite/.test(row.detail), row?.detail)
  check('⑦日志有增无减(备份行 + 铺设行)', logs.length >= opsBefore + 2, `${opsBefore} → ${logs.length}`)
}
// 幂等:同样的命令再跑一遍,一行不写
{
  const before = await statsOf(DEMO_ID)
  const r = await runSeeder(['--production-seed', '--tenant', DEMO_ID, '--confirm-name', DEMO_NAME])
  const after = await statsOf(DEMO_ID)
  check('幂等:重跑退出码 0', r.code === 0, r.out.slice(-300))
  check('幂等:重跑一行没写', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`)
}

// ══ 演示事实口本身的两道锁(真调用)
{
  const r = await request('/platform/tenants/lucky-luxe/demo-facts')
  check('事实口:真店(黑名单)连读都拒绝', r.status === 403 && r.data.error?.code === 'PROTECTED_REAL_TENANT', JSON.stringify(r.data))
  const r2 = await request(`/platform/tenants/${REAL_ID}/demo-facts`)
  check('事实口:kind=real 拒绝(第二道锁独立生效)', r2.status === 403 && r2.data.error?.code === 'NOT_DEMO_TENANT', JSON.stringify(r2.data))
  const r3 = await request(`/platform/tenants/${REAL_ID}/demo-bind-openid`, { method: 'POST', body: JSON.stringify({ userId: 'x', openId: 'y' }) })
  check('贴 openid:kind=real 拒绝', r3.status === 403, JSON.stringify(r3.data))
  const r4 = await request(`/platform/tenants/${DEMO_ID}/demo-facts`, {}, null)
  check('越权:平台口不带令牌=401', r4.status === 401, JSON.stringify(r4.data))
  const r5 = await request('/platform/backup', { method: 'POST', body: JSON.stringify({ tag: 'x' }) }, null)
  check('越权:备份口不带令牌=401', r5.status === 401, JSON.stringify(r5.data))
  const r6 = await request('/platform/ops-log/demo-seed', { method: 'POST', body: JSON.stringify({ tenantId: DEMO_ID }) })
  check('异常输入:运维日志缺 detail=400', r6.status === 400, JSON.stringify(r6.data))
}

/* 🔴 店主 08-25 复核令①:**真店黑名单只有一处真相**。
   类定义按机制不按长相:凡是"保护/保留名单"这类容器(PROTECTED / KEEP / 黑名单)
   里硬写店主真店 id 的,就是第二份名单。目标店清单(去哪几家铺数据/走查)不算 ——
   那是"去哪儿"不是"不许碰谁",语义不同,收在一起反而会互相拖。
   判据取代码行(剥注释后判),缺陷存在时它会红。 */
{
  const files = execFileSync('git', ['ls-files', 'apps/**/*.mjs', 'apps/**/*.js', 'tools/*.mjs', 'tools/**/*.mjs'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
  const dupes = []
  for (const f of files) {
    const code = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new Set\()?\[[^\]\n]*\]/g)) {
      const [whole, name] = m
      if (!/PROTECT|KEEP|BLACKLIST|REAL_TENANT/i.test(name)) continue       // 只认"保护名单"这一类
      if (!/'lucky-luxe'/.test(whole) || !/'jics-nail'/.test(whole)) continue
      if (f === 'apps/api/demo-reset.mjs') continue                          // 唯一出口本身
      dupes.push(`${f}: ${name}`)
    }
  }
  check('真店黑名单全仓只有一处定义(第二份名单=0)', dupes.length === 0, dupes.join(' | '))
  const cleaner = await import('../../tools/clean-test-tenants.mjs')
  check('清理脚本的保留名单由唯一出口派生(真调用取值)',
    ['lucky-luxe', 'jics-nail'].every((t) => cleaner.PROTECTED_IDS.has(t)) && cleaner.PROTECTED_IDS.size === 5,
    [...cleaner.PROTECTED_IDS].join(' / '))
  const auditSrc = readFileSync(join(ROOT, 'tools/audit-test-tenants.mjs'), 'utf8')
  check('清点脚本同样 import 那一份,不本地抄',
    /import \{ PROTECTED_REAL_TENANTS \} from '\.\.\/apps\/api\/demo-reset\.mjs'/.test(auditSrc)
    && /new Set\(\[\.\.\.PROTECTED_REAL_TENANTS/.test(auditSrc))
  const seedSrc2 = readFileSync(SEEDER, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  check('铺设脚本本地零副本(REAL_TENANTS 这个本地表已消亡)', !/const REAL_TENANTS\s*=/.test(seedSrc2))
}

/* 脚本不再直连 sqlite(生产拿不到库文件,那条路在生产上是断的)。
   判据律:**取代码行**判,不扫全文 —— 先把注释整段剥掉,免得注释里提一句就把断言喂绿。 */
{
  const src = readFileSync(SEEDER, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => !l.trim().startsWith('//')).join('\n')
  check('铺设脚本零直连库(代码行判据)', !/DatabaseSync|node:sqlite/.test(src), src.split('\n').filter((l) => /DatabaseSync/.test(l)).join(' | '))
}

console.log(`\n全部通过 (${checks} 项)`)
