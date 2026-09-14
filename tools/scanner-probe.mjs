/* J-58 第五款 · **新刀先证咬得到,再信它报的 0**(店主 07r §三 立,夜12 段D 落)
 *
 * ══ 为什么每把扫描器都要带 probe ══
 * 一把写坏的扫描器**报出来的样子和一把干净的仓库一模一样**:都是 0。
 * 这个仓里已经咬过两次:
 *   · 早先模板串里的 `\b` 变成退格,整条分支静默滑出扫描面;
 *   · 07q 那把 `knife-restore-scan` 的正则末尾 `\b` 跟在 `--` 后面永远匹配不上,
 *     全仓扫出「零处」——**看起来干净,其实是瞎的**。
 *
 * **款文**:每一把扫描器必须自带 `--probe`:种一个**必然命中**的样本,刀必须报出它;
 * 再种一个**必然不命中**的样本(形似而非),刀必须不报。
 * **probe 报不出来 → 这把刀此刻报的一切 0 全部作废。**
 *
 * 用法(在扫描器里):
 *   import { probe } from './scanner-probe.mjs'
 *   if (process.argv.includes('--probe')) probe('刀名', [
 *     { 样本: '…必然命中的…', 该命中: true },
 *     { 样本: '…形似而非的…', 该命中: false },
 *   ], (样本) => 这把刀的判定函数(样本))
 */
export function probe(name, cases, decide) {
  const results = cases.map((c) => {
    let got = null
    let err = ''
    try { got = Boolean(decide(c.样本)) } catch (e) { err = String(e && e.message).slice(0, 60) }
    return { ...c, got, err, 对: err ? false : got === c.该命中 }
  })
  const ok = results.every((r) => r.对)
  console.log(`[自守·${name}]`)
  for (const r of results) {
    console.log(`  ${r.对 ? '✅' : '🔴'} 该${r.该命中 ? '命中' : '不命中'} → 实际${r.err ? `抛错(${r.err})` : (r.got ? '命中' : '不命中')}`
      + `   样本:${String(r.样本).replace(/\s+/g, ' ').slice(0, 64)}`)
  }
  console.log(ok ? '  → ✅ 分得开(这把刀报的数才算数)' : '  → 🔴 **分不开 —— 这把刀此刻报的一切 0 全部作废**(J-58⑤)')
  process.exitCode = ok ? 0 : 1
  return ok
}
