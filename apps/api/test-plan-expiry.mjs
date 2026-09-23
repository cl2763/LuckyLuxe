/* D217 / 12l补 · 到期日口径三刀(店主点名的造病台)
 *   刀一:对 NULL 店(永久)续费 → 必须拒
 *   刀二:写入口传 0 / '' / false → 必须 400
 *   刀三:传 perpetual:true → 必须写成 NULL
 * 再加反向守:传合法日期 → 正常写入(证明闸不是把所有写都挡了)
 */
import { isPerpetual, daysLeftOf, expiryLabel, assertRenewable, parseExpiryWrite, expiryFromTerm, INITIAL_TERMS, parseInitialTerm } from './plan-expiry.mjs'
let pass = 0, fail = 0
const apiError = (code, kind, msg) => Object.assign(new Error(msg), { statusCode: code, kind })
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  🔴 ' + m) } }
const throws = (fn, code, m) => {
  try { fn(); fail++; console.log(`  🔴 ${m} —— 没抛`) }
  catch (e) { const good = e.statusCode === code; good ? pass++ : fail++; console.log(`  ${good ? '✅' : '🔴'} ${m}(得 ${e.statusCode} ${e.kind})`) }
}
console.log('\n── 刀一:永久店续费必须拒 ──')
throws(() => assertRenewable({ name: 'LUVIA 半径', plan_expires_at: null }, apiError), 409, '对 NULL 店续费 → 409')
ok((() => { try { assertRenewable({ name: 'x', plan_expires_at: '2027-01-01' }, apiError); return true } catch { return false } })(),
   '反向守:有到期日的店续费 → 放行(闸不是全挡)')

console.log('\n── 刀二:空串 / 0 / false 不许写 NULL ──')
for (const [v, d] of [['', "空串"], [0, '数字 0'], [false, 'false'], ['   ', '全空格']])
  throws(() => parseExpiryWrite({ planExpiresAt: v }, apiError), 400, `planExpiresAt=${d} → 400`)
for (const [v, d] of [[false, 'false'], [0, '0'], ['true', '字符串 true']])
  throws(() => parseExpiryWrite({ perpetual: v }, apiError), 400, `perpetual=${d}(非 true)→ 400`)

console.log('\n── 刀三:perpetual:true 才写 NULL ──')
const w = parseExpiryWrite({ perpetual: true }, apiError)
ok(w && w.sql === 'plan_expires_at = NULL' && w.arg === undefined, 'perpetual:true → plan_expires_at = NULL')
const w2 = parseExpiryWrite({ planExpiresAt: '2027-03-01' }, apiError)
ok(w2 && w2.sql === 'plan_expires_at = ?' && w2.arg === '2027-03-01', '合法日期 → 正常写入(反向守)')
throws(() => parseExpiryWrite({ planExpiresAt: '2027/03/01' }, apiError), 400, '格式不对 → 400')
ok(parseExpiryWrite({ plan: 'chain' }, apiError) === null, '没带到期日字段 → 不改到期日(返回 null)')

console.log('\n── 读口:空 = 永久,四处口径一致 ──')
const perp = { name: 'p', plan_expires_at: null }, normal = { name: 'n', plan_expires_at: '2027-01-01' }
ok(isPerpetual(perp) === true && isPerpetual(normal) === false, 'isPerpetual 认 NULL')
ok(daysLeftOf(perp) === null, '永久店 daysLeft = null(不是 0、不是负数)')
ok(expiryLabel(perp).text === '长期', '永久店界面文案 = 「长期」')
ok(expiryLabel({ name: 'x', plan_expires_at: new Date(Date.now() - 3 * 86400000).toISOString() }).kind === 'expired', '过期店仍判 expired(反向守)')

console.log('\n── 回路:「取消永久」必须真走得通(不能是单行道)──')
/* 🔴 409 文案说「先取消永久再续费」,那就必须真有一条取消的路 ——
   给永久店 PATCH 一个日期。若这条也被挡,永久就成了进得去出不来的单行道。 */
const back = parseExpiryWrite({ planExpiresAt: '2028-01-01' }, apiError)
ok(back && back.sql === 'plan_expires_at = ?' && back.arg === '2028-01-01',
   '对永久店 PATCH 一个日期 → 正常写入(取消永久的回路通)')
ok((() => { try { assertRenewable({ name: 'x', plan_expires_at: '2028-01-01' }, apiError); return true } catch { return false } })(),
   '取消永久之后 → 续费放行(回路走完整条)')

console.log('\n── D215 建店首期(店主 12o 连带查出:白名单漏了 forever 会静默回落成年付)──')
const ISO=(d)=>d.toISOString()
ok(expiryFromTerm('forever', ISO) === null, "首期=forever → null(永久)")
ok(INITIAL_TERMS.includes('forever'), `白名单含 forever:[${INITIAL_TERMS.join(', ')}]`)
for (const t of ['trial30','month','year']) ok(typeof expiryFromTerm(t, ISO) === 'string', `首期=${t} → 有到期日`)
ok((()=>{try{expiryFromTerm('乱写', ISO);return false}catch{return true}})(), 'expiryFromTerm 收到未校验的值 → 抛(不许自己兜底)')
/* 🔴 这条原来写的是「未知值 → 回落成年付」—— **判据把缺陷当成了对的行为**,
   等于用判据把洞锁死(店主 09-24 指出)。现在:没传才默认,传错要报错。 */
ok(parseInitialTerm(undefined, apiError) === 'year', '没传 → 默认年付')
ok(parseInitialTerm('', apiError) === 'year', '传空串 → 默认年付')
for (const bad of ['乱写', 'forevr', 'YEAR', 0, true])
  throws(() => parseInitialTerm(bad, apiError), 400, `传错的值「${bad}」→ 400,不许悄悄当年付`)
for (const t of INITIAL_TERMS) ok(parseInitialTerm(t, apiError) === t, `合法值 ${t} → 原样通过`)

console.log(`\n  ${pass} 过 · ${fail} 红`)
process.exit(fail ? 1 : 0)
