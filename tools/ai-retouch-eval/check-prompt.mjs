/* 口令自检 —— 真 import,不从源码抠文本 */
import { PROMPT, MUST_BE_GONE, MUST_BE_PRESENT } from './round2-prompt.mjs'
let fail = 0
console.log('=== 送进模型的口令(' + PROMPT.length + ' 字)===\n' + PROMPT)
console.log('\n=== 判据① 口令非空(空串能骗过所有"不包含"检查)===')
if (PROMPT.length < 200) { console.log('  🔴 口令太短/为空:' + PROMPT.length); fail++ } else console.log('  ✅ ' + PROMPT.length + ' 字')
console.log('=== 判据② 该删的不在(黑名单)===')
for (const s of MUST_BE_GONE) { if (PROMPT.includes(s)) { console.log('  🔴 还在:' + s); fail++ } else console.log('  ✅ 已删:' + s) }
console.log('=== 判据③ 该有的全在(白名单,逐条点名)===')
for (const s of MUST_BE_PRESENT) { if (!PROMPT.includes(s)) { console.log('  🔴 缺:' + s); fail++ } else console.log('  ✅ ' + s) }
console.log(fail ? `\n🔴 自检不过,${fail} 条` : '\n✅ 自检全过')
process.exit(fail ? 1 : 0)
