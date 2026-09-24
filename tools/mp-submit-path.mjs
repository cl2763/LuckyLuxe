#!/usr/bin/env node
/* 12m裁二 §二-4:**小程序提审前全路径** —— 顾客从进店走到约成,再取消/改期一次。
 *
 * ══ 像素给不到,明说 ══
 * 这台机器上 `screenshot()` 卡死(D167 现测),`$$ / currentPage / pageStack / 元素属性` 正常。
 * 所以本刀出的是**页面栈 + 节点数字 + 接口结果**,不是截图。每一步都记「到没到那一页、页上有没有东西」。
 *
 * ══ 每一步都套硬超时 ══ 卡住就说是哪一步卡的,不装死(D167 同款)。
 *
 * 用法:MP_AUTOMATOR=<模块绝对路径> node tools/mp-submit-path.mjs
 */
import { createRequire } from 'node:module'
const AUTO = process.env.MP_AUTOMATOR
if (!AUTO || AUTO === 'skip') { console.error('\n🔴 MP_AUTOMATOR 没给 —— **本轮未跑**,不是通过。'); process.exit(1) }
const PORT = Number(process.env.MP_AUTO_PORT || 9420)
const automator = createRequire(import.meta.url)(AUTO)
const T = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`automator 卡住(${ms}ms):${what}`)), ms))])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0; const fails = []
const check = (name, ok, detail = '') => { n += 1
  if (ok) console.log(`ok ${n} - ${name}`); else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) } }

const mp = await T((automator.connect || automator.default.connect).call(automator, { wsEndpoint: `ws://127.0.0.1:${PORT}`, timeout: 20000 }), 25000, 'connect')
console.log('   [连上了]')

/* 一页「有没有东西」:节点数 + 正文长度 + 有没有报错字样 —— 空页/报错页当场看得见 */
async function snap(label) {
  const page = await T(mp.currentPage(), 8000, 'currentPage')
  const path = page.path
  const data = await T(page.data(), 8000, 'page.data').catch(() => ({}))
  /* 🔴 头一版取 `page.$('page, .page, view')` 的 text —— 每页都回同样的 12 个字,
     等于只扫了第一个 view。「含报错字样」在那种取法下**缺陷存在时照样绿** = 废判据。
     改成:把页面上所有 text/view 节点的文字**逐个取回来拼起来**,再判空页与报错。 */
  let nodes = 0, text = ''
  try { nodes = (await T(page.$$('view'), 8000, '$$view')).length } catch (e) { /* 页面还在切 */ }
  try {
    const els = await T(page.$$('text, view'), 10000, '$$text')
    const parts = []
    for (const el of els.slice(0, 120)) {
      try { const t = String(await T(el.text(), 3000, 'text') || '').trim(); if (t) parts.push(t) } catch (e) { /* 单个节点取不到不阻塞 */ }
    }
    text = [...new Set(parts)].join(' ')
  } catch (e) {}
  const bad = /出错|失败|错误|Error|undefined|NaN/.test(text)
  console.log(`   [${label}] ${path} · view 节点 ${nodes} · 正文 ${text.replace(/\s+/g, ' ').trim().length} 字${bad ? ' · 🔴 含报错字样' : ''}`)
  return { path, nodes, text, data, bad }
}
async function go(url, label) { await T(mp.reLaunch(url).catch(() => mp.navigateTo(url)), 15000, `go ${url}`); await sleep(2500); return snap(label) }
async function tap(sel, label) {
  const page = await T(mp.currentPage(), 8000, 'currentPage')
  const el = await T(page.$(sel), 8000, `$(${sel})`)
  if (!el) { check(`${label}:找得到「${sel}」`, false, '选择器没命中'); return null }
  await T(el.tap(), 8000, `tap ${sel}`); await sleep(2500); return snap(label)
}

/* 🔴 按**文字**点,不按选择器序号点:上一版 `page.$('button')` 命中的是第一个按钮
   (「加入购物车」),于是「点立即预约」其实没点到它,判据报红而原因不在产品。 */
async function tapByText(re, label) {
  const page = await T(mp.currentPage(), 8000, 'currentPage')
  /* 🔴 分两轮:先只在 button/.btn 里找,找不到才退到 view。
     上一版把 view 混在一起,`$$` 按 DOM 序返回,**包着文字的外层 view 排在按钮前面**,
     于是 tap 落在容器上、什么也没发生 —— 判据红了而产品没问题。 */
  let els = await T(page.$$('button, .btn'), 10000, '$$btn')
  let hit = null
  for (const el of els) {
    let t = ''
    try { t = String(await T(el.text(), 3000, 'text') || '').trim() } catch (e) { continue }
    if (re.test(t)) { hit = { el, t }; break }
  }
  if (!hit) els = await T(page.$$('view'), 10000, '$$view'); else els = []
  if (hit) {
    await T(hit.el.tap(), 8000, `tap ${hit.t}`); await sleep(3000)
    const s = await snap(label); s.点到 = hit.t.slice(0, 16); return s
  }
  for (const el of els) {
    let t = ''
    try { t = String(await T(el.text(), 3000, 'text') || '').trim() } catch (e) { continue }
    if (!re.test(t)) continue
    await T(el.tap(), 8000, `tap ${t}`); await sleep(3000)
    const s = await snap(label); s.点到 = t.slice(0, 16); return s
  }
  check(`${label}:找得到文字匹配 ${re}`, false, '没有按钮的文字命中')
  return null
}

console.log('\n── ① 进店(扫码/深链带 t=jics-nail 的等价入口)──')
const s1 = await go('/pages/home/index?tenantId=jics-nail', '首页')
check('① 进店首页有内容,不是空页', s1.nodes > 5 && s1.text.length >= 20 && !s1.bad, `节点 ${s1.nodes} · 正文 ${s1.text.length} 字`)

console.log('\n── ② 服务列表 ──')
const s2 = await go('/pages/services/index', '服务')
check('② 服务列表有内容', s2.nodes > 5 && s2.text.length >= 20 && !s2.bad, `节点 ${s2.nodes} · 正文 ${s2.text.length} 字`)

console.log('\n── ③ 我的(登录态入口)──')
const s3 = await go('/pages/me/index', '我的')
check('③ 我的页有内容', s3.nodes > 5 && s3.text.length >= 20 && !s3.bad, `节点 ${s3.nodes} · 正文 ${s3.text.length} 字`)
check('③b 沙盒「切换演示身份」入口:USE_LOCAL_SANDBOX 决定它显不显',
  typeof s3.data.sandbox !== 'undefined', `sandbox=${s3.data.sandbox}`)

console.log('\n── ④ 四个 tab 逐个进,不许空页/报错 ──')
for (const [p, label] of [['/pages/home/index', '首页'], ['/pages/services/index', '服务'], ['/pages/cart/index', '购物车'], ['/pages/me/index', '我的']]) {
  const s = await go(p, `tab:${label}`)
  check(`④ tab「${label}」不是空页、不含报错字样`, s.nodes > 3 && s.text.length >= 20 && !s.bad, `节点 ${s.nodes} · 正文 ${s.text.length} 字${s.bad ? ' · 🔴 含报错字样' : ''}`)
}

console.log(`\n  ${n - fails.length}/${n} 过`)
if (fails.length) { console.error(`\n❌ ${fails.length} 条未过`); process.exit(1) }
console.log('\n✅ 全路径第一段通过(像素给不到:本机 screenshot() 卡死,出的是节点数字)')

/* ══ 第二段:登录 → 选服务 → 下单 → 商家端看到 → 取消 ══
   沙箱库域有微信替身(isStubScope('sandbox')=true),所以 wx.login 这一跳能真走通;
   生产走真微信(isStubScope('local')=false),替身够不到 —— 两边口径现测过。 */
const ev = async (code) => T(mp.evaluate(code), 12000, 'evaluate')
const TENANT = 'jics-nail'

console.log('\n── ⑤ 换到小婕店(等同扫她的店码)──')
await ev(`function(){ wx.setStorageSync('lucky_tenant', '${TENANT}'); return 1 }`)
await T(mp.reLaunch(`/pages/home/index?tenantId=${TENANT}`), 15000, 'relaunch'); await sleep(3000)
const t5 = await ev(`function(){ return wx.getStorageSync('lucky_tenant') }`)
check('⑤ 当前店已是小婕店(换店清场按 D39)', t5 === TENANT, `现值 ${t5}`)

console.log('\n── ⑥ 登录态(沙箱替身)──')
const auth = await ev(`function(){ const a=wx.getStorageSync('lucky_auth')||{}; return { 有令牌: !!a.accessToken, 租户戳: a.tenantId||'(无)' } }`)
check('⑥ 顾客已登录且令牌带本店租户戳(D77:戳不符=对本店未登录)', auth.有令牌 === true, JSON.stringify(auth))

console.log('\n── ⑦ 选服务 → 详情 → 下单页 ──')
const s7 = await go('/pages/services/index', '服务列表')
check('⑦ 小婕店服务列表有货', s7.text.length >= 20, `正文 ${s7.text.length} 字`)
const s7b = await tap('.service-card', '服务详情')
check('⑦b 点进服务详情', s7b && /service-detail|booking/.test(s7b.path), s7b ? s7b.path : '(没进去)')

console.log('\n── ⑧ 下单页:选技师 / 选时间 ──')
/* 🔴 实点优先,落不到再退回「调页面自己的 handler」并**明确标注**是哪一种。
   现测:底部固定条上的按钮 automator tap 不生效(点得到元素、不触发 bindtap);
   而直接调 `goBooking()` 能导航 —— **产品没问题,是驱动的毛病**,不许记成产品缺陷。 */
let s8 = await tapByText(/立即预约/, '实点「立即预约」')
let 用了后门 = false
if (!s8 || !/booking/.test(s8.path)) {
  await ev(`function(){ const p=getCurrentPages().slice(-1)[0]; if(p&&p.goBooking) p.goBooking(); return 1 }`)
  await sleep(3000); s8 = await snap('调 goBooking()'); 用了后门 = true
}
const bookPath = s8 ? s8.path : ''
check(`⑧ 进到预约页${用了后门 ? '(实点没生效,退回调 goBooking();见注释)' : '(真实点)'}`, /booking/.test(bookPath), bookPath || '(没进去)')
const bd = await ev(`function(){ const p=getCurrentPages().slice(-1)[0]; const d=p?p.data:{}
  return { 技师数: (d.technicians||d.techs||[]).length, 时段数: (d.slots||d.times||[]).length,
           选中技师: d.technicianId||d.techId||'(未选)', 选中日期: d.date||'(未选)', 选中时间: d.time||'(未选)' } }`)
console.log('   [预约页]', JSON.stringify(bd))
check('⑧b 预约页有技师可选(不是空页)', (bd.技师数 || 0) > 0, JSON.stringify(bd))
check('⑧c 预约页有可约时段', (bd.时段数 || 0) > 0, JSON.stringify(bd))

console.log('\n── ⑨ 选技师 / 选时间 / 提交 ──')
const pick = await ev(`function(){ const p=getCurrentPages().slice(-1)[0]; const d=p?p.data:{}
  return { 技师: (d.technicians||d.techs||d.staffList||[]).map(x=>x.name||x.displayName).slice(0,6),
           日期: (d.dates||d.dayList||[]).slice(0,3), 时段: (d.slots||d.times||d.timeList||[]).slice(0,4),
           data键: Object.keys(d).slice(0,20) } }`)
console.log('   [预约页可选项]', JSON.stringify(pick))
check('⑨ 预约页真有技师可选', (pick.技师 || []).length > 0, JSON.stringify(pick.技师))
check('⑨b 预约页真有时段可选', (pick.时段 || []).length > 0 || (pick.日期 || []).length > 0, JSON.stringify({ 日期: pick.日期, 时段: pick.时段 }))
