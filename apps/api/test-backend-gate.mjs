/* 前端独有校验审计 · A 级(店主 2026-08-28 排;《后端是最终闸律》的收口套件)。

   立这套件的原因:**前端拦得住不算证据。** 网页/小程序拦了、后端没拦的那些字段,
   任何人带着合法凭证绕开界面直接打接口就能写进去 —— 这是「收了一半」族的第四案
   (D75 商家收口顾客漏 · 登录旁路 08-07 商家侧收了顾客侧漏 · 读写两道闸 · 更正原因)。

   被测集合**不是我列出来的**:先机械扫两端 158 个写口调用点,挑出前端有拦的 54 处,
   再按「绕过前端会不会造成账错或越权」分 A/B 级 —— A 级逐条落在这里,B 级登记不修。
   分级依据与完整清单在 handoff/判据欠账_三件_2026-08-28.md。

   判据只有一种算数:**带合法凭证、绕开前端直接打接口 → 后端必须拒(4xx)。**
   每条再配一个**反向守**:同一个口给合法参数必须成功 —— 否则"全拒"也能让这套件绿。

   ⚠️ standalone:CI_SUITES="backend-gate" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const { bindWechatViaFrontDoor } = await import('./customer-login-fixture.mjs')   // J-60 共用出口
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}

const tid = `bg-${RUN}`
const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `闸门店${RUN}`, plan: 'chain' }) })
if (made.status !== 201) throw new Error(`建店失败 ${JSON.stringify(made.data)}`)
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const technicianId = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技师${RUN}`, isActive: true }) }, PLATFORM, H)).data.technician.id
const catId = ((await request('/admin/pricing/categories', {}, PLATFORM, H)).data.categories || [])[0]?.id
const serviceId = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `闸门项目${RUN}`, nameEn: 'x', priceCents: 19800, baseDurationMin: 60, categoryId: catId }) }, PLATFORM, H)).data.service.id
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
const bk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `闸门客${RUN}`, phone: `1393${String(parseInt(RUN,36)).slice(-7)}`, serviceId, technicianId, date: today, time: '10:00' }) }, PLATFORM, H)
const userId = bk.data?.booking?.user?.id || ''
/* D25 闸:未绑定微信的轻档案不可充值。原来这里**直连库贴**一个 openid ——
   J-60(07m §七)转正门:拿同一个手机号走 `/auth/wechat/mini-login`,
   让**严格认人四条**自己把这条轻档案认领走并绑上(真顾客就是这么绑的)。 */
await bindWechatViaFrontDoor({ base: BASE_URL, tenantId: tid, userId, phone: `1393${String(parseInt(RUN,36)).slice(-7)}`, tag: `bg-${RUN}` })
check('前置:店/技师/项目/顾客都建好了(顾客已绑定,充值闸不挡反向守)', Boolean(technicianId && serviceId && userId))

/* 一条 A 级 = 一次「绕过前端」+ 一次「合法参数」。
   `bad` 必须 4xx;`good` 必须 2xx —— 后者是反向守,防止"这个口本来就全拒"。 */
async function gate(label, bad, good) {
  const b = await request(bad.path, { method: bad.method || 'POST', body: JSON.stringify(bad.body) }, PLATFORM, H)
  check(`${label} 🔴 绕过前端直接打接口 → 后端拒(${b.status})`,
    b.status >= 400 && b.status < 500, `${b.status} ${JSON.stringify(b.data).slice(0, 140)}`)
  if (!good) return
  const g = await request(good.path, { method: good.method || 'POST', body: JSON.stringify(good.body) }, PLATFORM, H)
  check(`${label} 反向守:同一个口给合法参数 → 成功(${g.status})`,
    g.status >= 200 && g.status < 300, `${g.status} ${JSON.stringify(g.data).slice(0, 140)}`)
}

// A1 充值金额(前端拦「请选择会员并填写金额(或选套餐)」)
await gate('A1 充值金额 ≤ 0',
  { path: '/admin/stored-value/recharge', body: { userId, amountCents: 0, payChannel: 'cash' } },
  { path: '/admin/stored-value/recharge', body: { userId, amountCents: 10000, payChannel: 'cash' } })
await gate('A1b 充值金额为负',
  { path: '/admin/stored-value/recharge', body: { userId, amountCents: -50000, payChannel: 'cash' } })

// A2 记一笔金额(前端拦「请填写正确的金额」)
await gate('A2 记一笔金额 ≤ 0',
  { path: '/admin/finance/transactions', body: { type: 'expense', category: '耗材', amountCents: 0, occurredOn: today } },
  { path: '/admin/finance/transactions', body: { type: 'expense', category: '耗材', amountCents: 5000, occurredOn: today } })

// A3 券面额(前端拦「请输入面额 / 填一下减免金额」)
await gate('A3 券面额 ≤ 0',
  { path: '/admin/coupons', body: { name: `闸门券${RUN}`, kind: 'amount', amountCents: 0 } },
  { path: '/admin/coupons', body: { name: `闸门券良${RUN}`, kind: 'amount', amountCents: 3000 } })

// A4 套餐售价/次数(前端拦「请输入售价 / 请输入次数」)
await gate('A4 套餐售价 ≤ 0',
  { path: '/admin/packages', body: { name: `闸门套餐${RUN}`, kind: 'stored', priceCents: 0 } },
  { path: '/admin/packages', body: { name: `闸门套餐良${RUN}`, kind: 'stored', priceCents: 100000 } })

// A5 服务价格(前端拦「请输入有效价格」)
await gate('A5 服务价格为负',
  { path: '/admin/services', body: { type: 'NAIL', nameZh: `闸门负价${RUN}`, nameEn: 'x', priceCents: -1000, baseDurationMin: 60, categoryId: catId } })

// A6 员工账号用户名(前端拦「用户名只能用英数,3–20 位」)
await gate('A6 员工用户名非法(超长/含非法字符)',
  { path: '/admin/staff-accounts', body: { technicianId, username: 'a'.repeat(80) + '<script>' } })

// A7 财务密码强度(前端拦「财务密码至少 4 位 / 两次密码不一致」)
await gate('A7 财务密码太短',
  { path: '/admin/finance/lock-settings', method: 'PUT', body: { enabled: true, password: '1', confirmPassword: '1' } })
await gate('A7b 两次密码不一致',
  { path: '/admin/finance/lock-settings', method: 'PUT', body: { enabled: true, password: 'abcd1234', confirmPassword: 'zzzz9999' } })

// A8 券发放原因(前端拦「发放原因必填」)—— 发券=送钱,没原因等于送了查不到
await gate('A8 自定义发券没写原因',
  { path: '/admin/coupon-grants/custom', body: { userId, amountCents: 5000, reason: '   ' } })

console.log(`\n后端最终闸(A 级)回归通过:${checks} 项断言全绿`)
