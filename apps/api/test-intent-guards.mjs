// 意图守卫回归:门店信息/政策/定金类问题不得被询单模板吞掉(2026-07-04 修复)
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'

let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function send(message) {
  const externalUserId = `guard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const response = await fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ externalUserId, message, customerType: 'new', memberTier: 'silver', lang: 'zh', forceAi: true })
  })
  const data = await response.json()
  return {
    intent: data.reply?.data?.intent || '',
    answer: data.reply?.data?.answerZh || '',
    source: data.reply?.source || ''
  }
}

const INTAKE = ['nail_intake_template', 'lash_intake_template']

async function main() {
  const hours = await send('请问你们门店的营业时间是什么时候？')
  check('hours question is not intake template', !INTAKE.includes(hours.intent), hours.intent)
  check('hours question answers business hours', /营业时间|\d{2}:\d{2}/.test(hours.answer), hours.answer.slice(0, 120))

  const address = await send('你们店地址在哪里？怎么走？')
  check('address question is not intake template', !INTAKE.includes(address.intent), address.intent)

  const deposit = await send('预约需要付定金吗？定金多少？')
  check('deposit question is not intake template', !INTAKE.includes(deposit.intent), deposit.intent)
  check('deposit question answers deposit policy', /定金/.test(deposit.answer), deposit.answer.slice(0, 120))

  const cancel = await send('如果我临时有事，可以取消或改时间吗？')
  check('cancellation question is not intake template', !INTAKE.includes(cancel.intent), cancel.intent)
  check('cancellation question mentions policy/handoff', /改期|取消|人工/.test(cancel.answer), cancel.answer.slice(0, 120))

  const mixed = await send('你们周日营业吗？我想周日来做美甲')
  check('mixed hours+service still enters intake flow', INTAKE.includes(mixed.intent), mixed.intent)

  const style = await send('我想做一个法式美甲，可以吗？')
  check('style request still enters intake flow', INTAKE.includes(style.intent), style.intent)

  console.log(`[intent-guards] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[intent-guards] failed:', error.message)
  process.exit(1)
})
