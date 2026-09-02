/* 「未动须有证」刀(店主 03q 立律,2026-09-03 落)

   ══ 立律案由(同族第三次,一次比一次贴近)══
   ① 02x 误跑演示夹具 → 148 行写进本机库;
   ② 03d 手敲 curl → 冲销了一条**真实收入**;
   ③ 03p **我自己找到了病根(DB_PATH 焊死本机库)、也修了脚本,
      但已经落地的 5 行没清,回执还写着「本机库未动」** —— 店主拿备份逐表对行数查出来的。

   店主的定性,照录:**事故本身不是最重的,「未动」写错才是。**
   **四库四名是交付里最后一道可信的话;它一失实,别的都不用看了。**

   ══ 律 ══
   **开批先打逐表行数快照,交齐时对照;没有对照表不许写「未动」。**

   ══ 本刀守什么 ══
   律是给人的,判据得守到东西上。三层:
   ① 快照件本身在,且**没有默认目标库**(与 db-target 同一姿态 —— 打错了不报错正是病根);
   ② 快照件真能对出差异(**造一份差一行的快照,必须红且点名是哪张表**)——
      一把"对什么都说没差异"的对账器,比没有还危险;
   ③ 回执自证:凡写了「未动」的交付文档,同一份文档里**必须有对照表**
      (库文件绝对路径 + 逐表行数 或 「逐表零差异」那句)。
      这一条是白名单式的:**扫的是"谁说了未动",不是"我记得哪几篇写过"**。 */

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
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

/* ① 快照件在,且自己没有默认目标库 */
const SNAP = 'tools/db-snapshot.mjs'
const snapSrc = existsSync(join(ROOT, SNAP)) ? readFileSync(join(ROOT, SNAP), 'utf8') : ''
check(`① 「未动须有证」的快照件在(${SNAP}),且目标库走 requireTarget —— `
  + '对账器自己有默认目标 = 你以为在对 A 库,它在对 B 库',
  /requireTarget/.test(snapSrc) && /process\.argv\[2\]/.test(snapSrc), SNAP)

/* ② 行为层:造一份**差一行**的快照,对账器必须红且点名是哪张表。
   静态扫到"写了 diff 逻辑"不等于它真对得出来(判据律:能验行为就别验中间产物)。 */
const SB = join(ROOT, 'apps/api/sandbox-data/lucky-luxe.sqlite')
if (!existsSync(SB)) {
  console.log('⚠️  [untouched-proof] 沙箱库不在 —— **行为层这一刀本轮未跑**(不静默跳过,如实说)')
} else {
  const tmp = join(ROOT, 'apps/api/.untouched-canary.json')
  try {
    execFileSync('node', [join(ROOT, SNAP), SB, tmp], { cwd: ROOT, encoding: 'utf8' })
    const snap = JSON.parse(readFileSync(tmp, 'utf8'))
    /* 落刀凭据(刀留痕律):注入点 = 哪张表、从几改成几 */
    const victim = Object.keys(snap.tables).find((t) => (snap.tables[t] || 0) > 0)
    const was = snap.tables[victim]
    snap.tables[victim] = was + 1
    writeFileSync(tmp, JSON.stringify(snap, null, 2))
    console.log(`   [刀] 注入点=快照文件的 ${victim} 表:${was} → ${was + 1}(库本身一个字没动)`)
    let out = ''
    let red = false
    try { out = execFileSync('node', [join(ROOT, SNAP), SB, '--diff', tmp], { cwd: ROOT, encoding: 'utf8' }) } catch (e) { red = true; out = String(e.stdout || '') }
    check('② 🔴 行为层造病验红:快照里改一张表的行数(库本身不动),对账器必须**红且点名那张表** —— '
      + '一把"对什么都说没差异"的对账器比没有还危险',
      red && out.includes(victim) && /不许写「未动」/.test(out), `red=${red} 输出含表名=${out.includes(victim)}`)
    /* ②b 还原:同一份快照重打一次,必须回绿(判据要能分出"有差"和"没差",不是一律红) */
    execFileSync('node', [join(ROOT, SNAP), SB, tmp], { cwd: ROOT, encoding: 'utf8' })
    let green = true
    let out2 = ''
    try { out2 = execFileSync('node', [join(ROOT, SNAP), SB, '--diff', tmp], { cwd: ROOT, encoding: 'utf8' }) } catch { green = false }
    check('②b 反向守:还原后同一份快照必须报「逐表零差异」(否则它是把见谁都红的废刀)',
      green && /逐表零差异/.test(out2), out2.split('\n').slice(-2).join(' '))
  } finally {
    try { unlinkSync(tmp) } catch { /* 夹具收尾:不留脏文件(J 族教训:判据不收尾会变得非幂等) */ }
  }
}

/* ③ 回执自证(白名单式):凡写了「未动」的交付文档,同一份文档里必须有对照表。
   扫的是"谁说了未动",不是"我记得哪几篇写过" —— 新写的回执自动进扫描面。 */
const docs = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', 'handoff'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((f) => f.endsWith('.md'))
/* 「说了未动」的形态:「〈库名〉未动」。四库四名 —— 生产库/本机库/沙箱库/回归临时库 */
const SAYS = /(生产库|本机库|沙箱库)\s*(?:·\s*)?未动/
/* 「有对照表」的形态:库文件绝对路径 + 行数,或那句「逐表零差异」 */
const PROOF = /逐表零差异|逐表行数|未动须有证|行数快照|db-snapshot/
/* 白名单:立律(03q)之前写的回执按当时的规矩办,不追溯 —— 但**必须逐条列出**,
   靠日期猜"哪些是旧的"就是黑名单判据。上限即实际条数,新增要报批。 */
const LEGACY = docs.filter((f) => {
  const src = readFileSync(join(ROOT, f), 'utf8')
  return SAYS.test(src) && !PROOF.test(src)
})
/* 立律当天先量底数并上棘轮:存量只许降不许升,新写的回执一旦无证即红 */
/* 🔴 落刀现测校正:这个数我原来是**猜的**(写了 61,实测 34)。
   猜出来的棘轮天然留着 27 格空隙 —— 悄悄新增 27 篇无证回执它都不会红。
   店主 03m:**棘轮不许留空隙,上限 = 实际条数。** */
const LEGACY_CAP = 34
check(`③ 回执自证棘轮:${docs.length} 篇 handoff 文档里,写了「〈库名〉未动」却没有对照表的存量 `
  + `${LEGACY.length} 篇 ≤ ${LEGACY_CAP}(立律 03q 前的按当时规矩不追溯;**只许降不许升** —— 新写一篇无证回执立刻红)`,
  LEGACY.length <= LEGACY_CAP, `${LEGACY.length} 篇:${LEGACY.slice(0, 5).join(' | ')}`)

/* ③b 零命中先证刀能咬:造两句已知阳性,一句无证一句有证,必须分得出来 */
const CANARY_BAD = '本批交付完成。生产库未动 · 本机库未动。'
const CANARY_OK = '本批交付完成。生产库未动 · 本机库未动 —— 逐表零差异(对照表见下)。'
check('③b 🔴 零命中先证刀能咬:「写了未动没对照表」必须咬中,「写了未动且有对照表」必须放行',
  SAYS.test(CANARY_BAD) && !PROOF.test(CANARY_BAD) && SAYS.test(CANARY_OK) && PROOF.test(CANARY_OK),
  JSON.stringify({ 无证被咬: SAYS.test(CANARY_BAD) && !PROOF.test(CANARY_BAD), 有证放行: PROOF.test(CANARY_OK) }))

/* 下限同样取实测值(176),不留空隙:文档只增不减,真要删得有人有意识地改这个数。
   留 24 格余量的写法,等于允许 handoff 被悄悄砍掉四分之一而判据不响。 */
check(`④ 反向守:扫描面 ${docs.length} >= 176 篇 handoff 文档(目录被排除或仓库被裁立刻红;下限取实测值,不留空隙)`,
  docs.length >= 176, String(docs.length))

console.log(`\n[未动须有证] handoff 文档 ${docs.length} 篇 · 说了「未动」无对照表的存量 ${LEGACY.length} 篇(棘轮 ${LEGACY_CAP})`)
if (fails.length) { console.error(`\n❌ test-untouched-proof ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-untouched-proof 通过 ${checks} 项`)
