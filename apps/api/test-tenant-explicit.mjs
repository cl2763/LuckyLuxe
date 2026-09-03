/* 默认租户刀(D128,店主 03v §三 裁,2026-09-03 落)

   ══ 案由 ══
   `users` 表的列定义是:

       tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe'

   于是任何**忘了写这一列**的 INSERT,都会把人静默塞进旗舰店。
   D127 现查时它已经咬到人了:生产上小婕店那唯一一张预约,
   顾客档案挂在旗舰店名下 —— 而小婕店在生产上顾客档案数是 **0**。

   店主 03v 的定性:**默认租户与默认目标库同族 —— 有默认值,打错了不报错。**
   (同族既有成员:`process.env.X || '默认'` 造景脚本默认写本机库 D124;
     `|| 默认值` / `?.` / `CREATE TABLE IF NOT EXISTS` 静默失败器族。)

   ══ 为什么现在不改表 ══
   SQLite 改列定义要重建表,风险不值(店主 03v 原话)。
   **去掉 DEFAULT 本身入上线硬门槛批**;在那之前,靠这把刀守住「不许再有人忘写」。

   ══ 判据形态(白名单式)══
   全仓每一处 `INSERT INTO users` **必须显式写 `tenant_id` 列**;
   写不了的逐条登记理由,新写的自动红。
   —— 不是数「我改的那三处对了」,是数「全部必须落进白名单」。 */

/* ⚠️ 剥行注释必须用 `[^\S\n]` 星号,不能用 `\s` 星号 —— **`\s` 包含换行**:
   那样写会把前面的空行连同换行一起吃掉,剥完的文本比原文少行,
   于是**按它算出来的行号全是错的**(03t 现测:admin.js 8551 → 8504,少 47 行,
   我因此连报错三次条数与位置)。同族:块注释也必须**保住换行**再置空。
   (本注释刻意不写出那个正则原文(略)。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { isKnife } from '../../tools/guard-scan.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)
/* 排除面 = 「刀本身」,接共用出口 `isKnife`(`tools/guard-scan.mjs`,带理由 + 棘轮)。
   04a 现测撞出来的:`test-identity-tenant` 里那两条**故意不写 tenant_id 的金丝雀**
   被这把刀数成了违规 —— 判据的金丝雀是「已知阳性」,不是产品代码。
   同族:03o「刀数到自己的案底注释」。排除面只此一份,不许各刀各写一句。 */
const CODE = tracked.filter((f) => /\.(mjs|js)$/.test(f) && (f.startsWith('apps/api/') || f.startsWith('tools/'))
  && !isKnife(f))

/* 注释置空但保住行号(判据不许被自己的案底注释误报) */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*\/\/.*$/gm, '')

/* ══ 剥前剥后行数相等 · 自守(店主 03x 收编)══
   律:**给刀用的预处理不许改行号**;凡剥注释/剥字符串的辅助函数,自守一条「剥前剥后行数相等」。
   案由:我的剥行注释吃掉了换行,admin.js 剥完 8551 → 8504(少 47 行),
   于是按它算的行号全错,我连报三次错数、还照错行号改坏过一个 IIFE。
   这一条放在每把用 bare() 的刀里当场自证 —— 出口自己坏了,后面所有命中位置都不可信。 */

const __bareProbe = 'a\n\n  // x\n/* y\n z */\nb\n'
check('⓪ 自守:剥注释的辅助函数**不许改行号**(剥前剥后行数必须相等)—— '
  + '出口自己吃掉换行,后面每一处「第几行命中」都是错的(店主 03x 收编)',
bare(__bareProbe).split('\n').length === __bareProbe.split('\n').length,
`剥前 ${__bareProbe.split('\n').length} 行 → 剥后 ${bare(__bareProbe).split('\n').length} 行`)

/* 表名参数化:同一把尺问「这张表的每处 INSERT 写没写 tenant_id」——
   D128 问 `users`,D130 问 `user_identities`,D131 问 schema 里带 DEFAULT 的全部 31 张。 */
const insRx = (table) => new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${table}\\s*\\(([^)]*)\\)`, 'gi')

const scan = (text, table = 'users') => {
  const out = []
  const src = bare(text)
  for (const m of src.matchAll(insRx(table))) {
    out.push({ line: src.slice(0, m.index).split('\n').length, cols: ' '.join ? m[1] : m[1], has: /\btenant_id\b/.test(m[1]) })
  }
  return out
}

const SRC = new Map()
for (const f of CODE) {
  try { SRC.set(f, readFileSync(join(ROOT, f), 'utf8')) } catch { /* 读不到就不算进底数 */ }
}
const scanAll = (table) => {
  const out = []
  for (const [f, src] of SRC) for (const h of scan(src, table)) out.push({ file: f, ...h })
  return out
}
const sites = scanAll('users')

/* 白名单:确实写不了 tenant_id 的,逐条写理由(目前为空 —— 一处都不该有) */
const ALLOW = {}
const ALLOW_CAP = Object.keys(ALLOW).length

const missing = sites.filter((s) => !s.has && !ALLOW[`${s.file}:${s.line}`])
check(`① 白名单式:全仓 ${CODE.length} 个源文件里 ${sites.length} 处 \`INSERT INTO users\`,`
  + '**每一处都必须显式写 tenant_id** —— 列定义带 `DEFAULT \'lucky-luxe\'`,'
  + '忘写就把人静默塞进旗舰店(生产已咬到:小婕店 0 个顾客档案,它那张单的人挂在旗舰店)',
missing.length === 0, missing.map((s) => `${s.file}:${s.line}(${s.cols.trim().slice(0, 46)})`).join(' | '))

check(`①b 白名单棘轮 ≤ ${ALLOW_CAP}(现为空:一处都不该有;要加必须写理由并报批)`,
  Object.keys(ALLOW).length <= ALLOW_CAP, String(Object.keys(ALLOW).length))

/* ② 零命中先证刀能咬(店主 03j 律):造一个已知阳性 */
const CANARY_BAD = "db.prepare('INSERT INTO users (id, display_name, phone) VALUES (?, ?, ?)')"
const CANARY_OK = "db.prepare('INSERT INTO users (id, display_name, tenant_id) VALUES (?, ?, ?)')"
const bad = scan(CANARY_BAD)
const ok = scan(CANARY_OK)
check('② 🔴 零命中先证刀能咬:漏写 tenant_id 的 INSERT 必须被咬中',
  bad.length === 1 && bad[0].has === false, JSON.stringify(bad))
check('②b 反向守:写了 tenant_id 的**不许**被咬中(判据要能分出写没写,不是见 INSERT 就红)',
  ok.length === 1 && ok[0].has === true, JSON.stringify(ok))

/* ③ 反向守:扫描面没缩水(判据覆盖面要有判据) */
/* 门槛从 180 降到 100:04a 把「刀本身」(test-* / run-* 与显式声明的两个)移出扫描面之后,
   底数由 200 收到 110 —— **这是面的定义变了,不是面缩水了**。差额必须当场解释,不许闷声改数字。 */
check(`③ 反向守:扫描面 ${CODE.length} >= 100 个**产品**源文件 · 命中 ${sites.length} >= 8 处 `
  + '(目录被排除或语句被改写成看不见的形状时立刻红;04a 起排除「刀本身」,底数 200 → 110)',
sites.length >= 8 && CODE.length >= 100, JSON.stringify({ files: CODE.length, sites: sites.length }))

/* ══ ①d 🔴 D130:同一把尺问 `user_identities`(店主 04a §二 第 2 条)══
   它的列定义同样带 `DEFAULT 'lucky-luxe'`,而启动回填四条 INSERT 原来都不带 tenant_id ——
   本机库现测 96 行身份挂错店。危害不止标错:`upsertUserIdentity` 按
   (provider, provider_user_id, ownerTenant) 找已有行,旗舰店顾客用同一手机号绑定时
   命中的正是别店顾客那行被错标成 lucky-luxe 的身份,然后 UPDATE 把 user_id 改指给自己 ——
   别店那位下次用手机号登录就找不到自己了。 */
const identSites = scanAll('user_identities')
const identMissing = identSites.filter((s) => !s.has)
check(`①d 🔴 D130:全仓 ${identSites.length} 处 \`INSERT INTO user_identities\` **每一处都必须显式写 tenant_id** —— `
  + '与 `users` 同一根子(列定义带 DEFAULT),忘写就把别店顾客的身份标成旗舰店的',
identMissing.length === 0, identMissing.map((s) => `${s.file}:${s.line}(${s.cols.trim().slice(0, 46)})`).join(' | '))

check('①e 🔴 零命中先证刀能咬(user_identities 版):金丝雀正反各一',
  scan("db.prepare('INSERT OR IGNORE INTO user_identities (id, user_id, provider) VALUES (?,?,?)')", 'user_identities')[0]?.has === false
  && scan("db.prepare('INSERT INTO user_identities (id, user_id, tenant_id) VALUES (?,?,?)')", 'user_identities')[0]?.has === true, '')

/* ══ 🟡 D131 报数(店主 04a §三:**只报数,不修、不白名单,等我看数再裁**)══
   带 `tenant_id … DEFAULT 'lucky-luxe'` 的表**不是 2 张,是 31 张**;
   D128 只盯 users、D130 加 user_identities,剩下 29 张同一根子没人盯。
   表清单**由刀从 schema 生成**(pragma 找带 DEFAULT 的 tenant_id 列),不手写。 */
const DBP = process.env.TEST_DB_PATH || join(ROOT, 'apps/api/sandbox-data/lucky-luxe.sqlite')
let famTables = []
let famRows = []
let famErr = ''
try {
  const fdb = new DatabaseSync(DBP, { readOnly: true })
  famTables = fdb.prepare(`SELECT m.name AS t FROM sqlite_master m JOIN pragma_table_info(m.name) p
    WHERE m.type='table' AND p.name='tenant_id' AND p.dflt_value IS NOT NULL ORDER BY 1`).all().map((r) => r.t)
  fdb.close()
} catch (error) { famErr = error.message }
/* 取不到前置就红,**不许静默跳过**(断言增量律:被条件块包住的断言取不到前置必须红) */
check(`🟡 D131 前置:拿得到 schema(${DBP.replace(ROOT, '.')})才能生成表清单 —— `
  + '取不到就红,不许静默跳过整段报数(断言增量律)',
famTables.length >= 31, famErr || `只取到 ${famTables.length} 张`)

if (famTables.length) {
  for (const t of famTables) {
    const hits = scanAll(t)
    famRows.push({ t, hit: hits.length, miss: hits.filter((h) => !h.has).length,
      where: hits.filter((h) => !h.has).map((h) => `${h.file}:${h.line}`) })
  }
  const totalHit = famRows.reduce((a, r) => a + r.hit, 0)
  const totalMiss = famRows.reduce((a, r) => a + r.miss, 0)
  console.log(`\n   ══ 🟡 D131 报数(report-only,不修)══ 带 DEFAULT 的表 ${famTables.length} 张 ·`
    + ` INSERT 共 ${totalHit} 处 · **漏写 tenant_id ${totalMiss} 处**`)
  for (const r of famRows.filter((x) => x.miss).sort((a, b) => b.miss - a.miss || a.t.localeCompare(b.t))) {
    console.log(`      ${r.t.padEnd(24)} INSERT ${String(r.hit).padStart(2)} 处 · 漏 ${r.miss} 处 ← ${r.where.join(' , ')}`)
  }
  console.log(`      (其余 ${famRows.filter((x) => !x.miss).length} 张零漏写)`)
  /* 棘轮:报数期间**只许降不许升**。这不是白名单(没有任何一处被放行),
     是「不许再变坏」的那条线 —— 店主看完数再裁是逐处修还是分批。 */
  const D131_CAP = 9
  check(`🟡 D131 棘轮:同族 ${famTables.length} 张表漏写 tenant_id 共 ${totalMiss} 处 ≤ ${D131_CAP}(报数期只许降不许升;`
    + '这不是白名单 —— 一处都没放行,等店主看数后裁逐处修还是分批)',
  totalMiss <= D131_CAP, `现为 ${totalMiss}`)
  check(`🟡 D131 反向守:表清单由 schema 现取 ${famTables.length} >= 31 张 · INSERT 底数 ${totalHit} >= 60 处 `
    + '(清单被写死或扫描面缩水立刻红)',
  famTables.length >= 31 && totalHit >= 60, JSON.stringify({ tables: famTables.length, hits: totalHit }))
}

/* ④ 列定义还带着 DEFAULT 的,记在案上 —— 去掉它入上线硬门槛批(店主 03v 裁) */
const schemaSrc = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const stillDefault = (schemaSrc.match(/tenant_id\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'lucky-luxe'/g) || []).length
console.log(`   [在案] 源码里写着 DEFAULT 'lucky-luxe' 的列定义 ${stillDefault} 处;库里带 DEFAULT 的表 ${famTables.length} 张`
  + ' —— 去掉要重建表,风险不值,已入**上线硬门槛批**(那一行从「users」改成「31 张表」,店主 04a §三);'
  + '在那之前由本刀守「不许再有人忘写」')

console.log(`\n[默认租户] 源文件 ${CODE.length} · INSERT INTO users ${sites.length} 处 · 漏写 ${missing.length} · 白名单 ${Object.keys(ALLOW).length}`)
if (fails.length) { console.error(`\n❌ test-tenant-explicit ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-tenant-explicit 通过 ${checks} 项`)
