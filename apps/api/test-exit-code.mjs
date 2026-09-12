#!/usr/bin/env node
/* 「**打印过红字的进程,退出码不许是 0**」(店主 07c 裁 #55 立,2026-09-12)
 *
 * ══ 案由 ══
 * 夜9 段3 给 `tools/ratchet-audit.mjs` 加归因列之后,造病四刀全报「期望 red 实得 green」,
 * 而屏幕上**明明列着红名单**。查到末尾那一行:
 *     process.exit(0)
 * 它把每一个 `process.exitCode = 1` 都抹平成 0 —— **红字照印,退出码照绿**。
 * 段3 之前那把刀没有任何红,所以这行一直无害;**一加红就变成致命的**。
 *
 * 店主 07c 裁 #55:这不是孤例,要**同族普查**。现扫全仓 26 个含 `process.exit(0)` 的文件,
 * 其中 22 个同时会打印红字。逐个读过之后分三类:
 *   ① **真坏**(判完红了还 exit 0)—— `ratchet-audit` 那一个,**已修**(夜9 `1fa5bd6`);现存 **0** 个。
 *   ② **正常收摊**:前一行就是 `if (fails.length) { …; process.exit(1) }`,
 *      走到 exit(0) 说明确实没红(J-33 收摊)。造病刀在 KNIFE 模式下「红」本身就是成功,同归此类。
 *   ③ **早退分支**:还没做判定就先退(基线首次播种、没给判据阈值的「只报数」模式)。
 *
 * ══ 这把刀守什么 ══
 * 不是守「现在这 22 个对不对」(那是一次性的人读),而是守**以后**:
 * **凡「判人的刀」里的 `process.exit(0)`,要么前面紧挨着一条非零出口,要么具名豁免并写明属于②还是③。**
 * 新写一个裸的 exit(0) 自动红 —— 白名单式(判据三),不靠列举被测对象。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* 扫描面:**会做判定的**那些文件 —— 测试套件 + tools 下的刀。
   条数下限跟着走(判据三推论:判据的覆盖面本身要有判据)。 */
const judgeFiles = () => {
  const out = []
  /* 🔴 排除自己:本文件的 canary 数组里就写着 `process.exit(0)` 那一行字面量,
     不排掉就会扫到自己(这一批第 N 次踩「判据扫到自己的注释/夹具」)。 */
  const SELF = 'test-exit-code.mjs'
  for (const b of readdirSync(join(ROOT, 'apps/api'))) if (/^test-.*\.mjs$/.test(b) && b !== SELF) out.push(`apps/api/${b}`)
  for (const b of readdirSync(join(ROOT, 'tools'))) if (b.endsWith('.mjs')) out.push(`tools/${b}`)
  return out.sort()
}

/* 一处 exit(0) 算「有守」的条件:**它上面 8 行之内**出现过一条非零出口
   (`process.exit(1)` / `process.exit(非0)` / `exitCode = 1` / `exit(x ? 1 : 0)` 这种三元)。
   取 8 行是因为收摊惯例就是「判一句、红则退 1、否则打印通过、退 0」,中间最多隔几行打印。 */
/* 🔴 这里**只认 `process.exit(非0)`,不认 `exitCode = 1`** —— 头一版把后者也当成「有守」,
   结果自守用例当场红了,而**它红得对**:`process.exitCode = 1` 后面跟一个裸 `process.exit(0)`,
   正是 `ratchet-audit` 那个病本身 —— exit(0) 会把 exitCode **抹掉**。
   「设了 exitCode」不是保护,「真的退非零」才是。 */
const NONZERO = /process\.exit\((?!0\s*\))/
/* ③早退分支**按机制认,不按行号列**(波及面回归律②:类按机制定义不按长相)——
   行号会随着上面加一行注释就漂掉,列 20 个行号的豁免名单第二天就全失效。
   早退分支的机制特征是:**它自己会说「这一轮没判」** ——
   「未跑 / skip / 预演 / 试跑 / 只报数 / 没写库 / 零差异」这一类话就印在那几行里。
   认这个,比认行号稳,也比认行号诚实:**说了自己没判,才算早退**。 */
const EARLY_OUT = /未跑|未做判定|不做判定|skip|预演|试跑|没写库|一个字没写|只报数|不判红|零差异|没有差异|演练结束/
const scanBareExit0 = (lines, file = '') => {
  const code = lines.map((ln) => (/^\s*(\/\/|\*|\/\*)/.test(ln) ? '' : ln))
  const bare = []
  code.forEach((ln, i) => {
    if (!/process\.exit\(0\s*\)/.test(ln)) return
    const near = code.slice(Math.max(0, i - 14), i + 1).join('\n')
    if (NONZERO.test(near)) return          // ②正常收摊:前面紧挨着一条非零出口
    if (EARLY_OUT.test(near)) return        // ③早退分支:它自己说了这一轮没判
    bare.push({ file, line: i + 1, text: lines[i].trim().slice(0, 80) })
  })
  return bare
}

/* 具名豁免:key = `文件:行号`,value = 必须写明属于 ② 还是 ③ 并给理由。**只许变短。** */
const EXIT0_ALLOW = {
  'apps/api/test-auth-surface.mjs': '②正常收摊:这支的 `check()` 是**抛异常**的,'
    + '一处失败直接进 `main().catch` → `process.exit(1)`;走到末尾说明全过。'
    + '(注:这也是为什么 J-53 那一块被挪到了前面 —— 后面的失败会让它整块不跑)',
  'tools/tenant-fingerprint.mjs': '③早退分支:这把刀只**写指纹快照**,不做判定;'
    + '要比对是调用方拿两份快照去 diff(夜9 用法即如此)',
  'tools/db-snapshot.mjs': '③早退分支:不带第二个参数时它只**打印一份库快照**,不做任何判定;'
    + '真正判红那条路在 :111 往下(两份快照 diff,有差异时 exit 1)',
  'tools/drop-tenant-default.mjs': '②正常收摊:那一行打印的是「✅ 零张 —— 幂等重跑就是这个结果(库一分不动)」,'
    + '**这是判定成功本身**,不是没判',
}
const EXIT0_CAP = 4   /* 只许变短 */

const files = judgeFiles()
const bare = files.flatMap((f) => scanBareExit0(readFileSync(join(ROOT, f), 'utf8').split('\n'), f))
/* 豁免**按文件**给,不按行号 —— 行号上面加一行注释就漂掉了(同 EARLY_OUT 那条理由)。
   代价是同一文件里第二个裸 exit(0) 也会被这一条盖住;所以配一条「每个豁免文件现测裸 exit(0) 条数」的上限。 */
const bareBad = bare.filter((b) => !EXIT0_ALLOW[b.file])
const perFile = {}
for (const b of bare) perFile[b.file] = (perFile[b.file] || 0) + 1
const EXIT0_PER_FILE_CAP = { 'apps/api/test-auth-surface.mjs': 1, 'tools/tenant-fingerprint.mjs': 1, 'tools/db-snapshot.mjs': 1, 'tools/drop-tenant-default.mjs': 1 }
const overPerFile = Object.entries(perFile).filter(([f, n]) => EXIT0_ALLOW[f] && n > (EXIT0_PER_FILE_CAP[f] || 0))
const zombies = Object.keys(EXIT0_ALLOW).filter((f) => !perFile[f])

check(`① 白名单式:${files.length} 把「判人的刀」现扫,裸 \`process.exit(0)\`(上面 8 行内没有非零出口)`
  + `${bare.length} 处**逐个落进具名豁免**;新写一个自动红`,
bareBad.length === 0, bareBad.map((b) => `${b.file}:${b.line}`).join(' | '))

check(`② 豁免只许变短:${Object.keys(EXIT0_ALLOW).length} 条 <= 上限 ${EXIT0_CAP},且每条都写明属于②还是③`,
  Object.keys(EXIT0_ALLOW).length <= EXIT0_CAP
  && Object.values(EXIT0_ALLOW).every((v) => /[②③]/.test(v) && String(v).length > 20),
  `${Object.keys(EXIT0_ALLOW).length} 条`)
check('②b 豁免**零僵尸条目**:名单里的文件都还真有一处裸 exit(0)(文件改了名或那处被修掉,条目要跟着删)',
  zombies.length === 0, zombies.join(' | '))
check('②c 豁免是**按文件**给的,所以配条数上限:每个豁免文件现测裸 exit(0) 不许多于备案条数'
  + '(同一文件里新长出第二个就红)', overPerFile.length === 0, JSON.stringify(overPerFile))

/* ③ 自守:**用 ratchet-audit 修复前的原样**当已知阳性 —— 咬不到它,这把刀就是废的 */
const canary = scanBareExit0([
  'if (noAttr.length) {',
  "  console.error('🔴 降了却没写归因')",
  '  process.exitCode = 1',
  '}',
  'const OUT = argv.includes("--md") ? argv[i + 1] : ""',
  'if (OUT) { writeFileSync(OUT, lines.join("\\n")); console.log("[表] → " + OUT) }',
  'const a = 1', 'const b = 2', 'const c = 3', 'const d = 4', 'const e = 5',
  'process.exit(0)',
], 'canary.mjs')
check('③ 自守:拿 `ratchet-audit` **修复前的原样**(红字在前、9 行之后一个裸 exit(0))当已知阳性,'
  + '必须被咬到 —— 这正是夜9 那次「红字照印,退出码照绿」',
canary.length === 1, JSON.stringify(canary))

/* ④ 反向守:**正常收摊**的写法不许被咬(否则豁免名单会被误报塞爆,真的那条就埋没了) */
const neg = scanBareExit0([
  'if (fails.length) { console.error(`❌ ${fails.length} 项未过`); process.exit(1) }',
  'console.log(`✅ 通过 ${checks} 项`)',
  'process.exit(0)',
], 'neg.mjs')
check('④ 反向守:`if (fails.length) {…exit(1)}` 紧接着的 exit(0) 是**正常收摊**,不许被咬(J-33)',
  neg.length === 0, JSON.stringify(neg))

/* ⑤ 反向守:扫描面不许缩水 —— 文件搬走/改名时立刻红(判据三推论) */
check(`⑤ 反向守:扫描面 ${files.length} >= 150 把刀(目录被排除或文件大批消失时立刻红)`,
  files.length >= 150, `实扫 ${files.length}`)

/* ⑥ 现修自证:`ratchet-audit` 那一处**确实已经改成按 exitCode 退** */
const ra = readFileSync(join(ROOT, 'tools/ratchet-audit.mjs'), 'utf8')
check('⑥ 现修自证:`tools/ratchet-audit.mjs` 末尾已是 `process.exit(process.exitCode ? 1 : 0)`,'
  + '不是裸的 `process.exit(0)`(夜9 `1fa5bd6` 修的那一处)',
/process\.exit\(process\.exitCode \? 1 : 0\)/.test(ra) && !/\n\s*process\.exit\(0\)\s*$/.test(ra), '')

console.log(`\n[退出码守则] 扫 ${files.length} 把刀 · 裸 exit(0) ${bare.length} 处(全部具名)· 豁免 ${Object.keys(EXIT0_ALLOW).length}/${EXIT0_CAP}`)
if (fails.length) { console.error(`\n❌ test-exit-code ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-exit-code 通过 ${checks} 项`)
