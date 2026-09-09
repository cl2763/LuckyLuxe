#!/usr/bin/env node
/* 夜7 段2 下半 · **小程序顾客端**的对比度 —— 量得到的量,量不到的如实说
 *
 * ══ 为什么不能照搬网页那把刀 ══
 * 网页那把刀能逐个文字节点往上找「实际绘制的那一层」,靠的是 DOM。
 * 小程序**没有 DOM**:唯一能拿到 computed 的口子是
 * `createSelectorQuery().selectAll(...).fields({ computedStyle: [...] })` ——
 * 它给得到**每个节点自己的** color / backgroundColor,**给不到父链**。
 * 所以「这个字压在哪块面上」在小程序里**拿不到**,硬猜就是编。
 *
 * ══ 那就换一个**更严**的判法(保守但诚实)══
 * 每页先量两块**面**:①页面根(`.page`/`.pg`/`.wrap` 那一层)②卡片(`.card`/`.dh-card`/`.group`/`.rowcard`)。
 * 然后对每个有文字的节点,**同时**跟这两块面算对比度,取**较差的那个**当成绩。
 *   · 过了 → 它压在哪一块上都安全(所以这是**保守**的判法,不会漏报);
 *   · 没过 → 报出来,并注明它是「对根」还是「对卡」不过 —— 由人再看一眼。
 * 拿不到面(某页没有卡)就只跟根比,并在报告里标明。
 *
 * 用法:MP_AUTOMATOR=<模块绝对路径> node tools/mp-contrast-probe.mjs [light|dark] [页,...]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const AUTO = process.env.MP_AUTOMATOR
if (!AUTO || AUTO === 'skip') {
  console.error('\n🔴 MP_AUTOMATOR 没给(或 =skip)—— **这一刀本轮未跑**,不是通过。')
  process.exit(1)
}
const MODE = (process.argv[2] || 'dark').toLowerCase()
const PAGES = (process.argv[3] || [
  '/pages/home/index', '/pages/services/index', '/pages/cart/index', '/pages/me/index',
  '/pages/mall/index', '/pages/card-pack/index',
].join(',')).split(',').map((x) => x.trim()).filter(Boolean)
const OUT = process.env.MPC_OUT || ''

const KNIFE_REV = (() => {   /* J-39:数要带尺子 */
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', 'tools/mp-contrast-probe.mjs'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'tools/mp-contrast-probe.mjs'], { encoding: 'utf8' }).trim()
    return `${sha || '(未提交)'}${dirty ? '+dirty' : ''}`
  } catch { return '(取不到)' }
})()
const CODE_REV = (() => {
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', 'miniprogram'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'miniprogram'], { encoding: 'utf8' }).trim()
    return `miniprogram @ ${sha}${dirty ? '+dirty' : ''}`
  } catch { return '(取不到)' }
})()

const automator = createRequire(import.meta.url)(AUTO)
const T = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`automator 卡住了(${ms}ms):${what}`)), ms))])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const parse = (c) => {
  const m = String(c || '').match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const p = m[1].split(',').map((x) => parseFloat(x))
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
}
const lum = (c) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
const ratio = (a, b) => {
  const l1 = lum(a); const l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const mp = await T((automator.connect || automator.default.connect).call(automator,
  { wsEndpoint: `ws://127.0.0.1:${Number(process.env.MP_AUTO_PORT || 9420)}`, timeout: 20000 }), 25000, 'connect')
await T(mp.evaluate((m) => { wx.setStorageSync('ll-theme', m) }, MODE), 8000, 'setTheme')

const rows = []
const notes = []
for (const path of PAGES) {
  try {
    await T(mp.reLaunch(path), 20000, `reLaunch ${path}`)
    await sleep(2600)
    /* 🔴 头一版用 `wx.createSelectorQuery().selectAll('text, view')` —— **一个都选不到**:
       小程序的选择器**不支持标签名**(只认 class / id 那一套),于是「量到 0 个节点」还报「甲档 0」——
       典型的绿在空气上。automator 的 `page.$$('view')` 走的是另一条路,**认标签**,现测 view 60 个 / text 35 个。
       所以改用它,逐个 `.style()` 取 computed(慢一点,但真量得到)。 */
    const page = await T(mp.currentPage(), 8000, 'currentPage')
    const rootEls = await T(page.$$('.page, .pg, .wrap'), 9000, 'root')
    const cardEls = await T(page.$$('.card, .dh-card, .group, .rowcard, .mcard'), 9000, 'card')
    const rootBg = parse(rootEls[0] ? await T(rootEls[0].style('background-color'), 6000, 'rootbg') : '')
    const cardBg = parse(cardEls[0] ? await T(cardEls[0].style('background-color'), 6000, 'cardbg') : '')
    if (!rootBg || rootBg.a < 0.5) { notes.push(`${path}:量不到页面根的底色 —— 这一页**没验成**(不是绿)`); continue }
    const textEls = await T(page.$$('text'), 9000, 'text')
    let n = 0
    for (const el of textEls.slice(0, 60)) {
      let txt = ''; let color = ''; let ownBg = ''; let size = null
      try {
        txt = String(await T(el.text(), 4000, 'text()') || '').trim()
        if (!txt) continue
        color = await T(el.style('color'), 4000, 'color')
        ownBg = await T(el.style('background-color'), 4000, 'bg')
        size = await T(el.size(), 4000, 'size')
      } catch { continue }
      const fg = parse(color)
      if (!fg || fg.a < 0.1) continue
      if (!size || !(size.width > 1 && size.height > 1)) continue
      const need = 4.5
      const hard = 2
      const own = parse(ownBg)
      const against = own && own.a > 0.5 ? [own] : [rootBg, cardBg].filter((c) => c && c.a > 0.5)
      if (!against.length) continue
      const got2 = Math.min(...against.map((bg) => ratio(fg, bg)))
      n += 1
      if (got2 + 0.05 < need) {
        rows.push({ page: path, mode: MODE, text: txt.slice(0, 14), fg: color,
          bgs: against.map((b) => `rgb(${Math.round(b.r)}, ${Math.round(b.g)}, ${Math.round(b.b)})`).join(' / '),
          ratio: Math.round(got2 * 100) / 100, need, tier: got2 + 0.05 < hard ? 'A' : 'B' })
      }
    }
    if (n === 0) { notes.push(`${path}:一个文字节点都没量到 —— 这一页**没验成**(不是绿)`) }
    console.log(`   [扫] ${MODE} · ${path} —— 量到文字 ${n} 个 · 根底 rgb(${Math.round(rootBg.r)}, ${Math.round(rootBg.g)}, ${Math.round(rootBg.b)})`
      + ` · 卡底 ${cardBg ? `rgb(${Math.round(cardBg.r)}, ${Math.round(cardBg.g)}, ${Math.round(cardBg.b)})` : '(这页没有卡)'}`)
  } catch (e) {
    notes.push(`${path}:${e.message} —— 这一页**没验成**(不是绿)`)
    console.log(`   [跳] ${path}:${e.message}`)
  }
}
try { await T(mp.evaluate(() => { wx.setStorageSync('ll-theme', 'system') }), 6000, 'reset') } catch { /* 收摊尽力 */ }
try { await T(mp.disconnect(), 5000, 'disconnect') } catch { /* 同上 */ }

const A = rows.filter((r) => r.tier === 'A')
const B = rows.filter((r) => r.tier === 'B')
console.log(`\n[小程序顾客端 · ${MODE} 档] 刀 ${KNIFE_REV} · 被测 ${CODE_REV}`)
console.log(`  甲档「看不见」 ${A.length} 条 · 乙档「AA 欠账」 ${B.length} 条 · 没验成的页 ${notes.length} 个`)
for (const r of A.slice(0, 12)) console.log(`  🔴甲 ${r.page} ${r.fg} 压 ${r.bgs} = ${r.ratio}:1(要 ${r.need}:1)`)
for (const x of notes) console.log(`  ⚠️ ${x}`)

if (OUT) {
  const lines = [`# 小程序顾客端 对比度(${MODE} 档)`, '',
    `> 跑于 ${new Date().toISOString()}`,
    `> 🔴 **产出这份数的刀:\`tools/mp-contrast-probe.mjs\` @ ${KNIFE_REV}**(J-39)· **被测 \`${CODE_REV}\`**`, '',
    '> **量法与网页那把不一样,说清楚**:小程序没有 DOM,拿不到「这个字压在哪一层面上」。',
    '> 所以每页只量两块面(页面根 / 卡片),每个文字节点**同时**跟这两块比、取较差的那个 ——',
    '> **这是保守的判法**:过了就说明它压在哪块上都安全;没过要人再看一眼。', '',
    `**甲档 ${A.length} 条 · 乙档 ${B.length} 条 · 没验成的页 ${notes.length} 个**`, '',
    '| 页 | 档 | 文字 | 前景 | 比的面 | 比值 | 门槛 | 档次 |', '|---|---|---|---|---|---|---|---|']
  for (const r of rows.sort((a, b) => a.ratio - b.ratio)) {
    lines.push(`| ${r.page} | ${r.mode} | ${r.text || ''} | ${r.fg} | ${r.bgs} | **${r.ratio}** | ${r.need} | ${r.tier === 'A' ? '甲(看不见)' : '乙(AA 欠账)'} |`)
  }
  if (notes.length) { lines.push('', '## 没验成的(不是绿)', ''); for (const x of notes) lines.push(`- ${x}`) }
  mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log(`  [报告] → ${OUT}`)
}
/* 🔴 一页都没量到 = 这一跑什么都没证明,**不许报绿**(头一版就是这么绿在空气上的) */
if (rows.length === 0 && notes.length === PAGES.length) { console.error('\n❌ 每一页都没验成 —— 这一跑不算数'); process.exit(2) }
process.exit(A.length ? 1 : 0)
