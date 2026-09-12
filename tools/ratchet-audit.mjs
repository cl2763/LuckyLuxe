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

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/* 在册棘轮:文件 + 认这一行的正则 + 产出这个数的**判据是谁**(不一定是同一个文件) */
const RATCHETS = [
  /* ⚠️ 两个巨型文件的棘轮**不在 pre-regression.sh 里写死**:它取 min(上一提交行数, 历史最低),
     历史最低记在 assertion-baseline.json。夜9 段3 之前这两条在册**却一条都量不到**
     —— 老的正则认的是 `-le <数字>` 那种写法,而这里根本不是那么写的,
     `if (!found) continue` 把它们**静默跳过**,表上只剩 8 行看着还挺齐整(静默失败器族)。 */
  { file: 'apps/api/assertion-baseline.json', re: /"apps\/api\/local-server\.mjs":\s*(\d+)/, name: 'local-server.mjs 行数(历史最低)', by: 'tools/pre-regression.sh' },
  { file: 'apps/api/assertion-baseline.json', re: /"apps\/web\/admin\.js":\s*(\d+)/, name: 'admin.js 行数(历史最低)', by: 'tools/pre-regression.sh' },
  { file: 'tools/pre-regression.sh', re: /HARDCOLOR"?\s+-le\s+(\d+)/, name: 'styles.css 写死色', by: 'tools/pre-regression.sh' },
  { file: 'tools/pre-regression.sh', re: /MPCOLOR"?\s+-le\s+(\d+)/, name: '小程序 wxss 写死色', by: 'tools/pre-regression.sh' },
  { file: 'tools/pre-regression.sh', re: /UTCDAY"?\s+-le\s+(\d+)/, name: 'UTC 判天', by: 'tools/pre-regression.sh' },
  { file: 'apps/api/test-color-usage.mjs', re: /const GOLD_CAP0 = (\d+)/, name: '三个旧金(J-40 值扫)', by: 'apps/api/test-color-usage.mjs' },
  { file: 'apps/api/test-color-usage.mjs', re: /const NO_TEXT_CAP = (\d+)/, name: '金底「没有字的色块」丙筐', by: 'apps/api/test-color-usage.mjs' },
  { file: 'apps/api/test-untouched-proof.mjs', re: /const LEGACY_CAP = (\d+)/, name: '「未动」无标记存量', by: 'apps/api/test-untouched-proof.mjs' },
  { file: 'apps/api/test-untouched-proof.mjs', re: /const PROOF_FROZEN_CAP = (\d+)/, name: '「未动」豁免具名清单(J-51)', by: 'apps/api/test-untouched-proof.mjs' },
  { file: 'apps/api/test-file-ratchet.mjs', re: /'apps\/web\/customer\.js':\s*\{\s*cap:\s*(\d+)/, name: 'customer.js 行数', by: 'apps/api/test-file-ratchet.mjs' },
]
/* 在册条数下限(白名单判据的配套):注册表**只许变长**,缩水立刻红 ——
   删一条就等于把那个棘轮从扫描面上抹掉,而表照样打印得整整齐齐。 */
const REGISTRY_MIN = 10

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

/* ══ J-50(店主 07b §二 立)· **棘轮下降也要举证** ══
 * 棘轮涨了会红,这是明的;**降了却一路绿** —— 而降的原因有三种,只有一种是好事:
 *   ① **真修好了**(点名改了哪几处,差额对得上)
 *   ② **扫描面缩了**(判据少看了几个文件 —— 数字变好看,问题还在)
 *   ③ **判据放松了**(门槛调低 —— 同上,而且更隐蔽)
 * 所以:**下降必须带归因,归因要靠标记不靠措辞**(J-49 同族)——
 * 把棘轮调小的那次提交,信息里必须有一行 `棘轮归因:<三选一> …`。
 * 这把刀读 `git blame` 找到「是哪次提交把这个数写成现在这样」,再读那次提交的信息要归因。
 *
 * ⚠️ 立律之前已经降过的那些,**具名冻住**(J-51:豁免要具名),不追溯;清单只许变短。
 */
/* 归因三选一,但**三种的待遇不一样**:
 *   ① 真修好了 —— 唯一算过的一种,且**必须点名**(标记后面得跟一句人话,差额对得上);
 *   ② 扫描面缩了 / ③ 判据放松了 —— **照样红**。这两种是「认罪」不是「免罪」:
 *      数字变好看了而问题还在,正是这条律要抓的东西。写了归因的好处是
 *      **红的时候报得出是哪一种**,而不是留一个不知所以的下降。 */
const ATTR_TAG = /棘轮归因\s*[::]\s*(真修好了|扫描面缩了|判据放松了)\s*([^\n]*)/
const ATTR_OK = '真修好了'
/* 立律(夜9 段3)之前就已经降过、当时还没有这条规矩的:逐条列名冻住 */
const ATTR_FROZEN = new Set([
  'styles.css 写死色@31',        // 34 → 31
  '小程序 wxss 写死色@2356',      // 2443 → 2356
  '三个旧金(J-40 值扫)@183',      // 184 → 183
  'local-server.mjs 行数(历史最低)@17707',  // 17708 → 17707(06a-五:那一批真从巨型文件里搬走了一行)
])
const ATTR_FROZEN_CAP = 4      // 只许变短

const prevValueOf = (file, re, sha) => {
  /* 「上一版是多少」= 这次提交的**父提交**里同一行的值 */
  try {
    const src = git('show', `${sha}^:${file}`)
    const m = src.match(re)
    return m ? (m.slice(1).find(Boolean) || '') : ''
  } catch { return '' }
}
const msgOf = (sha) => { try { return git('log', '-1', '--format=%B', sha) } catch { return '' } }

const rows = []
const missing = []
for (const r of RATCHETS) {
  const found = lineOf(r.file, r.re)
  /* 🔴 在册却量不到 **必须红**:老版这里是 `continue`,两个巨型文件就这么从表上消失了 */
  if (!found) { missing.push(r); continue }
  const num = blameAt(r.file, found.line)
  const judge = lastChange(r.by)
  /* 数字所在那次提交 vs 判据文件最后一次改动:判据更新 = 这个数是旧版判据量的 */
  const stale = num.at !== '(取不到)' && judge.at !== '(取不到)' && new Date(judge.at) > new Date(num.at)
  /* 取父提交里的值:取不到有两种 —— **这个数是新立的**(那次提交刚建的文件),或者 blame 拿不到 */
  const prev = prevValueOf(r.file, r.re, num.sha)
  const born = prev === '' && num.sha !== '(未提交)'
  const delta = (prev !== '' && found.value !== '?') ? Number(found.value) - Number(prev) : null
  const msg = msgOf(num.sha)
  const am = msg.match(ATTR_TAG) || []
  const attr = am[1] || ''
  const attrWhy = (am[2] || '').trim()
  const frozen = ATTR_FROZEN.has(`${r.name}@${found.value}`)
  /* **只对「降了」较真**:涨了本来就会被别的判据拦下,这条专治「悄悄变好看」 */
  const needAttr = delta !== null && delta < 0 && !frozen
  /* ①要点名:只写「棘轮归因:真修好了」而不说修了什么,等于没举证 */
  const thin = needAttr && attr === ATTR_OK && attrWhy.replace(/[\s—·、,,。]/g, '').length < 8
  rows.push({ ...r, ...found, numSha: num.sha, numAt: num.at, judgeSha: judge.sha, judgeAt: judge.at, stale,
    prev, born, delta, attr, attrWhy, frozen,
    missingAttr: needAttr && !attr,
    badDrop: needAttr && !!attr && attr !== ATTR_OK,   // 认了②③ —— 照样红
    thinAttr: thin })
}

console.log('J-43 棘轮对账 —— 「这个数是哪一版判据量的」\n')
const pad = (s, n) => String(s).padEnd(n)
console.log(pad('棘轮', 30) + pad('值', 7) + pad('数字写于', 10) + pad('判据现在', 10) + '要重量?')
for (const r of rows) {
  console.log(pad(r.name, 30) + pad(r.value, 7) + pad(r.numSha, 10) + pad(r.judgeSha, 10)
    + (r.stale ? '🔴 判据比数字新 —— 重量一次' : '✅ 同一版'))
}
const stale = rows.filter((r) => r.stale)
const noAttr = rows.filter((r) => r.missingAttr)
const badDrop = rows.filter((r) => r.badDrop)
const thinAttr = rows.filter((r) => r.thinAttr)
console.log('\n── 本次变化与归因(J-50:降了也要举证)──')
for (const r of rows) {
  const d = r.delta === null ? (r.born ? '新立(无上一版)' : '(上一版取不到)') : (r.delta === 0 ? '未变' : (r.delta > 0 ? `↑ +${r.delta}` : `↓ ${r.delta}`))
  const why = r.frozen ? '(立律前已降,具名冻住)'
    : r.badDrop ? `🔴 **这是「${r.attr}」导致的下降 —— 数字变好看,问题还在**`
    : r.thinAttr ? '🔴 归因写了「真修好了」却没点名(差额对不上)'
    : r.attr ? `归因:${r.attr}${r.attrWhy ? ' —— ' + r.attrWhy.slice(0, 28) : ''}`
    : (r.delta < 0 ? '🔴 **降了却没写归因**' : '')
  console.log(`  ${pad(r.name, 30)}${pad(r.value, 7)}${pad(d, 12)}${why}`)
}
console.log(`\n在册 ${RATCHETS.length} 个 · 量到 ${rows.length} 个 · 需要重量 ${stale.length} 个`
  + ` · **降了没写归因 ${noAttr.length} 个 · 归因为②③(认罪型下降)${badDrop.length} 个 · 归因没点名 ${thinAttr.length} 个**`)
if (badDrop.length) {
  console.error('\n🔴 J-50:下面这些棘轮的下降**不是因为修好了**:')
  for (const r of badDrop) console.error(`   · ${r.name} ${r.prev} → ${r.value}(写于 ${r.numSha})—— 归因自报「${r.attr}」${r.attrWhy ? ':' + r.attrWhy : ''}`)
  console.error('   这两种归因是**认罪不是免罪**:棘轮看着收紧了,被它守的那件事一点没少。')
  process.exitCode = 1
}
if (thinAttr.length) {
  console.error('\n🔴 J-50:归因写了「真修好了」但**没点名**(要说清改了哪几处,差额对得上):')
  for (const r of thinAttr) console.error(`   · ${r.name} ${r.prev} → ${r.value}(写于 ${r.numSha})`)
  process.exitCode = 1
}
if (missing.length) {
  console.error('\n🔴 在册却**量不到**(注册表写着、文件里认不出来 —— 这条棘轮等于没在扫):')
  for (const r of missing) console.error(`   · ${r.name} —— 在 ${r.file} 里没匹配上`)
  process.exitCode = 1
}
if (RATCHETS.length < REGISTRY_MIN) {
  console.error(`\n🔴 注册表缩水:在册 ${RATCHETS.length} < 下限 ${REGISTRY_MIN} —— 删掉一条 = 把那个棘轮抹出扫描面`)
  process.exitCode = 1
}
if (ATTR_FROZEN.size > ATTR_FROZEN_CAP) {
  console.error(`\n🔴 J-51:归因豁免清单 ${ATTR_FROZEN.size} > ${ATTR_FROZEN_CAP} —— 豁免只许变短`)
  process.exitCode = 1
}
if (noAttr.length) {
  console.error('\n🔴 J-50:下面这些棘轮**降了却没有归因** —— 把它调小的那次提交里要写一行')
  console.error('   `棘轮归因:真修好了 / 扫描面缩了 / 判据放松了 …`(三选一,靠标记不靠措辞)')
  for (const r of noAttr) console.error(`   · ${r.name} ${r.prev} → ${r.value}(写于 ${r.numSha})`)
  process.exitCode = 1
}

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
/* 🔴 这一行**曾经是 `process.exit(0)`** —— 段3 加完归因列之后,它把每一个
   `process.exitCode = 1` 都抹平成 0:**红字照印,退出码照绿**。
   造病刀第一轮就是被这个坑住的(「期望 red 实得 green」而屏幕上明明是红的)。
   归族「静默失败器」:判据自己的红也得真红。 */
process.exit(process.exitCode ? 1 : 0)
