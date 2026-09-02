/* 首页分区四态刀 + 整体守(店主 02z 裁定,2026-09-02 落)

   D103② 的真修法是「该分区少于 2 张时整块不出现」。**但那条规则落地会长出一个新态**:
   新店第一天开张、项目还没配够 → 两区都不出现 → 顾客打开首页只剩一张店卡
   和一个点进去空空如也的作品入口。**第一个撞上的很可能是小婕的店。**

   所以判据不是三态是**四态**(0/1/2/3 张),外加一条**整体守**:
   两区都不出现时,首页可见区块数不许低于下限。
   —— 整体守防的正是缺席可见律要防的那件事:**每块各自"不出现是对的",合起来首页空了却没人管。**

   量法照 mp-overlap:逐盒取 offset/size,造态自证两问,量数带界定(命中数 + 不存在写"不存在")。 */

const PORT = process.env.MP_AUTO_PORT || 9420
const SPOT = '顾客端首页·人气分区'
let checks = 0
function check(name, ok, detail = '') {
  checks += 1
  if (!ok) { console.error(`Error: ${name}: ${detail}`); process.exit(1) }
  console.log(`ok ${checks} - ${name}`)
}

const reachable = await fetch(`http://127.0.0.1:${PORT}`).then(() => true).catch(() => false)
if (!reachable) {
  console.log(`⚠️  [mp-home-sections] 自动化端口 ${PORT} 不可达 —— **这一刀本轮未跑**(抽检位:${SPOT})`)
  process.exit(0)
}
import { createRequire } from 'node:module'
const requireCjs = createRequire(import.meta.url)
const AUTO_PATH = process.env.MP_AUTOMATOR || ''
let automator = null
try { automator = AUTO_PATH ? requireCjs(AUTO_PATH) : null } catch { automator = null }
if (!automator) {
  console.log(`⚠️  [mp-home-sections] automator 不可用(MP_AUTOMATOR=${AUTO_PATH || '未设'})—— **这一刀本轮未跑**`)
  process.exit(0)
}
const { ensureSandbox } = await import('./test-need-sandbox.mjs')
const sb = await ensureSandbox({ label: '[mp-home-sections]' })
console.log(`   [前置] 沙箱 4310 存活=${sb.ok}(共用前置件)`)
if (!sb.ok) process.exit(0)

const mp = await (automator.connect || automator.default.connect)
  .call(automator, { wsEndpoint: `ws://127.0.0.1:${PORT}`, timeout: 40000 })

const boxes = async (pg, sel) => {
  const els = await pg.$$(sel).catch(() => [])
  const out = []
  for (const e of els) {
    const o = await e.offset().catch(() => null); const z = await e.size().catch(() => null)
    if (o && z) out.push({ l: +o.left.toFixed(1), t: +o.top.toFixed(1), w: +z.width.toFixed(1), h: +z.height.toFixed(1) })
  }
  return out
}
const IMG = 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400'
const proof = []

/* 造 n 张美甲卡、美睫恒 0(界定:全页只留被测那一区的卡) */
async function state(n) {
  await mp.reLaunch('/pages/home/index')
  let pg = await mp.currentPage()
  await new Promise((r) => setTimeout(r, 3000))
  let base = (await pg.data('recommendedNail')) || []
  if (!base.length) {
    await mp.reLaunch('/pages/home/index'); pg = await mp.currentPage()
    await new Promise((r) => setTimeout(r, 3500)); base = (await pg.data('recommendedNail')) || []
  }
  if (!base.length) {
    console.log('⚠️  [mp-home-sections] 首页推荐位 0 条 —— **这一刀本轮未跑**(造不出态)')
    await mp.disconnect(); process.exit(0)
  }
  const cards = Array.from({ length: n }, (_, i) => ({ ...base[0], _id: `fx-${i}`, name: `造态${i + 1}`, price: 100 + i * 30, duration: 60 + i * 15, image: i % 2 ? '' : IMG }))
  await pg.setData({ recommendedNail: cards, recommendedLash: [] })
  await new Promise((r) => setTimeout(r, 1100))
  const back = (await pg.data('recommendedNail')) || []
  const titles = await boxes(pg, '.section-title')
  /* 🔴 界定(量数带界定):兜底块「我们的服务」也用 .recommend-card ——
     不减掉它,0 卡态会数出 2 张兜底卡而误判成"人气分区没藏住"。
     首跑就是栽在这里:红的是我的界定,不是产品。 */
  const allCards = await boxes(pg, '.recommend-card')
  const fbCards = await boxes(pg, '.fallback-card')
  const cardBoxes = allCards.slice(0, allCards.length - fbCards.length)
  /* 🔴 03a 现测发现的真问题:原来整体守数 `.home-section-container` —— **容器里空了照样算一块**。
     所以「服务总数 0」那一态它不会误红(店主的预测这一半不成立),但**绿得没有意义**:
     一个空容器让它绿了,那正是"合起来首页空了却没人管"的另一种形态。
     改成只数**有内容的块**:高度 > 40px 才算(空容器只剩内边距,量出来是几 px)。 */
  const rawSections = await boxes(pg, '.home-section-container')
  const sections = rawSections.filter((x) => x.h > 40)
  const emptyNote = await boxes(pg, '.fallback-empty')
  proof.push({ n, dataN: back.length, titles: titles.length, popular: cardBoxes.length, fallback: fbCards.length,
    sections: sections.length, rawSections: rawSections.length, emptyNote: emptyNote.length })
  console.log(`   [${n}] data=${back.length} · 标题 ${titles.length} · 人气卡 ${cardBoxes.length || '不存在'}`
    + ` · 兜底卡 ${fbCards.length || '不存在'} · 真话块 ${emptyNote.length || '不存在'}`
    + ` · 有内容区块 ${sections.length}(容器 ${rawSections.length})`)
  return { n, titles, cardBoxes, sections, emptyNote }
}

/* 第五态(店主 03a):**服务总数 = 0**(新店真的什么都没配)——
   不是"人气数 0",三个数组全空。正确行为是**出那句真话**,不是凑够三块。 */
async function stateNoService() {
  await mp.reLaunch('/pages/home/index')
  const pg = await mp.currentPage()
  await new Promise((r) => setTimeout(r, 3000))
  await pg.setData({ recommendedNail: [], recommendedLash: [], fallbackServices: [] })
  await new Promise((r) => setTimeout(r, 1100))
  const cnt = async (sel) => (await boxes(pg, sel))
  const note = await cnt('.fallback-empty')
  const el = await pg.$('.fallback-empty').catch(() => null)
  const txt = el ? await el.text().catch(() => '') : ''
  const raw = await cnt('.home-section-container')
  const secs = raw.filter((x) => x.h > 40)
  console.log(`   [服务总数 0] 人气卡 ${(await cnt('.recommend-card')).length - (await cnt('.fallback-card')).length || '不存在'}`
    + ` · 兜底卡 ${(await cnt('.fallback-card')).length || '不存在'} · 真话块 ${note.length || '不存在'}`
    + ` · 有内容区块 ${secs.length} · 真话 DOM 实读=${JSON.stringify(txt)}`)
  return { note, secs, txt, cards: (await cnt('.recommend-card')).length, fb: (await cnt('.fallback-card')).length }
}

const s0 = await state(0)
const s1 = await state(1)
const s2 = await state(2)
const s3 = await state(3)

/* ① 造态自证:每一态 data 里的条数就是我造的那个数 */
check(`① 造态自证:四态 data 条数 = 造的条数(0/1/2/3),不是"设了没生效"(抽检位:${SPOT})`,
  proof.length === 4 && proof.every((p) => p.dataN === p.n), JSON.stringify(proof))

/* ②③ 0 卡 / 1 卡:该分区整块不出现(含标题)——「标题也是一种承诺」 */
check('② 0 卡态:该分区整块不出现(标题一并不出;光标题=承诺了有得挑却什么都没有)',
  s0.cardBoxes.length === 0, `卡命中 ${s0.cardBoxes.length}`)
check('③ 1 卡态:该分区整块不出现(1 张占半幅右半空着 / 占满整行又比 2 卡态大一倍,两条路都更怪)',
  s1.cardBoxes.length === 0, `卡命中 ${s1.cardBoxes.length}`)

/* ④⑤ 2 卡 / 3 卡:出现,且排版正确 */
const rowsOf = (c) => { const r = {}; c.forEach((x) => { (r[x.t] ||= []).push(x) }); return r }
const r2 = rowsOf(s2.cardBoxes); const k2 = Object.keys(r2)
check('④ 2 卡态:分区出现,两张同一行排满(1 行 × 2 列)',
  s2.cardBoxes.length === 2 && k2.length === 1, `卡 ${s2.cardBoxes.length} 行 ${k2.length}`)
const r3 = rowsOf(s3.cardBoxes); const k3 = Object.keys(r3).map(Number).sort((a, b) => a - b)
const w3 = s3.cardBoxes.map((x) => x.w); const h3 = new Set(s3.cardBoxes.map((x) => x.h))
/* 等宽容差 1px:容器宽与列间距相除必有亚像素舍入((404-8.5)/2=197.75 → 198/197),
   任何 2 列 1fr 在奇数宽上都这样;超过 1px 才是真不等宽。 */
check('⑤ 3 卡态:2 列 × 2 行 · 等宽(极差 ≤1px,亚像素舍入)· 等高',
  s3.cardBoxes.length === 3 && k3.length === 2 && (Math.max(...w3) - Math.min(...w3)) <= 1 && h3.size === 1,
  `卡 ${s3.cardBoxes.length} 行 ${k3.length} 宽极差 ${(Math.max(...w3) - Math.min(...w3)).toFixed(1)} 高种类 ${h3.size}`)

/* ⑥ 🔴 整体守:两区都不出现时,首页可见区块数不许低于下限。
   下限 = 店卡 + 作品入口 + 兜底「我们的服务」= 3。
   这一条防的是「每块各自不出现都是对的、合起来首页空了却没人管」。 */
const HOME_BLOCK_MIN = 3
/* 🔴 整体守 = **两个合法态,不是一个下限**(店主 03a 裁):
   「有内容的区块 >= 下限」**或者**「那句真话在场」,满足其一即绿,两者都没有才红。
   为什么不能只写下限:服务总数 0 时正确行为恰恰是出那句真话而不是凑够三块 ——
   **一把在正确状态下会红的刀,迟早被人为了绿而放宽下限,那就再也守不住了。** */
const wholeOk = (st) => st.sections.length >= HOME_BLOCK_MIN || st.emptyNote.length >= 1
check(`⑥ 🔴 整体守(两个合法态):1 卡态 有内容区块 ${s1.sections.length} >= ${HOME_BLOCK_MIN} 或 真话块在场 ${s1.emptyNote.length}`,
  wholeOk(s1), JSON.stringify({ sections: s1.sections.length, note: s1.emptyNote.length }))
check(`⑥b 0 卡态同守:区块 ${s0.sections.length} 或 真话块 ${s0.emptyNote.length}`,
  wholeOk(s0), JSON.stringify({ sections: s0.sections.length, note: s0.emptyNote.length }))

/* ⑦⑧ 第五态:服务总数 0 —— 人气与兜底卡都不出,**那句真话必须出**,整体守走第二个合法态 */
const sN = await stateNoService()
check('⑦ 服务总数 0 态:人气卡与兜底卡都不出现,**那句真话出现且有字**(不是空白块)',
  sN.cards - sN.fb === 0 && sN.fb === 0 && sN.note.length === 1 && String(sN.txt).trim().length > 0,
  JSON.stringify({ 人气: sN.cards - sN.fb, 兜底: sN.fb, 真话块: sN.note.length, 文字: sN.txt }))
check(`⑧ 服务总数 0 态·整体守走第二个合法态:有内容区块 ${sN.secs.length} 或 真话块 ${sN.note.length}`,
  sN.secs.length >= HOME_BLOCK_MIN || sN.note.length >= 1,
  JSON.stringify({ sections: sN.secs.length, note: sN.note.length }))

console.log(`\n[mp-home-sections] all ${checks} checks passed(抽检位:${SPOT};四态 0/1/2/3 + 整体守下限 ${HOME_BLOCK_MIN})`)
await mp.disconnect()
