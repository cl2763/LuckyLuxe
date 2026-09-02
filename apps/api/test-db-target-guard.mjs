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

/* 底数:git ls-files 递归全量(排除测试与本刀自身) */
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)
const CAND = tracked.filter((f) => /^(tools|apps\/api)\/.*\.(mjs|sh)$/.test(f)
  && !/\/(test-|run-)/.test(f) && !f.endsWith('test-db-target-guard.mjs'))

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
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|#).*$/gm, '')
  if (!WRITES.test(src)) continue
  const hasDefault = DEFAULTS.filter((d) => d.rx.test(src)).map((d) => d.name)
  writers.push({ file: f, hasDefault, guarded: /requireTarget/.test(src) })
}

/* 白名单:确有理由保留默认目标的,逐条写理由(目前为空 —— 一个都不该有) */
/* 非数据库目标的白名单(理由随码 + 什么时候要动) */
const NOT_A_DB = {
  'tools/ops-cos-delete.mjs': '打的是腾讯云 COS 对象存储,不是数据库;钥匙从 env 读、--yes 才真删。什么时候要动:若它开始写库',
  'tools/smoke-cos-upload.mjs': 'COS 上传冒烟,不碰数据库。什么时候要动:若它开始写库',
}
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
console.log(`\n[写库护栏] 候选 ${CAND.length} · 会写库 ${writers.length}(A 类 ${writers.filter((w) => !reachable.has(w.file)).length} / B 类 ${writers.filter((w) => reachable.has(w.file)).length})`
  + ` · A 类已接护栏 ${writers.filter((w) => !reachable.has(w.file) && w.guarded).length} · 仍有默认目标 ${withDefault.length}`)
console.log(`   子目录覆盖:${subCount.map((x) => `${x.d}${x.n}`).join(' · ')}`)
if (fails.length) { console.error(`\n❌ test-db-target-guard ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-db-target-guard 通过 ${checks} 项`)
