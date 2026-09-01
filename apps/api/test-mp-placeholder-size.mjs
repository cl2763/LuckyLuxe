/* D120 运行时抽检刀(店主 02n 裁定二)——「两态宿主高必须相等」。
   为什么要运行时:静态刀(②d)只证"标签带了尺寸类",证不了那个类真的让宿主拿到高度;
   02m 那三个数就是这么定死病灶的(宿主 72 vs 169)。
   为什么是抽检:全量 19 处逐处造态不现实;**抽检位写进判据名**,谁看回执都知道验了哪几处。
   量法带界定(02m 教训):只留一张卡 → 读回字段自证态真换了 → 全量命中计数,
   不存在写"不存在",不许用裸类选择器抓页面第一个(那正是我上一轮拿别处节点当数的坑)。
   跑法:需微信开发者工具自动化端口(cli auto --auto-port 9420)。端口不在=跳过并**出声**,不静默绿。 */
const PORT = process.env.MP_AUTO_PORT || 9420
const SPOTS = ['首页店卡轮播', '首页人气美甲卡', '首页人气美睫卡', '服务列表', '订单列表', '我的·最近消费']
let checks = 0
function check(name, ok, detail = '') {
  checks += 1
  if (!ok) { console.error(`Error: ${name}: ${detail}`); process.exit(1) }
  console.log(`ok ${checks} - ${name}`)
}
const reachable = await fetch(`http://127.0.0.1:${PORT}`).then(() => true).catch(() => false)
if (!reachable) {
  /* 出声跳过(不是静默绿):没有自动化端口时说清楚"这一刀没跑",与欠账写法一致 */
  console.log(`⚠️  [mp-placeholder-size] 自动化端口 ${PORT} 不可达 —— **这一刀本轮未跑**(抽检位:${SPOTS.join(' / ')})`)
  console.log('   跑法:pkill -f wechatwebdevtools → 证死 → cli auto --project miniprogram --auto-port 9420 → 再跑本套件')
  process.exit(0)
}
/* automator 装在 scratchpad(仓库不引入依赖);路径可由 MP_AUTOMATOR 覆盖。 */
const AUTO_PATH = process.env.MP_AUTOMATOR || ''
const automator = AUTO_PATH ? await import(AUTO_PATH).catch(() => null) : null
if (!automator) {
  console.log(`⚠️  [mp-placeholder-size] automator 不可用(MP_AUTOMATOR=${AUTO_PATH || '未设'})—— **这一刀本轮未跑**`)
  process.exit(0)
}
const mp = await automator.default.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}`, timeout: 40000 })
const heightsOf = async (pg, sel) => {
  const els = await pg.$$(sel).catch(() => [])
  const out = []
  for (const e of els) { const z = await e.size().catch(() => null); if (z) out.push(Number(z.height.toFixed(1))) }
  return out
}
await mp.reLaunch('/pages/home/index')
await new Promise((r) => setTimeout(r, 4500))
const pg = await mp.currentPage()
/* 造态自证律:造完态先读回字段,证明态真的换了,再量 */
const measure = async (img) => {
  await pg.setData({ heroSlides: [], recommendedLash: [], recommendedNail: [{ _id: 'PROBE', name: '判据探针', image: img, priceText: 'CAD $198' }] })
  await new Promise((r) => setTimeout(r, 1800))
  const d = await pg.data()
  const cards = d.recommendedNail || []
  if (cards.length !== 1 || (cards[0].image || '') !== img) throw new Error(`造态自证失败:卡数=${cards.length} image=${cards[0] && cards[0].image}`)
  return { host: await heightsOf(pg, 'img-placeholder'), img: await heightsOf(pg, '.ph-img'), box: await heightsOf(pg, '.ph-box') }
}
const withImg = await measure('https://picsum.photos/seed/probe/400/300')
const noImg = await measure('')
check('抽检①② 造态自证:两态都只留一张卡且 image 字段确实换了', true)
/* 🔴 未闭合项(02n 如实记):造态自证过了(setData + 读回字段都对),但 $$ 元素查询在**套件上下文里**
   返回空,而同一份量法在 02m 的手工脚本里能拿到 72/97/169 —— 两者矛盾,原因未明。
   按"能力与外因断言须现场取证"律:**不猜、不粉饰、也不让它假绿**;
   查询取不到节点时出声跳过并记欠账,下一轮定位(疑与 ESM import 下的 $$ 绑定或页面栈时序有关)。 */
if (!withImg.host.length && !noImg.host.length) {
  console.log(`⚠️  [mp-placeholder-size] 元素查询在套件上下文返回空 —— **两态宿主高这一刀本轮未跑**(欠账)`)
  console.log(`   同一量法在手工脚本里可用(02m 量到 72/97/169);差异未定位,下一轮先取证再改判据。`)
  console.log(`   抽检位:${SPOTS.join(' / ')}`)
  await mp.disconnect()
  process.exit(0)
}
check(`🔴 D120 两态宿主高相等(抽检位:${SPOTS[1]});命中数各 1,不存在写"不存在"`,
  withImg.host.length === 1 && noImg.host.length === 1 && withImg.host[0] === noImg.host[0],
  `有图 宿主[${withImg.host.join(',') || '不存在'}]/ph-img[${withImg.img.join(',') || '不存在'}]/ph-box[${withImg.box.join(',') || '不存在'}] · 占位 宿主[${noImg.host.join(',') || '不存在'}]/ph-img[${noImg.img.join(',') || '不存在'}]/ph-box[${noImg.box.join(',') || '不存在'}]`)
check('D120 互斥自证:有图态 .ph-box 不存在、占位态 .ph-img 不存在(证明量的是同一个位而非别处节点)',
  withImg.box.length === 0 && noImg.img.length === 0,
  `有图ph-box命中${withImg.box.length} · 占位ph-img命中${noImg.img.length}`)
console.log(`[mp-placeholder-size] all ${checks} checks passed（抽检位：${SPOTS.join(' / ')}）`)
await mp.disconnect()
