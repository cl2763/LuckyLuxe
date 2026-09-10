#!/usr/bin/env node
/* J-42「两档同值即漏档」探测器(店主 06g §三 立律)
 *
 * ══ 律的来历 ══
 * 06f 里我用来证明「`--accent` 压根没有深色档」的那条证据是**手工推的**:
 * 红榜里同一个元素在 light 行和 dark 行的比值**一模一样**(2.76 / 2.76)——
 * 颜色若真跟着档位走,两个数不可能分毫不差。店主把这条一次性推理升成了通用律:
 *
 *   **同一元素在浅档与深档量得的对比度完全相等 ⇒ 它用的色值不随档位变 ⇒
 *     要么是有理由的白名单(印刷色、品类色、图片里烧死的色),要么就是漏了深色档。**
 *
 * ══ 为什么另起一把刀,而不是给 contrast-sweep 加开关 ══
 * `contrast-sweep.mjs` 是那把**量乙档的尺子**。J-39 要求新旧数据必须同尺,
 * 一改它的提交号,历史红榜就没法和新红榜并排比了。所以这件事另起一把小刀,尺子不动。
 *
 * ══ 判法 ══
 * 同一页浅深各跑一遍,按「选择器 + 前 20 个字」配对同一个元素,给出三筐:
 *   ① **前景与背景两档完全相同** —— 铁证:这块颜色根本没有深色档;
 *   ② **比值相同但颜色不同** —— 巧合(两档各自换了色却撞出同一个比值),单独列出,人看一眼;
 *   ③ 其余 —— 正常跟档。
 * 本批只要求**报得出名单**,不要求清完(存量走 ⑤d 那把棘轮的节奏)。
 *
 * 用法:SHOT_BASE=http://127.0.0.1:4310 SHOT_TOKEN=<开发主钥匙> node tools/dual-mode-diff.mjs
 *   DM_OUT=<路径>  名单落盘  ·  DM_CAP=<数>  ①筐条数棘轮(给了才判红)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'SHOT_TOKEN', value: process.env.SHOT_TOKEN, hint: '(开发主钥匙;不写进代码)' })
const OUT = process.env.DM_OUT || ''
const CAP = process.env.DM_CAP ? Number(process.env.DM_CAP) : null
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9345)
/* 侧栏真有的那 7 项(现测 `data-admin-page=` 的取值);少一项都要红,不许静默跳过 */
const PAGES = (process.env.DM_PAGES || 'dashboard,bookings,schedule,finance,customers,pricing,membership').split(',')

const KNIFE_REV = (() => {
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', 'tools/dual-mode-diff.mjs'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'tools/dual-mode-diff.mjs'], { encoding: 'utf8' }).trim()
    return `${sha || '(未提交)'}${dirty ? '+dirty' : ''}`
  } catch { return '(取不到)' }
})()
const CODE_REV = (() => {
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', 'apps/web'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'apps/web'], { encoding: 'utf8' }).trim()
    return `apps/web @ ${sha}${dirty ? '+dirty' : ''}`
  } catch { return '(取不到)' }
})()

const profile = `/private/tmp/ll-dm-profile-${process.pid}`
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

/* ⚠️ 下面整段住在模板串里 —— **一个反引号都不许有**(这一族的坑本仓踩过五次) */
const COLLECT = `(() => {
  const parse = (c) => { const m = String(c || '').match(/rgba?\\(([^)]+)\\)/); if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 })
  const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  const bgOf = (el) => {
    const stack = []; let cur = el; let gradient = false
    while (cur && cur !== document.documentElement) {
      const cs2 = getComputedStyle(cur)
      if (!gradient && cs2.backgroundImage && cs2.backgroundImage !== 'none') gradient = true
      const c = parse(cs2.backgroundColor)
      if (c && c.a > 0.001) { stack.push(c); if (c.a >= 0.999) break }
      cur = cur.parentElement
    }
    if (gradient) return null
    let acc = { r: 255, g: 255, b: 255, a: 1 }
    const bodyC = parse(getComputedStyle(document.body).backgroundColor)
    if (bodyC && bodyC.a > 0.5) acc = { r: bodyC.r, g: bodyC.g, b: bodyC.b, a: 1 }
    for (let i = stack.length - 1; i >= 0; i -= 1) acc = over(stack[i], acc)
    return acc
  }
  const selOf = (el) => {
    if (el.id) return '#' + el.id
    const cls = (el.className && String(el.className).trim().split(/\\s+/).slice(0, 2).join('.')) || ''
    const path = el.tagName.toLowerCase() + (cls ? '.' + cls : '')
    const p = el.parentElement
    if (!p || p === document.body) return path
    const pcls = (p.className && String(p.className).trim().split(/\\s+/)[0]) || ''
    return (p.id ? '#' + p.id : p.tagName.toLowerCase() + (pcls ? '.' + pcls : '')) + ' > ' + path
  }
  const out = {}
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[hidden], .hidden')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue
    let text = ''
    for (const nd of el.childNodes) if (nd.nodeType === 3) text += nd.textContent
    text = text.replace(/\\s+/g, ' ').trim(); if (!text) continue
    const fg = parse(cs.color); if (!fg || fg.a < 0.1) continue
    const bg = bgOf(el); if (!bg) continue
    const key = selOf(el) + '|' + text.slice(0, 20)
    if (out[key]) continue
    out[key] = { sel: selOf(el), text: text.slice(0, 20), fg: cs.color,
      bg: 'rgb(' + [bg.r, bg.g, bg.b].map((x) => Math.round(x)).join(', ') + ')',
      ratio: Math.round(ratio(fg, bg) * 100) / 100 }
  }
  return out
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
await login()
for (let t = 1; t <= 2 && !(await ev(LOGGED_IN)); t += 1) { console.error(`   [重试 ${t}]`); await login() }
if (!(await ev(LOGGED_IN))) { console.error('🔴 登不进后台 —— 这一跑什么都没扫,不许下结论'); ws.close(); chrome.kill(); process.exit(2) }

const setTheme = (mode) => ev(`(() => { if (window.ThemeSwitch) window.ThemeSwitch.applyTheme('${mode}')
  return document.documentElement.dataset.theme || '(跟随系统)' })()`)
const goPage = (key) => ev(`(() => { const b = document.querySelector('[data-admin-page="${key}"]'); if (!b) return ''
  b.click(); return b.textContent.trim() })()`)

const missed = []
const sameColor = []
const sameRatioOnly = []
let paired = 0
for (const key of PAGES) {
  const snaps = {}
  for (const mode of ['light', 'dark']) {
    await setTheme(mode)
    const name = await goPage(key)
    if (!name) { missed.push(key); console.log(`   [跳] 找不到侧栏项 ${key} —— **这一页没扫成**(不是绿)`); break }
    await sleep(2200)
    snaps[mode] = await ev(COLLECT) || {}
  }
  if (!snaps.light || !snaps.dark) continue
  let n = 0
  for (const k of Object.keys(snaps.light)) {
    const a = snaps.light[k]; const b = snaps.dark[k]
    if (!b) continue
    paired += 1; n += 1
    if (a.fg === b.fg && a.bg === b.bg) sameColor.push({ page: key, ...a })
    else if (Math.abs(a.ratio - b.ratio) < 0.005) sameRatioOnly.push({ page: key, light: a, dark: b })
  }
  console.log(`   [扫] ${key} —— 两档都量到的元素 ${n} 个 · 累计①${sameColor.length} ②${sameRatioOnly.length}`)
}
ws.close(); chrome.kill()

console.log(`\n[J-42 两档同值] 刀 ${KNIFE_REV} · 被测 ${CODE_REV}`)
console.log(`  配得上对的元素 ${paired} 个`)
console.log(`  ①筐 前景与背景两档**完全相同**(铁证:这块色没有深色档):${sameColor.length} 处`)
console.log(`  ②筐 比值相同但颜色不同(巧合,人看一眼):${sameRatioOnly.length} 处`)
for (const r of sameColor.slice(0, 10)) console.log(`     · ${r.page} ${r.sel}「${r.text}」${r.fg} 压 ${r.bg} = ${r.ratio}:1`)

if (OUT) {
  const lines = ['# J-42「两档同值即漏档」名单', '',
    `> 跑于 ${new Date().toISOString()} · 跑在 \`${BASE}\``,
    `> 🔴 **产出这份数的刀:\`tools/dual-mode-diff.mjs\` @ ${KNIFE_REV}**(J-39)· **被测代码:\`${CODE_REV}\`**`,
    '', '> 判法:同一页浅深各跑一遍,按「选择器 + 前 20 个字」配对同一个元素。',
    '> **①筐**=前景与背景两档逐字节相同(这块色根本不随档位变);**②筐**=比值撞在一起但颜色不同(巧合)。',
    '', `**配得上对的元素 ${paired} 个 · ①筐 ${sameColor.length} 处 · ②筐 ${sameRatioOnly.length} 处**`, '',
    '## ①筐 —— 前景与背景两档完全相同', '', '| 页 | 选择器 | 文字 | 前景 | 背景 | 比值 |', '|---|---|---|---|---|---|']
  for (const r of sameColor) lines.push(`| ${r.page} | \`${r.sel}\` | ${r.text} | ${r.fg} | ${r.bg} | ${r.ratio} |`)
  lines.push('', '## ②筐 —— 比值相同、颜色不同(巧合)', '', '| 页 | 选择器 | 浅档 | 深档 | 比值 |', '|---|---|---|---|---|')
  for (const r of sameRatioOnly) lines.push(`| ${r.page} | \`${r.light.sel}\` | ${r.light.fg} 压 ${r.light.bg} | ${r.dark.fg} 压 ${r.dark.bg} | ${r.light.ratio} |`)
  mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log(`  [名单] → ${OUT}`)
}
/* 一个元素都没配上对 = 这一跑什么都没证明(静默失败器族) */
if (paired === 0) { console.error('\n❌ 两档一个元素都没配上对 —— 这一跑不算数'); process.exit(2) }
/* 覆盖面自证:点名的页必须都进得去。进不去就报红 —— 「少扫了不报」正是静默失败器族。 */
if (missed.length) { console.error(`\n❌ 有 ${missed.length} 页没扫成:${missed.join(' / ')} —— 这一跑不完整`); process.exit(2) }
if (CAP !== null && sameColor.length > CAP) { console.error(`\n❌ ①筐 ${sameColor.length} > 棘轮 ${CAP}(只许降)`); process.exit(1) }
console.log(CAP === null ? '\n(没给 DM_CAP:这一跑只报名单,不判红)' : `\n✅ ①筐 ${sameColor.length} ≤ 棘轮 ${CAP}`)
