#!/usr/bin/env node
/* 写库护栏 · **共用尺子**(店主 04a §一 病二 裁,2026-09-03)

   ══ 为什么要有这个文件 ══
   03z 把三列清单改成「由刀生成」,可**同一个提交上清单就过期了** ——
   因为「生成清单的那把尺」和「守清单的那把刀」各写了一份,两份会各自漂。
   店主 04a 的话:**「『由刀生成』只是把手写的时机换了个人,同一提交就过期已经证明了这一点。」**

   所以尺子搬到这里,**只此一份**:
   · `tools/gen-guard-checklist.mjs` —— 生成清单;
   · `apps/api/test-db-target-guard.mjs` —— 守「清单 ≡ 当前提交现扫」;
   · `apps/api/test-txn-rollback.mjs`   —— 第三列「含事务的写库点」逐个验回滚。
   三个用的是同一个 `scanWriteSites()`,不是同一段正则抄三遍。

   ══ 刀本身的排除面(**显式声明,不许悄悄排除**;店主 04a §一 病二 第 2 条)══
   刀的源码里写着 `DatabaseSync` / `BEGIN IMMEDIATE` / `requireTarget` 这些**当尺子用的字面量**,
   于是扫到刀自己身上时,量的是尺子不是产品。03z 那份清单里
   `tools/gen-guard-checklist.mjs` 就这么被当成「含事务的写库点」列了进去。
   更坏的一面店主没看到、我现测才发现:它**同时也把 `requireTarget` 那个字面量当成"接了护栏"** ——
   所以 `test-db-target-guard` ①c 见到它是绿的。**刀咬自己,两个方向都会说谎。**
   排除面因此写成一张**带理由的表 + 条数棘轮**,不是一句悄悄的 `!f.includes(...)`。 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

/* 逐条写理由;加一条就要动棘轮,并在回报里说明为什么 */
export const KNIVES = {
  'tools/guard-scan.mjs': '尺子本体 —— 正则里写着 DatabaseSync / BEGIN IMMEDIATE / requireTarget 当判据,扫它等于在量尺子',
  'tools/gen-guard-checklist.mjs': '清单生成器 —— 同上;它不写库,它只把现扫结果排版成 md',
}
export const KNIVES_CAP = 2

/* 「会写库但打的不是数据库」的白名单(理由随码 + 什么时候要动)——
   它们进得了 WRITES(有 method:'DELETE' 之类),但护栏管的是**写哪个库**,与打对象存储无关。
   放在这里而不是各刀各写一份:清单尾行的「A 类未接护栏 2」若不把它俩解释掉,
   人会以为还差两个没接 —— **差额必须当场解释掉,不留给人猜**。 */
export const NOT_A_DB = {
  'tools/ops-cos-delete.mjs': '打的是腾讯云 COS 对象存储,不是数据库;钥匙从 env 读、--yes 才真删。什么时候要动:若它开始写库',
  'tools/smoke-cos-upload.mjs': 'COS 上传冒烟,不碰数据库。什么时候要动:若它开始写库',
}

/* 前缀规则(test-* / run-*)与显式表并列,两者都算「刀本身」 */
export const isKnife = (f) => /\/(test-|run-)/.test(f) || Object.hasOwn(KNIVES, f)

/* ⚠️ 剥注释必须保住行号:剥行注释用 `[^\S\n]` 星号,**不能用 `\s` 星号**(它含换行,
   会把空行连同换行一起吃掉,剥完比原文少行,按它算的行号全错 —— 店主 03x 收编)。 */
export const bare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^[^\S\n]*(\/\/|#).*$/gm, '')

/* ══ 剥正则字面量(**04a 病二 第二层的机械判据**)══
   律的形状:**「会写库」的证据必须是代码里真的在写,不能是尺子里当判据用的那串字面量。**
   `tools/gen-guard-checklist.mjs` 里的 `DatabaseSync` 长在 `/DatabaseSync|.../` 里 —— 那是尺子;
   `tools/migrate-cross-tenant-bookings.mjs` 里的 `new DatabaseSync(DB_PATH)` 才是真在开库。
   剥掉正则字面量之后还留得下写库证据的,才算真写库点。

   为什么不能只靠 KNIVES 那张表:那是**黑名单**——谁把某个文件从表里拿掉,判据就不再去找它。
   (我第一版 ④b 就是这个毛病,造病验红当场没红。**判据不许靠列举被测对象。**)
   保守起见只剥「不可能是除号」的位置(紧跟 = ( , : [ ! & | ? return 之后),
   宁可少剥也不许错剥;剥出来的用空格填回去,**行号一个不动**(店主 03x 收编)。 */
export const stripRegex = (s) => s.replace(
  /([=(,:[!&|?]|\breturn|\btypeof)(\s*)\/(?![*/])((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+)\/[gimsuyd]*/g,
  (m, pre, ws) => pre + ws + ' '.repeat(m.length - pre.length - ws.length))

/* 剥字符串字面量(同上,只给第二层用)。为什么还要剥字符串:
   guard-scan 自己的 KNIVES 理由里写着「DatabaseSync / BEGIN IMMEDIATE」这些词 —— 那是**说明文字**。
   只剥正则不剥字符串的话,它照样被当成真写库点。
   ⚠️ 但 `method: 'POST'` 这一种写库证据**本来就长在字符串里**,剥了会漏 ——
   所以第二层拆成两问:代码型证据看剥字符串后的文本,HTTP 型证据看只剥正则的文本。
   宁可让第二层误红(响亮),不许让它误绿(静默失败器族)。 */
export const stripStrings = (s) => s.replace(
  /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
  (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[0])

const WRITES_CODE = /DatabaseSync|\.prepare\([^)]*\)\s*\.run\(|db\.exec\(/
const WRITES_HTTP = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/
/* 第二层的问句:**这个文件是真在写库,还是只是把写库的词当尺子写着?** */
export const isRealWriter = (raw) => {
  const b = stripRegex(bare(raw))
  return WRITES_CODE.test(stripStrings(b)) || WRITES_HTTP.test(b)
}

/* 写库的机制定义(先写类定义,再给机械证据) */
export const WRITES = /DatabaseSync|\.prepare\([^)]*\)\s*\.run\(|db\.exec\(|method:\s*['"](POST|PUT|PATCH|DELETE)['"]/

const importsOf = (ROOT, p) => {
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

export function scanWriteSites(ROOT) {
  const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean)
  const CAND = tracked.filter((f) => /^(tools|apps\/api)\/.*\.(mjs|sh)$/.test(f) && !isKnife(f))

  /* A/B 分类:从 local-server 的 import 图可达、或被任何 tracked 文件 import 的算 B(服务统一自报);
     其余是 A(独立可跑脚本),A 类必须自己调 requireTarget */
  const reachable = new Set()
  const stack = ['apps/api/local-server.mjs']
  while (stack.length) {
    const cur = stack.pop()
    if (reachable.has(cur)) continue
    reachable.add(cur)
    stack.push(...importsOf(ROOT, cur))
  }
  const importedByAny = new Set()
  for (const f of tracked.filter((x) => /\.(mjs|js)$/.test(x))) for (const d of importsOf(ROOT, f)) importedByAny.add(d)
  const isB = (f) => reachable.has(f) || importedByAny.has(f)

  const rows = []
  for (const f of CAND) {
    let raw = ''
    try { raw = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
    const src = bare(raw)
    if (!WRITES.test(src)) continue
    const http = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]|fetch\(/.test(src)
    const direct = /DatabaseSync/.test(src)
    const txn = /BEGIN IMMEDIATE|BEGIN TRANSACTION/.test(src)
    rows.push({
      f,
      类: isB(f) ? 'B' : 'A',
      形态: [direct ? '直连库' : '', http ? 'HTTP' : ''].filter(Boolean).join('+') || '—',
      护栏: /requireTarget/.test(src) ? '✔ requireTarget' : '—',
      事务: txn ? (/ROLLBACK/.test(src) ? '✔ 有事务(含 ROLLBACK)' : '⚠ 有 BEGIN 无 ROLLBACK') : '—',
      有COMMIT: /COMMIT/.test(src),
      有ROLLBACK: /ROLLBACK/.test(src),
      有BEGIN: txn,
    })
  }
  return {
    tracked,
    CAND,
    rows,
    A: rows.filter((r) => r.类 === 'A'),
    B: rows.filter((r) => r.类 === 'B'),
    withTxn: rows.filter((r) => r.有BEGIN),
    noGuardA: rows.filter((r) => r.类 === 'A' && r.护栏 === '—' && !NOT_A_DB[r.f]),
    notADb: rows.filter((r) => NOT_A_DB[r.f]),
    isB,
  }
}

/* 生成时间/提交号那两行会随每次提交变,守一致性时**按行剔掉**(见 STAMP_LINE) */
export const STAMP_LINE = /^> 生成于提交 /

export function renderChecklist(scan, stamp) {
  const { CAND, rows, A, B, withTxn, noGuardA } = scan
  const table = (list) => ['| 脚本 | 形态 | 护栏(去默认目标 + 自报) | 事务 |', '|---|---|---|---|']
    .concat(list.map((r) => `| \`${r.f}\` | ${r.形态} | ${r.护栏} | ${r.事务} |`)).join('\n')
  const knives = Object.entries(KNIVES).map(([f, why]) => `           · \`${f}\` —— ${why}`).join('\n')

  return `# 写库脚本护栏 · 三列清单(**本文件由刀生成,不要手改**)

> 生成器:\`tools/gen-guard-checklist.mjs\` · 尺子:\`tools/guard-scan.mjs\`(**唯一一份**,
> \`test-db-target-guard\` / \`test-txn-rollback\` 用的是同一个 \`scanWriteSites()\`)
> 生成于提交 \`${stamp}\`
>
> **为什么不手写**(店主 03z §一 裁):手写那份停在 09-02 —— 第二列 10 处还写着 ⬜ 而护栏早已接上,
> 第三列九处也已验过回滚,清单没跟着动。更要紧的是:清单写着「包了事务」的九处里,
> \`ledger-guards\` 现测**根本没有事务**。**清单是人写的,刀是机器咬的,以刀为准。**
>
> **为什么光"由刀生成"还不够**(店主 04a §一 病二 裁):03z 那次,清单在**同一个提交上就过期了**
> —— 生成它的尺子和守它的刀各写了一份,两份各自漂。所以现在:①尺子只此一份(\`guard-scan.mjs\`);
> ②\`test-db-target-guard\` 常驻守「本文件 ≡ 当前提交现扫输出」,不一致就红并让你重跑生成器。

## 尺子(与刀同一把)

\`\`\`
扫描面   git ls-files 递归全量的 tools/**.mjs|sh + apps/api/**.mjs|sh
排除面   「刀本身」——(a) 路径含 /test- 或 /run- 的;(b) 显式声明的两个:
${knives}
         排除理由:刀的源码里把 DatabaseSync / BEGIN IMMEDIATE / requireTarget 当**尺子的字面量**写着,
         扫到刀自己身上量的是尺子不是产品。两个方向都会说谎:既会把生成器当成"含事务的写库点"
         (03z 那份清单就这么多列了一行),也会把它当成"接了护栏"(现测:①c 因此对它是绿的)。
写库定义 直连 sqlite 写(DatabaseSync / .prepare().run / db.exec)或走 HTTP 打写口(POST|PUT|PATCH|DELETE)
分类     A 独立可跑脚本 = 护栏的对象;B 被 local-server 可达或被任何 tracked 文件 import = 服务统一自报
剥注释   保住行号(\`\\s\` 含换行会吃掉空行,行号一错全错 —— 店主 03x 收编)
\`\`\`

## 现测底数

| | 数 |
|---|---|
| 候选文件 | ${CAND.length} |
| 会写库 | ${rows.length}(A 类 ${A.length} · B 类 ${B.length}) |
| A 类该有护栏 | ${A.length - scan.notADb.filter((r) => r.类 === 'A').length} / ${A.length}(差额是下面那张「不是数据库」表) |
| **A 类未接护栏** | **${noGuardA.length}**${noGuardA.length ? `(${noGuardA.map((r) => `\`${r.f}\``).join(' · ')})` : ' — 全部接上'} |
| 含事务 | ${withTxn.length} |

### 「会写库但打的不是数据库」· ${Object.keys(NOT_A_DB).length} 个(不在护栏判据里,逐条写理由)

${Object.entries(NOT_A_DB).map(([f, why]) => `- \`${f}\` —— ${why}`).join('\n')}

## A 类 · ${A.length} 个

${table(A)}

## B 类 · ${B.length} 个

${table(B)}

## 第三列 · 「包了事务必须验回滚」

含事务的 **${withTxn.length}** 处,逐个由 \`test-txn-rollback\` 守:
静态查 BEGIN / COMMIT / ROLLBACK 三件;行为层在**沙箱库的临时副本**上造中间步失败,验第一步零行落地,
再跑真路径验两步都落地(反向守 —— 一把「怎么跑都零行」的刀证明不了回滚)。

${table(withTxn)}
`
}

/* 直接 `node tools/guard-scan.mjs` 跑它会静默 exit 0 —— 这是本文件里的**假绿面**:
   人以为跑了一次全扫「什么都没报」,其实它是纯库、根本没有 main。归族「静默失败器」。
   所以给它一个显式出口:自己被当命令跑时,报清楚「刀不在我这儿」并指到真正的三把刀。 */
if (import.meta.url === `file://${process.argv[1]}`) {
  console.error('guard-scan.mjs 是**共用尺子(库)**,本身不判定任何东西,跑它不等于扫过了。')
  console.error('真正的刀在这三处,请跑它们:')
  console.error('  node apps/api/test-db-target-guard.mjs   # 守「清单 ≡ 当前提交现扫」')
  console.error('  node apps/api/test-txn-rollback.mjs      # 逐个验事务回滚')
  console.error('  node tools/gen-guard-checklist.mjs       # 重新生成清单')
  process.exit(2)
}
