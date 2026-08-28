/* 网页开单(批次三 · 上线前必办)· 五条判据照店主指令原文落地。

   合同:把小程序「结算开单」整条流程搬到网页,**同一套后端路由,不许新造接口**;
   入账唯一路径=签署不变(网页只到「生成待签结算单」)。

   ① 网页开的单与小程序开的单,落库行逐字段相等(同租户同项目同档位对照造一单)
   ② 被服务人姓名能输空格
   ③ 钱输入框逐字符连打(老规矩:type=text + inputmode,不回写)
   ④ 组数 ≥2 的单两端算式一致
   ⑤ 开单页每个块都有断言在服务端实发资源上找到锚点

   ⚠️ standalone:CI_SUITES="web-settlement" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}

/* ===== 夹具:一家店、两位技师、两个项目、一位顾客、两张预约 ===== */
const tid = `wsttl-${RUN}`
if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `网页开单店${RUN}`, plan: 'chain' }) })).status !== 201) throw new Error('建店失败')
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const t1 = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技甲${RUN}`, isActive: true }) }, PLATFORM, H)).data.technician
const t2 = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技乙${RUN}`, isActive: true }) }, PLATFORM, H)).data.technician
const catId = ((await request('/admin/pricing/categories', {}, PLATFORM, H)).data.categories || [])[0].id
const svcA = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `单色${RUN}`, nameEn: 'a', priceCents: 19800, baseDurationMin: 60, categoryId: catId }) }, PLATFORM, H)).data.service
const svcB = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `猫眼${RUN}`, nameEn: 'b', priceCents: 25800, baseDurationMin: 90, categoryId: catId }) }, PLATFORM, H)).data.service
const imp = (await request(`/platform/tenants/${tid}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `开单客${RUN}`, phone: `139${RUN.slice(-8)}` }] }) })).data
const userId = imp.users[0].userId
const today = (await request('/admin/store-clock', {}, PLATFORM, H)).data.today
const mkBooking = async (time) => (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId, serviceId: svcA.id, technicianId: t1.id, date: today, time, durationMin: 60 }) }, PLATFORM, H)).data.booking

/* ===== 加载网页模块(vm,stub window):buildBody 是纯函数 ===== */
const ctx = { window: {}, document: undefined }
vm.createContext(ctx)
vm.runInContext(readFileSync(new URL('../web/settlement-web.js', import.meta.url), 'utf8'), ctx)
const SW = ctx.window.SettlementWeb
check('前置:网页模块加载成功且 buildBody/buildSheets 可独立调用(纯函数,不碰 DOM)', typeof SW.buildBody === 'function' && typeof SW.newGroup === 'function')

/* 小程序 formBody 的同形构造(从 groupSheets/formBody 逐字段抄的期望形状) */
function miniFormBody({ bookingId, userId, groups, payMenu = { useBalance: false, recharge: false }, depositApplied = true, couponGrantId = '' }) {
  const payIntent = !payMenu.useBalance ? 'offline_full' : (payMenu.recharge ? 'recharge_then_balance' : 'balance_plus_offline')
  return {
    bookingId: bookingId || undefined, userId: userId || undefined,
    payerUserId: userId || undefined, cardOwnerUserId: userId || undefined,
    payIntent,
    settlements: groups.map((g, i) => ({
      bookingId: i === 0 ? (bookingId || undefined) : undefined,
      tierKey: g.tierKey, tierChangedFrom: g.tierChanged ? g.tierDefault : undefined,
      items: g.items,
      timecardId: undefined, purchasePackageId: undefined, timecardServiceId: undefined,
      customItems: g.customItems || [],
      servedPersonName: String(g.servedPersonName || '').trim(),
      technicians: g.technicians,
      payIntent,
      depositApplied: i === 0 ? depositApplied : false,
      couponGrantId: i === 0 ? (couponGrantId || undefined) : undefined,
      applyFootSurcharge: false, applyTipReuse: false
    }))
  }
}

/* ===== ① 两端 body 同形 + 落库行逐字段相等 ===== */
const bk1 = await mkBooking('10:00')
const bk2 = await mkBooking('12:00')

// 网页侧状态 → buildBody
const webState = {
  bookingId: bk1.id, userId,
  items: [ { id: svcA.id, unit: 'once' }, { id: svcB.id, unit: 'once' } ],
  groups: [Object.assign(SW.newGroup('list', catId), {
    mainId: svcA.id, selectedTechs: [t1.id, t2.id], servedPersonName: '  张 三  ', customItems: [{ name: '补钻', amountCents: 1500 }]
  })],
  payMenu: { useBalance: false, recharge: false }, depositApplied: true, couponGrantId: ''
}
const webBody = SW.buildBody(webState)
const miniBody = miniFormBody({
  bookingId: bk1.id, userId,
  groups: [{ tierKey: 'list', tierChanged: false, tierDefault: 'list',
    items: [{ serviceId: svcA.id, qty: 1 }],
    customItems: [{ name: '补钻', amountCents: 1500 }],
    servedPersonName: '  张 三  ',
    technicians: [ { technicianId: t1.id, role: 'main', itemNos: [] }, { technicianId: t2.id, role: 'assist', itemNos: [] } ]
  }]
})
check('🔴 ① 两端构造的 body **逐字段深比对相等**(同一状态 → 同一份提交体)',
  JSON.stringify(webBody) === JSON.stringify(miniBody),
  `web=${JSON.stringify(webBody).slice(0, 200)}\nmini=${JSON.stringify(miniBody).slice(0, 200)}`)

// 各开一单(网页 body 挂 bk1,小程序形状挂 bk2),落库行逐字段对比
const webMade = await request('/admin/settlements', { method: 'POST', body: JSON.stringify(webBody) }, PLATFORM, H)
check('① 网页 body 开单成功(同一套后端路由,零新造接口)', webMade.status === 201, JSON.stringify(webMade.data).slice(0, 140))
const miniBody2 = miniFormBody({ bookingId: bk2.id, userId, groups: [{ tierKey: 'list', tierChanged: false, tierDefault: 'list', items: [{ serviceId: svcA.id, qty: 1 }], customItems: [{ name: '补钻', amountCents: 1500 }], servedPersonName: '  张 三  ', technicians: [{ technicianId: t1.id, role: 'main', itemNos: [] }, { technicianId: t2.id, role: 'assist', itemNos: [] }] }] })
const miniMade = await request('/admin/settlements', { method: 'POST', body: JSON.stringify(miniBody2) }, PLATFORM, H)
check('① 小程序形状开单成功', miniMade.status === 201)
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH') })())
const rowW = db.prepare('SELECT * FROM settlements WHERE id = ?').get(webMade.data.settlements[0].id)
const rowM = db.prepare('SELECT * FROM settlements WHERE id = ?').get(miniMade.data.settlements[0].id)
const SKIP = new Set(['id', 'code', 'booking_id', 'created_at', 'updated_at', 'group_id', 'sign_token', 'sign_token_expires_at', 'public_code'])
const diffs = Object.keys(rowW).filter((k) => !SKIP.has(k) && String(rowW[k]) !== String(rowM[k]))
check(`🔴 ① 落库行逐字段相等(除单号/时间戳等身份字段,共比 ${Object.keys(rowW).length - SKIP.size} 列)`,
  diffs.length === 0, diffs.map((k) => `${k}: ${rowW[k]} ≠ ${rowM[k]}`).join(' | '))

/* ===== ② 被服务人姓名能输空格 ===== */
check('🔴 ② 被服务者中间的空格保住了(「张 三」),trim 只去首尾',
  rowW.served_person_name === '张 三', JSON.stringify(rowW.served_person_name))
const swSrc = readFileSync(new URL('../web/settlement-web.js', import.meta.url), 'utf8')
check('② 输入 handler 原样进 state(不 trim、不回写重画 —— 店主第 5 步那个坑)',
  /data-sw-served[\s\S]{0,300}servedPersonName = el\.value\b/.test(swSrc) && !/servedPersonName = el\.value\.trim/.test(swSrc))

/* ===== ③ 钱输入框老规矩 ===== */
check('③ 自选行金额框:type=text + inputmode=decimal + data-money(全局 MoneyInput 兜底,零 spinner)',
  /data-sw-custom-amount[^>]*data-money type="text" inputmode="decimal"/.test(swSrc.replace(/\n/g, ' ')) || /data-money type="text" inputmode="decimal"[^>]*data-sw-custom-amount/.test(swSrc.replace(/\n/g, ' ')) || (swSrc.includes('data-sw-custom-amount="${gi}"') && swSrc.includes('data-money type="text" inputmode="decimal"')))

/* ===== ④ 组数 ≥2:两端算式一致(同一个预览口,组级=Σ sheet 腿) ===== */
const twoGroupState = {
  bookingId: bk1.id, userId,
  items: [ { id: svcA.id, unit: 'once' }, { id: svcB.id, unit: 'once' } ],
  groups: [
    Object.assign(SW.newGroup('list', catId), { mainId: svcA.id, selectedTechs: [t1.id] }),
    Object.assign(SW.newGroup('list', catId), { mainId: svcB.id, selectedTechs: [t2.id], servedPersonName: '朋友 小李' })
  ],
  payMenu: { useBalance: false, recharge: false }, depositApplied: false, couponGrantId: ''
}
const pv = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify(SW.buildBody(twoGroupState)) }, PLATFORM, H)
check('④ 两组预览:sheets=2,组级合计 = Σ各组(后端同一口算的,两端读同一份)',
  pv.status === 200 && pv.data.sheets.length === 2
  && pv.data.group.totalCents === pv.data.sheets.reduce((n, s) => n + s.totalCents, 0),
  JSON.stringify({ total: pv.data.group?.totalCents, sheets: pv.data.sheets?.map((s) => s.totalCents) }))
check('④ 网页渲染零算术:模块源码里没有金额加减乘除(只有 money() 格式化后端 cents)',
  !/[a-zA-Z]Cents\s*[+\-*/]\s*[a-zA-Z]/.test(swSrc.replace(/\/\*[\s\S]*?\*\//g, '')), '')

/* ===== ⑤ 每个块在服务端实发资源上有锚点 ===== */
const served = await fetch(`${BASE_URL}/web/settlement-web.js`).then((r) => r.text())
const BLOCKS = [
  ['价格体系', 'data-sw-tier'], ['项目单选', 'data-sw-main'], ['次卡核销', 'data-sw-timecard'],
  ['加项', 'data-sw-addon'], ['自选行', 'data-sw-custom-add'], ['本单技师', 'data-sw-tech'],
  ['被服务者', 'data-sw-served'], ['定金抵扣', 'data-sw-deposit'], ['券', 'data-sw-coupon'],
  ['储值抵扣', 'data-sw-balance'], ['合计', 'swTotalBlock'], ['送签', 'data-sw-submit']
]
const missing = BLOCKS.filter(([, anchor]) => !served.includes(anchor)).map(([name]) => name)
check(`🔴 ⑤ 开单页 ${BLOCKS.length} 个块全部在**服务端实发资源**上找到锚点`, missing.length === 0, missing.join(' | '))
/* 🔴 UI 重做判据(店主 08-29:「每一个环节都要下拉才能点开,很麻烦」;小程序屏=合同,小程序零下拉):
   开单模块渲染输出**零 <select>** —— 价格档/大类/项目/技师全部 chips 或列表行,与小程序同形。 */
check('🔴 ⑤b 动作对齐:开单模块零下拉(小程序同位置全是 chips/列表行,网页不许多一层「点开」)',
  !served.includes('<select'), (served.match(/<select[^>]{0,40}/g) || []).join(' | '))
check('⑤b 小程序同形控件都在:chips(价格档/大类/技师)+ 列表行勾框 + stepper + 定金 radio + 整单规则开关 + 券入口行',
  ['sw-chip', 'sw-ck', 'sw-stepper', 'sw-radio', 'sw-sw', 'sw-cpnline', 'sw-tl big'].every((c) => served.includes(c)))
const servedHtml = await fetch(`${BASE_URL}/web/admin.html`).then((r) => r.text())
check('⑤ 模块带内容指纹挂在 admin.html,容器在订单页里',
  /settlement-web\.js\?v=[0-9a-f]{6,}/.test(servedHtml) && servedHtml.includes('id="settlementComposer"'))

/* ===== ⑥ 入口:去结算按钮由后端出(D70 律),完成态不出 ===== */
const list = (await request('/admin/bookings', {}, PLATFORM, H)).data.bookings || []
const withPending = list.find((b) => b.id === bk1.id)
check('⑥ 入口按钮后端出:有待签单的预约 settleAction=「继续结算(待签 N 张)」',
  withPending && withPending.settleAction && /继续结算/.test(withPending.settleAction.label),
  JSON.stringify(withPending?.settleAction))
const servedAdmin = await fetch(`${BASE_URL}/web/admin.js`).then((r) => r.text())
check('⑥ 网页按钮零 if:渲染只认 booking.settleAction(显隐与文案都是后端的)',
  servedAdmin.includes('booking.settleAction ?') && servedAdmin.includes('data-settle-booking'))

/* ===== ⑦ 入账唯一路径=签署:开出来的是待签单,账本零新增 ===== */
check('⑦ 网页开的单 status=pending_sign(只到待签为止)', rowW.status === 'pending_sign', rowW.status)
const fin = db.prepare("SELECT COUNT(*) n FROM finance_transactions WHERE tenant_id = ? AND source NOT IN ('manual')").get(tid).n
check('⑦ 签字之前账本一分未记(入账唯一路径=签署,不变)', fin === 0, String(fin))

/* ===== ⑧ 🔴 运行时真点(店主 08-29 退回件):「按钮点击 → 页面打开」必须**真调事件链**,
   不是查代码里有没有 addEventListener。案底:事件链一直是通的,坏的是**视口** ——
   composer 在页顶打开而她点的卡在 42,000px 下面,眼前纹丝不动=「点了没反应」。
   所以这条断言连"打开的效果"一起验:列表让位(settle-open)+ 回顶被调 + 页面内容真渲染。 */
{
  const scrollCalls = []
  const mkClassList = () => { const s2 = new Set(); return { add: (c) => s2.add(c), remove: (c) => s2.delete(c), contains: (c) => s2.has(c) } }
  const fakePage = { classList: mkClassList() }
  const fakeMount = {
    classList: mkClassList(), innerHTML: '',
    closest: () => fakePage, querySelector: () => null, querySelectorAll: () => [], scrollIntoView: () => {}
  }
  const ctx2 = {
    window: { scrollTo: (x, y) => scrollCalls.push([x, y]) },
    document: { querySelector: (sel) => (sel === '#settlementComposer' ? fakeMount : null) },
    clearTimeout, setTimeout
  }
  vm.createContext(ctx2)
  vm.runInContext(readFileSync(new URL('../web/settlement-web.js', import.meta.url), 'utf8'), ctx2)
  const SW2 = ctx2.window.SettlementWeb
  const stubRequest = async (p2) => {
    if (p2.startsWith('/admin/pricing/categories')) return { categories: [{ id: 'c1', name: '美甲' }] }
    if (p2.startsWith('/admin/pricing/items')) return { items: [] }
    if (p2.startsWith('/admin/technicians')) return { technicians: [{ id: 't1', name: 'Lina' }] }
    if (p2.startsWith('/admin/settlements?bookingId')) return { settlements: [] }
    return {}
  }
  const fakeEvent = { target: { closest: (sel) => (sel === '[data-settle-booking]' ? { dataset: { settleBooking: 'bk1' } } : null) } }
  const toasts = []
  const handled = SW2.handleClick(fakeEvent, {
    bookings: [{ id: 'bk1', user: { id: '' }, service: { id: '' } }],
    request: stubRequest, escapeHtml: (x) => String(x ?? ''), toast: (m2) => toasts.push(m2), money: () => '$0'
  })
  await new Promise((r2) => setTimeout(r2, 80))
  check('🔴 ⑧ 真点:handleClick 认领事件并真的打开了页面(state.open=true,内容渲染出「结算开单」)',
    handled === true && SW2._state.open === true && fakeMount.innerHTML.includes('结算开单'),
    JSON.stringify({ handled, open: SW2._state.open, toasts, html: fakeMount.innerHTML.slice(0, 60) }))
  check('🔴 ⑧ 打开的效果两件:订单列表让位(settle-open)+ 视口回顶(scrollTo 被真调)',
    fakePage.classList.contains('settle-open') && scrollCalls.length >= 1,
    JSON.stringify({ settleOpen: fakePage.classList.contains('settle-open'), scrollCalls }))
  const fakeEventMiss = { target: { closest: (sel) => (sel === '[data-settle-booking]' ? { dataset: { settleBooking: 'nope' } } : null) } }
  const toasts2 = []
  SW2.handleClick(fakeEventMiss, { bookings: [], request: stubRequest, escapeHtml: String, toast: (m2) => toasts2.push(m2), money: () => '' })
  check('⑧ 反向守:找不到那张单时**必须出声**(toast),不许静默吃掉事件装没事',
    toasts2.length === 1 && /刷新/.test(toasts2[0]), JSON.stringify(toasts2))
}

console.log(`\n✅ test-web-settlement 通过 ${checks} 项`)
