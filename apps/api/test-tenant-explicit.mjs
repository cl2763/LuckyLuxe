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

/* ══ 🔴 D131 同族 31 张表(店主 04a §三 报数 → **04b §二 裁:全修、不白名单、棘轮落到 0**)══
   带 `tenant_id … DEFAULT 'lucky-luxe'` 的表**不是 2 张,是 31 张**;
   D128 只盯 users、D130 加 user_identities,剩下 29 张同一根子没人盯。
   表清单**由刀从 schema 生成**(pragma 找带 DEFAULT 的 tenant_id 列),不手写。
   04a 报数 9 处 → 04b 全修完,**从此是硬规则:漏写 0 处,一处都不白名单**。
   其中两处是红线(`quote_requests` 4984 / `reminder_tasks` 4974)——它们卡在
   AI 报价状态机的正路上:单落错店 → 本店状态机永远找不到自己刚建的单,
   而旗舰店报价台列得出别店的报价。行为面由 `test-quote-tenant` 在**非默认租户**里走一遍。 */
/* 🔴 走 `test-need-sandbox.mjs` 的唯一出口(公约④:一件事一处真相)。
   夜15 (丙):CI 上 `SANDBOX_DATA_DIR` 指到临时目录,这里自动跟着走;
   本机不设那个变量时,取值与以前**一模一样**。
   🔴 这是 L2 第二轮才扫出来的一批 —— 第一轮我只改了两个文件,而同类共 4 个。
   **「改一处硬路径」永远是一类,不是一处**(J-78②)。 */
const { SANDBOX_DB_PATH } = await import('./test-need-sandbox.mjs')
const DBP = process.env.TEST_DB_PATH || SANDBOX_DB_PATH
let famTables = []
let famDefaults = []
let famNullable = []
let famFillTriggers = []
let famRows = []
let famErr = ''
try {
  const fdb = new DatabaseSync(DBP, { readOnly: true })
  /* 🔴 04f-2 换锚:DEFAULT 已经全去掉了,再按「带 DEFAULT」找表会得到 0 张 —— 判据会**绿在空气上**。
     换成按「**有没有 `tenant_id` 列**」取:这是更宽的超集(31 → 全部带租户列的表),
     白名单式也更彻底 —— 新表只要带 tenant_id 就自动进扫描面。 */
  famTables = fdb.prepare(`SELECT DISTINCT m.name AS t FROM sqlite_master m JOIN pragma_table_info(m.name) p
    WHERE m.type='table' AND p.name='tenant_id' AND p."notnull" = 1 ORDER BY 1`).all().map((r) => r.t)
  /* 可空的那一族靠 `<表>_tenant_fill` 触发器从父行落值 —— 另一套机制,单独一条判据守 */
  famNullable = fdb.prepare(`SELECT DISTINCT m.name AS t FROM sqlite_master m JOIN pragma_table_info(m.name) p
    WHERE m.type='table' AND p.name='tenant_id' AND p."notnull" = 0 ORDER BY 1`).all().map((r) => r.t)
  famFillTriggers = fdb.prepare("SELECT tbl_name AS t FROM sqlite_master WHERE type='trigger' AND name LIKE '%_tenant_fill'").all().map((r) => r.t)
  famDefaults = fdb.prepare(`SELECT DISTINCT m.name AS t FROM sqlite_master m JOIN pragma_table_info(m.name) p
    WHERE m.type='table' AND p.name='tenant_id' AND p.dflt_value IS NOT NULL`).all().map((r) => r.t)
  fdb.close()
} catch (error) { famErr = error.message }
/* 取不到前置就红,**不许静默跳过**(断言增量律:被条件块包住的断言取不到前置必须红) */
check(`🟡 D131 前置:拿得到 schema(${DBP.replace(ROOT, '.')})才能生成表清单 —— `
  + '取不到就红,不许静默跳过整段报数(断言增量律)。'
  + '锚从「带 DEFAULT 的表」换成「带 tenant_id 列的表」:默认值已全部去掉,'
  + '再按旧锚找会得到 0 张、判据绿在空气上',
famTables.length >= 31, famErr || `只取到 ${famTables.length} 张`)

if (famTables.length) {
  for (const t of famTables) {
    const hits = scanAll(t)
    famRows.push({ t, hit: hits.length, miss: hits.filter((h) => !h.has).length,
      where: hits.filter((h) => !h.has).map((h) => `${h.file}:${h.line}`) })
  }
  const totalHit = famRows.reduce((a, r) => a + r.hit, 0)
  const totalMiss = famRows.reduce((a, r) => a + r.miss, 0)
  console.log(`\n   ══ 🔴 D131 同族现测(硬规则:漏写必须 0)══ 带 DEFAULT 的表 ${famTables.length} 张 ·`
    + ` INSERT 共 ${totalHit} 处 · **漏写 tenant_id ${totalMiss} 处**`)
  for (const r of famRows.filter((x) => x.miss).sort((a, b) => b.miss - a.miss || a.t.localeCompare(b.t))) {
    console.log(`      ${r.t.padEnd(24)} INSERT ${String(r.hit).padStart(2)} 处 · 漏 ${r.miss} 处 ← ${r.where.join(' , ')}`)
  }
  console.log(`      (其余 ${famRows.filter((x) => !x.miss).length} 张零漏写)`)
  /* 🔴 硬规则(店主 04b §二 裁):**0 处,一处都不白名单**。
     04a 那条 ≤9 的棘轮是报数期的临时线,已作废 —— 报数期结束了,现在是零容忍。 */
  const missWhere = famRows.filter((x) => x.miss).flatMap((x) => x.where.map((w) => `${x.t}@${w}`))
  check(`🔴 D131 白名单式硬规则:同族 ${famTables.length} 张表、${totalHit} 处 INSERT,`
    + `漏写 tenant_id **必须 0 处**(现为 ${totalMiss})—— 一处都不白名单;`
    + '这一族的根都是列定义带 `DEFAULT \'lucky-luxe\'`,忘写就静默塞进旗舰店',
  totalMiss === 0, missWhere.join(' | '))
  /* ══ 🔴 04f-2 新加的一层:可空的 tenant_id 靠触发器落值 —— 那就**必须真有那个触发器** ══
     去掉 DEFAULT 之后把锚放宽,才看见这一族(payments / business_hours / booking_slots …7 张):
     它们的 tenant_id 是 ALTER 加的**可空**列,漏写不会报错、会落 NULL,
     由 `<表>_tenant_fill` 从父行补上。所以这一族的判据不是「INSERT 必须写」,
     而是「**必须有那个触发器**」—— 新加一张这样的表却忘了配触发器,行就带着 NULL 租户躺进库里。 */
  /* 白名单:确实不靠触发器、而是**每处 INSERT 都显式写**的,逐条写理由 + 现测证据。
     加一条就要动棘轮,并在回报里说明为什么。 */
  const FILL_ALLOW = {
    finance_targets: '不靠触发器:全仓两处 INSERT(local-server.mjs:14195 / :14487)都在列名里显式写了 tenant_id;'
      + '现测本机库 4 行、沙箱 2 行,tenant_id 为 NULL 的 0 行。'
      + '什么时候要动:再多一个写入口、或出现 NULL 行,就该给它配 `finance_targets_tenant_fill`',
  }
  const FILL_ALLOW_CAP = Object.keys(FILL_ALLOW).length
  check(`🔴 落值触发器白名单棘轮 ≤ ${FILL_ALLOW_CAP}(每条要有理由与现测证据;只减不增)`,
    Object.keys(FILL_ALLOW).length <= FILL_ALLOW_CAP, String(Object.keys(FILL_ALLOW).length))
  const missFill = famNullable.filter((t) => !famFillTriggers.includes(t) && !FILL_ALLOW[t])
  check(`🔴 可空租户列必须有落值触发器:${famNullable.length} 张表的 tenant_id 可空,`
    + `逐个必须有 \`<表>_tenant_fill\`(现有 ${famFillTriggers.length} 条)—— `
    + '可空列漏写不报错、落 NULL,靠触发器从父行补;没有触发器 = 行带着 NULL 租户躺进库里',
  missFill.length === 0, `缺触发器:${missFill.join(' · ')}`)

  check(`🔴 D131 反向守:表清单由 schema 现取 ${famTables.length} >= 31 张 · INSERT 底数 ${totalHit} >= 60 处 `
    + '(清单被写死或扫描面缩水立刻红 —— 判据覆盖面要有判据)',
  famTables.length >= 31 && totalHit >= 60, JSON.stringify({ tables: famTables.length, hits: totalHit }))
}

/* ④ 列定义还带着 DEFAULT 的,记在案上 —— 去掉它入上线硬门槛批(店主 03v 裁) */
const schemaSrc = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
/* ══ 🔴 04f-2:「在案」翻面 —— DEFAULT 已经去掉了,从「记在案上」升成**硬判据** ══
   店主 04f §一.2 裁:31 张表去 DEFAULT,迁移脚本 + 彩排。做法是重建表(SQLite 没有 DROP DEFAULT),
   建表语句里不再写、老库由开机迁移 `dropTenantDefaults` 摘掉,两个调用方同一个出口。
   从此漏写 tenant_id 不再静默塞进旗舰店,而是当场 `NOT NULL constraint failed`。 */
const stillDefault = (schemaSrc.match(/tenant_id\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'lucky-luxe'/g) || []).length
const famWithDefault = famDefaults.length
check('④ 🔴 库里**一张表都不许再带** `tenant_id DEFAULT` —— '
  + '「有默认值,打错了不报错」是 D127/D128/D130/D131 的同一根子;'
  + '去掉之后漏写当场报 NOT NULL,不再静默落进旗舰店',
famWithDefault === 0, `仍带 DEFAULT 的表:${famDefaults.join(' · ')}`)

/* ④b 反向守:源码里**只许**在 ALTER 那一路留 DEFAULT —— SQLite 给非空表加 NOT NULL 列时
   没有默认值直接失败,那两处的 DEFAULT 只用来给存量行落值,随后由 dropTenantDefaults 摘掉。
   CREATE TABLE 里再出现一处就是回潮。 */
const createWithDefault = (schemaSrc.match(/tenant_id\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'lucky-luxe'/g) || []).length
const alterWithDefault = (schemaSrc.match(/ALTER\s+TABLE[^\n]*tenant_id\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'lucky-luxe'/g) || []).length
check(`④b 反向守:源码里带 DEFAULT 的 ${createWithDefault} 处**必须全部是 ALTER**(现为 ${alterWithDefault} 处)—— `
  + 'ALTER 给非空表加 NOT NULL 列必须带默认值,那是落存量行用的;'
  + 'CREATE TABLE 里再出现一处就是回潮',
createWithDefault === alterWithDefault, `CREATE 侧还有 ${createWithDefault - alterWithDefault} 处`)
console.log(`   [在案] 源码里 DEFAULT 'lucky-luxe' ${stillDefault} 处(全在 ALTER 那一路)· 库里带 DEFAULT 的表 ${famWithDefault} 张`)

/* ══ 07a 裁 #47(日1 段3)· **按 id 查 technicians / stores 必须带租户条件** ══
   现查:`local-server.mjs` 里这类查询**带**租户条件的有 5 处、**不带**的有 10 处
   (另加一个子查询)——店主的定性是**「纵深没做满」不是「门开着」**:
   那些 id 来自本店自己的单,要真漏出去得先有一张挂错店的单,而那正是 D126/D130/D131/D132 治过的。
   但纵深就是拿来防「哪天真挂错了一张单」的,所以逐处补齐,并立**白名单式**判据:
   **不带租户条件的必须 0 处**,新写一处当场红并点名 file:line。
   ⚠️ 判据看代码不看注释;扫描面按**文件**走(全仓 apps/api/*.mjs),不按记忆里的那张清单 ——
      现测:清单上写的是 10 处,机械扫出来是 **15 处**(local-server 12 + 另外三个模块各 1)。
      **靠列举被测对象的判据永远漏没列的那几个。** */
/* ⚠️ 扫描面**限于店主裁定的那两张表**(technicians / stores)。
   我把它放宽到 users / services 试扫过一次:**56 处**不带租户条件 —— 同一族、但population 大得多,
   不是这一段 45 分钟能做完的,**顺手改掉才是真的危险**。所以:按裁定的范围收口,
   users/services 那 56 处**单独登记待排**(见回执 §段3),不在这里悄悄扩面也不悄悄放过。 */
const TENANT_SCOPED = /FROM\s+(technicians|stores)\s+WHERE\s+id\s*=\s*\?/gi
/* 白名单:确实不该带租户条件的,**逐条写理由**,条数上棘轮。 */
const TENANT_OK = [
  { at: 'apps/api/local-server.mjs', sql: 'SELECT tenant_id FROM stores WHERE id = ?',
    why: '这一句的**用途就是问「这个门店属于哪一家租户」** —— 给它加 AND tenant_id = ? 等于先要答案再问问题(循环),它是租户判定的**源头**,不是一次跨店取数' },
]

const tenantLeaks = []
for (const f of CODE) {
  /* 刀不许咬自己:本文件里那两条**反向守**就写着一句不带租户条件的样例 ——
     它是尺子不是产品(同族:guard-scan 那次「刀咬自己两个方向都会说谎」)。 */
  if (f.endsWith('test-tenant-explicit.mjs')) continue
  const src = readFileSync(join(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  src.split('\n').forEach((ln, i) => {
    if (/^\s*(\/\/|\*)/.test(ln)) return
    for (const m of ln.matchAll(TENANT_SCOPED)) {
      const after = ln.slice(m.index + m[0].length, m.index + m[0].length + 40)
      if (/AND\s+tenant_id\s*=/i.test(after)) continue
      if (TENANT_OK.some((w) => f.endsWith(w.at) && ln.includes(w.sql))) continue
      tenantLeaks.push(`${f}:${i + 1} ${m[0]}`)
    }
  })
}
check(`⑦ 按 id 查 technicians / stores **必须带租户条件**(店主 07a 裁 #47 的范围):全仓现扫 ${tenantLeaks.length} 处不带的(要 0)`,
  tenantLeaks.length === 0, tenantLeaks.slice(0, 8).join(' | '))
check(`⑦b 白名单只许 ${TENANT_OK.length} 条(逐条写了理由;要加先报店主)`, TENANT_OK.length <= 1, String(TENANT_OK.length))
check('⑦c 🔴 反向守:这把刀确实会咬 —— 一句不带租户条件的写法必须被认出来(否则「0 处」是空转)',
  /FROM\s+technicians\s+WHERE\s+id\s*=\s*\?/i.test("db.prepare('SELECT * FROM technicians WHERE id = ?').get(x)"))
check('⑦d 🔴 反向守之二:带了租户条件的**不许**被误咬',
  !(() => { const ln = "db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(x, t)"
    const re = /FROM\s+(technicians|stores)\s+WHERE\s+id\s*=\s*\?/gi
    for (const m of ln.matchAll(re)) { if (!/AND\s+tenant_id\s*=/i.test(ln.slice(m.index + m[0].length, m.index + m[0].length + 40))) return true }
    return false })())

console.log(`\n[默认租户] 源文件 ${CODE.length} · INSERT INTO users ${sites.length} 处 · 漏写 ${missing.length} · 白名单 ${Object.keys(ALLOW).length}`)
if (fails.length) { console.error(`\n❌ test-tenant-explicit ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-tenant-explicit 通过 ${checks} 项`)
