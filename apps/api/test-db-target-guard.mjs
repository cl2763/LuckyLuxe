/* 写库护栏刀(D124,店主 03b/03e/03g 裁定,2026-09-02 落)

   案由三连,一次比一次贴近真钱:
   ① 02x:`seed-bigdemo` 的 `SEED_BASE_URL` 有默认值 4128 → 148 行演示数据写进本机库;
   ② 03d:手敲 curl 又把 4128 敲进去 → 冲销了一条真实收入;
   ③ 03g:店主查出我的扫描面 `os.listdir('tools')` **不递归**,
      `tools/sim/`(17)+`apps/api/tools/`(3)整体漏网,其中 15 个会写库、
      一个默认目标**就是生产容器路径**且 `--apply` 真删。

   ══ 两条钉死的原则 ══
   · **扫描面 = `git ls-files` 递归全量**,不是单层列目录(判据覆盖面要有判据);
   · **默认目标至少有三种形态**,三种都要认 ——
     `process.env.X ||` / `argv[..] ||` / **取参函数 `val('db') ||`**。
     我的探测器为此连栽三次:每次只认当时见过的那一种,正是
     「白名单判据 > 黑名单判据」在扫描器上的同一个教训。 */

/* ⚠️ 剥行注释必须用 `[^\S\n]` 星号,不能用 `\s` 星号 —— **`\s` 包含换行**:
   那样写会把前面的空行连同换行一起吃掉,剥完的文本比原文少行,
   于是**按它算出来的行号全是错的**(03t 现测:admin.js 8551 → 8504,少 47 行,
   我因此连报错三次条数与位置)。同族:块注释也必须**保住换行**再置空。
   (本注释刻意不写出那个正则原文(略)。 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { isKnife, KNIVES, KNIVES_CAP, NOT_A_DB, scanWriteSites, renderChecklist, STAMP_LINE,
  isRealWriter, stripRegex, stripStrings, bare as bareOf } from '../../tools/guard-scan.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* 底数:git ls-files 递归全量(排除测试与本刀自身) */
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)
/* 排除面 = 「刀本身」,来自 `tools/guard-scan.mjs` 的 `isKnife`(**唯一一份**,带理由 + 棘轮)。
   04a 病二:03z 那份清单把生成器自己列成了「含事务的写库点」,而更坏的一面是
   **它同时把生成器当成"接了护栏"** —— 因为 `requireTarget` 那个词在生成器里是尺子的字面量。
   刀咬自己,两个方向都会说谎。 */
const CAND = tracked.filter((f) => /^(tools|apps\/api)\/.*\.(mjs|sh)$/.test(f) && !isKnife(f))

/* 写库的机制定义(先写类定义,再给机械证据) */
const WRITES = /DatabaseSync|\.prepare\([^)]*\)\s*\.run\(|db\.exec\(|method:\s*['"](POST|PUT|PATCH|DELETE)['"]/
/* 默认目标的**三种形态**,一个都不能少 */
/* 🔴 首跑第二次收窄:上一版把**所有带默认值的 env** 都数了 —— `AI_MODEL`、`APP_TIMEZONE`、
   `OWNER_TOKEN` 也在内。但律管的是「**目标库**不许有默认值」,不是「任何 env 不许有默认值」。
   时区有默认值是对的;模型名有默认值是对的。**判据要认的是"这个 env 指向哪个库/哪个服务"**。
   所以变量名必须落在目标库语义里:BASE_URL / API_BASE / DB / DATA_DIR / SQLITE 这几族。 */
const TARGETISH = '(?:\\w*(?:BASE_URL|API_BASE|DB_FILE|DB_PATH|DATA_DIR|SQLITE|DBURL|DATABASE)\\w*)'
const DEFAULTS = [
  { name: 'env||', rx: new RegExp(`process\\.env\\.${TARGETISH}\\s*(?:\\|\\||\\?\\?)\\s*['"\`]`) },
  { name: 'argv||', rx: /process\.argv\[[^\]]+\]\s*(?:\|\||\?\?)\s*['"`][^'"`]*(?:sqlite|\/|db)[^'"`]*['"`]/i },
  { name: '取参函数||', rx: /\b(?:val|arg|opt|flag|getArg)\s*\(\s*['"`](?:db|database|data-dir|sqlite)['"`]\s*\)\s*(?:\|\||\?\?)\s*(?:['"`]|join\()/i },
]

/* 🔴 03o(店主咬出):上一版记了 `guarded` 却**没有任何一条判据用它** ——
   61 个会写库的脚本里 43 个没接护栏,刀照样绿。
   而且「扫默认值长什么样」是**黑名单**:那张 BASE_URL|API_BASE|DB_FILE 变量名表,
   谁把目标变量叫 SERVER 或 HOST,刀就看不见。**扫「有没有护栏」才是白名单。**

   A/B 分类机械化:从 local-server 的 import 图**可达**的算 B(服务内模块,
   自报由服务启动那一行统一做);其余是 A(独立可跑脚本),A 类必须调 requireTarget。 */
const importsOf = (p) => {
  let src = ''
  try { src = readFileSync(join(ROOT, p), 'utf8') } catch { return [] }
  const out = []
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    let c = join(p, '..', m[1]).split('\\').join('/')
    if (!c.endsWith('.mjs')) c += '.mjs'
    out.push(c)
  }
  return out
}
const reachable = new Set()
const stack = ['apps/api/local-server.mjs']
while (stack.length) {
  const cur = stack.pop()
  if (reachable.has(cur)) continue
  reachable.add(cur)
  stack.push(...importsOf(cur))
}

const writers = []
for (const f of CAND) {
  let raw = ''
  try { raw = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  /* 🔴 首跑现测:18 个"仍有默认目标"里多数是**我改过的文件** ——
     刀数到的是注释里那句案底「原来这里是 `process.env.X || '默认'`」。
     判据不许被自己的案底注释误报:**剥掉注释再判**(与 02q 那次「白名单理由被自己数进去」同族)。 */
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*(\/\/|#).*$/gm, '')
  /* 🔴 09-14(07m)统一尺子(J-39):这一层原来用的是**裸** `WRITES.test(src)`,
     而 ④b 用的是会**剥掉正则/字符串字面量**的 `isRealWriter()` —— 同一个问题两把尺子。
     后果现测:两把新工具(`tools/assert-reads-fact.mjs` / `tools/j62-knife-bench.mjs`)
     把 `method: 'POST'` 这类形态写在**正则字面量**里当判据用,自己一行库都不碰,
     却被这一层判成「会写库的脚本没接护栏」。**假阳会逼人去改代码躲判据**(J-49②),
     所以治的是尺子不是被测对象。 */
  if (!isRealWriter(src)) continue
  const hasDefault = DEFAULTS.filter((d) => d.rx.test(src)).map((d) => d.name)
  writers.push({ file: f, hasDefault, guarded: /requireTarget/.test(src) })
}

/* 白名单:确有理由保留默认目标的,逐条写理由(目前为空 —— 一个都不该有) */
/* 非数据库目标的白名单(理由随码 + 什么时候要动) */
/* NOT_A_DB 搬去 `tools/guard-scan.mjs` —— 清单尾行要用同一份来解释「A 类未接护栏」那个差额 */
const ALLOW_DEFAULT = {
  /* 唯一例外:AI_BASE_URL 是**模型网关地址,不是数据库/服务库** —— 它命中只因为名字带 BASE_URL。
     模型网关有默认值是对的(默认走 mock,不配 key 就不打真模型),与「写库不许有默认目标」无关。
     什么时候要动:若将来它被用来选择"写哪个库",立刻移出白名单。 */
  'apps/api/ai-utils.mjs': 'AI 模型网关地址,非目标库;默认走 mock,不影响写库去向',
}
const ALLOW_CAP = Object.keys(ALLOW_DEFAULT).length

const withDefault = writers.filter((w) => w.hasDefault.length && !ALLOW_DEFAULT[w.file])
check(`① 写库脚本零默认目标:${writers.length} 个会写库的脚本(git ls-files 递归全量)一个都不许有默认目标库`
  + '(三种形态全认:env|| / argv|| / 取参函数||)',
  withDefault.length === 0,
  withDefault.map((w) => `${w.file}[${w.hasDefault.join(',')}]`).join(' | '))

/* 🔴 主判(白名单式):A 类独立可跑脚本**必须调 requireTarget**,没调就红点名。
   这条才是白名单 —— 不管目标变量叫什么名字,只问"这个会写库的脚本有没有护栏"。 */
/* 🔴 03o 落刀后现测补正:A/B 只看 local-server 的 import 图不够 ——
   `other-tenant-names.mjs` 被 3 个测试 import、`store-matrix.mjs` 被 test-store-jury import,
   它们**不是独立可跑脚本**,目标库由调用方(回归脚本)给。**被任何 tracked 文件 import 的都算 B。** */
const importedByAny = new Set()
for (const f of tracked.filter((x) => /\.(mjs|js)$/.test(x))) {
  for (const dep of importsOf(f)) importedByAny.add(dep)
}
const isB = (f) => reachable.has(f) || importedByAny.has(f)
const A = writers.filter((w) => !isB(w.file))
const B = writers.filter((w) => isB(w.file))
const noGuard = A.filter((w) => !w.guarded && !NOT_A_DB[w.file])
check(`①c 🔴 A 类独立可跑脚本 ${A.length} 个全部接了 requireTarget(B 类 ${B.length} 个由服务启动那一行统一自报;`
  + '扫"有没有护栏"是白名单,扫"默认值长什么样"是黑名单——变量改个名黑名单就瞎)',
  noGuard.length === 0, `${noGuard.length} 个没接:${noGuard.map((w) => w.file).join(' | ')}`)

/* ══ ①d 🔴 03q:改按**解析点**判,不按文件判 ══
   店主咬出:「它按文件记『接没接护栏』,同一脚本两个目标解析点、一个有护栏就算过。」
   —— 而这**正是这次事故的通道**:`seed-bigdemo` 的 HTTP 那条腿(SEED_BASE_URL)接了 requireTarget,
   直连 sqlite 那条腿(DB_PATH)却硬编码着本机库。①c 只问"这个文件里有没有 requireTarget 三个字",
   于是它绿着,而 5 行演示数据写进了本机库,回执还写着「本机库未动」。

   解析点的机制定义(先写类定义,再给机械证据):
   **一个脚本每决定一次"写到哪儿去",就是一个解析点。** 两类:
   · 类 A「硬编码目标」—— `http://127.0.0.1:端口` 或 `.sqlite` / local-data / sandbox-data 路径字面量。
     它自带答案,**永远不算被守住**(打错了照样不报错,正是病根)。
   · 类 B「取值目标」—— 读 env/argv/取参函数拿目标。**必须在同一条语句里流进 requireTarget**
     (同行或紧邻 2 行内),否则等于取了值没人验。 */
const RP_HARD = /(['"`])https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?[^'"`]*\1|(['"`])[^'"`]*(?:local-data|sandbox-data)\/[^'"`]*\2|(['"`])[^'"`]*\.sqlite\3/g
const RP_READ = new RegExp(`process\\.env\\.${TARGETISH}|process\\.argv\\[[^\\]]+\\]|\\b(?:val|arg|opt|getArg)\\s*\\(\\s*['"\`](?:db|database|data-dir|sqlite|base|url)['"\`]\\s*\\)`, 'g')

const points = []
for (const w of A) {
  if (NOT_A_DB[w.file]) continue
  const raw = readFileSync(join(ROOT, w.file), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))   // 注释置空但保住行号
    .replace(/^[^\S\n]*(\/\/|#).*$/gm, '')
  const lines = src.split('\n')
  /* 守护窗口:requireTarget 所在行 ±2 行 —— 「取了值紧接着送去验」的形状 */
  const guardWin = new Set()
  lines.forEach((l, i) => { if (l.includes('requireTarget')) for (let d = -2; d <= 2; d += 1) guardWin.add(i + d) })
  lines.forEach((l, i) => {
    /* 🔴 首跑现测:17 个"没守住"里 15 个命中在 `hint:` 的**提示文案**上 ——
       requireTarget 拒绝执行时打给人看的那句「(沙箱 …/ 本机库 …)」。
       那是**说明**不是目标,和「刀数到自己的案底注释」同族(判据不许被自己的解释误报)。
       但这一条只放行 hint 文案本身,不放行同文件其它硬编码 —— 否则又退回按文件判。 */
    if (/\bhint\s*:/.test(l)) return
    /* 两条**精确**豁免(各写理由,不许按目录放行):
       · `{ readOnly: true }` / `mode=ro` 同行 —— 只读诊断,它压根不是"写到哪儿去"的解析点;
         写库自报律管的是**写**,`railway ssh` 里跑只读查询同样算诊断而不算写生产。
       · 从**已被守住的变量**派生出来的名字(`SANDBOX.replace('.sqlite', …)` 取快照名)——
         那是一个派生,不是第二次决定目标;守住源变量就守住了它。 */
    const readOnly = /readOnly\s*:\s*true|mode=ro/.test(l)
    const derived = /\b[A-Z_]{3,}\s*\.replace\s*\(/.test(l)
    /* 第三条**精确**豁免(06i 加,照旧逐条写理由、不按目录放行):
       **无头浏览器自己的调试口** —— `http://127.0.0.1:<端口>/json/list` 与 `/json/version`
       是 Chrome DevTools Protocol 的**发现口**,它决定的是「连哪一个浏览器」,
       **不是「写到哪个库/哪台服务」** —— 写库自报律管的是后者。
       为什么现在才冒出来:06i 给 contrast-sweep 加了登录态夹具(一条 POST),
       它因此第一次被判成 writer 进了 A 类,于是这条一直都在的 CDP 行才被扫到。
       判法按**路径**精确匹配,不按文件放行:同一文件里别的硬编码目标照旧要红。 */
    const cdpPort = /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+|:\$\{[^}]+\})?\/json\/(list|version)/.test(l)
    for (const m of l.matchAll(RP_HARD)) {
      points.push({ file: w.file, line: i + 1,
        kind: readOnly ? '只读诊断' : derived ? '派生名' : cdpPort ? '浏览器调试口' : '硬编码目标',
        txt: m[0].slice(0, 46), guarded: readOnly || derived || cdpPort })
    }
    for (const m of l.matchAll(RP_READ)) points.push({ file: w.file, line: i + 1, kind: '取值目标', txt: m[0].slice(0, 46), guarded: guardWin.has(i) })
  })
}
/* 硬编码目标的白名单:确有理由的逐条写(目前只有一条 —— 沙箱起停脚本本身就是"把 4310 定义出来"的那处) */
const HARD_OK = {
  'apps/api/start-sandbox.sh': '沙箱启动脚本:它**就是**「4310 是什么」的定义处,不是"选择写哪个库"的解析点',
}
const unguarded = points.filter((p) => !p.guarded && !HARD_OK[p.file])
check(`①d 🔴 按解析点判(不按文件):A 类脚本共 ${points.length} 个目标解析点,`
  + `每一个都得自己被守住 —— 同一脚本两条腿、一条接了护栏另一条硬编码,按文件判会绿,`
  + '而那正是 03q 那次「本机库又被写了」的通道',
  unguarded.length === 0,
  `${unguarded.length} 个没守住:${unguarded.slice(0, 10).map((p) => `${p.file}:${p.line}[${p.kind}]${p.txt}`).join(' | ')}`)

/* ①e 自守:造两个已知阳性 —— 「一条腿有护栏另一条硬编码」必须被咬出来 */
const CANARY_RP = [
  "const BASE = requireTarget({ envName: 'X', value: process.env.X_BASE_URL })",   // 守住的
  "const DB_PATH = '/Users/x/apps/api/local-data/lucky-luxe.sqlite'",              // 没守住的(事故原形)
]
const cw = new Set(); CANARY_RP.forEach((l, i) => { if (l.includes('requireTarget')) for (let d = -2; d <= 2; d += 1) cw.add(i + d) })
const cp = []
CANARY_RP.forEach((l, i) => {
  for (const m of l.matchAll(RP_HARD)) cp.push({ kind: '硬编码目标', guarded: false, txt: m[0] })
  for (const m of l.matchAll(RP_READ)) cp.push({ kind: '取值目标', guarded: cw.has(i), txt: m[0] })
})
const bad2 = cp.filter((p) => !p.guarded)
check('①e 🔴 零命中先证刀能咬:造「一条腿接了护栏 + 另一条腿硬编码本机库」的原形,'
  + '必须**只咬出硬编码那一条**(全咬中=见谁都红,一条不咬=按文件判的老毛病)',
  cp.length === 2 && bad2.length === 1 && bad2[0].kind === '硬编码目标', JSON.stringify(cp))

check(`①b 默认目标白名单棘轮 ≤ ${ALLOW_CAP}(现为空:一个都不该有;要加必须写理由并报批)`,
  Object.keys(ALLOW_DEFAULT).length <= ALLOW_CAP, String(Object.keys(ALLOW_DEFAULT).length))

/* ② 反向守:扫描面 = 底数(店主 03g:刀自证扫到的文件数 = git ls-files 底数,少一个就红)
   这条防的正是 03g 咬到我的那件事:`os.listdir` 不递归,两个子目录整体逃出扫描面而刀照样绿。 */
const SUBDIRS = ['tools/sim/', 'apps/api/tools/']
const subCount = SUBDIRS.map((d) => ({ d, n: CAND.filter((f) => f.startsWith(d)).length }))
check(`② 反向守:扫描面递归到子目录 —— ${subCount.map((x) => `${x.d}${x.n} 个`).join(' · ')}(不递归时这里是 0,刀会绿在空气上)`,
  subCount.every((x) => x.n > 0), JSON.stringify(subCount))

check(`②b 反向守:候选文件 ${CAND.length} >= 90(git ls-files 底数;仓库被裁或扫描面缩水立刻红)`,
  CAND.length >= 90, String(CAND.length))

/* ③ 自守(店主 03j 律:零命中先证刀能咬)—— 三种默认形态各造一个已知阳性,咬不到即红 */
const CANARY = [
  { name: 'env||', text: "const B = process.env.CANARY_BASE_URL || 'http://127.0.0.1:4128'" },
  { name: 'argv||', text: "const P = process.argv[2] || './canary.sqlite'" },
  { name: '取参函数||', text: "const D = val('db') || join(__dirname, 'canary.sqlite')" },
]
const blind = CANARY.filter((c) => !DEFAULTS.find((d) => d.name === c.name).rx.test(c.text))
check('③ 🔴 零命中先证刀能咬:三种默认目标形态各一个已知阳性,必须全被咬中(我为此连栽三次)',
  blind.length === 0, `咬不到:${blind.map((c) => c.name).join(' | ')}`)

const guarded = writers.filter((w) => w.guarded).length
/* 🔴 03r(店主亲跑咬出):尾行原来用 `!reachable.has()` 分 A/B,而判据 ①c 用的是 `isB()`
   —— `isB` = `reachable || importedByAny`,比 `reachable` 多一个条件。
   **同一份数据、两把尺**:尾行报「已接 36/40」,判据判的却是 35/35。
   报数的那一行和判据必须是同一把尺,否则人看着尾行以为还差 4 个没接,
   而判据早就绿了 —— 归族「判据自述须与行为一致」,只是这次错在**自述**那一侧。
   改法:尾行直接用判据算出来的 A/B 两个数组,不再自己算一遍。 */
/* ══ ④ 🔴 常驻:《写库脚本护栏三列清单》必须 ≡ 当前提交的现扫输出(店主 04a §一 病二 第 1 条)══
   案由:03z 把清单改成「由刀生成」,可**同一个提交上它就过期了** ——
   `0ec3bff` 自己新增了两个写库脚本,清单里一个都没有,而 `tools/migrate-cross-tenant-bookings.mjs`
   恰恰**正是这份清单该管的东西**(真写库点、真事务),清单上没有它,清单的意义就丢了一半。
   店主的话:**「没有这一条,『由刀生成』只是把手写的时机换了个人。」**
   ——「生成于提交」那一行按行剔掉(它每次提交都变,不是内容)。 */
const CHECKLIST = join(ROOT, 'handoff', '写库脚本护栏三列清单.md')
const stripStamp = (t) => t.split('\n').filter((l) => !STAMP_LINE.test(l)).join('\n')
const liveScan = scanWriteSites(ROOT)
const liveMd = stripStamp(renderChecklist(liveScan, 'x'))
let fileMd = ''
try { fileMd = stripStamp(readFileSync(CHECKLIST, 'utf8')) } catch { fileMd = '(清单文件不存在)' }
const firstDiff = (() => {
  const a = liveMd.split('\n'); const b = fileMd.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return `第 ${i + 1} 行:现扫「${(a[i] ?? '(无)').slice(0, 70)}」 ≠ 文件「${(b[i] ?? '(无)').slice(0, 70)}」`
  }
  return ''
})()
check('④ 🔴 《写库脚本护栏三列清单》≡ 当前提交现扫输出 —— 不一致就是**清单过期**,'
  + '跑 `node tools/gen-guard-checklist.mjs --write` 重生成。'
  + '(03z 案底:清单在生成它的那个提交上就已经过期,漏掉的正是当批新写的迁移脚本)',
liveMd === fileMd, firstDiff)

/* ══ ④b 第二层:**机械判据**,不靠列举被测对象 ══
   第一版我把这一层写成「清单里不许出现 KNIVES 里的那几个文件」——
   **造病验红当场没红**:把生成器从 KNIVES 里拿掉,判据就不再去找它。
   那正是店主 08-27 立的「白名单判据 > 黑名单判据」在判据自己身上重演一遍
   (同族第三案:①c 曾靠「文件里有没有 requireTarget 三个字」判护栏)。

   换成机制判据:**清单里列出的每个文件,写库的证据必须是代码里真的在写,
   不能是尺子里当判据用的那串字面量。** 剥掉正则字面量与字符串字面量之后还留得下证据的才算数。
   两层因此能被同一把刀分开(店主 09-01 判据四):
   谁把某个刀从 KNIVES 里拿掉 → ④ 照样绿(清单跟着重生成就一致了),**④b 红**。 */
const listed = [...fileMd.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1])
const fakeWriters = [...new Set(listed)].filter((f) => {
  try { return !isRealWriter(readFileSync(join(ROOT, f), 'utf8')) } catch { return true }
})
check(`④b 🔴 机械判据(**不靠列举被测对象**):清单里列出的 ${new Set(listed).size} 个文件,`
  + '每一个的「会写库」证据都必须是**代码里真的在写**,不能是尺子里当判据用的字面量 —— '
  + '剥掉正则/字符串字面量后仍留得下证据才算数。'
  + '03z 那份清单就把生成器列成了「含事务的写库点」,而它**同时**被当成"接了护栏"'
  + '(`requireTarget` 在它源码里是尺子的字面量),①c 因此对它是绿的 —— 刀咬自己,两个方向都会说谎',
fakeWriters.length === 0, fakeWriters.join(' | '))

/* ④b2 反向:排除面**不许藏真写库点**。KNIVES 是人写的表,人会往里塞东西;
   塞进去一个真会写库的脚本,它就从所有护栏判据上消失了(判据覆盖面要有判据)。 */
const hidden = Object.keys(KNIVES).filter((f) => {
  try { return isRealWriter(readFileSync(join(ROOT, f), 'utf8')) } catch { return false }
})
check('④b2 反向守:「刀本身」排除面里**不许藏真写库点** —— '
  + '往表里塞一个真会写库的脚本,它就从所有护栏判据上一起消失了',
hidden.length === 0, hidden.join(' | '))

/* ④b3 零命中先证刀能咬 + 剥字符串/剥正则的行号自守(给刀用的预处理不许改行号) */
const CAN_RULER = "const WRITES = /DatabaseSync|db\\.exec\\(/\nconst G = /requireTarget/\n"
const CAN_REAL = "import { DatabaseSync } from 'node:sqlite'\nconst db = new DatabaseSync(P)\ndb.exec('BEGIN IMMEDIATE')\n"
const lineSafe = (t) => stripStrings(stripRegex(bareOf(t))).split('\n').length === t.split('\n').length
check('④b3 🔴 零命中先证刀能咬:尺子形状(字面量长在正则里)必须判成「不是写库点」,'
  + '真写库形状(new DatabaseSync / db.exec)必须判成「是」;'
  + '并自守剥正则/剥字符串**不改行号**(店主 03x 收编:预处理吃掉换行,后面每个行号都是错的)',
!isRealWriter(CAN_RULER) && isRealWriter(CAN_REAL) && lineSafe(CAN_RULER) && lineSafe(CAN_REAL)
  && lineSafe(readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')),
JSON.stringify({ ruler: isRealWriter(CAN_RULER), real: isRealWriter(CAN_REAL) }))

check(`④c 刀本身排除面棘轮 ≤ ${KNIVES_CAP} 且逐个必须真实存在(声明过期=悄悄扩大排除面)`,
  Object.keys(KNIVES).length <= KNIVES_CAP && Object.keys(KNIVES).every((k) => existsSync(join(ROOT, k))),
  Object.keys(KNIVES).filter((k) => !existsSync(join(ROOT, k))).join(' | '))

/* ══ ⑤ 🔴 04a 现测撞出来的一个洞:扫描面是 `git ls-files`,**没 `git add` 的新文件对所有护栏刀是隐形的** ══
   我造病验红时连造两次都没红,查到最后是因为 `tools/guard-scan.mjs` 当时还没入册 ——
   刀不是没咬,是**没看见**。一个新写的写库脚本在 add 之前,零默认目标 / 必接护栏 / 含事务验回滚
   三条判据一条都不管它。归族「判据覆盖面要有判据」(03o:目录不递归 → 20 个脚本整体漏网)。
   所以交付前工作区不许躺着未入册的 tools/**.mjs|sh 与 apps/api/**.mjs|sh。 */
const untracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf8' }).split('\0').filter((f) => /^(tools|apps\/api)\/.*\.(mjs|sh)$/.test(f))
check('⑤ 🔴 工作区不许有**未入册**的 tools/**.mjs|sh 与 apps/api/**.mjs|sh —— '
  + '扫描面是 `git ls-files`,没 `git add` 的新文件对每一把护栏刀都是隐形的'
  + '(04a 现测:造病连两次没红,原因是新写的尺子文件当时还没入册,刀不是没咬,是没看见)',
untracked.length === 0, untracked.join(' | '))

/* ⑤b 🔴 ⑤ 自己的盲区(店主 04b §一.1 现测立刀):⑤ 用的是 `--others --exclude-standard`,
   所以**谁往 `.gitignore` 里加一行 `tools/foo.mjs`,那个脚本对 ⑤ 和三条护栏刀就都不存在了**。
   一个被忽略的写库脚本照样能跑、照样能写生产。店主原话:**「趁 0 立刀」**。
   例外要写理由(目录级的第三方产物,不是我们自己的脚本)。 */
const IGNORED_OK = {
  /* 目前为空 —— 我们自己的 .mjs/.sh 一个都不该被 ignore。
     要加必须写清「为什么这个脚本必须待在仓外」并报批。 */
}
/* 🔴 12m 两处现修,都是「我自己加 .gitignore 引出来的」——

   ① **ENOBUFS**:`tools/segment/venv`(1.1 GB)进了 .gitignore 之后,
      被忽略文件从几十个涨到 **36,417** 个,默认 1 MB 缓冲当场撑爆,整套件崩。
      不用 `--directory` 折目录 —— 那会把目录**里面**的 .mjs 一起藏掉,正是这条判据要防的事。
      改法:用 pathspec 让 git 只走这条判据关心的那四类路径(现测与「全量再过滤」逐条一致),
      再加 64 MB maxBuffer 兜底。**覆盖面一个字没减**。

   ② **第三方 venv 里的 .mjs/.sh**:torch 的 htm.mjs / preact.mjs、tqdm 的 completion.sh。
      这条判据本来就硬排除了 `node_modules/` —— Python 的 venv 对 Python 就是 node_modules 对 Node,
      同一类目录级第三方产物(判据抬头原话:「例外要写理由(目录级的第三方产物,不是我们自己的脚本)」)。
      所以按**同一条机械规则**扩,不是开个新口子。
      🔴 配反向守:凡被 venv 规则放掉的路径,其 venv 目录下必须真有 `pyvenv.cfg`
      —— 不然随便建个叫 venv 的目录就能把自己的写库脚本藏进来。 */
const THIRD_PARTY_DIR = /(^|\/)(node_modules|venv|venv312|\.venv)\//
const PATHSPEC = ['tools', 'apps/api'].flatMap((d) => [`:(glob)${d}/**/*.mjs`, `:(glob)${d}/**/*.sh`, `:(glob)${d}/*.mjs`, `:(glob)${d}/*.sh`])
const ignoredRaw = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', ...PATHSPEC],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
const thirdParty = ignoredRaw.filter((f) => THIRD_PARTY_DIR.test(f))
/* 反向守:被「第三方目录」放掉的,必须真的住在一个货真价实的 Python venv / node_modules 里 */
const fakeThirdParty = thirdParty.filter((f) => {
  const m = f.match(/^(.*?\/(?:node_modules|venv|venv312|\.venv))\//)
  if (!m) return true
  if (/node_modules$/.test(m[1])) return false                      // node_modules 沿用原有口径
  return !existsSync(join(ROOT, m[1], 'pyvenv.cfg'))                // venv 必须有 pyvenv.cfg 为证
})
check(`⑤b2 🔴 反向守:被「第三方目录」放掉的 ${thirdParty.length} 个脚本,都真住在货真价实的依赖目录里`
  + '(venv 必须有 pyvenv.cfg 为证 —— 否则随手建个叫 venv 的目录就能把自己的写库脚本藏进来)',
fakeThirdParty.length === 0, fakeThirdParty.join(' | '))
const ignoredScripts = ignoredRaw
  .filter((f) => /^(tools|apps\/api)\/.*\.(mjs|sh)$/.test(f) && !THIRD_PARTY_DIR.test(f) && !IGNORED_OK[f])
check('⑤b 🔴 不许有**被 .gitignore 挡住**的 tools/**.mjs|sh 与 apps/api/**.mjs|sh —— '
  + '⑤ 用 `--others --exclude-standard`,往 .gitignore 加一行就能让一个写库脚本'
  + '对 ⑤ 和三条护栏刀同时消失,而它照样跑得起来、照样写得了生产'
  + `(例外白名单 ${Object.keys(IGNORED_OK).length} 条,要加必须写理由)`,
ignoredScripts.length === 0, ignoredScripts.join(' | '))

const aGuarded = A.filter((w) => w.guarded).length
/* 分母也得说全:①c 判的是「A 类里**该有护栏的**」,NOT_A_DB(打 COS 对象存储、不碰库的两个)
   不在判据里。尾行只写 34/36,人会以为还差 2 个没接 —— 差额必须当场解释掉,不留给人猜。 */
const aNeed = A.filter((w) => !NOT_A_DB[w.file]).length
console.log(`\n[写库护栏] 候选 ${CAND.length} · 会写库 ${writers.length}(A 类 ${A.length} / B 类 ${B.length};`
  + `与 ①c 同一把尺:isB = local-server 可达 或 被任何 tracked 文件 import)`
  + `\n   A 类该有护栏 ${aNeed}/${A.length}(差 ${A.length - aNeed} 个是 NOT_A_DB:${Object.keys(NOT_A_DB).join(' · ')})`
  + ` —— 已接 ${aGuarded}/${aNeed} · 仍有默认目标 ${withDefault.length}`
  + `\n   目标解析点 ${points.length} 个,未守住 ${unguarded.length}(①d 按解析点判;按文件判看不见的那一层)`)
console.log(`   子目录覆盖:${subCount.map((x) => `${x.d}${x.n}`).join(' · ')}`)
if (fails.length) { console.error(`\n❌ test-db-target-guard ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-db-target-guard 通过 ${checks} 项`)
