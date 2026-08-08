// 财务密码门禁回归(店主 2026-08-08 拍板的口径):
// ① 默认关闭,全商户一律 —— 新店进财务区不该被拦,也不该被逼着先设一个密码
// ② 归商家自助:老板自己在门店设置里开/关/改密,不经平台
// ③ 开启必须同时给密码(没密码的开关等于没锁);开了之后没钥匙就 403
// ④ 关掉即时生效,已发的钥匙作废,财务区照常进
// ⑤ 租户隔离:A 店开了不影响 B 店
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
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

  // ---- ④ 关掉即时生效 ----
  const off = await request('/admin/finance/lock-settings', { method: 'PUT', body: JSON.stringify({ enabled: false }) }, a.token)
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

  console.log(`\n财务密码门禁回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
