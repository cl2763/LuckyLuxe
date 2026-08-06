// P0 多价位价格模型回归(2026-08-06):
// 1. 大类/项目/加项 CRUD + 三档价与疗程价录入,services.price_cents 与 list 档双写一致
// 2. 足部加收 = 整单最终 +amountCents(会员档也一样加)
// 3. 单指价 = 该单所用价格档的延长类主项目价 ÷10 × 指数
// 4. 甲片重利用固定价,不分档
// 5. 本店有历史完成单 → 卸甲 0 元(system);无历史时技师手动勾选也 0 元(manual)
// 6. 租户隔离:另一家店读不到、也报不了本店的价
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

// 建一家临时店并拿到该店老板的会话 token(首登强制改密,改完再登一次)
async function newTenant(label) {
  const id = `p0px-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `P0 价格测试店 ${label} ${RUN_ID}`, plan: 'single' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  if (first.status !== 200) throw new Error(`首登失败: ${JSON.stringify(first.data)}`)
  const newPass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: newPass, confirmPassword: newPass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: newPass }) }, null)
  if (again.status !== 200) throw new Error(`改密后登录失败: ${JSON.stringify(again.data)}`)
  return { tenantId: created.data.tenant.id, token: again.data.auth.accessToken }
}

function localDateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function main() {
  const shopA = await newTenant('a')
  const shopB = await newTenant('b')
  check('临时店 A/B 建好并各自登录', Boolean(shopA.token && shopB.token && shopA.tenantId !== shopB.tenantId))

  // 技师先建,后建的主项目才会自动分配给他(排单要用)
  const tech = await request(`/platform/tenants/${shopA.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `小婕${RUN_ID}` }) })
  check('临时店 A 建好技师', tech.status === 201, JSON.stringify(tech.data))
  const techId = tech.data.technician.id

  // ---- 1. 大类 ----
  const catExt = await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail_ext', name: '美甲延长', sortOrder: 1 }) }, shopA.token)
  check('新建大类 201', catExt.status === 201 && catExt.data.category.key === 'nail_ext', JSON.stringify(catExt.data))
  const catRemoval = await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'removal', name: '卸甲', sortOrder: 9, isBookable: false }) }, shopA.token)
  check('卸甲大类可建且可关预约', catRemoval.status === 201 && catRemoval.data.category.isBookable === false)
  const dupCat = await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail_ext', name: '重复' }) }, shopA.token)
  check('同店同 key 大类拒绝重复', dupCat.status === 409)
  const extId = catExt.data.category.id
  const removalCatId = catRemoval.data.category.id

  // ---- 2. 主项目三档价 ----
  const mainRes = await request('/admin/pricing/items', {
    method: 'POST',
    body: JSON.stringify({
      nameZh: '水晶延长', nameEn: 'Acrylic Extension', type: 'NAIL', categoryId: extId, itemKind: 'main',
      listPriceCents: 88000, sharePriceCents: 68000, memberPriceCents: 46000, baseDurationMin: 120
    })
  }, shopA.token)
  check('主项目建好且三档价齐', mainRes.status === 201
    && mainRes.data.item.listPriceCents === 88000
    && mainRes.data.item.sharePriceCents === 68000
    && mainRes.data.item.memberPriceCents === 46000, JSON.stringify(mainRes.data))
  check('services.price_cents 与 list 档双写一致', mainRes.data.item.priceCents === 88000)
  const mainId = mainRes.data.item.id

  // 疗程价 + 次数
  const careRes = await request('/admin/pricing/items', {
    method: 'POST',
    body: JSON.stringify({ nameZh: '富勒烯手护', type: 'CARE', categoryId: extId, listPriceCents: 48000, memberPriceCents: 16800, coursePriceCents: 39900, courseTimes: 3 })
  }, shopA.token)
  check('疗程价与次数落库', careRes.status === 201 && careRes.data.item.coursePriceCents === 39900 && careRes.data.item.courseTimes === 3, JSON.stringify(careRes.data))

  // ---- 3. 加项:单指(挂靠主项目按比例)+ 单指(固定价)+ 卸甲 ----
  const fingerPct = await request('/admin/pricing/items', {
    method: 'POST',
    body: JSON.stringify({ nameZh: '水晶甲矫正(单指)', type: 'NAIL', categoryId: extId, itemKind: 'addon', unit: 'per_finger', priceRule: 'pct_of_tier_price', priceRuleValue: 0, listPriceCents: 0, addonScope: [extId] })
  }, shopA.token)
  check('单指加项(按主项目比例)建好', fingerPct.status === 201 && fingerPct.data.item.unit === 'per_finger' && fingerPct.data.item.priceRule === 'pct_of_tier_price')
  const fingerPctId = fingerPct.data.item.id

  const fingerFixed = await request('/admin/pricing/items', {
    method: 'POST',
    body: JSON.stringify({ nameZh: '纤维补甲(单指)', type: 'NAIL', categoryId: extId, itemKind: 'addon', unit: 'per_finger', listPriceCents: 3800, sharePriceCents: 2600, memberPriceCents: 1800, addonScope: [extId] })
  }, shopA.token)
  check('单指加项(固定价)建好', fingerFixed.status === 201)
  const fingerFixedId = fingerFixed.data.item.id

  const removalItem = await request('/admin/pricing/items', {
    method: 'POST',
    body: JSON.stringify({ nameZh: '卸本甲', type: 'NAIL', categoryId: removalCatId, itemKind: 'addon', listPriceCents: 6800, sharePriceCents: 3800, memberPriceCents: 1800, addonScope: [extId] })
  }, shopA.token)
  check('卸甲加项建好', removalItem.status === 201)
  const removalId = removalItem.data.item.id

  // ---- 4. 四条规则 ----
  const rulesPut = await request('/admin/pricing/rules', {
    method: 'PUT',
    body: JSON.stringify({
      rules: {
        foot_surcharge: { isActive: true, config: { amountCents: 10000 } },
        single_finger: { isActive: true, config: { pct: 10 } },
        tip_reuse: { isActive: true, config: { amountCents: 10000 } },
        removal_free_if_in_store: { isActive: true, config: { enabled: true } }
      }
    })
  }, shopA.token)
  check('四条计价规则保存', rulesPut.status === 200 && rulesPut.data.rules.foot_surcharge.isActive === true && rulesPut.data.rules.single_finger.config.pct === 10, JSON.stringify(rulesPut.data))

  // ---- ① 足部加收:整单最终 +100,任何档都一样加 ----
  const listPlain = await request('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: mainId, tierKey: 'list' }) }, shopA.token)
  check('原价档小计 = 880', listPlain.data.quote.totalCents === 88000, String(listPlain.data.quote.totalCents))
  const listFoot = await request('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: mainId, tierKey: 'list', applyFootSurcharge: true }) }, shopA.token)
  check('① 原价档足部加收 = 整单 +100', listFoot.data.quote.totalCents === 98000 && listFoot.data.quote.subtotalCents === 88000, String(listFoot.data.quote.totalCents))
  const memberFoot = await request('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: mainId, tierKey: 'member', applyFootSurcharge: true }) }, shopA.token)
  check('① 会员档足部同样 +10000(不分档)', memberFoot.data.quote.totalCents === 46000 + 10000, String(memberFoot.data.quote.totalCents))
  check('① 足部加收进 rulesApplied', memberFoot.data.quote.rulesApplied.some((r) => r.key === 'foot_surcharge' && r.amountCents === 10000))

  // ---- ② 单指 3 指 = 所用档主项目价 ÷10 × 3 ----
  const shareFinger = await request('/admin/pricing/preview', {
    method: 'POST',
    body: JSON.stringify({ serviceId: mainId, tierKey: 'share', addons: [{ serviceId: fingerPctId, fingers: 3 }] })
  }, shopA.token)
  const expectedShare = 68000 + Math.round(68000 * 10 / 100) * 3
  check('② 分享档 3 指 = 分享价÷10×3', shareFinger.data.quote.totalCents === expectedShare, `${shareFinger.data.quote.totalCents} vs ${expectedShare}`)
  const memberFinger = await request('/admin/pricing/preview', {
    method: 'POST',
    body: JSON.stringify({ serviceId: mainId, tierKey: 'member', addons: [{ serviceId: fingerPctId, fingers: 3 }] })
  }, shopA.token)
  check('② 换会员档单指价随档走', memberFinger.data.quote.totalCents === 46000 + Math.round(46000 * 10 / 100) * 3, String(memberFinger.data.quote.totalCents))
  const fixedFinger = await request('/admin/pricing/preview', {
    method: 'POST',
    body: JSON.stringify({ serviceId: mainId, tierKey: 'member', addons: [{ serviceId: fingerFixedId, fingers: 2 }] })
  }, shopA.token)
  check('② 固定价单指项按自己的档位价 × 指数', fixedFinger.data.quote.totalCents === 46000 + 1800 * 2, String(fixedFinger.data.quote.totalCents))

  // ---- ③ 甲片重利用固定 100,不分档 ----
  const tipList = await request('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: mainId, tierKey: 'list', applyTipReuse: true }) }, shopA.token)
  const tipMember = await request('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: mainId, tierKey: 'member', applyTipReuse: true }) }, shopA.token)
  check('③ 甲片重利用固定 10000(原价档)', tipList.data.quote.totalCents === 88000 + 10000, String(tipList.data.quote.totalCents))
  check('③ 甲片重利用固定 10000(会员档同价)', tipMember.data.quote.totalCents === 46000 + 10000, String(tipMember.data.quote.totalCents))

  // ---- ④ 免卸:有本店历史完成单 → system;无历史 → 技师手动 manual ----
  const direct = await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: `老客${RUN_ID}`, serviceId: mainId, technicianId: techId, date: localDateStr(-1), time: '11:00', durationMin: 60 })
  }, shopA.token)
  check('老板直接排单成功(用于制造历史单)', direct.status === 201, JSON.stringify(direct.data))
  const bookingId = direct.data.booking.id
  const done = await request(`/admin/bookings/${bookingId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shopA.token)
  check('历史单置为 COMPLETED', done.status === 200)
  const customers = await request('/admin/customers', {}, shopA.token)
  const oldCustomer = customers.data.customers.find((c) => c.displayName === `老客${RUN_ID}`)
  check('老顾客在客户档案里', Boolean(oldCustomer), JSON.stringify(customers.data.customers).slice(0, 200))

  const oldQuote = await request('/admin/pricing/preview', {
    method: 'POST',
    body: JSON.stringify({ serviceId: mainId, tierKey: 'list', addons: [{ serviceId: removalId }], userId: oldCustomer.id })
  }, shopA.token)
  const oldRemovalLine = oldQuote.data.quote.lines.find((l) => l.serviceId === removalId)
  check('④ 本店老顾客卸甲 0 元 + freeRemovalBy=system',
    oldRemovalLine.amountCents === 0 && oldQuote.data.quote.freeRemovalBy === 'system' && oldQuote.data.quote.totalCents === 88000,
    JSON.stringify(oldQuote.data.quote))

  // 新顾客(无历史):默认收费,技师勾选后免
  const imported = await request(`/platform/tenants/${shopA.tenantId}/import/customers`, {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, rows: [{ name: `新客${RUN_ID}`, phone: `13900${RUN_ID.slice(-6)}` }] })
  })
  check('导入一个无历史新顾客', imported.status === 200 && imported.data.created === 1, JSON.stringify(imported.data))
  const newCustomer = { id: imported.data.users[0].userId }
  check('新顾客建档成功', Boolean(newCustomer.id))

  const newPaid = await request('/admin/pricing/preview', {
    method: 'POST',
    body: JSON.stringify({ serviceId: mainId, tierKey: 'list', addons: [{ serviceId: removalId }], userId: newCustomer.id })
  }, shopA.token)
  check('④ 无历史顾客卸甲照收', newPaid.data.quote.totalCents === 88000 + 6800 && newPaid.data.quote.freeRemovalBy === null, JSON.stringify(newPaid.data.quote))
  const newManual = await request('/admin/pricing/preview', {
    method: 'POST',
    body: JSON.stringify({ serviceId: mainId, tierKey: 'list', addons: [{ serviceId: removalId }], userId: newCustomer.id, manualFreeRemoval: true })
  }, shopA.token)
  check('④ 技师手动免卸生效 + freeRemovalBy=manual', newManual.data.quote.totalCents === 88000 && newManual.data.quote.freeRemovalBy === 'manual', JSON.stringify(newManual.data.quote))

  // 规则关掉后手动勾选也不再免(规则是总闸)
  await request('/admin/pricing/rules', { method: 'PUT', body: JSON.stringify({ rules: { removal_free_if_in_store: { isActive: false, config: { enabled: false } } } }) }, shopA.token)
  const offQuote = await request('/admin/pricing/preview', {
    method: 'POST',
    body: JSON.stringify({ serviceId: mainId, tierKey: 'list', addons: [{ serviceId: removalId }], userId: oldCustomer.id, manualFreeRemoval: true })
  }, shopA.token)
  check('免卸规则关掉后不再免单', offQuote.data.quote.totalCents === 88000 + 6800 && offQuote.data.quote.freeRemovalBy === null)
  await request('/admin/pricing/rules', { method: 'PUT', body: JSON.stringify({ rules: { removal_free_if_in_store: { isActive: true, config: { enabled: true } } } }) }, shopA.token)

  // ---- ⑤ 租户隔离 ----
  const bItems = await request('/admin/pricing/items', {}, shopB.token)
  check('⑤ B 店读不到 A 店的项目', bItems.status === 200 && !bItems.data.items.some((i) => i.id === mainId), JSON.stringify(bItems.data.items.map((i) => i.id)))
  const bCats = await request('/admin/pricing/categories', {}, shopB.token)
  check('⑤ B 店读不到 A 店的大类', !bCats.data.categories.some((c) => c.id === extId))
  const bQuote = await request('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: mainId, tierKey: 'list' }) }, shopB.token)
  check('⑤ B 店拿 A 店项目报价被拒 404', bQuote.status === 404, JSON.stringify(bQuote.data))
  const bRules = await request('/admin/pricing/rules', {}, shopB.token)
  check('⑤ B 店的规则不受 A 店影响(默认关闭)', bRules.data.rules.foot_surcharge.isActive === false)

  // ---- 6. 改价:PATCH 后双写仍一致;删除大类被在用项目挡住 ----
  const patched = await request(`/admin/pricing/items/${mainId}`, { method: 'PATCH', body: JSON.stringify({ listPriceCents: 90000, memberPriceCents: 50000 }) }, shopA.token)
  check('改价后 list 与 price_cents 仍一致', patched.data.item.listPriceCents === 90000 && patched.data.item.priceCents === 90000)
  const afterPatch = await request('/admin/pricing/preview', { method: 'POST', body: JSON.stringify({ serviceId: mainId, tierKey: 'member' }) }, shopA.token)
  check('改价即时生效到报价', afterPatch.data.quote.totalCents === 50000, String(afterPatch.data.quote.totalCents))
  const delBusy = await request(`/admin/pricing/categories/${extId}`, { method: 'DELETE' }, shopA.token)
  check('大类下有项目时不允许删除', delBusy.status === 409, JSON.stringify(delBusy.data))
  const delUsedItem = await request(`/admin/pricing/items/${mainId}`, { method: 'DELETE' }, shopA.token)
  check('有历史订单的项目改为下架而非物理删除', delUsedItem.status === 200 && delUsedItem.data.deleted === false && delUsedItem.data.disabled === true, JSON.stringify(delUsedItem.data))
  const delFreeItem = await request(`/admin/pricing/items/${fingerFixedId}`, { method: 'DELETE' }, shopA.token)
  check('无订单的项目可物理删除', delFreeItem.status === 200 && delFreeItem.data.deleted === true)

  // ---- 7. AI 知识库同步:三档价与加项进 facts ----
  const kb = await request('/admin/kb', {}, shopA.token)
  const live = kb.data.liveFacts || kb.data.facts || {}
  const priceItems = live.priceList?.items || []
  check('AI 事实里主项目带会员价与疗程价',
    priceItems.some((i) => i.nameZh === '富勒烯手护' && i.memberPrice === 168 && i.coursePrice === 399 && i.courseTimes === 3),
    JSON.stringify(priceItems).slice(0, 300))
  check('AI 事实里下架项目不出现(刚被下架的水晶延长)', !priceItems.some((i) => i.nameZh === '水晶延长'))
  check('AI 事实里有加项目录', Array.isArray(live.addonList?.items) && live.addonList.items.some((i) => i.nameZh === '卸本甲'), JSON.stringify(live.addonList || null).slice(0, 300))
  check('AI 事实里有计价规则摘要', Array.isArray(live.pricingRules) && live.pricingRules.some((t) => /足部/.test(t)), JSON.stringify(live.pricingRules || null))

  console.log(`\n价格模型回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
