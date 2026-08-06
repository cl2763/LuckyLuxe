#!/usr/bin/env node
// 体验店种子:Jic's Nail 小婕(tenant = jics-nail)
//
// 用法(本机):
//   BASE_URL=http://127.0.0.1:4128 OWNER_TOKEN=owner-demo-token node tools/seed-jics-nail.mjs
// 用法(生产,需店主口令后执行):
//   BASE_URL=https://www.luckyluxeatelier.com OWNER_TOKEN=<生产主钥匙> node tools/seed-jics-nail.mjs
//
// 幂等:重复跑不会重复建店/重复建项目——大类按 key 认、项目按名称+类型认,存在就改价不新建。
// 不建技师、不配薪资(参数未到);不写任何订单/财务数据。
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4128').replace(/\/$/, '')
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'
const TENANT_ID = process.env.SEED_TENANT_ID || 'jics-nail'
const TENANT_NAME = "Jic's Nail 小婕"
const STORE_TIMEZONE = process.env.SEED_TIMEZONE || 'Asia/Shanghai' // 小婕店在境内

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
const T = (path, options = {}) => api(path, options, true) // 以 jics-nail 租户身份调商家端接口

// ===== 价目表(单位:分;三档 = 原价 / 分享价 / 会员价)=====
const CATEGORIES = [
  { key: 'nail_solid', name: '美甲单色', sortOrder: 1 },
  { key: 'nail_simple', name: '美甲简单款式', sortOrder: 2 },
  { key: 'nail_complex', name: '美甲复杂款式', sortOrder: 3 },
  { key: 'lash', name: '美睫', sortOrder: 4 },
  { key: 'care', name: '护理', sortOrder: 5 },
  { key: 'removal', name: '卸甲', sortOrder: 6 }
]

// [名称, 大类key, 类型, 原价, 分享价, 会员价, 时长分钟, 疗程价?, 疗程次数?]
const MAIN_ITEMS = [
  ['精品单色', 'nail_solid', 'NAIL', 36800, 26800, 19800, 90],
  ['高光猫眼', 'nail_solid', 'NAIL', 46800, 33800, 25800, 90],
  ['简单款式 2 小时', 'nail_simple', 'NAIL', 45800, 36800, 29800, 120],
  ['简单款式 3 小时', 'nail_simple', 'NAIL', 52800, 42800, 35800, 180],
  ['简单款式 3.5 小时', 'nail_simple', 'NAIL', 64800, 52800, 39800, 210],
  ['复杂款式 4 小时', 'nail_complex', 'NAIL', 78800, 62800, 46800, 240],
  ['复杂款式 5 小时', 'nail_complex', 'NAIL', 88800, 75800, 56800, 300],
  ['复杂款式 6 小时', 'nail_complex', 'NAIL', 128800, 86800, 65800, 360],
  ['复杂款式 8 小时', 'nail_complex', 'NAIL', 168800, 101800, 76800, 480],
  ['单根嫁接', 'lash', 'LASH', 38000, 29800, 22800, 90],
  ['自然款', 'lash', 'LASH', 48000, 39800, 29800, 100],
  ['款式美睫', 'lash', 'LASH', 68000, 49800, 39800, 120],
  ['下睫毛', 'lash', 'LASH', 16800, 9800, 6800, 30],
  ['卸除睫毛', 'lash', 'LASH', 12800, 7800, 5800, 30],
  ['手部精修前置', 'care', 'CARE', 15800, 8800, 5800, 30],
  ['富勒烯手护', 'care', 'CARE', 48000, 29800, 16800, 60, 39900, 3],
  ['焕颜足护', 'care', 'CARE', 58000, 39800, 26800, 60, 69900, 3]
]

// [名称, 大类key, 类型, 原价, 分享价, 会员价, 单位, 适用大类keys]
const NAIL_SCOPE = ['nail_solid', 'nail_simple', 'nail_complex']
const ADDON_ITEMS = [
  ['浅贴甲片', 'nail_simple', 'NAIL', 38000, 26000, 18000, 'once', NAIL_SCOPE],
  ['甲膜', 'nail_simple', 'NAIL', 38000, 26000, 18000, 'once', NAIL_SCOPE],
  ['水晶', 'nail_complex', 'NAIL', 88000, 68000, 46000, 'once', NAIL_SCOPE],
  ['纤维补甲(单指)', 'nail_complex', 'NAIL', 3800, 2600, 1800, 'per_finger', NAIL_SCOPE],
  ['水晶甲矫正(单指)', 'nail_complex', 'NAIL', 16800, 12800, 8800, 'per_finger', NAIL_SCOPE],
  ['日本UP足部矫正(单指)', 'care', 'CARE', 19800, 16800, 12800, 'per_finger', ['care']],
  ['卸本甲', 'removal', 'NAIL', 6800, 3800, 1800, 'once', NAIL_SCOPE],
  ['足部卸甲', 'removal', 'NAIL', 6800, 3800, 1800, 'once', NAIL_SCOPE],
  ['甲片卸甲', 'removal', 'NAIL', 7800, 5800, 3800, 'once', NAIL_SCOPE],
  ['水晶卸甲', 'removal', 'NAIL', 9800, 7800, 5800, 'once', NAIL_SCOPE]
]

const RULES = {
  foot_surcharge: { isActive: true, config: { amountCents: 10000 } },
  single_finger: { isActive: true, config: { pct: 10 } },
  tip_reuse: { isActive: true, config: { amountCents: 10000 } },
  removal_free_if_in_store: { isActive: true, config: { enabled: true } }
}

async function main() {
  log(`== 体验店种子:${TENANT_NAME}(${TENANT_ID})→ ${BASE_URL} ==`)

  // 1. 租户(幂等:已存在就跳过创建)
  const { tenants } = await api('/platform/tenants')
  let credentials = null
  if (tenants.some((t) => t.id === TENANT_ID)) {
    log(`- 租户已存在,跳过建店`)
  } else {
    const created = await api('/platform/tenants', {
      method: 'POST',
      body: JSON.stringify({ id: TENANT_ID, name: TENANT_NAME, plan: 'single', initialTerm: 'year', city: '', currency: 'CNY', timezone: STORE_TIMEZONE })
    })
    credentials = created.owner
    log(`+ 建店成功;老板账号 ${credentials.username}(初始密码只显示这一次)`)
  }

  // 2. 门店币种与时区:境内含税价 CNY;时区 Asia/Shanghai(2026-08-07 修:首版误种成 America/Toronto)
  // 这一步每次都跑,所以对已存在的店同样会把时区/币种纠正过来 —— 幂等复跑即修复。
  const storeRes = await api(`/platform/tenants/${TENANT_ID}/store`, {
    method: 'PUT',
    body: JSON.stringify({ name: TENANT_NAME, currency: 'CNY', timezone: STORE_TIMEZONE })
  })
  log(`- 门店币种 ${storeRes.store.currency} · 时区 ${storeRes.store.timezone}`)
  if (storeRes.store.timezone !== STORE_TIMEZONE) throw new Error(`时区没写进去(实际 ${storeRes.store.timezone})`)

  // 3. 会员与储值:不开等级,充过值即会员,不设有效期
  await T('/admin/membership/config', {
    method: 'PUT',
    body: JSON.stringify({ config: { tiersEnabled: false, memberQualify: 'any_recharge', qualifyValueCents: 0, expireDays: null } })
  })
  log('- 会员配置:tiersEnabled=false / any_recharge / 无有效期')

  // 4. 大类(按 key 幂等)
  const existingCats = (await T('/admin/pricing/categories')).categories
  const catIdByKey = {}
  for (const cat of CATEGORIES) {
    const hit = existingCats.find((c) => c.key === cat.key)
    if (hit) {
      await T(`/admin/pricing/categories/${hit.id}`, { method: 'PATCH', body: JSON.stringify({ name: cat.name, sortOrder: cat.sortOrder, isBookable: true }) })
      catIdByKey[cat.key] = hit.id
    } else {
      const res = await T('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ ...cat, isBookable: true }) })
      catIdByKey[cat.key] = res.category.id
    }
  }
  log(`- 大类 ${CATEGORIES.length} 个就位(全部可预约)`)

  // 5. 项目与加项(按「名称 + main/addon」幂等)
  const existingItems = (await T('/admin/pricing/items')).items
  const findItem = (nameZh, itemKind) => existingItems.find((i) => i.nameZh === nameZh && i.itemKind === itemKind)
  let createdCount = 0
  let updatedCount = 0

  for (const [nameZh, catKey, type, list, share, member, durationMin, coursePrice, courseTimes] of MAIN_ITEMS) {
    const body = {
      nameZh, nameEn: nameZh, type, itemKind: 'main', categoryId: catIdByKey[catKey], unit: 'once',
      listPriceCents: list, sharePriceCents: share, memberPriceCents: member,
      baseDurationMin: durationMin, depositCents: 0, isActive: true,
      sortOrder: MAIN_ITEMS.findIndex((row) => row[0] === nameZh) + 1,
      ...(coursePrice ? { coursePriceCents: coursePrice, courseTimes } : { coursePriceCents: null })
    }
    const hit = findItem(nameZh, 'main')
    if (hit) { await T(`/admin/pricing/items/${hit.id}`, { method: 'PATCH', body: JSON.stringify(body) }); updatedCount += 1 } else { await T('/admin/pricing/items', { method: 'POST', body: JSON.stringify(body) }); createdCount += 1 }
  }

  for (const [nameZh, catKey, type, list, share, member, unit, scopeKeys] of ADDON_ITEMS) {
    const body = {
      nameZh, nameEn: nameZh, type, itemKind: 'addon', categoryId: catIdByKey[catKey], unit,
      listPriceCents: list, sharePriceCents: share, memberPriceCents: member,
      baseDurationMin: 0, depositCents: 0, isActive: true,
      addonScope: scopeKeys.map((key) => catIdByKey[key]).filter(Boolean),
      sortOrder: ADDON_ITEMS.findIndex((row) => row[0] === nameZh) + 1
    }
    const hit = findItem(nameZh, 'addon')
    if (hit) { await T(`/admin/pricing/items/${hit.id}`, { method: 'PATCH', body: JSON.stringify(body) }); updatedCount += 1 } else { await T('/admin/pricing/items', { method: 'POST', body: JSON.stringify(body) }); createdCount += 1 }
  }
  log(`- 项目与加项:新建 ${createdCount} 条 / 更新 ${updatedCount} 条(主项 ${MAIN_ITEMS.length} + 加项 ${ADDON_ITEMS.length})`)

  // 6. 四条计价规则
  await T('/admin/pricing/rules', { method: 'PUT', body: JSON.stringify({ rules: RULES }) })
  log('- 计价规则:足部加收 ¥100 / 单指 10% / 甲片重利用 ¥100 / 本店免卸')

  // 7. AI 知识事实(单店层):品牌与价目口径
  await T('/admin/kb/facts', {
    method: 'PUT',
    body: JSON.stringify({ facts: { brandName: TENANT_NAME, assistantName: '小婕助理', currency: 'CNY' } })
  })
  const kbEntries = [
    {
      question: '你们的价格分几档?',
      keywords: '价格,几档,分享价,会员价,原价',
      answerZh: '我们每个项目有三个价:原价、分享价(分享到朋友圈/小红书可享)、会员价(充值成为会员后享)。护理类还有疗程价,按次数打包更划算。'
    },
    {
      question: '足部项目会加钱吗?',
      keywords: '足部,脚,加钱,加收',
      answerZh: '足部项目在最终金额上统一加 ¥100(任何价格档都一样加)。'
    },
    {
      question: '卸甲要钱吗?',
      keywords: '卸甲,卸,拆,要钱吗',
      answerZh: '本店做的甲免费卸;不是本店做的按卸甲价目表收费(卸本甲 ¥68、甲片卸甲 ¥78、水晶卸甲 ¥98,足部卸甲 ¥68),具体以技师现场确认为准。'
    },
    {
      question: '断了一根能单独补吗?',
      keywords: '单指,补一根,断甲,单根',
      answerZh: '可以按单指补。单指价按该单所用价格档的延长类项目价的 10% 每指计算;纤维补甲、水晶甲矫正等有固定的单指价。'
    }
  ]
  const existingKb = (await T('/admin/kb')).entries || []
  let kbAdded = 0
  for (const entry of kbEntries) {
    if (existingKb.some((row) => row.question === entry.question)) continue
    await T('/admin/kb/entries', { method: 'POST', body: JSON.stringify(entry) })
    kbAdded += 1
  }
  log(`- AI 知识库:品牌事实已写入,新增 FAQ ${kbAdded} 条(已存在的不重复加)`)

  // 8. 自检:随手试算三笔,确认规则真的生效
  const items = (await T('/admin/pricing/items')).items
  const complex6 = items.find((i) => i.nameZh === '复杂款式 6 小时')
  const fingerFix = items.find((i) => i.nameZh === '纤维补甲(单指)')
  const footCare = items.find((i) => i.nameZh === '焕颜足护')
  const q1 = (await T('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: complex6.id, tierKey: 'member' }) })).quote
  const q2 = (await T('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: complex6.id, tierKey: 'share', addons: [{ serviceId: fingerFix.id, fingers: 3 }] }) })).quote
  const q3 = (await T('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: footCare.id, tierKey: 'list', applyFootSurcharge: true }) })).quote
  log(`\n自检试算:`)
  log(`  复杂6h 会员价            = ¥${(q1.totalCents / 100).toFixed(2)}(应为 ¥658.00)`)
  log(`  复杂6h 分享价 + 补3指     = ¥${(q2.totalCents / 100).toFixed(2)}(868 + 26×3 = ¥946.00)`)
  log(`  焕颜足护 原价 + 足部加收   = ¥${(q3.totalCents / 100).toFixed(2)}(580 + 100 = ¥680.00)`)

  const facts = (await T('/admin/kb')).liveFacts
  log(`  AI 事实:价目 ${facts.priceList?.items?.length || 0} 项 / 加项 ${facts.addonList?.items?.length || 0} 项 / 规则 ${facts.pricingRules?.length || 0} 条`)

  if (credentials) {
    log(`\n★ 老板账号(只显示这一次,请转交商家):`)
    log(`  用户名 ${credentials.username}`)
    log(`  初始密码 ${credentials.initialPassword}`)
    log(`  首次登录强制改密。`)
  }
  log(`\n✅ ${TENANT_NAME} 种子完成(可重复执行)`)
}

main().catch((error) => {
  console.error(`\n✗ 种子失败: ${error.message}`)
  process.exit(1)
})
