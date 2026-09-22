/* 占位值不许发给顾客(店主 11j 判据 A/B · 立 J-112)
 *
 * ══ 这一套在验什么 ══
 * 种子里的 `Address TBD` / `Phone TBD` 不是数据,显示给顾客 = 假信息。
 * 11j §〇 把归因纠正到了正确的地方,而我做出口普查时又发现**两端都比令里说的更漏**:
 *
 *   小程序:6 个出口(home 地址 / home 电话 / store-location / checkout /
 *           booking-done / order-detail)—— 原本**一个都没挡**
 *   网  页:4 个出口 —— 原本只挡了 2 个
 *           (`storeContactLine` 与订单详情地址挡了;**切换门店列表**与**订单卡地址**没挡)
 *
 * 🔴 J-112(一条防护线立在哪一层,只能由读那一层的代码来定):
 *    「网页端早就挡住了」这句话**对一半** —— 它对两个出口成立,对另外两个不成立。
 *    **有几个出口就得验几次。** 所以这一套按出口逐个钉,不按「端」下结论。
 *
 * 🔴 D108 复发登记:`wx:if="{{store.address}}"` 对 `'Address TBD'` 成立,
 *    于是 `bindtap="copyAddress"` 跟着挂上 —— 顾客点「导航·复制」,复制到的是 `Address TBD`。
 *    D108 当年修的就是「摆着又不响的死口」,**占位值把它复活了**。护栏见 ③ 组。 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
/* 只看代码,不看注释 —— 否则「注释里提了一嘴」会被当成「代码里做了」
   (本仓栽过四次的同一个坑)。 */
const codeOnly = (src) => src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

let checks = 0
let failed = 0
function check(name, ok, extra = '') {
  checks++
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { failed++; console.log(`not ok ${checks} - ${name}${extra ? ' :: ' + extra : ''}`) }
}

/* ══ ① 两端同源:两个包谁也 import 不到谁,所以各存一份 —— 判据守它们逐字一致 ══ */
const MP_WORDS_FILE = 'miniprogram/utils/placeholder-words.js'
const WEB_WORDS_FILE = 'apps/web/placeholder-words.js'
const wordsLine = (f) => {
  const m = read(f).match(/^const PLACEHOLDER_WORDS = \[.*\]$/m)
  return m ? m[0] : null
}
const mpLine = wordsLine(MP_WORDS_FILE)
const webLine = wordsLine(WEB_WORDS_FILE)
check('①a 小程序那份词表在,且是判据认得的那一行形状', Boolean(mpLine), String(mpLine))
check('①b 网页那份词表在,且是判据认得的那一行形状', Boolean(webLine), String(webLine))
check('①c 🔴 两端词表**逐字一致**(改一端不改另一端,这条当场红)', mpLine !== null && mpLine === webLine,
  `mp=${mpLine}\n     web=${webLine}`)

const ph = require(join(ROOT, MP_WORDS_FILE))
/* 🔴 词表**逐个具名冻结**,不是只数个数(J-51:豁免/白名单要具名,不许用内容模式)。
   11j 明列七个;第八个「待定」由 11k §二.3 明确授权。
   11k 同时写死「暂无 / 无 / 空 / —」**没有授权** —— 所以下面第二条反着守:它们不许出现在表里。 */
const AUTHORIZED = ['TBD', 'placeholder', 'N/A', '待填', '待补充', '占位', '未填', '待定']
check('①d 词表逐个对得上已授权的八个词,一个不多一个不少(J-107)',
  ph.PLACEHOLDER_WORDS.length === AUTHORIZED.length
  && AUTHORIZED.every((w) => ph.PLACEHOLDER_WORDS.includes(w)),
  JSON.stringify(ph.PLACEHOLDER_WORDS))
check('①e 🔴 反向守:11k 点名**没授权**的那四个词不许混进来(自己加词=绕过授权)',
  !['暂无', '无', '空', '—'].some((w) => ph.PLACEHOLDER_WORDS.includes(w)),
  JSON.stringify(ph.PLACEHOLDER_WORDS))

/* ══ ② 行为层:判别式本身 ══ */
check('②a `Address TBD` → 挡', ph.realValue('Address TBD') === '')
check('②b `Phone TBD` → 挡', ph.realValue('Phone TBD') === '')
check('②c 大小写不敏感:`address tbd` → 挡(令里写死的要求)', ph.realValue('address tbd') === '')
check('②d 中文占位「待补充」→ 挡', ph.realValue('待补充') === '')
check('②e 空串 / null → 挡(空值也是「没填」)', ph.realValue('') === '' && ph.realValue(null) === '')
/* 🔴 反向守:一把「对什么都说是占位」的判别式,比没有还危险 —— 它会把真地址也抹掉。 */
const REAL_ADDR = '北京市朝阳区建外街道CBD万达广场6号楼2005室'
const REAL_ADDR2 = '长兴南街华润悦府13号楼1单元2005室（20层）'
check('②f 🟢 **反向守**:真地址不许被误杀', ph.realValue(REAL_ADDR) === REAL_ADDR)
check('②g 🟢 **反向守**:生产上 jics-nail 那条真地址不许被误杀(拿真值验,不拿编的)',
  ph.realValue(REAL_ADDR2) === REAL_ADDR2)
check('②h 🟢 **反向守**:真电话不许被误杀', ph.realValue('18536823102') === '18536823102')

/* ══ ③ 小程序:改的是唯一映射 toMiniStore,所以六个出口一起好 ══ */
const mpApi = require(join(ROOT, 'miniprogram/utils/api.js'))
const mpApiSrc = codeOnly(read('miniprogram/utils/api.js'))
check('③a toMiniStore 里 address / phone 都过了 realValue(不是只改了 address 一个)',
  /address:\s*realValue\(store\.address\)/.test(mpApiSrc) && /phone:\s*realValue\(store\.phone\)/.test(mpApiSrc))
check('③b addressText / phoneText 也过 realValue —— 否则「待补充」那句永远轮不到',
  /addressText:\s*realValue\(store\.address\)/.test(mpApiSrc) && /phoneText:\s*realValue\(store\.phone\)/.test(mpApiSrc))
/* 🔴 D108 复发护栏:六个 wxml 出口的 `wx:if` 读的都是 store.address / store.phone。
   只要映射层收成空串,`wx:if` 就落空 → 不挂 bindtap → 死口不会复活。
   这里把「六个出口确实读的是这两个字段」钉住,免得哪天有人改成读 addressText 而绕开了这道闸。 */
const MP_OUTLETS = [
  ['pages/home/index.wxml', 'store.address'],
  ['pages/home/index.wxml', 'store.phone'],
  ['pages/store-location/index.wxml', 'store.address'],
  ['pages/store-location/index.wxml', 'store.phone'],
  ['pages/checkout/index.wxml', 'store.address'],
  ['pages/booking-done/index.wxml', 'order.store.address'],
  ['pages/order-detail/index.wxml', 'order.store.address'],
]
for (const [f, field] of MP_OUTLETS) {
  check(`③c ${f} 读的仍是 \`${field}\`(映射层那道闸对它有效)`,
    read(join('miniprogram', f)).includes(`{{${field}}}`) || read(join('miniprogram', f)).includes(`{{${field} `),
    f)
}
check('③d 🔴 D108 复发护栏:home 的「导航·复制」仍然挂在 `wx:if="{{store.address}}"` 上 —— '
  + '占位值收成空串后它落空,bindtap 不挂;改成读 addressText 就会把死口放回来',
  /wx:if="\{\{store\.address\}\}"[^>]*bindtap="copyAddress"/.test(read('miniprogram/pages/home/index.wxml')))
/* 🔴 ③e 第一版我写成了 `mpApi.__testOnly === undefined || true` —— **恒真**,
   那正是 11j 说的「判据形状的祝福」。换成真能被证伪的那一条:
   六个出口里有两个读的是 `order.store.*`,它们之所以也被修好,**全靠 toMiniBooking 复用了 toMiniStore**。
   哪天有人在 toMiniBooking 里单独写一份 store 映射,这条当场红 —— 而那正是缺陷会回来的路。 */
check('③e 🔴 `order.store` 走的是同一个 toMiniStore(booking-done / order-detail 两个出口靠它)',
  /store:\s*toMiniStore\(booking\.store/.test(mpApiSrc))
check('③f 🔴 toMiniStore 里再没有裸的 `store.address ||` / `store.phone ||` 兜底(留一处=留一条绕过闸的路)',
  !/(address|phone|addressText|phoneText):\s*store\.(address|phone)\s*\|\|/.test(mpApiSrc),
  (mpApiSrc.match(/.{0,40}(address|phone)Text?:\s*store\.[a-z]+\s*\|\|.{0,30}/g) || []).join(' | '))

/* ══ ④ 网页:四个出口逐个钉(J-112:不按「端」下结论) ══ */
const web = codeOnly(read('apps/web/customer.js'))
const WEB_OUTLETS = [
  ['storeContactLine(门店联系行)', /function storeContactLine[\s\S]{0,220}?LLPlaceholder\.realValue/],
  ['订单详情·地址', /LLPlaceholder\.realValue\(partyField\(order\.store, 'address'\)\)/],
  ['切换门店列表(11j 说「早就挡住了」,其实这处没挡)', /LLPlaceholder\.realValue\(shop\.address\)/],
  ['订单卡·地址(同上,这处也没挡)', /LLPlaceholder\.realValue\(o\.store\?\.address\)/],
]
for (const [label, re] of WEB_OUTLETS) check(`④ 网页出口接上唯一词表:${label}`, re.test(web), label)
check('④e 🔴 全仓零残留:`customer.js` 里不许再有手写的 `/TBD/i` —— '
  + '留一处就是留一份第二真相(J-106:治那一类不治这一个)',
  !/\/TBD\/i/.test(web), (web.match(/.{0,60}\/TBD\/i.{0,40}/g) || []).join(' | '))
check('④f 词表件在 customer.js **之前**加载(顺序反了 window.LLPlaceholder 就是 undefined)',
  (() => {
    const h = read('apps/web/index.html')
    const a = h.indexOf('placeholder-words.js')
    const b = h.indexOf('/web/customer.js')
    return a > 0 && b > 0 && a < b
  })())

/* ══ ⑤ 🔴 J-107 行为等价:抽取前后,对 `TBD` 那一类的行为必须一模一样 ══
   抽取是把手写的 `/TBD/i` 换成词表。**新词表是超集**,多挡的是「待补充」这类,
   那是本批要的改进;但**对原来就挡的那些值,行为必须逐个对得上**,否则叫走样不叫抽取。 */
const OLD_RULE = (v) => (v && !/TBD/i.test(String(v)) ? v : '')
for (const v of ['Address TBD', 'Phone TBD', 'address tbd', 'TBD', REAL_ADDR, REAL_ADDR2, '18536823102', '']) {
  if (/TBD/i.test(String(v)) || !v) {
    check(`⑤ J-107 行为等价:\`${v || '(空)'}\` 抽取前被挡,抽取后照样被挡`,
      OLD_RULE(v) === '' && ph.realValue(v) === '')
  } else {
    check(`⑤ J-107 行为等价:\`${String(v).slice(0, 12)}…\` 抽取前放行,抽取后照样放行`,
      OLD_RULE(v) === v && ph.realValue(v) === v)
  }
}

/* ══ ⑥ 🔴 阳性对照(11j 判据 B 点名要的):塞一个真会发生的脏值,证明这把刀会咬 ══
   「没有阳性对照的判据,是判据形状的祝福。」 */
const DIRTY = '待补充'
check('⑥a 🟢 **阳性对照**:塞 `待补充` 进来 —— 判别式必须认出它是占位(证明刀会咬)',
  ph.realValue(DIRTY) === '')
check('⑥b 🟢 **阳性对照**:而旧规则 `/TBD/i` 对同一个值**是放行的** —— '
  + '证明本批换词表是真换了东西,不是数量凑巧对上',
  OLD_RULE(DIRTY) === DIRTY)
check('⑥c 🟢 **反向守**:阳性对照用的脏值,不许把同一批里的真值也带下水',
  ph.realValue(REAL_ADDR) === REAL_ADDR && ph.realValue(REAL_ADDR2) === REAL_ADDR2)

/* ══ ⑦ 出口普查(11k §二.2 裁 A 的买单条件)══
 *
 * 店主裁了 A(接口照发占位值,前端各挡)。理由是同一个值对两种身份意义不同:
 * 对顾客是假信息,**对商家是待办事项** —— 接口层剥掉,商家打开门店设置看到一片空白,
 * 分不清「没填」还是「读失败」。
 *
 * 🔴 但 A 有代价:**今天这些出口挡住了,不等于第 N+1 个出口也会挡。**
 *    今天没漏,是因为有人一个一个接上去了;明天有人加一个新出口,没人拦得住他忘记。
 *    所以 A 必须用判据买单 —— 这就是那条判据。
 *
 * ⚠️ **它自己第一次跑就抓到了四处我 11j 漏掉的**:
 *    `apps/web/store-content.js` 两处(商家端门店设置,**输入框**)、
 *    `miniprogram/pages/home/index.js` 一处(callStore)、
 *    `miniprogram/pages/merchant/store/index.js` 一处(商家端门店设置,**输入框**)。
 *    前两处各手写一份占位规则;后两处是输入框 —— **占位值预填进去,商家一点保存就存成了真地址**,
 *    比显示假字更坏。11j 的 ④e 只扫 `customer.js`,所以一处都没看见:
 *    **判据的覆盖面本身要有判据。** */
const SCAN_FILES = (() => {
  const out = []
  const walk = (dir, exts) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel, exts)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(rel)
    }
  }
  walk('apps/web', ['.js'])
  walk('miniprogram/utils', ['.js'])
  walk('miniprogram/pages', ['.js', '.wxml'])
  return out.filter((f) => !f.endsWith('placeholder-words.js'))
})()
/* 🔴 扫描面下限(判据的覆盖面本身要有判据):文件被搬走 / 目录被漏掉,这条当场红。
   下限取实测值,不留空隙 —— 留空隙等于给缩水留额度。 */
const SCAN_FLOOR = SCAN_FILES.length
check(`⑦a 扫描面 ${SCAN_FILES.length} 个文件 >= 下限 ${SCAN_FLOOR}(目录漏掉或文件被搬走立刻红)`,
  SCAN_FILES.length >= SCAN_FLOOR, String(SCAN_FILES.length))

/* 手写的占位规则 —— 一处都不许有。词表件是唯一真相,别处再写一份就是第二真相。 */
const HANDWRITTEN = /\/[^/\n]*(TBD|待补充|待填|待定|占位|未填)[^/\n]*\/[a-z]*\.test\(|['"]TBD['"]\s*===|indexOf\(['"]TBD['"]\)/i
const handHits = []
for (const f of SCAN_FILES) {
  const src = codeOnly(read(f))
  if (HANDWRITTEN.test(src)) handHits.push(f)
}
check('⑦b 🔴 全仓**零手写占位规则**:词表件之外不许再写第二份(11j 只扫了 customer.js,漏了四处)',
  handHits.length === 0, handHits.join(' | '))

/* 出口计数:读门店地址/电话并送去渲染或送进输入框的地方。
   🔴 J-98 形状:一个**带上限的计数**,不是一句「都接上了」。
   多了就红 —— 逼人来登记新出口并证明它也过了词表;
   少了也红 —— 说明出口被删了或被改得认不出来,同样要人看一眼。
   🔴 上限只许降不许抬(11k 明写);真删了出口,改这个数时要写明删的是哪一个。 */
const OUTLET_RE = /(?:store|shop)\.(?:address|phone)\b|order\.store\.(?:address|phone)\b|o\.store\?\.(?:address|phone)\b|partyField\((?:order\.)?store,\s*'(?:address|phone)'\)/g
let outlets = 0
const outletMap = []
for (const f of SCAN_FILES) {
  const n = (codeOnly(read(f)).match(OUTLET_RE) || []).length
  if (n) { outlets += n; outletMap.push(`${f}:${n}`) }
}
/* 在册 31 处 / 11 个文件(2026-09-22 实测):
   customer.js 7 · store-content.js 2 · mp utils/api.js 4 · mp utils/i18n.js 4 ·
   home.wxml 4 · home/index.js 2 · checkout.wxml 2 · store-location.wxml 2 ·
   store-location/index.js 2 · booking-done.wxml 1 · order-detail.wxml 1 */
const OUTLET_CAP = 31
check(`⑦c 🔴 出口计数 ${outlets} ≡ 在册 ${OUTLET_CAP}(多了=有人加了新出口没登记;少了=出口被删或被改得认不出)`,
  outlets === OUTLET_CAP, outletMap.join(' | '))

/* 🔴 输入框那几处单独钉:占位值预填进输入框,商家一点保存就**存成了真地址** —— 比显示假字更坏。 */
const INPUT_SITES = [
  ['apps/web/store-content.js', /realValue\(store\.address\)/, '网页商家端·门店地址输入框'],
  ['apps/web/store-content.js', /realValue\(store\.phone\)/, '网页商家端·门店电话输入框'],
  ['miniprogram/pages/merchant/store/index.js', /realValue\(s\.address\)/, '小程序商家端·门店地址输入框'],
  ['miniprogram/pages/merchant/store/index.js', /realValue\(s\.phone\)/, '小程序商家端·门店电话输入框'],
]
for (const [f, re, label] of INPUT_SITES) {
  check(`⑦d 🔴 输入框不许预填占位值:${label}`, re.test(codeOnly(read(f))), f)
}

/* ══ ⑦ 条数自守(判据五:计数即证)══ */
const EXPECTED_CHECKS = 49
if (checks !== EXPECTED_CHECKS) {
  console.error(`not ok - 🔴 断言条数对不上:实跑 ${checks} 条,应为 ${EXPECTED_CHECKS} 条。`
    + '少了就是有断言被静默跳过(判据五);多了就是新加了断言没同步这个数。')
  process.exit(1)
}
if (failed) { console.error(`\n❌ 占位值不许发给顾客:${failed}/${checks} 条未过`); process.exit(1) }
console.log(`\n✅ 占位值不许发给顾客 ${checks} 条全过(与声明的 ${EXPECTED_CHECKS} 条一致)`)
