/* 曝光桶复核(12i补二 后续 §二)—— ¥0,不重跑模型
 *
 * 店主已核实的事实:
 *   `round4-prompts.mjs:40`  桶 C 的条件是 `p95 > 240 && 全图均亮 > 140`
 *   `run-round5.mjs:47` / `run-round5b.mjs:47`  都把**整张平均亮度**填进了**最亮值(p95)**那一格
 *   第四轮曾留过「p95 缺,C 桶本批为空」的注释,**第五轮起丢了**
 * ⇒ 全图均亮不可能 > 240,所以第五轮起**桶 C 永远触发不了**。
 *
 * 本脚本只做一件事:把**真实 p95** 换进去,看本该是哪个桶。**只报不重跑。**
 * 只换这一个变量 —— 手框均亮 / 全图均亮 仍用本轮实际用的那两个数,免得把两件事搅在一起。
 *
 * 用法:node bucket-recheck.mjs <_input 目录> <分档表88张.json> <输出json>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { measure } from './metrics.mjs'
import { bucketOfSkin } from './round4-prompts.mjs'

const [, , IN_DIR, REGION_JSON, OUT] = process.argv
const PICKS = ['60', '61', '42', '57', '14', '49', '53', '78', '18', '28', '71', '02', '46', '74', '38']
const R = new Map(JSON.parse(readFileSync(REGION_JSON, 'utf8')).map((x) => [x.f.slice(0, 2), x]))
const files = PICKS.map((n) => ({ n, f: readdirSync(IN_DIR).find((x) => x.startsWith(n + '_') && x.endsWith('.jpg')) }))
const mm = measure(files.map((x) => join(IN_DIR, x.f)))

const rows = files.map((x, i) => {
  const r = R.get(x.n)
  const 真p95 = mm[i].全图.p95
  const 本轮桶 = bucketOfSkin(r.手框均亮, r.全图均亮, r.全图均亮)   /* 照本轮实际代入法 */
  const 本该桶 = bucketOfSkin(r.手框均亮, 真p95, r.全图均亮)        /* 只把 p95 换成真的 */
  return { 序号: x.n, 文件: x.f, 真实最亮值p95: 真p95, 全图平均亮度: r.全图均亮,
           手部平均亮度: r.手框均亮, 本轮用的桶: 本轮桶, 本该用的桶: 本该桶,
           差了吗: 本轮桶 !== 本该桶 }
})
writeFileSync(OUT, JSON.stringify({
  说明: '只把 p95 换成真值,手框均亮/全图均亮仍用本轮实际用的数。只报不重跑。',
  桶C条件: 'p95 > 240 且 全图均亮 > 140',
  行: rows,
}, null, 1))

console.log(`${'号'.padEnd(4)}${'真实最亮值p95'.padStart(14)}${'全图平均'.padStart(10)}${'手部平均'.padStart(10)}  本轮桶 → 本该桶`)
for (const r of rows) {
  console.log(`${r.序号.padEnd(4)}${String(r.真实最亮值p95).padStart(14)}${String(r.全图平均亮度).padStart(10)}${String(r.手部平均亮度).padStart(10)}  ` +
    `${r.本轮用的桶} → ${r.本该用的桶}${r.差了吗 ? '   🔴 差了' : ''}`)
}
const diff = rows.filter((r) => r.差了吗)
console.log(`\n共 ${rows.length} 张;桶判会变的 ${diff.length} 张${diff.length ? ':' + diff.map((r) => `${r.序号}(${r.本轮用的桶}→${r.本该用的桶})`).join(' ') : ''}`)
console.log(`真实 p95 范围:${Math.min(...rows.map((r) => r.真实最亮值p95))} – ${Math.max(...rows.map((r) => r.真实最亮值p95))}`)
