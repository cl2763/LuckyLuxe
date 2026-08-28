/* 小程序钱输入框全量审计(店主 2026-08-28 排进批次二第③件)。

   起因:店主 08-27 在**网页端**实测「打了 1 就被重画一次,5 和 0 丢了」,当天立了族规:
   **钱的输入框,输入过程中不许重画。** 小程序端登记为待排,至少 1 处同病
   (`pages/merchant/member` 的 `onRvAmount`)。这一批把两端拉平。

   判据一律**白名单式**(店主 08-27《白名单判据律》:判据不许靠列举被测对象):
     ① 被测集合从 wxml **现扫**:全仓每一个 `<input bindinput=...>` 都要过一遍,新加的自动纳入;
     ② 违规集合必须为空 —— 而不是"我列的那几个是好的";
     ③ `type="number"` 的框逐个必须落进「不是金额」白名单,每项写一行理由,条目数上棘轮。

   什么叫「输入过程中重画」(判据要能证伪):
     handler 把敲进来的值**加工过再 setData 回同一个绑定字段** —— 每敲一下重画一次,
     而且回写的内容跟手指敲的不一样,连着敲就丢字符 / 光标跳 / 空格被吃掉。
     回写**原样**(`setData({x: e.detail.value})`)不算这个病:内容没被改写。
     最稳的写法是根本不回写(值只进 this.data,视图不重画)—— 本批新写的两处就是这么做的。

   ⚠️ standalone:CI_SUITES="mini-money-inputs" bash apps/api/run-all-tests.sh */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../miniprogram')
let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

const walk = (dir, re, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(abs, re, out) } else if (re.test(e.name)) out.push(abs)
  }
  return out
}

function bodyOf(src, name) {
  const m = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?${name}\\s*\\(`, 'm').exec(src)
  if (!m) return ''
  const open = src.indexOf('{', m.index + m[0].length - 1)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1) }
  }
  return ''
}

/* 被测集合:全仓 wxml 里每一个带 bindinput 且绑了 value 的 <input>。 */
const inputs = []
const allTags = []          // 全部 <input>,一个不漏 —— 覆盖面本身要有判据
const complexBinding = []   // value 绑的是表达式(不是简单字段),下面单独兜
for (const file of walk(ROOT, /\.wxml$/)) {
  const src = readFileSync(file, 'utf8')
  for (const tag of src.match(/<input\b[^>]*>/g) || []) {
    const attr = (n) => (new RegExp(`${n}="([^"]*)"`).exec(tag) || [, ''])[1]
    const page = file.slice(ROOT.length + 1)
    const handler = attr('bindinput')
    const valueExpr = (/\{\{([\s\S]*?)\}\}/.exec(attr('value')) || [, ''])[1].trim()
    const simple = /^[\w.]+$/.test(valueExpr)
    allTags.push({ page, type: attr('type') || 'text', valueExpr, handler })
    if (!handler || !valueExpr) continue
    if (!simple) { complexBinding.push(`${page}:${valueExpr}`); continue }
    inputs.push({
      page, js: join(dirname(file), 'index.js'),
      type: attr('type') || 'text',
      field: valueExpr, leaf: valueExpr.split('.').pop(), handler,
      placeholder: attr('placeholder')
    })
  }
}
/* 覆盖面的判据(判据律推论):value 绑表达式的框我这条扫描读不出字段名 ——
   它们必须逐个在这张表里,附理由;新出现一个而没登记,当场红。 */
const COMPLEX_ALLOW = {
  "pages/merchant/orders/index.wxml:shares[p.id + '|' + t.id]": '分成百分比,按「单号|技师」拼 key —— 不是金额;写回原样(onShare 里 setData 的就是 e.detail.value)',
  "pages/merchant/daily-close/index.wxml:shares[p.id + '|' + t.id]": '同上,日结页是同一份 mixin 的第二个落点(一处改两处生效)'
}
const complexNotAllowed = complexBinding.filter((k) => !(k in COMPLEX_ALLOW))
check(`扫描面兜底:${complexBinding.length} 个 value 绑表达式的框逐个登记在案(读不出字段名的不许悄悄跳过)`,
  complexNotAllowed.length === 0, complexNotAllowed.join(' | '))
check(`扫描面:全仓 ${inputs.length} 个带 bindinput 的输入框(被测集合从 wxml 现扫,不是手写清单)`, inputs.length >= 60, String(inputs.length))
check(`覆盖 ${new Set(inputs.map((i) => i.page)).size} 个页面`, new Set(inputs.map((i) => i.page)).size >= 12)

/* 判据本体:handler 里凡把值写回**同一个绑定字段**的,写回去的必须是原样。
   允许的原样写法只有这三种(多一种就要报批,免得"随手加个 trim"混进来):
     `e.detail.value` / `String(e.detail.value || '')` / `String(e.detail.value)` */
const RAW_OK = /^\s*(?:String\(\s*)?(?:e|ev|evt|event)\.detail\.value(?:\s*\|\|\s*''\s*)?\)?\s*$/
const rewrites = []
const missingHandler = []
for (const item of inputs) {
  if (!existsSync(item.js)) { missingHandler.push(`${item.page} ${item.handler}(找不到 index.js)`); continue }
  const body = bodyOf(readFileSync(item.js, 'utf8'), item.handler)
  if (!body) {
    // mixin 里的方法:去 utils 里找同名的(日结两个落点共用一份 mixin)
    const fromMixin = walk(join(ROOT, 'utils'), /\.js$/).map((f) => bodyOf(readFileSync(f, 'utf8'), item.handler)).find(Boolean)
    if (!fromMixin) { missingHandler.push(`${item.page} ${item.handler}`); continue }
    item.body = fromMixin
  } else item.body = body
  const one = item.body.replace(/\s+/g, ' ')
  // 找所有"写这个字段"的地方:`leaf: EXPR` / `.leaf = EXPR` / `['...leaf']: EXPR`
  const writes = []
  const esc = item.leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const re of [new RegExp(`\\b${esc}\\s*:\\s*([^,}]+)`, 'g'), new RegExp(`\\.${esc}\\s*=\\s*([^;\\n]+)`, 'g')]) {
    let m
    while ((m = re.exec(one))) writes.push(m[1])
  }
  // 只在**会重画**的写法上判:setData 里的写回。值只进 this.data 的(不重画)直接放行。
  const setDataPart = (one.match(/setData\(([\s\S]*)\)/) || [, ''])[1]
  /* 允许**一层别名**:`const q = e.detail.value; setData({ x: q })` 写回去的还是原样,不是这个病。
     但别名的初始化式本身必须是原样 —— `const q = e.detail.value.trim()` 就**不是**别名,那正是病。 */
  const rawAliases = new Set()
  for (const line of item.body.split('\n')) {          // 按行找别名:本仓不写分号,不能拿 ; 当边界
    const am = /(?:const|let|var)\s+(\w+)\s*=\s*(.+?)\s*$/.exec(line.trim())
    if (am && RAW_OK.test(am[2])) rawAliases.add(am[1])
  }
  const isRaw = (rhs) => RAW_OK.test(rhs) || rawAliases.has(rhs.trim())
  const bad = writes.filter((rhs) => setDataPart.includes(rhs.trim()) && !isRaw(rhs))
  /* 🔴 补一层:setData 的**动态键**(`[`sheet.${f}`]: X` / `[k]: X`)—— 上面按字段名找写回的那条
     天生看不见它们(键名是运行期拼的)。判据的覆盖面本身要有判据:动态键写的也必须是原样。 */
  let dm
  const dynRe = /\[\s*(?:`[^`]*`|\w+)\s*\]\s*:\s*([^,}]+)/g
  while ((dm = dynRe.exec(setDataPart))) { if (!isRaw(dm[1])) bad.push(dm[1]) }
  if (bad.length) rewrites.push(`${item.page} ${item.field} ← ${item.handler}() 写回「${bad[0].trim().slice(0, 60)}」`)
}
check('🔴 判据本体:全仓**零处**在输入过程中改写内容(加工后再写回同一个框=丢字符的那个病)',
  rewrites.length === 0, rewrites.join(' | '))
check('反向守:handler 都找得到(找不到就等于没验,不许当成通过)', missingHandler.length === 0, missingHandler.join(' | '))

/* 🔴 店主 08-28(六)第③条欠答:那 22 处「回写原样」这一批不收,**但要把「不改内容」这个前提钉住**。
   —— 不钉的话,今天它们是"回写原样"所以放行,明天有人在里面加一句 `.trim()`,
   放行的理由就悄悄不成立了,而判据不会响。
   做法:把回写型的那一组单独数出来,**逐个断言写回去的就是手指敲的那个值**,并给条数下限
   (掉下来说明它们被改写法了,得重新看一眼是变好了还是变没了)。 */
{
  const writeBack = []
  for (const item of inputs) {
    if (!item.body) continue
    const one = item.body.replace(/\s+/g, ' ')
    const setDataPart = (one.match(/setData\(([\s\S]*)\)/) || [, ''])[1]
    const esc2 = item.leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`\\b${esc2}\\s*:\\s*([^,}]+)`).exec(setDataPart)
      || new RegExp(`\\[\\s*(?:\`[^\`]*\`|\\w+)\\s*\\]\\s*:\\s*([^,}]+)`).exec(setDataPart)
    if (m) writeBack.push({ where: `${item.page}:${item.field}`, rhs: m[1].trim() })
  }
  const rawAliasOk = (rhs) => /^(?:String\(\s*)?(?:e|ev|evt|event)\.detail\.value(?:\s*\|\|\s*''\s*)?\)?$/.test(rhs)
    || /^[a-z]\w*$/i.test(rhs)   // 一层别名,上面主判据已经验过它的初始化式是原样
  const notRaw = writeBack.filter((w) => !rawAliasOk(w.rhs)).map((w) => `${w.where} ← ${w.rhs}`)
  check(`回写型那一组(${writeBack.length} 处)**写回去的就是手指敲的那个值** —— 这是"不收它们"的前提,钉住`,
    notRaw.length === 0, notRaw.join(' | '))
  check('反向守:回写型确实还在(≥15 处;掉下来说明写法被改过,要重新看一眼)',
    writeBack.length >= 15, String(writeBack.length))
}

/* ③ type 的白名单式判据(spinner / 键盘是平台差异,与上面那条分开记):
   小程序 `type="digit"` = 带小数点的数字键盘(金额用);`type="number"` = 整数键盘(计数/百分比用)。
   凡 `type="number"` 必须落进「不是金额」白名单,每项一行理由;条目数上棘轮,只许减。 */
const NOT_MONEY_NUMBER = {
  'pages/merchant-apply/index.wxml:phone': '手机号 —— 是号码不是金额,整数键盘正好',
  'pages/merchant/coupon-edit/index.wxml:percent': '折扣百分比 —— 整数,不需要小数点',
  'pages/merchant/coupon-edit/index.wxml:validDays': '有效天数 —— 计数',
  'pages/merchant/coupon-edit/index.wxml:totalQty': '发放总量 —— 计数',
  'pages/merchant/service-edit/index.wxml:duration': '服务时长(分钟)—— 计数',
  'pages/merchant/package-edit/index.wxml:times': '次卡包含次数 —— 计数',
  'pages/merchant/staff/index.wxml:sheet.orders': '单数目标 —— 计数',
  'pages/merchant/orders/index.wxml:shares[p.id + \'|\' + t.id]': '分成百分比 —— 百分数不是金额',
  'pages/merchant/daily-close/index.wxml:shares[p.id + \'|\' + t.id]': '同上(日结页是同一份 mixin 的第二个落点)'
}
const NUMBER_CAP = 9
const numberInputs = allTags.filter((t) => t.type === 'number').map((t) => `${t.page}:${t.valueExpr}`)
const notWhitelisted = numberInputs.filter((k) => !(k in NOT_MONEY_NUMBER))
check(`③ 白名单式:全仓 ${numberInputs.length} 个 type="number" 逐个落在「不是金额」白名单里(新来的自动红)`,
  notWhitelisted.length === 0, notWhitelisted.join(' | '))
check(`③ 白名单防线②:条目数上棘轮 ≤ ${NUMBER_CAP}(只许减不许增;要增先报 Cowork)`,
  Object.keys(NOT_MONEY_NUMBER).length <= NUMBER_CAP, String(Object.keys(NOT_MONEY_NUMBER).length))
const staleAllow = Object.keys(NOT_MONEY_NUMBER).filter((k) => !numberInputs.includes(k))
check('③ 白名单防线③:白名单每一项都还真的在代码里(改掉了却留着豁免 = 偷偷放宽)',
  staleAllow.length === 0, staleAllow.join(' | '))

/* ④ 金额框必须是带小数点的键盘:凡 placeholder/字段名一眼是钱的,type 必须是 digit。
   这条是"正着数"的补充(不能替代上面的白名单),用来兜住"把金额写成 type=number"这种新错。 */
const looksLikeMoney = (i) => /金额|价格|充值|退款|定金|工资|底薪|减多少|0\.00|如 \d+/.test(i.placeholder) || /amount|price|salary|base|handwork/i.test(i.field)
/* 已经在「不是金额」白名单里逐条写过理由的,不再被这条粗判据重复咬 ——
   两条判据的分工:白名单那条是全覆盖的主判据,这条只兜"新写的金额框忘了 digit"。 */
const moneyNotDigit = inputs
  .filter((i) => looksLikeMoney(i) && i.type !== 'digit' && !(`${i.page}:${i.field}` in NOT_MONEY_NUMBER))
  .map((i) => `${i.page}:${i.field}(type=${i.type})`)
check('④ 一眼是金额的框,键盘必须带小数点(type="digit")', moneyNotDigit.length === 0, moneyNotDigit.join(' | '))

console.log(`\n✅ test-mini-money-inputs 通过 ${checks} 项(扫了 ${inputs.length} 个输入框 / ${new Set(inputs.map((i) => i.page)).size} 个页面)`)
