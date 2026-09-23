/* 第四轮口令自检(12d补 §七-5 + §四)—— 真 import,不从源码抠 */
import * as M from './round4-prompts.mjs'
let fail = 0
const say = (ok, msg) => { if (!ok) fail++; console.log(`  ${ok ? '✅' : '🔴'} ${msg}`) }

console.log('=== 手部口令:四格(桶 × 甲面色调)===')
for (const b of ['A', 'B']) for (const t of ['深', '浅']) {
  const p = M.handPromptFor(b, t)
  console.log(`\n  --- 桶${b} × ${t}甲(${p.length} 字)---`)
  say(p.length > 400, `长度 ${p.length}`)
  for (const s of M.HAND_MUST_PRESENT) say(p.includes(s), `含「${s}」`)
  for (const s of M.TONE_MUST[t]) say(p.includes(s), `${t}甲必含「${s}」`)
  /* 反向守:深甲口令不许混进浅甲那句,反之亦然 —— 否则"两维"是摆设 */
  say(!p.includes(t === '深' ? '浅色/透明系' : '深色系,保持深色'), `没有混进另一种甲面句`)
  /* 曝光桶句必须对得上 */
  say(p.includes(b === 'A' ? '这是一张暗调照片' : '这张照片曝光正常'), `曝光句是桶${b} 的`)
}

console.log('\n=== 背景口令:五种 ===')
for (const k of Object.keys(M.BACKGROUNDS)) {
  const p = M.bgPromptFor('B', '浅', k)
  const bg = M.BACKGROUNDS[k]
  console.log(`\n  --- ${k} ---`)
  for (const s of M.BG_MUST_PRESENT) say(p.includes(s), `含「${s}」`)
  /* §四:四个禁词只查**背景句本身**,不查通用前缀(前缀里本来就有「白平衡」「亮度」) */
  for (const s of M.BG_MUST_GONE) say(!bg.includes(s), `背景句不含「${s}」`)
}

console.log('\n=== 四格互不相同 ===')
const four = [['A','深'],['A','浅'],['B','深'],['B','浅']].map(([b,t]) => M.handPromptFor(b,t))
say(new Set(four).size === 4, `四格口令两两不同(实得 ${new Set(four).size} 种)`)
const five = Object.keys(M.BACKGROUNDS).map((k) => M.bgPromptFor('B','浅',k))
say(new Set(five).size === 5, `五种背景口令两两不同(实得 ${new Set(five).size} 种)`)

console.log('\n=== 矛盾对:同一宾语不许同时出现「不改/不变」与「换/改」(补二 §二)===')
for (const [name, p] of [
  ['P1b 桶A×深', M.handPromptForP1b('A','深')], ['P1b 桶B×浅', M.handPromptForP1b('B','浅')],
  ...Object.keys(M.BACKGROUNDS).map((k) => [`P2 ${k}`, M.bgPromptFor('B','浅',k)]),
]) {
  const c = M.findContradictions(p)
  say(c.length === 0, `${name} 无矛盾${c.length ? ' —— ' + c.join(' / ') : ''}`)
}
console.log('\n=== 补二 §四 三条 grep ===')
const p1b = M.handPromptForP1b('A','深'), bg = M.bgPromptFor('B','浅','虚化')
for (const s of ['真实纹理','不做平涂','不做美白平涂']) say(!p1b.includes(s), `P1b 不含「${s}」`)
for (const s of ['同一背景','背景内容和构图不改']) say(!bg.includes(s), `P2 不含「${s}」`)
say(bg.includes('保留原图本来的暖调'), 'P2 含「保留原图本来的暖调」')

console.log(fail ? `\n🔴 自检不过,${fail} 条` : '\n✅ 自检全过')
process.exit(fail ? 1 : 0)
