/* 币符硬编码全仓扫描(店主 2026-08-10 拍板,《财务记账总逻辑》v1.4 §八)。

   教训:B-2 那轮只扫了**商家端**(7 页改成 storeMoney()),顾客端一处没动 ——
   Jie'Nail 是境内 ¥ 店,顾客看到的每一个价格币种都是错的,而商家端同一张单显示 ¥。
   影响面清单没覆盖两端,是这次的根因。所以把"别再写死币符"钉进常驻套件:
   商家端 + 顾客端 + 网页,任何一处写死字面币符都红。

   币种一律走映射表(后端 CURRENCY_DISPLAY → currencyDisplay 下发),
   小程序商家端用 storeMoney()、顾客端用 storecurrency 的 curOf()/money(),
   网页用 money()。白名单只有映射表本身那一处。 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `:\n${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

// 扫描范围:两端小程序 + 网页前端
const SCAN_DIRS = ['miniprogram/pages', 'miniprogram/utils', 'miniprogram/components', 'apps/web']
const EXT = /\.(js|wxml|wxss|html|css)$/

/* 白名单:币种映射表本身 + 定义默认值的地方 —— 那里出现币符是天经地义的。
   放行必须精确到文件,不许按目录放行(否则等于没扫)。 */
const ALLOW = new Set([
  'apps/api/local-server.mjs',        // 映射表 CURRENCY_DISPLAY 的老家(不在扫描范围内,列出以示口径)
  'miniprogram/utils/money.js',       // 只负责按下发的 display 拼串,自己不认识任何币种
  'miniprogram/utils/storeclock.js',  // 商家端币种缓存,默认值在这里
  'miniprogram/utils/storecurrency.js', // 顾客端币种缓存,默认值在这里
  /* 下面两处是**有迹卖 SaaS 的定价**(¥1,380/年 之类),固定人民币标价,
     不跟门店币种走 —— 与 apps/web/platform.html 同一口径,不算硬编码。 */
  'miniprogram/pages/merchant/subscription/index.js',
  'miniprogram/pages/merchant/subscription/index.wxml'
])

// 写死的币符:CAD $ / US$ / ¥ / RMB / CNY ¥ 这类字面量
const BAD = [
  /* 写死 "CAD $" 永远是错的 —— 门店币种由映射表决定,全仓通扫。 */
  { re: /CAD\s*\$/g, label: 'CAD $', scope: 'all' },
  { re: /US\s*\$/g, label: 'US $', scope: 'all' },
  { re: /RMB\s*[¥￥]/g, label: 'RMB ¥', scope: 'all' },
  /* 裸 ¥ 只在**门店币种语境**里算错(小程序两端)。
     平台后台卖 SaaS 的定价(¥1,380/年 之类)本来就是人民币标价,不跟门店币种走,不算硬编码。 */
  { re: /[¥￥]/g, label: '¥ / ￥', scope: 'mini' },
  /* 2026-08-10 补漏:**裸 $** 之前一条规则都没管,于是
     `定金 ${{item.payableAmount}}`(顾客端消费记录/最近消费)、`储值${{profile.stored}}`(商家端会话)
     和 `'$0'` 这类初始占位全部躲过了扫描 —— Jie'Nail 顾客点开订单看到的就是「定金 $50」。
     模板里 `$` 紧挨着 `{{`、代码里引号紧跟 `$数字`,只可能是币符,一律红。
     (JS 模板字符串是 `${` 单花括号,不会被这条误伤。) */
  { re: /\$\s*\{\{/g, label: '$ 紧贴 {{(写死美元符)', scope: 'all' },
  { re: /['"`]\$\d/g, label: "'$0' 这类写死币符的占位", scope: 'all', skipIf: /\.replace\(|new RegExp/ },
  /* 🔴 R4 第三次复发之后补的(店主 2026-08-10 开检:会员充值页 $ 与 ¥ 混用)。
     前两条规则都要求 $ 后面**紧跟着东西**($数字 / ${{ ),于是漏掉了两种最常见的写法:
       ① 引号里孤零零一个 '$'   —— member/index.js 的 `rvCurrency: '$'`(输入框 placeholder)
       ② 字符串拼接 '$' + 金额  —— admin.js 的 `mMoney = '$' + cents/100`
     这就是"扫描器为什么没咬住"的答案:规则只认了带尾巴的形态。 */
  { re: /['"`]\$['"`]/g, label: "孤立的 '$' 字面量(拿它当币符用)", scope: 'all' },
  { re: /['"`]\$['"`]\s*\+/g, label: "'$' + 金额 这种拼接", scope: 'all' },
  { re: /['"`][¥￥]['"`]/g, label: "孤立的 '¥' 字面量", scope: 'mini' }
]

function walk(dir, out = []) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
  check(`扫描范围覆盖两端 + 网页(${files.length} 个文件)`, files.length >= 80, String(files.length))

  const hits = []
  for (const abs of files) {
    const rel = relative(ROOT, abs)
    if (ALLOW.has(rel)) continue
    const src = readFileSync(abs, 'utf8')
    src.split('\n').forEach((line, i) => {
      // 注释行不算(注释里说"不写死 ¥"是允许的)
      const code = line.replace(/\/\/.*$/, '').replace(/<!--[\s\S]*?-->/g, '')
      const isMini = rel.startsWith('miniprogram/')
      /* 行级豁免:只给**币种映射表本身**用(默认值那一行天生要出现币符)。
         比文件级白名单更严 —— 白名单放行整个文件,这个只放行打了标记的那一行。 */
      if (/currency-map/.test(line)) return
      for (const b of BAD) {
        if (b.scope === 'mini' && !isMini) continue
        // 正则替换串里的 $1/$2 是反向引用,不是币符
        if (b.skipIf && b.skipIf.test(code)) continue
        b.re.lastIndex = 0
        if (b.re.test(code)) hits.push(`${rel}:${i + 1}  [${b.label}]  ${line.trim().slice(0, 100)}`)
      }
    })
  }
  check('全仓没有写死的币符(商家端 + 顾客端 + 网页)', hits.length === 0,
    `${hits.length} 处:\n${hits.slice(0, 40).join('\n')}`)

  // 顾客端确实接上了币种源(不是把币符删了了事)
  const curUtil = readFileSync(join(ROOT, 'miniprogram/utils/storecurrency.js'), 'utf8')
  /* 2026-08-10:这里原来断言的是 getStores —— 而 getStores() 返回的是门店**数组**,
     顶层 currencyDisplay 早在那一步就被丢了,缓存一次也写不进去。断言"接上了源"却接了个空,
     所以改成断言取币种的专用接口;真正落没落进缓存由 test-double-sheet 的行为断言把关。 */
  check('顾客端币种走公开 /stores 下发的 currencyDisplay(与商家端同一套映射表)',
    curUtil.includes('getStoreCurrency') && curUtil.includes('currencyDisplay'), curUtil.slice(0, 120))

  console.log(`\n币符硬编码扫描通过:${checks} 项断言全绿`)
}

try { main() } catch (error) {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
}
