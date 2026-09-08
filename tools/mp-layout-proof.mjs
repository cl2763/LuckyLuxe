#!/usr/bin/env node
/* D178 判据 · 小程序首页**按图排版**——在开发者工具里量真节点(夜班令6 段 4)
 *
 * ══ 为什么是量节点而不是截图 ══
 * 现测(D167 的下一层):`miniprogram-automator` 在这台机器上**只有 `screenshot()` 卡死**,
 * `connect` / `currentPage` / `pageStack` / `$$` / 元素尺寸这些全都正常(探针见回执)。
 * 所以图交不出来,但**量得到**:
 *   · 五个小数是不是一行五列 → 五个元素的 `top` 相等、`left` 递增;
 *   · 大数字是不是三段 → 三个子节点 + 字号 3:1 递减;
 *   · 长店名会不会被切 → `.greeting` 的 `overflow/text-overflow`;
 *   · 轮播放大的那一格是不是「位置留着、数字淡出」→ 它还在、`opacity` 变小。
 * 「像素给不到就明说」——这把刀出的是**布局数字**,不是「看起来对」。
 *
 * 每一个 automator 调用都套硬超时(D167 同款):卡住就当场说是哪一步卡的,不装死。
 *
 * 用法:MP_AUTOMATOR=<模块绝对路径> node tools/mp-layout-proof.mjs
 */
import { createRequire } from 'node:module'

const AUTO = process.env.MP_AUTOMATOR
if (!AUTO || AUTO === 'skip') {
  console.error('\n🔴 MP_AUTOMATOR 没给(或 =skip)—— **这一刀本轮未跑**,不是通过。')
  process.exit(1)
}
const PORT = Number(process.env.MP_AUTO_PORT || 9420)
const WS = `ws://${'127.0.0.1'}:${PORT}`
const automator = createRequire(import.meta.url)(AUTO)
const T = (p, ms, what) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`automator 卡住了(${ms}ms):${what}`)), ms)),
])

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const mp = await T((automator.connect || automator.default.connect).call(automator, { wsEndpoint: WS, timeout: 20000 }), 25000, 'connect')
const page = await T(mp.currentPage(), 8000, 'currentPage')
console.log(`   [连上了] 当前页 ${page.path}`)
if (!/merchant\/home/.test(page.path || '')) {
  console.error(`🔴 当前不在商家首页(在 ${page.path})—— 请先在开发者工具里打开商家首页再跑这一刀`)
  process.exit(2)
}

/* 量一个选择器下所有元素的位置与尺寸 */
async function boxes(sel) {
  const els = await T(page.$$(sel), 8000, `$$(${sel})`)
  const out = []
  for (const el of els) {
    const off = await T(el.offset(), 5000, `offset(${sel})`)
    const size = await T(el.size(), 5000, `size(${sel})`)
    out.push({ ...off, ...size })
  }
  return out
}
const styleOf = async (sel, prop) => {
  const el = await T(page.$(sel), 8000, `$(${sel})`)
  if (!el) return ''
  try { return await T(el.attribute('style'), 4000, `style(${sel})`) || (await T(el.wxml(), 4000, `wxml(${sel})`)) } catch { return '' }
}

/* ① 五个小数:一行五列 —— top 全等、left 严格递增 */
const smalls = await boxes('.dh-small')
check('① 五个小数是 5 个', smalls.length === 5, `实测 ${smalls.length} 个`)
const tops = [...new Set(smalls.map((b) => Math.round(b.top)))]
check('①b 五个都在**同一行**(top 相等 —— 她截图里是两行 3+2)', tops.length === 1, `top 有 ${tops.length} 种:${tops.join(' / ')}`)
const lefts = smalls.map((b) => Math.round(b.left))
check('①c 五个从左到右排开(left 严格递增)', lefts.every((v, i) => i === 0 || v > lefts[i - 1]), lefts.join(' < '))
/* ①d 每一格宽度接近相等 = `repeat(5,1fr)` 的效果(不是 flex-wrap 挤出来的) */
const ws = smalls.map((b) => Math.round(b.width))
check('①d 五格等宽(repeat(5,1fr) 的效果)', Math.max(...ws) - Math.min(...ws) <= 2, ws.join(' / '))

/* ② 大数字三段 —— 三个节点、主数最高。
   🔴 选择器要**按类名单独取**:automator 的 `$$` 对 `>` 子代组合器与 `.a.b` 复合类
   都不按浏览器那套解析(现测:`.dh-big > text` 只回 1 个、`.dh-dot-i.on` 回的是普通那颗)。
   「刀落了不红先怀疑刀」的同族:**这次是选择器写法不对,不是页面不对**
   —— 同一时刻 `page.data()` 里 headParts 三段齐、dots 有一颗 on:true。 */
const bigCode = await boxes('.dh-big-code')
const bigNum = await boxes('.dh-big-num')
const bigCent = await boxes('.dh-big-cent')
check('② 大数字是**三段**(币码 / 主数 / 分位;非金额指标没有币码与分位)',
  bigNum.length === 1 && bigCode.length <= 1 && bigCent.length <= 1,
  `币码 ${bigCode.length} · 主数 ${bigNum.length} · 分位 ${bigCent.length}`)
if (bigCode.length && bigCent.length) {
  const h = [bigCode[0].height, bigNum[0].height, bigCent[0].height].map((x) => Math.round(x))
  check('②b 主数最高、币码最小(图上 3.3rem / 1.2rem / 1.6rem 那个层级)',
    h[1] > h[2] && h[2] >= h[0], `币码 ${h[0]} · 主数 ${h[1]} · 分位 ${h[2]}`)
} else {
  console.log(`   [说明] 当前轮播位是**非金额指标**(没有币码与分位),这一条不适用 —— 不算通过也不算红`)
}

/* ③ 五个数任何时刻都在屏上:被放大的那一格**还在**(位置保留),只是淡出 */
const dims = await boxes('.dh-small.dim')
check('③ 轮播放大的那一格没有消失(位置保留、数字淡出)', dims.length <= 1, `实测 ${dims.length} 格`)
if (dims.length === 1) check('③b 它还占着位(宽高都不是 0)', dims[0].width > 0 && dims[0].height > 0, JSON.stringify(dims[0]))

/* ④ 顶行:店名那一行不许溢出到屏幕外 */
const top = await boxes('.greeting')
const sys = await T(mp.systemInfo ? mp.systemInfo() : Promise.resolve({ windowWidth: 375 }), 6000, 'systemInfo').catch(() => ({ windowWidth: 375 }))
const winW = Number(sys.windowWidth || 375)
check('④ 顶行店名整块落在屏内(左 ≥ 0、右 ≤ 屏宽)',
  top.length === 1 && top[0].left >= 0 && top[0].left + top[0].width <= winW + 1,
  top.length ? `left=${Math.round(top[0].left)} 宽=${Math.round(top[0].width)} 屏宽=${winW}` : '没找到 .greeting')

/* ⑤ dots:5 个,选中的那个更宽(胶囊) */
const dots = await boxes('.dh-dot-i')
check('⑤ dots 是 5 个', dots.length === 5, `实测 ${dots.length}`)
/* 复合类选择器取不到,改成**比宽度**:五颗里必须恰好有一颗明显更宽(那就是选中的胶囊) */
const dw = dots.map((d) => Math.round(d.width))
const wide = dw.filter((w) => w > Math.min(...dw) + 2)
check('⑤b 恰好一颗是胶囊(比别的宽 —— 「看得出来它在转」的那一半)',
  wide.length === 1, `五颗宽度:${dw.join(' / ')}`)

/* ⑥ D182 折线:**画布里真有金色墨** —— 页面画完自己数了一遍(`sparkInk`),这里读它。
   为什么不用截图:`mp.screenshot()` 在这台机器上卡死(待裁 #21),
   从画布**里面**取像素是唯一还剩的实证。 */
const data = await T(page.data(), 8000, 'page.data')
const ink = Number((data || {}).sparkInk)
if ((data || {}).sparkCanvas === false) {
  console.log('   [说明] 这台设备拿不到 canvas 上下文,折线**落回柱形**(保底那条路)—— 不算红')
} else {
  check('⑥ 折线画布里有金色墨(> 0 说明真画上了,不是一块空画布)', ink > 0, `sparkInk=${ink}`)
  console.log(`   [取证] 金色像素 ${ink} 个;造病(去掉渐变填充)时同一处量到 1994、装着渐变时 2683 —— 差的就是那层填充`)
}

console.log(`\n[小程序布局实测] 五小数 ${smalls.length} 格 · 大数 ${bigCode.length + bigNum.length + bigCent.length} 段 · dots ${dots.length} 个 · 屏宽 ${winW}`)
console.log('⚠️  截图交不出来:这台机器上 automator 的 `screenshot()` 卡死(别的调用都正常),')
console.log('    所以本段证据是**布局实测数字**,不是图。像素给不到就明说(J-32 不许拿 DOM 冒充截图)。')
if (fails.length) { console.error(`\n❌ mp-layout-proof ${fails.length}/${n} 条未过`); process.exit(1) }
console.log(`\n✅ mp-layout-proof 通过 ${n} 条`)
process.exit(0)
