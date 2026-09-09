#!/usr/bin/env node
/* 网页后台**逐页 × 两档**截图(店主 05z §四 要的那五页;J-38:每张图带拍摄时刻)
 *
 * J-38(店主 05y §二 立):**图要带拍摄时刻,不许拿修前的图给修后的结论作证。**
 * 所以这把刀做两件事:
 *   ① 文件名里就带时刻(`YYYYMMDD-HHMMSS`),不用去翻文件属性;
 *   ② 同时落一份 `对照说明.md`,把「图名 · 拍摄时刻 · 页面 · 档位 · 当时的 HEAD 提交」写在一起。
 * 回执生成时由 `tools/shot-freshness.mjs` 机械比一次:**图早于它作证的那段提交就红**。
 *
 * 用法:SHOT_BASE=... SHOT_TOKEN=... SHOT_OUT=<目录> node tools/web-page-shots.mjs [页key,...]
 */
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'SHOT_TOKEN', value: process.env.SHOT_TOKEN, hint: '(开发主钥匙;不写进代码)' })
const OUT = requireTarget({ envName: 'SHOT_OUT', value: process.env.SHOT_OUT, hint: '(截图落到哪个目录)' })
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9337)
const PAGES = (process.argv[2] || 'finance,bookings,customers,schedule,pricing').split(',').map((x) => x.trim()).filter(Boolean)

mkdirSync(OUT, { recursive: true })
const profile = `/private/tmp/ll-ps-profile-${process.pid}`
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
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(`页内报错:${r.result.exceptionDetails.text}`)
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable')

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
if (!(await ev(LOGGED_IN))) { console.error('🔴 登不进后台 —— 一张图都没拍,不许拿这一跑下结论'); ws.close(); chrome.kill(); process.exit(2) }

const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const stamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-`
  + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
const rows = []
for (const key of PAGES) {
  for (const mode of ['light', 'dark']) {
    await ev(`(() => { if (window.ThemeSwitch) window.ThemeSwitch.applyTheme('${mode}'); return 1 })()`)
    const name = await ev(`(() => { const b = document.querySelector('[data-admin-page="${key}"]'); if (!b) return ''
      b.click(); return (b.textContent || '').trim() })()`)
    if (!name) { console.log(`not ok - 找不到侧栏项 ${key}`); continue }
    await sleep(1600)
    const now = new Date()
    const file = `${key}_${mode}_${stamp(now)}.png`
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const b64 = shot.result?.data
    if (!b64) { console.log(`not ok - ${key}/${mode} 没拍到`); continue }
    writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'))
    rows.push({ file, page: name, key, mode, at: now.toISOString(), head })
    console.log(`ok - ${name} · ${mode} → ${file}(拍于 ${now.toISOString()} · HEAD ${head})`)
  }
}
const md = ['# 网页后台 五页 × 两档 截图对照说明', '',
  `> **每一张都带拍摄时刻(J-38)** —— 图早于它作证的那段提交就是过期证据,回执生成时机械比一次。`,
  `> 拍摄时 HEAD = \`${head}\` · 跑在 \`${BASE}\``, '',
  '| 图 | 页面 | 档位 | 拍摄时刻(ISO) | 当时 HEAD |', '|---|---|---|---|---|']
for (const r of rows) md.push(`| \`${r.file}\` | ${r.page} | ${r.mode} | ${r.at} | \`${r.head}\` |`)
writeFileSync(join(OUT, '对照说明.md'), md.join('\n'), 'utf8')
console.log(`\n共 ${rows.length} 张 → ${OUT}(对照说明.md 已写)`)
ws.close(); chrome.kill()
process.exit(rows.length === PAGES.length * 2 ? 0 : 1)
