/* D168 · 「图=合同」的机械化 —— 设计令牌逐条比对(店主 05t 段 3 第 2 条)
 *
 * ══ 为什么要有这把刀 ══
 * 店主 05t 原话:「主页我看了一下,还是跟合同图不一样啊,包括字体、颜色、动效」
 * ——**皮不对是靠人眼比出来的**,比了三次才比出来。人眼比色是最不该由人做的事:
 * 一个 `#faf8f3` 写成 `#fbf8f5`,肉眼一辈子看不出来,而它就是「跟图不一样」的来源。
 * 所以这把刀现从**合同图**里抽 `:root` 三段,与仓里的令牌文件**逐条比名与值**,
 * 多一个、少一个、值差一位,当场红并点名是哪一条。
 *
 * ══ 比哪三份(店主 05t 段 3 第 1 条 + 段 4 第 1 条:三方一致)══
 *   ① 合同图    `handoff/商家端主页重画_两端设计图_2026-09-03.html`   —— 基准,谁都不许改它来迁就代码
 *   ② 网页      `apps/web/design-tokens.css`
 *   ③ 小程序    `miniprogram/styles/tokens.wxss`(段 4 落地后才有;没有就报「还没做」,不当成绿)
 *
 * ══ 判据形状:白名单式,不是「我列的都对」══
 * 不是「挑几个关键色比一比」——**基准里的每一条都必须在被测文件里出现且值全等**,
 * 反过来被测文件里也不许多出基准没有的令牌。少列一条就漏一条(白名单判据律)。
 *
 * 用法:node tools/design-token-diff.mjs            比全部(缺件报缺件)
 *      node tools/design-token-diff.mjs --web      只比网页那份
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const CONTRACT = join(ROOT, 'handoff/商家端主页重画_两端设计图_2026-09-03.html')
const WEB = join(ROOT, 'apps/web/design-tokens.css')
const MINI = join(ROOT, 'miniprogram/styles/tokens.wxss')

/* 三段各自的选择器 —— **顺序与名字都是基准的一部分**:
   ③ 必须排在 ② 后面,站内显式选的深色才压得过系统的。 */
const BLOCKS = [
  { key: 'light', head: ':root{', mini: 'page{' },
  { key: 'system-dark', head: ':root:not([data-theme="light"]){', mini: '@media (prefers-color-scheme: dark){page{' },
  /* 🔴 D183(夜班令6 段 3)之后,小程序**也有**站内选的那两档了。
     WXSS 没有 `:root`、根节点挂不了属性,所以它落在**页面最外层 view 的 class** 上
     (`.theme-light` / `.theme-dark`,见 `utils/theme.js` 抬头)。
     选择器不同、**值必须逐字相同** —— 同一个语义只许有一组值,这条正是这把刀要守的。 */
  { key: 'theme-dark', head: ':root[data-theme="dark"]{', mini: '.theme-dark{' },
  { key: 'theme-light(站内选浅色)', head: ':root{', mini: '.theme-light{', webSkip: true },
]

/** 从一段 CSS 文本里抽出某个选择器块的令牌表。
 *  故意写得笨:找到 `选择器{`,一路读到配对的 `}`,再按 `--名:值;` 拆。
 *  不用正则一把梭 —— 正则读嵌套(`@media` 里那一段)会读错,而读错的判据比没有判据更坏。 */
function tokensOf(cssRaw, head) {
  /* 🔴 先把注释剥掉再找 —— 现测栽过一次:`tokens.wxss` 的抬头注释里写着「`page{...}`」,
     `indexOf('page{')` 命中的是**注释里那一段**,于是读出一张空表,
     判据报「30 条全缺」而「值逐条全等」同时是绿的 —— 自相矛盾的绿。
     判据自己也会坏(店主:判据也是代码,也该有缺陷号)。 */
  const css = String(cssRaw).replace(/\/\*[\s\S]*?\*\//g, '')
  const at = css.indexOf(head)
  if (at < 0) return null
  const body = css.slice(at + head.length, css.indexOf('}', at))
  const out = new Map()
  for (const part of body.split(';')) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/is.exec(part)
    if (m) out.set(m[1], m[2].replace(/\s+/g, ''))
  }
  return out
}

const contract = readFileSync(CONTRACT, 'utf8')
let fails = 0
let n = 0
const say = (ok, name, detail = '') => {
  n += 1
  if (ok) console.log(`  ✅ ${name}`)
  else { fails += 1; console.log(`  🔴 ${name}${detail ? ` :: ${detail}` : ''}`) }
}

function compare(label, path, { required = true } = {}) {
  console.log(`\n── ${label}(${path.replace(ROOT, '')})`)
  if (!existsSync(path)) {
    if (required) say(false, `${label}:文件不存在`, path)
    else console.log(`  ⬜ 还没做(段 4 落地后这里必须变成三段全比)`)
    return
  }
  const css = readFileSync(path, 'utf8')
  const isMini = path.endsWith('.wxss')
  for (const b of BLOCKS) {
    if (!isMini && b.webSkip) continue      // 「站内选浅色」是小程序专有的一段(网页那边就是 :root 本身)
    const head = isMini ? b.mini : b.head
    if (isMini && head === null) {
      console.log(`  ⬜ ${b.key}:小程序没有这一段(只有跟系统的深色,没有站内主题开关)—— 见 tokens.wxss 抬头`)
      continue
    }
    const want = tokensOf(contract, b.head)
    const got = tokensOf(css, head)
    if (!want) { say(false, `合同图里找不到 ${b.head} 这一段`, '基准坏了,先修图'); continue }
    if (!got) { say(false, `${label} 缺 \`${head}\` 整段`, `合同图里有 ${want.size} 条`); continue }
    const missing = [...want.keys()].filter((k) => !got.has(k))
    const extra = [...got.keys()].filter((k) => !want.has(k))
    const diff = [...want.entries()].filter(([k, v]) => got.has(k) && got.get(k) !== v)
      .map(([k, v]) => `${k}: 图=${v} 仓=${got.get(k)}`)
    say(!missing.length, `${b.key}:一条不少(${want.size} 条)`, missing.join(' '))
    say(!extra.length, `${b.key}:一条不多`, extra.join(' '))
    say(!diff.length, `${b.key}:值逐条全等`, diff.join(' · '))
  }
}

console.log('════ 设计令牌 · 图=合同 逐条比对 ════')
console.log(`  基准:${CONTRACT.replace(ROOT, '')}`)
const only = process.argv.includes('--web') ? 'web' : (process.argv.includes('--mini') ? 'mini' : 'all')
if (only !== 'mini') compare('网页 design-tokens.css', WEB)
/* 小程序那份**不是可选的**:段 4 一落地它就必须在。现在还没有就明说「还没做」,
   不许因为文件不存在就当成绿(静默失败器族:缺件不许长得像通过)。 */
if (only !== 'web') compare('小程序 tokens.wxss', MINI, { required: existsSync(MINI) })

console.log(`\n共 ${n} 条,红 ${fails} 条`)
if (fails) { console.error('🔴 令牌与合同图对不上 —— 图是合同,改代码去凑图,不许改图来凑代码'); process.exit(1) }
console.log('✅ 令牌与合同图逐条一致')
