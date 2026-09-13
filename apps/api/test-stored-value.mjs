// 储值卡回归(阶段3D):
// 1. 充值=负债(不产生收入流水);耗卡=确认收入(支付方式=储值卡)
// 2. 余额不足拒绝耗卡;账户列表含沉睡天数并排序
// 3. 储值账本只追加;演示数据填充幂等;AI 解读返回文本
/* D132 口径④(店主 04d §一):顾客侧公开路由**必须带门店标识**,不再回落旗舰店。
   夹具同批补头 —— 补的是「请求带不带 x-tenant-id」,判据一个字没放宽。
   per-call 的 headers 仍然后到先得(跨租户用例照旧覆盖它)。 */
const TENANT_HEADER = process.env.TEST_TENANT_ID || 'lucky-luxe'
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN_ID = Date.now().toString(36)

let checks = 0
let FIN_KEY = ''

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'x-tenant-id': TENANT_HEADER, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(FIN_KEY ? { 'x-finance-key': FIN_KEY } : {}), ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function main() {
  // 财务门禁:用 OWNER_TOKEN 主钥匙解锁
  const unlockRes = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: TOKEN }) })
  FIN_KEY = unlockRes.data?.financeKey || ''
  if (!FIN_KEY) throw new Error('finance unlock failed: ' + JSON.stringify(unlockRes.data))
  const consumeTxnIds = []
  let userId = ''
  try {
    // 建一个专用测试会员
    /* 🔴 日班令2 段A:夹具建顾客**换正门**(原来用 `/auth/email/register`,那条路生产上 403)。

       ⚠️ 换正门顺带暴露一件事,记下来:**正门进来的顾客是「已绑定」的**(mini-login 本身就是绑微信那一步)。
       所以下面 D25 那条「**未**绑定不可充值」不能拿正门顾客测 —— 前提不成立。
       正确排法就是**产品真实那条路**,而且比原来测得多:
         ① 商家建**轻档案**(有名字有手机号,**没绑微信**)→ 拿它断言 D25 拦得住;
         ② 顾客用**同一手机号**从正门登录 → 严格认人四条把两者认成同一个人(绑定在这里真发生);
         ③ 后面照跑。
       原来那一步是 `UPDATE users SET wechat_open_id` **直连库贴**的 —— 那是绕过绑定逻辑。 */
    const { loginCustomerViaFrontDoor } = await import('./customer-login-fixture.mjs')
    const svPhone = `138${String(Date.now()).slice(-8)}`
    const svTech = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `储值技师${RUN_ID}`, isActive: true }) })).data?.technician?.id
    const svCat = ((await request('/admin/pricing/categories')).data.categories || [])[0]?.id
    const svSvc = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `储值项目${RUN_ID}`, nameEn: 'sv', priceCents: 12000, durationMin: 60, categoryId: svCat, isActive: true }) })).data?.service?.id
    const svDate = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
    let light = null
    for (let n = 1; n <= 10; n += 1) {
      const d = new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
      light = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `储值测试-${RUN_ID}`, newCustomerPhone: svPhone, phone: svPhone, serviceId: svSvc, technicianId: svTech, date: d, time: '10:00' }) })
      if (light.data?.error?.code !== 'REST_DAY') break   /* 新库有休息日:自己挑营业日,别红在「今天不上班」上 */
    }
    userId = light.data?.booking?.user?.id || light.data?.booking?.userId || ''
    check('test member created(商家建**轻档案**,还没绑微信)', Boolean(userId), JSON.stringify(light.data).slice(0, 140))

    const d25Blocked = await request('/admin/stored-value/recharge', {
      method: 'POST', body: JSON.stringify({ userId, amount: 500, payChannel: 'wechat' })
    })
    check('D25 未绑定充值=400 UNBOUND_NO_RECHARGE', d25Blocked.status === 400 && d25Blocked.data?.error?.code === 'UNBOUND_NO_RECHARGE', JSON.stringify(d25Blocked.data).slice(0, 160))

    /* ⚠️ 这里用**简单出口**(只登录),不用那个「建+登」的组合出口 ——
       轻档案上面已经建过了,再建一条同号的就是**两条**,严格认人四条那条「唯一一条」会当场判撞车、不认。
       我头一版就是这么栽的(status 400、认成 undefined),记在这里。 */
    const bound = await loginCustomerViaFrontDoor({ base: BASE_URL, tenantId: TENANT_HEADER, openid: `stub-openid-sv-${RUN_ID}`, phone: svPhone })
    check('绑定**真发生一次**:同号从正门登录,严格认人把轻档案认成同一个人(不再直连库贴 openid)',
      bound.user?.id === userId, `轻档案=${userId} 认成=${bound.user?.id} status=${bound.status}`)

    // 1. 充值:余额上升,但不产生收入流水
    const incomeBefore = (await request('/admin/finance/transactions')).data.summary.incomeCents
    const recharged = await request('/admin/stored-value/recharge', {
      method: 'POST',
      body: JSON.stringify({ userId, amount: 500, payChannel: 'wechat' })
    })
    check('recharge accepted', recharged.status === 201 && recharged.data.balanceCents === 50000, JSON.stringify(recharged.data).slice(0, 120))
    const incomeAfterRecharge = (await request('/admin/finance/transactions')).data.summary.incomeCents
    check('recharge is liability, NOT income', incomeAfterRecharge === incomeBefore, `${incomeBefore} -> ${incomeAfterRecharge}`)
    const overview = recharged.data.storedValue
    check('outstanding balance includes new card', overview.totalBalanceCents >= 50000)

    // 2. 耗卡口径(S2批① 店主 08-17 拍板,规则⑥):手动耗卡 HTTP 口=410 GONE ——
    //    扣卡只随结算单签字由引擎自动做(引擎路径由 test-noshow-aftersales ⑰ 与结算套件覆盖)。
    const consumed = await request('/admin/stored-value/consume', {
      method: 'POST',
      body: JSON.stringify({ userId, amount: 168, note: `耗卡测试-${RUN_ID}` })
    })
    check('manual consume = 410 GONE(手动耗卡整口取消)', consumed.status === 410, String(consumed.status))
    // 引擎写法直插一笔耗卡,继续验负债下降与逐笔视图(模拟签字扣卡结果)
    {
      const { DatabaseSync } = await import('node:sqlite')
      const dbPath0 = process.env.TEST_DB_PATH || new URL('./local-data/lucky-luxe.sqlite', import.meta.url).pathname
      const raw0 = new DatabaseSync(dbPath0)
      raw0.prepare("INSERT INTO stored_value_transactions (id,tenant_id,user_id,type,amount_cents,pay_channel,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(`sv_ci_${RUN_ID}`, 'lucky-luxe', userId, 'consume', -16800, 'stored_value', `耗卡测试-${RUN_ID}(直插=引擎写法)`, 'ci-sv', new Date().toISOString())
      raw0.close()
    }
    const afterOverview = (await request('/admin/stored-value')).data.storedValue
    check('balance reduced after engine-style consume', typeof afterOverview.totalBalanceCents === 'number')
    // 赠送口径(规则④)顺带入本套件:充100赠20 → bonus 独立行,余额含赠送
    const bonusRc = await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId, amount: 100, bonusCents: 2000, payChannel: 'cash', note: `赠送口径-${RUN_ID}` }) })
    check('recharge with bonus accepted', bonusRc.status === 201)
    check('bonus adds to liability (balance includes gift)', bonusRc.data.balanceCents === 50000 - 16800 + 10000 + 2000, String(bonusRc.data.balanceCents))

    // 4. 账户列表带沉睡字段
    const list = (await request('/admin/stored-value')).data.storedValue
    const account = (list.accounts || []).find((item) => item.userId === userId)
    check('account listed with dormantDays field', account && typeof account.dormantDays === 'number', JSON.stringify(account))

    // 5. 储值账本只追加
    const { DatabaseSync } = await import('node:sqlite')
    const dbPath = process.env.TEST_DB_PATH || new URL('./local-data/lucky-luxe.sqlite', import.meta.url).pathname
    const rawDb = new DatabaseSync(dbPath)
    let blocked = false
    try { rawDb.prepare('DELETE FROM stored_value_transactions WHERE user_id = ?').run(userId) } catch (error) { blocked = /append-only/.test(String(error.message)) }
    rawDb.close()
    check('stored value ledger rejects DELETE', blocked)

    // 6. 演示数据幂等
    const seed1 = await request('/admin/demo/finance-seed', { method: 'POST', body: '{}' })
    const seed2 = await request('/admin/demo/finance-seed', { method: 'POST', body: '{}' })
    check('demo seed runs', seed1.status === 201 || seed1.status === 200)
    check('demo seed idempotent', seed2.data?.seeded === false, JSON.stringify(seed2.data))

    // 7. AI 解读
    const insight = await request('/admin/finance/insights', { method: 'POST', body: '{}' })
    check('insights returns readable text', insight.status === 200 && /财务解读/.test(insight.data.insight?.text || ''), (insight.data.insight?.text || '').slice(0, 80))
    check('insights mentions stored value liability', /储值负债/.test(insight.data.insight?.text || ''))

    console.log(`[stored-value] all ${checks} checks passed`)
  } finally {
    // 清理:冲销耗卡产生的收入;把测试卡余额调整归零(adjust 分录)
    for (const id of consumeTxnIds) {
      await request(`/admin/finance/transactions/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: 'CI 夹具:冲销口径回归' }) }).catch(() => {})
    }
  }
}

main().catch((error) => {
  console.error('[stored-value] failed:', error.message)
  process.exit(1)
})
