// P0 平台顾客导入回归(2026-08-06):
// 1. dryRun 只出报告、零写库
// 2. 执行后:期初余额进 legacy 桶、is_migrated=1、历史累计消费进 legacy_total_spend_cents
// 3. 手机号去重(文件内重复 + 库里已存在)
// 4. 同手机号但姓名不同 = 冲突,进报告且不写库
// 5. 期初余额不进财务账本(只是负债,不是本店收入)
// 6. 权限:非平台主钥匙不可调用;确认金额对不上直接拒绝
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newTenant(label) {
  const id = `p0im-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `P0 导入测试店 ${label} ${RUN_ID}`, plan: 'single' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const newPass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: newPass, confirmPassword: newPass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: newPass }) }, null)
  return { tenantId: created.data.tenant.id, token: again.data.auth.accessToken }
}

async function main() {
  const shop = await newTenant('a')
  const importPath = `/platform/tenants/${shop.tenantId}/import/customers`
  const P = (n) => `1390000${RUN_ID.slice(-4)}${n}`

  const rows = [
    { name: '林小雅', phone: P(1), balanceCents: 128000, totalSpendCents: 560000, tags: 'VIP,怕痛', note: '手部敏感', birthday: '03-14' },
    { name: '王梦琪', phone: P(2), balanceCents: 0, totalSpendCents: 30000 },
    { name: '重复的人', phone: P(1), balanceCents: 99999 }, // 文件内手机号重复 → 只取第一条
    { name: '没手机号', phone: '', balanceCents: 50000 } // 无手机号 → 跳过
  ]

  // ---- 1. dryRun 零写库 ----
  const dry = await request(importPath, { method: 'POST', body: JSON.stringify({ rows, dryRun: true }) })
  check('dryRun 返回报告', dry.status === 200 && dry.data.dryRun === true, JSON.stringify(dry.data))
  check('dryRun:2 条待新建', dry.data.toCreate === 2 && dry.data.toUpdate === 0, JSON.stringify(dry.data))
  check('dryRun:期初余额总额正确(不含被跳过的行)', dry.data.balanceSumCents === 128000, String(dry.data.balanceSumCents))
  check('dryRun:文件内重复与缺手机号进 skipped', dry.data.skipped.length === 2, JSON.stringify(dry.data.skipped))
  const membersBefore = await request('/admin/membership/members', {}, shop.token)
  check('dryRun 后库里零顾客(真的没写)', membersBefore.data.members.length === 0, JSON.stringify(membersBefore.data.members))

  // ---- 2. 确认金额对不上 → 拒绝 ----
  const wrongConfirm = await request(importPath, { method: 'POST', body: JSON.stringify({ rows, dryRun: false, confirmBalanceCents: 999 }) })
  check('期初余额确认数对不上 → 400 拒绝', wrongConfirm.status === 400 && wrongConfirm.data.error.code === 'BALANCE_CONFIRM_MISMATCH', JSON.stringify(wrongConfirm.data))
  const stillEmpty = await request('/admin/membership/members', {}, shop.token)
  check('被拒后仍然零写库', stillEmpty.data.members.length === 0)

  // ---- 3. 执行导入 ----
  const run = await request(importPath, { method: 'POST', body: JSON.stringify({ rows, dryRun: false, confirmBalanceCents: 128000 }) })
  check('执行导入成功', run.status === 200 && run.data.dryRun === false, JSON.stringify(run.data))
  check('新建 2 人、期初写入 1280 元', run.data.created === 2 && run.data.openingWrittenCents === 128000, JSON.stringify(run.data))

  const members = await request('/admin/membership/members', {}, shop.token)
  check('库里正好 2 个顾客(手机号去重生效)', members.data.members.length === 2, JSON.stringify(members.data.members))
  const lin = members.data.members.find((m) => m.name === '林小雅')
  check('期初余额进 legacy 桶,normal 桶为 0', lin.legacyBalanceCents === 128000 && lin.normalBalanceCents === 0 && lin.balanceCents === 128000, JSON.stringify(lin))
  check('is_migrated 标记为已迁移', lin.isMigrated === true)
  check('历史累计消费只进 legacy_total_spend(计入会员判定口径)', lin.totalSpendCents === 560000, String(lin.totalSpendCents))
  check('迁移期初不算本系统首充', lin.isFirstRecharge === true)

  // ---- 4. 期初余额不进财务账本 ----
  const finance = await request('/admin/finance/summary', { method: 'POST', body: JSON.stringify({ range: 'month' }) }, shop.token)
  const incomeCents = finance.data?.finance?.summary?.incomeCents ?? finance.data?.finance?.incomeCents ?? 0
  check('期初余额没有变成本店收入', incomeCents === 0, JSON.stringify(finance.data?.finance?.summary || finance.data?.finance || {}).slice(0, 200))

  // ---- 5. 二次导入:同手机号同姓名 = 更新;姓名不同 = 冲突不写库 ----
  const second = await request(importPath, {
    method: 'POST',
    body: JSON.stringify({
      dryRun: true,
      rows: [
        { name: '林小雅', phone: P(1), balanceCents: 0, totalSpendCents: 700000 },
        { name: '另一个人', phone: P(2), balanceCents: 20000 }
      ]
    })
  })
  check('同手机号同姓名 → 计入待更新', second.data.toUpdate === 1 && second.data.toCreate === 0, JSON.stringify(second.data))
  check('同手机号但姓名不同 → 进 conflicts', second.data.conflicts.length === 1 && second.data.conflicts[0].existingName === '王梦琪', JSON.stringify(second.data.conflicts))
  check('冲突行的余额不计入期初总额', second.data.balanceSumCents === 0, String(second.data.balanceSumCents))

  const secondRun = await request(importPath, {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      rows: [
        { name: '林小雅', phone: P(1), balanceCents: 0, totalSpendCents: 700000 },
        { name: '另一个人', phone: P(2), balanceCents: 20000 }
      ]
    })
  })
  check('二次执行:1 更新 0 新建', secondRun.data.updated === 1 && secondRun.data.created === 0, JSON.stringify(secondRun.data))
  const after = await request('/admin/membership/members', {}, shop.token)
  check('冲突行没被写进去(仍然 2 个顾客)', after.data.members.length === 2, JSON.stringify(after.data.members.map((m) => m.name)))
  const linAfter = after.data.members.find((m) => m.name === '林小雅')
  check('更新只抬高历史累计消费,不重复写期初余额', linAfter.totalSpendCents === 700000 && linAfter.legacyBalanceCents === 128000, JSON.stringify(linAfter))
  const wang = after.data.members.find((m) => m.name === '王梦琪')
  check('冲突顾客的余额没被改动', wang.balanceCents === 0, JSON.stringify(wang))

  // ---- 6. 权限 ----
  const noKey = await request(importPath, { method: 'POST', body: JSON.stringify({ rows, dryRun: true }) }, shop.token)
  check('商家老板 token 不能调平台导入', noKey.status === 401, JSON.stringify(noKey.data))
  const missing = await request(`/platform/tenants/no-such-tenant-${RUN_ID}/import/customers`, { method: 'POST', body: JSON.stringify({ rows, dryRun: true }) })
  check('不存在的租户 → 404', missing.status === 404)
  const empty = await request(importPath, { method: 'POST', body: JSON.stringify({ rows: [], dryRun: true }) })
  check('空数据 → 400', empty.status === 400)

  console.log(`\n顾客导入回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
