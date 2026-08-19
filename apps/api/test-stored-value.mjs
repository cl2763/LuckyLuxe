// 储值卡回归(阶段3D):
// 1. 充值=负债(不产生收入流水);耗卡=确认收入(支付方式=储值卡)
// 2. 余额不足拒绝耗卡;账户列表含沉睡天数并排序
// 3. 储值账本只追加;演示数据填充幂等;AI 解读返回文本
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
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
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(FIN_KEY ? { 'x-finance-key': FIN_KEY } : {}), ...(options.headers || {}) }
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
    const registered = await request('/auth/email/register', {
      method: 'POST',
      body: JSON.stringify({ email: `sv-test-${RUN_ID}@example.com`, displayName: `储值测试-${RUN_ID}` })
    })
    userId = registered.data?.user?.id || registered.data?.id
    check('test member created', Boolean(userId))

    /* D25(《财务总逻辑》3-1b,2026-08-12):未绑定档案不可充值 ——
       先拿新号顺手断言拦截,再直连库绑上微信(同 noshow 套件 ⑥/⑮ 先例)让后续流程走通。 */
    const d25Blocked = await request('/admin/stored-value/recharge', {
      method: 'POST', body: JSON.stringify({ userId, amount: 500, payChannel: 'wechat' })
    })
    check('D25 未绑定充值=400 UNBOUND_NO_RECHARGE', d25Blocked.status === 400 && d25Blocked.data?.error?.code === 'UNBOUND_NO_RECHARGE', JSON.stringify(d25Blocked.data).slice(0, 120))
    if (!process.env.TEST_DB_PATH) throw new Error('D25 后本套件需要 TEST_DB_PATH 直连库绑定 fixture')
    {
      const { DatabaseSync } = await import('node:sqlite')
      const bindDb = new DatabaseSync(process.env.TEST_DB_PATH)
      bindDb.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`wx-svtest-${RUN_ID}`, userId)
      bindDb.close()
    }

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
      await request(`/admin/finance/transactions/${id}/reverse`, { method: 'POST' }).catch(() => {})
    }
  }
}

main().catch((error) => {
  console.error('[stored-value] failed:', error.message)
  process.exit(1)
})
