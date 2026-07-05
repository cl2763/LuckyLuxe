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

    // 2. 耗卡:余额下降 + 生成收入流水(支付方式=储值卡)
    const consumed = await request('/admin/stored-value/consume', {
      method: 'POST',
      body: JSON.stringify({ userId, amount: 168, note: `耗卡测试-${RUN_ID}` })
    })
    check('consume accepted, balance reduced', consumed.status === 201 && consumed.data.balanceCents === 50000 - 16800)
    const txns = (await request('/admin/finance/transactions')).data.transactions || []
    const consumeTxn = txns.find((item) => item.source === 'stored_value' && item.note?.includes(RUN_ID))
    check('consume recognized as income with stored_value channel', consumeTxn?.type === 'income' && consumeTxn?.payChannel === 'stored_value' && consumeTxn?.amountCents === 16800, JSON.stringify(consumeTxn))
    if (consumeTxn) consumeTxnIds.push(consumeTxn.id)

    // 3. 余额不足拒绝
    const overdraw = await request('/admin/stored-value/consume', {
      method: 'POST',
      body: JSON.stringify({ userId, amount: 9999 })
    })
    check('overdraw rejected', overdraw.status === 400, String(overdraw.status))

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
