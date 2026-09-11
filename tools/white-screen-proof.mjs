#!/usr/bin/env node
/* 日1 段1 · 白屏路径的**造病与验收**(店主 07a 裁 #45)
 *
 * ══ 要证的是什么 ══
 * 顾客端 `customer.js` 有 9 处直接取 `order.technician.name` / `order.store.name`,
 * 而服务端给这两个字段用的是 `.get()` —— **查不到返回 undefined**。
 * 于是「那一行技师查不到」这件事会让**整页白**,而不是少显示一个名字。
 * 店主的裁定:**先造病、后修**;修之前先让它红一次,证明这条路真的通。
 *
 * ══ 怎么造这个病(换过一次做法,写清楚)══
 * 头一版想在沙箱库里把某一单的 `technician_id` 指到不存在的 id —— **数据库不让**:
 * `bookings.technician_id` 上有**外键约束**(现测 `FOREIGN KEY constraint failed`)。
 * 这恰好印证了 07a 的定性:**订单那一路今天不会天天炸**。
 * 真正现在就可能是 `undefined` 的是**草稿/购物车那一路** —— `booking_drafts.technician_id` 本来就可空
 * (`apps/api/booking-drafts.mjs:56` 明写 `|| null`),「顾客还没选技师」是**正常业务态**。
 * 所以改成造那一路:**往购物车里放一件没有技师的货**(它就住在 localStorage,一个字不写库),
 * 打开购物车 → `renderCartItem` 里的 `item.technician.name` 当场抛错 → **整页白**。
 * 06i 我自己的夹具就是这么把购物车渲染搞崩的,当时还以为是「点不到结算入口」——
 * 那一次误判正是 J-47(渲染抛错会伪装成「功能没做」)的由来。
 *
 * ══ 这把刀做两件 ══
 * ① 用登录态夹具打开顾客端,按 `--break` 决定往购物车里放的是**没有技师的货**还是正常货;
 * ② **收页面错误**(window.onerror / unhandledrejection / console.error)并截图 ——
 *    有错先报错,「整页白」和「少个元素」是两个结论(J-47)。
 * ⚠️ 全程**一个字都不写库**(购物车是客户端自己的一份 JSON)。
 *
 * 用法:SHOT_BASE=http://127.0.0.1:4310 node tools/white-screen-proof.mjs --out <图目录> [--nobreak] [--tag 名字]
 *   默认造病(购物车里放一件没技师的货);--nobreak = 放正常货,用来对照
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { requireTarget } from './db-target.mjs'

const arg = (k, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const OUT = arg('--out', 'handoff/night-runs/白屏路径')
const NOBREAK = process.argv.includes('--nobreak')
const TAG = arg('--tag', NOBREAK ? '正常货' : '没技师的货')
const EMAIL = process.env.CS_AUTH || 'demo-cust-06@demo.local'
const TENANT = process.env.CS_TENANT || 'lucky-luxe'
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9361)
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = `/private/tmp/ll-ws-profile-${process.pid}`
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--window-size=430,932', 'about:blank'], { stdio: 'ignore' })
let code = 0
try {
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
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.result?.value
  await send('Page.enable'); await send('Runtime.enable')

  const sess = await fetch(`${BASE}/auth/email/login`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT },
    body: JSON.stringify({ email: EMAIL }) }).then((r) => r.json())
  if (!sess?.user) { console.error('🔴 登录态夹具没造成'); process.exit(2) }
  /* ⚠️ 整段住在模板串里 —— 一个反引号都不许有。
     收页面错误这一段必须**赶在页面脚本之前**装上,否则首屏那次抛错收不到(J-47)。 */
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    `(() => { const T = ${JSON.stringify(TENANT)}
      window.__pageErrors = []
      window.addEventListener('error', (e) => { window.__pageErrors.push('onerror: ' + (e.message || e.type)) })
      window.addEventListener('unhandledrejection', (e) => { window.__pageErrors.push('unhandledrejection: ' + String(e.reason && e.reason.message || e.reason)) })
      const ce = console.error
      console.error = function () { try { window.__pageErrors.push('console.error: ' + Array.from(arguments).map(String).join(' ')) } catch (x) {} return ce.apply(console, arguments) }
      localStorage.setItem('lucky-web-tenant', T)
      localStorage.setItem('lucky-web-user', JSON.stringify({ __tenant: T, __value: ${JSON.stringify(sess.user)} }))
      localStorage.setItem('lucky-web-auth', JSON.stringify({ __tenant: T, __value: ${JSON.stringify(sess.auth)} }))
      return 1 })()` })
  /* 往购物车里放一件货:造病那一版**没有技师**(正常业务态:顾客还没选);对照那一版有 */
  const sv = await fetch(`${BASE}/services`, { headers: { 'x-tenant-id': TENANT } }).then((r) => r.json())
  const arr = Array.isArray(sv) ? sv : (sv.services || [])
  const svc = arr.find((x) => Number(x.priceCents) > 0) || arr[0]
  const ts = await fetch(`${BASE}/technicians`, { headers: { 'x-tenant-id': TENANT } }).then((r) => r.json())
  const tarr = Array.isArray(ts) ? ts : (ts.technicians || [])
  const tech = NOBREAK ? (tarr.find((x) => x.is_active) || tarr[0]) : null
  if (!svc) { console.error('🔴 取不到本店服务,夹具没造成'); process.exit(2) }
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const item = { id: 'cart_whitescreen_probe', service: svc, technician: tech, date: day, time: '14:00',
    addOns: [], referenceImages: [], remark: '', referenceAnalysis: null,
    servicePriceCents: Number(svc.priceCents) || 0, depositCents: Number(svc.depositCents) || 0, selected: true }
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    `(() => { localStorage.setItem('lucky-web-cart:' + ${JSON.stringify(TENANT)}, ${JSON.stringify(JSON.stringify([item]))}); return 1 })()` })
  await send('Page.navigate', { url: `${BASE}/?tenant=${TENANT}` })
  await sleep(4600)
  await ev(`(() => { const b = document.querySelector('[data-view="cart"]'); if (b) b.click(); return 1 })()`)
  await sleep(2600)

  const state = await ev(`(() => ({
    textLen: ((document.body && document.body.innerText) || '').trim().length,
    errors: (window.__pageErrors || []).slice(0, 6),
    hasUnassigned: ((document.body && document.body.innerText) || '').indexOf('未指定') >= 0,
    title: document.title }))()`)
  const stamp = (() => { const d = new Date()
    const p2 = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}` })()
  const b64 = (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).result?.data
  const file = `购物车_${TAG}_${stamp}.png`
  if (b64) writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'))
  console.log(`\n[现场] ${TAG} —— 正文 ${state.textLen} 字 · 出现「未指定」:${state.hasUnassigned ? '是' : '否'}`)
  console.log(`[页面错误] ${state.errors.length ? state.errors.length + ' 条' : '无'}`)
  for (const e of state.errors) console.log(`   🔴 ${e}`)
  console.log(`[图] ${join(OUT, file)}`)
  /* J-47:**有错先报错** —— 页面抛过错,这一轮这一页的一切「没找到」结论都不算数 */
  if (state.errors.length) { console.log('\n🔴 这一页**抛过错** —— 按「这一页崩了」报,不许说成「少了某个元素」') ; code = 1 }
  else if (state.textLen < 30) { console.log('\n🔴 这一页正文不足 30 字 —— 整页白'); code = 1 }
  else { console.log('\n✅ 页面还在,没抛错') }
  ws.close()
} finally {
  chrome.kill()
}
process.exit(code)
