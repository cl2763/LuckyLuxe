#!/usr/bin/env node
/* 外部件预检(店主 07c 裁 #56,2026-09-12)· **逐条现查,缺了报缺哪一个**
 *
 * 立这条的由来是同族第三次:沙箱库放 /private/tmp 被清掉 · `miniprogram-automator`
 * 不在这台机器上了而路径没记在仓里 · 本条。
 * **装在仓外的东西,路径必须记在仓里**,而且要有人在开跑之前替你看一眼。
 *
 * ⚠️ 这把刀**读 `handoff/外部件清单.md` 那张表**,不另抄一份清单(一件事一处真相)。
 * 表里加一行,预检自动跟着查;表被删短,`--strict` 下当场红。
 *
 * 用法:node tools/ext-deps-check.mjs [--strict]
 *   不带 --strict:只报状况,退出码 0(给日常用)
 *   带 --strict :**必需项缺一个就退 1**(给全量回归前用)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const LIST = join(ROOT, 'handoff/外部件清单.md')
const STRICT = process.argv.includes('--strict')
const MIN_ROWS = 5      /* 清单条数下限:只许变长(判据三推论:覆盖面本身要有判据) */

if (!existsSync(LIST)) {
  console.error('🔴 找不到 handoff/外部件清单.md —— 预检读的就是它,没有它这一步等于没做')
  process.exit(1)
}
/* 解析表格:| # | 名字 | 干什么 | 怎么指 | 缺了会怎样 | 必需? | */
const rows = readFileSync(LIST, 'utf8').split('\n')
  .filter((ln) => /^\|\s*\d+\s*\|/.test(ln))
  .map((ln) => ln.split('|').map((c) => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1))
  .map(([no, name, use, how, miss, need]) => ({ no, name: name.replace(/\*/g, ''), use, how, miss, need }))

const has = (bin) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true } catch { return false } }
const portOpen = (p) => { try { execFileSync('bash', ['-c', `lsof -ti :${p}`], { stdio: 'ignore' }); return true } catch { return false } }

/* 每条怎么查 —— 按清单里的名字对上(名字改了这里就查不到,④ 会红) */
const PROBES = {
  'miniprogram-automator': () => {
    const p = process.env.MP_AUTOMATOR || ''
    if (p === 'skip') return { ok: false, note: '显式 MP_AUTOMATOR=skip(回执须写原因)' }
    if (!p) return { ok: false, note: '**MP_AUTOMATOR 没设** —— 三把小程序刀会按红处理' }
    if (!existsSync(p)) return { ok: false, note: `MP_AUTOMATOR 指的路径不存在:${p}` }
    let ver = ''
    try { ver = JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')).version || '' } catch { /* 没有就算了 */ }
    return { ok: true, note: `在 · ${p}${ver ? ` · v${ver}` : ''}` }
  },
  '微信开发者工具自动化端口': () => (portOpen(9420)
    ? { ok: true, note: '9420 在听' }
    : { ok: false, note: '**9420 没开** —— `cli auto --project miniprogram --auto-port 9420`' }),
  'Google Chrome': () => {
    const p = process.env.SHOT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    return existsSync(p) ? { ok: true, note: `在 · ${p}` } : { ok: false, note: `找不到:${p}` }
  },
  '栅格化后端(SVG→PNG)': () => {
    const b = ['rsvg-convert', 'magick', 'convert', 'qlmanage'].find(has) || ''
    return b ? { ok: true, note: `当前用 ${b}` } : { ok: false, note: '一个都没有 —— 签署单快照会**回落原 SVG**(明写的设计,不挡看单)' }
  },
  Node: () => {
    const v = process.versions.node
    const major = Number(v.split('.')[0])
    return major >= 22 ? { ok: true, note: `v${v}` } : { ok: false, note: `v${v} < 22(node:sqlite 要 22+)` }
  },
}

console.log('外部件预检 —— 逐条现查(清单:handoff/外部件清单.md)\n')
const pad = (s, n) => { let w = 0; for (const c of String(s)) w += /[一-龥]/.test(c) ? 2 : 1; return String(s) + ' '.repeat(Math.max(0, n - w)) }
let missingRequired = []
let unprobed = []
for (const r of rows) {
  const probe = PROBES[r.name]
  if (!probe) { unprobed.push(r.name); console.log(`${pad(r.no, 3)}${pad(r.name, 34)}⚠️ 清单里有,但这把刀不认得这个名字`); continue }
  const res = probe()
  const required = /必需/.test(r.need) && !/可选/.test(r.need)
  const mark = res.ok ? '✅' : (required ? '🔴' : '⚠️')
  if (!res.ok && required) missingRequired.push(`${r.name} —— ${res.note}`)
  console.log(`${pad(r.no, 3)}${pad(r.name, 34)}${mark} ${res.note}`)
}
console.log(`\n清单 ${rows.length} 条 · 必需项缺 ${missingRequired.length} 个`)

let bad = 0
if (rows.length < MIN_ROWS) {
  console.error(`🔴 清单缩水:${rows.length} < 下限 ${MIN_ROWS} —— 删一条 = 把那个依赖抹出预检面`); bad = 1
}
/* ④ 反向守:清单里的名字必须都能对上一个探针;对不上说明改了名而探针没跟上(判据会静默漏查) */
if (unprobed.length) {
  console.error(`🔴 清单里这些名字这把刀不认得,等于**没查**:${unprobed.join(' | ')}`)
  console.error('   —— 改了清单里的名字,要同步改 tools/ext-deps-check.mjs 的 PROBES')
  bad = 1
}
if (missingRequired.length) {
  console.error('\n🔴 必需的外部件缺了 —— **开跑之前先补上**,不然会跑到一半才发现:')
  for (const m of missingRequired) console.error(`   · ${m}`)
  console.error('   装法与踩过的坑:handoff/外部件清单.md §二')
  if (STRICT) bad = 1
}
process.exit(bad ? 1 : 0)
