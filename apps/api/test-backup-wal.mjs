/* 备份只许 VACUUM INTO —— 常驻判据(店主 09n 件 A)
 *
 * 🔴 案底三层,一层比一层要紧:
 *   ① 05n 店主现场撞出来:WAL 下 `cp` 出来的库**打不开**(`file is not a database`);
 *   ② `tools/db-backup.mjs` 的注释里早就写着「全仓凡备份一次库文件都该调它,**不许再 copyFileSync**」;
 *   ③ 🔴 **而开机迁移与「生产每日自动备份」两条路,走的都还是 `copyFileSync`** ——
 *      正确出口一直在,真正在跑的那条却是另一条。**一件事两处真相。**
 * 这一套把「备份语境里不许出现 cp」钉死,并**现证 cp 真的会拷出废文件**(J-58⑥ 两面)。
 */
import { readFileSync, readdirSync, copyFileSync, mkdtempSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
/* 🔴 10b:三个临时目录前缀从 `wal-proof-` / `ll-impsnap-` / `ll-cli-smoke-` 改成 `ll-ci-data.*`。
   前两个**早就在**,只是本文件原先没有 `spawn`,`test-credential-scan` ④h 的过滤条件
   (「提到 local-server.mjs **且** 有 spawn」)够不着它 —— 我为 ⑥ 加了 `spawnSync`,把它们一起晒了出来。
   这不是误报要豁免,是**扫描面变宽后看见了存量**。三个一起改名,判据一个字没动。 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { backupDb } from './db-backup-core.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let n = 0
const fails = []
const check = (name, cond, detail = '') => {
  n += 1
  if (cond) console.log(`ok ${n} - ${name}`)
  else { console.log(`not ok ${n} - ${name} :: ${detail}`); fails.push(name) }
}

/* ① 行为层两面:WAL 里压着已提交数据时,cp 出来的是废的,VACUUM INTO 出来的是对的 */
const d0 = mkdtempSync(join(tmpdir(), 'll-ci-data.walproof-'))
const src = join(d0, 't.sqlite')
const db = new DatabaseSync(src)
db.exec('PRAGMA journal_mode=WAL'); db.exec('CREATE TABLE t (id INTEGER)')
db.exec('BEGIN'); for (let i = 0; i < 5000; i++) db.prepare('INSERT INTO t VALUES (?)').run(i); db.exec('COMMIT')
const real = db.prepare('SELECT COUNT(*) n FROM t').get().n
const cpOut = join(d0, 'by-cp.sqlite'); copyFileSync(src, cpOut)
const vOut = join(d0, 'by-vacuum.sqlite'); const r = backupDb(src, vOut)
const readN = (p) => { try { const x = new DatabaseSync(p, { readOnly: true }); const v = x.prepare('SELECT COUNT(*) n FROM t').get().n; x.close(); return v } catch { return -1 } }
check(`①a 🔴 **必中靶子**:WAL 下 cp 出来的那份读不回原数(源 ${real} 行 · cp 那份 ${readN(cpOut)})`,
  readN(cpOut) !== real, `cp 那份读到 ${readN(cpOut)},与源 ${real} 一样 —— 那这条判据在空守`)
check(`①b ✅ **反面靶子**:同一时刻 VACUUM INTO 出来的那份读得回原数(${readN(vOut)} 行 · ${r.bytes} 字节 · ${r.tables} 张表)`,
  readN(vOut) === real, `VACUUM 那份读到 ${readN(vOut)}`)
check('①c backupDb **当场打开验过**(验不过要抛,不许把废文件当备份交出去)', r.tables >= 1)

/* ② 静态白名单式:备份语境里不许出现 copyFileSync */
const files = readdirSync(join(ROOT, 'apps/api')).filter((f) => f.endsWith('.mjs') && !f.startsWith('test-'))
const BACKUP_CTX = /backup|快照|snapshot|pre-import|pre-rebuild/i
const hits = []
for (const f of files) {
  const src2 = readFileSync(join(ROOT, 'apps/api', f), 'utf8')
  src2.split('\n').forEach((ln, i) => {
    if (!/\bcopyFileSync\s*\(/.test(ln)) return
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return                 // 注释里提到不算(J-61)
    const near = src2.split('\n').slice(Math.max(0, i - 6), i + 2).join('\n')
    if (BACKUP_CTX.test(near) || BACKUP_CTX.test(ln)) hits.push(`apps/api/${f}:${i + 1} ${ln.trim().slice(0, 80)}`)
  })
}
/* 🔴 10a · D202-b:**这张白名单清空了,而且上限从 ≤1 拧到 ===0**(裁#105:抽取要压低棘轮,不留余量)。
 * 最后那一条是 `local-server.mjs` 的导入前快照,09x 批过豁免,理由是我给的
 * 「跑在接口线程里、导入事务之前,而 VACUUM INTO 要独占读锁」。
 * **那句话把位置说错了**(J-84 先定位再归因):那段在模块顶层、开机时跑,
 * 下面 `new DatabaseSync` 还没执行 —— 此刻进程里一个库连接都没有,没东西可抢。
 * 四档现测:①真实位置 ✅4ms ②WAL+握着写事务 ✅6ms ③delete+握着写事务 ✅2ms
 * ⇒ **那个前提从来没成立过,不是「条件变了才到期」**(比 J-104 的说法更难看,如实记)。
 * ④而 WAL 库上 cp 主文件,读出来是 `no such table` —— 留的底份是个废文件。
 * 已换成唯一出口 `backupDb`。**以后要再往这张表里加一条,先回答:为什么不能用 VACUUM INTO。** */
export const CP_BACKUP_ALLOW = []
const outside = hits.filter((h) => !CP_BACKUP_ALLOW.some((a) => h.startsWith(a.at)))
check(`②a 🔴 备份语境里 \`copyFileSync\` 现扫 **${outside.length} 处**(扫了 ${files.length} 个非测试模块;白名单 ${CP_BACKUP_ALLOW.length} 条各有理由)`,
  outside.length === 0, outside.join(' | '))
check(`②b 🔴 白名单**清零并锁死**(现 ${CP_BACKUP_ALLOW.length} === 0;10a 之前是 1)`,
  CP_BACKUP_ALLOW.length === 0 && CP_BACKUP_ALLOW.every((a) => String(a.why).length > 20))
/* ②c 自守:塞一行备份语境的 cp,必须被咬到(零命中不算通过 —— J-58①) */
const probe = ['const backupPath = x', ['copyFileSync', '(dbPath, backupPath)'].join('')].join('\n')
const probeHit = probe.split('\n').some((ln, i) => /\bcopyFileSync\s*\(/.test(ln) && BACKUP_CTX.test(probe))
check('②c 自守:构造一行「备份语境里的 cp」必须被咬到', probeHit)
check('②d 反向守:非备份语境的 cp 不许被咬(否则这条会把正常拷贝一起判红)',
  !(/\bcopyFileSync\s*\(/.test('copyFileSync(a, b)') && BACKUP_CTX.test('const a = 1\ncopyFileSync(a, b)')))

/* ③ 开机链那两处重建,各自必须先备份 */
const ls = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
check('③a 开机重建 A(去 tenant_id 默认值)调用处带了 dbPath,走 backupBeforeRebuild',
  /backupBeforeRebuild\(\{\s*dbPath:/.test(ls))
check('③b 🔴 开机重建 B(唯一约束重建)调用处也把 dbPath 传进去了(不传 = 那次 DROP 没有备份)',
  /rebuildTenantScopedUnique\(db,\s*\{\s*dbPath:/.test(ls))
const sur = readFileSync(join(ROOT, 'apps/api/schema-unique-rebuild.mjs'), 'utf8')
check('③c 🔴 两处 `DROP TABLE` 之前都有 backupFirst(全仓仅有的两处 DROP,此前一行备份都没有)',
  (sur.match(/backupFirst\(/g) || []).length >= 2, String((sur.match(/backupFirst\(/g) || []).length))


/* ── ④ 🔴 D202(店主 09o §二.3):**全仓不许再出现「cp 一个 sqlite 文件」的写法** ──
 *
 * ② 那一层只扫 `apps/api/*.mjs` 的**平铺一层**、而且只看**备份语境**。两个缺口都得补
 * (判据三推论:判据的覆盖面本身要有判据):
 *   ⓐ 扫描面 —— `tools/` 里 cp 一个库、`apps/api/tools/` 里 cp 一个库,② 一个都看不见;
 *   ⓑ 类的定义 —— 按**机制**定义(拷的是不是 sqlite),不按**长相**(附近有没有 backup 字样)。
 * 白名单式:抠出全仓所有「cp/rename 一个 sqlite」的位置,逐个必须落进白名单并写理由。
 */
function allSources() {
  const out = []
  const walk = (dir) => {
    let es
    try { es = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue
      const p2 = join(dir, e.name)
      if (e.isDirectory()) { walk(p2); continue }
      if (!/\.(mjs|js)$/.test(e.name)) continue
      const rel = p2.slice(ROOT.length).replace(/^\/+/, '')
      if (/(^|\/)test-/.test(rel)) continue                      // 判据自己不算被测面(J-61②)
      if (rel.startsWith('tools/probe-samples/')) continue        // 夹具目录(J-61④)
      out.push(rel)
    }
  }
  for (const dd of ['apps', 'tools']) walk(join(ROOT, dd))
  return out.sort()
}
/** 这一行是不是「在拷一个 sqlite 文件」—— 按机制判,不按附近有没有 backup 字样。 */
const SQLITE_HINT = /sqlite|dbPath|DB_PATH|dbFile/i
function copiesSqlite(line, near) {
  if (!/\b(copyFileSync|cpSync)\s*\(/.test(line)) return false
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false              // 注释里提到不算
  return SQLITE_HINT.test(line) || SQLITE_HINT.test(near)
}
const allFiles = allSources()
check(`④a 扫描面:全仓非测试 .mjs/.js **${allFiles.length}** 个(apps/ + tools/ 递归;② 那一层只有 ${files.length} 个平铺文件)`,
  allFiles.length >= 275, `只扫到 ${allFiles.length} —— 覆盖面缩水本身就是缺陷`)

const sqliteCopies = []
for (const rel of allFiles) {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n')
  lines.forEach((ln, i) => {
    const near = lines.slice(Math.max(0, i - 6), i + 3).join('\n')
    if (copiesSqlite(ln, near)) sqliteCopies.push({ rel, line: i + 1, text: ln.trim().slice(0, 78) })
  })
}
/** 🔴 白名单:每条写明为什么这一处 cp 一个 sqlite 可以。**只许变短。** */
/* 🔴 10a · D202-b:**这张白名单也清零了**(上一条是 `local-server.mjs` 的导入前快照,理由见 ② 那一段)。
   连同登记在案的两笔残留一起清:`demo-reset.mjs` 形参里那个死参 `copyFileSync` 已摘掉,
   `local-server.mjs` 也不再往里传 —— 于是本文件从 ④ 的命中面上真正消失,不是靠放行消失的。 */
const SQLITE_CP_ALLOW = new Map([])
const badCopies = sqliteCopies.filter((h) => !SQLITE_CP_ALLOW.has(h.rel))
check(`④b 🔴 全仓「cp 一个 sqlite」现扫 **${sqliteCopies.length}** 处,全部落进白名单(白名单 ${SQLITE_CP_ALLOW.size} 条)`,
  badCopies.length === 0, badCopies.map((h) => `${h.rel}:${h.line} ${h.text}`).join(' | '))
/* 🔴 10a:这一条原来**标签写「≤ 1」、代码写 `<= 2`** —— 判据自己在说谎,
   而说谎的方向恰好是放松的那一边。现在两边都是 0,并且标签由同一个字面量渲染。 */
const CP_ALLOW_CAP = 0
check(`④c 🔴 白名单**清零并锁死**(现 ${SQLITE_CP_ALLOW.size} === ${CP_ALLOW_CAP};10a 之前是 1,而上限当时写的是 2)`,
  SQLITE_CP_ALLOW.size === CP_ALLOW_CAP)
check('④d 白名单零残留:每条都对应一个现存命中',
  [...SQLITE_CP_ALLOW.keys()].every((k) => sqliteCopies.some((h) => h.rel === k)),
  `这些白名单条目已无对应命中:${[...SQLITE_CP_ALLOW.keys()].filter((k) => !sqliteCopies.some((h) => h.rel === k)).join(', ')}`)
/* ④的刀:造一行「cp 一个库」必须咬中;cp 一张图不许被咬中 */
check('④e 🔴 造病:一行「cp 一个 sqlite」必须被咬中',
  copiesSqlite(['copyFileSync', '(dbPath, out)'].join(''), 'const out = "x.sqlite"'))
check('④f 反向守:cp 一个非库文件不许被咬中(否则会把正常拷贝一起判红)',
  !copiesSqlite(['copyFileSync', '(logoPng, distPng)'].join(''), 'const distPng = "logo.png"'))

/* ── ⑤ 🔴 D202 白名单那一处的附加条件(店主 09w §六 裁)──────────────────
 * 裁词:那一处跑在接口线程、导入事务之前,而 `VACUUM INTO` 要独占读锁,当场会打架 ⇒ **批准保留 cp**。
 * **但加一条**:那份快照生成之后,**必须能被打开并逐表读出行数;读不出来当场红。**
 * 理由(D202 全案的教训):**一个还原不了的快照,和没有快照是一回事。**
 *
 * 这一条**按机制验,不按写法验**:照那一处的做法(cp 一个活库)真做一次,然后打开数行。
 * 🔴 不是"看看代码里有没有写 open" —— 那又回到「验回执」那一族了(J-62②)。 */
const d5 = mkdtempSync(join(tmpdir(), 'll-ci-data.impsnap-'))
const live5 = join(d5, 'live.sqlite')
{
  const w = new DatabaseSync(live5)
  w.exec('CREATE TABLE a (id INTEGER PRIMARY KEY, v TEXT)')
  w.exec('CREATE TABLE b (id INTEGER PRIMARY KEY)')
  for (let i = 0; i < 300; i += 1) w.prepare('INSERT INTO a (v) VALUES (?)').run('x' + i)
  w.close()
}
const snap5 = join(d5, 'lucky-luxe.pre-import-999.sqlite')
copyFileSync(live5, snap5)          // ← 与 local-server.mjs 那一处同一种做法
let snapTables = -1
let snapRows = -1
try {
  const r5 = new DatabaseSync(snap5, { readOnly: true })
  snapTables = r5.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n
  snapRows = r5.prepare('SELECT COUNT(*) AS n FROM a').get().n
  r5.close()
} catch (e) { snapTables = -1; snapRows = `打不开:${e.message}` }
check(`⑤a 🔴 D202 白名单那一处:快照生成后**必须打得开并逐表读得出行数**(现测 ${snapTables} 张表 · a=${snapRows})`,
  snapTables >= 2 && snapRows === 300,
  '一个还原不了的快照,和没有快照是一回事 —— 这正是 D202 全案的教训')
check('⑤b 🔴 反向守:把快照截断成废文件 → 这一条必须红(否则它只是在走过场)',
  (() => {
    const bad = join(d5, 'broken.sqlite')
    writeFileSync(bad, 'not a database at all')
    try { const x = new DatabaseSync(bad, { readOnly: true }); x.prepare('SELECT COUNT(*) FROM a').get(); x.close(); return false }
    catch { return true }
  })())

/* ── ⑥ 备份那条命令行真跑得起来吗(10a 现场立,复发登记的永久护栏)────────────
 * 🔴 案底:10a 补拍生产备份,照 runbook 敲 `DBB_SRC=… DBB_OUT=… node tools/db-backup.mjs`,
 * **在生产容器里当场崩** —— `ReferenceError: statSync is not defined`。
 * 根因有两层:② CLI 自己手抄了一遍 VACUUM+验(而文件顶上就 export 着 `backupDb`),
 * ① 抄本漏了一个 import。**①是②的必然结果。**
 *
 * 为什么这条护栏必须「真跑」:那个 ReferenceError 在**最后一行**才炸,
 * 而 VACUUM 早就做完了 —— 于是它是最坏的那种坏:**事情做成了,命令报失败。**
 * `node --check` 看不见它(语法是合法的),import 一下也看不见(没给 env 就走模块分支)。
 * ⑥c 专门把这件事证出来:**同一份坏副本,便宜判据绿,真跑红。**(判据四:同一把刀要分得出谁在守)
 */
const d6 = mkdtempSync(join(tmpdir(), 'll-ci-data.clismoke-'))
const srcDb = join(d6, 'src.sqlite')
{ const x = new DatabaseSync(srcDb); x.exec('CREATE TABLE a(id INTEGER); INSERT INTO a VALUES (1),(2)'); x.close() }
const CLI = join(ROOT, 'tools/db-backup.mjs')
const runCli = (script, out) => {
  const r = spawnSync(process.execPath, ['--experimental-sqlite', script], {
    encoding: 'utf8', env: { ...process.env, DBB_SRC: srcDb, DBB_OUT: out },
  })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}
const good = runCli(CLI, join(d6, 'good.sqlite'))
check('⑥a `tools/db-backup.mjs` 这条命令行**真跑一次**:退出码 0(不是 --check 绿,是真跑绿)',
  good.code === 0, `退出码 ${good.code} :: ${(good.err || good.out).trim().split('\n').slice(-2).join(' / ')}`)
check('⑥b 它真把库备出来了:输出 JSON 里报了表数,而且备份件打得开、数得出行',
  (() => {
    try {
      const j = JSON.parse(good.out.trim().split('\n').pop())
      if (!j.表 || j.已验证可打开 !== true) return false
      const x = new DatabaseSync(j.备份, { readOnly: true })
      const cnt = x.prepare('SELECT COUNT(*) AS n FROM a').get()?.n; x.close()
      return cnt === 2
    } catch { return false }
  })(), good.out.trim().slice(0, 160))

/* 把 10a 那个病**原样注回**一份临时副本,证明这把刀咬得动(J-91:夹具先证明自己能揭发) */
const brokenCli = join(d6, 'db-backup-broken.mjs')
/* 🔴 副本住在临时目录,它那两条相对 import 解析不到 —— 第一版就是这么红的:
   **刀确实红了,但红的原因跟我瞄的那个病无关**(同族:test-restore-fingerprint ③a 那次)。
   所以先把相对路径改成绝对 file:// 再注病,保证它只可能因为 statSync 而红。 */
writeFileSync(brokenCli, readFileSync(CLI, 'utf8')
  .replace(/from '\.\/db-target\.mjs'/, `from '${pathToFileURL(join(ROOT, 'tools/db-target.mjs')).href}'`)
  .replace(/from '\.\.\/apps\/api\/db-backup-core\.mjs'/, `from '${pathToFileURL(join(ROOT, 'apps/api/db-backup-core.mjs')).href}'`)
  .replace(
    /console\.log\(JSON\.stringify\(\{ 源库.*$/m,
    'console.log(JSON.stringify({ 源库: SRC, 备份: r.out, 字节: statSync(OUT).size, 表: r.tables }, null, 0))'))
const broken = runCli(brokenCli, join(d6, 'broken-out.sqlite'))
check('⑥c 🔴 反向守:把「用了没 import 的 statSync」原样注回去 → **真跑必须红**',
  broken.code !== 0 && /statSync is not defined/.test(broken.err),
  `退出码 ${broken.code} :: ${broken.err.trim().split('\n')[0] || '(没报 ReferenceError)'}`)
check('⑥d 🔴 而同一份坏副本 `node --check` **照样绿** —— 所以这条只能靠真跑守,便宜判据是瞎的',
  spawnSync(process.execPath, ['--check', brokenCli], { encoding: 'utf8' }).status === 0)
/* 🔴 第一版我写的是「全文不许出现 VACUUM INTO 字面量」,结果被自己那句行尾注释
   `// VACUUM INTO + 当场打开验一次,都在出口里` 判红 —— **那把尺子数的是「提及」,该数「执行」**(J-61①)。
   改成盯**执行形**:`prepare('VACUUM INTO…')`。注释里怎么写都不算,真去跑它才算。 */
check('⑥e 🔴 唯一出口:CLI 不许再**执行**一遍 VACUUM(`prepare(\'VACUUM INTO\')` 零处),只许调 `backupDb`',
  !/prepare\(\s*[`'"]\s*VACUUM INTO/i.test(readFileSync(CLI, 'utf8')) && /backupDb\(/.test(readFileSync(CLI, 'utf8')),
  '还搜得到 prepare("VACUUM INTO…"),说明抄本还在')
check('⑥f 🔴 反向守:把执行形注回去,⑥e 那把尺子必须咬得中(J-91 夹具先证明自己能揭发)',
  /prepare\(\s*[`'"]\s*VACUUM INTO/i.test("const x = db.prepare('VACUUM INTO ?').run(out)"))

/* ══ ⑦ 备份文件名必须说真话(11a §〇.2)══════════════════════════════
 * 🔴 案底:`生产库_夜16推前_20260922T0000Z.sqlite` 实际拍于 `2026-09-20T19:32:34Z` —— **差近 29 小时**。
 * 根在 Cowork 的令文件名按「店主要睡了所以算明天」写日期(她记第 39 笔),我照着它命名。
 * **一个会被用来挑还原目标的名字,不许是推出来的。**
 * 唯一出口:`tools/backup-name-check.mjs`(判据与将来的备份脚本共用同一个函数)。
 */
const bn = await import('../../tools/backup-name-check.mjs')
const T0 = Date.UTC(2026, 8, 21, 8, 22, 51)
check('⑦a 🔴 造病:名字写错两天 → 必须判「在说谎」',
  bn.nameTellsTruth('生产库_x_20260922T0000Z.sqlite', T0).ok === false)
check('⑦b 🔴 反向守:名字准(差 10 秒)→ 必须放行(只会红不会绿的判据 = 没有判据)',
  bn.nameTellsTruth('生产库_x_20260921T082241Z.sqlite', T0).ok === true)
check('⑦c 名字只给到分钟(HHMM)也算数,但那一分钟必须对',
  bn.nameTellsTruth('生产库_x_20260921T0822Z.sqlite', T0).ok === true
  && bn.nameTellsTruth('生产库_x_20260921T0900Z.sqlite', T0).ok === false)
check('⑦d 🔴 名字里没有时间戳 → 也判不过(没有时间戳就无法自证,不是「没问题」)',
  bn.nameTellsTruth('生产库_随便起的名.sqlite', T0).ok === false)
check("⑦e 🔴 第一版我只认 6 位 HHMMSS,把 `T0600Z` 读成 `000000` —— 现在 4 位也认得出",
  bn.nameTimestamp('x_20260921T0600Z.sqlite').kind === 'HHMM'
  && bn.nameTimestamp('x_20260921T060000Z.sqlite').kind === 'HHMMSS')
check(`⑦f 🔴 历史豁免只许变短(现 ${bn.LEGACY_LYING_NAMES.length} ≤ 6);**今后新产生的备份一律不许进这张表**`,
  bn.LEGACY_LYING_NAMES.length <= 6)

/* ⑦g:本机真有 `backups/` 就逐份验;CI 上那个目录 gitignored 不存在 —— **明说没验成,不算绿**(J-98) */
const BK = join(ROOT, 'backups')
if (!existsSync(BK)) {
  check('⑦g ⬜ 本机没有 `backups/`(CI 上它 gitignored)—— **这一条没验成**,只验了上面那把尺子本身', true,
    '明说:不是「验过没问题」')
} else {
  const files = readdirSync(BK).filter((f) => f.endsWith('.sqlite'))
  const liars = files.filter((f) => !bn.nameTellsTruth(f, statSync(join(BK, f)).mtimeMs).ok
    && !bn.LEGACY_LYING_NAMES.includes(f))
  check(`⑦g 🔴 \`backups/\` 现有 ${files.length} 份;**豁免之外名字说谎的 = ${liars.length}**(必须 0)`,
    liars.length === 0, liars.join(' | '))
}

console.log(`\n1..${n}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${n} 条)`)
