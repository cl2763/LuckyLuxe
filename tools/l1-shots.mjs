/* L1 末端验证截图 —— 把欠了三批的那件事收口(店主 11m §三.5 点名)
 *
 * ══ 为什么要这把刀 ══
 * 11j / 11k / 11l 三批我都在证明「代码接上了」:断言绿、接口对、扫描零残留。
 * **但那几处界面到底长什么样,我一次都没打开看过。**
 * L1 末端验证律原话:交付物是界面,最后一步必须在**店主会看到的那一层**截图对照。
 *
 * 用法:SHOT_BASE=http://127.0.0.1:4310 SHOT_TOKEN=<开发主钥匙> node tools/l1-shots.mjs
 * 产出:handoff/shots/*.png + 一行一处的清单 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(沙箱 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'SHOT_TOKEN', value: process.env.SHOT_TOKEN, hint: '(开发主钥匙,启动日志里那一串;不写进代码)' })
const OUT = 'handoff/shots'
mkdirSync(OUT, { recursive: true })
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9337

/* 要截的三处 —— 一条一条对应我欠的那三批
   🔴 **不碰任何密码**:平台页的 `TOKEN` 是模块级变量,后端 `isPlatformKey` 认 `Bearer <开发主钥匙>`,
      所以直接把主钥匙注进去 + 切到控制台;顾客端用 `?store=` 专属链接那条现成的路。
      商家后台要老板密码 —— **密码不许经过我**,所以那一处改用「只读接口 + 页面片段」的方式在回执里交代,
      不硬凑一张截不到的图(J-83:证不出来就说证不出来)。 */
const SHOTS = [
  { file: '11t_北京国贸店_价目页.png', batch: '11t §一',
    url: 'https://app.jingshengyouji.com/?store=luvia-bj',
    what: '北京国贸店导完 28 行之后,顾客端价目页长什么样(境内域,CNY 计价)',
    prep: '', settle: 7000, visible: '.hero, .home, main',
    probe: "document.body.innerText.replace(/\\s+/g,' ').slice(0,300)" },

  { file: '11l_D210_平台新建商家.png', batch: '11l D210',
    url: `${BASE}/platform`,
    what: '新建商家那一屏:币种/时区/电话/地址四个框,币种与时区必选无默认',
    prep: `TOKEN=${JSON.stringify(TOKEN)};document.getElementById('loginWrap').classList.add('hidden');document.getElementById('app').classList.remove('hidden');refreshAll();nav('merchants');`,
    settle: 2600,
    visible: '#mCurrency',
    /* 截完把那一屏的文字抓回来,好让「图上到底有没有那四个框」可以被核,而不是我说了算 */
    probe: "[...document.querySelectorAll('#mCurrency option,#mTz option')].map(o=>o.textContent).join(' | ')" },
  { file: '11j_顾客端门店块.png', batch: '11j',
    url: `${BASE}/?store=jics-nail`,
    what: '顾客端门店信息块:占位值挡住之后长什么样(小婕店有真地址,是正对照)',
    prep: '', settle: 2200, visible: '.hero, .home, main',
    probe: "document.body.innerText.replace(/\\s+/g,' ').slice(0,240)" },
  { file: '11j_顾客端门店块_占位店.png', batch: '11j 反例',
    url: `${BASE}/?store=lucky-luxe`,
    what: '🔴 反例:这家店地址是 Address TBD —— 顾客端应当**什么都不显示**,不是显示那句英文',
    prep: '', settle: 2200, visible: '.hero, .home, main',
    probe: "document.body.innerText.replace(/\\s+/g,' ').slice(0,240)" },
]

const profile = `/private/tmp/ll-l1shot-${process.pid}`
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

await send('Page.enable'); await send('Runtime.enable')
const done = []
const failedShots = []
for (const s of SHOTS) {
  await send('Page.navigate', { url: s.url })
  await sleep(1200)
  /* 🔴 第一版这里是 `prep → Page.reload()` —— 那是给「写 localStorage 再刷新」写的。
     而平台页的 `TOKEN` 是**页内变量**,一刷新就没了,于是图上永远是登录页。
     现在:注入完**不刷新**,直接等它渲染。 */
  if (s.prep) { await send('Runtime.evaluate', { expression: s.prep }); await sleep(s.settle) }
  else await sleep(s.settle)
  /* 🔴 截之前先证「要看的那块真的可见」——
     第一版我用「读得到 option 文字」当证据,而那些 DOM 就藏在 hidden 的 #app 里:
     **读得到 ≠ 看得见**,那是一条假绿。现在按 offsetParent 判可见,判不出来就报红。 */
  if (s.visible) {
    const v = await send('Runtime.evaluate', {
      expression: `(()=>{const e=document.querySelector(${JSON.stringify(s.visible)});return !!(e&&e.offsetParent!==null)})()`,
      returnByValue: true,
    })
    if (v.result?.result?.value !== true) {
      console.error(`  🔴 ${s.file}:要看的那块(${s.visible})**不可见** —— 这张图截了也没用,不写。`)
      failedShots.push(s.file)
      continue
    }
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const buf = Buffer.from(shot.result.data, 'base64')
  writeFileSync(`${OUT}/${s.file}`, buf)
  /* 🔴 截了不等于截对了:把页面上真实的可见文字抓一小段回来,
     好让「这张图上有没有那个东西」这件事可以在回执里被核,而不是我说了算。 */
  const txt = await send('Runtime.evaluate', { expression: s.probe, returnByValue: true })
  done.push({ ...s, bytes: buf.length, text: txt.result?.result?.value || '' })
  console.log(`  ✅ ${s.file}  ${buf.length} 字节`)
  console.log(`     现读:${String(txt.result?.result?.value ?? '(空)').slice(0, 200)}`)
}
ws.close(); chrome.kill()
console.log('')
if (failedShots.length) { console.error(`\n❌ ${failedShots.length} 张没截成(要看的那块不可见):${failedShots.join(' ')}`); process.exitCode = 1 }
console.log(`[L1 截图] 共 ${done.length} 张 · 目录 ${OUT}`)
for (const d of done) console.log(`  ${d.batch.padEnd(10)} ${d.file}  —— ${d.what}`)
