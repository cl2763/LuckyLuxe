// 目标进度与工资月结回归(阶段3C):
// 1. 目标设置 + 反推公式数学(需月营收/收支平衡/日目标按营业日)
// 2. 薪酬配置 → 月结草稿(底薪+提成=业绩×比例) → 确认入账(幂等) → 预估口径合一
// 3. 套餐闸门:关闭员工功能后 payroll 接口被拦
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'

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
  const cleanupPayrollIds = []
  try {
    // 1. 设置目标:净利模式 月目标$3000 变动成本率25%
    const saved = await request('/admin/finance/targets', {
      method: 'PUT',
      body: JSON.stringify({ targetMode: 'net_profit', monthTarget: 3000, variableCostRate: 0.25, yearTarget: 40000 })
    })
    check('targets saved', saved.status === 200 && saved.data.targets?.monthTargetCents === 300000)

    const progressRes = await request('/admin/finance/progress')
    const p = progressRes.data.progress
    check('progress endpoint 200', progressRes.status === 200 && Boolean(p))
    const expectedRequired = Math.round((p.fixedCents + 300000) / 0.75)
    check('required monthly revenue formula correct', p.monthRevenueTargetCents === expectedRequired, `${p.monthRevenueTargetCents} vs ${expectedRequired} (fixed=${p.fixedCents})`)
    const expectedBreakEven = Math.round(p.fixedCents / 0.75)
    check('break-even formula correct', p.breakEvenRevenueCents === expectedBreakEven, `${p.breakEvenRevenueCents} vs ${expectedBreakEven}`)
    check('daily target spread over business days', p.dailyTargetCents === Math.round(p.monthRevenueTargetCents / p.businessDays.total), JSON.stringify(p.businessDays))
    check('business days exclude closed weekdays', p.businessDays.total >= 20 && p.businessDays.total <= 28, String(p.businessDays.total))
    check('year target respected', p.yearTargetCents === 4000000, String(p.yearTargetCents))
    check('estimated net = net - pending payroll', p.estimatedNetCents === p.netCents - p.pendingPayrollCents)

    // 2. 薪酬配置 + 月结
    const comp = await request('/admin/finance/compensation', {
      method: 'PUT',
      body: JSON.stringify({ technicianId: 'tech-mia', baseSalary: 2000, commissionRate: 0.1, active: true })
    })
    check('compensation saved', comp.status === 200 && comp.data.compensation.some((item) => item.technicianId === 'tech-mia' && item.baseSalaryCents === 200000))

    let payroll = await request('/admin/finance/payroll')
    let draft = (payroll.data.drafts || []).find((item) => item.technicianId === 'tech-mia')
    check('payroll draft generated', Boolean(draft), JSON.stringify(payroll.data))
    // 自愈:如果本月已被(真实使用中)结算过,先冲销复位再测结算流程
    if (draft.settled) {
      const priorTxns = (await request('/admin/finance/transactions')).data.transactions || []
      for (const txn of priorTxns.filter((item) => item.tags === draft.marker && !item.reversalOf && !priorTxns.some((other) => other.reversalOf === item.id))) {
        await request(`/admin/finance/transactions/${txn.id}/reverse`, { method: 'POST' })
      }
      payroll = await request('/admin/finance/payroll')
      draft = (payroll.data.drafts || []).find((item) => item.technicianId === 'tech-mia')
      check('pre-settled month reset via reversal', draft?.settled === false)
    }
    check('draft math: total = base + revenue x rate', draft.totalCents === draft.baseSalaryCents + Math.round(draft.monthRevenueCents * draft.commissionRate), JSON.stringify(draft))

    const confirm = await request('/admin/finance/payroll/confirm', { method: 'POST', body: JSON.stringify({}) })
    check('payroll confirmed into ledger', confirm.status === 201 && confirm.data.settled >= 1, JSON.stringify(confirm.data).slice(0, 120))
    const confirmedDraft = (confirm.data.drafts || []).find((item) => item.technicianId === 'tech-mia')
    check('draft marked settled after confirm', confirmedDraft?.settled === true)
    const confirmAgain = await request('/admin/finance/payroll/confirm', { method: 'POST', body: JSON.stringify({}) })
    check('confirm is idempotent', confirmAgain.data.settled === 0, String(confirmAgain.data.settled))

    const txns = (await request('/admin/finance/transactions')).data.transactions || []
    const payrollTxns = txns.filter((item) => item.source === 'payroll' && item.tags?.includes('tech-mia')
      && !item.reversalOf && !txns.some((other) => other.reversalOf === item.id))
    check('payroll expense recorded with 员工工资 category', payrollTxns.length === 1 && payrollTxns[0].category === '员工工资', JSON.stringify(payrollTxns))
    cleanupPayrollIds.push(...payrollTxns.map((item) => item.id))

    const progressAfter = (await request('/admin/finance/progress')).data.progress
    check('after settlement estimated net equals actual net', progressAfter.estimatedNetCents === progressAfter.netCents)

    // 3. 套餐闸门:关闭员工功能 → payroll 被拦;恢复
    await request('/admin/tenant/entitlements', { method: 'PUT', body: JSON.stringify({ feature: 'staff_schedule', enabled: false }) })
    const gated = await request('/admin/finance/payroll')
    check('payroll gated without staff plan feature', gated.status === 403, String(gated.status))
    await request('/admin/tenant/entitlements', { method: 'PUT', body: JSON.stringify({ feature: 'staff_schedule', remove: true }) })
    const restored = await request('/admin/finance/payroll')
    check('payroll restored with plan default', restored.status === 200)

    console.log(`[finance-goals] all ${checks} checks passed`)
  } finally {
    for (const id of cleanupPayrollIds) {
      await request(`/admin/finance/transactions/${id}/reverse`, { method: 'POST' }).catch(() => {})
    }
    await request('/admin/finance/compensation', { method: 'PUT', body: JSON.stringify({ technicianId: 'tech-mia', baseSalary: 0, commissionRate: 0, active: false }) }).catch(() => {})
    await request('/admin/tenant/entitlements', { method: 'PUT', body: JSON.stringify({ feature: 'staff_schedule', remove: true }) }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('[finance-goals] failed:', error.message)
  process.exit(1)
})
