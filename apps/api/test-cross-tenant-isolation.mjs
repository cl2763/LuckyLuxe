/* 🔴🔴 跨店隔离总验(店主 11i §一:「**一定要确保租户不要篡位,会员档案不要串味,这是最严重的**」)
 *
 * ══ 这一套和已有四套的分工(公约④ 先搜复用,查过才写)══
 *   `tenant-isolation`  两个实例 · 知识库与 AI 口径          `tenant-ownership`  订单写口/读口的闸
 *   `tenant-explicit`   静态扫:INSERT 有没有写 tenant_id     `identity-tenant`   身份行按店各归各
 *   **本套补的是它们都没有的那一半:同一个人在两家店,端到端走正门,验钱与档案。**
 *
 * ══ 模型(店主 11i §〇 拍板,三句话)══
 *   ① **人跟微信走** —— 同一个微信在几家店是同一个人,不许变成两个陌生人
 *   ② **档案跟店走** —— 两家店两份独立档案
 *   ③ 🔴 **钱跟店走** —— 储值/积分/券,**充在哪店只能在哪店花**
 *   ①与③听着矛盾,**但说的是两件事:身份是一个,账是分开的。**
 *
 * 🔴 **每一条拒,都先造一次阳性对照**(J-58①)——
 *    否则「拿不到」可能只是这条路本来就不通,而不是被挡住了。
 *
 * ⚠️ standalone:bash apps/api/run-all-tests.sh cross-tenant-isolation
 */
import { assertTestTarget } from './test-guard.mjs'
const { requireOwnerToken } = await import('./owner-token.mjs')
const { loginCustomerViaFrontDoor } = await import('./customer-login-fixture.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

/* ══ 夹具:两家店 ══ */
async function shop(tag) {
  const tid = `xt-${tag}-${RUN}`
  const made = await req('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `跨店验店${tag}${RUN}`, plan: 'solo' }) })
  if (made.status !== 201) throw new Error(`建店失败 ${JSON.stringify(made.data)}`)
  const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
  const tech = await req('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技师${tag}${RUN}`, isActive: true }) }, TOKEN, H)
  const catId = ((await req('/admin/pricing/categories', {}, TOKEN, H)).data.categories || [])[0]?.id
  const svc = await req('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `项目${tag}${RUN}`, nameEn: 'x', priceCents: 20000, baseDurationMin: 60, categoryId: catId }) }, TOKEN, H)
  return { tid, H, technicianId: tech.data.technician.id, serviceId: svc.data.service.id }
}
const A = await shop('a')
const B = await shop('b')
check('夹具:两家店建好', Boolean(A.tid && B.tid))

/* ══ 一、人跟微信走 · 档案跟店走 ══
   同一个 openid 在两家店各走一次正门 —— 应得到**两份独立档案**,而身份行认得出是同一个人。 */
const OPENID = `xt-same-person-${RUN}`
const inA = await loginCustomerViaFrontDoor({ base: BASE_URL, tenantId: A.tid, openid: OPENID })
const inB = await loginCustomerViaFrontDoor({ base: BASE_URL, tenantId: B.tid, openid: OPENID })
check('①a 同一个微信在 A 店登得进(阳性对照:这条路本身是通的)', inA.ok && Boolean(inA.user?.id), JSON.stringify(inA.body).slice(0, 120))
check('①b 同一个微信在 B 店也登得进', inB.ok && Boolean(inB.user?.id), JSON.stringify(inB.body).slice(0, 120))
check('①c 🔴 **档案跟店走**:两家店拿到的是**两个不同的 user_id**(串味的样子就是这里相同)',
  inA.user.id !== inB.user.id, `${inA.user.id} vs ${inB.user.id}`)
const custA = inA.accessToken
const custB = inB.accessToken
check('①d 两个顾客令牌都拿到了', Boolean(custA && custB))

/* ══ 二、钱跟店走 —— 储值 ══ */
await req('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: inA.user.id, amountCents: 100000, payChannel: 'cash', note: `跨店验${RUN}` }) }, TOKEN, A.H)
const svA = await req('/my/stored-value', {}, custA, { 'x-tenant-id': A.tid })
check('②a 🟢 **阳性对照**:A 店充了 1,000,A 店顾客端查得到',
  svA.status === 200 && svA.data.balanceCents === 100000, JSON.stringify(svA.data).slice(0, 140))
const svB = await req('/my/stored-value', {}, custB, { 'x-tenant-id': B.tid })
check('②b 🔴 **钱跟店走**:同一个人在 B 店余额 = 0(不是 1,000)',
  svB.status === 200 && (svB.data.balanceCents || 0) === 0, JSON.stringify(svB.data).slice(0, 140))
check('②c 🔴 **B 店不许扣 A 店的钱**:拿 B 店的档案去退 A 店那笔 → 拒',
  ![200, 201].includes((await req('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: inA.user.id, amountCents: 10000, reason: `跨店试探${RUN}` }) }, TOKEN, B.H)).status))
check('②c反 🟢 **阳性对照**:同一笔退在 A 店必须成(否则上面那个拒可能只是退卡本身不通)',
  [200, 201].includes((await req('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: inA.user.id, amountCents: 10000, reason: `本店退${RUN}` }) }, TOKEN, A.H)).status))

/* ══ 三、档案内容不串味:小记 / 画像 ══
   🔴 第一版我用了 `GET /admin/customers/:id` —— **全仓没有这条口**(只有列表、lookup、和 `/notes`)。
   阳性对照当场 404 把我拦住了:**先证明这条路本身通,再谈跨店拿不拿得到**(J-58①)。
   改用真实存在的 `/admin/customers/:id/notes`(小记),正是 11i §一 点名要验的那一项。 */
await req('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: inA.user.id, rawText: `A店专属小记${RUN}`, technicianId: A.technicianId }) }, TOKEN, A.H)
const seeA = await req(`/admin/customers/${inA.user.id}/notes`, {}, TOKEN, A.H)
check('③a 🟢 **阳性对照**:A 店读得到自己写的小记',
  seeA.status === 200 && JSON.stringify(seeA.data).includes(`A店专属小记${RUN}`), `${seeA.status} ${JSON.stringify(seeA.data).slice(0, 140)}`)
const seeB = await req(`/admin/customers/${inA.user.id}/notes`, {}, TOKEN, B.H)
check('③b 🔴 **B 店拿 A 店顾客 id 读小记 → 拿不到那条内容**(拒,或至少零下发)',
  [403, 404].includes(seeB.status) || !JSON.stringify(seeB.data).includes(`A店专属小记${RUN}`),
  `${seeB.status} ${JSON.stringify(seeB.data).slice(0, 140)}`)
const listB = await req('/admin/customers', {}, TOKEN, B.H)
check('③c 🔴 A 店那位顾客**不出现在 B 店的顾客列表里**',
  !JSON.stringify(listB.data).includes(inA.user.id), JSON.stringify(listB.data).slice(0, 160))
const listA = await req('/admin/customers', {}, TOKEN, A.H)
check('③c反 🟢 **阳性对照**:他出现在 **A 店**的列表里(否则 ③c 只是「列表本来就空」)',
  JSON.stringify(listA.data).includes(inA.user.id))

/* ══ 四、订单 / 签署文件 ══ */
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
const bkA = await req('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: inA.user.id, serviceId: A.serviceId, technicianId: A.technicianId, date: today, time: '10:00' }) }, TOKEN, A.H)
check('④a 🟢 **阳性对照**:A 店给自己的顾客建单成功', bkA.status === 201, JSON.stringify(bkA.data).slice(0, 140))
const bid = bkA.data.booking.id
check('④b 🔴 B 店拿 A 店的单 id 请求 → 拒',
  [403, 404].includes((await req(`/admin/bookings/${bid}`, {}, TOKEN, B.H)).status))
const docA = await req(`/admin/customers/${inA.user.id}/signed-docs`, { method: 'POST', body: JSON.stringify({ docType: 'rights', pages: [PNG] }) }, TOKEN, A.H)
check('④c 🟢 **阳性对照**:A 店给自己顾客建签署文件成功', docA.status === 201, JSON.stringify(docA.data).slice(0, 140))
check('④d 🔴 B 店拿那份签署文件的 id 请求 → 404',
  (await req(`/admin/signed-docs/${docA.data.doc.id}`, {}, TOKEN, B.H)).status === 404)
const myDocsB = await req('/my/signed-docs', {}, custB, { 'x-tenant-id': B.tid })
check('④e 🔴 同一个人在 B 店的顾客端,看不到他在 A 店签的文件',
  myDocsB.status === 200 && (myDocsB.data.docs || []).length === 0, JSON.stringify(myDocsB.data).slice(0, 140))
const myDocsA = await req('/my/signed-docs', {}, custA, { 'x-tenant-id': A.tid })
check('④e反 🟢 **阳性对照**:他在 A 店的顾客端看得到那一份(否则 ④e 的 0 只是「这口不通」)',
  myDocsA.status === 200 && (myDocsA.data.docs || []).length === 1, JSON.stringify(myDocsA.data).slice(0, 140))

/* ══ 五、🔴 拿 A 店的登录态去打 B 店的口 —— 一律拒 ══ */
for (const [p, label] of [['/my/stored-value', '储值'], ['/my/signed-docs', '签署文件'], ['/my/card-pack', '卡包']]) {
  const r = await req(p, {}, custA, { 'x-tenant-id': B.tid })
  check(`⑤ 🔴 A 店令牌打 B 店的 \`${p}\`(${label})→ 不许拿到 A 店的东西`,
    r.status !== 200 || !JSON.stringify(r.data).includes(inA.user.id),
    `${r.status} ${JSON.stringify(r.data).slice(0, 110)}`)
}
check('⑤反 🟢 **阳性对照**:同一个令牌打**自己店**的 `/my/stored-value` 必须 200',
  (await req('/my/stored-value', {}, custA, { 'x-tenant-id': A.tid })).status === 200)

/* 🔴 判据五(断言增量律·计数即证,店主 2026-09-01 立):
   「全过」只说明**没红**,不说明**跑过**。这一套里 ⑤ 组是一个 `check(` 在 `for` 里跑三遍,
   源码数调用点会比实跑条数少 2 —— 差额不钉死,哪天循环被改短、或某段被整块跳过,
   套件照样报「全过」,而少跑的那几条没人看得见。
   所以把实跑条数写死在这里,自己守自己。改了断言就改这个数,**并在回报里说清为什么变**。 */
const EXPECTED_CHECKS = 23
if (checks !== EXPECTED_CHECKS) {
  console.error(`not ok - 🔴 断言条数对不上:实跑 ${checks} 条,应为 ${EXPECTED_CHECKS} 条。` +
    `少了就是有断言被静默跳过(判据五);多了就是新加了断言没同步这个数。`)
  process.exit(1)
}
console.log(`\n✅ 跨店隔离总验 ${checks} 条全过(与声明的 ${EXPECTED_CHECKS} 条一致)`)
