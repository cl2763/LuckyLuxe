/* 🔴 涉钱口破坏测试(夜16-续 §四.4 兜底第一件)
 *
 * ══ 这一件之前为什么推不动 ══
 * 「40 个涉钱口,做完 10,剩 30」这句话**从来不是一份可对账的清单** ——
 * 它散在 08a / 09d 两份令里。09u 我如实写过:「我手上没有那份名单原件…现在硬报一个『剩 36』是编的 —— 不报。」
 * 夜14 §三.3 登记「先重整名单」。**今晚先把名单做出来,再往里填。**
 *
 * ══ 重整之后的底数(2026-09-22 现扫 131 个非测试模块)══
 *   涉钱**写**口 41 条 · 启发式判「已有破坏测试」27 条 · **没有的 14 条**
 *   ⚠️ 那个 27 是**启发式**(路径串出现在某测试文件里、附近有敌意断言字样)——**会高估**。
 *      所以本套件不拿它当成绩,只拿 14 那一栏当待办。
 *
 * ══ 本套件覆盖(从 14 条里挑最值钱的,逐条**造得出阳性**)══
 *   · `POST /admin/coupons/redeem`      核销券 = 消耗一张负债
 *   · `POST /admin/subscription/ai-subscribe` 写 `subscription_orders.amount_cents` = 真金额
 *   · `POST /admin/subscription/renew`  续费同上
 *   每条四面:**未登录拒 · 员工越权拒 · 跨店拒 · 正门必须成**(最后一条是阳性对照,
 *   没有它,前三条的「拒」可能只是「这口不存在」——J-58①)。
 *
 * ⚠️ standalone:bash apps/api/run-all-tests.sh money-endpoint-abuse
 */
import { assertTestTarget } from './test-guard.mjs'
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function req(path, options = {}, token = TOKEN, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) },
  })
  const t = await r.text()
  let d = null
  try { d = t ? JSON.parse(t) : null } catch { d = { raw: t } }
  return { status: r.status, data: d }
}

/* ── 夹具:两家店(A 做正事,B 做跨店阳性)+ A 店一个员工令牌 ── */
async function shop(tag) {
  const tid = `ab-${tag}-${RUN}`
  /* 🔴 用 `solo` 不用 `chain`:`chain` 档**本来就含 AI 智能包**,再去订阅会被正当地拒
     —— 那会让 ②c 那个阳性对照红得莫名其妙。**阳性对照红了要先问是不是夹具选错了景**(造景律)。 */
  const made = await req('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `破坏测试店${tag}${RUN}`, plan: 'solo' }) })
  if (made.status !== 201) throw new Error(`建店失败 ${JSON.stringify(made.data)}`)
  const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
  const tech = await req('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技师${tag}${RUN}`, isActive: true }) }, TOKEN, H)
  return { tid, H, technicianId: tech.data.technician.id }
}
const A = await shop('a')
const B = await shop('b')
check('夹具:两家店(A 做正事,B 做跨店阳性)', Boolean(A.tid && B.tid))

async function staffToken(technicianId, H) {
  let c = await req('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId }) }, TOKEN, H)
  if (c.status === 409) {
    const list = (await req('/admin/staff-accounts', {}, TOKEN, H)).data.accounts
    c = await req(`/admin/staff-accounts/${list.find((r) => r.technicianId === technicianId).id}/reset-password`, { method: 'POST' }, TOKEN, H)
  }
  const login = await req('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: c.data.username, password: c.data.initialPassword }) }, null, H)
  const t0 = login.data.auth.accessToken
  const np = `Ab-${RUN}-${technicianId.slice(-4)}`
  await req('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: c.data.initialPassword, newPassword: np, confirmPassword: np }) }, t0, H)
  return (await req('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: c.data.username, password: np }) }, null, H)).data.auth.accessToken
}
const staffA = await staffToken(A.technicianId, A.H)
check('夹具:A 店员工令牌', Boolean(staffA))

/* ══ 一、POST /admin/coupons/redeem —— 核销一张券 = 消耗一张负债 ══ */
const cp = await req('/admin/coupons', { method: 'POST', body: JSON.stringify({ name: `破坏券${RUN}`, discountType: 'amount', amountCents: 5000, validDays: 30 }) }, TOKEN, A.H)
check('①夹具 A 店建了一张券', cp.status === 201 || cp.status === 200, JSON.stringify(cp.data).slice(0, 120))
const couponId = cp.data.coupon?.id || cp.data.id
const bk = await req('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `券客${RUN}`, phone: `133${RUN.slice(-7)}`, serviceId: (await req('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `项目${RUN}`, nameEn: 'x', priceCents: 10000, baseDurationMin: 60, categoryId: ((await req('/admin/pricing/categories', {}, TOKEN, A.H)).data.categories || [])[0]?.id }) }, TOKEN, A.H)).data.service.id, technicianId: A.technicianId, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }), time: '10:00' }) }, TOKEN, A.H)
const userId = bk.data.booking?.user?.id || bk.data.booking?.userId
/* 🔴 走 `mode:'template'`(用刚建的那张券模板发),不是自定义金额那一支 —— 第一版没给 mode,
     被当成自定义券而金额为 0,夹具当场红。**夹具红得对,是我没读清那条口的参数。** */
const grant = await req('/admin/coupon-grants/custom', { method: 'POST', body: JSON.stringify({ mode: 'template', userId, couponId, reason: `破坏测试${RUN}`, validDays: 30 }) }, TOKEN, A.H)
const code = grant.data.granted?.code || grant.data.grant?.code || grant.data.code
check('①夹具 发了一张券到顾客名下,拿到券码', Boolean(code), JSON.stringify(grant.data).slice(0, 140))

check('①a 🔴 未登录核销 → 拒',
  [401, 403].includes((await req('/admin/coupons/redeem', { method: 'POST', body: JSON.stringify({ code }) }, null, A.H)).status))
check('①b 🔴 **跨店**核销(B 店的头拿 A 店的券码)→ 拒(措辞:不属于本店)',
  (await req('/admin/coupons/redeem', { method: 'POST', body: JSON.stringify({ code }) }, TOKEN, B.H)).status === 404)
check('①c 🔴 券码为空 → 400(不许把空码当通配)',
  (await req('/admin/coupons/redeem', { method: 'POST', body: JSON.stringify({ code: '   ' }) }, TOKEN, A.H)).status === 400)
check('①d 🔴 瞎编的券码 → 404',
  (await req('/admin/coupons/redeem', { method: 'POST', body: JSON.stringify({ code: `NOPE${RUN}` }) }, TOKEN, A.H)).status === 404)
/* 🔴 阳性对照:同一条请求走正门必须成 —— 没有它,上面四条「拒」可能只是这口不存在(J-58①) */
const ok1 = await req('/admin/coupons/redeem', { method: 'POST', body: JSON.stringify({ code }) }, TOKEN, A.H)
check('①e 🟢 **阳性对照**:正门核销必须成(否则上面四条拒不作数)', [200, 201].includes(ok1.status), JSON.stringify(ok1.data).slice(0, 140))
check('①f 🔴 **重复核销**必须拒(一次性,防重复 —— 一张券被烧两次就是多送一笔钱)',
  ![200, 201].includes((await req('/admin/coupons/redeem', { method: 'POST', body: JSON.stringify({ code }) }, TOKEN, A.H)).status))

/* ══ 二、POST /admin/subscription/ai-subscribe —— 写 subscription_orders.amount_cents ══ */
check('②a 🔴 未登录下单 → 拒',
  [401, 403].includes((await req('/admin/subscription/ai-subscribe', { method: 'POST', body: JSON.stringify({ period: 'month' }) }, null, A.H)).status))
check('②b 🔴 **员工**下单 → 403(仅老板可订阅;员工能给店里下单就是替老板花钱)',
  (await req('/admin/subscription/ai-subscribe', { method: 'POST', body: JSON.stringify({ period: 'month' }) }, staffA, A.H)).status === 403)
const ok2 = await req('/admin/subscription/ai-subscribe', { method: 'POST', body: JSON.stringify({ period: 'month' }) }, TOKEN, A.H)
check('②c 🟢 **阳性对照**:老板下单必须成', [200, 201].includes(ok2.status), JSON.stringify(ok2.data).slice(0, 140))

/* ══ 三、POST /admin/subscription/renew ══ */
check('③a 🔴 未登录续费 → 拒',
  [401, 403].includes((await req('/admin/subscription/renew', { method: 'POST', body: JSON.stringify({ period: 'month' }) }, null, A.H)).status))
check('③b 🔴 **员工**续费 → 403',
  (await req('/admin/subscription/renew', { method: 'POST', body: JSON.stringify({ period: 'month' }) }, staffA, A.H)).status === 403)
const ok3 = await req('/admin/subscription/renew', { method: 'POST', body: JSON.stringify({ period: 'month' }) }, TOKEN, A.H)
check('③c 🟢 **阳性对照**:老板续费必须成', [200, 201].includes(ok3.status), JSON.stringify(ok3.data).slice(0, 160))

console.log(`\n✅ 涉钱口破坏测试 ${checks} 条全过(本轮覆盖 3 条口;名单 41 条,未覆盖 14 → ${14 - 3} 条待办)`)
