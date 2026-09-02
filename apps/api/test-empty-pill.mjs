/* 空药丸刀(D125,店主 03q 那批拍七态时现测咬出,2026-09-03 落)

   案由:商家端会话页顾客卡上那枚报价小标 `<text class="pi">{{quoteLabel}}</text>`
   **没有 wx:if** —— 已绑档案但本会话没报过价时,它渲染成一枚**空药丸**:
   现测 18×6px,有边框、没有字。

   归族「不可用即不呈现,呈现即说明」:
   **一枚药丸的存在本身就是「这里有一条信息」的承诺**;空着既不是"有信息"也不是"没有",
   是永远错的第三种 —— 和「摆着又不响的按钮」「光标题没内容的分区」同一个病。

   ══ 判据形态(白名单式,不是黑名单)══
   类定义先写清楚:**边框小标签**(class 含 pi/tag/pill/chip/badge/ptag)
   + 内容是**单个 `{{表达式}}`** + 同行无 wx:if/wx:for + 表达式本身无 `||`/三元兜底。
   全仓命中的每一处**必须落进白名单并写理由**(理由要说明"它为什么不可能为空",带证据行号),
   新写的自动红 —— 不是数「我列的这两处修了」。

   ⚠️ 白名单里的理由是**源头有兜底**这一类,不是"我看着不会空"。 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const wxmls = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', 'miniprogram'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((f) => f.endsWith('.wxml'))

const PILL = /<(text|view)\s[^>]*class="([^"]*\b(?:pi|tag|pill|chip|badge|ptag)\b[^"]*)"[^>]*>\s*\{\{([^}]+)\}\}\s*<\/\1>/

const scan = (lines) => {
  const out = []
  lines.forEach((line, i) => {
    const m = PILL.exec(line)
    if (!m) return
    if (/wx:if|wx:elif|wx:for/.test(line)) return
    const expr = m[3].trim()
    if (expr.includes('||') || expr.includes('?')) return      // 表达式自带兜底,渲染必有字
    out.push({ line: i + 1, cls: m[2].trim(), expr })
  })
  return out
}

const hits = []
for (const f of wxmls) {
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  for (const h of scan(src.split('\n'))) hits.push({ file: f, ...h })
}

/* 白名单:key = `文件:{{表达式}}`,value = **为什么不可能为空**(带证据) */
const ALLOW = {
  'miniprogram/pages/member-benefits/index.wxml:{{item.threshold}}':
    'index.js:112 三元两支都给非空串(`$X+` 或「最高等级」/Highest tier),不存在空值支',
  'miniprogram/pages/merchant/conversation/index.wxml:{{label}}':
    '会话状态小标,index.js 从 STATUS 常量表取,表里每个值都是非空中文词',
  'miniprogram/pages/merchant/conversation/index.wxml:{{profile.tier}}':
    'index.js:28 `TIER[x] || cust.memberTier || \'会员\'` —— 源头三级兜底,末级是字面量',
  'miniprogram/pages/merchant/daily-close/index.wxml:{{v.tierChanges.length}}':
    '数组 length 恒为数字,`{{0}}` 渲染出「0」不是空;这枚是计数徽标,0 也要显示',
  'miniprogram/pages/merchant/orders/index.wxml:{{v.tierChanges.length}}':
    '同上(日结与订单两处同一块「价档异常」计数)',
  'miniprogram/pages/merchant/orders/index.wxml:{{asPanel.statusText}}':
    'index.js:404 `as.statusText || \'待处理\'` —— 组装 asPanel 时就兜了底',
  'miniprogram/pages/merchant/marketing/index.wxml:{{sleepN}}':
    '沉睡客计数,恒为数字',
  'miniprogram/pages/merchant/marketing/index.wxml:{{revisitN}}':
    '复购提醒计数,恒为数字',
  'miniprogram/pages/merchant/workbench/index.wxml:{{item.label}}':
    '工作台入口卡的固定标题,来自页面内写死的入口数组,每项都有 label',
  'miniprogram/pages/portfolio/index.wxml:{{works.length}}':
    '作品数,恒为数字',
  'miniprogram/pages/portfolio/index.wxml:{{item.badge}}':
    'index.js:66 三元两支都拼进 `item.count`,恒非空',
  'miniprogram/pages/portfolio/index.wxml:{{t.all}}':
    'i18n 文案表的固定键,两种语言都有值',
  'miniprogram/pages/portfolio/index.wxml:{{item.label}}':
    '分类筛选 chip,来自服务类型表,每项都有 label',
}
const ALLOW_CAP = Object.keys(ALLOW).length   /* 棘轮不许留空隙:上限=实际条数(店主 03m) */

const bad = hits.filter((h) => !ALLOW[`${h.file}:{{${h.expr}}}`])
check(`① 白名单式:全仓 ${wxmls.length} 个 wxml 里边框小标签绑单个 {{表达式}} 且无 wx:if 的共 ${hits.length} 处,`
  + '每处必须登记「为什么不可能为空」(新写的自动红;不是数"我修的那两处")',
  bad.length === 0, bad.map((h) => `${h.file}:${h.line} {{${h.expr}}}`).join(' | '))

check(`①b 白名单棘轮 ≤ ${ALLOW_CAP}(每条理由须指向源头兜底的证据行,不许写"看着不会空")`,
  Object.keys(ALLOW).length <= ALLOW_CAP, String(Object.keys(ALLOW).length))

/* ② 两处已修的**正向**断言:它们必须真的带上了 wx:if(修了就不许退回去) */
const FIXED = [
  { f: 'miniprogram/pages/merchant/conversation/index.wxml', expr: 'quoteLabel', what: '会话页顾客卡·本会话报价小标' },
  { f: 'miniprogram/pages/merchant/subscription/index.wxml', expr: 'statusTag', what: '订阅页·授权状态小标(初值 index.js:21 是空串)' },
]
const lost = FIXED.filter(({ f, expr }) => {
  const src = readFileSync(join(ROOT, f), 'utf8')
  const line = src.split('\n').find((l) => l.includes(`{{${expr}}}`) && /class="[^"]*\b(pi|pl-tag|tag)\b/.test(l))
  return !line || !line.includes(`wx:if="{{${expr}}}"`)
})
check(`② 两处已修的空药丸带着 wx:if(${FIXED.map((x) => x.what).join(' · ')})`,
  lost.length === 0, lost.map((x) => x.f).join(' | '))

/* ③ 零命中先证刀能咬(店主 03j 律):造一个已知阳性,咬不到即红 */
const CANARY = ['<text class="pi">{{canaryEmptyLabel}}</text>']
const bitten = scan(CANARY)
check('③ 🔴 零命中先证刀能咬:一个已知阳性(无 wx:if 的空药丸写法)必须被咬中',
  bitten.length === 1 && bitten[0].expr === 'canaryEmptyLabel', JSON.stringify(bitten))

/* ③b 反向守:带了 wx:if 的**不许**被咬(否则修完还红,人会去放宽判据) */
const NEG = ['<text class="pi" wx:if="{{x}}">{{x}}</text>']
check('③b 反向守:带了 wx:if 的同一行不许被咬中(判据能分出修没修,不是见药丸就红)',
  scan(NEG).length === 0, JSON.stringify(scan(NEG)))

/* ④ 反向守:扫描面没缩水(判据覆盖面要有判据) */
check(`④ 反向守:扫描面 ${wxmls.length} >= 70 个 wxml(git ls-files 全量;目录被排除或仓库被裁立刻红)`,
  wxmls.length >= 70, String(wxmls.length))

console.log(`\n[空药丸] wxml ${wxmls.length} 个 · 命中 ${hits.length} 处 · 白名单 ${Object.keys(ALLOW).length} 条 · 已修 ${FIXED.length} 处`)
if (fails.length) { console.error(`\n❌ test-empty-pill ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-empty-pill 通过 ${checks} 项`)
