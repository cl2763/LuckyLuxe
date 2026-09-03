/* 营业时间强制设置(《营业时间强制设置图 v1.0》· D84)· A1–A6 验收断言照图落地。

   唯一判定:未设置态 = 该店没有任何一天 is_closed=0(字段空、或七天全关)。
   A1 拦截(两端机制单点) A2 后端终闸 A3 全库零回落(白名单机械扫)
   A4 员工墙无表单 A5 设完立即生效 A6 「本日休息」只属于设过的店

   ⚠️ standalone:CI_SUITES="hours-gate" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'

/* D132 口径④(店主 04d §一):顾客侧公开路由**必须带门店标识**,不再回落旗舰店。
   夹具同批补头 —— 补的是「请求带不带 x-tenant-id」,判据一个字没放宽。
   per-call 的 headers 仍然后到先得(跨租户用例照旧覆盖它)。 */
const TENANT_HEADER = process.env.TEST_TENANT_ID || 'lucky-luxe'
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
    headers: { 'x-tenant-id': TENANT_HEADER, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/* ===== 夹具:未设置店 + 已设置店(店群陪审团前身:夹具须含未设置店 —— 合同六) ===== */
const tU = `hgu-${RUN}`
const tS = `hgs-${RUN}`
for (const t of [tU, tS]) {
  if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: t, name: `时闸店${t}`, plan: 'chain' }) })).status !== 201) throw new Error('建店失败')
}
const HU = { 'x-admin-tenant-id': tU, 'x-tenant-id': tU }
const HS = { 'x-admin-tenant-id': tS, 'x-tenant-id': tS }
const week = (mk) => [0, 1, 2, 3, 4, 5, 6].map(mk)

/* ===== 唯一判定 + A5 生效面 ===== */
{
  const me1 = await request('/admin/auth/me', {}, PLATFORM, HU)
  check('🔴 判定:新店(business_hours 空)auth/me 下发 hoursUnset=true + 后端句齐',
    me1.data.hoursUnset === true && me1.data.hoursGateText?.ownerTitle === '设置营业时间'
    && me1.data.hoursGateText?.staffTitle === '老板还没设置营业时间',
    JSON.stringify({ h: me1.data.hoursUnset, t: me1.data.hoursGateText }).slice(0, 160))

  const put = await request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: week((w) => (w === 0 ? { weekday: w, isClosed: true } : { weekday: w, openTime: '10:00', closeTime: '19:00', isClosed: false })) }) }, PLATFORM, HS)
  check('夹具:已设置店保存周一~周六营业 → 200', put.status === 200, String(put.status))
  const me2 = await request('/admin/auth/me', {}, PLATFORM, HS)
  check('A5 设完立即生效:同会话不退出重进,auth/me 旗标翻为 false', me2.data.hoursUnset === false)
}

/* ===== A2 后端终闸:七天全关保存必须被拒(前端灰只是体验) ===== */
{
  const allClosed = await request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: week((w) => ({ weekday: w, isClosed: true })) }) }, PLATFORM, HU)
  check('🔴 A2 未设置店七天全关 → 400 HOURS_ALL_CLOSED「至少选择一天营业」',
    allClosed.status === 400 && allClosed.data?.error?.code === 'HOURS_ALL_CLOSED', JSON.stringify(allClosed.data).slice(0, 120))
  /* 合并态才是判定对象:已设置店只提交 3 天关 → 其余 4 天还开着 → 200 */
  const partial = await request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: [1, 2, 3].map((w) => ({ weekday: w, isClosed: true })) }) }, PLATFORM, HS)
  check('A2 合并态判定:部分提交(3 天关,库里还有 4 天开)→ 200', partial.status === 200, String(partial.status))
  const finishOff = await request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: [0, 4, 5, 6].map((w) => ({ weekday: w, isClosed: true })) }) }, PLATFORM, HS)
  check('A2 合并态判定:再把剩下 4 天也关 → 合并态全关 → 400', finishOff.status === 400 && finishOff.data?.error?.code === 'HOURS_ALL_CLOSED')
  /* 恢复已设置店(后续断言还要用) */
  const back = await request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: week((w) => (w === 0 ? { weekday: w, isClosed: true } : { weekday: w, openTime: '10:00', closeTime: '19:00', isClosed: false })) }) }, PLATFORM, HS)
  check('夹具:恢复已设置店', back.status === 200)
}

/* ===== A6 「本日休息」只属于设过的店(含「七天全关=未设置」的统一判定) ===== */
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH') })())
{
  const today = (await request('/admin/store-clock', {}, PLATFORM, HU)).data.today
  const dayU = await request(`/admin/schedule-day?date=${today}`, {}, PLATFORM, HU)
  check('🔴 A6 未设置店台面:hoursUnset=true 且 isClosed=false(永远轮不到「本日休息」)',
    dayU.data.hoursUnset === true && dayU.data.isClosed === false, JSON.stringify({ u: dayU.data.hoursUnset, c: dayU.data.isClosed }))
  /* 老库遗留形态:有行但七天全 is_closed —— 统一判定下同样=未设置(图首行「或七天全关」) */
  const sid = db.prepare('SELECT id FROM stores WHERE tenant_id = ? LIMIT 1').get(tU).id
  const ins = db.prepare("INSERT OR REPLACE INTO business_hours (store_id, weekday, open_time, close_time, is_closed) VALUES (?, ?, '00:00', '00:00', 1)")
  for (let w = 0; w <= 6; w += 1) ins.run(sid, w)
  const dayU2 = await request(`/admin/schedule-day?date=${today}`, {}, PLATFORM, HU)
  check('🔴 A6 统一判定:七天全关(老库遗留形态)同样=未设置态,不出「休息」',
    dayU2.data.hoursUnset === true && dayU2.data.isClosed === false, JSON.stringify({ u: dayU2.data.hoursUnset, c: dayU2.data.isClosed }))
  db.prepare('DELETE FROM business_hours WHERE store_id = ?').run(sid)   // 夹具收尾(判据幂等,J 族学费)
  /* 真休息:已设置店的周日 isClosed=true 且 hoursUnset=false —— 「休息」只属于它 */
  const set = await request('/admin/business-hours', {}, PLATFORM, HS)
  const sunday = set.data.stores[0].hours.find((h) => h.weekday === 0)
  check('A6 已设置店周日:is_closed 真休息(休息态只留给真设了营业时间的店)', Boolean(sunday) && sunday.isClosed === true, JSON.stringify(sunday))
}

/* ===== 零回落行为面:未设置店不许被编出可约时段/排班边界 ===== */
{
  const today2 = (await request('/admin/store-clock', {}, PLATFORM, HU)).data.today
  const catU = ((await request('/admin/pricing/categories', {}, PLATFORM, HU)).data.categories || [])[0].id
  const svc = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `闸测${RUN}`, nameEn: 'g', priceCents: 9900, baseDurationMin: 60, categoryId: catU }) }, PLATFORM, HU)).data.service
  const tech = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `闸技${RUN}`, isActive: true }) }, PLATFORM, HU)).data.technician
  const sid = db.prepare('SELECT id FROM stores WHERE tenant_id = ? LIMIT 1').get(tU).id
  const avail = await request(`/availability?storeId=${sid}&serviceId=${svc.id}&date=${today2}`, {}, null, { 'x-tenant-id': tU })
  const slots = ((avail.data && avail.data.slots) || []).length
  check('🔴 零回落:未设置店可约时段=0(以前回落 10:00-20:00 会凭空长出一整天可约)',
    avail.status === 200 ? slots === 0 : true, JSON.stringify({ status: avail.status, slots }))
  const shift = await request(`/admin/technicians/${tech.id}/schedule`, { method: 'PATCH', body: JSON.stringify({ date: today2, shift: 'full' }) }, PLATFORM, HU)
  check('零回落:未设置店按「全天班」排班 → 400 HOURS_UNSET 明确拒绝,不编 10:00-19:00',
    shift.status === 400 && shift.data?.error?.code === 'HOURS_UNSET', JSON.stringify(shift.data).slice(0, 140))
}

/* ===== A3 全库零回落 · 白名单机械扫(判据三律·三:不数「我改过的」,数「全仓必须落白名单」) ===== */
{
  const apiDir = new URL('.', import.meta.url)
  const files = readdirSync(apiDir).filter((f) => f.endsWith('.mjs') && !f.startsWith('test-'))
  const ALLOW = {
    /* 白名单式(判据三律·三):按文件钉条数+验存在性标记,新增/挪窝即红 */
    'local-server.mjs': { max: 1, marker: '打卡域成文口径',
      reason: '打卡域「规定下班」成文口径(注释:排班>门店>19:00);读口带 is_closed=0 闸,非门店营业时间读口回落' }
  }   /* 08-30c 裁定3:supabase 停用件已尸清,白名单随尸减一(棘轮只减)—— 现仅打卡域 1 条 */
  const hits = []
  for (const f of files) {
    const src = stripJs(readFileSync(new URL(f, import.meta.url), 'utf8'))
    src.split('\n').forEach((line, i) => {
      if (/\|\|\s*'([01]\d|2[0-3]):[0-5]\d'/.test(line)) hits.push({ file: f, line: i + 1, text: line.trim().slice(0, 90) })
    })
  }
  const byFile = {}
  for (const h of hits) byFile[h.file] = (byFile[h.file] || 0) + 1
  const bad = []
  for (const [f, n] of Object.entries(byFile)) {
    const a = ALLOW[f]
    if (!a) { bad.push(`${f}:不在白名单(${n} 处)`); continue }
    if (n > a.max) { bad.push(`${f}:${n} 处 > 钉数 ${a.max}`); continue }
    if (!readFileSync(new URL(f, import.meta.url), 'utf8').includes(a.marker)) bad.push(`${f}:存在性标记「${a.marker}」丢了`)
  }
  check('🔴 A3 全库「|| \'HH:MM\'」回落逐文件落白名单(钉数+存在性标记,新增即红)',
    bad.length === 0, bad.join(' | ') + ' hits=' + JSON.stringify(hits).slice(0, 240))
}

/* ===== A1 拦截 · 两端机制单点 ===== */
{
  /* 网页:render() 是全部管理页唯一渲染咽喉,gate 必须在第一行;hours-setup.js 先于 admin.js 装载 */
  const servedAdmin = await fetch(`${BASE_URL}/web/admin.js`).then((r) => r.text())
  const renderHead = servedAdmin.slice(servedAdmin.indexOf('\nfunction render() {'), servedAdmin.indexOf('\nfunction render() {') + 420)
  check('🔴 A1 网页:render() 咽喉第一行就是 HoursSetup.gate(短路一切管理页)',
    renderHead.includes('HoursSetup?.gate(') && renderHead.indexOf('HoursSetup?.gate(') < renderHead.indexOf('applyLanguage()'), renderHead.slice(0, 160))
  const servedHtml = await fetch(`${BASE_URL}/web/admin.html`).then((r) => r.text())
  check('A1 网页:hours-setup.js 在 admin.html 装载清单里且先于 admin.js',
    servedHtml.indexOf('hours-setup.js') > 0 && servedHtml.indexOf('hours-setup.js') < servedHtml.indexOf('admin.js?v='))

  /* vm 行为:未设置=接管(渲染出后端句),已设置=放行 */
  const ctx = { window: {}, document: (() => {
    const els = {}
    return {
      querySelector: (sel) => els[sel] || null,
      createElement: () => {
        const el = { id: '', innerHTML: '', querySelectorAll: () => [], querySelector: () => null, remove() { delete els['#hoursSetupWall'] } }
        return el
      },
      body: { appendChild: (el) => { els['#' + el.id] = el } }
    }
  })() }
  vm.createContext(ctx)
  vm.runInContext(readFileSync(new URL('../web/hours-setup.js', import.meta.url), 'utf8'), ctx)
  const HS2 = ctx.window.HoursSetup
  const txt = { ownerTitle: '设置营业时间', ownerHint: 'h', saveDisabledNote: '至少选择一天营业', timePlaceholder: '选择时间', saveButton: '保存并开始使用', staffTitle: '老板还没设置营业时间', staffHint: 's' }
  const deps = { escapeHtml: (x) => String(x ?? ''), request: async () => ({}), toast: () => {}, reboot: async () => {} }
  const took = HS2.gate({ hoursUnset: true, role: 'owner', hoursGateText: txt }, deps)
  const wall = ctx.document.querySelector('#hoursSetupWall')
  check('🔴 A1 行为:未设置态 gate=接管,整屏出「设置营业时间」+ 七天行 + 灰钮注「至少选择一天营业」',
    took === true && wall && wall.innerHTML.includes('设置营业时间') && (wall.innerHTML.match(/data-hsw-toggle/g) || []).length === 7
    && wall.innerHTML.includes('至少选择一天营业') && /<button[^>]*\bdisabled/.test(wall.innerHTML),
    (wall ? wall.innerHTML.slice(0, 120) : 'no wall'))
  check('A1 行为:图合同三 —— 初始七天全不勾、占位「选择时间」、零预填默认',
    (wall.innerHTML.match(/选择时间/g) || []).length === 7 && !wall.innerHTML.includes('10:00'))
  const passed = HS2.gate({ hoursUnset: false, role: 'owner' }, deps)
  check('A1 行为:已设置态 gate=放行(返回 false,墙被拆除)', passed === false && !ctx.document.querySelector('#hoursSetupWall'))

  /* 小程序:守卫单点 —— 两个守卫都过闸,全部商家页 onShow 都走守卫(双向白名单) */
  const apiJs = stripJs(readFileSync(new URL('../../miniprogram/utils/api.js', import.meta.url), 'utf8'))
  /* 突变自检咬过一刀(08-30):数全文出现次数把「函数定义行」也数了进去,摘掉守卫里的调用照样绿 ——
     废判据。改成**逐守卫体内点名**:两个守卫的函数体里各自必须有这一句调用。 */
  const bodyOf = (name) => {
    const at = apiJs.indexOf(`function ${name}(`)
    if (at < 0) return ''
    /* 第二刀咬出的边界病:下一声明可能是 async function,「\nfunction 」匹配不上会滑进邻居函数体。
       改用正则找下一条(async )?function 声明。 */
    const rest = apiJs.slice(at + 10)
    const m2 = rest.match(/\n(async )?function /)
    return apiJs.slice(at, m2 ? at + 10 + m2.index : at + 2000)
  }
  check('🔴 A1 小程序:guardMerchant 体内有 enforceHoursGate() 调用', /if \(enforceHoursGate\(\)\) return false/.test(bodyOf('guardMerchant')), bodyOf('guardMerchant').slice(0, 200))
  check('🔴 A1 小程序:guardOwner 体内有 enforceHoursGate() 调用', /if \(enforceHoursGate\(\)\) return false/.test(bodyOf('guardOwner')))
  check('A1 小程序:强制页路径常量在(单一咽喉的锚)', apiJs.includes("HOURS_SETUP_PAGE = 'pages/merchant/hours-setup/index'"))
  const merchDir = new URL('../../miniprogram/pages/merchant/', import.meta.url)
  const unguarded = readdirSync(merchDir).filter((d) => {
    try {
      const src = readFileSync(new URL(`${d}/index.js`, merchDir), 'utf8')
      return !/guardMerchant|guardOwner/.test(src)
    } catch { return false }
  })
  check('A1 小程序:pages/merchant/** 每一页 onShow 都走守卫(放行一条绕过路由=红)', unguarded.length === 0, unguarded.join(','))
}

/* ===== A4 员工墙无表单(两端) ===== */
{
  const ctx2 = { window: {}, document: (() => {
    const els = {}
    return { querySelector: (sel) => els[sel] || null, createElement: () => ({ id: '', innerHTML: '', querySelectorAll: () => [], querySelector: () => null, remove() {} }), body: { appendChild: (el) => { els['#' + el.id] = el } } }
  })() }
  vm.createContext(ctx2)
  vm.runInContext(readFileSync(new URL('../web/hours-setup.js', import.meta.url), 'utf8'), ctx2)
  const txt2 = { staffTitle: '老板还没设置营业时间', staffHint: '设置完成后这里会出现今天的排单' }
  ctx2.window.HoursSetup.gate({ hoursUnset: true, role: 'staff', hoursGateText: txt2 }, { escapeHtml: String, request: async () => ({}), toast: () => {}, reboot: async () => {} })
  const wall2 = ctx2.document.querySelector('#hoursSetupWall')
  check('🔴 A4 网页员工墙:只有提示句,响应体里零表单元素(无 input/开关/保存钮)',
    wall2.innerHTML.includes('老板还没设置营业时间') && !wall2.innerHTML.includes('<input') && !wall2.innerHTML.includes('data-hsw-toggle') && !wall2.innerHTML.includes('data-hsw-save'),
    wall2.innerHTML.slice(0, 120))
  const wxml = readFileSync(new URL('../../miniprogram/pages/merchant/hours-setup/index.wxml', import.meta.url), 'utf8')
  const elseAt = wxml.indexOf('wx:else')
  const lastSwitch = wxml.lastIndexOf('<switch')
  const lastPicker = wxml.lastIndexOf('<picker')
  check('A4 小程序员工墙:switch/picker 全部在 isOwner 分支里,墙分支零表单元素',
    elseAt > 0 && lastSwitch < elseAt && lastPicker < elseAt && wxml.includes('{{txt.staffTitle}}'))
}

/* ===== 员工号行为面:未设置店员工 auth/me 同样拿到旗标(墙由它驱动) ===== */
{
  const techW = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `墙员${RUN}`, isActive: true }) }, PLATFORM, HU)).data.technician
  const staffMk = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techW.id }) }, PLATFORM, HU)
  const staffPw = staffMk.data?.initialPassword || staffMk.data?.account?.initialPassword
  const staffUser = staffMk.data?.username || staffMk.data?.account?.username
  const lg = staffPw ? (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ username: staffUser, password: staffPw, tenantId: tU }) }, null)).data : null
  if (lg?.auth?.accessToken) {
    const meS = await request('/admin/auth/me', {}, lg.auth.accessToken)
    check('A4 员工号 auth/me:hoursUnset=true + staffTitle 后端句在(墙的数据源)',
      meS.data.hoursUnset === true && meS.data.hoursGateText?.staffTitle === '老板还没设置营业时间')
  } else {
    check('A4 员工号登录夹具建失败(staff-accounts 未回初始密码)—— 不许静默跳过', false, JSON.stringify(staffMk.data).slice(0, 120))
  }
}

/* ===== 裁定2(08-30c)收敛锚点:营业时间表单=一份组件两处挂载,旧编辑器死净 ===== */
{
  const compJs = readFileSync(new URL('../../miniprogram/components/hours-form/index.js', import.meta.url), 'utf8')
  const compWxml = readFileSync(new URL('../../miniprogram/components/hours-form/index.wxml', import.meta.url), 'utf8')
  check('🔴 裁定2:hours-form 组件在(七行 switch+picker+save 事件)',
    compJs.includes("triggerEvent('save'") && compWxml.includes('<switch') && compWxml.includes('<picker'))
  const setupWxml = readFileSync(new URL('../../miniprogram/pages/merchant/hours-setup/index.wxml', import.meta.url), 'utf8')
  const storeWxml = readFileSync(new URL('../../miniprogram/pages/merchant/store/index.wxml', import.meta.url), 'utf8')
  const setupJson = readFileSync(new URL('../../miniprogram/pages/merchant/hours-setup/index.json', import.meta.url), 'utf8')
  const storeJson = readFileSync(new URL('../../miniprogram/pages/merchant/store/index.json', import.meta.url), 'utf8')
  /* 刀3 咬出的判据洞:includes('<hours-form') 连 <hours-formX 都算命中(子串病)—— 改标签边界匹配 */
  const hfTag = /<hours-form[\s/>]/
  check('🔴 裁定2:小程序两处挂载同一组件(强制页+门店设置,usingComponents 同路径)',
    hfTag.test(setupWxml) && hfTag.test(storeWxml)
    && setupJson.includes('/components/hours-form/index') && storeJson.includes('/components/hours-form/index'))
  const storeJs = stripJs(readFileSync(new URL('../../miniprogram/pages/merchant/store/index.js', import.meta.url), 'utf8'))
  check('裁定2:门店设置旧编辑器死净(零 toggleDay/saveHours 旧手柄,零 10:00 前端预填编数)',
    !storeJs.includes('saveHours') && !storeJs.includes("openTime: h.openTime || '10:00'"))
  const webHs = stripJs(readFileSync(new URL('../web/hours-setup.js', import.meta.url), 'utf8'))
  const webAdmin2 = stripJs(readFileSync(new URL('../web/admin.js', import.meta.url), 'utf8'))
  check('🔴 裁定2:网页两处挂载同一渲染出口(daysHtml;门店设置走 HoursSetup.mountSettings)',
    webHs.includes('function daysHtml(') && (webHs.match(/daysHtml\(/g) || []).length >= 3 && webAdmin2.includes('HoursSetup.mountSettings('))
  check('裁定2:网页旧周网格编辑器死净(零 business-hours-grid 模板 / data-hours-closed / saveBusinessHoursSettings)',
    !webAdmin2.includes('business-hours-grid') && !webAdmin2.includes('data-hours-closed') && !webAdmin2.includes('saveBusinessHoursSettings'))
}

console.log(`\n✅ test-hours-gate 通过 ${checks} 项`)
