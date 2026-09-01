/* 文件体量棘轮刀(店主 02q 裁定③,2026-09-02 落)

   立刀背景 —— 店主原话:「我 grep 了一遍,没找到把 admin.js / local-server.mjs 行数钉住的断言。
   如果它俩只是回执里的一句话,那它不是棘轮,**是一句自述** —— 跟 check(..., true) 同族:
   看起来在守,其实没人守。」
   她说得对。《代码结构公约》③ 的行数红线立了(08-24),棘轮律也立了,但**从来只活在回执措辞里**。
   我这一批刚把七处「看起来在测其实在陪跑」的恒真兜底清干净,这两个最大的却一直裸奔 —— 同族,补上。

   判据形态取**白名单式**(判据三:白名单 > 黑名单):
     不是「列出这两个文件,数它们」——那样第三个巨型文件长出来时判据看不见;
     而是「**全仓每个业务文件都必须落进:①在公约上限内 ②或在棘轮表里且没长**」。
     新来的超线文件自动红,不需要有人想起来把它加进列表。

   棘轮语义:表里的数是**天花板**,`实际 <= 天花板` 才绿。降了要**主动收紧**(见「收紧提示」那条)。
   涨了必须报批 —— 改这张表等于申请提高上限,diff 会把它顶到店主眼前。 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ===== 公约③ 的三档上限(CLAUDE.md《代码结构公约》,店主 08-24 批准)===== */
const CAPS = [
  { label: '后端业务模块', cap: 1200, files: () => lsFlat('apps/api', /\.mjs$/, (b) => !/^(test-|run-)/.test(b)) },
  { label: '前端视图模块', cap: 1500, files: () => lsFlat('apps/web', /\.js$/) },
  { label: '小程序单页', cap: 600, files: () => lsDeep('miniprogram/pages', /(^|\/)index\.js$/) },
]

/* ===== 棘轮表:超线文件的**个别天花板**,只许降不许升 =====

   🔴 两类语义必须分开(店主 02r 裁定二,原话):
     「**冻结值的意思是「不再涨」,不是「这个体量是对的」。** 2,811 行的 customer.js 不是我认可的
       合理体量,它只是今天的事实。写清楚,免得半年后有人翻到这张表,以为那是被批准过的合理大小。」

   · **点名钉死(approved)** —— 店主逐个批过的数,就是这两个巨型文件。
   · **现状冻结候拆(frozen)** —— 09-02 首次落刀时按当天事实冻的,**店主没有批准这个体量**,
     只批准了"不再涨"。队尾 UI 总审 / 后续拆分时该拆照拆,拆完天花板跟着降。

   类别做成**字段**而不是注释里一句话 —— 注释会烂,字段能被判据⑥守住。
   规矩(店主 02r):**涨要报批,降不用报**(降自动更新并打印收紧提示)。 */
const PINNED = '点名钉死(店主逐个批准此数)'
const FROZEN = '现状冻结候拆(只批准不再涨,未批准此体量;该拆照拆)'
const RATCHET = {
  'apps/api/local-server.mjs': { cap: 18243, kind: PINNED, note: '巨型文件·店主 08-24 立棘轮 / 09-02 复核在案数一致' },
  'apps/web/admin.js': { cap: 8552, kind: PINNED, note: '巨型文件·店主 09-02 补批(01u 8521 → 02c 签署块 +28 → 02e 假图第八处 +3)' },
  'apps/web/customer.js': { cap: 2811, kind: FROZEN, note: '09-02 店主批准现状冻结;2811 行不是被认可的合理体量,是当天的事实' },
  'miniprogram/pages/me/index.js': { cap: 638, kind: FROZEN, note: '09-02 店主批准现状冻结;超公约 600 上限 38 行,候拆' },
  'miniprogram/pages/merchant/settlement/index.js': { cap: 929, kind: FROZEN, note: '09-02 店主批准现状冻结;超公约 600 上限 329 行,候拆' },
  'miniprogram/pages/merchant/orders/index.js': { cap: 829, kind: FROZEN, note: '09-02 店主批准现状冻结;超公约 600 上限 229 行,候拆' },
}

function lsFlat(dir, re, keep = () => true) {
  return readdirSync(join(ROOT, dir))
    .filter((b) => re.test(b) && keep(b))
    .map((b) => join(dir, b))
    .filter((p) => statSync(join(ROOT, p)).isFile())
}
function lsDeep(dir, re) {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (re.test(p.split('\\').join('/'))) out.push(p)
    }
  }
  walk(dir)
  return out
}
const lines = (p) => readFileSync(join(ROOT, p), 'utf8').split('\n').length - 1

/* ===== 逐档现扫 ===== */
const seen = []
const over = []          // 超公约上限、又不在棘轮表里 → 红
const grewPast = []      // 在棘轮表里但涨过了天花板 → 红
const couldTighten = []  // 在棘轮表里且已降到天花板以下 → 提示收紧(不红)

for (const { label, cap, files } of CAPS) {
  for (const rel of files()) {
    const key = rel.split('\\').join('/')
    const n = lines(key)
    seen.push({ key, n, label, cap })
    const r = RATCHET[key]
    if (r) {
      if (n > r.cap) grewPast.push(`${key} ${n} > 棘轮 ${r.cap}(+${n - r.cap})`)
      else if (n < r.cap) couldTighten.push(`${key} ${n} < 棘轮 ${r.cap}(可收紧 ${r.cap - n})`)
    } else if (n > cap) {
      over.push(`${key} ${n} > ${label}上限 ${cap}`)
    }
  }
}

/* ① 白名单式主判:全仓每个业务文件必须落进「上限内」或「棘轮表内」 */
check(`① 全仓 ${seen.length} 个业务文件逐个落判:未超公约上限,或在棘轮表内(白名单式;新长出来的超线文件自动红)`,
  over.length === 0, `${over.length} 处超线且不在棘轮表:${over.join(' | ')}`)

/* ② 棘轮主判:表里的文件一行都不许涨过天花板 */
check(`② 棘轮 ${Object.keys(RATCHET).length} 项零上涨(只许降不许升;要涨=改这张表=申请提高上限,diff 会顶到店主眼前)`,
  grewPast.length === 0, grewPast.join(' | '))

/* ③ 两个巨型文件单独点名钉死 —— 店主 02q 明令要能 grep 到「钉的是不是 8,552 / 18,243」 */
const ls = lines('apps/api/local-server.mjs')
const aj = lines('apps/web/admin.js')
check(`③ 巨型文件钉死:local-server.mjs ${ls} <= 18243 且 admin.js ${aj} <= 8552(店主批准值)`,
  ls <= 18243 && aj <= 8552, `local-server=${ls} admin=${aj}`)

/* ④ 反向守(判据三推论:判据的覆盖面本身要有判据)——
   扫描面缩水时必须红,否则「文件搬走了 → 扫不到 → 断言照样绿」。 */
check('④ 反向守:扫描面没缩水(三档各自真读到文件;条数下限 140)',
  seen.length >= 140 && CAPS.every(({ files }) => files().length > 0), `实扫 ${seen.length} 个`)

/* ⑤ 棘轮表不许指向已消失的文件(表本身会腐烂:文件改名/删除后留个僵尸条目,看着在守其实守空气) */
const zombies = Object.keys(RATCHET).filter((k) => !seen.some((s) => s.key === k))
check('⑤ 棘轮表零僵尸条目(表里的文件都还在扫描面上;改名/删除必须同步改表)',
  zombies.length === 0, zombies.join(' | '))

/* ⑥ 两类语义不许含糊:每项必须自报是「点名钉死」还是「现状冻结候拆」。
   店主 02r 的顾虑是"半年后有人翻到这张表以为 2811 是批准过的合理大小" —— 少写 kind 就红,
   新加一项也必须表态属于哪一类(不许糊过去)。 */
const noKind = Object.entries(RATCHET).filter(([, v]) => v.kind !== PINNED && v.kind !== FROZEN).map(([k]) => k)
check('⑥ 棘轮表两类语义齐:每项都标明「点名钉死」或「现状冻结候拆」(冻结=不再涨,不等于体量对)',
  noKind.length === 0, noKind.join(' | '))

/* 每次回归都把棘轮数字打出来 —— 店主 02q:「以后棘轮数字每次都要报,且涨就说涨、降才说降」。
   回执里那一行直接抄这里,不再靠人肉 wc -l 与措辞自觉。 */
const fmt = (kind) => Object.entries(RATCHET).filter(([, v]) => v.kind === kind)
  .map(([k, v]) => `${k.replace('miniprogram/pages/', '').replace('/index.js', '')} ${lines(k)}/${v.cap}`).join('  ·  ')
console.log(`\n[棘轮·点名钉死] ${fmt(PINNED)}`)
console.log(`[棘轮·现状冻结候拆] ${fmt(FROZEN)}   ← 冻结=不再涨,**不等于这个体量是对的**`)
if (couldTighten.length) console.log(`[收紧提示] ${couldTighten.join(' | ')}`)

console.log(`\n✅ test-file-ratchet 通过 ${checks} 项(业务文件 ${seen.length} 个,棘轮 ${Object.keys(RATCHET).length} 项)`)
if (fails.length) { console.error(`\n❌ ${fails.length} 项未过`); process.exit(1) }
