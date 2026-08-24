// 财务密码门禁回归(店主 2026-08-08 拍板的口径):
// ① 默认关闭,全商户一律 —— 新店进财务区不该被拦,也不该被逼着先设一个密码
// ② 归商家自助:老板自己在门店设置里开/关/改密,不经平台
// ③ 开启必须同时给密码(没密码的开关等于没锁);开了之后没钥匙就 403
// ④ 关掉即时生效,已发的钥匙作废,财务区照常进
// ⑤ 租户隔离:A 店开了不影响 B 店
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `p2fl-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `财务锁店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  return { tenantId: id, token: again.data.auth.accessToken }
}

async function main() {
  const a = await newShop('a')
  const b = await newShop('b')
  check('两家临时店建好', Boolean(a.token && b.token))

  // ---- ① 默认关闭 ----
  const st = await request('/admin/finance/lock-settings', {}, a.token)
  check('① 新店默认不开财务密码', st.data.enabled === false && st.data.configured === false, JSON.stringify(st.data))
  const open = await request('/admin/finance/transactions', {}, a.token)
  check('① 没开门禁时财务区直接进得去(不用钥匙)', open.status === 200, `${open.status} ${JSON.stringify(open.data).slice(0, 120)}`)
  const lockStatus = await request('/admin/finance/lock-status', {}, a.token)
  check('① lock-status 也下发 enabled 供前端判断要不要弹锁屏',
    lockStatus.data.enabled === false && lockStatus.data.configured === false, JSON.stringify(lockStatus.data))

  // ---- ③ 开启必须给密码 ----
  const noPwd = await request('/admin/finance/lock-settings', { method: 'PUT', body: JSON.stringify({ enabled: true }) }, a.token)
  check('③ 只开开关不给密码 → 拒绝', noPwd.status === 400, `${noPwd.status} ${JSON.stringify(noPwd.data)}`)
  const mismatch = await request('/admin/finance/lock-settings', {
    method: 'PUT', body: JSON.stringify({ enabled: true, password: 'fin1234', confirmPassword: 'fin9999' })
  }, a.token)
  check('③ 两次密码不一致 → 拒绝', mismatch.status === 400, `${mismatch.status}`)

  const on = await request('/admin/finance/lock-settings', {
    method: 'PUT', body: JSON.stringify({ enabled: true, password: 'fin1234', confirmPassword: 'fin1234' })
  }, a.token)
  check('③ 开启成功并直接发一把钥匙(免得老板保存完把自己关在门外)',
    on.status === 200 && on.data.enabled === true && Boolean(on.data.financeKey), JSON.stringify(on.data).slice(0, 120))
  const blocked = await request('/admin/finance/transactions', {}, a.token)
  check('③ 开了之后没钥匙就 403', blocked.status === 403 && blocked.data.error.code === 'FINANCE_LOCKED',
    `${blocked.status} ${JSON.stringify(blocked.data)}`)
  const withKey = await request('/admin/finance/transactions', {}, a.token, { 'x-finance-key': on.data.financeKey })
  check('③ 带钥匙照常进', withKey.status === 200, `${withKey.status}`)
  const unlocked = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: 'fin1234' }) }, a.token)
  check('③ 用密码能换到钥匙', unlocked.status === 200 && Boolean(unlocked.data.financeKey), JSON.stringify(unlocked.data).slice(0, 120))
  const wrong = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: 'nope' }) }, a.token)
  check('③ 密码错了拿不到钥匙', wrong.status === 401, `${wrong.status}`)

  // ---- ⑤ 租户隔离 ----
  const bStill = await request('/admin/finance/lock-settings', {}, b.token)
  check('⑤ A 店开了不影响 B 店(仍是关的)', bStill.data.enabled === false, JSON.stringify(bStill.data))
  const bOpen = await request('/admin/finance/transactions', {}, b.token)
  check('⑤ B 店财务区照常进', bOpen.status === 200, `${bOpen.status}`)

  // ---- 屏 V4:关闭与改密都要验当前密码 ----
  const offNoPwd = await request('/admin/finance/lock-settings', { method: 'PUT', body: JSON.stringify({ enabled: false }) }, a.token)
  check('V4 关闭时不给当前密码 → 401(谁摸到电脑都能拆锁可不行)', offNoPwd.status === 401, `${offNoPwd.status}`)
  const offWrong = await request('/admin/finance/lock-settings', {
    method: 'PUT', body: JSON.stringify({ enabled: false, currentPassword: 'nope' })
  }, a.token)
  check('V4 当前密码错了也拦住', offWrong.status === 401, `${offWrong.status}`)
  const chgNoPwd = await request('/admin/finance/lock-settings', {
    method: 'PUT', body: JSON.stringify({ enabled: true, password: 'fin5678', confirmPassword: 'fin5678' })
  }, a.token)
  check('V4 改密时也要验当前密码', chgNoPwd.status === 401, `${chgNoPwd.status}`)
  const chgOk = await request('/admin/finance/lock-settings', {
    method: 'PUT', body: JSON.stringify({ enabled: true, currentPassword: 'fin1234', password: 'fin5678', confirmPassword: 'fin5678' })
  }, a.token)
  check('V4 带对当前密码就能改', chgOk.status === 200 && chgOk.data.enabled === true, `${chgOk.status}`)
  const oldPwdGone = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: 'fin1234' }) }, a.token)
  check('V4 改完之后旧密码失效', oldPwdGone.status === 401, `${oldPwdGone.status}`)
  const newPwdWorks = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: 'fin5678' }) }, a.token)
  check('V4 新密码可用', newPwdWorks.status === 200 && Boolean(newPwdWorks.data.financeKey), `${newPwdWorks.status}`)

  // ---- ④ 关掉即时生效(带当前密码)----
  const off = await request('/admin/finance/lock-settings', { method: 'PUT', body: JSON.stringify({ enabled: false, currentPassword: 'fin5678' }) }, a.token)
  check('④ 关掉后 enabled=false', off.data.enabled === false, JSON.stringify(off.data))
  const afterOff = await request('/admin/finance/transactions', {}, a.token)
  check('④ 关掉后不带钥匙也进得去', afterOff.status === 200, `${afterOff.status}`)
  const oldKey = await request('/admin/finance/transactions', {}, a.token, { 'x-finance-key': on.data.financeKey })
  check('④ 旧钥匙已作废但不影响访问(门本来就开着)', oldKey.status === 200, `${oldKey.status}`)
  check('④ 密码本身留着(下次开启不用重设)', (await request('/admin/finance/lock-settings', {}, a.token)).data.configured === true)

  // ---- ② 商家自助:员工账号改不动 ----
  const tech = (await request(`/platform/tenants/${a.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技师${RUN_ID}` }) })).data.technician
  const acct = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: tech.id }) }, a.token)
  const sf = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.data.username, password: acct.data.initialPassword }) }, null)
  const sp = `Sf-${RUN_ID}-a9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: acct.data.initialPassword, newPassword: sp, confirmPassword: sp }) }, sf.data.auth.accessToken)
  const staffToken = (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.data.username, password: sp }) }, null)).data.auth.accessToken
  const staffTry = await request('/admin/finance/lock-settings', { method: 'PUT', body: JSON.stringify({ enabled: false }) }, staffToken)
  check('② 只有老板能改这个开关(员工 403)', staffTry.status === 403, `${staffTry.status}`)

  // ---- 平台侧重置(「忘记密码找平台」的标准路径,店主 2026-08-08 指令)----
  await request('/admin/finance/lock-settings', {
    method: 'PUT', body: JSON.stringify({ enabled: true, password: 'fin0000', confirmPassword: 'fin0000' })
  }, b.token)
  check('重置前 B 店门禁是开的', (await request('/admin/finance/lock-settings', {}, b.token)).data.enabled === true)
  const reset = await request(`/platform/tenants/${b.tenantId}/finance-lock/reset`, {
    method: 'POST', body: JSON.stringify({ reason: `回归用例 ${RUN_ID}` })
  })
  check('平台重置返回 enabled=false / configured=false 且说明原来有密码',
    reset.status === 200 && reset.data.enabled === false && reset.data.configured === false && reset.data.hadPassword === true,
    JSON.stringify(reset.data))
  const after = await request('/admin/finance/lock-settings', {}, b.token)
  check('重置后商家侧看到「未启用(默认)」', after.data.enabled === false && after.data.configured === false, JSON.stringify(after.data))
  const afterOpen = await request('/admin/finance/transactions', {}, b.token)
  check('重置后财务区直接进得去(不用密码)', afterOpen.status === 200, `${afterOpen.status}`)
  const oldGone = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: 'fin0000' }) }, b.token)
  check('原密码已作废(门禁本来就关了,直接放行而不是认旧密码)', oldGone.status === 200 && oldGone.data.enabled === false, JSON.stringify(oldGone.data))
  const logs = await request('/platform/ops-log')
  const hit = (logs.data.logs || []).find((l) => l.tenant_id === b.tenantId && l.action === 'finance_lock_reset')
  check('留下一行操作日志(谁/哪家店/什么时候/为什么)',
    Boolean(hit) && hit.detail.includes(RUN_ID) && Boolean(hit.created_at) && hit.operator === 'platform',
    JSON.stringify(hit))
  const reReset = await request(`/platform/tenants/${b.tenantId}/finance-lock/reset`, { method: 'POST', body: '{}' })
  check('对本来就没密码的店重置也不报错(幂等),并标注原来没密码',
    reReset.status === 200 && reReset.data.hadPassword === false, JSON.stringify(reReset.data))
  const noSuch = await request('/platform/tenants/not-a-tenant-xyz/finance-lock/reset', { method: 'POST', body: '{}' })
  check('店不存在 → 404', noSuch.status === 404, `${noSuch.status}`)
  const notPlatform = await request(`/platform/tenants/${b.tenantId}/finance-lock/reset`, { method: 'POST', body: '{}' }, b.token)
  check('商家自己的账号调不动这个平台端点(401)', notPlatform.status === 401, `${notPlatform.status}`)

  console.log(`\n财务密码门禁回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
