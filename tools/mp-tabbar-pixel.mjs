#!/usr/bin/env node
/* 夜7 段3 · 整机图取像素 —— **先把「手机屏在图上哪一块」做对**,自证不过就拒绝取样
 *
 * ══ 上一轮为什么没做成 ══
 * 我用「跟开发者工具底色不一样」去找手机屏,两次都咬到工具自己的面板
 * (宽高比自证 0.02 / 2.85,真值约 2.17)—— 刀**拒绝取样**,那个处置是对的,但结论是「没验成」。
 *
 * ══ 这一版换成店主给的那条路:**做差** ══
 * 同一页拍两张(浅档一张、深档一张)。**开发者工具的界面两张一模一样,只有手机屏里的内容会变** ——
 * 所以两张相减,**变化的那块包围盒就是手机屏**。这是「已知锚」,不靠猜边界、也不靠令牌色(不循环)。
 * 自证:包围盒的宽高比必须落在真值 **932/430 = 2.167** 的 ±5%(即 2.06–2.28)之内 —— 不落进去就拒绝取样。
 * (真值不是我编的:`wx.getWindowInfo()` 现报 430×932 · pixelRatio 3。)
 *
 * 用法:node tools/mp-tabbar-pixel.mjs <浅档图.png> <深档图.png> [要判的档 light|dark]
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const IMG_L = process.argv[2]
const IMG_D = process.argv[3]
const MODE = (process.argv[4] || 'dark').toLowerCase()
if (!IMG_L || !IMG_D || !existsSync(IMG_L) || !existsSync(IMG_D)) {
  console.error('用法: node tools/mp-tabbar-pixel.mjs <浅档图.png> <深档图.png> [light|dark]')
  process.exit(2)
}
const IMG = MODE === 'light' ? IMG_L : IMG_D

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

const b64L = readFileSync(resolve(IMG_L)).toString('base64')
const b64D = readFileSync(resolve(IMG_D)).toString('base64')
const b64 = MODE === 'light' ? b64L : b64D
const probe = `(async () => {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,${b64}' })
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const px = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]] }
  const near = (a, b, t) => Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t && Math.abs(a[2] - b[2]) <= t
  /* ① 定位 = **两张做差**:工具界面两张一样,只有手机屏里的内容变了 */
  const img2 = new Image()
  await new Promise((res, rej) => { img2.onload = res; img2.onerror = rej; img2.src = 'data:image/png;base64,OTHER_B64' })
  const c2 = document.createElement('canvas'); c2.width = img2.width; c2.height = img2.height
  const ctx2 = c2.getContext('2d'); ctx2.drawImage(img2, 0, 0)
  const px2 = (x, y) => { const d = ctx2.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]] }
  if (img2.width !== img.width || img2.height !== img.height) {
    return { ok: false, why: '两张图尺寸不一样(' + img.width + 'x' + img.height + ' vs ' + img2.width + 'x' + img2.height + '),没法做差' }
  }
  /* 🔴 头一版直接取「所有变化点的包围盒」—— 结果 x 从 720 拉到 2649:
     开发者工具的**编辑器与控制台**两张之间也变了(日志多了几行),它们也算变化点。
     改成**按列/按行的变化密度**取最长的一段连续高密度区:手机屏是整块变的,编辑器那边是零星变的。 */
  const colHits = new Array(Math.ceil(img.width / 3)).fill(0)
  const rowHits = new Array(Math.ceil(img.height / 3)).fill(0)
  let diffN = 0
  for (let y = 0; y < img.height; y += 3) {
    for (let x = 0; x < img.width; x += 3) {
      if (!near(px(x, y), px2(x, y), 12)) {
        diffN += 1; colHits[Math.floor(x / 3)] += 1; rowHits[Math.floor(y / 3)] += 1
      }
    }
  }
  if (diffN < 200) return { ok: false, why: '两张图几乎没差别(' + diffN + ' 个采样点不同)—— 是不是两张都拍成同一档了?' }
  const longestRun = (arr, thresh) => {
    let best = { from: -1, to: -1, len: 0 }; let cur = null
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i] >= thresh) { if (!cur) cur = { from: i, to: i }; else cur.to = i }
      else if (cur) { const len = cur.to - cur.from; if (len > best.len) best = { ...cur, len }; cur = null }
    }
    if (cur) { const len = cur.to - cur.from; if (len > best.len) best = { ...cur, len } }
    return best
  }
  const colT = Math.max(...colHits) * 0.30
  const rowT = Math.max(...rowHits) * 0.30
  const cRun = longestRun(colHits, colT)
  const rRun = longestRun(rowHits, rowT)
  if (cRun.len < 5 || rRun.len < 5) return { ok: false, why: '按密度也找不出整块变化区(列 ' + cRun.len + ' · 行 ' + rRun.len + ')' }
  const best = { from: cRun.from * 3, to: cRun.to * 3 }
  const top = rRun.from * 3; const bottom = rRun.to * 3
  const ratioSeen = (bottom - top) / Math.max(1, best.to - best.from)
  const TRUE_RATIO = 932 / 430
  if (Math.abs(ratioSeen - TRUE_RATIO) / TRUE_RATIO > 0.05) {
    return { ok: false, why: '做差得到的包围盒宽高比 ' + ratioSeen.toFixed(2) + ' 不在真值 ' + TRUE_RATIO.toFixed(2)
      + ' 的 ±5% 内 —— 定位没过自证,拒绝取样', phone: { from: best.from, to: best.to, top, bottom }, diffN }
  }
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
const res = await ev(probe.replace('OTHER_B64', MODE === 'light' ? b64D : b64L))
ws.close(); chrome.kill()

let checks = 0
const fails = []
const check = (name, ok, detail = '') => {
  checks += 1
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
check('① 定位:两张做差找到手机屏,且宽高比过自证(真值 2.167 ±5%)', Boolean(res && res.ok),
  JSON.stringify(res).slice(0, 240))
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
