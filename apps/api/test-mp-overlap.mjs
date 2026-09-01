/* D103③ 文字重叠运行时刀(店主 02t 裁定三,2026-09-02 落)

   为什么与抽检刀分开:**尺寸刀守「97」,重叠刀守「间隙」,是两层不同的东西**(店主 02t 认了这个分层)。
   宿主高对了不等于不重叠 —— 间距、行高、外边距任何一处塌了都会压字,而宿主高照样 97。

   判据不写「间隙 >= 0」——**0 也是贴着,贴着就已经难看了**(店主 02t 原话)。
   照棘轮同构:**按现状冻结为下限,降即红、涨不管**(涨是留白变多,不是病)。

   量法(照搬 02s 复量脚本,不另写):逐盒取 offset/size 算相邻元素垂直间隙。
   带界定 —— 美睫那一节也有 `.recommend-card`,不清空就命中 2 个,量的可能是另一张卡
   (与 02m「量到另一张卡」同形状;02s 复量时**造态自证第一轮就把我拦住了**,这条写进刀里)。
   两态都量 —— D120 的病正是**占位态**才暴露的,只量有图态等于没量。 */

const PORT = process.env.MP_AUTO_PORT || 9420
const SPOT = '顾客端首页·人气美甲卡'
let checks = 0
function check(name, ok, detail = '') {
  checks += 1
  if (!ok) { console.error(`Error: ${name}: ${detail}`); process.exit(1) }
  console.log(`ok ${checks} - ${name}`)
}

const reachable = await fetch(`http://127.0.0.1:${PORT}`).then(() => true).catch(() => false)
if (!reachable) {
  console.log(`⚠️  [mp-overlap] 自动化端口 ${PORT} 不可达 —— **这一刀本轮未跑**(抽检位:${SPOT})`)
  console.log('   跑法:pkill -f wechatwebdevtools → 证死 → cli auto --project miniprogram --auto-port 9420 → 再跑本套件')
  process.exit(0)
}
import { createRequire } from 'node:module'
const requireCjs = createRequire(import.meta.url)
const AUTO_PATH = process.env.MP_AUTOMATOR || ''
let automator = null
try { automator = AUTO_PATH ? requireCjs(AUTO_PATH) : null } catch { automator = null }
if (!automator) {
  console.log(`⚠️  [mp-overlap] automator 不可用(MP_AUTOMATOR=${AUTO_PATH || '未设'})—— **这一刀本轮未跑**`)
  process.exit(0)
}

/* 沙箱前置走共用件(店主 02p 追问:别每把刀各打一个补丁) */
const { ensureSandbox } = await import('./test-need-sandbox.mjs')
const sb = await ensureSandbox({ label: '[mp-overlap]' })
console.log(`   [前置] 沙箱 4310 存活=${sb.ok}(共用前置件)`)
if (!sb.ok) process.exit(0)

const mp = await (automator.connect || automator.default.connect)
  .call(automator, { wsEndpoint: `ws://127.0.0.1:${PORT}`, timeout: 40000 })

const boxes = async (pg, sel) => {
  const els = await pg.$$(sel).catch(() => [])
  const out = []
  for (const e of els) {
    const o = await e.offset().catch(() => null)
    const z = await e.size().catch(() => null)
    if (o && z) out.push({ top: +o.top.toFixed(1), h: +z.height.toFixed(1), bottom: +(o.top + z.height).toFixed(1) })
  }
  return out
}
const show = (arr) => (arr.length ? arr.map((b) => `${b.top}→${b.bottom}`).join(',') : '不存在')

const IMG = 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400'
const proof = []

async function measure(label, img) {
  await mp.reLaunch('/pages/home/index')
  let pg = await mp.currentPage()
  await new Promise((r) => setTimeout(r, 3000))
  let nail = (await pg.data('recommendedNail')) || []
  if (!nail.length) {
    /* 沙箱刚拉起来可能还没取到数:重进一次 */
    await mp.reLaunch('/pages/home/index')
    pg = await mp.currentPage()
    await new Promise((r) => setTimeout(r, 3500))
    nail = (await pg.data('recommendedNail')) || []
  }
  if (!nail.length) {
    console.log(`⚠️  [mp-overlap] 首页推荐位 0 条 —— **这一刀本轮未跑**(造不出态)`)
    await mp.disconnect(); process.exit(0)
  }
  /* 界定:同时清空美睫,全页只留一张卡 */
  await pg.setData({ recommendedNail: [{ ...nail[0], image: img }], recommendedLash: [] })
  await new Promise((r) => setTimeout(r, 1200))

  const back = (await pg.data('recommendedNail')) || []
  const card = await boxes(pg, '.recommend-card')
  const host = await boxes(pg, 'img-placeholder')
  const name = await boxes(pg, '.recommend-name')
  const meta = await boxes(pg, '.recommend-meta')
  const titles = await boxes(pg, '.section-title')
  const phImg = (await pg.$$('.ph-img').catch(() => [])).length
  const phBox = (await pg.$$('.ph-box').catch(() => [])).length

  proof.push({
    label, dataCards: back.length, imageMatched: (back[0]?.image || '') === img,
    cardHits: card.length, hostHits: host.length, nameHits: name.length, metaHits: meta.length, phImg, phBox,
  })
  console.log(`   [${label}] 卡片[${show(card)}] 宿主[${show(host)}] 名[${show(name)}] 价格行[${show(meta)}]`
    + ` · ph-img ${phImg}/ph-box ${phBox}`)
  if (card.length !== 1) return null
  const hostBox = host[host.length - 1]   // 店卡轮播也是 img-placeholder;卡内那个是最后一个
  const next = titles.find((t) => t.top > card[0].bottom - 1)
  return {
    label,
    卡片高: card[0].h,
    宿主高: hostBox ? hostBox.h : null,
    宿主到名: hostBox && name[0] ? +(name[0].top - hostBox.bottom).toFixed(1) : null,
    名到价格: name[0] && meta[0] ? +(meta[0].top - name[0].bottom).toFixed(1) : null,
    卡到下节标题: next ? +(next.top - card[0].bottom).toFixed(1) : null,
    价格到卡底: meta[0] ? +(card[0].bottom - meta[0].bottom).toFixed(1) : null,
  }
}

const withImg = await measure('有图态', IMG)
const noImg = await measure('占位态', '')

/* ① 造态自证(两态各只留一张卡 · image 字段真换了 · 卡片真渲染) */
check(`① 造态自证:两态各只留一张卡、image 字段确实换了、卡片确实渲染出来了(抽检位:${SPOT})`,
  proof.length === 2 && proof.every((p) => p.dataCards === 1 && p.imageMatched && p.cardHits === 1),
  JSON.stringify(proof))

/* ② 互斥自证:两态渲染确实不同 —— 否则"间隙全等"可能只是 setData 没作用到渲染层
   (店主口诀:两个本该不同的数完全相同,永远先查测量、再信结论) */
check('② 互斥自证:有图态只有 .ph-img、占位态只有 .ph-box(证明量的是两个真不同的态)',
  proof[0]?.phImg >= 1 && proof[0]?.phBox === 0 && proof[1]?.phBox >= 1 && proof[1]?.phImg === 0,
  JSON.stringify(proof.map((p) => ({ label: p.label, phImg: p.phImg, phBox: p.phBox }))))

/* ③④ 四个间隙的下限棘轮(02s 复量现状冻结;降即红、涨不管) */
const FLOOR = { 宿主到名: 10, 名到价格: 5, 卡到下节标题: 16, 价格到卡底: 9 }
const below = []
for (const st of [withImg, noImg]) {
  if (!st) { below.push('某一态没量成'); continue }
  for (const [k, min] of Object.entries(FLOOR)) {
    const v = st[k]
    if (v === null || v === undefined) below.push(`${st.label}·${k}:量不到`)
    else if (v < min) below.push(`${st.label}·${k}=${v} < 下限 ${min}`)
  }
}
const fmt = (st) => (st ? `卡高 ${st.卡片高} / 宿主高 ${st.宿主高} / `
  + Object.keys(FLOOR).map((k) => `${k} ${st[k]}`).join(' / ') : '未量成')
check(`③ 四间隙不低于现状下限(宿主→名 ${FLOOR.宿主到名} · 名→价格 ${FLOOR.名到价格}`
  + ` · 卡→下节标题 ${FLOOR.卡到下节标题} · 价格→卡底 ${FLOOR.价格到卡底};降即红、涨不管)`,
  below.length === 0, below.join(' | '))

/* 🔴 04t 造病验红咬出的:原来这条只比四个间隙,而间隙是 margin ——
   把 height 改回 auto(D120 本身的病)时两态卡高塌成 90 vs 140、宿主 0 vs 50,
   **四个间隙却依旧全等,这条照样绿**。店主 02t 的验收线明写「把卡片高度改回 auto → 必须红」,
   而且名字说的是"两态一致",读者会以为它管布局一致 —— 名实不符。
   改为比**布局**:卡片高 + 宿主高 + 四间隙全都要两态相等。 */
const sameKeys = ['卡片高', '宿主高', ...Object.keys(FLOOR)]
const diff = (withImg && noImg) ? sameKeys.filter((k) => withImg[k] !== noImg[k]) : ['某一态没量成']
check('④ 两态布局一致:卡片高/宿主高/四间隙逐项相等(占位态不许比有图态更挤或更矮)',
  diff.length === 0,
  `不一致 ${diff.length} 项:${diff.map((k) => `${k} 有图 ${withImg?.[k]} vs 占位 ${noImg?.[k]}`).join(' | ')}`)

console.log(`   [间隙] 有图态 ${fmt(withImg)}`)
console.log(`   [间隙] 占位态 ${fmt(noImg)}`)
console.log(`\n[mp-overlap] all ${checks} checks passed(抽检位:${SPOT};下限=02s 复量现状冻结)`)
await mp.disconnect()
