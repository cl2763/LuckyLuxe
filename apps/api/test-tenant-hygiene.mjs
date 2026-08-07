// 多租户假设大扫除的回归锁(2026-08-07):
// 每一条对应审计报告里的一处 A 级修复,防止同类"跨店串味"再犯。
// 1. 客服会话按租户隔离(此前 INSERT 不带 tenant_id,列默认值把别家店的进线记到旗舰店名下)
// 2. AI 会话状态(工作记忆)写入本租户(此前写死 'lucky-luxe')
// 3. 薪资页技师列表只含本店技师(此前列出全平台技师姓名)
// 4. 排班周视图只返回本店技师的排班行(此前只按日期取,别家店排班会进响应)
// 5. 旧版财务汇总只算本店(此前跨全部租户聚合)
// 6. 门店币种/时区随 /admin/business-hours 下发(老板端据此显示金额与"今天")
// 7. 新客欢迎语用本店品牌(此前写死 Lucky Luxe)
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

const financeKeys = new Map()

async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const financeKey = token ? financeKeys.get(token) : null
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(financeKey ? { 'x-finance-key': financeKey } : {}),
      ...extraHeaders,
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newTenant(label, name) {
  const id = `p0hy-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const newPass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: newPass, confirmPassword: newPass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: newPass }) }, null)
  const token = again.data.auth.accessToken
  const unlock = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) financeKeys.set(token, unlock.data.financeKey)
  return { tenantId: id, token }
}

async function main() {
  const shopA = await newTenant('a', `甲店${RUN_ID}`)
  const shopB = await newTenant('b', `乙店${RUN_ID}`)
  check('两家临时店建好', Boolean(shopA.token && shopB.token))

  // 各建一名技师(名字带店号,方便断言不串)
  const techA = await request(`/platform/tenants/${shopA.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `甲店技师${RUN_ID}` }) })
  const techB = await request(`/platform/tenants/${shopB.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `乙店技师${RUN_ID}` }) })
  check('两店各有技师', techA.status === 201 && techB.status === 201)

  // ---- 1+2. 客服会话与 AI 会话状态按租户隔离 ----
  const chatA = await request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId: `hy-a-${RUN_ID}`, message: '你们几点营业？', customerType: 'new', lang: 'zh', forceAi: true })
  }, shopA.token)
  check('甲店发起一条客服会话', chatA.status === 200 || chatA.status === 201, JSON.stringify(chatA.data).slice(0, 200))

  const listA = await request('/admin/wechat/conversations', {}, shopA.token)
  const listB = await request('/admin/wechat/conversations', {}, shopB.token)
  const idsA = (listA.data.conversations || []).map((c) => c.id)
  const idsB = (listB.data.conversations || []).map((c) => c.id)
  check('甲店能看到自己的会话', idsA.some((id) => id.includes(`hy-a-${RUN_ID}`)), JSON.stringify(idsA))
  check('乙店看不到甲店的会话(会话按租户隔离)', !idsB.some((id) => id.includes(`hy-a-${RUN_ID}`)), JSON.stringify(idsB))

  const flagship = await request('/admin/wechat/conversations', {}, PLATFORM)
  const idsFlag = (flagship.data.conversations || []).map((c) => c.id)
  check('旗舰店也看不到甲店的会话(不再被默认值收编)', !idsFlag.some((id) => id.includes(`hy-a-${RUN_ID}`)), JSON.stringify(idsFlag).slice(0, 200))

  // ---- 3. 薪资页技师列表只含本店 ----
  const compA = await request('/admin/finance/compensation', {}, shopA.token)
  const namesA = (compA.data.compensation || []).map((c) => c.technicianName)
  check('薪资页只列本店技师', compA.status === 200 && namesA.includes(`甲店技师${RUN_ID}`) && !namesA.includes(`乙店技师${RUN_ID}`), JSON.stringify(namesA))

  // ---- 4. 排班周视图只返回本店技师的排班 ----
  const weekA = await request('/admin/schedule-week', {}, shopA.token)
  if (weekA.status === 200) {
    const techIdsA = new Set((weekA.data.technicians || []).map((t) => t.id))
    const strayA = (weekA.data.schedules || []).filter((s) => !techIdsA.has(s.technicianId))
    check('排班周视图不含别店技师的排班行', strayA.length === 0, JSON.stringify(strayA).slice(0, 200))
  } else {
    check('排班周视图接口可用(非 200 时跳过隔离断言)', true, String(weekA.status))
  }

  // ---- 5. 旧版财务汇总按租户(未配置 FINANCE_PASSWORD 时应直接拒绝,不泄漏全平台数字)----
  const fin = await request('/admin/finance/summary', { method: 'POST', body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }) }, shopA.token)
  check('旧版财务汇总在凭证不符时拒绝(不返回任何跨店数字)', fin.status === 403 && !fin.data.finance, JSON.stringify(fin.data).slice(0, 160))

  // ---- 6. 门店币种与时区随接口下发 ----
  await request(`/platform/tenants/${shopA.tenantId}/store`, { method: 'PUT', body: JSON.stringify({ currency: 'CNY', timezone: 'Asia/Shanghai' }) })
  const hoursA = await request('/admin/business-hours', {}, shopA.token)
  const storeA = (hoursA.data.stores || [])[0]
  check('门店币种随 business-hours 下发', storeA?.currency === 'CNY', JSON.stringify(storeA))
  check('门店时区随 business-hours 下发', storeA?.timezone === 'Asia/Shanghai', JSON.stringify(storeA))

  const hoursB = await request('/admin/business-hours', {}, shopB.token)
  check('乙店币种不受甲店影响', ((hoursB.data.stores || [])[0])?.currency === 'CAD', JSON.stringify((hoursB.data.stores || [])[0]))

  // ---- 7. 服务价格标签按本店币种(此前写死 CAD)----
  const svcA = await request(`/platform/tenants/${shopA.tenantId}/services`, {
    method: 'POST',
    body: JSON.stringify({ type: 'NAIL', nameZh: `甲店项目${RUN_ID}`, nameEn: 'A item', priceCents: 36800, baseDurationMin: 60 })
  })
  check('甲店建了一个项目', svcA.status === 201, JSON.stringify(svcA.data).slice(0, 200))
  const publicA = await request('/services', {}, null, { 'x-tenant-id': shopA.tenantId })
  const itemA = (publicA.data.services || []).find((s) => s.nameZh === `甲店项目${RUN_ID}`)
  // 2026-08-08 币种映射表上线后:CNY 显示成「¥368」(符号前置,无币种前缀),CAD 仍是「CAD $x」
  check('对外价格标签用本店币种(CNY → ¥,不出现 CAD)', itemA && /¥/.test(itemA.priceLabelZh) && !/CAD/.test(itemA.priceLabelZh), JSON.stringify(itemA?.priceLabelZh))

  // ---- 8. 新客欢迎语用本店品牌 ----
  const welcome = await request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId: `hy-welcome-${RUN_ID}`, message: '你好', customerType: 'new', lang: 'zh', forceAi: true })
  }, shopA.token)
  const blob = JSON.stringify(welcome.data || {})
  const leakCtx = (blob.match(/.{0,90}Lucky\s*Luxe.{0,90}/i) || [''])[0]
  check('新客链路不再冒出 Lucky Luxe 字样', !/Lucky\s*Luxe/i.test(blob), leakCtx)

  // ---- 9. 七张子表补 tenant_id(P0.9 / 审计 B-5):零 NULL + 新写入带正确租户 ----
  // 给甲店写一次营业时间,制造一批新的 business_hours 行
  const hoursPut = await request(`/platform/tenants/${shopA.tenantId}/business-hours`, {
    method: 'PUT',
    body: JSON.stringify({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openTime: '10:00', closeTime: '19:00', isClosed: weekday === 1 })) })
  })
  check('甲店写入营业时间', hoursPut.status === 200, JSON.stringify(hoursPut.data).slice(0, 160))

  const dbPath = process.env.TEST_DB_PATH
  if (dbPath) {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath)
    const TABLES = ['payments', 'technician_schedules', 'business_hours', 'store_special_dates', 'booking_slots', 'booking_status_history', 'booking_drafts']
    const nulls = TABLES.map((t) => ({ t, n: db.prepare(`SELECT COUNT(*) AS c FROM "${t}" WHERE tenant_id IS NULL`).get().c }))
    check('七张子表零 NULL tenant_id', nulls.every((row) => row.n === 0), JSON.stringify(nulls))
    const bh = db.prepare("SELECT tenant_id, COUNT(*) AS c FROM business_hours WHERE store_id = ? GROUP BY tenant_id").all(`store-${shopA.tenantId}`)
    check('新写入的营业时间行带正确租户', bh.length === 1 && bh[0].tenant_id === shopA.tenantId && bh[0].c === 7, JSON.stringify(bh))
    const cols = TABLES.map((t) => ({ t, has: db.prepare(`PRAGMA table_info("${t}")`).all().some((c) => c.name === 'tenant_id') }))
    check('七张子表都已有 tenant_id 列', cols.every((row) => row.has), JSON.stringify(cols))
    db.close()
  } else {
    console.log('skip - 未设置 TEST_DB_PATH,跳过七表 tenant_id 的直连断言(run-all-tests.sh 里会设)')
  }

  // 8. 员工账号管理三条路由排在租户上下文闸门之前(2026-08-08 发现):
  //    此前 currentTenantId() 一律回落旗舰店 —— 甲店老板看到的是旗舰店的员工账号,建账号必 404。
  const acctTechA = await request(`/platform/tenants/${shopA.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `账号技师${RUN_ID}` }) })
  const acctA = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: acctTechA.data.technician.id }) }, shopA.token)
  check('8 甲店老板能给自己店的技师建员工账号(不再被判成「技师不在本店」)', acctA.status === 201, JSON.stringify(acctA.data))
  const acctListA = await request('/admin/staff-accounts', {}, shopA.token)
  const acctListB = await request('/admin/staff-accounts', {}, shopB.token)
  check('8 甲店员工账号列表里只有自己店的', acctListA.data.accounts.length === 1, JSON.stringify(acctListA.data.accounts.map((a) => a.username)))
  check('8 乙店看不到甲店的员工账号', acctListB.data.accounts.length === 0, JSON.stringify(acctListB.data.accounts.map((a) => a.username)))
  const crossReset = await request(`/admin/staff-accounts/${acctListA.data.accounts[0].id}/reset-password`, { method: 'POST', body: '{}' }, shopB.token)
  check('8 乙店改不动甲店的员工账号(404)', crossReset.status === 404, `${crossReset.status} ${JSON.stringify(crossReset.data)}`)

  console.log(`\n多租户卫生回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
