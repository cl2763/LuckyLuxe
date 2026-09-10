#!/usr/bin/env node
/* D188 ③ · **运行判据**:每页首屏现取令牌,空的当场红并点名是哪一页(店主 06b §三)
 *
 * 为什么要有这一层(静态判据不够):静态只能看见「文件里写没写那一行 `<link>`」。
 * 路径写错、文件 404、被别的 `:root` 盖掉、缓存发了旧的 —— 这四种情况文件里那一行**都在**,
 * 而浏览器里 `var()` 照样是空的。05z 那次整页塌掉,如果只有静态判据,一样抓不到。
 * 所以这一层问的是**结果**:`getComputedStyle(document.documentElement).getPropertyValue('--paper')`
 * 现取,不许为空;并且 body 的实际底色不许是透明(那正是当时塌掉的样子)。
 *
 * 六页 × 两档都过一遍。任何一页取不到内容 = **没验成**,按红处理,不静默跳过。
 *
 * 用法:SHOT_BASE=http://127.0.0.1:4310 node tools/token-runtime-probe.mjs
 *   TRP_OUT=<路径>   报告落盘(带界面文件内容指纹,给预检判「样式改过没重跑」)
 *   TRP_SIGN=<单号>  签单页要一个真单号才有内容(不给就跳过那一页并**报红**)
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const OUT = process.env.TRP_OUT || ''
const SIGN = process.env.TRP_SIGN || ''
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9349)

const KNIFE_REV = (() => {
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', 'tools/token-runtime-probe.mjs'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'tools/token-runtime-probe.mjs'], { encoding: 'utf8' }).trim()
    return `${sha || '(未提交)'}${dirty ? '+dirty' : ''}`
  } catch { return '(取不到)' }
})()
/* 界面文件内容指纹 —— 和对比度红榜同一个做法:样式改过而这份报告没重跑,预检当场红 */
const FACE = ['apps/web/design-tokens.css', 'apps/web/styles.css', 'apps/web/admin.html',
  'apps/web/index.html', 'apps/web/platform.html', 'apps/web/sign.html',
  'apps/web/share.html', 'apps/web/wechat-simulator.html']
const FINGER = (() => {
  const h = createHash('sha256')
  for (const f of FACE) { try { h.update(readFileSync(f)) } catch { h.update('(缺)') } }
  return h.digest('hex').slice(0, 12)
})()

const PAGES = [
  ['顾客端首页', '/'],
  ['商家后台', '/admin'],
  ['平台控制台', '/platform'],
  ['分享页', '/share'],
  ['微信模拟器', '/wechat-simulator'],
  ['顾客签单页', SIGN ? `/sign/${SIGN}` : ''],
]

const profile = `/private/tmp/ll-trp-profile-${process.pid}`
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
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
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.result?.value
await send('Page.enable'); await send('Runtime.enable')

/* ⚠️ 整段住在模板串里 —— 一个反引号都不许有 */
const READ = `(() => {
  const cs = getComputedStyle(document.documentElement)
  const tok = (n) => String(cs.getPropertyValue(n) || '').trim()
  const bodyBg = getComputedStyle(document.body).backgroundColor
  return { paper: tok('--paper'), ink: tok('--ink'), brand: tok('--brand'), hero: tok('--hero'),
    bodyBg: bodyBg, textLen: (document.body.innerText || '').trim().length,
    linked: Array.from(document.styleSheets).map((s) => { try { return s.href || '(inline)' } catch { return '(cors)' } })
      .filter((h) => /design-tokens/.test(String(h))).length }
})()`

const rows = []
const bad = []
for (const [name, path] of PAGES) {
  if (!path) { bad.push(`${name}:没给单号(TRP_SIGN),**这一页没验成**,不是绿`); continue }
  for (const mode of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    await send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(2200)
    /* 现测偶发:第一次 evaluate 回 undefined(页面还没交出 document.body)。
       **重试是重量一次,不是放宽** —— 三次都取不到仍然按「没验成」报红,绝不静默当绿。 */
    let r = await ev(READ)
    for (let t = 0; t < 3 && !r; t += 1) { await sleep(1200); r = await ev(READ) }
    if (!r) { bad.push(`${name} · ${mode}:连取三次都什么都取不到,**没验成**(不是绿)`); continue }
    const empty = ['paper', 'ink', 'brand', 'hero'].filter((k) => !r[k])
    const transparent = /rgba\([^)]*,\s*0\s*\)|transparent/i.test(String(r.bodyBg || ''))
    const ok = empty.length === 0 && !transparent && r.textLen > 10
    rows.push({ name, path, mode, ...r, empty, transparent, ok })
    if (!ok) {
      bad.push(`${name} · ${mode}:${empty.length ? `令牌取空 ${empty.join('/')}` : ''}`
        + `${transparent ? ' body 底色是透明的(整页塌掉那个样子)' : ''}`
        + `${r.textLen <= 10 ? ` 正文只有 ${r.textLen} 字` : ''}`)
    }
    console.log(`   [取] ${name} · ${mode} —— --paper=${r.paper || '(空)'} · body底=${r.bodyBg} · 令牌样式表 ${r.linked} 张 · 正文 ${r.textLen} 字`)
  }
}
ws.close(); chrome.kill()

console.log(`\n[D188 运行判据] 刀 ${KNIFE_REV} · 界面指纹 ${FINGER}`)
console.log(`  过了 ${rows.filter((r) => r.ok).length} / 量到 ${rows.length} 组(页 × 档)· 没过/没验成 ${bad.length} 条`)
for (const b of bad) console.log(`  🔴 ${b}`)

if (OUT) {
  const lines = ['# D188 运行判据 —— 每页首屏现取令牌', '',
    `> 跑于 ${new Date().toISOString()} · 跑在 \`${BASE}\``,
    `> 🔴 **产出这份数的刀:\`tools/token-runtime-probe.mjs\` @ ${KNIFE_REV}**(J-39)`,
    `> **界面文件内容指纹 \`${FINGER}\`**(八个 html/css 的 sha256 前 12 位;样式改过而这份没重跑,预检当场红)`, '',
    `**过 ${rows.filter((r) => r.ok).length} / ${rows.length} 组 · 没过或没验成 ${bad.length} 条**`, '',
    '| 页 | 档 | --paper | --brand | body 实际底色 | 令牌样式表 | 正文字数 | 结论 |', '|---|---|---|---|---|---|---|---|']
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.mode} | \`${r.paper || '(空)'}\` | \`${r.brand || '(空)'}\` | \`${r.bodyBg}\` | ${r.linked} | ${r.textLen} | ${r.ok ? '✅' : '🔴'} |`)
  }
  if (bad.length) { lines.push('', '## 没过 / 没验成(不是绿)', ''); for (const b of bad) lines.push(`- ${b}`) }
  mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log(`  [报告] → ${OUT}`)
}
if (!rows.length) { console.error('\n❌ 一组都没量到 —— 这一跑什么都没证明'); process.exit(2) }
if (bad.length) { console.error(`\n❌ ${bad.length} 条没过/没验成`); process.exit(1) }
console.log(`\n✅ ${rows.length} 组全过:六页两档,令牌都取得到,body 底色都不是透明`)
