#!/usr/bin/env node
/* J-60 第二款 · 「没有任何夹具走过的产品路径」要单独出一个数(店主 07n §一,2026-09-14)
 *
 * 立这条的由来是 D191:
 *   > **走正门不只是为了让状态真实 —— 走正门本身,就是对那条路的第一次真实检验。**
 *   > **一条从来没有夹具走过的路,等于从来没被走过。**
 * D191 躺得住,是因为**从来没有一个夹具走过「老顾客扫码」这条路**。
 *
 * 本刀只出表,**不补任何夹具**(店主 07n §一:先出表不许边扫边补)。
 * 范围按令限定在**顾客端**(小程序顾客端 + 网页顾客端)—— 那是顾客自己按的。
 *
 * 三个数:**顾客能走的路总数 / 有夹具走过的 / 一次都没走过的**。
 * 最后那一列,就是下一个 D191 的候选名单。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probe } from './scanner-probe.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
/* J-61②:刀默认排除判据自身与夹具,具名 */
const SELF = ['tools/customer-paths-scan.mjs']

const walk = (rel, out = []) => {
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = `${rel}/${e.name}`
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/* ── 顾客端的源码面 ── */
const CUSTOMER_FILES = [
  ...walk('miniprogram').filter((f) => /\.js$/.test(f) && !/\/merchant\/|\/staff\/|\/sandbox-/.test(f)),
  ...walk('apps/web').filter((f) => /^apps\/web\/(customer|sign)[\w-]*\.(js|html)$/.test(f)),
].filter((f) => !SELF.includes(f))

/* 顾客真调的后端口:从顾客端源码里把路径抠出来 */
const paths = new Map()
for (const f of CUSTOMER_FILES) {
  const src = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const m of src.matchAll(/(?:request|apiFetch|fetch)\(\s*[`'"]([^`'"]*\/[^`'"]*)[`'"]/g)) {
    /* 🔴 09-14(夜12 段D)· probe 第一次跑就咬到的真缺陷:
       `fetch(`${BASE}/bookings`)` 这种**前缀是 base URL 变量**的调用,原来整类漏掉 ——
       先把 `${...}` 换成 `:x` 之后,串变成 `:x/bookings`,`startsWith('/')` 就把它筛掉了。
       **于是「顾客能走的路」那个数是偏少的,而它长得跟一个完整的数一模一样。**
       改法:**开头那个 `${...}` 当成 base,直接去掉**;路径中间的 `${...}` 仍然换成 `:x`。 */
    let p = m[1].replace(/^\$\{[^}]*\}/, '').replace(/\$\{[^}]*\}/g, ':x').replace(/\?.*$/, '').replace(/\/+$/, '')
    if (!p.startsWith('/')) continue
    if (/^\/(assets|static)\//.test(p)) continue
    if (!paths.has(p)) paths.set(p, new Set())
    paths.get(p).add(f)
  }
}

/* ── 夹具面:全仓 test-*.mjs 真调过哪些路径 ── */
const testDir = join(ROOT, 'apps/api')
const testSrc = readdirSync(testDir).filter((b) => /^test-.*\.mjs$/.test(b))
  .map((b) => readFileSync(join(testDir, b), 'utf8')).join('\n').split('\n')
const walked = (p) => {
  const SENT = '\u0001'
  const pat = p.replace(/:x/g, SENT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(SENT).join('[^`\'"]*')
  const re = new RegExp(pat)
  return testSrc.some((l) => re.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
}

const rows = [...paths.entries()].map(([p, files]) => ({ path: p, files: [...files], walked: walked(p) }))
rows.sort((a, b) => Number(a.walked) - Number(b.walked) || a.path.localeCompare(b.path))
const never = rows.filter((r) => !r.walked)

if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)) } else {
  console.log(`# 顾客能走的路 × 有没有夹具走过(J-60 第二款)\n`)
  console.log(`| | 数 |\n|---|---|`)
  console.log(`| 顾客能走的路(去重) | **${rows.length}** |`)
  console.log(`| 有夹具真走过的 | ${rows.length - never.length} |`)
  console.log(`| 🔴 **一次都没走过的** | **${never.length}** |`)
  console.log(`\n> 扫描面:顾客端源码 ${CUSTOMER_FILES.length} 个文件;`
    + `夹具面:\`apps/api/test-*.mjs\` 全量。**只出表,一条夹具都没补。**\n`)
  console.log(`## 🔴 一次都没走过的 —— 下一个 D191 的候选名单\n`)
  console.log(`| 顾客能按的入口(哪个文件) | 它走的后端路径 | 有没有夹具真走过 |\n|---|---|---|`)
  for (const r of never) console.log(`| \`${r.files[0]}\`${r.files.length > 1 ? ` 等 ${r.files.length} 处` : ''} | \`${r.path}\` | 🔴 **没有** |`)
  console.log(`\n## 走过的(${rows.length - never.length} 条)\n`)
  for (const r of rows.filter((x) => x.walked)) console.log(`- \`${r.path}\``)
}


/* J-58⑤ 自守:核心判定是「这一行里有没有顾客真调的后端路径」 */
if (process.argv.includes('--probe')) {
  /* 判定要**和刀正文同一把尺子**(J-39):照抄正文那几步,不另写一份 */
  const hit = (s) => [...String(s).matchAll(/(?:request|apiFetch|fetch)\(\s*[`'"]([^`'"]*\/[^`'"]*)[`'"]/g)]
    .some((m) => {
      const p = m[1].replace(/^\$\{[^}]*\}/, '').replace(/\$\{[^}]*\}/g, ':x').replace(/\?.*$/, '').replace(/\/+$/, '')
      return p.startsWith('/') && !/^\/(assets|static)\//.test(p)
    })
  probe('customer-paths-scan', [
    { 样本: "request('/my/coupons')", 该命中: true },
    { 样本: "await fetch(`${BASE}/bookings`)", 该命中: true },
    { 样本: "request('/assets/images/a.png')", 该命中: false },
    { 样本: "const x = '/my/coupons'", 该命中: false },
  ], hit)
}
