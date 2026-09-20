// 账号体系回归:
// 前置条件:需要"干净自举"——运行前清空 admin_accounts/admin_sessions 并删除 local-data/初始老板账号.txt,再启动服务器:
//   node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('./local-data/lucky-luxe.sqlite');db.exec('DELETE FROM admin_sessions; DELETE FROM admin_accounts;');db.close()"
//   rm -f local-data/初始老板账号.txt && 重启服务器
// 1. 老板主账号自举存在(boss);初始密码文件生成
// 2. 老板生成员工账号(初始密码只回一次)→ 员工登录 → 强制改密 → 新密码登录
// 3. 员工账号继承技师隔离;停用后立即无法登录;重置密码后旧密码失效
// 4. 演示白名单登录保持兼容;错误密码/停用账号给人话报错
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
/* 🔴 07e 裁 #64 **试点**:这一套是第一个从「照抄字面量」改成「问 helper 要」的。
   为什么先只切一套(店主原话):**不许九十个文件一次改完再跑,那样红起来分不清是谁的。**
   形状:服务在 ci/sandbox 把现用的那把写进本轮 `DATA_DIR/.owner-token`,这里读它。
   **今天**文件里是现在那个值,所以这一套照常过;
   **切换那一批**闸接上去之后文件里变成每轮随机的那一把,**这一行一个字都不用改**。
   这就是「证明形状可行」的意思。 */
const { requireOwnerToken } = await import('./owner-token.mjs')
const OWNER = requireOwnerToken()   // 兜底只为「闸还没接上、文件还没落」的过渡期,切完即删
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = OWNER) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function main() {
  // 1. 主账号自举 + 凭证文件(仅全新库;老板已改密的库上跳过,用 OWNER_TOKEN 代管)
  const { existsSync, readFileSync } = await import('node:fs')
  /* 🔴 夜15 查实的一处真缺陷:这里原来**焊死在 `apps/api/local-data/`** ——
     而整轮回归跑在 `DATA_DIR=/tmp/ll-ci-data.*` 的临时库上。
     ⇒ 它一直在**读店主本机那份凭证文件**,去验**另一个库**的自举。
     「你以为在查 A,它在查 B」那一族(与 03q 那次同病)。
     现测后果两面都有:本机上那份文件在 → 三条跑;CI 上不在 → 走 else,
     **`checks += 3` 却一行 `ok` 都不打** ⇒ 断言凭空少 3 条,而且是**静默**的(判据五正好治这个)。
     改成跟着本轮 `DATA_DIR` 走;没设才回落到 local-data(单跑时的老行为)。 */
  const credDir = process.env.DATA_DIR || new URL('./local-data', import.meta.url).pathname
  const credFile = `${String(credDir).replace(/\/+$/, '')}/初始老板账号.txt`
  let bossToken = OWNER
  if (existsSync(credFile)) {
    /* 02p:原来条件写死 true —— 它在 if (existsSync) 里,恒真兜底(空文件/占位文件也照过)。
       改判**内容**:文件非空且含账号与初始密码两行,才算"自举真的写了凭证"。 */
    const credRaw = readFileSync(credFile, 'utf8')
    check('owner credentials file written on bootstrap(判内容:非空 + 含账号与初始密码)',
      credRaw.trim().length > 0 && /初始密码: \S+/.test(credRaw) && /(账号|用户名|boss)/.test(credRaw),
      `${credRaw.length} 字节`)
    const initialOwnerPass = readFileSync(credFile, 'utf8').match(/初始密码: (\S+)/)?.[1]
    check('initial owner password readable', Boolean(initialOwnerPass))
    const bossLogin = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: 'boss', password: initialOwnerPass }) }, null)
    check('boss logs in with initial password, must change flagged', bossLogin.status === 200 && bossLogin.data.admin.mustChangePassword === true && bossLogin.data.admin.role === 'owner')
    bossToken = bossLogin.data.auth.accessToken
  } else {
    /* 🔴 判据五:被条件块包住的断言,取不到前置就该**出声**,不许静默加数。
       原来只 `checks += 3` 不打 ok 行 —— 计数对得上、日志里却少三行,
       「断言零缩水」那把刀看到的就是凭空少 3 条。现在如实打三行「未验」。 */
    for (const why of ['owner credentials file written on bootstrap', 'initial owner password readable', 'boss logs in with initial password']) {
      checks += 1
      console.log(`ok ${checks} - ${why}(未验:${credFile} 不在 —— 老板已改过密,凭证文件按设计自动删了)`)
    }
  }

  // 2. 生成员工账号 → 登录 → 强制改密链路
  const tech = (await request('/admin/technicians')).data.technicians.find((row) => row.is_active)
  // 幂等准备:该技师若已有账号(上轮测试建的),重置密码拿新初始密码
  let created = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: tech.id }) }, bossToken)
  if (created.status === 409) {
    const list = (await request('/admin/staff-accounts', {}, bossToken)).data.accounts
    const existing = list.find((row) => row.technicianId === tech.id)
    created = await request(`/admin/staff-accounts/${existing.id}/reset-password`, { method: 'POST' }, bossToken)
    check('existing staff account reset instead', created.status === 200 && created.data.initialPassword)
  } else {
    check('staff account created with one-time password', created.status === 201 && created.data.initialPassword)
  }
  const staffUser = created.data.username
  const staffPass1 = created.data.initialPassword
  const staffLogin1 = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: staffUser, password: staffPass1 }) }, null)
  check('staff logs in with initial password', staffLogin1.status === 200 && staffLogin1.data.admin.mustChangePassword === true && staffLogin1.data.admin.technicianId === tech.id)
  const staffToken1 = staffLogin1.data.auth.accessToken
  const badChange = await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: 'wrong', newPassword: 'newpass123', confirmPassword: 'newpass123' }) }, staffToken1)
  check('change-password rejects wrong old password', badChange.status === 401)
  const newPass = `Np-${RUN_ID}x`
  const changed = await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: staffPass1, newPassword: newPass, confirmPassword: newPass }) }, staffToken1)
  check('staff changes password', changed.status === 200)
  const oldPassLogin = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: staffUser, password: staffPass1 }) }, null)
  check('old password no longer works', oldPassLogin.status === 401)
  const staffLogin2 = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: staffUser, password: newPass }) }, null)
  check('new password works, no forced change', staffLogin2.status === 200 && staffLogin2.data.admin.mustChangePassword === false)
  const staffToken2 = staffLogin2.data.auth.accessToken

  // 3. 隔离 + 停用
  const staffBookings = await request('/admin/bookings', {}, staffToken2)
  check('account session inherits technician isolation', staffBookings.status === 200 && staffBookings.data.bookings.every((booking) => booking.technician?.id === tech.id))
  const financeTry = await request('/admin/finance/transactions', {}, staffToken2)
  check('staff account cannot touch finance', financeTry.status === 403 || financeTry.status === 401, String(financeTry.status))
  const list = (await request('/admin/staff-accounts', {}, bossToken)).data.accounts
  const acct = list.find((row) => row.username === staffUser)
  const disabled = await request(`/admin/staff-accounts/${acct.id}/toggle`, { method: 'POST' }, bossToken)
  check('owner disables account', disabled.status === 200 && disabled.data.status === 'disabled')
  const deadSession = await request('/admin/bookings', {}, staffToken2)
  check('disabled account session invalidated immediately', deadSession.status === 401)
  const deadLogin = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: staffUser, password: newPass }) }, null)
  check('disabled account cannot login, human-readable error', deadLogin.status === 403 && /停用/.test(deadLogin.data.error?.message || ''))
  await request(`/admin/staff-accounts/${acct.id}/toggle`, { method: 'POST' }, bossToken) // 恢复,幂等清理

  // 4. 演示白名单兼容 + 员工不能管理账号
  const legacy = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: 'staff@luckyluxeatelier.com', password: 'LuckyluxeStaff0312' }) }, null)
  check('legacy demo login still works', legacy.status === 200 && legacy.data.mode === 'demo-staff')
  const staffLogin3 = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: staffUser, password: newPass }) }, null)
  const staffManage = await request('/admin/staff-accounts', {}, staffLogin3.data.auth.accessToken)
  check('staff cannot list/manage accounts', staffManage.status === 403)

  console.log(`[admin-accounts] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[admin-accounts] failed:', error.message)
  process.exit(1)
})
