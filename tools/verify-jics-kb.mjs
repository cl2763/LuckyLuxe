#!/usr/bin/env node
// 小婕体验店(jics-nail)配置与知识库隔离复验 —— 开 AI 之后必跑。
//
// 用法(本机):
//   BASE_URL=http://127.0.0.1:4128 OWNER_TOKEN=owner-demo-token node tools/verify-jics-kb.mjs
// 用法(生产):
//   BASE_URL=https://www.luckyluxeatelier.com OWNER_TOKEN=<生产主钥匙> node tools/verify-jics-kb.mjs
//
// 断言:
//   1. 门店配置:aiEnabled / 币种 CNY / 时区 Asia/Shanghai
//   2. 套餐:工作室档 + 无到期时间;AI 智能包已开通且不限期
//   3. 只读得到小婕自己的价目事实(精品单色 368/268/198)
//   4. 读不到 Lucky Luxe 种子层(allowSeedFallback=false,AI 回复里不出现旗舰店资料)
//   5. 平台通用层(platformPreset)照常可用
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4128').replace(/\/$/, '')
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'
const TENANT_ID = process.env.SEED_TENANT_ID || 'jics-nail'
const EXPECT_PLAN = process.env.EXPECT_PLAN || 'studio'

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function call(path, { method = 'GET', body = null, asTenant = false, asCustomerTenant = false } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OWNER_TOKEN}`,
      ...(asTenant ? { 'x-admin-tenant-id': TENANT_ID } : {}),
      ...(asCustomerTenant ? { 'x-tenant-id': TENANT_ID } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

// 旗舰店种子层的特征词:小婕店的任何回答里都不该出现。
// 「136 veterans place」与「CAD」是 2026-08-07 复验真实抓到的两处兜底串店(已修),留在这里防回归。
const SEED_LEAK_PATTERNS = [/Lucky\s*Luxe/i, /Ontario/i, /luckyluxe/i, /136\s*veterans/i, /\bCAD\b/]

async function main() {
  console.log(`== 小婕店复验 ${TENANT_ID} → ${BASE_URL} ==`)

  // 1. 门店对外配置(顾客端口径)
  const stores = await call('/stores', { asCustomerTenant: true })
  check('/stores 可读', stores.status === 200, JSON.stringify(stores.data).slice(0, 200))
  check('AI 已开通(aiEnabled=true)', stores.data.aiEnabled === true, JSON.stringify(stores.data.aiEnabled))
  const store = (stores.data.stores || [])[0]
  check('门店存在', Boolean(store), JSON.stringify(stores.data.stores))
  check('币种 = CNY', store.currency === 'CNY', store.currency)
  check('时区 = Asia/Shanghai', store.timezone === 'Asia/Shanghai', store.timezone)
  check('门店归属租户正确', store.tenant_id === TENANT_ID, store.tenant_id)

  // 2. 套餐与 AI 智能包
  const tenants = await call('/platform/tenants')
  const row = (tenants.data.tenants || []).find((t) => t.id === TENANT_ID)
  check('平台租户列表里能查到', Boolean(row), JSON.stringify(tenants.data.tenants || []).slice(0, 300))
  check(`套餐 = ${EXPECT_PLAN}`, row.plan === EXPECT_PLAN, row.plan)
  check('套餐无到期时间(长期有效)', row.planExpiresAt === null || row.planExpiresAt === undefined, String(row.planExpiresAt))

  const billing = await call('/platform/billing')
  const aiRow = (billing.data.tenants || []).find((t) => t.id === TENANT_ID)
  const ai = aiRow?.ai || aiRow?.aiAddon || null
  check('平台计费页能读到 AI 状态', Boolean(ai), JSON.stringify(aiRow || {}).slice(0, 300))
  check('AI 智能包已开通', ai.enabled === true, JSON.stringify(ai))
  check('AI 不限期(无到期日)', ai.expiresAt === null && ai.unlimited === true, JSON.stringify(ai))

  // 3. 只读得到小婕自己的价目事实
  const kb = await call('/admin/kb', { asTenant: true })
  check('/admin/kb 可读', kb.status === 200, JSON.stringify(kb.data).slice(0, 200))
  const live = kb.data.liveFacts || {}
  const items = live.priceList?.items || []
  const solid = items.find((i) => i.nameZh === '精品单色')
  check('价目里有「精品单色」', Boolean(solid), JSON.stringify(items.map((i) => i.nameZh)))
  check('精品单色三档价 = 368 / 268 / 198',
    solid.price === 368 && solid.sharePrice === 268 && solid.memberPrice === 198,
    JSON.stringify(solid))
  check('加项目录已下发', (live.addonList?.items || []).length >= 10, String((live.addonList?.items || []).length))
  check('计价规则摘要已下发(4 条)', (live.pricingRules || []).length === 4, JSON.stringify(live.pricingRules))
  check('币种事实 = CNY', live.currency === 'CNY', String(live.currency))

  // 4. 种子层隔离:白名单不含小婕店
  check('allowSeedFallback = false(读不到旗舰店种子层)', live.allowSeedFallback === false, String(live.allowSeedFallback))
  const leakInFacts = JSON.stringify(live).match(SEED_LEAK_PATTERNS.find((p) => p.test(JSON.stringify(live))) || /$^/)
  check('实时事实里没有旗舰店字样', !SEED_LEAK_PATTERNS.some((p) => p.test(JSON.stringify(live))), String(leakInFacts))

  // 5. AI 回复链路:问价 → 用小婕自己的价;且不带出旗舰店内容
  const priceAsk = await call('/ai/customer-service', {
    method: 'POST', asCustomerTenant: true,
    body: { lang: 'zh', message: '精品单色多少钱？' }
  })
  check('AI 客服链路通(未被权限闸拦下)',
    priceAsk.status === 200 && priceAsk.data.reply?.source !== 'entitlement_gate',
    JSON.stringify(priceAsk.data).slice(0, 300))
  const answer = `${priceAsk.data.reply?.data?.answerZh || ''} ${priceAsk.data.reply?.data?.answerEn || ''}`
  console.log(`   ↳ AI 回复:${(priceAsk.data.reply?.data?.answerZh || '(空)').replace(/\s+/g, ' ').slice(0, 160)}`)
  const leaked = SEED_LEAK_PATTERNS.filter((p) => p.test(answer))
  check('AI 回复里没有旗舰店(Lucky Luxe / Ontario)内容', leaked.length === 0, answer.slice(0, 200))

  // 6. 平台通用层可用:通用问题仍能被平台预置层接住
  const generic = await call('/ai/customer-service', {
    method: 'POST', asCustomerTenant: true,
    body: { lang: 'zh', message: '你们几点营业？' }
  })
  check('平台通用层链路正常返回', generic.status === 200 && Boolean(generic.data.reply), JSON.stringify(generic.data).slice(0, 200))
  console.log(`   ↳ AI 回复:${(generic.data.reply?.data?.answerZh || '(静默转人工)').replace(/\s+/g, ' ').slice(0, 160)}`)
  const genericLeak = SEED_LEAK_PATTERNS.filter((p) => p.test(generic.data.reply?.data?.answerZh || ''))
  check('通用问答同样不串旗舰店内容', genericLeak.length === 0, (generic.data.reply?.data?.answerZh || '').slice(0, 200))

  console.log(`\n✅ 小婕店复验通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ 复验失败: ${error.message}`)
  process.exit(1)
})
