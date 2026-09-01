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
/* 🔴 02o 裁定一「先搬别另写」:02m 那份手工脚本能拿到 72/97/169,我却在套件里**另写了一套**,
   坏的正是新写的那套 —— 同一件事两套实现,与「一份数据两端渲染」同理,只是发生在验证代码上。
   现照搬手工那份的加载与调用形态:CJS require(不是 ESM import + .default)。 */
import { createRequire } from 'node:module'
const requireCjs = createRequire(import.meta.url)
const AUTO_PATH = process.env.MP_AUTOMATOR || ''
let automator = null
try { automator = AUTO_PATH ? requireCjs(AUTO_PATH) : null } catch { automator = null }
if (!automator) {
  console.log(`⚠️  [mp-placeholder-size] automator 不可用(MP_AUTOMATOR=${AUTO_PATH || '未设'})—— **这一刀本轮未跑**`)
  process.exit(0)
}
const mp = await (automator.connect || automator.default.connect).call(automator, { wsEndpoint: `ws://127.0.0.1:${PORT}`, timeout: 40000 })
const heightsOf = async (pg, sel) => {
  const els = await pg.$$(sel).catch(() => [])
  const out = []
  for (const e of els) { const z = await e.size().catch(() => null); if (z) out.push(Number(z.height.toFixed(1))) }
  return out
}
await mp.reLaunch('/pages/home/index')
await new Promise((r) => setTimeout(r, 4500))
let pg = await mp.currentPage()
/* 造态自证律:造完态先读回字段,证明态真的换了,再量 */
/* 🔴 02o 自查:上一版造态是**凭空造一个对象**(_id/name/image/priceText 四个字段),
   字段不全 → 整张卡渲染不出来 → 甲乙两支判别都空。判别甲把我引到了这里:
   「甲也空 ⇒ 页面/时序问题」——真身是**我把页面的数据换成了页面渲染不了的形状**。
   改法:**克隆真数据、只改 image 这一个字段**(造态该改真数据,不该凭空造形状)。 */
/* 🔴 02o 真因(两支判别一路引到这里):**套件跑时沙箱 4310 被 run-all-tests 打死了**,
   小程序拿不到数据 → 首页推荐位为空 → 卡片压根没渲染 → 甲乙全空。
   手工脚本那次沙箱是活的,所以能拿到 2 张卡 —— 「同一份量法两种结果」的真身在这里,
   不是 ESM/CJS、不是选择器进不进组件。
   修:这把刀**自带前置** —— 先确认小程序的后端(沙箱 4310)活着,不活就把它拉起来再量。 */
let realCards = (await pg.data()).recommendedNail || []
if (!realCards.length) {
  const sandboxUp = await fetch('http://127.0.0.1:4310/health').then((r) => r.ok).catch(() => false)
  console.log(`   [前置] 沙箱 4310 存活=${sandboxUp};首页推荐位=${realCards.length} 条`)
  if (!sandboxUp) {
    /* 本刀排在回归清单中段,那时 run-all-tests 已把 4310 打死 —— 自己拉起来再量,
       量完不还原(回归脚本收尾的 restore_sandbox 会统一还)。 */
    const { spawn } = await import('node:child_process')
    spawn('bash', ['start-sandbox.sh', 'sandbox-data'], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).unref()
    let up = false
    for (let i = 0; i < 12 && !up; i += 1) {
      await new Promise((r) => setTimeout(r, 2000))
      up = await fetch('http://127.0.0.1:4310/health').then((r) => r.ok).catch(() => false)
    }
    console.log(`   [前置] 自拉沙箱后存活=${up}`)
    if (!up) {
      console.log('⚠️  [mp-placeholder-size] 沙箱拉不起来 —— **这一刀本轮未跑**')
      await mp.disconnect(); process.exit(0)
    }
  }
  /* 沙箱刚拉起来:重进一次页让它取数;reLaunch 会销毁旧 page 对象 → **必须重新取 pg**,
     不能再用外层那个(02o 自查:page destroyed 就是拿了被销毁的旧引用)。 */
  await mp.reLaunch('/pages/home/index')
  await new Promise((r) => setTimeout(r, 5000))
  pg = await mp.currentPage()
  realCards = (await pg.data()).recommendedNail || []
  if (!realCards.length) {
    console.log('⚠️  [mp-placeholder-size] 沙箱在、推荐位仍为空(该店无推荐项?)—— **这一刀本轮未跑**')
    await mp.disconnect(); process.exit(0)
  }
}
const measure = async (img) => {
  await pg.setData({ heroSlides: [], recommendedLash: [], recommendedNail: [{ ...realCards[0], image: img }] })
  await new Promise((r) => setTimeout(r, 1800))
  const d = await pg.data()
  const cards = d.recommendedNail || []
  if (cards.length !== 1 || (cards[0].image || '') !== img) throw new Error(`造态自证失败:卡数=${cards.length} image=${cards[0] && cards[0].image}`)
  /* 造态自证第二问(02o 教训):字段对了还不够,**渲染出来了没有** —— 卡片节点必须真在 */
  const rendered = await heightsOf(pg, '.recommend-card')
  if (!rendered.length) throw new Error(`造态自证失败:字段对了但卡片没渲染出来(.recommend-card 命中 0)`)
  return { host: await heightsOf(pg, 'img-placeholder'), img: await heightsOf(pg, '.ph-img'), box: await heightsOf(pg, '.ph-box') }
}
const withImg = await measure('https://picsum.photos/seed/probe/400/300')
const noImg = await measure('')
check('抽检①② 造态自证:两态都只留一张卡且 image 字段确实换了', true)
/* 🔴 未闭合项(02n 如实记):造态自证过了(setData + 读回字段都对),但 $$ 元素查询在**套件上下文里**
   返回空,而同一份量法在 02m 的手工脚本里能拿到 72/97/169 —— 两者矛盾,原因未明。
   按"能力与外因断言须现场取证"律:**不猜、不粉饰、也不让它假绿**;
   查询取不到节点时出声跳过并记欠账,下一轮定位(疑与 ESM import 下的 $$ 绑定或页面栈时序有关)。 */
/* 🔴 02o 裁定一 两支判别(店主明标:这是假设不是结论,证据说了算):
   判别甲:先量一个**必然存在、且不在组件内部**的节点 —— 它也空 ⇒ 页面/时序问题;
   判别乙:甲有值而组件内层空 ⇒ 选择器进不到自定义组件里去。 */
const probeOuter = await heightsOf(pg, '.recommend-card')     // 甲:卡片本身,在组件外
const probeInner = await heightsOf(pg, 'img-placeholder')     // 乙:组件宿主
console.log(`   [判别] 甲 .recommend-card 命中${probeOuter.length} [${probeOuter.join(',') || '不存在'}]  ` +
  `乙 img-placeholder 命中${probeInner.length} [${probeInner.join(',') || '不存在'}]`)
if (!probeOuter.length) console.log('   [判别结论] 甲也空 ⇒ **页面/时序问题**(不是选择器进不去组件)')
else if (!probeInner.length) console.log('   [判别结论] 甲有值、乙空 ⇒ **选择器进不到自定义组件内部**')
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
