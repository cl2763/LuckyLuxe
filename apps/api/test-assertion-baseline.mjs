/* 断言基线刀(店主 02r 裁定一,2026-09-02 落)

   立刀理由 —— 店主原话:「断言增量律至今靠我每批用眼睛盯两个数,**而我这次被口径差骗了 40**。
   人肉盯数已经出过错了(错的是我),所以该落刀。」

   ══ 尺子(口径写死在这里;改口径 = 换尺 = 要报批,店主 02r《换尺须报批律》)══
   只数每套件 stdout 里的 `^ok ` 行。**汇总行不算断言** ——
   旧「绿行」口径 `grep -cE '^ok |checks passed|✅'` 把每套跑完那句「通过 N 项」也数进去了,
   历批虚高约 40 条,这正是 02q 挖出来的那件事。别再把它当断言数。

   ══ 语义 ══
   · **降 = 红**,并指名道姓「哪套少了几条」——总数只会告诉你"少了 40",逐套件直接告诉你"少在哪一套"。
   · **涨 = 自动更新基线**并打印「哪套 +N」。**不做成"总数只增不减"** ——
     把两条烂断言合并成一条好的会让数变小,那是好事,不该红;但要红一次好让人**解释一句**,
     解释完由店主批,再由 `--accept` 收进基线。
   · **反向守**:在场套件数必须 = 清单套件数(DEFAULT_SUITES + 4 个清单外实例)。
     防的正是 02q 发现的那件事:逐项比对工具只扫到 19/65 套,而它自己报"没有差异"。
     (店主 02r 收编为《判据覆盖面要有判据》:凡"逐项比对"的工具,必须自证扫到的项数 = 清单里的项数。)

   ══ 用法 ══
   由 `run-all-tests.sh` 在全部套件跑完后调用:
     node test-assertion-baseline.mjs <tally 文件> <期望套件数>
   tally 每行 `套件名<TAB>ok条数`,**由 shell 在每次 node 调用后现数**,不解析日志 ——
   日志里 auto-return / tenant-isolation 两套没有 `== test-X ==` 行,解析法会张冠李戴。

   子集跑(`CI_SUITES=...`)自动降级为**对照模式**:只比在场的套件、不做套件数反向守、**绝不写基线**,
   并把"这是子集、没做哪一项"明明白白打出来(不是静默跳过 —— 静默失败器族)。 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const BASELINE = join(HERE, 'assertion-baseline.json')
const [tallyPath, expectSuitesRaw] = process.argv.slice(2)
const accept = process.argv.includes('--accept')
const expectSuites = Number(expectSuitesRaw || 0)

let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

if (!tallyPath || !existsSync(tallyPath)) {
  console.error('❌ 断言基线刀:拿不到 tally 文件 —— **这一刀本轮没跑**(不是通过)')
  process.exit(1)
}

/* tally → { suite: count } */
const now = {}
for (const ln of readFileSync(tallyPath, 'utf8').split('\n')) {
  const [s, n] = ln.split('\t')
  if (s && n !== undefined) now[s] = Number(n)
}
const partial = !!process.env.CI_SUITES

if (!existsSync(BASELINE)) {
  const seed = { 尺子: '每套件 stdout 的 ^ok 行数;汇总行不算', 播种于: '2026-09-02(02r 裁定一)', suites: now }
  writeFileSync(BASELINE, `${JSON.stringify(seed, null, 2)}\n`)
  console.log(`🌱 断言基线**首次播种**:${Object.keys(now).length} 套,合计 ${Object.values(now).reduce((a, b) => a + b, 0)} 条`)
  console.log('   下一轮起生效(降即红)。播种这一轮不做判定。')
  process.exit(0)
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
const prev = base.suites || {}

const dropped = []   // 降:少了条数
const grew = []      // 涨:多了条数
const gone = []      // 整套消失
const born = []      // 新套件

for (const [s, n] of Object.entries(now)) {
  if (!(s in prev)) { born.push(`${s} 新增 ${n} 条`); continue }
  if (n < prev[s]) dropped.push(`${s} ${prev[s]} → ${n}(少 ${prev[s] - n} 条)`)
  else if (n > prev[s]) grew.push(`${s} ${prev[s]} → ${n}(+${n - prev[s]})`)
}
if (!partial) for (const s of Object.keys(prev)) if (!(s in now)) gone.push(s)

/* ① 主判:任何套件的断言条数都不许变少 */
check(`① 断言零缩水:${Object.keys(now).length} 套逐套对基线,没有一套变少(降=红,要降先报批;涨自动更新)`,
  dropped.length === 0, `${dropped.length} 套变少:${dropped.join(' | ')}`)

/* ② 整套消失也算缩水(一套被从清单里摘掉,总数会掉一大块,却不属于"某套少了几条") */
check('② 零整套消失:基线里的套件全部到场(摘套件=改清单,要报批)',
  gone.length === 0, gone.join(' | '))

/* ③ 反向守(判据覆盖面要有判据):在场套件数 = 清单套件数 */
if (partial) {
  console.log(`⚠️  子集模式(CI_SUITES=${process.env.CI_SUITES}):在场 ${Object.keys(now).length} 套,`
    + '**③ 套件数反向守本轮未做、基线不写回** —— 这不是通过,是明说没做。')
} else {
  check(`③ 反向守:在场套件数 ${Object.keys(now).length} = 清单套件数 ${expectSuites}(防"只扫到一半却报没有差异")`,
    expectSuites > 0 && Object.keys(now).length === expectSuites,
    `在场 ${Object.keys(now).length} vs 期望 ${expectSuites}`)
}

/* ④⑤ 零断言套件(播种当天现扫发现的):这四套用**自有输出格式**打结果
   (`[name] all regression checks passed`),失败靠 throw,不打 `^ok ` 行。
   → 我这把尺子**看不见它们的断言**,基线对这四套等于没守。
   这不是"它们没断言",是**判据的覆盖面有个洞** —— 按白名单式登记 + 棘轮封顶,不许再多,
   并登记待改造(把它们的输出改成 ok 行,基线才真的盖住 70 套)。
   店主 02r 收编的《判据覆盖面要有判据》就是冲这个来的,自己先照一遍。 */
const NO_OK_ALLOW = {
  /* 空 —— 店主 02s 裁定一已清零。
     02r 落刀当天这里有四个:working-memory / silent-handoff / human-handoff / after-sales-handoff,
     它们用自有输出格式、不打 ok 行,尺子看不见,覆盖面只有 66/70。
     店主裁:「"数不到"和"改造它们"之间还有第三条路:**让它们说出自己有多少条**」——
     02s 只改各自那一个 assert() 助手(断言逻辑与 matrix 66 项一行不动),四套共 102 条现身,
     覆盖面 70/70。棘轮随之从 4 收到 0:**这张表只减不增,再有新成员必须店主点头**。 */
}
const NO_OK_CAP = 0
const zeros = Object.entries(now).filter(([s, n]) => n === 0 && !NO_OK_ALLOW[s]).map(([s]) => s)
check(`④ 零断言套件白名单式:在场 ${Object.keys(now).length} 套里,打不出 ^ok 行的必须在白名单内(新出现的自动红)`,
  zeros.length === 0, zeros.join(' | '))
/* 名字跟着事实走(判据自述须与判据行为一致):02r 那版名字写的是「这四套盖不住,待改造」,
   02s 改造完就不成立了 —— 名字不改就是判据在说谎。 */
check(`⑤ 零断言白名单棘轮 ≤ ${NO_OK_CAP}(现为空;只减不增,再进新成员要店主点头)`,
  Object.keys(NO_OK_ALLOW).length <= NO_OK_CAP, String(Object.keys(NO_OK_ALLOW).length))

if (born.length) console.log(`[新套件] ${born.join(' | ')}`)
if (grew.length) console.log(`[断言增长] ${grew.join(' | ')}`)
const total = Object.values(now).reduce((a, b) => a + b, 0)
const prevTotal = Object.values(prev).reduce((a, b) => a + b, 0)
/* 🔴 子集模式下拿在场合计去减全量基线合计,会打出「-2586」这种吓人又无意义的数
   —— 数字误导与判据说谎同族(02r 造病验红时当场发现,顺手修)。子集只跟**在场那几套的基线**比。 */
if (partial) {
  const inScopePrev = Object.keys(now).reduce((a, k) => a + (prev[k] ?? 0), 0)
  console.log(`[断言基线·子集] 在场 ${Object.keys(now).length} 套合计 ${inScopePrev} → ${total}`
    + `(${total - inScopePrev >= 0 ? '+' : ''}${total - inScopePrev});全量基线 ${prevTotal} 条**不参与本次比较**`)
} else {
  console.log(`[断言基线] 合计 ${prevTotal} → ${total}(${total - prevTotal >= 0 ? '+' : ''}${total - prevTotal});尺子=纯 ^ok,汇总行不算`)
}

/* 写回:只在全量跑、且没有缩水时。缩水要店主批,批了用 --accept 收进基线。 */
if (!partial && (dropped.length === 0 || accept) && gone.length === 0) {
  if (grew.length || born.length || accept) {
    writeFileSync(BASELINE, `${JSON.stringify({ ...base, suites: now, 上次更新: '2026-09-02' }, null, 2)}\n`)
    console.log(`[基线已更新] ${accept ? '店主批准的下调已收进基线' : '涨的部分自动收进基线'}`)
  }
}

/* 🔴 覆盖面同理:减的必须是**在场**的零断言套件,不是白名单总条数
   —— 子集里只到场 1 套白名单成员时,减 4 就把覆盖面说小了。 */
/* 🔴 覆盖面必须数**事实**(真的 0 条的套件),不是数白名单成员:
   白名单 02s 清空后,按成员数算会永远打「N/N 全覆盖」——
   造病时 working-memory 明明瞎着,它照样报 5/5。判据看着在守其实没守,同族第三案,当场改。 */
const blindHere = Object.keys(now).filter((k) => now[k] === 0)
console.log(`[覆盖面] 基线真正盖住 ${Object.keys(now).length - blindHere.length}/${Object.keys(now).length} 套;`
  + `${blindHere.length} 套打不出 ok 行、尺子看不见${blindHere.length ? `(${blindHere.join('/')})` : ''};`
  + `白名单在册 ${Object.keys(NO_OK_ALLOW).length} 套`)
console.log(`\n✅ test-assertion-baseline 通过 ${checks} 项(在场 ${Object.keys(now).length} 套,合计 ${total} 条)`)
if (fails.length) {
  console.error(`\n❌ ${fails.length} 项未过 —— 断言变少必须解释:合并/删除/改写?说清哪套、少几条、为什么,`)
  console.error('   店主批准后用 `node test-assertion-baseline.mjs <tally> <n> --accept` 收进基线。')
  process.exit(1)
}
