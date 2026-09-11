#!/usr/bin/env node
/* 夜8 段1 · **渐变面上的字** —— computed 判不了的那一批,改用取像素判(店主 06a §三 登记的待办)
 *
 * ══ 为什么它一直判不了 ══
 * `contrast-sweep` 取背景的办法是「往上找**实际绘制的那一层**」,拿的是 `backgroundColor`。
 * 碰上 `background-image: linear-gradient(...)` 时,computed 给不出「这一点到底是什么颜色」——
 * 那把刀因此**既不算绿也不算红**,只如实计数(现测:后台 718 个 · 顾客端 74 个 · 占全站 ~14%)。
 * 「全站扫过」这句话里一直有 14% 是空的,而渐变面恰恰是最容易出「浅字压浅底」的地方。
 *
 * ══ 这把刀怎么判 ══
 * 前景色**不用猜** —— computed 的 `color` 就是确定值。要命的只有背景。所以:
 *   ① 整页截两张:**字在**的一张、**把这批字设成透明**的一张(只改颜色,不动布局);
 *   ② 在**同一个页面里**用 canvas 解码(浏览器自己会解 PNG,不用再写一个解码器);
 *   ③ 两张**逐像素做差** —— 差得出来的那些点**就是字身**;它们在「字透明」那张里的颜色,
 *      **就是这个字底下真正的背景**。对这些点取最不利的那一个,与前景算比值。
 *      **取最差不取平均** —— 渐变面上「平均够亮」没有意义,人眼看见的是最糊的那一小段。
 *
 * 🔴 头一版是「框内取最差像素」,现测当场露馅:后台首页那颗按钮量出 1:1 ——
 *    因为框里还有**图标和边框**,颜色跟前景一样,而字并不压在那上面。
 *    「框内最差」把装饰也算成背景,那是**高估到失真**,不是保守。做差之后才对得上「字压在什么上」。
 *
 * ══ 自证(不自证就不许出数)══
 * · 截图必须真的截到;
 * · **一个差异像素都没有 = 「设成透明」没生效,或这行字本来就与底同色** —— 两种都按「没验成」报红;
 * · 一个节点都没量到 = 这一跑什么都没证明,退出码 2。
 *
 * 用法:SHOT_BASE=http://127.0.0.1:4310 SHOT_TOKEN=<开发主钥匙> node tools/gradient-pixel-sweep.mjs
 *   GP_TARGET=admin|customer   扫哪一端(默认 admin)
 *   GP_OUT=<路径>   报告落盘   ·   GP_CAP=<数>   甲档棘轮(给了才判红)
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'SHOT_TOKEN', value: process.env.SHOT_TOKEN, hint: '(开发主钥匙;不写进代码)' })
const TARGET = (process.env.GP_TARGET || 'admin').toLowerCase()
const OUT = process.env.GP_OUT || ''
const CAP = process.env.GP_CAP ? Number(process.env.GP_CAP) : null
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9357)

const rev = (path) => {
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', path], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', path], { encoding: 'utf8' }).trim()
    return `${sha || '(未提交)'}${dirty ? '+dirty' : ''}`
  } catch { return '(取不到)' }
}
const KNIFE_REV = rev('tools/gradient-pixel-sweep.mjs')
const CODE_REV = `apps/web @ ${rev('apps/web')}`
const STYLE_SHA = (() => {
  const h = createHash('sha256')
  for (const f of ['apps/web/styles.css', 'apps/web/admin.html', 'apps/web/admin.js']) {
    try { h.update(readFileSync(f)) } catch { h.update('(缺)') }
  }
  return h.digest('hex').slice(0, 12)
})()

const profile = `/private/tmp/ll-gp-profile-${process.pid}`
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function cdpTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const p = list.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error('Chrome 调试端口没起来')
}
const ws = new WebSocket(await cdpTarget())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Page.enable'); await send('Runtime.enable')

/* ⚠️ 下面几段都住在模板串里 —— **一个反引号都不许有**(这一族的坑本仓踩过六次) */

/* ① 找出「压在渐变面上」的字,给它们打个记号并设成透明;返回每一个的矩形与前景色 */
const MARK = `(() => {
  const parse = (c) => { const m = String(c || '').match(/rgba?\\(([^)]+)\\)/); if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const selOf = (el) => {
    if (el.id) return '#' + el.id
    const cls = (el.className && String(el.className).trim().split(/\\s+/).slice(0, 2).join('.')) || ''
    const path = el.tagName.toLowerCase() + (cls ? '.' + cls : '')
    const p = el.parentElement
    if (!p || p === document.body) return path
    const pcls = (p.className && String(p.className).trim().split(/\\s+/)[0]) || ''
    return (p.id ? '#' + p.id : p.tagName.toLowerCase() + (pcls ? '.' + pcls : '')) + ' > ' + path
  }
  const isGradientBg = (el) => {
    let cur = el
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur)
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && cs.backgroundImage.indexOf('gradient') >= 0) return true
      const c = parse(cs.backgroundColor)
      if (c && c.a >= 0.999) return false
      cur = cur.parentElement
    }
    return false
  }
  const out = []
  let i = 0
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[hidden], .hidden')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    let text = ''
    for (const nd of el.childNodes) if (nd.nodeType === 3) text += nd.textContent
    text = text.replace(/\\s+/g, ' ').trim()
    if (!text) continue
    const fg = parse(cs.color)
    if (!fg || fg.a < 0.1) continue
    if (!isGradientBg(el)) continue
    const size = parseFloat(cs.fontSize) || 14
    const weight = Number(cs.fontWeight) || 400
    el.setAttribute('data-gradprobe', String(i))
    out.push({ id: i, sel: selOf(el), text: text.slice(0, 20), fg: cs.color, size: Math.round(size), weight,
      x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
      w: Math.round(r.width), h: Math.round(r.height) })
    i += 1
  }
  return out
})()`

const HIDE = `(() => { let s = document.getElementById('__gradprobe_css')
  if (!s) { s = document.createElement('style'); s.id = '__gradprobe_css'; document.head.appendChild(s) }
  s.textContent = '[data-gradprobe]{color:transparent !important;text-shadow:none !important}'
  return document.querySelectorAll('[data-gradprobe]').length })()`
const SHOW = `(() => { const s = document.getElementById('__gradprobe_css'); if (s) s.textContent = ''
  return 1 })()`
const CLEAN = `(() => { document.querySelectorAll('[data-gradprobe]').forEach((el) => el.removeAttribute('data-gradprobe'))
  const s = document.getElementById('__gradprobe_css'); if (s) s.remove(); return 1 })()`

/* ② 两张图**做差**找出「字真正盖住的那些像素」,再看那些像素底下是什么颜色
 *
 * 🔴 头一版是「框内取最差像素」——现测立刻露馅:后台首页那颗按钮量出 1:1,
 *    因为框里还有**图标和边框**,它们跟前景同色;可字并不压在那上面。
 *    「框内最差」把**装饰**也算成了背景,那是高估到失真,不是保守。
 * 改法:同一个框截两张(**字在** / **字设成透明**),逐像素做差 ——
 *    差得出来的那些点**就是字身**;它们在「字透明」那张图里的颜色,**就是字底下的背景**。
 *    再对这些点取最不利的那一个。一个差异点都没有 = 「设成透明」那一步没生效,
 *    或者那行字本来就与背景同色 —— 两种都按**没验成**报红,不许当绿。 */
const MEASURE2 = (b64a, b64b, nodes) => `(async () => {
  const lum = (r, g, b) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  const load = async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); return im }
  const ia = await load(${JSON.stringify(b64a)})
  const ib = await load(${JSON.stringify(b64b)})
  const mk = (im) => { const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0); return { cv: cv, cx: cx } }
  const A = mk(ia); const B = mk(ib)
  const nodes = ${JSON.stringify(nodes)}
  const out = []
  for (const nd of nodes) {
    const x = Math.max(0, Math.min(B.cv.width - 1, nd.x))
    const y = Math.max(0, Math.min(B.cv.height - 1, nd.y))
    const w = Math.max(1, Math.min(B.cv.width - x, nd.w))
    const h = Math.max(1, Math.min(B.cv.height - y, nd.h))
    let da = null; let db = null
    try { da = A.cx.getImageData(x, y, w, h).data; db = B.cx.getImageData(x, y, w, h).data }
    catch (e) { out.push({ id: nd.id, err: 'getImageData 失败' }); continue }
    const m = String(nd.fg).match(/rgba?\(([^)]+)\)/)
    const p = m ? m[1].split(',').map((v) => parseFloat(v)) : [0, 0, 0]
    const fl = lum(p[0], p[1], p[2])
    let worst = 99
    let worstPx = null
    let glyph = 0
    for (let i2 = 0; i2 < db.length; i2 += 4) {
      const d = Math.abs(da[i2] - db[i2]) + Math.abs(da[i2 + 1] - db[i2 + 1]) + Math.abs(da[i2 + 2] - db[i2 + 2])
      if (d < 24) continue
      if (db[i2 + 3] < 250) continue
      glyph += 1
      const bl = lum(db[i2], db[i2 + 1], db[i2 + 2])
      const rr = ratio(fl, bl)
      if (rr < worst) { worst = rr; worstPx = [db[i2], db[i2 + 1], db[i2 + 2]] }
    }
    if (!glyph) { out.push({ id: nd.id, err: '两张图在这个框里一个差异像素都没有(要么隐藏没生效,要么这行字本来就与底同色)' }); continue }
    out.push({ id: nd.id, px: glyph, worst: Math.round(worst * 100) / 100, bg: worstPx })
  }
  return { imgW: B.cv.width, imgH: B.cv.height, out: out }
})()`

const LOGGED_IN = `(() => { const s = document.querySelector('#sidebarGeneralSettings'); const t = document.querySelector('#tokenInput')
  return Boolean(s && s.offsetParent !== null) && (!t || t.offsetParent === null) })()`
async function login() {
  await send('Page.navigate', { url: `${BASE}/admin` }); await sleep(1800)
  await ev(`(() => { const el = document.querySelector('#tokenInput'); if (!el) return 0; el.value = ${JSON.stringify(TOKEN)};
    const b = Array.from(document.querySelectorAll('button')).find((x) => /刷新|Refresh/.test(x.textContent)); if (b) b.click(); return 1 })()`)
  for (let i = 0; i < 40; i += 1) { if (await ev(LOGGED_IN)) break; await sleep(500) }
  await sleep(1200)
}

const rows = []
const notes = []
let measured = 0

/* 🔴 整页一张大图行不通:AI 图库那一页有 **28,013 像素高**,255 个节点里 224 个量不出差异 ——
   超长页面的整页截图在两次之间对不齐(懒渲染 / 重排),坐标一偏,差出来的就是别处。
   改成**按一屏一屏来**:滚到某一屏,截两张(字在 / 字透明),只量**落在这一屏里**的节点,
   坐标用**视口坐标**(不加 scrollY)—— 这样两张图永远是同一块地方。
   量不成的照旧记「没验成」,不许当绿。 */
async function sweepHere(pageName, mode) {
  const nodes = await ev(MARK)
  if (!nodes || !nodes.length) { await ev(CLEAN); return 0 }
  const vh = await ev('window.innerHeight') || 900
  const docH = await ev('Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)') || vh
  let ok = 0
  const windows = Math.max(1, Math.ceil(docH / vh))
  for (let k = 0; k < windows; k += 1) {
    const top = k * vh
    const inWin = nodes.filter((n) => n.y + n.h > top + 2 && n.y < top + vh - 2)
    if (!inWin.length) continue
    await ev(`(() => { window.scrollTo(0, ${top}); return 1 })()`)
    await sleep(260)
    /* 🔴 **矩形要在截图那一刻现读**,不能用 MARK 时记下的那一份 ——
       页面会在这中间重排(门店设置那几张卡是拉回订阅数据之后才定位的),
       坐标一旧,差出来的就是别处;现测:那 4 个节点因此「一个差异像素都没有」。
       现在按 data-gradprobe 逐个重新问一次**视口坐标**,顺带把不在屏内的剔掉。 */
    const fresh = await ev(`(() => { const ids = ${JSON.stringify(inWin.map((n) => n.id))}
      const out = []
      for (const id of ids) {
        const el = document.querySelector('[data-gradprobe="' + id + '"]')
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        if (r.bottom <= 0 || r.top >= window.innerHeight) continue
        out.push({ id: id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
      }
      return out })()`) || []
    const byId = new Map(inWin.map((n) => [n.id, n]))
    const local = fresh.map((f) => ({ ...byId.get(f.id), x: f.x, y: f.y, w: f.w, h: f.h }))
    if (!local.length) continue
    const shotA = (await send('Page.captureScreenshot', { format: 'png' })).result?.data
    const hidden = await ev(HIDE)
    await sleep(220)
    const shotB = (await send('Page.captureScreenshot', { format: 'png' })).result?.data
    await ev(SHOW)
    if (!shotA || !shotB || !hidden) { notes.push(`${pageName} · ${mode} · 第 ${k + 1} 屏:截图没成 —— **没验成**`); continue }
    const res = await ev(MEASURE2(shotA, shotB, local))
    if (!res || !res.out) { notes.push(`${pageName} · ${mode} · 第 ${k + 1} 屏:解码没成 —— **没验成**`); continue }
    for (const nd of local) {
      const b = res.out.find((x) => x.id === nd.id)
      if (!b || b.err) { notes.push(`${pageName} · ${mode} · ${nd.sel}「${nd.text}」:${(b && b.err) || '没量到'} —— **没验成**`); continue }
      const large = nd.size >= 24 || (nd.size >= 18.66 && nd.weight >= 700)
      const need = large ? 3 : 4.5
      const hard = large ? 1.6 : 2
      measured += 1
      ok += 1
      if (b.worst + 0.05 < need) {
        rows.push({ page: pageName, mode, sel: nd.sel, text: nd.text, fg: nd.fg,
          bg: `rgb(${(b.bg || []).join(', ')})`, ratio: b.worst, need, px: b.px,
          tier: b.worst + 0.05 < hard ? 'A' : 'B' })
      }
    }
  }
  await ev(CLEAN)
  await ev('(() => { window.scrollTo(0, 0); return 1 })()')
  console.log(`   [取像素] ${mode} · ${pageName} —— 渐变面上的字 ${nodes.length} 个 · 量成 ${ok} 个 · 走了 ${windows} 屏`)
  return nodes.length
}

if (TARGET === 'customer') {
  for (const mode of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    await send('Page.navigate', { url: `${BASE}/?tenant=${process.env.CS_TENANT || 'lucky-luxe'}` })
    await sleep(4200)
    const views = await ev(`Array.from(document.querySelectorAll('[data-view]')).map((b) => b.dataset.view)
      .filter((x, i, a) => x && a.indexOf(x) === i)`)
    for (const v of views || []) {
      await ev(`(() => { const b = document.querySelector('[data-view="${v}"]'); if (b) b.click(); return 1 })()`)
      await sleep(2200)
      await sweepHere(`顾客端·${v}`, mode)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] })
} else {
  await login()
  for (let t = 1; t <= 2 && !(await ev(LOGGED_IN)); t += 1) { console.error(`   [重试 ${t}]`); await login() }
  if (!(await ev(LOGGED_IN))) { console.error('🔴 登不进后台 —— 这一跑什么都没扫'); ws.close(); chrome.kill(); process.exit(2) }
  const pages = await ev(`Array.from(document.querySelectorAll('[data-admin-page]')).map((b) => ({ key: b.dataset.adminPage,
    name: (b.textContent || '').trim().slice(0, 8) })).filter((x, i, a) => x.key && a.findIndex((y) => y.key === x.key) === i)`)
  for (const mode of ['light', 'dark']) {
    await ev(`(() => { if (window.ThemeSwitch) window.ThemeSwitch.applyTheme('${mode}'); return 1 })()`)
    await sleep(900)
    for (const p of pages || []) {
      await ev(`(() => { const b = document.querySelector('[data-admin-page="${p.key}"]'); if (b) b.click(); return 1 })()`)
      await sleep(2400)
      await sweepHere(p.name || p.key, mode)
    }
  }
}
ws.close(); chrome.kill()

const A = rows.filter((r) => r.tier === 'A')
const B = rows.filter((r) => r.tier === 'B')
const keyOf = (r) => `${r.mode}|${r.sel}|${r.fg}|${r.bg}`
const uniq = (arr) => { const m = new Map(); for (const r of arr) if (!m.has(keyOf(r))) m.set(keyOf(r), r); return [...m.values()] }
const uA = uniq(A); const uB = uniq(B)

console.log(`\n[渐变面取像素] 刀 ${KNIFE_REV} · 被测 ${CODE_REV} · 界面指纹 ${STYLE_SHA}`)
console.log(`  量到 ${measured} 个压在渐变面上的字 · 甲档 ${A.length} 条(去重 ${uA.length})· 乙档 ${B.length} 条(去重 ${uB.length})· 没验成 ${notes.length} 条`)
for (const r of uA.slice(0, 12)) console.log(`  🔴甲 ${r.mode} · ${r.page} · ${r.sel}「${r.text}」${r.fg} 压最差像素 ${r.bg} = ${r.ratio}:1(要 ${r.need}:1)`)
for (const x of notes.slice(0, 8)) console.log(`  ⚠️ ${x}`)

if (OUT) {
  const lines = ['# 渐变面上的字 —— 取像素判(computed 判不了的那一批)', '',
    `> 跑于 ${new Date().toISOString()} · 跑在 \`${BASE}\` · 端:${TARGET}`,
    `> 🔴 **产出这份数的刀:\`tools/gradient-pixel-sweep.mjs\` @ ${KNIFE_REV}**(J-39)`,
    `> **被测代码:\`${CODE_REV}\`** · **界面文件内容指纹 \`${STYLE_SHA}\`**`, '',
    '> **判法**:前景色取 computed(那是确定值);背景**把字设成透明后整页截图**,',
    '> 在页面里用 canvas 解码,对每个字的矩形取**最不利的那一个像素**(比值最小的那个)。',
    '> **取最差不取平均** —— 渐变面上「平均够亮」没有意义,人眼看见的是最糊的那一小段。这是保守判法。', '',
    `**量到 ${measured} 个 · 甲档 ${A.length} 条(去重 ${uA.length})· 乙档 ${B.length} 条(去重 ${uB.length})· 没验成 ${notes.length} 条**`, '',
    '| 页 | 档 | 选择器 | 文字 | 前景 | 最差背景像素 | 比值 | 门槛 | 档次 |', '|---|---|---|---|---|---|---|---|---|']
  for (const r of [...uA, ...uB].sort((a, b) => a.ratio - b.ratio)) {
    lines.push(`| ${r.page} | ${r.mode} | \`${r.sel}\` | ${r.text} | ${r.fg} | ${r.bg} | **${r.ratio}** | ${r.need} | ${r.tier === 'A' ? '甲(看不见)' : '乙(AA 欠账)'} |`)
  }
  if (notes.length) { lines.push('', '## 没验成的(不是绿)', ''); for (const x of notes) lines.push(`- ${x}`) }
  mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log(`  [报告] → ${OUT}`)
}
if (!measured) { console.error('\n❌ 一个都没量到 —— 这一跑什么都没证明'); process.exit(2) }
if (CAP !== null && uA.length > CAP) { console.error(`\n❌ 甲档 ${uA.length} 处 > 棘轮 ${CAP}`); process.exit(1) }
console.log(CAP === null ? '\n(没给 GP_CAP:这一跑只报数,不判红)' : `\n✅ 甲档 ${uA.length} 处 ≤ 棘轮 ${CAP}`)
