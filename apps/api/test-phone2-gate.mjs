/* D216 · 第二电话:加列之前不许悄悄丢掉(店主 09-24 裁)
 *   前端:那一格 disabled 且**不进请求体**(唯一开关 PHONE2_READY)
 *   后端:收到 phone2 但 stores 没这一列 ⇒ 400,不许默默扔掉
 */
import { readFileSync } from 'node:fs'
let pass=0, fail=0
/* 🔴 输出格式改成 TAP 的 `ok N - …`(店主 12m裁四批,2026-09-24)。
   原来打 `  ✅ …`,而 test-assertion-baseline 那把尺子**只数 `^ok ` 行** ——
   于是这一套的断言对基线完全隐形:少几条、整套空转,棘轮都不会红。
   **不加进「零断言白名单」**:那等于拿白名单吸收判据缺陷(J-49),
   断言内容一个字没动,只换打印形状。 */
let n=0
const ok=(c,m)=>{n++;c?(pass++,console.log(`ok ${n} - ${m}`)):(fail++,console.log(`not ok ${n} - ${m}`))}
const html = readFileSync(new URL('../web/platform.html', import.meta.url), 'utf8')
const srv  = readFileSync(new URL('./local-server.mjs', import.meta.url), 'utf8')

console.log('\n── 前端 ──')
ok(/const PHONE2_READY = (true|false)/.test(html), '有唯一开关 PHONE2_READY')
const ready = /const PHONE2_READY = true/.test(html)
ok(/id="mPhone2"[^>]*\bdisabled\b/.test(html) === !ready, `开关=${ready} 时那一格 ${ready?'可填':'disabled'}`)
ok(/PHONE2_READY\s*\?\s*\{\s*phone2:/.test(html), '请求体按开关拼 —— 关着就不发这个字段')
ok(!/[^?]\bphone2:\$\('mPhone2'\)/.test(html.replace(/PHONE2_READY\?\{phone2:\$\('mPhone2'\)[^}]*\}/g,'')),
   '没有第二处无条件发 phone2 的地方')

console.log('\n── 后端 ──')
ok(/PHONE2_COLUMN_MISSING/.test(srv), '有 PHONE2_COLUMN_MISSING 这道闸')
ok(/pragma_table_info\('stores'\)[^\n]*phone2/.test(srv), '闸是**现查列在不在**,不是写死判断')
const gate = srv.slice(srv.indexOf("body.phone2 !== undefined"), srv.indexOf("INSERT INTO stores (id, name, name_en"))
ok(gate.includes('throw apiError(400'), '列不存在时抛 400(不是 warn、不是忽略)')
ok(gate.indexOf('INSERT') === -1, '闸在 INSERT **之前** —— 拦住才不会建出半截店')

console.log('\n── 落刀:把闸拆掉必须红 ──')
const knifed = srv.replace(/if \(!hasCol\) throw apiError\(400, 'PHONE2_COLUMN_MISSING'[^\n]*\n/, '')
ok(!/PHONE2_COLUMN_MISSING/.test(knifed), '刀下:闸没了(证明这条判据盯的就是那一行)')

console.log(`\n  ${pass} 过 · ${fail} 红`)
process.exit(fail?1:0)
