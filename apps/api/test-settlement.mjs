// P1 结算闭环回归(2026-08-08):
// 金额红线 —— 前端不算钱,后端每次计算都强制校验两条恒等式:
//   共优惠 ≡ 原价合计 − 档位小计     应收 ≡ 档位小计 − 定金抵扣
// 另测:设计图算例复现 / 免收目录项 / 单指按档 / 足部两边同加 / 代付多单 /
//       签字扣卡(先烧迁移桶)/ 余额不足拦签 / 已签不可改只能追加更正 / 租户隔离
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

const financeKeys = new Map()
async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const fk = token ? financeKeys.get(token) : null
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(fk ? { 'x-finance-key': fk } : {}),
      ...extraHeaders,
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

/* 分类唯一真相律(店主 2026-08-25):建店即落平台三大类(美甲/美睫/护理·其他),
   所以夹具再建同 key 的大类会撞 409 —— 改成「有就用,没有才建」。判据跟着口径走。 */
async function ensureCategory(token, body) {
  const made = await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify(body) }, token)
  if (made.data && made.data.category) return made.data.category
  const list = (await request('/admin/pricing/categories', {}, token)).data.categories || []
  return list.find((c) => c.key === body.key) || list.find((c) => c.name === body.name) || list[0]
}

// 每一处金额都用这两条恒等式验一遍——手会算错,减法不会
function assertMoney(label, s) {
  check(`${label}:共优惠 ≡ 原价合计 − 档位小计`, s.discountTotalCents === s.listTotalCents - s.subtotalCents,
    `${s.discountTotalCents} vs ${s.listTotalCents} - ${s.subtotalCents}`)
  check(`${label}:应收 ≡ 档位小计 − 定金抵扣`, s.totalCents === s.subtotalCents - s.depositDeductCents,
    `${s.totalCents} vs ${s.subtotalCents} - ${s.depositDeductCents}`)
}

async function newShop(label) {
  const id = `p1s-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `结算店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  const unlock = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) financeKeys.set(token, unlock.data.financeKey)
  return { tenantId: id, token }
}

async function main() {
  const shop = await newShop('a')
  const other = await newShop('b')
  check('两家临时店建好', Boolean(shop.token && other.token))

  // 按设计图搭一套价目:简单款3h 528/358、纤维补甲(单指) 38/18、本店制作免卸甲 0、卸本甲 68/18
  const catNail = await ensureCategory(shop.token, { key: 'nail_simple', name: '美甲简单款式' })
  const catRemoval = await ensureCategory(shop.token, { key: 'removal', name: '卸甲' })
  const mk = async (body) => (await request('/admin/pricing/items', { method: 'POST', body: JSON.stringify(body) }, shop.token)).data.item
  const main3h = await mk({ nameZh: '简单款式 3 小时', type: 'NAIL', categoryId: catNail.id, itemKind: 'main', listPriceCents: 52800, memberPriceCents: 35800, baseDurationMin: 180 })
  const fiber = await mk({ nameZh: '纤维/甲片补甲', type: 'NAIL', categoryId: catNail.id, itemKind: 'addon', unit: 'per_finger', listPriceCents: 3800, memberPriceCents: 1800, addonScope: [catNail.id] })
  const freeRemoval = await mk({ nameZh: '本店制作免卸甲', type: 'NAIL', categoryId: catRemoval.id, itemKind: 'addon', listPriceCents: 0, memberPriceCents: 0, addonScope: [catNail.id] })
  const paidRemoval = await mk({ nameZh: '卸本甲', type: 'NAIL', categoryId: catRemoval.id, itemKind: 'addon', listPriceCents: 6800, memberPriceCents: 1800, addonScope: [catNail.id] })
  check('价目按设计图搭好', Boolean(main3h.id && fiber.id && freeRemoval.id && paidRemoval.id))
  await request('/admin/pricing/rules', {
    method: 'PUT',
    body: JSON.stringify({ rules: { foot_surcharge: { isActive: true, config: { amountCents: 10000 } }, single_finger: { isActive: true, config: { pct: 10 } }, tip_reuse: { isActive: true, config: { amountCents: 10000 } } } })
  }, shop.token)

  // ---- 设计图算例复现:02 简单款3h + 09 补甲2指 + 12 免卸甲,会员档 ----
  const design = await request('/admin/settlements/preview', {
    method: 'POST',
    body: JSON.stringify({
      tierKey: 'member',
      items: [{ serviceId: main3h.id }, { serviceId: fiber.id, fingers: 2 }, { serviceId: freeRemoval.id }]
    })
  }, shop.token)
  const d = design.data.settlement
  check('设计图算例:原价合计 = 528 + 76 = 604', d.listTotalCents === 60400, String(d.listTotalCents))
  check('设计图算例:档位小计 = 358 + 36 = 394', d.subtotalCents === 39400, String(d.subtotalCents))
  check('设计图算例:共优惠 = 210', d.discountTotalCents === 21000, String(d.discountTotalCents))
  assertMoney('设计图算例', d)
  const freeLine = d.lines.find((l) => l.serviceId === freeRemoval.id)
  check('免收目录项显示为 0 且标 isFree', freeLine.amountCents === 0 && freeLine.isFree === true, JSON.stringify(freeLine))
  check('明细带编号(技师端按编号勾人)', d.lines.map((l) => l.itemNo).join(',') === '1,2,3', d.lines.map((l) => l.itemNo).join(','))

  // ---- 足部加收:两边同时加,恒等式不被破坏 ----
  const foot = await request('/admin/settlements/preview', {
    method: 'POST',
    body: JSON.stringify({ tierKey: 'member', items: [{ serviceId: main3h.id }], applyFootSurcharge: true })
  }, shop.token)
  const f = foot.data.settlement
  check('足部 +100 同时进原价合计与档位小计', f.listTotalCents === 52800 + 10000 && f.subtotalCents === 35800 + 10000,
    JSON.stringify({ list: f.listTotalCents, sub: f.subtotalCents }))
  assertMoney('足部加收', f)

  // ---- 互斥软校验:同单勾了免收又勾收费卸除 ----
  const bothRemoval = await request('/admin/settlements/preview', {
    method: 'POST',
    body: JSON.stringify({ tierKey: 'member', items: [{ serviceId: main3h.id }, { serviceId: freeRemoval.id }, { serviceId: paidRemoval.id }] })
  }, shop.token)
  check('免收 + 收费卸除同勾 → 软校验提示(不硬拦)',
    bothRemoval.status === 200 && bothRemoval.data.settlement.softWarnings.some((w) => w.code === 'FREE_AND_PAID_REMOVAL'),
    JSON.stringify(bothRemoval.data.settlement.softWarnings))

  // ---- 自选填写行 ----
  const custom = await request('/admin/settlements/preview', {
    method: 'POST',
    body: JSON.stringify({ tierKey: 'member', items: [{ serviceId: main3h.id }], customItems: [{ name: '钻球', amountCents: 5000 }] })
  }, shop.token)
  const cu = custom.data.settlement
  check('自选填写行计入两边(不产生虚假优惠)', cu.listTotalCents === 52800 + 5000 && cu.subtotalCents === 35800 + 5000, JSON.stringify({ l: cu.listTotalCents, s: cu.subtotalCents }))
  assertMoney('自选填写行', cu)

  // ---- 代付:一组多张单,卡主签字 ----
  const imp = await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, rows: [{ name: `小美${RUN_ID}`, phone: `1381${RUN_ID.slice(-7)}`, balanceCents: 18000 }] })
  })
  const cardOwner = imp.data.users[0].userId
  check('卡主建档并有迁移余额 ¥180', imp.status === 200 && imp.data.openingWrittenCents === 18000)

  const techA = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `小婕${RUN_ID}` }) })).data.technician
  const techB = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `苏苏${RUN_ID}` }) })).data.technician

  const group = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cardOwner,
      settlements: [
        {
          tierKey: 'member',
          items: [{ serviceId: main3h.id }, { serviceId: fiber.id, fingers: 2 }, { serviceId: freeRemoval.id }],
          technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1, 3] }, { technicianId: techB.id, role: 'assist', itemNos: [2] }]
        },
        { tierKey: 'member', servedPersonName: '小红', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }
      ]
    })
  }, shop.token)
  check('一次结算生成 2 张服务单', group.status === 201 && group.data.sheetCount === 2, JSON.stringify(group.data).slice(0, 200))
  const [sheet1, sheet2] = group.data.settlements
  check('朋友的单挂在卡主名下并标代付', sheet2.isProxyPaid === true && sheet2.servedPersonName === '小红', JSON.stringify({ p: sheet2.isProxyPaid, n: sheet2.servedPersonName }))
  check('两位技师与各自编号都记下了', sheet1.technicians.length === 2 && sheet1.technicians[0].role === 'main'
    && JSON.stringify(sheet1.technicians[0].itemNos) === '[1,3]', JSON.stringify(sheet1.technicians))
  assertMoney('落库单据1', sheet1)
  assertMoney('落库单据2', sheet2)

  // ---- 公开签署页 ----
  const pub = await request(`/settlements/${sheet1.code}`, {}, null)
  check('签署页凭单号可读(不需登录)', pub.status === 200 && pub.data.settlement.code === sheet1.code)
  check('签署页带免责声明文案', /结算凭证/.test(pub.data.disclaimer), pub.data.disclaimer)
  check('签署页金额与落库一致', pub.data.settlement.totalCents === sheet1.totalCents)

  // ---- 必勾免责 + 必须签名 ----
  const noDisc = await request(`/settlements/${sheet1.code}/sign`, { method: 'POST', body: JSON.stringify({ signature: '小美' }) }, null)
  check('不勾免责不能签', noDisc.status === 400 && noDisc.data.error.code === 'DISCLAIMER_REQUIRED')
  const noSig = await request(`/settlements/${sheet1.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true }) }, null)
  check('不签名不能提交', noSig.status === 400 && noSig.data.error.code === 'SIGNATURE_REQUIRED')

  // ---- 签字即时扣卡:先烧迁移桶 ----
  const signed = await request(`/settlements/${sheet1.code}/sign`, {
    method: 'POST',
    body: JSON.stringify({ disclaimerAccepted: true, signature: '小美', strokes: [[{ x: 12, y: 60 }, { x: 40, y: 20 }, { x: 70, y: 70 }], [{ x: 90, y: 30 }, { x: 120, y: 66 }]] })
  }, null)
  check('卡主签字成功', signed.status === 200 && signed.data.settlement.status === 'signed', JSON.stringify(signed.data).slice(0, 220))
  check('签字即时扣卡 ¥180(余额只有这么多)', signed.data.storedDeductedCents === 18000, String(signed.data.storedDeductedCents))
  const members = await request('/admin/membership/members', {}, shop.token)
  const owner = members.data.members.find((m) => m.userId === cardOwner)
  check('先烧迁移桶:legacy 归零', owner.legacyBalanceCents === 0 && owner.balanceCents === 0, JSON.stringify(owner))
  const paid = signed.data.settlement.payments.filter((p) => p.leg === 'migrate_stored')
  check('扣的是迁移腿(不进本店收入)', paid.length === 1 && paid[0].status === 'paid', JSON.stringify(signed.data.settlement.payments))
  const offline = signed.data.settlement.payments.find((p) => p.leg === 'offline')
  check('线下腿标为待收款', offline && offline.status === 'awaiting', JSON.stringify(offline))

  // ---- 签署快照:唯一凭证,签的那一刻生成 ----
  check('签署返回快照信息', Boolean(signed.data.snapshot && signed.data.snapshot.at), JSON.stringify(signed.data.snapshot))
  /* 2026-08-08 沙盒隔离裁决后,这条断言改口径:
     测试实例永远是非生产环境,所以**无论 env 里有没有 COS 钥匙,都必须走 inline**。
     「配了就上传」只在生产(或显式 COS_SMOKE=1 的冒烟)成立 —— 本地铺演示数据那次
     把快照传进了真实生产桶,就是因为当时只看 cosConfigured。 */
  check('沙盒里签署一律 inline,不碰真实对象存储',
    signed.data.snapshot.storage === 'inline' && !signed.data.snapshot.url,
    JSON.stringify(signed.data.snapshot))
  /* 真机 SVG 空白件(店主 08-23):快照出图改 PNG(真机 <image> 不认带文字的 SVG)——
     图源变、内容不变:内容层断言改盯**快照 SVG 原文**(引擎产物,serializeSettlement 同源),
     出图层断言改盯 PNG 头与尺寸。 */
  const snap = await fetch(`${BASE_URL}/settlements/${sheet1.code}/snapshot`)
  const snapBuf = Buffer.from(await snap.arrayBuffer())
  check('快照可取回', snap.status === 200 || snap.status === 302, String(snap.status))
  if (snap.status === 200) {
    const isPng = snapBuf.length > 24 && snapBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    check('快照出图=PNG(真机可渲染格式)+尺寸>0', isPng && snapBuf.readUInt32BE(16) > 0 && snapBuf.readUInt32BE(20) > 0,
      `${snap.headers.get('content-type')} ${snapBuf.length}B`)
    const snapSvg = await (await fetch(`${BASE_URL}/settlements/${sheet1.code}/snapshot?format=svg`)).text()
    check('快照原文含单号', snapSvg.includes(sheet1.code), snapSvg.slice(0, 80))
    check('快照里画进了笔迹路径', /<path d="M/.test(snapSvg), snapSvg.slice(0, 200))
    check('快照金额与单据一致(共优惠/五步账头条)', snapSvg.includes('较原价共优惠') && snapSvg.includes('本单到店支付'), '')
  }
  check('快照信息随单据下发(日结页「查看签署单」用它)', Boolean(signed.data.settlement.snapshot), JSON.stringify(signed.data.settlement.snapshot))

  // ---- 重复签 / 余额不足拦签 ----
  const again = await request(`/settlements/${sheet1.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '小美' }) }, null)
  check('同一张单不能签两次', again.status === 400 && again.data.error.code === 'ALREADY_SIGNED')

  // ---- 已签单据不可改,只能追加更正 ----
  const amend = await request(`/admin/settlements/${sheet1.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: sheet1.totalCents - 5000, reason: '少收了一项' }) }, shop.token)
  check('更正走追加,不改原单', amend.status === 200 && amend.data.amended === true
    && amend.data.settlement.totalCents === sheet1.totalCents, JSON.stringify(amend.data).slice(0, 200))
  check('更正记录留痕(改前/改后/谁/何时)', amend.data.settlement.amendments.length === 1 && amend.data.settlement.amendments[0].amendedBy, JSON.stringify(amend.data.settlement.amendments))
  check('用卡付过的单更正后自动补配余额', amend.data.autoBalanceAdjustCents === 5000, String(amend.data.autoBalanceAdjustCents))

  // ---- 租户隔离 ----
  const crossRead = await request('/admin/settlements', {}, other.token)
  check('B 店看不到 A 店的结算单', !(crossRead.data.settlements || []).some((s) => s.id === sheet1.id), String((crossRead.data.settlements || []).length))
  const crossAmend = await request(`/admin/settlements/${sheet1.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: 1, reason: '越权' }) }, other.token)
  check('B 店改不动 A 店的单(404)', crossAmend.status === 404)

  // ---- 沙盒隔离:配了 COS 也不许往真桶传(店主 2026-08-08 裁决,根因固化)----
  const clock = await request('/admin/store-clock', {}, shop.token)
  check('沙盒隔离:COS 配置齐全时 cosConfigured 为真', clock.data.storage.cosConfigured === true, JSON.stringify(clock.data.storage))
  check('沙盒隔离:非生产环境 uploadAllowed 为假(不看 env 有没有钥匙)',
    clock.data.storage.uploadAllowed === false, JSON.stringify(clock.data.storage))
  check('沙盒隔离:快照回落口径写明 inline',
    clock.data.storage.snapshotFallback === 'inline', JSON.stringify(clock.data.storage))
  const sandboxGroup = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cardOwner,
      settlements: [{ tierKey: 'list', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)
  const sandboxCode = sandboxGroup.data.settlements[0].code
  const sandboxSigned = await request(`/settlements/${sandboxCode}/sign`, {
    method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '沙盒客' })
  }, null)
  check('沙盒隔离:签署产生的快照是 inline,没有 COS 地址',
    sandboxSigned.data.settlement.snapshot.storage === 'inline' && !sandboxSigned.data.settlement.snapshot.url,
    JSON.stringify(sandboxSigned.data.settlement.snapshot))
  // 真机 SVG 空白件后:出图是 PNG,原文口 ?format=svg 仍在(两个都要能取回来)
  const sandboxPng = await fetch(`${BASE_URL}/settlements/${sandboxCode}/snapshot`)
  const sandboxPngBuf = Buffer.from(await sandboxPng.arrayBuffer())
  const sandboxSvgText = await (await fetch(`${BASE_URL}/settlements/${sandboxCode}/snapshot?format=svg`)).text()
  check('沙盒隔离:inline 快照照样取得回来(出图 PNG + 原文口 SVG,功能不受影响)',
    sandboxPng.status === 200 && sandboxPngBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && /<svg/.test(sandboxSvgText),
    `${sandboxPng.status} ${sandboxPngBuf.length}B`)

  console.log(`\n结算闭环回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
