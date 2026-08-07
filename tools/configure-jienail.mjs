#!/usr/bin/env node
// Jie'Nail 店铺配置(P1.2 第四节)。幂等,可重复执行。
//   BASE_URL=https://www.luckyluxeatelier.com OWNER_TOKEN=<生产主钥匙> node tools/configure-jienail.mjs
//
// 定金规则文案取自已确认的 UI 设计图(屏3),emoji 原样入库。
// 需要临时覆盖时设 JIENAIL_DEPOSIT_TEXT 环境变量。

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4128').replace(/\/$/, '')
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'
const TENANT_ID = process.env.SEED_TENANT_ID || 'jics-nail'

const STORE_NAME = "Jie'Nail 美甲美睫專門店"
const STORE_ADDRESS = '长兴南街华润悦府13号楼1单元2005室（20层）'
const OPEN_TIME = '10:00'
const CLOSE_TIME = '19:00'
// 店主原文三条(取自已确认的 UI 设计图「屏3 · 定金规则 来自本店」,emoji 原样保留)
const OWNER_DEPOSIT_TEXT = [
  '▪️ 项目操作时间较长，我们采用预约制，请您尽量提前两天预约',
  '▪️ 预约需您支付定位费¥100元，口头预约无效噢～预约成功我们会为您发邀请函确认预约♥️',
  '▪️ 为了保证其他预约顾客及美甲师·美睫师的合法权益，超过预约时间30分钟未到场会取消当天的操作且预约金无法退还，若您在预约当天无法到达请您至少提前一天更改时间，预约金可保留一次，下次预约。'
].join('\n')
const CUSTOM_TEXT = process.env.JIENAIL_DEPOSIT_TEXT || OWNER_DEPOSIT_TEXT

const log = (...args) => console.log(...args)

async function api(path, options = {}, asTenant = false) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OWNER_TOKEN}`,
      ...(asTenant ? { 'x-admin-tenant-id': TENANT_ID } : {}),
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} → ${response.status} ${JSON.stringify(data)}`)
  return data
}
const T = (path, options = {}) => api(path, options, true)

async function main() {
  log(`== Jie'Nail 店铺配置(${TENANT_ID})→ ${BASE_URL} ==`)

  // 1. 店名 + 地址(租户名与门店名一起更正;tenant id 不变)
  const store = await api(`/platform/tenants/${TENANT_ID}/store`, {
    method: 'PUT',
    body: JSON.stringify({ name: STORE_NAME, address: STORE_ADDRESS, currency: 'CNY', timezone: 'Asia/Shanghai' })
  })
  log(`- 门店:${store.store.name} · ${store.store.address}`)
  log(`  币种 ${store.store.currency} · 时区 ${store.store.timezone}`)

  // 2. 营业时间:每日 10:00–19:00(七天同配,商家后台可再调)
  const hours = await api(`/platform/tenants/${TENANT_ID}/business-hours`, {
    method: 'PUT',
    body: JSON.stringify({
      hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openTime: OPEN_TIME, closeTime: CLOSE_TIME, isClosed: false }))
    })
  })
  log(`- 营业时间:${hours.hoursText?.zh || `每日 ${OPEN_TIME}-${CLOSE_TIME}`}`)

  // 3. AI 品牌事实跟着改名
  await T('/admin/kb/facts', {
    method: 'PUT',
    body: JSON.stringify({ facts: { brandName: STORE_NAME, assistantName: `${STORE_NAME} 预约助手`, storeAddress: STORE_ADDRESS, currency: 'CNY' } })
  })
  log('- AI 品牌事实已更新(店名/地址/币种)')

  // 4. 定金规则:固定 ¥100,不抵扣,会员不免,不退;迟到宽限 30 分钟,爽约扣满,
  //    改期需提前 24 小时,合规改期定金可保留 1 次
  const deposit = await T('/admin/deposit-config', {
    method: 'PUT',
    body: JSON.stringify({
      config: {
        enabled: true,
        mode: 'fixed',
        fixedAmountCents: 10000,
        deductible: false,
        memberWaive: 'none',
        cancelPolicy: {
          refundable: false,
          lateArrivalGraceMin: 30,
          noShowForfeitPct: 100,
          rescheduleNoticeHours: 24,
          depositRetainTimes: 1
        },
        displayMode: CUSTOM_TEXT ? 'custom' : 'auto',
        customText: CUSTOM_TEXT
      }
    })
  })
  log(`- 定金规则:固定 ¥${deposit.config.fixedAmountCents / 100} / 不抵扣 / 会员不免 / 不退`)
  log(`  迟到宽限 ${deposit.config.cancelPolicy.lateArrivalGraceMin} 分钟 · 改期提前 ${deposit.config.cancelPolicy.rescheduleNoticeHours} 小时 · 定金可保留 ${deposit.config.cancelPolicy.depositRetainTimes} 次`)
  log(`  文案模式:${deposit.config.displayMode}${CUSTOM_TEXT ? '(店主原文)' : '(按参数自动生成,等店主原文三条)'}`)
  log(`  对外文案:${deposit.text.zh}`)

  // 5. 技师建档:小婕(店长)· 鹤辰 · 苏苏 · 翠花(幂等,按姓名认)
  const existingTechs = (await api(`/platform/tenants/${TENANT_ID}/technicians`)).technicians || []
  const ROSTER = [['小婕', '店长'], ['鹤辰', ''], ['苏苏', ''], ['翠花', '']]
  let techAdded = 0
  for (const [name, title] of ROSTER) {
    if (existingTechs.some((t) => t.name === name)) continue
    await api(`/platform/tenants/${TENANT_ID}/technicians`, { method: 'POST', body: JSON.stringify({ name, title }) })
    techAdded += 1
  }
  log(`- 技师名单:${ROSTER.map(([n, t]) => (t ? `${n}(${t})` : n)).join(' · ')}(新增 ${techAdded} 位)`)

  // 6. 预约成功邀请函模板:先用规则文案占位,正式邀请函等店主给
  const tpls = await T('/admin/message-templates')
  const invite = (tpls.templates || []).find((t) => t.scene === 'booking_confirmed_invite')
  const inviteContent = [
    `{customerName}你好,你在${STORE_NAME}的预约已确认:`,
    '时间 {bookingTime}',
    `地址 ${STORE_ADDRESS}`,
    deposit.text.zh,
    '(正式邀请函文案待店主提供,此为临时占位)'
  ].join('\n')
  if (invite) {
    await T(`/admin/message-templates/${invite.id}`, { method: 'PATCH', body: JSON.stringify({ title: '预约成功邀请函(占位)', content: inviteContent }) })
    log('- 邀请函模板:已更新占位内容')
  } else {
    await T('/admin/message-templates', {
      method: 'POST',
      body: JSON.stringify({ scene: 'booking_confirmed_invite', title: '预约成功邀请函(占位)', content: inviteContent, variables: ['{customerName}', '{bookingTime}'] })
    })
    log('- 邀请函模板:已新建占位')
  }

  // 7. 回读核对
  const clock = await T('/admin/store-clock')
  const policy = await api(`/store/deposit-policy?tenantId=${TENANT_ID}`)
  log(`\n回读核对:`)
  log(`  店名 ${store.store.name}`)
  log(`  今天 ${clock.today} ${clock.localTime}(${clock.timezone})`)
  log(`  定金文案 ${policy.text.zh}`)
  log(`\n✅ Jie'Nail 配置完成(可重复执行)`)
}

main().catch((error) => {
  console.error(`\n✗ 配置失败: ${error.message}`)
  process.exit(1)
})
