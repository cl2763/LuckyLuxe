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
const CODE = tracked.filter((f) => /\.(mjs|js)$/.test(f) && (f.startsWith('apps/api/') || f.startsWith('tools/'))
  && !f.endsWith('test-tenant-explicit.mjs'))

/* 注释置空但保住行号(判据不许被自己的案底注释误报) */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*\/\/.*$/gm, '')
const INS = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+users\s*\(([^)]*)\)/gi

const scan = (text) => {
  const out = []
  const src = bare(text)
  for (const m of src.matchAll(INS)) {
    out.push({ line: src.slice(0, m.index).split('\n').length, cols: ' '.join ? m[1] : m[1], has: /\btenant_id\b/.test(m[1]) })
  }
  return out
}

const sites = []
for (const f of CODE) {
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  for (const h of scan(src)) sites.push({ file: f, ...h })
}

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
check(`③ 反向守:扫描面 ${CODE.length} >= 180 个源文件 · 命中 ${sites.length} >= 8 处 `
  + '(目录被排除或语句被改写成看不见的形状时立刻红)',
sites.length >= 8 && CODE.length >= 180, JSON.stringify({ files: CODE.length, sites: sites.length }))

/* ④ 列定义还带着 DEFAULT 的,记在案上 —— 去掉它入上线硬门槛批(店主 03v 裁) */
const schemaSrc = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const stillDefault = /tenant_id\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'lucky-luxe'/.test(schemaSrc)
console.log(`   [在案] users.tenant_id 的 DEFAULT 'lucky-luxe' ${stillDefault ? '**仍在**' : '已去掉'}`
  + ' —— 去掉它要重建表,风险不值,已入上线硬门槛批;在那之前由本刀守「不许再有人忘写」')

console.log(`\n[默认租户] 源文件 ${CODE.length} · INSERT INTO users ${sites.length} 处 · 漏写 ${missing.length} · 白名单 ${Object.keys(ALLOW).length}`)
if (fails.length) { console.error(`\n❌ test-tenant-explicit ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-tenant-explicit 通过 ${checks} 项`)
