#!/usr/bin/env node
/* J-36 升级(店主 05z §二)· **逐页逐元素**扫对比度 —— 不再取样点
 *
 * ══ 为什么必须升级 ══
 * 店主亲看 4310「财务」页深色态:「经营趋势」那一块**底是浅灰、字是白的**,几乎看不见。
 * 而 J-36 那把刀当时**只在两张图上取了四个点**(--heroink/--herosub/--brandd 那几个),
 * 于是「四个取样点全绿」与「旁边那块白字压浅底」可以同时成立 ——
 * **在缺陷存在时照样绿的判据就是废判据**(判据律),这是 J-37 的同族第二例。
 * 她那句「我只是发现了一处而已」就是这一批的验收标准:**不许再让她一处一处找**。
 *
 * ══ 这把刀怎么扫 ══
 * CDP 打开后台 → 逐个侧栏页 → 页内每个标签页 → **浅 / 深两档各来一遍**;
 * 每个**可见文字节点**取:
 *   · computed `color`
 *   · **实际绘制的背景**:自身背景透明就往上找第一个非透明的祖先(这一步是关键 ——
 *     店主撞见的那块正是「字有颜色、面是祖先画的」)
 *   · 对比度按 WCAG 2.1 相对亮度公式算
 * 门槛:正文 **4.5:1**;大字(≥24px,或 ≥18.66px 且 font-weight ≥ 700)放宽到 **3:1**
 * (报告里逐条标明用的是哪一档门槛 —— 店主 §二 第 1 条要求)。
 *
 * ══ 为什么红榜要**分两档**(这是我加的一刀,理由写在这儿等她裁)══
 * 头一跑照「< 4.5 即红」出了 **1,337 条**,而其中**浅色档就占一半以上** ——
 * 浅色档是这套皮原本的样子、店主天天在用,显然不是「看不见」。逐条看下去:
 * 那些是**品牌金 #b5885d 压白底 = 3.16:1**、**白字压金按钮 = 2.32:1** 这一类,
 * 它们的色值直接来自**合同图那份令牌**(`design-tokens.css` 是逐字符搬过来的)。
 * 要把它们弄到 4.5:1 就得**改令牌 = 改合同图** —— 按纪律「修复会改口径先请裁」,我不自己动。
 * 所以分两档,两档都报数、都上棘轮,但**红线只压在甲档**:
 *   · **甲档「看不见」**:< 3:1(大字 < 2:1)—— 店主撞见的那种(白字压浅底 / 深字压深底),**必须清零**;
 *   · **乙档「AA 欠账」**:3–4.5:1 —— 多半是合同图配色本身,**列清单待裁**,不当红线。
 * 这一分档本身也可能是我判错,所以**两档的原始条数都写在报告里**,她要并档随时并。
 *
 * 红榜每条打印:页面 · 标签页 · 档位 · 选择器 · 文字前 20 字 · 前景 · 背景 · 比值 · 门槛。
 *
 * 用法:SHOT_BASE=http://127.0.0.1:4310 SHOT_TOKEN=<开发主钥匙> node tools/contrast-sweep.mjs
 *   CS_CAP=<数>   红条数棘轮(只许降);不给就只报数不判红
 *   CS_OUT=<路径> 红榜落盘(markdown)
 *   CS_PAGES=a,b  只扫这几页(定位用;正式跑不要给)
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'SHOT_TOKEN', value: process.env.SHOT_TOKEN, hint: '(开发主钥匙,启动日志里那一串;不写进代码)' })
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9336)
const CAP = process.env.CS_CAP ? Number(process.env.CS_CAP) : null
/* J-56:退回旧行为(不折 opacity)**只为出同尺对照** —— 两个数必须同一版判据产出(J-39)。
   正式跑一律不要给这个变量。 */
const LEGACY_OPACITY_JS = process.env.CS_LEGACY_OPACITY === '1' ? 'true' : 'false'
/* 页内标签页的选择器**抽成具名常量** —— 下面那条覆盖面反向守要守的就是它。
   头一版我让守去查 SWEEP,而选择器住在另一段模板里,**守错了目标**(守和用不是同一处,
   于是它报「一族都没认」而其实四族都在)。一件事一处真相。 */
const TAB_SELECTOR = 'button[data-fin-tab], button[data-member-tab], button[data-staff-tab],'
  + ' button[data-pricing-tab], button[data-tab], [role="tab"]'
const OUT = process.env.CS_OUT || ''
const ONLY = (process.env.CS_PAGES || '').split(',').map((x) => x.trim()).filter(Boolean)
/* 夜7 段2:同一把刀两个靶子 —— `admin`(商家后台,默认)/ `customer`(顾客端网页)。
   店主的话:「顾客端是**外人**看的,比后台更不能出白字压浅底」,而它**一次都没扫过**。
   顾客端没有站内三档(那是后台才有的),所以浅/深两档用 **CDP 模拟系统偏好** 切。 */
const TARGET = (process.env.CS_TARGET || 'admin').toLowerCase()
/* ── 06i 加的三样(**全部选配,默认一个字不变**)────────────────────────────
   店主 06i 裁 #42:登录态那几页一直是「**没扫**」不是绿,这一批要造夹具补上;
   同时 §一 末尾要求把 platform / sign 两个独立入口页也纳入扫描面。
   ⚠️ 加这三样会改这把刀的提交号 —— 按 J-39,凡要和历史数并排比的,
      **两侧都得用新版重量一次**;本批回执就是这么做的。加的是**覆盖面**不是判法:
      门槛、取背景、去重、两档的分法一个字没动。
   · CS_AUTH=<邮箱>   顾客端登录态夹具。沙箱的 /auth/email/login **不校验密码**
                      (DEMO_LOGIN_ALLOWED 才开),所以夹具里没有、也不需要任何口令。
   · CS_STEPS=名字:选择器|…  tab 扫完之后,逐个点开再扫(每步先回「我的」再点)。
                      选择器写在**调用处**、不写死在刀里 —— 刀保持通用。
   · CS_URLS=名字:/路径|…    CS_TARGET=pages 时扫的独立入口页(platform / sign 那种)。
   · CS_COVER=名字|…         **该扫的全清单**;报告里用它算「扫到 X / 该扫 Y / 没扫哪几页」。 */
const AUTH_EMAIL = process.env.CS_AUTH || ''
const STEPS = (process.env.CS_STEPS || '').split('|').map((x) => x.trim()).filter(Boolean)
  .map((x) => { const i = x.indexOf(':'); const rest = x.slice(i + 1); const h = rest.lastIndexOf('#')
    return { name: x.slice(0, i), sel: h > 0 ? rest.slice(0, h) : rest, want: h > 0 ? rest.slice(h + 1) : '' } })
const URLS = (process.env.CS_URLS || '').split('|').map((x) => x.trim()).filter(Boolean)
  .map((x) => { const i = x.indexOf(':'); return { name: x.slice(0, i), path: x.slice(i + 1) } })
const COVER = (process.env.CS_COVER || '').split('|').map((x) => x.trim()).filter(Boolean)
/* 被测的那一版代码也要写进抬头 —— 否则「修前/修后」两份报告光看刀号还是分不出量的是哪一版 */
const CODE_REV = (() => {
  /* 🔴 「退回旧版重量一次」这种跑法(J-39 §二 的做法一)下,git 只会说「工作区脏了」,
     说不出**量的是哪一版**。所以留一个显式标签:CS_CODE_REV=「apps/web @ 07d8067(退回重量)」。
     不给就照旧从 git 取 —— 但**绝不许猜**,取到什么写什么。 */
  if (process.env.CS_CODE_REV) return process.env.CS_CODE_REV
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', 'apps/web'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'apps/web'], { encoding: 'utf8' }).trim()
    return `apps/web @ ${sha}${dirty ? '+dirty(工作区有未提交改动)' : ''}`
  } catch { return '(取不到 git 信息)' }
})()

/* ══ J-39「同一把尺子」(店主 06a §二 立)══
   案底就是我自己:回执把「修前 237(3:1 那把尺子量的)」和「修后 0(2:1 这把尺子量的)」
   并排放,还写「同一把修好的刀量的」——**两份红榜自己的抬头就否掉了这句话**。
   落地办法:**每份带数的报告,抬头打印产出它的那把刀的提交号**;
   两个数要比,先比刀号;刀号不同就得重量一次。`+dirty` = 刀有未提交改动,那更不能拿来跟历史比。 */
const KNIFE_REV = (() => {
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', 'tools/contrast-sweep.mjs'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'tools/contrast-sweep.mjs'], { encoding: 'utf8' }).trim()
    return `${sha || '(无提交记录)'}${dirty ? '+dirty(刀有未提交改动)' : ''}`
  } catch { return '(取不到 git 信息)' }
})()

/* 🔴 「这份红榜跟不跟得上样式」原来靠 **mtime** 比 —— 而 `knife-backup.sh` 还原、`git checkout`
   都会把 mtime 改新,内容一个字节没变也会被判成「过期」(现测:全量预检因此红了一次)。
   改成**按内容算指纹**:抬头写下三份界面文件的 sha,预检重算一遍对比。
   同族 J-38/J-39:锚在**内容**上,别锚在代理指标上。 */
const STYLE_FILES = ['apps/web/styles.css', 'apps/web/admin.html', 'apps/web/admin.js']
const STYLE_SHA = (() => {
  try {
    const h = createHash('sha256')
    for (const f of STYLE_FILES) h.update(readFileSync(new URL(`../${f}`, import.meta.url)))
    return h.digest('hex').slice(0, 12)
  } catch (e) { return `(算不出:${e.message})` }
})()

const profile = `/private/tmp/ll-cs-profile-${process.pid}`
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function cdpTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error('Chrome 调试端口没起来 —— 装没装 Chrome?SHOT_CHROME 路径对不对?')
}
const ws = new WebSocket(await cdpTarget())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(`页内报错:${r.result.exceptionDetails.text} ${r.result.exceptionDetails.exception?.description || ''}`)
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable')

/* ── J-47(店主 07a §三 立)· **扫页面的刀必须同时收页面错误** ──────────────
   由来是我自己的一句话:06i「整个购物车渲染当场抛错,连带『去结算』那条 summary-bar 也不出现,
   **看起来却像点不到结算入口**」—— 我差点被它骗过去,只读红榜的人也会被骗过去。
   店主的裁定:**有错先报错**。「元素没找到」和「这一页渲染崩了」是**两个结论**,不许混成一个;
   一页只要抛过错,那一页这一轮的所有「没找到」结论**一律作废**,按「这一页崩了」报。
   ⚠️ 收集脚本必须**赶在页面脚本之前**装上(addScriptToEvaluateOnNewDocument),
      否则首屏那一次抛错根本收不到 —— 那是最要命的一次。 */
await send('Page.addScriptToEvaluateOnNewDocument', { source:
  `(() => { if (window.__pageErrors) return 1
    window.__pageErrors = []
    window.addEventListener('error', (e) => { window.__pageErrors.push('onerror: ' + (e.message || e.type)) })
    window.addEventListener('unhandledrejection', (e) => { window.__pageErrors.push('unhandledrejection: ' + String((e.reason && e.reason.message) || e.reason)) })
    const ce = console.error
    console.error = function () { try { window.__pageErrors.push('console.error: ' + Array.from(arguments).map(String).join(' ')) } catch (x) {} return ce.apply(console, arguments) }
    return 1 })()` })
const crashed = []
/* 取一次并清空 —— 每一页各算各的,不许把上一页的错算到这一页头上 */
const takeErrors = async () => (await ev(`(() => { const e = (window.__pageErrors || []).slice(0, 5)
  window.__pageErrors = []; return e })()`)) || []

/* ── 页内那段扫描脚本(整段在浏览器里跑;这里是字符串,**里面一个反引号都不许有**)── */
const SWEEP = `(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05) }
  /* 实际绘制的背景。三件事,少一件就会误报(头一跑三件都缺,误报了几十条):
     ① **半透明要合成**:6% 的白盖在深底上,眼睛看到的还是深底 ——
        原来「alpha > 0.05 就当它是底」把 rgba(245,239,227,.06) 当成了奶白面,
        于是「奶白字压奶白底 = 1:1」这种假红冒出来一片;
     ② **渐变面判不了**:元素有 background-image(渐变/图)时 backgroundColor 是透明的,
        往上找会找到更外层那张白卡 —— 那不是它真正压着的东西。这一类**不判**,单独计数、如实说;
     ③ 一路合成到 body 为止。 */
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a), a: 1,
  })
  /* 🔴 J-56(店主 07f 裁 #66)· **这把尺子原来漏了一整层:ˋopacityˋ。**
   全文唯一一处 opacity 是 :223 那句「< 0.1 就跳过」—— 它**从不把 opacity 折进颜色**,
   也**不看祖先**。后果不是「少扫了几页」那么小:
   **凡祖先带 opacity 的元素,历次红榜的比值全部被高估** ——
   尺子拿的是满强度的字色压满强度的底色,而眼睛看到的是两边都被拖向页面底色之后的样子。
   现测案例:排班看板 ˋ.finance-rule-row.disabled { opacity: .5 }ˋ 里的状态词,
   旧尺子量 2.52(乙档),折进 opacity 之后是 **1.52(甲档「看不见」)**。

   ══ CSS 的真实语义 ══
   祖先 A 的 ˋopacity: αˋ 会把 A **整个子树先画进一个缓冲**(包括 A 自己的底与里面的字),
   再整体以 α 合成到 **A 背后**的东西上。所以:
     有效前景 = over(字色 @ α, A 背后的底)
     有效背景 = over(组内合成底 @ α, A 背后的底)
   两边**一起**被拖向背后那层 —— 这正是「透明度谁也算不准」的由来(店主 07f §二口径)。

   ⚠️ ˋCS_LEGACY_OPACITY=1ˋ 可以退回旧行为,**只为出同尺对照**(J-39:两个数要同一版判据产出),
   不是给人绕过用的。 */
const LEGACY_OPACITY = ${LEGACY_OPACITY_JS}
/* 从 el 往上累乘 opacity;同时记住**最外层那个带 opacity 的元素** */
const opacityChain = (el) => {
  let cum = 1
  let outer = null
  let cur = el
  while (cur && cur !== document.documentElement) {
    const o = Number(getComputedStyle(cur).opacity)
    if (Number.isFinite(o) && o < 0.999) { cum *= o; outer = cur }
    cur = cur.parentElement
  }
  return { cum, outer }
}
const bgOf = (el) => {
    const stack = []
    let cur = el
    let gradient = null
    while (cur && cur !== document.documentElement) {
      const cs2 = getComputedStyle(cur)
      if (!gradient && cs2.backgroundImage && cs2.backgroundImage !== 'none') gradient = cur
      const c = parse(cs2.backgroundColor)
      if (c && c.a > 0.001) { stack.push({ c, el: cur }); if (c.a >= 0.999) break }
      cur = cur.parentElement
    }
    if (gradient) return { gradient: true, from: gradient }
    let acc = { r: 255, g: 255, b: 255, a: 1 }
    const bodyC = parse(getComputedStyle(document.body).backgroundColor)
    if (bodyC && bodyC.a > 0.5) acc = { r: bodyC.r, g: bodyC.g, b: bodyC.b, a: 1 }
    for (let i = stack.length - 1; i >= 0; i -= 1) acc = over(stack[i].c, acc)
    return { c: acc, from: (stack[0] && stack[0].el) || document.body }
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
  const out = []
  let gradients = 0
  const seen = new Set()
  const all = document.querySelectorAll('body *')
  for (const el of all) {
    if (el.closest('[hidden], .hidden')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    /* 只看**自己直接持有文字**的节点(否则父容器会把子节点的字重复算一遍) */
    let text = ''
    for (const nd of el.childNodes) if (nd.nodeType === 3) text += nd.textContent
    text = text.replace(/\\s+/g, ' ').trim()
    if (!text) continue
    const fg = parse(cs.color); if (!fg || fg.a < 0.1) continue
    const bg = bgOf(el)
    if (bg.gradient) { gradients += 1; continue }   /* 渐变面:这把刀判不了,单独计数 */
    if (!bg.c) continue
    const size = parseFloat(cs.fontSize) || 14
    const weight = Number(cs.fontWeight) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3 : 4.5
    /* J-56:把祖先 opacity 折进来再算。cum>=0.999 时与旧行为逐位相同(不动已有的数)。 */
    let efg = fg
    let ebg = bg.c
    let opacityFolded = 0
    if (!LEGACY_OPACITY) {
      const oc = opacityChain(el)
      if (oc.cum < 0.999 && oc.outer) {
        const behind = bgOf(oc.outer.parentElement || document.body)
        if (behind.gradient) { gradients += 1; continue }   /* 背后是渐变面:这把刀判不了,如实计数 */
        if (behind.c) {
          efg = over({ r: fg.r, g: fg.g, b: fg.b, a: oc.cum }, behind.c)
          ebg = over({ r: bg.c.r, g: bg.c.g, b: bg.c.b, a: oc.cum }, behind.c)
          opacityFolded = Math.round(oc.cum * 100) / 100
        }
      }
    }
    const got = ratio(efg, ebg)
    const key = selOf(el) + '|' + text.slice(0, 20)
    if (seen.has(key)) continue
    seen.add(key)
    if (got + 0.05 < need) {
      /* 两档分开(见文件抬头「为什么分两档」):
         甲 = **看不见**(< 3:1,大字 < 2:1)—— 店主撞见的就是这一档,必须清零;
         乙 = **AA 欠账**(3–4.5:1)—— 多半是合同图那几个品牌色本身的取值,改它等于改合同,要她裁。 */
      /* 甲档的线定在 2:1(大字 1.6:1),不是 3:1 —— 理由是现测出来的:
         3:1 会把「奶白字压品牌金按钮 = 2.3:1」也算成看不见,而那是合同图的按钮样式
         (金色来自 --brand 令牌),它读得清,只是过不了 WCAG AA。混进甲档的话,
         要清零的那 80 处里一半是「要不要改合同图」,真正瞎的那几处反而被淹掉。
         所以:甲档 = 真的看不见(< 2:1);奶白压金按钮这类落到乙档等店主裁。
         ⚠️ 这段注释整个住在模板串里,一个反引号都不许有(今晚第五次踩)。 */
      const hard = large ? 1.6 : 2
      const bgTxt = 'rgb(' + [ebg.r, ebg.g, ebg.b].map((x) => Math.round(x)).join(', ') + ')'
      out.push({ sel: selOf(el), text: text.slice(0, 20), fg: cs.color, bg: bgTxt,
        bgFrom: selOf(bg.from), ratio: Math.round(got * 100) / 100, need, size: Math.round(size), weight, opacity: opacityFolded,
        tier: got + 0.05 < hard ? 'A' : 'B' })
    }
  }
  return { scanned: seen.size, bad: out, gradients }
})()`

/* 🔴 「登进去了没有」这一问,**判据本身错过两次**:
   头一版问 `#sidebarGeneralSettings` 存不存在 —— 它是 admin.html 里的**静态节点**,
   没登录时也在,于是断言绿着、刀却在登录页上扫了 15 个节点还报出「甲档 3 处」。
   这正是 J-37 那条(「在不在」不等于「看得见」)在判据自己身上的复发。
   现在问的是**只有登录之后才成立**的事:侧栏那颗**可见**(offsetParent 不为空)且令牌框不见了。 */
const LOGGED_IN = `(() => {
  const side = document.querySelector('#sidebarGeneralSettings')
  const tok = document.querySelector('#tokenInput')
  const sideVisible = Boolean(side && side.offsetParent !== null)
  const tokGone = !tok || tok.offsetParent === null
  return sideVisible && tokGone
})()`

/* ── 登录 + 逐页遍历 ─────────────────────────────────────────── */
async function login() {
  await send('Page.navigate', { url: `${BASE}/admin` })
  await sleep(1800)
  await ev(`(() => { const el = document.querySelector('#tokenInput'); if (!el) return 0; el.value = ${JSON.stringify(TOKEN)};
    const b = Array.from(document.querySelectorAll('button')).find((x) => /刷新|Refresh/.test(x.textContent)); if (b) b.click(); return 1 })()`)
  for (let i = 0; i < 40; i += 1) {
    if (await ev(LOGGED_IN)) break
    await sleep(500)
  }
  await sleep(1200)
}
/* 换档走**页面自己那个出口**(ThemeSwitch.applyTheme)——判据不另起一套换法 */
const setTheme = (mode) => ev(`(() => { if (window.ThemeSwitch) window.ThemeSwitch.applyTheme('${mode}')
  return document.documentElement.dataset.theme || '(跟随系统)' })()`)

/* 🔴 登进去了没有,**必须当场断言** —— 头一跑它没登进去,却一路往下扫了登录页那 16 个节点、
   还报了个「甲档 4 条」出来,看着像结论其实是空气(静默失败器族;这一夜第三次)。
   现在:两次重试 + 硬断言,进不去就退出码 2,绝不假装扫过。 */
const bad = []
let scanned = 0
let grad = 0   /* 背景是渐变、这把刀判不了的节点数(如实报,不混进绿也不混进红) */

/* ── 顾客端那一支:不登录、按底部四个 tab 走 ────────────────────────── */
const scannedPages = []   /* 这一跑真正扫到的页名(算「没扫的页」那一节要用) */
const stepMiss = []       /* 点不开的那些 —— 如实记成「没扫成」,不算绿 */
if (TARGET === 'pages') {
  /* ── 独立入口页(platform / sign 那种):它们不是 admin 的子页,也不在顾客端四个 tab 里,
        所以此前**一份红榜都没进过**。店主 06i §一 末尾点名要纳入。 */
  if (!URLS.length) { console.error('🔴 CS_TARGET=pages 要给 CS_URLS=名字:/路径|…'); ws.close(); chrome.kill(); process.exit(2) }
  for (const mode of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    for (const u of URLS) {
      await send('Page.navigate', { url: `${BASE}${u.path}` })
      await sleep(3200)
      const cnt = await ev(`(document.body && document.body.innerText || '').trim().length`)
      if (Number(cnt) < 20) { console.error(`🔴 ${u.name} 正文只有 ${cnt} 字 —— 这一页**没验成**,不许下结论`); continue }
      const res = await ev(SWEEP)
      scanned += res.scanned; grad += res.gradients || 0
      const errs = await takeErrors()
      if (errs.length) crashed.push({ page: u.name, mode, errs })
      for (const b of res.bad) bad.push({ 页: u.name, 标签: '(整页)', 档: mode, ...b })
      if (mode === 'light') scannedPages.push(u.name)
      console.log(`   [扫] ${mode} · ${u.name} —— 文字节点 ${res.scanned} 个,红 ${res.bad.length} 条`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] })
} else if (TARGET === 'customer') {
  /* 🔴 06i:登录态夹具。**沙箱那条邮箱登录口不校验密码**(只在 DEMO_LOGIN_ALLOWED 下开),
     所以这里既没有也不需要任何口令 —— 拿回来的会话按顾客端自己的存法写进 localStorage
     (`{__tenant, __value}`,见 customer.js 的 readTenantJson:没有租户标的缓存会被整份丢掉)。
     用 addScriptToEvaluateOnNewDocument 是因为它必须**赶在页面脚本之前**落地。 */
  if (AUTH_EMAIL) {
    const tenant = process.env.CS_TENANT || 'lucky-luxe'
    let sess = null
    try {
      sess = await fetch(`${BASE}/auth/email/login`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': tenant },
        body: JSON.stringify({ email: AUTH_EMAIL }) }).then((r) => r.json())
    } catch (e) { sess = null }
    if (!sess || !sess.user || !sess.auth) {
      console.error(`🔴 登录态夹具没造成(${AUTH_EMAIL})—— 这一跑不许当成「登录态扫过了」`)
      ws.close(); chrome.kill(); process.exit(2)
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source:
      `(() => { const T = ${JSON.stringify(tenant)};
        localStorage.setItem('lucky-web-tenant', T);
        localStorage.setItem('lucky-web-user', JSON.stringify({ __tenant: T, __value: ${JSON.stringify(sess.user)} }));
        localStorage.setItem('lucky-web-auth', JSON.stringify({ __tenant: T, __value: ${JSON.stringify(sess.auth)} }));
        return 1 })()` })
    console.log(`   [夹具] 登录态已注入:${sess.user.displayName || AUTH_EMAIL}(沙箱邮箱口,不校验密码)`)
    /* CS_CART=1:再造一个「购物车有货」的景。
       为什么直接写 localStorage 而不去点「加入购物车」:那颗按钮是 `data-start-booking="cart"`,
       它**开的是预约流程**(还要选技师、选时段),点一下并不会加货 —— 现测角标一直是 0,
       而我头一版把「其实是空的购物车」当成「购物车有货」扫了一遍,**那比没扫更坏**(名不副实)。
       购物车本来就是**客户端自己的一份 JSON**(`lucky-web-cart:<租户>`,见 customer.js),
       所以夹具照它自己的格式造一件真服务进去,再由页面正常渲染。 */
    if (process.env.CS_CART === '1') {
      let svc = null
      let tech = null
      try {
        const r2 = await fetch(`${BASE}/services`, { headers: { 'x-tenant-id': tenant } }).then((x) => x.json())
        const arr = Array.isArray(r2) ? r2 : (r2.services || [])
        svc = arr.find((x) => Number(x.priceCents) > 0) || arr[0]
        const r3 = await fetch(`${BASE}/technicians`, { headers: { 'x-tenant-id': tenant } }).then((x) => x.json())
        const ts = Array.isArray(r3) ? r3 : (r3.technicians || [])
        tech = ts.find((x) => x.is_active) || ts[0]
      } catch { svc = null }
      /* 🔴 夜8 现测:头一版把 `technician` 塞成 null —— 而 `renderCartItem` 里有
         `item.technician.name`,于是**整个购物车渲染当场抛错**,连带那条带「去结算」的 summary-bar
         也不出现;页面停在上一屏,而我还以为「结算入口点不到」。
         夹具造得不完整,表现出来却像是「产品少了个按钮」——**夹具必须造成真数据的样子**。 */
      if (!svc || !tech) { stepMiss.push('购物车有货:取不到本店服务或技师,夹具没造成 —— **没扫成**,不是绿') } else {
        const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
        const item = { id: 'cart_fixture_06i', service: svc, technician: tech, date: day, time: '14:00',
          addOns: [], referenceImages: [], remark: '', referenceAnalysis: null,
          servicePriceCents: Number(svc.priceCents) || 0, depositCents: Number(svc.depositCents) || 0, selected: true }
        await send('Page.addScriptToEvaluateOnNewDocument', { source:
          `(() => { localStorage.setItem('lucky-web-cart:' + ${JSON.stringify(tenant)}, ${JSON.stringify(JSON.stringify([item]))}); return 1 })()` })
        console.log(`   [夹具] 购物车已放一件:${svc.nameZh || svc.name}`)
      }
    }
  }
  await send('Page.navigate', { url: `${BASE}/?tenant=${process.env.CS_TENANT || 'lucky-luxe'}` })
  await sleep(4200)   /* 顾客端的内容是拉回来才渲染的;等不够就只扫到骨架(现测:17 个 vs 47 个) */
  const title = await ev('document.title')
  const views = await ev(`Array.from(document.querySelectorAll('[data-view]'))
    .map((b) => ({ key: b.dataset.view, name: (b.textContent || '').trim().slice(0, 8) }))
    .filter((x, i, a) => x.key && a.findIndex((y) => y.key === x.key) === i)`)
  if (!views.length) {
    console.error(`🔴 顾客端没出 tab(标题「${title}」)—— 这一跑什么都没扫,不许下结论`)
    ws.close(); chrome.kill(); process.exit(2)
  }
  console.log(`   [顾客端] 标题「${title}」· ${views.length} 个 tab:${views.map((v) => v.key).join(' / ')}`)
  /* 🔴 前置自证(这一夜第三次栽在「没等到内容就开扫」上):首屏必须真有内容,
     少于 30 个自持文字的可见节点 = 页面还没渲染完,**拒绝往下扫**,不拿骨架冒充全站。 */
  const COUNT_TEXT = `Array.from(document.querySelectorAll('body *')).filter((el) => {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false
    let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent
    return t.trim().length > 0 }).length`
  const firstCount = await ev(COUNT_TEXT)
  if (Number(firstCount) < 30) {
    console.error(`🔴 顾客端首屏只有 ${firstCount} 个文字节点 —— 内容还没渲染完,这一跑不算数(不许拿骨架当全站)`)
    ws.close(); chrome.kill(); process.exit(2)
  }
  console.log(`   [前置] 首屏 ${firstCount} 个文字节点,够了`)
  const HOME_MIN = 30
  for (const mode of ['light', 'dark']) {
    /* 顾客端跟系统走,所以直接模拟系统偏好(比在页面里塞属性诚实:线上就是这么来的) */
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    /* 🔴 每一档**重新进页面**再扫:现测过一次「浅色档首页 38 个节点、深色档同一页只剩 17 个」——
       那不是深色档掉了内容,是切来切去之后这一屏还没重渲染完。
       判据只在**同一种加载状态**下比才算数,所以每档都从头来一遍,并且首页再自证一次。 */
    await send('Page.navigate', { url: `${BASE}/?tenant=${process.env.CS_TENANT || 'lucky-luxe'}` })
    await sleep(4200)
    const homeCount = await ev(COUNT_TEXT)
    if (Number(homeCount) < HOME_MIN) {
      console.error(`🔴 ${mode} 档首页只有 ${homeCount} 个文字节点(要 ≥ ${HOME_MIN})—— 没渲染完,这一跑不算数`)
      ws.close(); chrome.kill(); process.exit(2)
    }
    console.log(`   [前置] ${mode} 档首页 ${homeCount} 个文字节点,够了`)
    for (const v of views) {
      await ev(`(() => { const b = document.querySelector('[data-view="${v.key}"]'); if (b) b.click(); return 1 })()`)
      await sleep(2500)
      const res = await ev(SWEEP)
      const errs = await takeErrors()
      if (errs.length) crashed.push({ page: `顾客端·${v.name || v.key}`, mode, errs })
      scanned += res.scanned; grad += res.gradients || 0
      for (const b of res.bad) bad.push({ 页: `顾客端·${v.name || v.key}`, 标签: '(整页)', 档: mode, ...b })
      if (mode === 'light') scannedPages.push(`顾客端·${v.name || v.key}`)
      console.log(`   [扫] ${mode} · 顾客端 ${v.name || v.key} —— 文字节点 ${res.scanned} 个,红 ${res.bad.length} 条`)
    }
    /* 06i:tab 之下还有一层 —— 会员权益 / 会员码 / 积分商城 / 卡包 / 订单详情 那些,
       此前**一次都没扫过**(它们要登录才出得来)。每一步都先回「我的」再点,免得上一步的弹层挡住。
       点不开就**如实记成没扫成**,不静默跳过。 */
    for (const st of STEPS) {
      await ev(`(() => { const b = document.querySelector('[data-view="me"]'); if (b) b.click(); return 1 })()`)
      await sleep(1200)
      /* 一步可以连点几下(`a>>b>>c`),每一小步支持三种写法:
           `.sel`         第一个匹配
           `.sel@2`       第 3 个匹配(有三张一模一样的 menu-card 时要用)
           `text=加入购物车` 按按钮上的字找(class 太通用时最稳)
         点不到就**如实记成没扫成**,并说清是卡在第几步 —— 不静默跳过。 */
      let hit = 1
      let where = ''
      for (const one of String(st.sel).split('>>').map((x) => x.trim()).filter(Boolean)) {
        where = one
        hit = await ev(`(() => { const raw = ${JSON.stringify(one)}
          let el = null
          if (raw.indexOf('text=') === 0) {
            const want = raw.slice(5)
            el = Array.from(document.querySelectorAll('button, a, [role=button]'))
              .filter((x) => { const r = x.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
              .find((x) => (x.textContent || '').trim().indexOf(want) >= 0)
          } else {
            const at = raw.lastIndexOf('@')
            if (at > 0 && /^[0-9]+$/.test(raw.slice(at + 1))) el = document.querySelectorAll(raw.slice(0, at))[Number(raw.slice(at + 1))]
            else el = document.querySelector(raw)
          }
          if (!el) return 0
          el.click(); return 1 })()`)
        if (!hit) break
        await sleep(1500)
      }
      if (!hit) { stepMiss.push(`${st.name}(${mode}):卡在「${where}」这一步点不到 —— **没扫成**,不是绿`); continue }
      await sleep(2200)
      /* 🔴 **到没到那一页,要自证**。步骤名后面用 `#期望文字` 声明这一页该有的字,
         查不到就按「没扫成」记 —— 不许拿另一页冒充。
         这条是现测逼出来的:我头一版点 `[data-view="cart"]` 之后其实还停在首页,
         却把它记成了「购物车有货」——**名不副实比没扫更坏**(和空购物车那次同族)。 */
      if (st.want) {
        const seen = await ev(`((document.body && document.body.innerText) || '').indexOf(${JSON.stringify(st.want)}) >= 0`)
        if (!seen) { stepMiss.push(`${st.name}(${mode}):点完之后页面上找不到「${st.want}」—— 没到那一页,**没扫成**,不是绿`); continue }
      }
      const res = await ev(SWEEP)
      const errs = await takeErrors()
      if (errs.length) crashed.push({ page: `顾客端·${st.name}`, mode, errs })
      scanned += res.scanned; grad += res.gradients || 0
      for (const b of res.bad) bad.push({ 页: `顾客端·${st.name}`, 标签: '(登录态)', 档: mode, ...b })
      if (mode === 'light') scannedPages.push(`顾客端·${st.name}`)
      console.log(`   [扫] ${mode} · 顾客端 ${st.name}(登录态)—— 文字节点 ${res.scanned} 个,红 ${res.bad.length} 条`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] })
} else {

await login()
for (let tries = 1; tries <= 2 && !(await ev(LOGGED_IN)); tries += 1) {
  console.error(`   [重试 ${tries}] 没登进去,再来一次`)
  await login()
}
if (!(await ev(LOGGED_IN))) {
  console.error('🔴 登不进后台(侧栏没出来)—— 这一跑什么都没扫,不许拿它下任何结论。')
  console.error(`   现在页面上有:${await ev(`(document.body.innerText||'').slice(0,120).replace(/\\s+/g,' ')`)}`)
  ws.close(); chrome.kill(); process.exit(2)
}
/* 🔴 覆盖面反向守(店主 07f 裁 #66②;判据三推论:判据的覆盖面本身要有判据)——
   admin.html 里出现的**每一族** data-*-tab 都必须在上面 SWEEP 的选择器里。
   07f 现查:四族(fin 7 · member 5 · staff 4 · pricing 3)只认了 fin —— **三族一次没走到**,
   于是「考勤」「技师排班」「会员套餐」「价目」那几个标签页下的字,历次全扫一次都没量过。
   以后再加一族而选择器没跟上,这里当场红。 */
const tabFamilies = [...new Set([...readFileSync(new URL('../apps/web/admin.html', import.meta.url), 'utf8')
  .matchAll(/data-([a-z0-9-]*tab)="/g)].map((m) => m[1]))]
const covered = tabFamilies.filter((f) => TAB_SELECTOR.includes(`data-${f}]`))
if (covered.length !== tabFamilies.length) {
  console.error(`\n🔴 标签页族没扫全:admin.html 有 ${tabFamilies.map((f) => `data-${f}`).join(' / ')},`)
  console.error(`   而选择器只认 ${covered.map((f) => `data-${f}`).join(' / ')} —— 没认的那几族**一次都没被走到**`)
  ws.close(); chrome.kill(); process.exit(2)
}
console.log(`   [标签页族] admin.html ${tabFamilies.length} 族全部在扫描面上:${tabFamilies.join(' / ')}`)
const pages = await ev(`Array.from(document.querySelectorAll('[data-admin-page]'))
  .map((b) => ({ key: b.dataset.adminPage, name: (b.textContent || '').trim() }))
  .filter((x, i, a) => x.key && a.findIndex((y) => y.key === x.key) === i)`)
const targets = ONLY.length ? pages.filter((p) => ONLY.includes(p.key)) : pages
console.log(`   [侧栏] 共 ${pages.length} 页,这一跑扫 ${targets.length} 页`)


for (const mode of ['light', 'dark']) {
  await setTheme(mode)
  for (const p of targets) {
    const ok = await ev(`(() => { const b = document.querySelector('[data-admin-page="${p.key}"]'); if (!b) return 0; b.click(); return 1 })()`)
    if (!ok) continue
    await sleep(900)
    /* 页内标签页:财务那种有 `data-fin-tab`,别的页有各自的;统一按「按钮上带 data-*-tab」找 */
    const tabs = await ev(`(() => {
      /* 🔴 J-37 第二款(到了那一页 ≠ 到了那一页的那个状态)· 店主 07f 裁 #66②:
         这里原来只认 ˋdata-fin-tabˋ / ˋdata-tabˋ / ˋrole=tabˋ ——
         而 admin.html 里现有**四族**标签页:fin(7) · member(5) · staff(4) · pricing(3)。
         **三族从来没被走到**,所以「考勤」「技师排班」「会员套餐」「价目」那些标签页下的字
         历次全扫一次都没量过。补齐,并在 JS 侧加一条覆盖面反向守(见 tabFamilies 那段)。 */
      const t = Array.from(document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)}))
        .filter((b) => b.offsetParent !== null)
      return t.map((b) => ({ id: b.id || '', label: (b.textContent || '').trim().slice(0, 12) }))
    })()`)
    const stops = tabs.length ? tabs : [{ id: '', label: '(整页)' }]
    for (const tab of stops) {
      if (tab.id) {
        await ev(`(() => { const b = document.getElementById(${JSON.stringify(tab.id)}); if (b) b.click(); return 1 })()`)
        await sleep(700)
      }
      const res = await ev(SWEEP)
      scanned += res.scanned
      grad += res.gradients || 0
      const errs = await takeErrors()
      if (errs.length) crashed.push({ page: `${p.name || p.key} · ${tab.label}`, mode, errs })
      for (const b of res.bad) bad.push({ 页: p.name || p.key, 标签: tab.label, 档: mode, ...b })
      if (mode === 'light') scannedPages.push(tab.label && tab.label !== '(整页)' ? `${p.name || p.key} · ${tab.label}` : (p.name || p.key))
      console.log(`   [扫] ${mode} · ${p.name || p.key} · ${tab.label} —— 文字节点 ${res.scanned} 个,红 ${res.bad.length} 条`)
    }
  }
}
}

/* ── 红榜 ────────────────────────────────────────────────── */
const A = bad.filter((b) => b.tier === 'A')
const B = bad.filter((b) => b.tier === 'B')
/* 同一处样式会在多个标签页里重复出现(比如 AI 总结那条挂在每一格上)——
   报告里**原始条数与去重条数都写**,免得「1,337 条」这种数字把真正的那几处淹掉。 */
const keyOf = (b) => `${b.档}|${b.sel}|${b.fg}|${b.bg}`
const uniq = (arr) => { const m = new Map(); for (const b of arr) if (!m.has(keyOf(b))) m.set(keyOf(b), b); return [...m.values()] }
const uA = uniq(A); const uB = uniq(B)
/* ── 「没扫的页」固定一节(店主 06i 裁 #42)────────────────────────────
   原话:「红榜报告里,『没扫的页』必须单列一节,写清页数与页名,
   不许和『已扫且绿』混进同一个数。」——一个只读数字的人会以为全扫完了。
   所以每份报告都给三个数:**扫到 X 页 / 该扫 Y 页 / 没扫的是这几页**。
   `CS_COVER` 给的是「该扫的全清单」;没给就只报扫到几页,并明说「没有声明应扫清单,算不出漏了几页」。 */
const uniqPages = [...new Set(scannedPages)]
const missPages = COVER.filter((x) => !uniqPages.some((y) => y === x || y.endsWith(x) || x.endsWith(y)))
const crashLines = crashed.length
  ? ['>', `> 🔴🔴 **这一跑有 ${crashed.length} 个「页 × 档」抛过错(J-47)** —— 它们这一轮的结论**一律作废**,`,
    '> 「元素没找到」和「这一页渲染崩了」是两个结论,不许混成一个:',
    ...crashed.map((c) => `> · **${c.page} · ${c.mode}** —— ${c.errs.join(' ;; ')}`)]
  : ['>', '> ✅ **页面错误:这一跑没有任何一页抛错**(J-47:有错先报错;收的是 onerror / unhandledrejection / console.error)']
const coverLines = [...crashLines, '>', '> 🔴 **覆盖面(这一节是固定的,不许省)**',
  COVER.length
    ? `> **扫到 ${uniqPages.length} 页 / 该扫 ${COVER.length} 页 / 没扫 ${missPages.length} 页**`
    : `> **扫到 ${uniqPages.length} 页**;这一跑没声明应扫清单(CS_COVER),**算不出漏了几页**`,
  `> 扫到的:${uniqPages.join(' · ') || '(一页都没扫到)'}`,
  ...(missPages.length ? [`> 🔴 **没扫的(不是绿,是没扫)**:${missPages.join(' · ')}`] : []),
  ...(stepMiss.length ? ['>', '> 🔴 **点不开、没扫成的**:', ...stepMiss.map((x) => `> · ${x}`)] : []),
  ...(AUTH_EMAIL ? ['>', `> 登录态夹具:\`${AUTH_EMAIL}\`(沙箱邮箱口,**不校验密码**;夹具里没有口令)`] : []),
]
const lines = ['# 深色/浅色 对比度红榜(逐页逐元素全扫)', '',
  `> 跑于 ${new Date().toISOString()} · 跑在 \`${BASE}\``,
  `> 🔴 **产出这份数的刀:\`tools/contrast-sweep.mjs\` @ ${KNIFE_REV}**(J-39:数要带尺子 —— 跟别的数比之前先比这一行)`,
  `> **被测代码:\`${CODE_REV}\`** · **界面文件内容指纹 \`${STYLE_SHA}\`**(${STYLE_FILES.join(' + ')} 的 sha256 前 12 位)`,
  '> 门槛:正文 **4.5:1**;大字(≥24px,或 ≥18.66px 且 700 粗)放宽到 **3:1**(每条都标了它用的是哪一档)',
  '> 扫的是**每一个自己持有文字的可见节点**,背景取「实际绘制的那一层」(自己透明就往上找祖先)',
  ...coverLines,
  '>',
  '> **两档**(理由见 `tools/contrast-sweep.mjs` 抬头):',
  '> · **甲档「看不见」** < 2:1(大字 < 1.6:1)—— 店主撞见的那种,**必须清零**;',
  '> · **乙档「AA 欠账」** 2–4.5:1 —— 多半是合同图配色本身(品牌金压白底 3.16:1、奶白压金按钮 2.32:1 那一类),**列出来待裁**,不当红线。', '',
  `**扫过 ${scanned} 个文字节点 · 甲档 ${A.length} 条(去重 ${uA.length})· 乙档 ${B.length} 条(去重 ${uB.length})**`,
  `> ⚠️ 另有 **${grad} 个**文字节点压在**渐变面**上 —— computed 拿不到渐变的实际色,这把刀**判不了**,`,
  '> 既没算进绿也没算进红。要覆盖它们得走截图取像素(登记待办)。', '']
const table = (arr, title) => {
  lines.push(`## ${title}`, '',
    '| 页面 | 标签页 | 档位 | 选择器 | 文字 | 前景 | 背景(来自) | 比值 | 门槛 |',
    '|---|---|---|---|---|---|---|---|---|')
  for (const b of arr.sort((x, y) => x.ratio - y.ratio)) {
    lines.push(`| ${b.页} | ${b.标签} | ${b.档} | \`${b.sel}\` | ${b.text} | ${b.fg} | ${b.bg}(\`${b.bgFrom}\`) | **${b.ratio}** | ${b.need} |`)
  }
  lines.push('')
}
table(uA, `甲档「看不见」—— 去重后 ${uA.length} 处(必须清零)`)
table(uB, `乙档「AA 欠账」—— 去重后 ${uB.length} 处(待裁:改它等于改合同图令牌)`)
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, lines.join('\n'), 'utf8'); console.log(`   [红榜] → ${OUT}`) }

/* 🔴 J-47:**有错先报错**。抛过错的页,这一轮它的「没找到」结论一律作废 —— 先把这件事摆在最前面。 */
if (crashed.length) {
  console.error(`\n🔴🔴 这一跑有 ${crashed.length} 个「页 × 档」**抛过错** —— 它们这一轮的对比度结论**一律作废**,`
    + '按「这一页崩了」报,不许说成「少了某个元素」:')
  for (const c of crashed) { console.error(`   · ${c.page} · ${c.mode}`); for (const e of c.errs) console.error(`       ${e}`) }
}
console.log(`\n[对比度全扫] 刀 ${KNIFE_REV} · 被测 ${CODE_REV}`)
console.log(`  文字节点 ${scanned} 个 · 压在渐变面上判不了的 ${grad} 个(如实报)`)
console.log(`  甲档「看不见」 ${A.length} 条(去重 ${uA.length} 处)· 乙档「AA 欠账」 ${B.length} 条(去重 ${uB.length} 处)`)
for (const b of uA.sort((x, y) => x.ratio - y.ratio).slice(0, 15)) {
  console.log(`  🔴甲 ${b.档} · ${b.页}/${b.标签} · ${b.sel} 「${b.text}」 ${b.fg} 压 ${b.bg} = ${b.ratio}:1(要 ${b.need}:1)`)
}
if (uA.length > 15) console.log(`  …… 甲档另有 ${uA.length - 15} 处,全文见红榜`)

ws.close(); chrome.kill()
/* 抛过错就不许报绿 —— 哪怕甲档是 0(那个 0 本身就不算数了) */
if (crashed.length && CAP !== null) {
  console.error(`\n❌ 有 ${crashed.length} 个「页 × 档」抛过错 —— 这一跑不许当绿`)
  ws.close(); chrome.kill(); process.exit(1)
}
if (CAP !== null) {
  /* 棘轮压的是**甲档去重后的处数** —— 乙档另有一条 CS_CAP_B(给了才判) */
  const capB = process.env.CS_CAP_B ? Number(process.env.CS_CAP_B) : null
  const capG = process.env.CS_CAP_GRAD ? Number(process.env.CS_CAP_GRAD) : null
  let bad2 = false
  if (uA.length <= CAP) console.log(`\n✅ 甲档 ${uA.length} 处 ≤ 棘轮 ${CAP}(只许降)`)
  else { console.error(`\n❌ 甲档 ${uA.length} 处 > 棘轮 ${CAP} —— 又多了看不见的字`); bad2 = true }
  if (capB !== null) {
    if (uB.length <= capB) console.log(`✅ 乙档 ${uB.length} 处 ≤ 棘轮 ${capB}`)
    else { console.error(`❌ 乙档 ${uB.length} 处 > 棘轮 ${capB}`); bad2 = true }
  }
  /* 渐变面上判不了的那些也上棘轮(店主 06a §三):
     「全站扫过」这句话现在有 14% 是空的,而渐变面正是最容易出白字压浅底的地方 —— 只许降。 */
  if (capG !== null) {
    if (grad <= capG) console.log(`✅ 渐变面上判不了的 ${grad} 个 ≤ 棘轮 ${capG}(只许降)`)
    else { console.error(`❌ 渐变面上判不了的 ${grad} 个 > 棘轮 ${capG} —— 又多了刀看不见的字`); bad2 = true }
  }
  process.exit(bad2 ? 1 : 0)
}
console.log('\n(没给 CS_CAP:这一跑只报数,不判红)')
process.exit(0)
