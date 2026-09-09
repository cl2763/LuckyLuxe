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
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { requireTarget } from './db-target.mjs'

const BASE = requireTarget({ envName: 'SHOT_BASE', value: process.env.SHOT_BASE, hint: '(只打本机沙箱,例 http://127.0.0.1:4310)' })
const TOKEN = requireTarget({ envName: 'SHOT_TOKEN', value: process.env.SHOT_TOKEN, hint: '(开发主钥匙,启动日志里那一串;不写进代码)' })
const CHROME = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SHOT_PORT || 9336)
const CAP = process.env.CS_CAP ? Number(process.env.CS_CAP) : null
const OUT = process.env.CS_OUT || ''
const ONLY = (process.env.CS_PAGES || '').split(',').map((x) => x.trim()).filter(Boolean)
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
    const got = ratio(fg, bg.c)
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
      const bgTxt = 'rgb(' + [bg.c.r, bg.c.g, bg.c.b].map((x) => Math.round(x)).join(', ') + ')'
      out.push({ sel: selOf(el), text: text.slice(0, 20), fg: cs.color, bg: bgTxt,
        bgFrom: selOf(bg.from), ratio: Math.round(got * 100) / 100, need, size: Math.round(size), weight,
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
const pages = await ev(`Array.from(document.querySelectorAll('[data-admin-page]'))
  .map((b) => ({ key: b.dataset.adminPage, name: (b.textContent || '').trim() }))
  .filter((x, i, a) => x.key && a.findIndex((y) => y.key === x.key) === i)`)
const targets = ONLY.length ? pages.filter((p) => ONLY.includes(p.key)) : pages
console.log(`   [侧栏] 共 ${pages.length} 页,这一跑扫 ${targets.length} 页`)

const bad = []
let scanned = 0
let grad = 0   /* 背景是渐变、这把刀判不了的节点数(如实报,不混进绿也不混进红) */
for (const mode of ['light', 'dark']) {
  await setTheme(mode)
  for (const p of targets) {
    const ok = await ev(`(() => { const b = document.querySelector('[data-admin-page="${p.key}"]'); if (!b) return 0; b.click(); return 1 })()`)
    if (!ok) continue
    await sleep(900)
    /* 页内标签页:财务那种有 `data-fin-tab`,别的页有各自的;统一按「按钮上带 data-*-tab」找 */
    const tabs = await ev(`(() => {
      const t = Array.from(document.querySelectorAll('button[data-fin-tab], button[data-tab], [role="tab"]'))
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
      for (const b of res.bad) bad.push({ 页: p.name || p.key, 标签: tab.label, 档: mode, ...b })
      console.log(`   [扫] ${mode} · ${p.name || p.key} · ${tab.label} —— 文字节点 ${res.scanned} 个,红 ${res.bad.length} 条`)
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
const lines = ['# 深色/浅色 对比度红榜(逐页逐元素全扫)', '',
  `> 跑于 ${new Date().toISOString()} · 跑在 \`${BASE}\``,
  `> 🔴 **产出这份数的刀:\`tools/contrast-sweep.mjs\` @ ${KNIFE_REV}**(J-39:数要带尺子 —— 跟别的数比之前先比这一行)`,
  `> **被测代码:\`${CODE_REV}\`**`,
  '> 门槛:正文 **4.5:1**;大字(≥24px,或 ≥18.66px 且 700 粗)放宽到 **3:1**(每条都标了它用的是哪一档)',
  '> 扫的是**每一个自己持有文字的可见节点**,背景取「实际绘制的那一层」(自己透明就往上找祖先)',
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

console.log(`\n[对比度全扫] 刀 ${KNIFE_REV} · 被测 ${CODE_REV}`)
console.log(`  文字节点 ${scanned} 个 · 压在渐变面上判不了的 ${grad} 个(如实报)`)
console.log(`  甲档「看不见」 ${A.length} 条(去重 ${uA.length} 处)· 乙档「AA 欠账」 ${B.length} 条(去重 ${uB.length} 处)`)
for (const b of uA.sort((x, y) => x.ratio - y.ratio).slice(0, 15)) {
  console.log(`  🔴甲 ${b.档} · ${b.页}/${b.标签} · ${b.sel} 「${b.text}」 ${b.fg} 压 ${b.bg} = ${b.ratio}:1(要 ${b.need}:1)`)
}
if (uA.length > 15) console.log(`  …… 甲档另有 ${uA.length - 15} 处,全文见红榜`)

ws.close(); chrome.kill()
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
