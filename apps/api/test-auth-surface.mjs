/* 商家接口门禁全量扫描(店主 2026-08-09 红线级指令)。

   不靠"我记得都加了",而是**从源码里把所有 /admin/* 路由抠出来逐个打一遍**:
     ① 不带凭证 → 必须 401(不是 200、不是 500、不是空数据)
     ② 员工 token 打老板接口 → 必须 403
   新加的路由只要忘了挂门禁,这个套件立刻红 —— 门禁是长在测试里的,不是长在记性里的。

   放行清单只有登录相关的公开入口(登录/注册/改密本身不能要求先登录)。 */
import { readFileSync, readdirSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
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

/* 扫描面 = local-server.mjs + 所有 `*-routes.mjs`(2026-08-27)。
   🔴 立这一条的原因:退卡那一族路由从 local-server.mjs 搬进 ./refund-routes.mjs 时,
   扫描器还只读旧文件 —— 8 条接口**从扫描面上消失**,而这个套件照样全绿。
   那种绿比红更危险:它证明的是"我扫到的都合格",不是"接口都合格"。
   现在扫描面跟着文件走,并配一条**条数下限**断言:再有人搬走路由却忘了让扫描器跟上,条数掉下来立刻红。 */
function routeSources() {
  const names = readdirSync(HERE).filter((f) => f.endsWith('-routes.mjs')).sort()
  return ['local-server.mjs', ...names].map((f) => readFileSync(join(HERE, f), 'utf8'))
}

// 从源码里抠出所有 /admin/* 路由(method + path),这样新增路由自动纳入扫描
function collectAdminRoutes() {
  const src = routeSources().join('\n')
  const lines = src.split('\n')
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
  /* 🔴 两行式路由(先 `const xMatch = path.match(...)`,下一行才 `if (req.method === ... && xMatch)`)
     以前**一条都没被扫到** —— 上面那条正则要求方法与路径同行。08-27 实测这样的 /admin 路由有 14 条,
     其中就有 /admin/my-customers 这一族(08-27 实测基线 153 条):它们从来没被验过"不带凭证是不是 401"。
     判据里把正则源码还原成一条能打的路径(捕获组填 probe-id,或选一个字面量)。 */
  for (let i = 0; i < lines.length; i += 1) {
    const d = /const\s+(\w+)\s*=\s*path\.match\((\/.*?\/)\)/.exec(lines[i])
    if (!d) continue
    const probe = d[2].slice(1, -1).replace(/^\^/, '').replace(/\$$/, '')
      .replace(/\(\?:\\\/\(\[\^\/\]\+\)\)\?/g, '')   // 可选段 (?:\/([^/]+))? 先摘掉,不然下一条会先把它里头吃掉
      .replace(/\(\[\^\/\]\+\??\)/g, 'probe-id')
      .replace(/\(\.\+\)/g, 'probe-id')
      .replace(/\(([^()|]+)\|[^()]*\)/g, '$1')
      .replace(/\\\//g, '/')
    if (!probe.startsWith('/admin/') || /[()?*+\[\]\\]/.test(probe)) continue
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      const u = new RegExp(`req\\.method === '(GET|POST|PATCH|PUT|DELETE)'[^\\n]*\\b${d[1]}\\b`).exec(lines[j])
      if (u) { out.set(`${u[1]} ${probe}`, { method: u[1], path: probe }); break }
    }
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
  /* 下限按 08-27 实测条数钉住:搬家可以,搬没了不行。加路由会自然把这个数推高,
     哪天它掉回下限以下,说明有一批接口悄悄退出了扫描面。
     08-31 降基线 153→150(有批文的整路退役:死口候刀六条〔recharge-tiers×3 并一块、
     merchant-leads×2、finance/change-password〕+ 清单#2 收敛退役 my-compensation-estimate;
     退役都有 404 死透断言守着 —— 见 test-membership-config;**没有批文不许再降这个数**)。 */
  check('🔴 扫描面没缩水(路由条数不低于 08-31 批文后基线)', routes.length >= 150, String(routes.length))
  const moved = ['GET /admin/my-customers', 'POST /admin/stored-value/refund', 'POST /admin/timecards/probe-id/refund']
  const keys = new Set(routes.map((r) => `${r.method} ${r.path}`))
  const missing = moved.filter((k) => !keys.has(k))
  check('🔴 搬进 *-routes.mjs 的那几条仍在扫描面里(反向守:证明这条扫描真读到了新文件)',
    missing.length === 0, missing.join(' | '))

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
  const srcLines = routeSources().join('\n').split('\n')
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
    /* 只认**纯老板门**。08-27 补:复合条件写成 `!== 'staff' && !== 'owner')` 这个**反过来的顺序**时,
       上面那条正则照样命中 —— 于是把"员工也能用"的接口误报成越权漏(/admin/my-customers 撞过)。
       现在先把复合条件整段剔掉,再判是不是纯老板门。 */
    const pure = body.replace(/(?:adminSession|admin)\.role !== '(?:owner|staff)' && (?:adminSession|admin)\.role !== '(?:owner|staff)'\)\s*throw/g, 'COMPOUND_GATE')
    if (!/(?:adminSession|admin)\.role !== 'owner'\)\s*throw/.test(pure)) continue
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

  /* fixture:必须真的有「这位员工服务过的顾客」和「他没服务过的顾客」两种人,
     越权断言才跑得到。上一版造不出来 —— 查清了:**不是接口吞错**,
     /admin/bookings/direct 少 serviceId 时老老实实回 400「serviceId is required.」,
     是我的 fixture 没检查返回值,自己把错咽了。所以这一版**每一步都验状态码**,
     哪一步没成当场红,不许再带着空列表往下走。 */
  const mustOk = (r, what) => {
    if (r.status >= 300) throw new Error(`fixture「${what}」失败 ${r.status}: ${JSON.stringify(r.data).slice(0, 160)}`)
    return r.data
  }
  const tech2 = mustOk(await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技乙${RUN}` }) }, PLATFORM), '建技师乙').technician
  const fxCat = mustOk(await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: `fx${RUN}`, name: `范围类${RUN}` }) }, shop.token), '建大类').category
  const fxSvc = mustOk(await request('/admin/pricing/items', {
    method: 'POST', body: JSON.stringify({ nameZh: `范围款${RUN}`, type: 'NAIL', categoryId: fxCat.id, itemKind: 'main', listPriceCents: 10000, memberPriceCents: 10000 })
  }, shop.token), '建服务项目').item
  const imp2 = mustOk(await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, rows: [{ name: `我的客${RUN}`, phone: `1385${RUN.slice(-7)}` }, { name: `别人客${RUN}`, phone: `1386${RUN.slice(-7)}` }] })
  }, PLATFORM), '导入两位顾客')
  const mineUser = imp2.users[0].userId
  const otherUser = imp2.users[1].userId
  const svcDate = mustOk(await request('/admin/store-clock', {}, shop.token), '取门店今天').today
  mustOk(await request('/admin/bookings/direct', {
    method: 'POST', body: JSON.stringify({ userId: mineUser, serviceId: fxSvc.id, technicianId: tech.id, date: svcDate, time: '10:05', durationMin: 60, depositPaid: false })
  }, shop.token), '给技师甲排一单(我的客)')
  mustOk(await request('/admin/bookings/direct', {
    method: 'POST', body: JSON.stringify({ userId: otherUser, serviceId: fxSvc.id, technicianId: tech2.id, date: svcDate, time: '11:05', durationMin: 60, depositPaid: false })
  }, shop.token), '给技师乙排一单(别人客)')

  const ownerList = (await request('/admin/customers', {}, shop.token)).data.customers || []
  const staffList = (await request('/admin/customers', {}, staffToken)).data.customers || []
  check('拍板② 员工拿得到「我的客户」(不再一刀切 403)', Array.isArray(staffList), JSON.stringify(staffList).slice(0, 80))
/* 🔴 判据翻面(店主 2026-08-28,靠列举的判据 A 类之一)。
   原判据:列 4 个财务字段名,断言它们不在员工响应里 —— **它叫"财务字段整体不存在",却只验我列的那 4 个**。
   后端哪天多下发一个 `depositRetainCents`、`lastRechargeAt`,它一辈子不会被验到,而断言永远绿。
   改成**反过来数**:员工响应里出现的**每一个字段**都必须在下面这张白名单里,理由逐条写死。
   新加字段=不在白名单=当场红,想放进来得先说清"它为什么不算钱"。

   白名单的失败模式是「遇到红的就往里加一条」,所以配三道防线:
     ①每一项写一行理由;②条目数上棘轮(只许减不许增,要增先报 Cowork);
     ③自检:白名单里每一项**必须真的还在响应里出现** —— 删了字段却留着豁免 = 偷偷放宽。 */
  const STAFF_FIELD_ALLOW = {
    id: '主键,员工要拿它点进这位顾客',
    displayName: '顾客名 —— 干活要叫得出名字',
    phoneMasked: '**已脱敏**的手机号(后端 maskPhone),用来对人不用来联系',
    visitCount: '到店次数 = 服务频次,不是钱',
    lastVisitAt: '最近到店时间,判断该不该回访',
    tags: '偏好/安全项标签(过敏、忌讳),上钟前必看',
    memberCode: '会员码 = 身份标识,不含余额',
    scope: '这批数据的口径标记(mine),前端据此渲染"只看我的"'
  }
  const ALLOW_CAP = 8   // 🔴 棘轮:只许减不许增。要加一项,先报 Cowork 批,并把这个数一起改
  const staffKeys = [...new Set(staffList.flatMap((c) => Object.keys(c)))]
  const ownerKeys = [...new Set(ownerList.flatMap((c) => Object.keys(c)))]
  const notAllowed = staffKeys.filter((k) => !(k in STAFF_FIELD_ALLOW))
  check(`拍板② 白名单式:员工响应里 ${staffKeys.length} 个字段全在白名单(老板视图有 ${ownerKeys.length} 个;原判据只列举了 4 个财务字段名)`,
    notAllowed.length === 0, `不在白名单里的:${notAllowed.join(', ')}`)
  check(`白名单防线②:条目数上棘轮 ≤ ${ALLOW_CAP}(只许减不许增;想增先报 Cowork)`,
    Object.keys(STAFF_FIELD_ALLOW).length <= ALLOW_CAP, String(Object.keys(STAFF_FIELD_ALLOW).length))
  const stale = Object.keys(STAFF_FIELD_ALLOW).filter((k) => !staffKeys.includes(k))
  check('白名单防线③:白名单里每一项都还真的在响应里(删了字段却留着豁免 = 偷偷放宽)',
    stale.length === 0 || staffList.length === 0, `响应里已经没有的豁免项:${stale.join(', ')}`)
  check('反向守:老板视图**确实**带着钱(证明上面那个"没有钱字段"是裁出来的,不是这接口本来就不给钱)',
    ownerKeys.some((k) => /cents|balance|spent|recharge|deposit/i.test(k)),
    JSON.stringify(ownerKeys).slice(0, 200))
  check('拍板② 手机号脱敏,明文 phone 键不下发',
    staffList.every((c) => !('phone' in c) && (!c.phoneMasked || /\*/.test(c.phoneMasked))),
    JSON.stringify(staffList[0] || {}))
  check('拍板② 老板视图不受影响(财务字段照常给)',
    ownerList.length === 0 || ('totalSpentCents' in ownerList[0] && 'storedValueBalanceCents' in ownerList[0]),
    JSON.stringify(Object.keys(ownerList[0] || {})).slice(0, 120))
  /* 越权那两条要真跑,必须**列表里真有人** —— 临时租户里 getAdminCustomers() 没把
     刚导入+刚排单的顾客算进来(活跃度过滤),所以 fixture 造不出行。
     不许让断言静默跳过(上一版就是这么漏的):造不出来就**当场红**,逼下一手把 fixture 补对。 */
  /* 🚧 防空转闸门(店主点名):fixture 一坏,下面几条 every()/some() 会**静默通过** ——
     那比没有断言更危险。所以先断言"列表里真的有人",空了立刻红。 */
  check('拍板② 防空转:员工名下确实有顾客(fixture 一坏这里先红)',
    staffList.length > 0, `员工列表 ${staffList.length} 人`)
  const staffIds = new Set(staffList.map((c) => c.id))
  check('拍板② 范围:自己服务过的在列表里,别人的不在',
    staffIds.has(mineUser) && !staffIds.has(otherUser),
    JSON.stringify({ mine: staffIds.has(mineUser), other: staffIds.has(otherUser), n: staffList.length }))
  const peekOther = await request(`/admin/customers/${encodeURIComponent(otherUser)}/notes`, {}, staffToken)
  check('拍板② 越权:员工请求别人的顾客 → 404(不是 403,不确认这个人存在)', peekOther.status === 404, `${peekOther.status}`)
  const ownNotes = await request(`/admin/customers/${encodeURIComponent(mineUser)}/notes`, {}, staffToken)
  check('拍板② 自己服务过的顾客,小记看得到', ownNotes.status === 200, `${ownNotes.status}`)


  /* ---- ③ 停用的员工账号立刻失效(不是等 token 自然过期)---- */
  const list = (await request('/admin/staff-accounts', {}, shop.token)).data.accounts || []
  const mine = list.find((a) => a.username === acct.username)
  if (mine) {
    await request(`/admin/staff-accounts/${mine.id}/toggle`, { method: 'POST', body: '{}' }, shop.token)
    const afterDisable = await request('/admin/auth/me', {}, staffToken)
    check('③ 停用员工后,他手里的 token 立刻失效(401)', afterDisable.status === 401, String(afterDisable.status))
  }

  /* 拍板②(店主 2026-08-10):员工「我的客户」—— 只看自己服务过的顾客;手机号脱敏;
     **财务字段在响应里整体不存在**(不是置空)。裁剪在接口层,前端隐藏不算数。 */
  /* ══ 夜9 段1(结论 B)· **顾客身份这一路必须是服务端签发** ══
     段 0 逐条查完的结论:三条路都已经是服务端签发/校验,那条上线门槛是假红。
     结论要**被机器守住**,否则下一次谁加一条不签名的路,没有人拦。
     这里守三层(静态 + 行为),全部对着 `local-server.mjs` 现读:
       ① 签名路:验签、验过期、openid 对得上 —— 三件缺一不可;
       ② 不签名的演示令牌:**只能**在 `DEMO_LOGIN_ALLOWED` 下可达;
       ③ `/health` 那一格是**现测**,不是常量(J-52)。 */
  const SRV = readFileSync(join(HERE, 'local-server.mjs'), 'utf8')
  const miniFn = (SRV.match(/function customerFromMiniToken\(token\)[\s\S]*?\n\}/) || [''])[0]
  check('㊙① 签名路:验签不过当场 401', /signMiniPayload\(payload\)\s*!==\s*signature/.test(miniFn) && /401/.test(miniFn))
  check('㊙② 签名路:过期当场 401', /data\.exp|Date\.now\(\)\s*>\s*Number\(data\.exp\)/.test(miniFn))
  check('㊙③ 签名路:还要 openid 对得上(光有签名不够)', /wechat_open_id\s*=\s*\?/.test(miniFn))
  const reqCust = (SRV.match(/function requireCustomer\(req\)[\s\S]*?\n\}/) || [''])[0]
  check('㊙④ 不签名的演示令牌**只在 DEMO_LOGIN_ALLOWED 下可达**(生产结构性不成立)',
    /DEMO_LOGIN_ALLOWED\s*\?\s*demoEmailFromToken/.test(reqCust), reqCust.slice(0, 120).replace(/\s+/g, ' '))
  check('㊙⑤ requireCustomer 只有这两条路,别的一律 401(新加一条路会把这条判据顶红)',
    (reqCust.match(/customerFromMiniToken|demoEmailFromToken/g) || []).length === 2
    && /UNAUTHORIZED/.test(reqCust))
  const HEALTHSRC = readFileSync(join(HERE, 'health-report.mjs'), 'utf8')
  check('㊙⑥ J-52:`/health` 的 guestIdUnsigned 是**量出来的**,读口里不许有写死的常量',
    !/guestIdUnsigned:\s*(true|false)\b/.test(HEALTHSRC) && /const guestIdUnsigned = /.test(HEALTHSRC),
    (HEALTHSRC.match(/guestIdUnsigned[^\n]*/g) || []).slice(0, 2).join(' | '))
  check('㊙⑦ 🔴 反向守:把它写回常量必须被 ㊙⑥ 咬中(否则那条是空转)',
    /guestIdUnsigned:\s*(true|false)\b/.test('    guestIdUnsigned: true,'))
  /* ═══ ㊙⑪㊙⑫ J-53 行为层:**拿不到密钥就拒绝启动**(店主 07c 裁 #54 §一.3)═══
     静态那几条在 `test-credential-scan ④`(扫写法 + 解析器口径单测);
     这里验的是**真起一个进程会不会死** —— 判据律:能验行为就别只验中间产物。

     ⚠️ 夹具**绝不指向真的 `apps/api/local-data`**:开库在密钥闸**之前**,
     拿真库当靶子等于让判据每跑一次就去开一次店主的本机库(停线:写 4128 既有行仍停)。
     改成在临时目录里造一个**名字就叫 `local-data` 的空目录** —— `scopeOf()` 认的是**路径名**,
     所以库域照样是 `local`,而真库一个字节都不碰。 */
  {
    const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { spawnSync } = await import('node:child_process')
    const base = mkdtempSync(join(tmpdir(), 'll-j53-'))
    const fakeLocal = join(base, 'local-data')      // 名字叫 local-data ⇒ scopeOf 判成 local
    const fakeSand = join(base, 'sandbox-data')     // 名字叫 sandbox-data ⇒ 判成 sandbox
    mkdirSync(fakeLocal); mkdirSync(fakeSand)
    const API = dirname(fileURLToPath(import.meta.url))
    const env0 = { ...process.env, NOTIFY_TICK: 'off' }
    delete env0.WECHAT_MINI_TOKEN_SECRET; delete env0.WX_MINI_TOKEN_SECRET
    console.log(`   [刀留痕] J-53 夹具 ${base}(local-data / sandbox-data 两个空目录;**真库未碰**)`)

    const hard = spawnSync(process.execPath, ['local-server.mjs'],
      { cwd: API, env: { ...env0, DATA_DIR: fakeLocal, PORT: '4139' }, encoding: 'utf8', timeout: 25000 })
    const hardOut = `${hard.stdout || ''}${hard.stderr || ''}`
    check('㊙⑪ 🔴 J-53 造病:**不设密钥变量 + `local` 库域 → 必须拒绝启动**(退出码非 0),'
      + '且报文**点名缺哪个变量**(不是含糊一句「配置错误」)',
    hard.status !== 0 && /拒绝启动/.test(hardOut) && /WECHAT_MINI_TOKEN_SECRET/.test(hardOut),
    `退出码=${hard.status} · 首行=${(hardOut.split('\n').find((l) => l.trim()) || '(空)').slice(0, 80)}`)
    check('㊙⑪b 反向守:那段拒绝启动的话里**不许出现密钥本身**(J-53 停线:密钥不进任何输出)',
      !hardOut.includes('DEV-ONLY-NOT-A-SECRET'), '')

    /* ㊙⑫ 反向守:sandbox 库域照常起 —— 否则「不许回落」会把回归与沙箱一起焊死。
       只看它**活过 3.5 秒且没打印拒绝启动**就够(不等 /health,省时间)。 */
    const soft = spawnSync(process.execPath, ['-e',
      "const t=setTimeout(()=>{console.log('STILL-ALIVE');process.exit(0)},3500);"
      + "import('./local-server.mjs').catch((e)=>{console.error('IMPORT-FAIL '+e.message);clearTimeout(t);process.exit(2)})"],
    { cwd: API, env: { ...env0, DATA_DIR: fakeSand, PORT: '4140' }, encoding: 'utf8', timeout: 25000 })
    const softOut = `${soft.stdout || ''}${soft.stderr || ''}`
    check('㊙⑫ 反向守:同样不设密钥,但 `sandbox` 库域 → **照常起得来**(活过 3.5 秒、没打印拒绝启动)'
      + ' —— 否则这条律会把回归与沙箱一起焊死',
    /STILL-ALIVE/.test(softOut) && !/拒绝启动/.test(softOut), softOut.slice(-160))
    rmSync(base, { recursive: true, force: true })
    console.log('   [收尾] J-53 夹具已删')
  }

  /* ㊙⑧ 行为层:真拿一个**伪造的**签名串去打,必须 401 —— 静态读源码证不了运行时真在验 */
  const forged = 'mini.' + Buffer.from(JSON.stringify({ sub: 'demo-cust-06', openid: 'demo-openid-x', exp: Date.now() + 60000 })).toString('base64url') + '.notavalidsignature'
  const forgedRes = await fetch(`${BASE_URL}/my/card-pack`, { headers: { authorization: `Bearer ${forged}`, 'x-tenant-id': 'lucky-luxe' } })
  check('㊙⑧ 行为层:**伪造签名**的顾客令牌必须被拒(现测状态码)', forgedRes.status === 401, String(forgedRes.status))
  /* ㊙⑨ 反向守:同一条口,**不带任何令牌**也必须 401(否则 ㊙⑧ 那个 401 可能只是「这条口本来就谁都拒」) */
  const nakedRes = await fetch(`${BASE_URL}/my/card-pack`, { headers: { 'x-tenant-id': 'lucky-luxe' } })
  check('㊙⑨ 反向守:同一条口不带令牌也 401(证明 ㊙⑧ 拒的是**令牌不合法**这件事)',
    nakedRes.status === 401, String(nakedRes.status))
  /* ㊙⑩ 正向:**合法签发**的令牌在同一条口上必须过 —— 否则前面那些 401 只说明这条口是死的 */
  /* 🔴 07c §一.4:这里原来是 `… || process.env.OWNER_TOKEN || 'owner-demo-token'` ——
     **判据里写着默认值,等于把钥匙又抄了一份**。而且它抄的正是那条回落链的末端,
     所以它一直「验得过」:不是因为签发对,是因为两边抄了同一个字面量。
     改成**从唯一出口现取**:密钥由 `mini-token-secret.mjs` 按**被测进程的库域**算出来
     (库域从它自己的 `/health` 现读,不猜)。判据这一侧零字面量。 */
  const { resolveMiniTokenSecret } = await import('./mini-token-secret.mjs')
  const liveScope = await fetch(`${BASE_URL}/health`).then((r) => r.json()).then((h) => h.dataScopeName || 'unknown').catch(() => 'unknown')
  const liveSecret = resolveMiniTokenSecret({ scopeName: liveScope }).secret
  const okTok = (() => {
    const payload = Buffer.from(JSON.stringify({ sub: 'demo-cust-06', openid: 'demo-openid-06', exp: Date.now() + 60000 })).toString('base64url')
    const sig = createHmac('sha256', liveSecret).update(payload).digest('base64url')
    return `mini.${payload}.${sig}`
  })()
  const okRes = await fetch(`${BASE_URL}/my/card-pack`, { headers: { authorization: `Bearer ${okTok}`, 'x-tenant-id': 'lucky-luxe' } })
  check('㊙⑩ 正向守:**合法签发**的令牌在同一条口上不是 401(证明这条口不是「见谁都拒」)',
    okRes.status !== 401, String(okRes.status))


  /* ═══ ㊙⑬ 裁 #86:员工登录的**第二条路**(演示白名单回落)══════════════
     `/admin/auth/login` 有两条路:
       ① 真账号(`local-server.mjs:10847-10867`)—— 查 `admin_accounts` → 校验密码 → 签发,**不被演示门挡**;
       ② **演示白名单回落**(`:10869-10871`)—— 门关时抛「账号不存在」。
     店主 07k §五:**身份不许有回落**(与 J-53「密钥不许有回落」同一条道理)。
     分岔:没人用就删;**有人用就具名冻结 + 造病**。现查**有人用**,所以走第二格。 */
  const DEMO_WHITELIST_USERS = {
    'test-staff-portal.mjs': '员工端三套之一,日班令2 段D 要转 loginStaffViaFrontDoor();转完这一条删',
    'test-notify-scheduler.mjs': '同上,排在员工端那一批里一起转',
    'test-admin-accounts.mjs': '它测的就是「老板发账号」这件事本身,演示邮箱是它的被测对象之一;转法要单独想',
  }
  const DEMO_WHITELIST_CAP = 3   /* 只许变短:归零那天这条回落路就该删掉 */
  const usersNow = readdirSync(dirname(fileURLToPath(import.meta.url)))
    .filter((b) => /^test-.*\.mjs$/.test(b) && b !== 'test-auth-surface.mjs')
    .filter((b) => /staff@luckyluxeatelier\.com|employee@luckyluxeatelier\.com/.test(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), b), 'utf8')))
  const notFrozen = usersNow.filter((b) => !DEMO_WHITELIST_USERS[b])
  check(`㊙⑬ 裁#86:演示白名单回落路现在还有 ${usersNow.length} 套在用,逐个具名冻结`
    + `(<= ${DEMO_WHITELIST_CAP},**只许变短**;归零那天这条回落路就删)`,
  notFrozen.length === 0 && Object.keys(DEMO_WHITELIST_USERS).length <= DEMO_WHITELIST_CAP,
  `没冻结的:${notFrozen.join(' ')}`)

  /* ㊙⑬b 造病(令里点名的那条):这条回落路**在生产库域下必须抛** ——
     它是「本地方便」,不是身份路;一旦它能在生产库域上开门,那就是第二条无密码的员工入口。 */
  {
    const { mkdtempSync: mk13, rmSync: rm13 } = await import('node:fs')
    const { tmpdir: tp13 } = await import('node:os')
    const { spawnSync: sp13 } = await import('node:child_process')
    const base13 = mk13(join(tp13(), 'll-demo13-'))
    const prodDir = join(base13, 'local-data')            /* 名字叫 local-data ⇒ 库域 local(非 ci/sandbox) */
    ;(await import('node:fs')).mkdirSync(prodDir)
    const env13 = { ...process.env, DATA_DIR: prodDir, PORT: '4174', NOTIFY_TICK: 'off',
      OWNER_TOKEN: 'probe-owner-not-a-secret', WECHAT_MINI_TOKEN_SECRET: 'probe-mini-not-a-secret',
      ALLOW_DEMO_ADMIN_LOGIN: 'true' }   /* 🔴 开关照开 —— 就是要证明「开关 + 非 ci 库域」也开不了门 */
    const probe = sp13(process.execPath, ['-e',
      "const t=setTimeout(()=>process.exit(3),9000);"
      + "import('./local-server.mjs').then(async()=>{await new Promise(r=>setTimeout(r,2500));"
      + "const r=await fetch('http://127.0.0.1:4174/admin/auth/login',{method:'POST',headers:{'content-type':'application/json'},"
      + "body:JSON.stringify({email:'staff@luckyluxeatelier.com',password:'LuckyluxeStaff0312'})});"
      + "console.log('STATUS='+r.status);clearTimeout(t);process.exit(0)}).catch((e)=>{console.log('BOOT-FAIL '+e.message);process.exit(2)})"],
    { cwd: dirname(fileURLToPath(import.meta.url)), env: env13, encoding: 'utf8', timeout: 30000 })
    const out13 = `${probe.stdout || ''}${probe.stderr || ''}`
    check('㊙⑬b 🔴 造病:**开关照开 + 非 ci/sandbox 库域** → 演示白名单那条路**仍然开不了门**'
      + '(它是本地方便,不是身份路;能开就是第二条无密码的员工入口)',
    /STATUS=(401|403)/.test(out13), out13.replace(/\n/g, ' ').slice(-160))
    rm13(base13, { recursive: true, force: true })
  }

  console.log(`\n门禁全量扫描通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
