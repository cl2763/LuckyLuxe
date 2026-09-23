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
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)                    // 套件永远不许写真库
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SEEDER = join(ROOT, 'tools/seed-demo-twin.mjs')
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders, ...(options.headers || {}) }
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
{
  const r = await runSeeder(['--production-seed', '--tenant', DEMO_ID, '--confirm-name', DEMO_NAME])
  check('七条全满足=放行并跑完', r.code === 0, r.out.slice(-400))
  check('⑤跑前自动备份且路径进了回报', /⑤ 已备份:\S+\.sqlite/.test(r.out), r.out.slice(0, 400))
  check('⑥跑后对账真店五项零差异', /零差异/.test(r.out), r.out.slice(-400))
  check('⑦落 platform_ops_log', /⑦ 已落 platform_ops_log/.test(r.out), r.out.slice(-400))
  const seeded = await statsOf(DEMO_ID)
  check('空态铺满:演示店有了顾客与已签署单', seeded.users >= 2 && seeded.settlements >= 3, JSON.stringify(seeded))
  /* 🔴 店主 08-25 裁②:两张已签署单里必须有一张**组合支付**(储值抵扣 + 次卡核销 + 券)。
     判据取库里那张单的两个外键(券 + 次卡都挂上才算),不是看铺设脚本打了哪句日志。 */
  const twin = ((await request(`/admin/customers`, {}, PLATFORM, { 'x-admin-tenant-id': DEMO_ID })).data.customers || [])
    .find((c) => String(c.displayName || '').startsWith('演示·跨店'))
  const tf = (await request(`/platform/tenants/${DEMO_ID}/demo-facts?userId=${encodeURIComponent(twin?.id || '')}`)).data.facts
  check('裁②:组合支付单确实落了(一张单同时挂着券与次卡)', tf.comboSheets >= 1, JSON.stringify(tf))
  check('裁②:券按"发过几张"判幂等(用掉一张也不会越跑越多)', tf.couponGrants >= tf.activeCoupons, JSON.stringify(tf))
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
  /* 原来这里断的是"日志行数至少 +2" —— 废判据:ops-log 只回最近 100 行,
     同一个库跑够多次之后两边都顶到 100,断言就永远为假(与被测行为无关)。
     改断**这一次**的两行确实在:备份行 + 铺设行,都挂在本轮的租户上。 */
  check('⑦这一次的备份行也在(与铺设行成对)',
    logs.some((l) => l.action === 'backup' && l.tenant_id === DEMO_ID),
    logs.filter((l) => l.action === 'backup').slice(0, 2).map((l) => l.tenant_id).join(' | '))
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

/* 🔴 B(店主 08-25):重置**商家老板**密码。真店也能用 —— 真商户忘密码是必然事件,
   此前平台端只有员工账号与财务密码两条重置口,老板忘了只能改库。
   判据全真跑:真建一家店、真登录、真重置、再真登录一次。 */
{
  const bizId = `pwreset-${RUN_ID}`
  const bizName = `重置探针店${RUN_ID}`
  const made = await newTenant(bizId, bizName, 'real')
  const username = made.owner.username
  const oldPw = made.owner.initialPassword
  const login = (pw) => request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pw }) }, null)
  const first = await login(oldPw)
  check('B-前置:老板用初始密码登得进', first.status === 200 && Boolean(first.data.auth?.accessToken), `${first.status}`)
  const oldToken = first.data.auth.accessToken

  const noToken = await request(`/platform/tenants/${bizId}/owner-password/reset`, { method: 'POST', body: JSON.stringify({ confirmName: bizName, reason: 'x' }) }, null)
  check('B① 越权:不带平台令牌 = 401', noToken.status === 401, `${noToken.status}`)
  const wrongName = await request(`/platform/tenants/${bizId}/owner-password/reset`, { method: 'POST', body: JSON.stringify({ confirmName: `${bizName}x`, reason: '商家来电报忘记密码' }) })
  check('B② 店名差一个字 = 400 CONFIRM_NAME_MISMATCH', wrongName.status === 400 && wrongName.data.error?.code === 'CONFIRM_NAME_MISMATCH', JSON.stringify(wrongName.data).slice(0, 120))
  const noReason = await request(`/platform/tenants/${bizId}/owner-password/reset`, { method: 'POST', body: JSON.stringify({ confirmName: bizName }) })
  check('B③ 缺原因 = 400 REASON_REQUIRED', noReason.status === 400 && noReason.data.error?.code === 'REASON_REQUIRED', `${noReason.status}`)

  const done = await request(`/platform/tenants/${bizId}/owner-password/reset`, { method: 'POST', body: JSON.stringify({ confirmName: bizName, reason: '商家来电报忘记密码,已核身份' }) })
  check('B④ 七条都满足 = 200,并下发一次性新密码', done.status === 200 && String(done.data.initialPassword || '').length >= 8, JSON.stringify({ ...done.data, initialPassword: '(不打印)' }))
  const newPw = done.data.initialPassword

  const oldAgain = await login(oldPw)
  check('B⑤ 重置后**旧密码必失效**(真跑登录)', oldAgain.status === 401, `${oldAgain.status}`)
  const withNew = await login(newPw)
  check('B⑥ 新密码登得进', withNew.status === 200 && Boolean(withNew.data.auth?.accessToken), `${withNew.status}`)
  check('B⑦ 新密码**首登强制改密**(mustChangePassword=true)', withNew.data.admin?.mustChangePassword === true, JSON.stringify(withNew.data.admin))
  const oldSession = await request('/admin/services', {}, oldToken)
  check('B⑧ 旧会话一并吊销(拿着重置前的 token 也进不去)', oldSession.status === 401, `${oldSession.status}`)
  const logRow = (await request('/platform/ops-log')).data.logs.find((l) => l.action === 'owner_password_reset' && l.tenant_id === bizId)
  check('B⑨ 落了运维日志,写清账号/吊销数/原因,且**不含新密码**', Boolean(logRow)
    && /账号 /.test(logRow.detail) && /原因:/.test(logRow.detail) && !logRow.detail.includes(newPw), logRow?.detail?.slice(0, 140))
  const gone = await request(`/platform/tenants/notexist-${RUN_ID}/owner-password/reset`, { method: 'POST', body: JSON.stringify({ confirmName: 'x', reason: 'y' }) })
  check('B⑩ 异常输入:租户不存在 = 404', gone.status === 404, `${gone.status}`)
}

/* 🔴「记住这台电脑」。**换钥匙那一步的口径 09-08 变了**(D149,店主 05q §三 提过两次):
   08-25 那次裁的是「平台后台不改密码登录,只让钥匙不用每次掏」;
   D149 把登录改成了**用户名 + 密码**,于是换 cookie 用的也是**密码会话**(`psess_`),不再收令牌。
   下面这一串该守的东西一条没少(HttpOnly / SameSite / 绑设备 / 吊销即失效),
   只有「拿什么去换」这一步跟着新口径走。 */
{
  const UA = `d77-ua-${RUN_ID}`
  /* 本轮专用的平台账号:直接按模块里写明的哈希口径插一行,跑完删掉(判据里不写死任何密码) */
  const { createHash } = await import('node:crypto')
  const pfUser = `d77-pf-${RUN_ID}`
  const pfPass = `Pf${Math.random().toString(36).slice(2, 12)}`
  {
    const db2 = new DatabaseSync(DB_PATH)
    const nowIso = new Date().toISOString()
    db2.prepare(`INSERT INTO platform_accounts (id, username, display_name, password_hash, must_change_password, status, created_at, updated_at)
      VALUES (?, ?, '判据账号', ?, 0, 'active', ?, ?)`).run(`pacct-${pfUser}`, pfUser,
      createHash('sha256').update(`platform:${pfUser.toLowerCase()}:${pfPass}`).digest('hex'), nowIso, nowIso)
    db2.close()
  }
  const logged = await fetch(`${BASE_URL}/platform/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: pfUser, password: pfPass }) }).then((r) => r.json())
  const pfSession = logged?.session?.token || ''
  check('会话⓪ 密码登录先换到一张平台会话(D149:换 cookie 的前提)', pfSession.startsWith('psess_'), JSON.stringify(logged).slice(0, 120))
  const bad = await fetch(`${BASE_URL}/platform/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken: 'not-the-key', remember: true }) })
  check('会话① 拿错会话换不到 cookie = 401', bad.status === 401, `${bad.status}`)
  const bad2 = await fetch(`${BASE_URL}/platform/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionToken: PLATFORM, remember: true }) })
  check('会话①b 🔴 D149:拿**令牌**也换不到 cookie(令牌只留给脚本 / API)', bad2.status === 401, `${bad2.status}`)
  const ok = await fetch(`${BASE_URL}/platform/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ sessionToken: pfSession, remember: true }) })
  const setCookie = ok.headers.get('set-cookie') || ''
  check('会话② 对的**密码会话**换到 httpOnly cookie(带 HttpOnly + SameSite=Strict)',
    ok.status === 200 && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie), setCookie.slice(0, 120))
  const sid = (setCookie.match(/ll_platform=([^;]+)/) || [])[1]
  const withCookie = await fetch(`${BASE_URL}/platform/tenants`, { headers: { cookie: `ll_platform=${sid}`, 'user-agent': UA } })
  check('会话③ 只带 Cookie(不带令牌)也能进平台口', withCookie.status === 200, `${withCookie.status}`)
  const otherUa = await fetch(`${BASE_URL}/platform/tenants`, { headers: { cookie: `ll_platform=${sid}`, 'user-agent': `${UA}-another-device` } })   // UA 只能是 ByteString,别塞中文
  check('会话④ 票被搬到别的设备 = 不认(绑设备)', otherUa.status === 401, `${otherUa.status}`)
  const noCookie = await fetch(`${BASE_URL}/platform/tenants`)
  check('会话⑤ 既没令牌也没票 = 401', noCookie.status === 401, `${noCookie.status}`)
  await request('/platform/session/revoke-all', { method: 'POST' })
  const afterRevoke = await fetch(`${BASE_URL}/platform/tenants`, { headers: { cookie: `ll_platform=${sid}`, 'user-agent': UA } })
  check('会话⑥ 吊销所有设备之后,那张票立刻失效', afterRevoke.status === 401, `${afterRevoke.status}`)
  /* 夹具收尾:判据自己建的平台账号自己删干净(夹具不收尾 = 判据非幂等) */
  {
    const db3 = new DatabaseSync(DB_PATH)
    db3.prepare('DELETE FROM platform_auth_sessions WHERE account_id = ?').run(`pacct-${pfUser}`)
    db3.prepare('DELETE FROM platform_accounts WHERE username = ?').run(pfUser)
    db3.close()
  }
  const plat = readFileSync(join(ROOT, 'apps/web/platform.html'), 'utf8')
  check('会话⑦ 平台端不再把令牌写进 localStorage(钥匙不散到浏览器里)',
    !/localStorage\.setItem\('ll-platform-token'/.test(plat) && /removeItem\('ll-platform-token'\)/.test(plat))
}

/* 🔴 店主 08-25 复核令②:备份保留策略(建议 A + ⓓⓔ)。
   全部真调用 —— 真打备份口、真数文件、真让预检拦一次。 */
{
  /* 🔴 判据律:数文件**用套件自己的尺子**,不借被测模块的 onDemandSnapshots() ——
     借了就变成"用被测实现判被测实现":把清理规则从"按格式"改成"按 tag",
     那个函数会跟着一起改口径,断言照样绿(08-25 变异测试当场撞见,已换掉)。
     这里只 import snapshotDb(要真跑它的预检),判断一律自己来。 */
  const { snapshotDb } = await import('./db-backup.mjs')
  const isDaily = (f) => /^lucky-luxe-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)
  const isSnap = (f) => /^lucky-luxe-.*\.sqlite$/.test(f)
  const onDemandFiles = (dir) => readdirSync(dir).filter((f) => isSnap(f) && !isDaily(f))
  const dataDir = dirname(DB_PATH)
  const backupDir = join(dataDir, 'backups')

  // ⓐ 连打 7 次按需备份 → 目录里只剩最近 5 份
  let last = null
  for (let i = 0; i < 7; i += 1) {
    const r = await request('/platform/backup', { method: 'POST', body: JSON.stringify({ tag: `保留策略验${i}`, tenantId: DEMO_ID, reason: '断言用' }) })
    check(`备份口第 ${i + 1} 次返回 200 且给了路径`, r.status === 200 && /\.sqlite$/.test(r.data.path || ''), JSON.stringify(r.data).slice(0, 160))
    last = r.data
  }
  check('ⓐ 按需快照只留最近 5 份(套件自己数文件)', onDemandFiles(backupDir).length === 5,
    onDemandFiles(backupDir).join(' | '))
  check('ⓐ 清掉哪几份有名有姓地回报', Array.isArray(last.pruned) && last.pruned.length > 0, JSON.stringify(last.pruned))

  // ⓔ 通过时也报剩余/总量 —— 返回值里有,运维日志那行里也有
  check('ⓔ 通过时也报余量(返回值)', /可用 [\d.]+MB \/ 总 [\d.]+MB/.test(last.spaceText || ''), last.spaceText)
  const bkLog = (await request('/platform/ops-log')).data.logs.find((l) => l.action === 'backup')
  check('ⓒ 余量进了 platform_ops_log 那一行', /可用 [\d.]+MB/.test(bkLog?.detail || ''), bkLog?.detail?.slice(0, 160))
  check('ⓐ 清理动作也进了日志', /清理 \d+ 份旧快照|无旧快照可清/.test(bkLog?.detail || ''), bkLog?.detail?.slice(0, 160))

  // ⓓ 类按**格式**分,不按 tag:换个 tag 照样算按需;日备格式一份都不许被它碰
  const daily = join(backupDir, 'lucky-luxe-2020-01-01.sqlite')
  copyFileSync(DB_PATH, daily)
  const before = readdirSync(backupDir).filter(isDaily).length
  const r2 = await request('/platform/backup', { method: 'POST', body: JSON.stringify({ tag: '换个完全不同的tag', tenantId: DEMO_ID, reason: '断言用' }) })
  check('ⓓ 换个 tag 仍算按需(照样只留 5 份)', onDemandFiles(backupDir).length === 5, onDemandFiles(backupDir).join(' | '))
  check('ⓓ 日备格式一份没少(清理只碰按需那一类)',
    readdirSync(backupDir).filter(isDaily).length === before && existsSync(daily))
  check('ⓓ 日备不混进按需清单', !onDemandFiles(backupDir).some(isDaily))
  unlinkSync(daily)
  check('备份口在预检通过时确实落了盘', existsSync(r2.data.path), r2.data.path)

  // ⓑ 空间预检:把门槛抬到荒唐的高度 → 必须**在写之前**拒绝,且一个字节都没写
  // 每跑一次换一个空目录:判据要判"**这一次**没写",不是"这目录历来是空的"
  const probeDir = join(dataDir, `backups-probe-${RUN_ID}`)
  let aborted = ''
  try {
    snapshotDb({ dbPath: DB_PATH, backupDir: probeDir, tag: '预检探针', minFreeBytes: 900 * 1024 * 1024 * 1024 * 1024 })
  } catch (e) { aborted = e.message }
  check('ⓑ 空间不够=拒绝并中止(不是写失败才停)', aborted.includes('空间不够,已中止(没写)'), aborted.slice(0, 160))
  check('ⓑ 拒绝时目录里一个文件都没有(真的没写)',
    !existsSync(probeDir) || readdirSync(probeDir).length === 0, existsSync(probeDir) ? readdirSync(probeDir).join(' | ') : '目录没建')
  check('ⓑ 拒绝话里带了余量数字(不是一句"失败了")', /可用 [\d.]+MB \/ 总 [\d.]+MB/.test(aborted), aborted.slice(0, 160))
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
  /* 🔴 从「数个数」改成「逐名对账」(12m,店主 12l补 把 luvia-bj 加进硬锁,5 → 6)。
     原判据只守 size===5:名单换了一个成员而个数不变,它一样绿 ——
     「数量凑巧对上」正是突变自检条说的那种看着在守其实没守。
     逐名对账两向都守:少了谁、多了谁,都会被点名报出来。
     每个成员为什么在名单里,写在下面这张表上,新增成员必须同时补一行理由。 */
  const EXPECT_PROTECTED = {
    'lucky-luxe': '店主本店(真店,硬锁)',
    'jics-nail': '小婕的店(真店,09-25 真交付)',
    'luvia-bj': 'LUVIA 北京国贸店(真店,店主 12l补 加进硬锁)',
    'demo-ai': '平台演示店(对外展示,清理脚本不许删)',
    'demo-basic': '平台演示店(同上)',
    'hoptest-demo2': '长期演示租户',
  }
  const got = [...cleaner.PROTECTED_IDS].sort()
  const want = Object.keys(EXPECT_PROTECTED).sort()
  const missing = want.filter((t) => !cleaner.PROTECTED_IDS.has(t))
  const extra = got.filter((t) => !(t in EXPECT_PROTECTED))
  check('清理脚本的保留名单由唯一出口派生,且**逐名**对得上(少一个/多一个都点名)',
    missing.length === 0 && extra.length === 0,
    `少:${missing.join(' ') || '无'} · 多:${extra.join(' ') || '无'} · 现有:${got.join(' / ')}`)
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

/* ══ 🔴 J-114(店主 11k §二.1 立)· 造演示环境 ≠ 开一家真店 ══
 *
 * 店主的话:种子脚本的本分是**把空环境填满到能演示**;开真店的本分是**把骨架立起来等真人填**。
 * **前者以「有东西可看」为成功,后者以「一个假的都没有」为成功 —— 目标正相反。**
 * 推论:任何脚本只要会凭空造出**人**(顾客/技师)或**钱**(单/储值/积分/券),
 * **就永远不许对生产跑,一次都不许**,不管当时理由多充分。
 *
 * ⚠️ **这条判据第一版是错的,记在这里免得下一个人照抄**:
 *    我一开始只扫 `INSERT INTO users` 这类 SQL —— 而 `seed-luvia-bj.mjs` **走的是正门(HTTP 接口)**,
 *    于是它报「造人 0」,**而那支正是店主点名会塞 `13900000001` 这种假顾客的脚本**。
 *    判据在缺陷存在时报了绿。**造人造钱的口不只有 SQL,还有正门那些口** —— 两半都要扫。 */
{
  const SEED_DIRS = [['tools', (f) => /seed/.test(f) && f.endsWith('.mjs')],
                     ['apps/api', (f) => /seed/.test(f) && f.endsWith('.mjs') && !f.startsWith('test-')]]
  const seeds = SEED_DIRS.flatMap(([d, keep]) => readdirSync(join(ROOT, d)).filter(keep).map((f) => `${d}/${f}`))
  const codeOf = (f) => readFileSync(join(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  // 两半:直连 SQL 的 INSERT,和走正门那些会建人/建钱的口
  const SQL_PEOPLE = /INSERT[^;]{0,80}INTO\s+(users|technicians|user_identities)\b/i
  const SQL_MONEY = /INSERT[^;]{0,80}INTO\s+(bookings|settlements|stored_value\w*|points\w*|coupon\w*|finance_transactions|payments|timecards?)\b/i
  const HTTP_PEOPLE = /import\/customers|['"`]\/admin\/technicians/i
  const HTTP_MONEY = /['"`]\/admin\/bookings(\/direct)?['"`]|['"`]\/admin\/settlements|['"`]\/admin\/coupons|stored-value|\/recharge|\/points/i
  const BANNER = '此脚本永不对生产跑'
  const dangerous = []
  const safe = []
  for (const f of seeds) {
    const c = codeOf(f)
    const bad = SQL_PEOPLE.test(c) || SQL_MONEY.test(c) || HTTP_PEOPLE.test(c) || HTTP_MONEY.test(c)
    ;(bad ? dangerous : safe).push(f)
  }
  check(`J-114① 种子脚本现扫 ${seeds.length} 支 >= 下限 14(目录被漏掉或脚本被搬走立刻红)`,
    seeds.length >= 14, String(seeds.length))
  const missing = dangerous.filter((f) => !readFileSync(join(ROOT, f), 'utf8').includes(BANNER))
  check(`J-114② 🔴 会造人或造钱的 ${dangerous.length} 支,**每一支文件头都写死「${BANNER}」**`,
    missing.length === 0, missing.join(' | '))
  /* 🟢 反向守:一把「对谁都盖章」的分类器,等于没分类 —— 它会把不造人不造钱的也标上,
     于是这条规矩变成一句人人都贴的口号,没人再看它。 */
  const overStamped = safe.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes(BANNER))
  check(`J-114③ 🟢 **反向守**:不造人不造钱的 ${safe.length} 支一支都没被误盖章(${safe.map((f) => f.split('/').pop()).join(' ')})`,
    overStamped.length === 0, overStamped.join(' | '))
  check('J-114④ 🔴 分类器两半都在:只扫 SQL 会漏掉走正门的那些(seed-luvia-bj 就是这么漏的)',
    HTTP_PEOPLE.test('await api(`/platform/tenants/x/import/customers`)') && SQL_PEOPLE.test('INSERT INTO users (a) VALUES (1)'))
  check('J-114⑤ 🔴 具名钉住:`seed-luvia-bj.mjs` 必须被判成「会造人」并盖了章 —— 它是立这条法的那一支',
    dangerous.includes('tools/seed-luvia-bj.mjs')
    && readFileSync(join(ROOT, 'tools/seed-luvia-bj.mjs'), 'utf8').includes(BANNER))
}

/* ══ 🔴 J-114 运行时闸(店主 11l §四)· 文件头只给人看,这一段验的是它跑起来真拦 ══
 *
 * 11k 我只给那 10 支写死了文件头。店主当场指出:**文件头是给人看的,脚本跑起来不会拦。**
 * 本批补 `tools/never-on-production.mjs`,判断**接现成的 `data-scope.mjs` 的 `scopeOf()`**(11l:不许另造一套)。
 * 🔴 **白名单式**:只有 `ci` 与 `sandbox` 放行,`local` / `production` / `unknown` 一律拒 ——
 *    黑名单(「不是 production 就放行」)在路径判不出来时会默默放行,那正是这条闸要防的。
 * 🔴 **10 支逐个验,不许验 1 支推 10 支**(11l 明写)。 */
{
  const GUARD = 'tools/never-on-production.mjs'
  check('J-114⑥ 运行时闸件在', existsSync(join(ROOT, GUARD)), GUARD)
  const guardSrc = readFileSync(join(ROOT, GUARD), 'utf8')
  check('J-114⑦ 🔴 判断接的是现成的 `data-scope.mjs`(11l:不许另造一套判断)',
    /from '\.\.\/apps\/api\/data-scope\.mjs'/.test(guardSrc))
  check('J-114⑧ 🔴 **白名单式**:只放行 ci / sandbox —— 不是「不是 production 就放行」',
    /const ALLOWED = \['ci', 'sandbox'\]/.test(guardSrc), (guardSrc.match(/const ALLOWED = .*/) || [''])[0])

  const DANGEROUS = [
    ['tools/ci-seed-sandbox.mjs', 'SANDBOX_DATA_DIR', 'path'],
    ['tools/seed-demo-rich.mjs', 'SEED_DB', 'path'],
    ['tools/seed-newcomer-coupon.mjs', 'SEED_DB', 'path'],
    ['tools/seed-bigdemo.mjs', 'SEED_BASE_URL', 'url'],
    ['tools/seed-customer-doc-scene.mjs', 'SEED_BASE_URL', 'url'],
    ['tools/seed-demo-coupons.mjs', 'SEED_BASE_URL', 'url'],
    ['tools/seed-demo-today.mjs', 'SEED_BASE_URL', 'url'],
    ['tools/seed-demo-twin.mjs', 'SEED_BASE_URL', 'url'],
    ['tools/seed-selfcheck-data.mjs', 'SEED_BASE_URL', 'url'],
    ['tools/seed-luvia-bj.mjs', 'BASE_URL', 'url'],
  ]
  check(`J-114⑨ 会造人造钱的清单仍是 ${DANGEROUS.length} 支(和 J-114② 数的那一批对得上)`,
    DANGEROUS.length === 10)
  /* 🔴 行为层:逐支真跑一遍,指向「本机库」或「打不通的服务」—— 必须非 0 退出且打出 J-114 那句。
     静态扫「有没有 import 那个闸」证不了它真拦得住(判据律:读代码的判据在缺陷存在时照样绿)。 */
  const LOCAL_DIR = join(ROOT, 'apps/api/local-data')
  for (const [f, envName, kind] of DANGEROUS) {
    const target = kind === 'path'
      ? (f.includes('ci-seed-sandbox') ? LOCAL_DIR : join(LOCAL_DIR, 'lucky-luxe.sqlite'))
      : 'http://127.0.0.1:59999'
    const r = spawnSync(process.execPath, [join(ROOT, f)], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, [envName]: target },
    })
    const said = String(r.stderr || '').includes('J-114:此脚本永不对生产跑')
    check(`J-114⑩ 🔴 ${f.split('/').pop()} 指向${kind === 'path' ? '本机库' : '判不出库域的服务'} → 拒跑`,
      r.status !== 0 && said, `status=${r.status} said=${said} ${String(r.stderr || '').slice(0, 90)}`)
  }
  /* 🟢 反向守:一把「对谁都拒」的闸等于把沙箱也锁死,那样没人会留着它。 */
  const probe = (p) => spawnSync(process.execPath,
    ['-e', `import(${JSON.stringify(join(ROOT, GUARD))}).then(m=>m.assertNotProductionByPath(process.argv[1]))`, p],
    { cwd: ROOT, encoding: 'utf8' }).status
  check('J-114⑪ 🟢 **反向守**:指向沙箱库 → 放行(不是把所有人都拦死)',
    probe(join(ROOT, 'apps/api/sandbox-data')) === 0, String(probe(join(ROOT, 'apps/api/sandbox-data'))))
  check('J-114⑫ 🟢 **反向守**:指向回归临时库 → 放行', probe('/tmp/ll-ci-data.probe') === 0)
  check('J-114⑬ 🔴 指向生产那个路径 → 拒', probe('/app/apps/api/local-data') === 2)
  check('J-114⑭ 🔴 路径判不出来(unknown)→ **也拒**(判不出不等于安全)', probe('/whatever') === 2)
}

console.log(`\n全部通过 (${checks} 项)`)
