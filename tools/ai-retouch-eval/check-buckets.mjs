/* 三桶口令自检 —— 真 import(第二轮踩过正则抠空的坑) */
import { promptFor, MUST_BE_GONE, MUST_BE_PRESENT_ALL, MUST_BE_PRESENT } from './bucket-prompts.mjs'
let fail = 0
for (const b of ['A', 'B', 'C']) {
  const P = promptFor(b)
  console.log(`\n=== 桶 ${b}(${P.length} 字)===`)
  if (P.length < 250) { console.log(`  🔴 口令过短/为空:${P.length}`); fail++ } else console.log(`  ✅ 长度 ${P.length}`)
  for (const s of MUST_BE_GONE) { if (P.includes(s)) { console.log(`  🔴 不许出现「${s}」,但出现了`); fail++ } }
  for (const s of [...MUST_BE_PRESENT_ALL, ...MUST_BE_PRESENT[b]]) {
    if (!P.includes(s)) { console.log(`  🔴 缺:${s}`); fail++ }
  }
  console.log(`  ${MUST_BE_GONE.length} 条禁词 + ${MUST_BE_PRESENT_ALL.length + MUST_BE_PRESENT[b].length} 条必含 全部核过`)
}
/* 三桶必须互不相同 —— 否则"分桶"就是摆设 */
const [a, b, c] = ['A', 'B', 'C'].map(promptFor)
if (a === b || b === c || a === c) { console.log('\n  🔴 有两桶口令一模一样,分桶等于没分'); fail++ }
else console.log('\n  ✅ 三桶口令互不相同')
console.log(fail ? `\n🔴 自检不过,${fail} 条` : '\n✅ 自检全过')
process.exit(fail ? 1 : 0)
