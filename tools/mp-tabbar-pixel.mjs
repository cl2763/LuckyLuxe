#!/usr/bin/env node
/* 裁(店主 05y §三②)· tabbar 那一条**取像素**验,不再只靠「静态 + 人看图」
 *
 * 我上一批写的是「tabbar 的 computed 底色 automator 拿不到,像素给不到的明说」——
 * 店主的裁定:**结论下早了**。整机图是一张 PNG,直接取样 tabbar 那块区域的像素、
 * 跟 `tokens.wxss` 里那一档的值比就行(跟 D182 数金色像素、web-shot 的 PNG 魔数判官同一招)。
 *
 * ══ 怎么取的(说清楚,免得下次以为是魔法)══
 * Node 没有内置 PNG 解码,所以借**无头 Chrome**:把 PNG 当图片加载 → 画进 canvas → 读 ImageData。
 * 取样区域**不写死像素坐标**(截的是整个开发者工具窗口,布局一变坐标就废):
 *   ① 先在图里找**手机屏**:从右半边逐列统计「近黑像素」,连续成片的那一块就是模拟器;
 *   ② 在手机屏内取**底部那一条**(高度的 88%–95% 之间,避开底部那道 home 指示条);
 *   ③ 取该带的**众数颜色**,与令牌里当档的 `--card` / `--paper` 比(容差 ±6/通道)。
 *
 * 用法:node tools/mp-tabbar-pixel.mjs <整机图.png> [light|dark]
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const IMG = process.argv[2]
const MODE = (process.argv[3] || 'dark').toLowerCase()
if (!IMG || !existsSync(IMG)) { console.error('用法: node tools/mp-tabbar-pixel.mjs <整机图.png> [light|dark]'); process.exit(2) }

/* 令牌值现读(判据不许自己抄一份色值) */
const TOK = readFileSync(new URL('../miniprogram/styles/tokens.wxss', import.meta.url), 'utf8')
const blockOf = (sel) => (TOK.match(new RegExp(`^\\${sel}\\{[^}]*\\}`, 'm')) || [''])[0]
const tokenIn = (block, name) => (block.match(new RegExp(`--${name}:\\s*([^;}]+)`)) || [])[1]?.trim() || ''
const hexToRgb = (h) => {
  const s = String(h).replace('#', '').trim()
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
}
const want = hexToRgb(tokenIn(blockOf(`.theme-${MODE}`), 'card'))
const wantPaper = hexToRgb(tokenIn(blockOf(`.theme-${MODE}`), 'paper'))

const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9338)
const profile = `/private/tmp/ll-px-profile-${process.pid}`
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl = ''
for (let i = 0; i < 60; i += 1) {
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
    const p = list.find((t) => t.type === 'page')
    if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break }
  } catch { /* 还没起来 */ }
  await sleep(250)
}
const ws = new WebSocket(wsUrl)
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
await send('Runtime.enable')

const b64 = readFileSync(resolve(IMG)).toString('base64')
const probe = `(async () => {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,${b64}' })
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const px = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]] }
  const near = (a, b, t) => Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t && Math.abs(a[2] - b[2]) <= t
  /* ① 找手机屏 —— **不拿令牌色去找**(那是循环论证:用答案找答案)。
     用的是「跟开发者工具自己的底色不一样」:最右边那一列必然是工具的底色,
     以它为参照,在右侧那一带里找出上下两条边界。 */
  const chrome = px(img.width - 6, Math.floor(img.height * 0.5))
  const xa = Math.floor(img.width * 0.70); const xb = Math.floor(img.width * 0.95)
  const midX = Math.floor((xa + xb) / 2)
  let top = -1; let bottom = -1
  for (let y = Math.floor(img.height * 0.03); y < img.height * 0.95; y += 2) {
    if (!near(px(midX, y), chrome, 8)) { top = y; break }
  }
  /* 下沿要**从上往下**找:从手机屏顶开始走,遇到「连着 8 个采样点都回到工具底色」才算出了手机屏。
     头一版从图的底部往上找第一个非工具底色,结果咬到的是工具**底部那一排控件**
     (「iPhone 15 Pro ▾」那一行),于是手机屏被算到 y=1912、宽高比 2.85(真值约 2.2)。
     ——「找错了块」是像素判据最容易犯的错,所以下面还有一条宽高比自证。 */
  {
    let run = 0
    for (let y = top + 20; y < img.height - 2; y += 2) {
      if (near(px(midX, y), chrome, 8)) { run += 1; if (run >= 8) { bottom = y - 16; break } } else run = 0
    }
    if (bottom < 0) bottom = Math.floor(img.height * 0.95)
  }
  if (top < 0 || bottom <= top) return { ok: false, why: '拿工具底色当参照也找不到手机屏的上下沿', chrome }
  /* 左右沿:从中线往两边走,直到又变回工具底色 */
  let left = midX; let right = midX
  const rowY = Math.round(top + (bottom - top) * 0.5)
  while (left > 2 && !near(px(left - 2, rowY), chrome, 8)) left -= 2
  while (right < img.width - 3 && !near(px(right + 2, rowY), chrome, 8)) right += 2
  const best = { from: left, to: right }
  /* 形状自证:手机屏该是「高比宽多一倍上下」——比例离谱说明找错了块,当场说清楚 */
  const ratio = (bottom - top) / Math.max(1, right - left)
  if (ratio < 1.85 || ratio > 2.6) return { ok: false, why: 'ratio=' + ratio.toFixed(2) + ' 不像手机屏(iPhone 那种屏约 2.1–2.3),不敢往下取样',
    phone: { from: left, to: right, top, bottom } }
  /* ② 底部那一条(88%–95%),避开 home 指示条 */
  const h = bottom - top
  const y1 = Math.round(top + h * 0.86); const y2 = Math.round(top + h * 0.93)
  const tally = new Map()
  let total = 0
  for (let y = y1; y <= y2; y += 2) {
    for (let x = best.from + 20; x <= best.to - 20; x += 6) {
      const p = px(x, y); const k = p.join(',')
      tally.set(k, (tally.get(k) || 0) + 1); total += 1
    }
  }
  let mode = null; let n = 0
  for (const [k, v] of tally) if (v > n) { n = v; mode = k }
  return { ok: true, phone: { from: best.from, to: best.to, top, bottom }, band: [y1, y2],
    modal: mode.split(',').map(Number), samples: n, total, share: Math.round((n / Math.max(1, total)) * 100),
    ratio: Math.round(((bottom - top) / Math.max(1, best.to - best.from)) * 100) / 100,
    size: [img.width, img.height] }
})()`
const res = await ev(probe)
ws.close(); chrome.kill()

let checks = 0
const fails = []
const check = (name, ok, detail = '') => {
  checks += 1
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
check('① 在整机图里定位到手机屏与底部那一条(以工具底色为参照,不拿令牌色找)', Boolean(res && res.ok), JSON.stringify(res))
if (res && res.ok) {
  const got = res.modal
  const near = (a, b) => Math.abs(a[0] - b[0]) <= 6 && Math.abs(a[1] - b[1]) <= 6 && Math.abs(a[2] - b[2]) <= 6
  console.log(`   [取样] 手机屏 x ${res.phone.from}–${res.phone.to} · y ${res.phone.top}–${res.phone.bottom}(宽高比 ${res.ratio})`
    + ` · 底条 y ${res.band[0]}–${res.band[1]} · 众数色 rgb(${got.join(', ')})(占该带 ${res.share}%,共 ${res.total} 点)`)
  console.log(`   [令牌] ${MODE} 档 --card = rgb(${want.join(', ')}) · --paper = rgb(${wantPaper.join(', ')})`)
  check('①b 取样带够均匀(众数占比 ≥ 45%)—— 不均匀说明取样带跨了别的东西,别硬下结论',
    res.share >= 45, `众数只占 ${res.share}%`)
  check(`② tabbar 那一条的底色 ≈ ${MODE} 档的 --card 或 --paper(±6/通道)`,
    near(got, want) || near(got, wantPaper),
    `量到 rgb(${got.join(', ')}),令牌 --card rgb(${want.join(', ')}) / --paper rgb(${wantPaper.join(', ')})`)
  /* 反向守:深色档下**绝不许**量到近白 —— 那就是店主看见的那道白边 */
  if (MODE === 'dark') {
    check('③ 反向守:深色档下 tabbar 不是近白(白边回潮当场红)',
      !(got[0] > 200 && got[1] > 200 && got[2] > 200), `量到 rgb(${got.join(', ')})`)
  }
}
if (fails.length) { console.error(`\n❌ mp-tabbar-pixel ${fails.length}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ mp-tabbar-pixel 通过 ${checks} 条(图:${IMG})`)
