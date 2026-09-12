#!/usr/bin/env node
/* 配色批备料 · 把一张**本地对照页**在浅/深两档各拍一张(夜9 段6)
 *
 * 为什么不复用 `tools/url-shots.mjs`:那把要求 `SHOT_BASE` 是活着的本机服务(它自带库域闸,
 * 防止误打生产)。这里要拍的是一张 `file://` 的对照页,没有服务、也不该有库域闸。
 * 两件事不同,所以另起一把小的,而不是把那把的安全闸拆松(公约④ 的反面:不能为复用去削护栏)。
 *
 * ⚠️ 这把刀**只拍我自己新做的对照图**,不碰任何合同图(J-41)。
 * 用法:node tools/swatch-shots.mjs <html路径> <出图目录> [文件名前缀]
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const [, , htmlArg, outArg, prefixArg] = process.argv
if (!htmlArg || !outArg) { console.error('用法:node tools/swatch-shots.mjs <html路径> <出图目录> [前缀]'); process.exit(2) }
const HTML = resolve(htmlArg)
if (!existsSync(HTML)) { console.error(`🔴 找不到 ${HTML}`); process.exit(2) }
const OUT = outArg
const PREFIX = prefixArg || '对照图'
mkdirSync(OUT, { recursive: true })
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9377)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = `/private/tmp/ll-swatch-${process.pid}`
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--allow-file-access-from-files',
  '--window-size=1000,900', 'about:blank'], { stdio: 'ignore' })
let code = 0
try {
  let wsUrl = ''
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const p = list.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break }
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let seq = 0; const pending = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  const stamp = (() => { const d = new Date(); const p2 = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}` })()
  const shots = []
  for (const mode of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    await send('Page.navigate', { url: `file://${HTML}` })
    await sleep(1200)
    /* 页面用的是 [data-theme=dark] 选择器,媒体查询顶不到 —— 显式打标,两条路都覆盖 */
    await send('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme', ${JSON.stringify(mode)})` })
    await sleep(400)
    const b64 = (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).result?.data
    if (!b64) { console.error(`🔴 ${mode} 档没截到`); code = 1; continue }
    const f = `${PREFIX}_${mode === 'light' ? '浅档' : '深档'}_${stamp}.png`
    writeFileSync(join(OUT, f), Buffer.from(b64, 'base64'))
    shots.push(join(OUT, f))
    console.log(`[图] ${mode} → ${join(OUT, f)}`)
  }
  /* J-38:图要带拍摄时刻 —— 文件名里就有 ${stamp} */
  console.log(`\n拍摄时刻 ${stamp} · 共 ${shots.length} 张`)
  if (shots.length !== 2) code = 1
  ws.close()
} finally { chrome.kill() }
process.exit(code)
