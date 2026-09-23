/* 腿 A′ 自检(12f §二) */
import * as M from './round5-prompts.mjs'
import { findContradictions } from './round4-prompts.mjs'
let fail = 0
const say = (ok, m) => { if (!ok) fail++; console.log(`  ${ok ? '✅' : '🔴'} ${m}`) }
for (const [b, t] of [['A','深'],['A','浅'],['B','深'],['B','浅']]) {
  const p = M.promptR5b(b, t)
  console.log(`\n--- 腿A′ 桶${b} × ${t}甲(${p.length} 字)---`)
  /* 六词黑名单:只作用于【手部皮肤】块 */
  for (const w of M.R5B_BLACKLIST) say(!M.BLOCK_SKIN_MIN.includes(w), `${M.R5B_BLACKLIST_SCOPE}不含「${w}」`)
  say(M.BLOCK_SKIN_MIN.includes('去掉痘印、色斑、倒刺、细小杂质'), `手部块只剩去瑕疵`)
  say(M.BLOCK_SKIN_MIN.includes('其余一切保持原样'), `手部块含「其余一切保持原样」`)
  /* 其余三块与第五轮逐字相同 */
  say(p.includes(M.blockNail(t)), `【甲面】与第五轮逐字相同`)
  say(p.includes(M.blockExpo(b)), `【曝光】与第五轮逐字相同`)
  const idx = ['【绝对不改】','【甲面】','【手部皮肤】','【曝光】'].map((x)=>p.indexOf(x))
  say(idx.every((i)=>i>=0) && idx.every((v,i,a)=>i===0||a[i-1]<v), `四块齐且顺序对`)
  say(findContradictions(p).length === 0, `无矛盾对`)
}
console.log('\n=== 六词全文命中位置(给店主裁,不做判据)===')
for (const h of M.blacklistHits('A','深')) console.log(`  「${h.词}」 出现在:${h.出现在.join('、')}`)
console.log(fail ? `\n🔴 自检不过,${fail} 条` : '\n✅ 自检全过')
process.exit(fail ? 1 : 0)
