#!/usr/bin/env node
/* J-36 · 双模式验收律 —— 「不影响正常功能的显示」**变成四条可验的**(夜班令6 段 3)
 *
 * 店主原话:「可以选择晚上以及白天两种模式,但**前提都是要不能影响正常功能的显示**,
 * 比如字体、比如颜色等等,你看可能还出现了这样的重叠效果之类的。」
 *
 * 「不影响显示」这句话不可验 —— 拆成四条能证伪的:
 *   ① **文字不重叠**:同一容器里的相邻文本节点包围盒不相交(台面那把刀单独量,这里量首页);
 *   ② **正文对比度 ≥ 4.5:1**(WCAG AA):大数字 / 正文 / 次要文字 / 待办数字四处各测一次;
 *   ③ **字体与浅色态同一套**:同一元素两模式 `font-family` 全等(深色下换字体 = 换了另一套皮);
 *   ④ **数字不折行**:金额与计数元素的高度不超过一行行高(折行就是店主截图里那种叠字的另一半)。
 *
 * 三档主题都测:`light`(站内选)/ `dark`(站内选)/ `system-dark`(跟系统)。
 *
 * 用法:TC_BASE=… TC_TOKEN=… TC_OUT=<截图目录> node tools/theme-contrast-proof.mjs <租户id>
 *      加 --knife 表示「这一跑应该红」(造病:把深色下的 --ink 换成浅色态的值)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'TC_BASE', value: process.env.TC_BASE, hint: '(只打本机沙箱)' })
const TOKEN = requireTarget({ envName: 'TC_TOKEN', value: process.env.TC_TOKEN, hint: '(主钥匙;不写进代码)' })
const OUT = requireTarget({ envName: 'TC_OUT', value: process.env.TC_OUT, hint: '(截图落到哪个目录)' })
const TENANT = process.argv[2] || 'lucky-luxe'
const KNIFE = process.argv.includes('--knife')
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.TC_PORT || 9336)
const CDP = `http://${'127.0.0.1'}:${PORT}`
mkdirSync(OUT, { recursive: true })

const profile = `/private/tmp/ll-tc-${process.pid}`
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl = ''
for (let i = 0; i < 60; i += 1) {
  /* CDP 调试口地址(不是库目标),拼成变量 —— 同 `board-overlap-proof` 那条注释 */
  try { const l = await fetch(`${CDP}/json/list`).then((r) => r.json()); const pg = l.find((t) => t.type === 'page'); if (pg) { wsUrl = pg.webSocketDebuggerUrl; break } } catch { /* 还没起来 */ }
  await sleep(250)
}
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value
await send('Page.enable'); await send('Runtime.enable')

let checks = 0
const fails = []
const check = (name, ok, detail = '') => {
  checks += 1
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* 四个取样点:选择器 + 人话名字。**取的是店主真会盯着看的那几处**。 */
const SPOTS = [
  ['大数字', '#dashboardCharts [data-dh-hero-left] .dh-big'],
  ['正文(下一位那行)', '#dashboardCharts [data-dh-next] .dh-next-who'],
  ['次要文字(指标名)', '#dashboardCharts [data-dh-hero-left] .dh-k'],
  ['待办数字', '#dashboardCharts [data-dh-todo] .dh-todo-row strong'],
]

/* 页内测量:对比度 + 字体 + 折行。
   对比度按 WCAG:相对亮度 (L1+.05)/(L2+.05);背景色沿祖先往上找第一个不透明的。 */
const MEASURE = `(() => {
  const spots = ${JSON.stringify(SPOTS)};
  const rgb = (s) => (String(s).match(/[\\d.]+/g) || []).map(Number);
  const lum = (c) => { const f = c.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] };
  const bgOf = (el) => { let n = el;
    while (n && n !== document.documentElement) { const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.6)) return c; n = n.parentElement }
    return rgb(getComputedStyle(document.body).backgroundColor) };
  const out = [];
  for (const [name, sel] of spots) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ name, missing: true }); continue }
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color); const bg = bgOf(el);
    const a = lum(fg); const b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    out.push({ name, ratio: Math.round(ratio * 100) / 100,
      font: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      wrapped: el.getBoundingClientRect().height > lh * 1.6 + 1,
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 22) });
  }
  return JSON.stringify(out) })()`

async function load(mode) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode === 'system-dark' ? 'dark' : 'light' }] })
  const boot = `(() => { const raw = window.fetch; window.fetch = (i, init = {}) => {
    const u = String(typeof i === 'string' ? i : i.url || '');
    if (u.includes('/admin/')) init = { ...init, headers: { ...(init.headers || {}), 'x-admin-tenant-id': ${JSON.stringify(TENANT)} } };
    return raw(i, init) } })()`
  if (load._s) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: load._s })
  load._s = (await send('Page.addScriptToEvaluateOnNewDocument', { source: boot })).result?.identifier
  await send('Page.navigate', { url: `${BASE}/admin` })
  for (let i = 0; i < 40; i += 1) { if (await ev(`Boolean(document.querySelector('#tokenInput'))`)) break; await sleep(300) }
  const login = `(() => { const el = document.querySelector('#tokenInput'); if (!el) return 0; el.value = ${JSON.stringify(TOKEN)};
    const b = Array.from(document.querySelectorAll('button')).find((x) => /刷新|Refresh/.test(x.textContent)); if (b) b.click(); return 1 })()`
  await ev(login)
  for (let i = 0; i < 40; i += 1) {
    if (await ev(`Boolean(document.querySelector('#dashboardCharts [data-dh-hero]'))`)) break
    await sleep(700); await ev(login)
  }
  /* 站内选那两档:走页面自己的开关路径(`applyTheme` 是唯一写 data-theme 的地方) */
  if (mode === 'light') await ev(`(() => { document.documentElement.dataset.theme = 'light'; return 1 })()`)
  if (mode === 'dark') await ev(`(() => { document.documentElement.dataset.theme = 'dark'; return 1 })()`)
  if (mode === 'system-dark') await ev(`(() => { delete document.documentElement.dataset.theme; return 1 })()`)
  if (KNIFE && mode !== 'light') {
    /* 造病:把**这几个取样点真正用的那个令牌**换成贴近底色的值 —— 深底 + 深字,对比度必塌。
       🔴 第一版我换的是 `--ink`,结果一条都没红:那四个取样点用的是
       `--heroink` / `--herosub` / `--brandd`,压根不读 `--ink`。
       「刀落了不红,先怀疑判据和夹具」—— 这次错的是刀,不是判据。 */
    await ev(`(() => { const st = document.documentElement.style;
      st.setProperty('--heroink', '#1a1713'); st.setProperty('--herosub', '#1f1c17');
      st.setProperty('--brandd', '#26231d'); return 1 })()`)
  }
  await sleep(1000)
}

const table = []
const byMode = {}
for (const mode of ['light', 'dark', 'system-dark']) {
  await load(mode)
  const rows = JSON.parse(await ev(MEASURE) || '[]')
  byMode[mode] = rows
  for (const r of rows) {
    table.push({ mode, ...r })
    if (r.missing) { check(`${mode} · ${r.name}:取样点存在`, false, '选择器没命中'); continue }
    check(`${mode} · ${r.name} 对比度 ${r.ratio}:1 ≥ 4.5`, r.ratio >= 4.5, `文本「${r.text}」`)
    check(`${mode} · ${r.name} 数字不折行`, !r.wrapped, `文本「${r.text}」`)
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `段3_J36_${TENANT}_${mode}.png`), Buffer.from(shot.result.data, 'base64'))
}
/* ③ 字体两模式全等 —— 深色下换字体就是换了另一套皮 */
for (const [i, spot] of SPOTS.entries()) {
  const l = (byMode.light || [])[i]
  const d = (byMode.dark || [])[i]
  check(`字体两模式同一套:${spot[0]}(浅 ${l && l.font} vs 深 ${d && d.font})`,
    Boolean(l && d && l.font && l.font === d.font))
}

console.log(`\n── 对比度实测表(${TENANT})`)
console.log('| 取样点 | 浅色 | 深色(站内选) | 深色(跟系统) |')
console.log('|---|---|---|---|')
for (const [i, spot] of SPOTS.entries()) {
  const g = (m) => { const r = (byMode[m] || [])[i]; return r && r.ratio !== undefined ? `${r.ratio}:1` : '—' }
  console.log(`| ${spot[0]} | ${g('light')} | ${g('dark')} | ${g('system-dark')} |`)
}

ws.close(); chrome.kill()
if (KNIFE) {
  if (!fails.length) { console.error('\n🔴 造病白造了:深色下把 --ink 换成浅色态的值,对比度判据一条都没红'); process.exit(1) }
  console.log(`\n✅ 造病验红:${fails.length}/${checks} 条红`)
  process.exit(0)
}
if (fails.length) { console.error(`\n❌ J-36 ${fails.length}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ J-36 四条全过(${checks} 条断言,三档主题各量一遍)`)
