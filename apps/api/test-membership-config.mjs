// P0 会员可配回归(2026-08-06):
// 1. 四种会员资格模式(any_recharge / balance_gt_0 / total_spend / manual)各判定一例
// 2. 首充判定 = 从未有过 recharge 流水(清零后复充 ≠ 首充)
// 3. tiersEnabled=false 时接口不下发等级字段;打开后才下发
// 4. 充值档位 CRUD + 租户隔离
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

const financeKeys = new Map() // token → financeKey(储值充值/耗卡走财务门禁)

async function request(path, options = {}, token = PLATFORM) {
  const financeKey = token ? financeKeys.get(token) : null
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(financeKey ? { 'x-finance-key': financeKey } : {}),
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newTenant(label) {
  const id = `p0mb-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `P0 会员测试店 ${label} ${RUN_ID}`, plan: 'single' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const newPass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: newPass, confirmPassword: newPass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: newPass }) }, null)
  const token = again.data.auth.accessToken
  // 财务门禁:用 OWNER_TOKEN 主钥匙解锁(储值充值/耗卡是财务动作)
  const unlock = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) financeKeys.set(token, unlock.data.financeKey)
  return { tenantId: created.data.tenant.id, token }
}

// 借「平台顾客导入」建顾客(不依赖小程序登录),返回 userId
async function makeCustomer(tenantId, name, extra = {}) {
  const res = await request(`/platform/tenants/${tenantId}/import/customers`, {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, rows: [{ name, phone: `139${Math.random().toString().slice(2, 10)}`, ...extra }] })
  })
  if (res.status !== 200 || !res.data.users?.length) throw new Error(`建顾客失败: ${JSON.stringify(res.data)}`)
  return res.data.users[0].userId
}

async function setConfig(token, config) {
  return request('/admin/membership/config', { method: 'PUT', body: JSON.stringify({ config }) }, token)
}

// 会员判定没有独立读接口,借 /admin/pricing/preview 不合适——直接用储值充值/消费接口造数据,
// 再用 /admin/customers 的会员字段与 /admin/membership/config 回读断言配置本身。
async function recharge(token, userId, amountCents) {
  return request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId, amountCents, payChannel: 'cash' }) }, token)
}
async function consume(token, userId, amountCents) {
  return request('/admin/stored-value/consume', { method: 'POST', body: JSON.stringify({ userId, amountCents }) }, token)
}

async function main() {
  const shop = await newTenant('a')
  const other = await newTenant('b')
  check('临时店建好', Boolean(shop.token && other.token))

  // ---- 1. 默认配置 + tiersEnabled=false 不下发等级 ----
  const def = await request('/admin/membership/config', {}, shop.token)
  check('会员配置默认可读', def.status === 200 && def.data.config.memberQualify === 'any_recharge', JSON.stringify(def.data))
  check('tiersEnabled=false 时不返回等级字段', def.data.config.tiersEnabled === false && def.data.config.tiers === undefined, JSON.stringify(def.data.config))
  check('四种资格模式随接口下发', Array.isArray(def.data.qualifyModes) && def.data.qualifyModes.length === 4)

  const withTiers = await setConfig(shop.token, { tiersEnabled: true, tiers: [{ key: 'silver', name: '银卡', minSpendCents: 100000 }] })
  check('打开等级后才下发 tiers', withTiers.data.config.tiersEnabled === true && Array.isArray(withTiers.data.config.tiers) && withTiers.data.config.tiers.length === 1, JSON.stringify(withTiers.data.config))
  const backOff = await setConfig(shop.token, { tiersEnabled: false })
  check('关掉等级后立刻不再下发 tiers', backOff.data.config.tiers === undefined)

  // ---- 2. 四种资格模式 ----
  // (a) any_recharge:充过值就是会员
  const uRecharge = await makeCustomer(shop.tenantId, `充值客${RUN_ID}`)
  const uNever = await makeCustomer(shop.tenantId, `白板客${RUN_ID}`)
  await setConfig(shop.token, { memberQualify: 'any_recharge', qualifyValueCents: 0, expireDays: null })
  const r1 = await recharge(shop.token, uRecharge, 50000)
  check('充值成功', r1.status === 201 || r1.status === 200, JSON.stringify(r1.data).slice(0, 200))
  let members = await request('/admin/membership/members', {}, shop.token)
  check('any_recharge:充过值的是会员,没充的不是',
    members.data.members.find((m) => m.userId === uRecharge)?.isMember === true
    && members.data.members.find((m) => m.userId === uNever)?.isMember === false,
    JSON.stringify(members.data.members))

  // (b) balance_gt_0:余额清零后不再是会员
  await setConfig(shop.token, { memberQualify: 'balance_gt_0' })
  await consume(shop.token, uRecharge, 50000)
  members = await request('/admin/membership/members', {}, shop.token)
  check('balance_gt_0:余额清零 → 不是会员', members.data.members.find((m) => m.userId === uRecharge)?.isMember === false, JSON.stringify(members.data.members))
  await setConfig(shop.token, { memberQualify: 'any_recharge' })
  members = await request('/admin/membership/members', {}, shop.token)
  check('any_recharge:余额清零仍然是会员(充过就算)', members.data.members.find((m) => m.userId === uRecharge)?.isMember === true)

  // (c) total_spend:门槛判定,迁移带过来的历史消费也算
  const uSpend = await makeCustomer(shop.tenantId, `老消费客${RUN_ID}`, { totalSpendCents: 200000, balanceCents: 100 })
  await setConfig(shop.token, { memberQualify: 'total_spend', qualifyValueCents: 150000 })
  members = await request('/admin/membership/members', {}, shop.token)
  check('total_spend:历史累计消费达门槛 → 会员', members.data.members.find((m) => m.userId === uSpend)?.isMember === true, JSON.stringify(members.data.members))
  await setConfig(shop.token, { memberQualify: 'total_spend', qualifyValueCents: 300000 })
  members = await request('/admin/membership/members', {}, shop.token)
  check('total_spend:抬高门槛后不再是会员', members.data.members.find((m) => m.userId === uSpend)?.isMember === false)

  // (d) manual:老板手动打「会员」标签
  await setConfig(shop.token, { memberQualify: 'manual' })
  members = await request('/admin/membership/members', {}, shop.token)
  check('manual:没打标签的都不是会员', members.data.members.every((m) => m.isMember === false))
  const tagged = await request(`/admin/customers/${uNever}/profile`, { method: 'PATCH', body: JSON.stringify({ tags: ['会员'] }) }, shop.token)
  check('给顾客打会员标签', tagged.status === 200, JSON.stringify(tagged.data).slice(0, 200))
  members = await request('/admin/membership/members', {}, shop.token)
  check('manual:打了标签就是会员', members.data.members.find((m) => m.userId === uNever)?.isMember === true, JSON.stringify(members.data.members))

  // ---- 3. 首充判定 ----
  const uFirst = await makeCustomer(shop.tenantId, `首充客${RUN_ID}`)
  let one = await request(`/admin/membership/members?userId=${uFirst}`, {}, shop.token)
  check('从没充过 → 是首充', one.data.members.find((m) => m.userId === uFirst)?.isFirstRecharge === true, JSON.stringify(one.data.members))
  await recharge(shop.token, uFirst, 20000)
  one = await request(`/admin/membership/members?userId=${uFirst}`, {}, shop.token)
  check('充过一次后 → 不是首充', one.data.members.find((m) => m.userId === uFirst)?.isFirstRecharge === false)
  await consume(shop.token, uFirst, 20000)
  one = await request(`/admin/membership/members?userId=${uFirst}`, {}, shop.token)
  check('清零复充也不是首充(按流水判定,不按余额)', one.data.members.find((m) => m.userId === uFirst)?.isFirstRecharge === false)

  // 迁移进来的期初余额:算会员(老店充过),但不占用「首充」资格
  const uMigrated = await makeCustomer(shop.tenantId, `迁移客${RUN_ID}`, { balanceCents: 88000 })
  await setConfig(shop.token, { memberQualify: 'any_recharge' })
  const mig = await request(`/admin/membership/members?userId=${uMigrated}`, {}, shop.token)
  const migRow = mig.data.members.find((m) => m.userId === uMigrated)
  check('迁移客算会员(老店的充值)', migRow?.isMember === true, JSON.stringify(migRow))
  check('迁移客在本系统仍算首充(期初不是本店的充值流水)', migRow?.isFirstRecharge === true)
  check('迁移余额进 legacy 桶', migRow?.legacyBalanceCents === 88000 && migRow?.normalBalanceCents === 0, JSON.stringify(migRow))

  // ---- 4. 充值档位 CRUD + 隔离 ----
  const t1 = await request('/admin/recharge-tiers', { method: 'POST', body: JSON.stringify({ amountCents: 100000, gift: { type: 'percent', value: 10 }, sortOrder: 1 }) }, shop.token)
  check('新建充值档位', t1.status === 201 && t1.data.tier.amountCents === 100000 && t1.data.tier.gift.value === 10, JSON.stringify(t1.data))
  const t2 = await request('/admin/recharge-tiers', { method: 'POST', body: JSON.stringify({ amountCents: 300000, gift: { type: 'service', serviceId: 'svc-demo' }, sortOrder: 2 }) }, shop.token)
  check('第二个档位', t2.status === 201)
  const listed = await request('/admin/recharge-tiers', {}, shop.token)
  check('档位按排序返回', listed.data.tiers.length === 2 && listed.data.tiers[0].amountCents === 100000)
  const patched = await request(`/admin/recharge-tiers/${t1.data.tier.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) }, shop.token)
  check('档位可停用', patched.data.tier.isActive === false)
  const removed = await request(`/admin/recharge-tiers/${t2.data.tier.id}`, { method: 'DELETE' }, shop.token)
  check('档位可删除', removed.status === 200 && removed.data.deleted === true)
  const otherTiers = await request('/admin/recharge-tiers', {}, other.token)
  check('租户隔离:B 店看不到 A 店的档位', otherTiers.data.tiers.length === 0, JSON.stringify(otherTiers.data))
  const otherConfig = await request('/admin/membership/config', {}, other.token)
  check('租户隔离:B 店的会员配置不受 A 店影响', otherConfig.data.config.memberQualify === 'any_recharge' && otherConfig.data.config.qualifyValueCents === 0)

  console.log(`\n会员可配回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
