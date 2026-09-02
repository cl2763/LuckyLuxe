#!/usr/bin/env node
/* 写库脚本护栏 · 三列清单**生成器**(店主 03z §一 裁,2026-09-03)

   ══ 为什么改成生成 ══
   手写的那份停在 09-02:第二列 10 处还写着 ⬜,而 D124 早就把护栏接上了;
   第三列九处也已逐个验过回滚 —— **清单没跟着动**。

   店主的话:**「清单是人写的,刀是机器咬的,以刀为准。」**
   而且这一批的正面案例就摆在那儿 —— 清单写着「包了事务」的九处里,
   `ledger-guards` 现测**根本没有事务**。人写的清单会过期、会记错;刀不会。

   所以这份文件从此**由两把刀的现测输出生成**:
   · `test-db-target-guard` —— 扫描面 / A-B 分类 / 去默认目标 / 自报护栏 / 解析点;
   · `test-txn-rollback`    —— 第三列「包了事务必须验回滚」的九处。

   ══ 用法 ══
     node tools/gen-guard-checklist.mjs            # 打印到 stdout(默认只读,不写文件)
     node tools/gen-guard-checklist.mjs --write    # 重写 handoff/写库脚本护栏三列清单.md
   **默认不写文件**(与造景脚本同一姿态:要落盘就显式说)。 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'handoff', '写库脚本护栏三列清单.md')
const WRITE = process.argv.includes('--write')

/* ── 底数与分类:与 test-db-target-guard 同一把尺(同样的正则、同样的扫描面)── */
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)
const CAND = tracked.filter((f) => /^(tools|apps\/api)\/.*\.(mjs|sh)$/.test(f)
  && !/\/(test-|run-)/.test(f) && !f.endsWith('test-db-target-guard.mjs'))

const WRITES = /DatabaseSync|\.prepare\([^)]*\)\s*\.run\(|db\.exec\(|method:\s*['"](POST|PUT|PATCH|DELETE)['"]/
/* 剥注释:**必须保住行号**(店主 03x 收编;`\s` 含换行会把空行连同换行一起吃掉) */
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*(\/\/|#).*$/gm, '')

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
const importedByAny = new Set()
for (const f of tracked.filter((x) => /\.(mjs|js)$/.test(x))) for (const d of importsOf(f)) importedByAny.add(d)
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
  })
}
const A = rows.filter((r) => r.类 === 'A')
const B = rows.filter((r) => r.类 === 'B')
const withTxn = rows.filter((r) => r.事务.startsWith('✔'))
const noGuardA = A.filter((r) => r.护栏 === '—')

const stamp = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const table = (list) => ['| 脚本 | 形态 | 护栏(去默认目标 + 自报) | 事务 |', '|---|---|---|---|']
  .concat(list.map((r) => `| \`${r.f}\` | ${r.形态} | ${r.护栏} | ${r.事务} |`)).join('\n')

const md = `# 写库脚本护栏 · 三列清单(**本文件由刀生成,不要手改**)

> 生成器:\`tools/gen-guard-checklist.mjs\` · 依据:\`test-db-target-guard\` + \`test-txn-rollback\` 同一把尺
> 生成于提交 \`${stamp}\`
>
> **为什么不手写**(店主 03z §一 裁):手写那份停在 09-02 —— 第二列 10 处还写着 ⬜ 而护栏早已接上,
> 第三列九处也已验过回滚,清单没跟着动。更要紧的是:清单写着「包了事务」的九处里,
> \`ledger-guards\` 现测**根本没有事务**。**清单是人写的,刀是机器咬的,以刀为准。**

## 尺子(与刀同一把)

\`\`\`
扫描面   git ls-files 递归全量的 tools/**.mjs|sh + apps/api/**.mjs|sh(排除 test-* / run-*)
写库定义 直连 sqlite 写(DatabaseSync / .prepare().run / db.exec)或走 HTTP 打写口(POST|PUT|PATCH|DELETE)
分类     A 独立可跑脚本 = 护栏的对象;B 被 local-server 可达或被任何 tracked 文件 import = 服务统一自报
剥注释   保住行号(\`\\s\` 含换行会吃掉空行,行号一错全错 —— 店主 03x 收编)
\`\`\`

## 现测底数

| | 数 |
|---|---|
| 候选文件 | ${CAND.length} |
| 会写库 | ${rows.length}(A 类 ${A.length} · B 类 ${B.length}) |
| A 类未接护栏 | **${noGuardA.length}**${noGuardA.length ? `(${noGuardA.map((r) => `\`${r.f}\``).join(' · ')})` : ' — 全部接上' } |
| 含事务 | ${withTxn.length} |

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

if (WRITE) {
  writeFileSync(OUT, md)
  console.log(`已重写 ${OUT}`)
  console.log(`  候选 ${CAND.length} · 会写库 ${rows.length}(A ${A.length} / B ${B.length})· A 类未接护栏 ${noGuardA.length} · 含事务 ${withTxn.length}`)
} else {
  console.log(md)
  console.error(`\n(默认只打印不落盘;要重写文件加 --write。目标:${existsSync(OUT) ? '已存在,会覆盖' : '新建'})`)
}
