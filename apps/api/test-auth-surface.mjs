/* 商家接口门禁全量扫描(店主 2026-08-09 红线级指令)。

   不靠"我记得都加了",而是**从源码里把所有 /admin/* 路由抠出来逐个打一遍**:
     ① 不带凭证 → 必须 401(不是 200、不是 500、不是空数据)
     ② 员工 token 打老板接口 → 必须 403
   新加的路由只要忘了挂门禁,这个套件立刻红 —— 门禁是长在测试里的,不是长在记性里的。

   放行清单只有登录相关的公开入口(登录/注册/改密本身不能要求先登录)。 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)
const HERE = dirname(fileURLToPath(import.meta.url))

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = null) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

/* 公开入口白名单:登录本身不能要求先登录。
   /admin/ops/import-db 有更硬的门(ALLOW_DB_IMPORT 环境开关 + OWNER_TOKEN + 确认头 + 文件魔数),
   默认关闭时回 403,不走 401 这条路 —— 单独断言它默认是关的。 */
const PUBLIC_OK = new Set([
  '/admin/auth/login',
  '/admin/auth/register',
  '/admin/ops/import-db'
])

// 从源码里抠出所有 /admin/* 路由(method + path),这样新增路由自动纳入扫描
function collectAdminRoutes() {
  const src = readFileSync(join(HERE, 'local-server.mjs'), 'utf8')
  const out = new Map()
  const re = /req\.method === '(GET|POST|PATCH|PUT|DELETE)'[^\n]*?path (?:===|\.startsWith\(|\.match\()\s*'?(\/admin\/[^'`)]*)'?/g
  let m
  while ((m = re.exec(src))) {
    const method = m[1]
    let p = m[2]
    if (!p.startsWith('/admin/')) continue
    // path.startsWith('/admin/settlements/') 这种前缀路由,补一个假 id 让它落到同一条分支
    if (p.endsWith('/')) p = `${p}probe-id`
    const key = `${method} ${p}`
    if (!out.has(key)) out.set(key, { method, path: p })
  }
  return [...out.values()]
}

async function newShop() {
  const id = `authx-${RUN}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `门禁店${RUN}`, plan: 'chain' }) }, PLATFORM)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) })
  const pass = `Authx-${RUN}-9a`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) })
  return { tenantId: id, token: again.data.auth.accessToken }
}

async function main() {
  const shop = await newShop()
  const tech = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技${RUN}` }) }, PLATFORM)).data.technician
  const acct = (await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: tech.id }) }, shop.token)).data
  const f = (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.username, password: acct.initialPassword }) })).data
  const staffPass = `Sfx-${RUN}-9a`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: acct.initialPassword, newPassword: staffPass, confirmPassword: staffPass }) }, f.auth.accessToken)
  const staffToken = (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.username, password: staffPass }) })).data.auth.accessToken
  check('老板 token / 员工 token 都拿到了', Boolean(shop.token && staffToken))

  const routes = collectAdminRoutes()
  check(`从源码抠出 ${routes.length} 条 /admin 路由(新增路由自动纳入扫描)`, routes.length >= 60, String(routes.length))

  /* ---- ① 不带凭证:全部必须 401 ---- */
  const naked = []
  for (const r of routes) {
    if (PUBLIC_OK.has(r.path)) continue
    const res = await request(r.path, { method: r.method, body: r.method === 'GET' ? undefined : '{}' }, null)
    if (res.status !== 401) naked.push({ ...r, status: res.status, sample: JSON.stringify(res.data).slice(0, 120) })
  }
  check('① 无凭证访问任何商家接口一律 401(没有一个裸奔)', naked.length === 0,
    naked.map((n) => `${n.method} ${n.path} → ${n.status} ${n.sample}`).join(' | ').slice(0, 900))

  // 坏 token / 过期 token 同样 401(不能因为带了个字符串就放行)
  const badTok = await request('/admin/customers', {}, 'not-a-real-token')
  check('① 乱填 token 也是 401', badTok.status === 401, String(badTok.status))
  const emptyBearer = await request('/admin/customers', { headers: { authorization: 'Bearer ' } }, null)
  check('① 空 Bearer 也是 401', emptyBearer.status === 401, String(emptyBearer.status))

  // 迁移入口默认是关的(它走自己的硬门,不是 401 那条路)
  const imp = await request('/admin/ops/import-db', { method: 'POST', body: '{}' }, null)
  check('① 数据库导入入口默认关闭(403,不是敞着的)', imp.status === 403, JSON.stringify(imp.data).slice(0, 120))

  /* ---- ② 员工 token 打老板接口:必须 403,且**不能返回数据** ---- */
  /* 老板专属路由也**从源码里抠**,不靠我手写清单 ——
     判据:路由体里出现 `role !== 'owner'` 这类老板断言。手写清单会漏,源码不会。 */
  const src = readFileSync(join(HERE, 'local-server.mjs'), 'utf8')
  const srcLines = src.split('\n')
  const ownerOnly = []
  for (let i = 0; i < srcLines.length; i += 1) {
    const m = /req\.method === '(GET|POST|PATCH|PUT|DELETE)'[^\n]*?path (?:===|\.startsWith\()\s*'(\/admin\/[^']*)'/.exec(srcLines[i])
    if (!m) continue
    /* 只看**这一条路由自己**的函数体:从本行到下一条 `if (req.method ===` 为止。
       固定看后面 N 行会把下一条路由的老板断言算到自己头上 —— 那样会把
       /admin/technicians、/admin/settlements/preview、/admin/my-performance
       这些**员工本来就该能用**的接口误报成越权漏洞。 */
    let end = i + 1
    while (end < srcLines.length && !/if \(req\.method === '/.test(srcLines[end])) end += 1
    const body = srcLines.slice(i, end).join('\n')
    /* 只认**纯老板门**:`role !== 'owner') throw`。
       复合条件不算 —— `role !== 'owner' && role !== 'staff'` 是"员工或老板都行",
       `role !== 'owner' && techId !== 自己` 是"员工只能看自己",两者员工拿到 200 都是对的。 */
    if (!/(?:adminSession|admin)\.role !== 'owner'\)\s*throw/.test(body)) continue
    let p = m[2]
    if (p.endsWith('/')) p = `${p}probe-id`
    ownerOnly.push([m[1], p])
  }
  check(`老板专属路由从源码抠出 ${ownerOnly.length} 条`, ownerOnly.length >= 20, String(ownerOnly.length))

  const leaked = []
  for (const [method, p] of ownerOnly) {
    const res = await request(p, { method, body: method === 'GET' ? undefined : '{}' }, staffToken)
    if (res.status !== 403) leaked.push(`${method} ${p} → ${res.status} ${JSON.stringify(res.data).slice(0, 100)}`)
  }
  check('② 员工 token 打老板接口一律 403(没有一个漏数据)', leaked.length === 0, leaked.join(' | ').slice(0, 900))

  /* 分级权限(不是非黑即白的老板/员工):这两条容易被一刀切锁死,单独钉住 */
  const staffPerf = await request('/admin/my-performance', {}, staffToken)
  check('② 员工看**自己**的业绩:200(没被一刀切锁死)', staffPerf.status === 200, String(staffPerf.status))
  const otherTech = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `别人${RUN}` }) }, PLATFORM)).data.technician
  /* 关键是**有没有漏别人的数**。这条路由对员工是把 technicianId 参数直接忽略、
     强制取自己的 —— 所以回 200 但内容是**自己的**,不是 403。安全上等价(没漏),
     这里钉住的是"回来的一定是自己那份"。 */
  const peek = await request(`/admin/my-performance?technicianId=${otherTech.id}`, {}, staffToken)
  const peekTech = peek.data && peek.data.performance && peek.data.performance.technicianId
  check('② 员工传别人的 technicianId:拿不到别人的数(参数被忽略,回的是自己那份)',
    peek.status === 403 || peekTech === tech.id,
    JSON.stringify({ status: peek.status, got: peekTech, self: tech.id, other: otherTech.id }))
  const staffSettle = await request('/admin/settlements', { method: 'POST', body: '{}' }, staffToken)
  check('② 员工能开单(不是 403,是缺参数的 400)', staffSettle.status === 400, String(staffSettle.status))

  // 员工**该能用**的接口不能被误杀(门禁不是把员工端一起锁死)
  const staffOk = await request('/admin/auth/me', {}, staffToken)
  check('② 员工自己的接口照常可用(门禁没误伤员工端)', staffOk.status === 200 && staffOk.data.admin.role === 'staff',
    JSON.stringify(staffOk.data).slice(0, 140))

  /* 昵称(店主 2026-08-10)。三条 corner case 在后端兜住,老板/员工都支持。 */
  const nickOwner = await request('/admin/auth/display-name', { method: 'PATCH', body: JSON.stringify({ displayName: '悦容老板' }) }, shop.token)
  check('昵称:老板能改', nickOwner.status === 200 && nickOwner.data.displayName === '悦容老板', JSON.stringify(nickOwner.data))
  const nickStaff = await request('/admin/auth/display-name', { method: 'PATCH', body: JSON.stringify({ displayName: '小美' }) }, staffToken)
  check('昵称:员工也能改自己的', nickStaff.status === 200 && nickStaff.data.displayName === '小美', JSON.stringify(nickStaff.data))
  const nickEmoji = await request('/admin/auth/display-name', { method: 'PATCH', body: JSON.stringify({ displayName: '小美🌸✨' }) }, staffToken)
  check('昵称 corner:emoji 原样保留', nickEmoji.data.displayName === '小美🌸✨', JSON.stringify(nickEmoji.data.displayName))
  const longNick = '甲'.repeat(30)
  const nickLong = await request('/admin/auth/display-name', { method: 'PATCH', body: JSON.stringify({ displayName: longNick }) }, staffToken)
  check('昵称 corner:超长截到 20 字', [...nickLong.data.displayName].length === 20, String([...nickLong.data.displayName].length))
  // emoji 是多码元字符,按字符截才不会切出半个乱码
  const emojiLong = await request('/admin/auth/display-name', { method: 'PATCH', body: JSON.stringify({ displayName: '🌸'.repeat(30) }) }, staffToken)
  check('昵称 corner:超长 emoji 按**字符**截,不切出半个乱码',
    [...emojiLong.data.displayName].length === 20 && !emojiLong.data.displayName.includes('\uFFFD'),
    JSON.stringify(emojiLong.data.displayName).slice(0, 80))
  const nickEmpty = await request('/admin/auth/display-name', { method: 'PATCH', body: JSON.stringify({ displayName: '   ' }) }, staffToken)
  check('昵称 corner:留空不报错,回退默认(员工=技师名)',
    nickEmpty.status === 200 && nickEmpty.data.isDefault === true && nickEmpty.data.displayName === `技${RUN}`,
    JSON.stringify(nickEmpty.data))
  const nickEmptyOwner = await request('/admin/auth/display-name', { method: 'PATCH', body: JSON.stringify({ displayName: '' }) }, shop.token)
  check('昵称 corner:老板留空回退店名', nickEmptyOwner.data.isDefault === true && nickEmptyOwner.data.displayName.includes('门禁店'),
    JSON.stringify(nickEmptyOwner.data))
  const meNick = await request('/admin/auth/me', {}, shop.token)
  check('昵称:改完 /auth/me 立刻跟上(首页问候与管理页老板位都读它)',
    meNick.data.admin.displayName === nickEmptyOwner.data.displayName, JSON.stringify(meNick.data.admin.displayName))

  /* ---- ③ 停用的员工账号立刻失效(不是等 token 自然过期)---- */
  const list = (await request('/admin/staff-accounts', {}, shop.token)).data.accounts || []
  const mine = list.find((a) => a.username === acct.username)
  if (mine) {
    await request(`/admin/staff-accounts/${mine.id}/toggle`, { method: 'POST', body: '{}' }, shop.token)
    const afterDisable = await request('/admin/auth/me', {}, staffToken)
    check('③ 停用员工后,他手里的 token 立刻失效(401)', afterDisable.status === 401, String(afterDisable.status))
  }

  console.log(`\n门禁全量扫描通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
