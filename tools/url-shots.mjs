#!/usr/bin/env node
/* 任意 URL 的两档截图刀(06g §四① 要「platform / sign 两页接令牌前后各出两档图」)
 *
 * 为什么不复用 `web-page-shots.mjs`:那把刀是**后台专用**的 —— 它先登录、再点侧栏某一项,
 * 页表写死在里面。平台控制台(`/platform.html`)与顾客签单页(`/sign.html`)不在那张表里,
 * 也不走后台的登录态。硬塞进去等于把一把专用刀改成杂物抽屉,所以另起一把小的。
 *
 * 做的事只有三件:①`Emulation.setEmulatedMedia` 换 `prefers-color-scheme` ②等页面真出了内容
 * ③`Page.captureScreenshot` 落盘,**文件名带拍摄时刻**(J-38 要按文件名判新旧,不靠 mtime)。
 *
 * 用法:SHOT_BASE=http://127.0.0.1:4310 SHOT_OUT=<目录> node tools/url-shots.mjs \
 *          --shot 名字:/platform.html [--shot 名字:/sign.html?code=xxx] [--wait 2500]
 *
 * ⚠️ 只打本机沙箱;不带任何凭证(这两页要么自己有登录门、要么靠 URL 里的单号)。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const OUT = requireTarget({ envName: 'SHOT_OUT', value: process.env.SHOT_OUT, hint: '(截图落到哪个目录)' })
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9341)
const WAIT = Number((process.argv.find((a, i, arr) => arr[i - 1] === '--wait')) || 2600)

const shots = process.argv.reduce((acc, a, i, arr) => (a === '--shot' ? [...acc, arr[i + 1]] : acc), [])
if (!shots.length) { console.error('至少给一个 --shot 名字:/路径'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const profile = `/private/tmp/ll-us-profile-${process.pid}`
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' })
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

const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const stamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-`
  + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`

const rows = []
for (const one of shots) {
  const idx = one.indexOf(':')
  const name = one.slice(0, idx)
  const path = one.slice(idx + 1)
  for (const mode of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    await send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(WAIT)
    /* 「拍到了东西」也要断言:一张空白页不算图(J-37「在不在 ≠ 看得见」的同族) */
    const textLen = await ev('(document.body && document.body.innerText || "").trim().length')
    const now = new Date()
    const file = `${name}_${mode}_${stamp(now)}.png`
    const b64 = (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).result?.data
    if (!b64 || !(textLen > 20)) { console.log(`not ok - ${name}/${mode} 没拍到内容(正文 ${textLen} 字)`); continue }
    writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'))
    rows.push({ file, name, mode, at: now.toISOString(), textLen })
    console.log(`ok - ${name} · ${mode} → ${file}(拍于 ${now.toISOString()} · 正文 ${textLen} 字 · HEAD ${head})`)
  }
}
ws.close(); chrome.kill()

const md = ['# 对照说明(url-shots)', '', `> HEAD \`${head}\` · 跑于 ${new Date().toISOString()}`, '',
  '| 图 | 页 | 档 | 拍摄时刻 | 正文字数 |', '|---|---|---|---|---|']
for (const r of rows) md.push(`| \`${r.file}\` | ${r.name} | ${r.mode} | ${r.at} | ${r.textLen} |`)
writeFileSync(join(OUT, '对照说明.md'), md.join('\n'), 'utf8')
console.log(`\n共 ${rows.length} 张 → ${OUT}`)
process.exit(rows.length === shots.length * 2 ? 0 : 1)
