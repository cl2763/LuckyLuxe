#!/usr/bin/env node
/* J-43「棘轮初值必须由**已经造病验过红**的那一版判据产出」(店主 06h 裁 #38 立)
 *
 * ══ 律的来历 ══
 * 06g 我给「金底上没有字」那一筐设的棘轮初值是 **3** —— 那是拿一把**坏了的判据**量出来的
 * (模板串里的 `\b` 是退格符不是词边界,整支「写死的金底」静默落在扫描面外)。
 * 刀咬出那个 bug 之后重量:**16**。店主把这件事立成律,原话:
 *   **「判据坏了棘轮跟着坏,而坏成更小的数时看着还像收得更紧。」**
 *
 * ══ 这把刀做什么 ══
 * 它不重量业务数(那得各自跑各自的判据),它做**机械对账**:
 *   对每一个棘轮数字,用 `git blame` 取「**这个数**是哪一次提交写下的」,
 *   再取「**产出它的那份判据文件**最后一次改动是哪一次提交」,
 *   两者一比 —— **判据比数字新 = 这个数是旧版判据量的,该重量**。
 * 输出一张表:数字 / 它是哪一版判据量的 / 判据现在是哪一版 / 要不要重量。
 *
 * 这是「判据的判据」:它守不住「数对不对」,它守的是「**这个数还算不算数**」。
 *
 * 用法:node tools/ratchet-audit.mjs [--md <落盘路径>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' })

/* 在册棘轮:文件 + 认这一行的正则 + 产出这个数的**判据是谁**(不一定是同一个文件) */
const RATCHETS = [
  { file: 'tools/pre-regression.sh', re: /LOCAL_LINES.*-le\s+(\d+)|"\$LOCAL"\s+-le\s+(\d+)/, name: 'local-server.mjs 行数', by: 'tools/pre-regression.sh' },
  { file: 'tools/pre-regression.sh', re: /HARDCOLOR"?\s+-le\s+(\d+)/, name: 'styles.css 写死色', by: 'tools/pre-regression.sh' },
  { file: 'tools/pre-regression.sh', re: /MPCOLOR"?\s+-le\s+(\d+)/, name: '小程序 wxss 写死色', by: 'tools/pre-regression.sh' },
  { file: 'tools/pre-regression.sh', re: /UTCDAY"?\s+-le\s+(\d+)/, name: 'UTC 判天', by: 'tools/pre-regression.sh' },
  { file: 'apps/api/test-color-usage.mjs', re: /const GOLD_CAP0 = (\d+)/, name: '三个旧金(J-40 值扫)', by: 'apps/api/test-color-usage.mjs' },
  { file: 'apps/api/test-color-usage.mjs', re: /const NO_TEXT_CAP = (\d+)/, name: '金底「没有字的色块」丙筐', by: 'apps/api/test-color-usage.mjs' },
  { file: 'apps/api/test-color-usage.mjs', re: /NO_TEXT_OK\.length <= (\d+)/, name: '(已废)旧白名单条数', by: 'apps/api/test-color-usage.mjs' },
]

const lineOf = (file, re) => {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(re)
    if (m) return { line: i + 1, value: (m.slice(1).find(Boolean) || '?'), text: lines[i].trim().slice(0, 70) }
  }
  return null
}
const blameAt = (file, line) => {
  try {
    const out = git('blame', '-L', `${line},${line}`, '--porcelain', '--', file)
    const sha = out.split('\n')[0].split(' ')[0].slice(0, 7)
    const at = (out.match(/^committer-time (\d+)$/m) || [])[1]
    return { sha, at: at ? new Date(Number(at) * 1000).toISOString() : '(取不到)' }
  } catch { return { sha: '(未提交)', at: '(取不到)' } }
}
const lastChange = (file) => {
  try {
    const out = git('log', '-1', '--format=%h %cI', '--', file).trim()
    const [sha, iso] = out.split(' ')
    return { sha, at: iso }
  } catch { return { sha: '(取不到)', at: '(取不到)' } }
}

const rows = []
for (const r of RATCHETS) {
  const found = lineOf(r.file, r.re)
  if (!found) continue
  const num = blameAt(r.file, found.line)
  const judge = lastChange(r.by)
  /* 数字所在那次提交 vs 判据文件最后一次改动:判据更新 = 这个数是旧版判据量的 */
  const stale = num.at !== '(取不到)' && judge.at !== '(取不到)' && new Date(judge.at) > new Date(num.at)
  rows.push({ ...r, ...found, numSha: num.sha, numAt: num.at, judgeSha: judge.sha, judgeAt: judge.at, stale })
}

console.log('J-43 棘轮对账 —— 「这个数是哪一版判据量的」\n')
const pad = (s, n) => String(s).padEnd(n)
console.log(pad('棘轮', 30) + pad('值', 7) + pad('数字写于', 10) + pad('判据现在', 10) + '要重量?')
for (const r of rows) {
  console.log(pad(r.name, 30) + pad(r.value, 7) + pad(r.numSha, 10) + pad(r.judgeSha, 10)
    + (r.stale ? '🔴 判据比数字新 —— 重量一次' : '✅ 同一版'))
}
const stale = rows.filter((r) => r.stale)
console.log(`\n在册 ${rows.length} 个 · 需要重量 ${stale.length} 个`)

const OUT = process.argv.includes('--md') ? process.argv[process.argv.indexOf('--md') + 1] : ''
if (OUT) {
  const lines = ['# J-43 棘轮对账 —— 每个数是哪一版判据量的', '',
    `> 跑于 ${new Date().toISOString()} · 刀 \`tools/ratchet-audit.mjs\``, '',
    '> 判法:`git blame` 取「**这个数**是哪次提交写下的」,`git log` 取「**产出它的判据文件**最后一次改动」。',
    '> **判据比数字新 ⇒ 这个数是旧版判据量的 ⇒ 重量一次**(J-43)。', '',
    '| 棘轮 | 值 | 在哪 | 数字写于 | 判据现在 | 结论 |', '|---|---|---|---|---|---|']
  for (const r of rows) {
    lines.push(`| ${r.name} | **${r.value}** | \`${r.file}:${r.line}\` | \`${r.numSha}\` | \`${r.judgeSha}\` | ${r.stale ? '🔴 重量' : '✅ 同一版'} |`)
  }
  mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log(`[表] → ${OUT}`)
}
process.exit(0)
