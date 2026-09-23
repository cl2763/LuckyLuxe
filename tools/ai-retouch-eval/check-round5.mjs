/* 第五轮四块口令自检(12e §二 末 + §四) */
import * as M from './round5-prompts.mjs'
import { findContradictions } from './round4-prompts.mjs'
let fail = 0
const say = (ok, m) => { if (!ok) fail++; console.log(`  ${ok ? '✅' : '🔴'} ${m}`) }
for (const [b, t] of [['A', '深'], ['A', '浅'], ['B', '深'], ['B', '浅']]) {
  const p = M.promptR5(b, t)
  console.log(`\n--- 桶${b} × ${t}甲(${p.length} 字)---`)
  say(p.length > 380, `长度 ${p.length}`)
  for (const [blk, list] of Object.entries(M.MUST_PRESENT)) for (const s of list) say(p.includes(s), `${blk} 含「${s}」`)
  /* §二 末:「甲面不许白 vs 手部冷白」允许共存,但两句各自的宾语词必须在 */
  say(p.includes(M.OBJECT_WORDS.甲面句), `甲面句带宾语词「${M.OBJECT_WORDS.甲面句}」`)
  say(p.includes(M.OBJECT_WORDS.手部句), `手部句带宾语词「${M.OBJECT_WORDS.手部句}」`)
  /* 跨块提及:【曝光】块里不许出现别的宾语 */
  const expo = M.blockExpo(b)
  for (const s of M.EXPO_MUST_GONE) say(!expo.includes(s), `【曝光】块不含「${s}」`)
  /* 四块齐、顺序对 */
  const idx = ['【绝对不改】', '【甲面】', '【手部皮肤】', '【曝光】'].map((x) => p.indexOf(x))
  say(idx.every((i) => i >= 0) && idx.every((v, i, a) => i === 0 || a[i - 1] < v), `四块齐且顺序为 不改→甲面→手部→曝光`)
  /* 老的矛盾对照跑 */
  const c = findContradictions(p)
  say(c.length === 0, `无矛盾对${c.length ? ' —— ' + c.join(' / ') : ''}`)
  /* 甲面色调句不许串 */
  say(!p.includes(t === '深' ? '浅色/透明系' : '深色系,保持深色'), `没混进另一种甲面句`)
}
const four = [['A','深'],['A','浅'],['B','深'],['B','浅']].map(([b,t]) => M.promptR5(b,t))
say(new Set(four).size === 4, `四格互不相同(实得 ${new Set(four).size})`)
console.log(fail ? `\n🔴 自检不过,${fail} 条` : '\n✅ 自检全过')
process.exit(fail ? 1 : 0)
