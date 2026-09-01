/* 交付证据刀(店主 02t 裁定一③ + 裁定二,2026-09-02 落)

   立刀背景 —— 店主查出的窟窿比我报的大:`.gitignore` 第 3 行 `*.log`,
   **从 08-27 到 09-02、几十批回归,原始日志一份都没进过库**(39 份)。
   她 01u 立过一句「**我读不到的证据不算数**」——结果历批她能读到的只有我回执里的转述。
   那 40 条虚高就是同一个根:**拿转述当了证据**。

   本刀守三件:
   ① 每份日志**文件名声称的套件数 = 日志收尾行实测**(转述与原件对账,39 份全覆盖,新加的自动纳入)
   ② 每份日志**真的在库里**(`git ls-files` 现测)——
      这是把店主 02t 收编的《入库回显自证律》机械化:
      **`git add` 被 .gitignore 挡住是不报错的**,静默失败器族在版本控制层的一员。
      我 02q/02r 两次「以为加进去了」,实际被静默忽略,靠人眼一直没发现。
   ③ 回执里的**机器可读自证块**必须与日志实测逐项对上(套件数 / 断言数 / 日志路径)。
      块的格式(写在回执末尾,HTML 注释,不影响阅读):
        <!-- 回归自证 批次=02t 套件=70 断言=2748 日志=handoff/regression-logs/回归日志_2026-09-02t_70套件.log -->
      断言数用**新尺**(全日志纯 `^ok` 行数),与 test-assertion-baseline 同一把尺;
      换口径 = 换尺,要报批(《换尺须报批律》)。 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const LOGDIR = 'handoff/regression-logs'
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const logs = existsSync(join(ROOT, LOGDIR))
  ? readdirSync(join(ROOT, LOGDIR)).filter((f) => f.endsWith('.log')).sort()
  : []

/* ===== ① 文件名声称的套件数 vs 日志实测 ===== */
const mismatched = []
for (const f of logs) {
  const claim = (/_(\d+)套件\.log$/.exec(f) || [])[1]
  const body = readFileSync(join(ROOT, LOGDIR, f), 'utf8')
  const real = (/全部 (\d+) 个套件通过/.exec(body) || [])[1]
  if (!claim || !real || claim !== real) mismatched.push(`${f}:文件名 ${claim || '?'} vs 日志 ${real || '无收尾行'}`)
}
check(`① ${logs.length} 份回归日志:文件名声称的套件数 = 日志收尾行实测(转述与原件对账)`,
  mismatched.length === 0, mismatched.join(' | '))

/* ===== ② 日志真的在库里(入库回显自证律的机械化)===== */
let tracked = []
try {
  /* 🔴 git ls-files 默认把非 ASCII 路径**转义加引号**输出("handoff/\345\233..."),
     直接比中文文件名永远对不上 —— 本刀落地第一跑就栽在这里:②说"39 份没进库",
     下一行 [交付证据] 却打"在库 39 份",**自己跟自己打架**才暴露的。
     关掉 quotepath 并用 -z 分隔(文件名里有空格也不怕)。 */
  tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', LOGDIR], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean).map((p) => p.split('/').pop())
} catch { tracked = null }
if (tracked === null) {
  check('② 日志入库现测:git 可用', false, '拿不到 git ls-files —— 这一条没验成,不是通过')
} else {
  const untracked = logs.filter((f) => !tracked.includes(f))
  check(`② ${logs.length} 份日志全部在库(git ls-files 现测;不许凭 git add 没报错就算数)`,
    untracked.length === 0, `${untracked.length} 份没进库:${untracked.join(' | ')}`)
}

/* ③ 反向守:日志目录不许缩水(判据的覆盖面本身要有判据) —— 08-27 至今在案 39 份 */
const LOG_MIN = 40
check(`③ 反向守:日志份数 ${logs.length} >= 在案 ${LOG_MIN}(只增不减;目录被清空时判据不许空转)`,
  logs.length >= LOG_MIN, String(logs.length))

/* ===== ④⑤ 回执自证块 ===== */
const RX = /<!--\s*回归自证\s+批次=(\S+)\s+套件=(\d+)\s+断言=(\d+)\s+日志=(\S+?)\s*-->/g
const blocks = []
for (const f of readdirSync(join(ROOT, 'handoff')).filter((x) => x.endsWith('.md'))) {
  /* 🔴 先剥掉围栏代码块:回执里要**写出块的格式**给人看,那段示例不是真自证块。
     落刀当批就撞上了 —— 02t 回执里的格式说明被数成第二个 02t 块(5 个而非 4 个);
     这次两个恰好一模一样所以没红,**换个数字就会误红**。文档要能示范格式,所以修刀不改文档。 */
  const src = readFileSync(join(ROOT, 'handoff', f), 'utf8').replace(/```[\s\S]*?```/g, '')
  for (const m of src.matchAll(RX)) blocks.push({ file: f, tag: m[1], suites: +m[2], asserts: +m[3], log: m[4] })
}

const blockBad = []
for (const b of blocks) {
  const p = join(ROOT, b.log)
  if (!existsSync(p)) { blockBad.push(`${b.tag}:日志不存在 ${b.log}`); continue }
  const body = readFileSync(p, 'utf8')
  const realSuites = +((/全部 (\d+) 个套件通过/.exec(body) || [])[1] || 0)
  const realAsserts = (body.match(/^ok /gm) || []).length
  if (realSuites !== b.suites) blockBad.push(`${b.tag}:套件数 回执说 ${b.suites} / 日志实测 ${realSuites}`)
  if (realAsserts !== b.asserts) blockBad.push(`${b.tag}:断言数 回执说 ${b.asserts} / 日志实测 ${realAsserts}`)
  if (tracked && !tracked.includes(b.log.split('/').pop())) blockBad.push(`${b.tag}:该批日志没进库`)
}
check(`④ 回执自证块 ${blocks.length} 个逐项对账:套件数/断言数/日志路径与原件一致(对不上即红)`,
  blockBad.length === 0, blockBad.join(' | '))

/* ⑤ 自证块棘轮:每批一个,只增不减。设为 0 等于这条判据从此空转 —— 那正是它要防的。 */
/* 落刀当批补了 02q/02r/02s 三批的真块(它们的日志已在库,数从原件现取);
   02t 起每批一个,这个下限随之上棘轮 —— 涨要顺手改这个数,等于每批自报一次。 */
const BLOCK_MIN = 4
check(`⑤ 自证块份数 ${blocks.length} >= ${BLOCK_MIN}(每批写一个;降到 0 = 这条判据空转,不许)`,
  blocks.length >= BLOCK_MIN, String(blocks.length))

console.log(`\n[交付证据] 日志 ${logs.length} 份(在库 ${tracked ? tracked.length : '?'} 份)· 回执自证块 ${blocks.length} 个`
  + `${blocks.length ? `:${blocks.map((b) => b.tag).join('/')}` : ''}`)
/* 🔴 收尾行不许在有红的时候说"通过 N 项"(判据自述须与行为一致;落地第一跑就打了
   「✅ 通过 5 项」而实际 2 项红)。绿了才说通过,红了只说红。 */
if (fails.length) {
  console.error(`\n❌ test-delivery-evidence ${fails.length}/${checks} 项未过`)
  process.exit(1)
}
console.log(`\n✅ test-delivery-evidence 通过 ${checks} 项`)
