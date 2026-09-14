#!/usr/bin/env node
/* J-63 · 开批快照的每一个数必须**现测**,不许抄上一批回执(店主 07m §三,2026-09-14)
 *
 * ══ 案由 ══
 * 夜11 的开批快照我是**抄的**,抄错了两个数:
 *   · 「主档 116/116」—— 现测那一刻是 **117**;
 *   · 「local-server.mjs 17,707」—— 这个倒是对的,但我在早报里又把它写成 17,701(段A 之后的数)。
 * 店主拿它去核账,于是「302 + 5 ≠ 305」那本账也跟着糊了。
 * **开批快照是后面所有对账的地基,地基是抄来的,上面盖什么都不算数。**
 *
 * ══ 治法:快照记下 HEAD 的 sha,对账时**回到那个 sha 重新量一遍** ══
 * 抄来的数在「回到那一刻重新量」面前**必然露馅** —— 这就是判据律要的那种判据:
 * 缺陷存在时它不会照样绿。
 *
 *   打快照:node tools/batch-snapshot.mjs <输出.json>
 *   对  账:node tools/batch-snapshot.mjs --check <快照.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 }).trim()
/* 巨型文件直接 `git show` 会 ENOBUFS(现踩:local-server.mjs 90 万字符)——
   数行数不需要把文件读进内存,交给 `wc -l` 就好。 */
const linesAt = (sha, path) => Number(execSync(`git show ${sha}:${path} | wc -l`, { cwd: ROOT, encoding: 'utf8' }).trim())
/* ⚠️ 这里**一开始我写了 `+ 1`**,量出来比棘轮大 1。`wc -l` 数的就是行数(文件以换行收尾时),
   仓里所有棘轮用的也都是 `wc -l < file`。**同一件事要用同一把尺子量**(J-39)——
   而这一刀正好是 J-63 第三问「单位对不对」当场咬我一口,留着当案底。 */

/* 每一项都写明**怎么量的**(J-63 第 2 条:每个数后面带一句「怎么来的」) */
const METRICS = {
  '领先 origin/main': { how: 'git rev-list --count origin/main..<sha>', at: (sha) => Number(git('rev-list', '--count', `origin/main..${sha}`)) },
  '主档套件数': { how: 'run-all-tests.sh 的 DEFAULT_SUITES 词数 + 固定 4 套', at: (sha) => {
    const s = git('show', `${sha}:apps/api/run-all-tests.sh`)
    const m = s.match(/DEFAULT_SUITES="([^"]*)"/)
    return (m ? m[1].trim().split(/\s+/).filter(Boolean).length : 0) + 4
  } },
  '门关档套件数': { how: 'run-all-tests.sh 的 DEMO_GATE_SUITES 词数', at: (sha) => {
    const m = git('show', `${sha}:apps/api/run-all-tests.sh`).match(/DEMO_GATE_SUITES="([^"]*)"/)
    return m ? m[1].trim().split(/\s+/).filter(Boolean).length : 0
  } },
  '断言在册合计': { how: 'assertion-baseline.json 的 suites 各值求和', at: (sha) => {
    const j = JSON.parse(git('show', `${sha}:apps/api/assertion-baseline.json`))
    return Object.values(j.suites || {}).reduce((a, b) => a + b, 0)
  } },
  'local-server.mjs 行数': { how: 'git show <sha>:文件 | 数行', at: (sha) => linesAt(sha, 'apps/api/local-server.mjs') },
  'admin.js 行数': { how: '同上', at: (sha) => linesAt(sha, 'apps/web/admin.js') },
  'customer.js 行数': { how: '同上', at: (sha) => linesAt(sha, 'apps/web/customer.js') },
}

const args = process.argv.slice(2)
const checkAt = args.indexOf('--check')

if (checkAt < 0) {
  const out = args[0] || 'handoff/night-runs/开批快照.json'
  const sha = git('rev-parse', 'HEAD')
  const snap = { sha, short: sha.slice(0, 7), 打于: new Date().toISOString(), 数: {} }
  for (const [k, v] of Object.entries(METRICS)) snap.数[k] = { 值: v.at(sha), 怎么来的: v.how }
  writeFileSync(join(ROOT, out), `${JSON.stringify(snap, null, 2)}\n`)
  console.log(`✅ 开批快照(**现测**,不是抄的)→ ${out}\n   HEAD ${snap.short}`)
  for (const [k, v] of Object.entries(snap.数)) console.log(`   ${k.padEnd(22)} ${String(v.值).padStart(7)}   ← ${v.怎么来的}`)
} else {
  const f = args[checkAt + 1]
  if (!f) { console.error('用法:node tools/batch-snapshot.mjs --check <快照.json>'); process.exitCode = 2 }
  else {
    const snap = JSON.parse(readFileSync(join(ROOT, f), 'utf8'))
    console.log(`════ J-63 开批快照对账 ════\n  快照 ${f}\n  它声称是在 \`${snap.short}\` 那一刻量的 —— **回到那个 sha 重新量一遍**\n`)
    let bad = 0
    for (const [k, v] of Object.entries(METRICS)) {
      const said = snap.数?.[k]?.值
      if (said === undefined) { console.log(`  ⚠️ ${k}:快照里没有这一项`); continue }
      const now = v.at(snap.sha)
      if (now === said) console.log(`  ✅ ${k.padEnd(22)} ${String(said).padStart(7)}`)
      else { console.log(`  🔴 ${k.padEnd(22)} 快照写 ${said},回到 ${snap.short} 现测是 ${now} —— **这个数是抄来的,不是量的**`); bad += 1 }
    }
    if (bad) { console.log(`\n🔴 ${bad} 个数对不上 —— J-63 第一问:它是量出来的,还是抄来的?`); process.exitCode = 1 }
    else console.log('\n✅ 每个数回到那一刻都量得出来')
  }
}
