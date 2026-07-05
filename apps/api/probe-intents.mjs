// 探针:各种常见新客首条消息,看AI实际走了哪条路(不是回归测试,仅诊断用)
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'

const probes = [
  ['营业时间', '请问你们门店的营业时间是什么时候？'],
  ['地址', '你们店的地址在哪里？怎么走？'],
  ['电话', '有没有电话可以联系你们？'],
  ['停车', '你们店附近好停车吗？'],
  ['定金', '预约需要付定金吗？定金多少？'],
  ['支付方式', '你们支持什么付款方式？可以刷卡吗？'],
  ['取消政策', '如果我临时有事，可以取消或改时间吗？'],
  ['会员', '你们有会员制度吗？怎么成为会员？'],
  ['营业+服务混合', '你们周日营业吗？我想周日来做美甲'],
  ['价格(应进询单)', '做一次美甲大概多少钱？'],
  ['款式(应进询单)', '我想做一个法式美甲，可以吗？'],
  ['英文营业时间', 'What are your business hours?'],
  ['闲聊', '你们家小猫真可爱哈哈'],
  ['无关问题', '今天天气怎么样？']
]

async function send(externalUserId, message) {
  const response = await fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ externalUserId, message, customerType: 'new', memberTier: 'silver', lang: 'zh', forceAi: true })
  })
  return response.json()
}

for (const [label, message] of probes) {
  const id = `probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  try {
    const result = await send(id, message)
    const reply = result.reply || {}
    const intent = reply.data?.intent || '-'
    const source = reply.source || '-'
    const answer = (reply.data?.answerZh || '').replace(/\n/g, ' ').slice(0, 60)
    console.log(`[${label}] intent=${intent} source=${source}\n    → ${answer}`)
  } catch (error) {
    console.log(`[${label}] ERROR ${error.message}`)
  }
}
