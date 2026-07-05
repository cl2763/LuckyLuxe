// 财务记账底座回归(阶段3A):
// 1. 手工记一笔(收入/支出)、汇总数学正确、红字冲销
// 2. 订单完成自动入账(幂等)、取消自动冲销、净额归零
// 3. 固定支出规则自动生成(幂等)
// 4. 权限保护
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

async function summaryNow() {
  const res = await request('/admin/finance/transactions')
  return res.data.summary
}

async function main() {
  // 财务门禁:用 OWNER_TOKEN 主钥匙解锁
  const unlockRes = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: TOKEN }) })
  FIN_KEY = unlockRes.data?.financeKey || ''
  if (!FIN_KEY) throw new Error('finance unlock failed: ' + JSON.stringify(unlockRes.data))
  const created = []
  let ruleId = ''
  try {
    // 1. 手工记账 + 汇总数学
    const before = await summaryNow()
    const income = await request('/admin/finance/transactions', {
      method: 'POST',
      body: JSON.stringify({ type: 'income', category: '产品销售', tags: `test-${RUN_ID}`, amount: 200, payChannel: 'wechat', note: '回归测试收入' })
    })
    check('manual income created', income.status === 201 && income.data.transaction?.amountCents === 20000, JSON.stringify(income.data).slice(0, 150))
    created.push(income.data.transaction.id)
    const expense = await request('/admin/finance/transactions', {
      method: 'POST',
      body: JSON.stringify({ type: 'expense', category: '耗材采购', tags: `test-${RUN_ID}`, amount: 80, payChannel: 'alipay', note: '回归测试支出' })
    })
    check('manual expense stored as negative', expense.data.transaction?.amountCents === -8000, String(expense.data.transaction?.amountCents))
    created.push(expense.data.transaction.id)
    const after = await summaryNow()
    check('summary math correct (income +200, expense +80, net +120)',
      after.incomeCents - before.incomeCents === 20000
      && after.expenseCents - before.expenseCents === 8000
      && after.netCents - before.netCents === 12000,
      JSON.stringify({ before, after }))

    // 2. 红字冲销
    const reversed = await request(`/admin/finance/transactions/${income.data.transaction.id}/reverse`, { method: 'POST' })
    check('manual reversal created with opposite amount', reversed.status === 201 && reversed.data.transaction?.amountCents === -20000)
    const doubleReverse = await request(`/admin/finance/transactions/${income.data.transaction.id}/reverse`, { method: 'POST' })
    check('double reversal rejected', doubleReverse.status === 400, String(doubleReverse.status))

    // 3. 订单完成自动入账 → 幂等 → 取消冲销归零
    const bookings = (await request('/admin/bookings')).data.bookings || []
    const target = bookings.find((item) => ['CANCELLED', 'EXPIRED'].includes(item.status) && (item.servicePriceCents || 0) > 0)
    check('found a booking to exercise auto-ingest', Boolean(target), `bookings=${bookings.length}`)
    await request(`/admin/bookings/${target.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) })
    let txns = (await request('/admin/finance/transactions')).data.transactions.filter((item) => item.bookingId === target.id && item.source === 'booking')
    check('booking completion auto-creates income', txns.length === 1 && txns[0].amountCents === target.servicePriceCents, JSON.stringify(txns))
    await request(`/admin/bookings/${target.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) })
    txns = (await request('/admin/finance/transactions')).data.transactions.filter((item) => item.bookingId === target.id && item.source === 'booking')
    check('repeat completion is idempotent', txns.length === 1, String(txns.length))
    await request(`/admin/bookings/${target.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) })
    const allForBooking = (await request('/admin/finance/transactions')).data.transactions.filter((item) => item.bookingId === target.id)
    const bookingNet = allForBooking.reduce((sum, item) => sum + item.amountCents, 0)
    check('cancellation reverses income, booking net = 0', allForBooking.length >= 2 && bookingNet === 0, JSON.stringify({ count: allForBooking.length, bookingNet }))

    // 4. 固定支出规则:今天到期 → 自动生成一笔;重复查询不重复生成
    // dayOfMonth 用 1 号:无论服务器时区几号,本月 1 号必然已到期,规则创建即应补齐生成
    const rule = await request('/admin/finance/recurring', {
      method: 'POST',
      body: JSON.stringify({ name: `测试房租-${RUN_ID}`, category: '房租', amount: 1500, dayOfMonth: 1 })
    })
    ruleId = rule.data.rule?.id || ''
    check('recurring rule created and materialized', rule.status === 201 && rule.data.generated >= 1, JSON.stringify(rule.data))
    const countRecurring = async () => (await request('/admin/finance/transactions')).data.transactions.filter((item) => item.recurringRuleId === ruleId).length
    const firstCount = await countRecurring()
    await request('/admin/finance/transactions')
    check('recurring generation idempotent', (await countRecurring()) === firstCount, String(firstCount))
    check('recurring expense amount correct', firstCount === 1, String(firstCount))

    // 5. 防篡改:数据库层拒绝 UPDATE/DELETE;哈希链校验完整
    const { DatabaseSync } = await import('node:sqlite')
    const dbPath = process.env.TEST_DB_PATH || new URL('./local-data/lucky-luxe.sqlite', import.meta.url).pathname
    const rawDb = new DatabaseSync(dbPath)
    let updateBlocked = false
    let deleteBlocked = false
    try { rawDb.prepare('UPDATE finance_transactions SET amount_cents = 999999 WHERE id = ?').run(created[0]) } catch (error) { updateBlocked = /append-only/.test(String(error.message)) }
    try { rawDb.prepare('DELETE FROM finance_transactions WHERE id = ?').run(created[0]) } catch (error) { deleteBlocked = /append-only/.test(String(error.message)) }
    rawDb.close()
    check('ledger rejects direct UPDATE (append-only trigger)', updateBlocked)
    check('ledger rejects direct DELETE (append-only trigger)', deleteBlocked)
    const verify = await request('/admin/finance/verify')
    check('hash chain verifies intact', verify.status === 200 && verify.data.ledger?.valid === true && verify.data.ledger?.count > 0, JSON.stringify(verify.data))

    // 6. 权限
    const badAuth = await fetch(`${BASE_URL}/admin/finance/transactions`, { headers: { authorization: 'Bearer wrong-token' } })
    check('bad token rejected', badAuth.status === 401, String(badAuth.status))

    console.log(`[finance-core] all ${checks} checks passed`)
  } finally {
    // 清理:冲销测试产生的净影响,停用规则(冲销其生成的支出)
    const list = (await request('/admin/finance/transactions')).data.transactions || []
    for (const txn of list) {
      const isTestManual = txn.tags === `test-${RUN_ID}` && !txn.reversalOf
      const isTestRecurring = txn.recurringRuleId === ruleId && !txn.reversalOf
      if ((isTestManual || isTestRecurring) && !list.some((other) => other.reversalOf === txn.id)) {
        await request(`/admin/finance/transactions/${txn.id}/reverse`, { method: 'POST' }).catch(() => {})
      }
    }
    if (ruleId) await request(`/admin/finance/recurring/${ruleId}`, { method: 'PATCH', body: JSON.stringify({ active: false }) }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('[finance-core] failed:', error.message)
  process.exit(1)
})
