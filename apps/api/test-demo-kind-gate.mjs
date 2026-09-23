/* D217 · 转样板店三道锁(12l补)—— 三锁彼此独立,任一命中即拦
 *   一锁 HAS_REAL_MONEY:收过钱/有结算单 → 拒
 *   二锁 PROTECTED_REAL_TENANT:黑名单(本批加了 luvia-bj)→ 拒
 *   三锁 TENANT_NOT_EMPTY:空店门,0单/0顾客/0签署件/老板未首登,四条全满足才放行
 * 🔴 反向守:全新空店**必须放行** —— 不能写成「所有真店一律锁死」,
 *    否则「转为样板店」这个正门按钮永远失败(店主 12l补 点名)。
 */
import { createDemoReset, PROTECTED_REAL_TENANTS } from './demo-reset.mjs'
let pass=0, fail=0
/* 🔴 输出格式改成 TAP 的 `ok N - …`(店主 12m裁四批,2026-09-24)。
   原来打 `  ✅ …`,而 test-assertion-baseline 那把尺子**只数 `^ok ` 行** ——
   于是这一套的断言对基线完全隐形:少几条、整套空转,棘轮都不会红。
   **不加进「零断言白名单」**:那等于拿白名单吸收判据缺陷(J-49),
   断言内容一个字没动,只换打印形状。 */
let n=0
const ok=(c,m)=>{n++;c?(pass++,console.log(`ok ${n} - ${m}`)):(fail++,console.log(`not ok ${n} - ${m}`))}
const apiError=(c,k,m)=>Object.assign(new Error(m),{statusCode:c,kind:k})
/** 按真实 SQL 逐条应答的假库 */
const mkDb=({id='t',name='店',counts={},owner={must_change_password:1},income=0,sheets=0})=>({
  prepare:(sql)=>({
    get:(...a)=>{
      if(/FROM tenants/.test(sql)) return {id,name,kind:'real'}
      if(/finance_transactions/.test(sql)) return {n:income}
      if(/FROM settlements/.test(sql)) return {n:sheets}
      if(/admin_accounts/.test(sql)) return owner
      const m=sql.match(/FROM (\w+) WHERE tenant_id/); if(m) return {n:counts[m[1]]??0}
      return null
    }, run:()=>{}, all:()=>[]})})
const mk=(db)=>createDemoReset({db,apiError,randomId:()=>'x',iso:(d)=>d.toISOString(),snapshotDb:()=>{},dbPath:'',backupDir:''})
const tryKind=(db,tenantId)=>{ try{ mk(db).setTenantKind({tenantId,kind:'demo',reason:'测试'}); return null }catch(e){ return e } }

console.log('\n── 一锁:有真钱 ──')
for(const [d,inc,sh] of [['收过钱',10000,0],['有结算单',0,3]]){
  const e=tryKind(mkDb({income:inc,sheets:sh}),'x')
  ok(e?.kind==='HAS_REAL_MONEY', `${d} → ${e?`${e.statusCode} ${e.kind}`:'🔴 放行了'}`)
}
console.log('\n── 二锁:黑名单(本批加 luvia-bj)──')
ok(PROTECTED_REAL_TENANTS.includes('luvia-bj'), `名单 = [${PROTECTED_REAL_TENANTS.join(', ')}]`)
for(const id of PROTECTED_REAL_TENANTS){
  const e=tryKind(mkDb({id,name:id}),id)          // 干净的店,只有黑名单能拦
  ok(e?.kind==='PROTECTED_REAL_TENANT', `${id} → ${e?`${e.statusCode} ${e.kind}`:'🔴 放行了'}`)
}
console.log('\n── 三锁:空店门(非黑名单的真店)──')
for(const [d,counts,owner,expectBlock] of [
  ['有预约',{bookings:12},{must_change_password:1},true],
  ['有顾客',{users:5},{must_change_password:1},true],
  ['有签署件',{signed_docs:2},{must_change_password:1},true],
  ['老板已首登改密',{},{must_change_password:0},true],
  ['没有老板账号(异常数据)→ 必须拦',{},null,true],
  ['🔴 反向守:全新空店必须放行',{},{must_change_password:1},false],
]){
  const e=tryKind(mkDb({id:'newstore',name:'新店',counts,owner}),'newstore')
  const blocked=!!e
  ok(blocked===expectBlock, `${d} → ${blocked?`拒(${e.kind})`:'放行'}`)
  if(blocked&&expectBlock) ok(e.kind==='TENANT_NOT_EMPTY', `   拒的理由是空店门(${e.kind})`)
}
console.log('\n── countOf 不许吞异常(安全判据不能建在 catch 上)──')
const boom={prepare:(sql)=>({get:()=>{ if(/FROM tenants/.test(sql)) return {id:'x',name:'店',kind:'real'}
  if(/finance_transactions/.test(sql)||/FROM settlements/.test(sql)) return {n:0}
  throw new Error('表不存在') }, run:()=>{}, all:()=>[]})}
const e=tryKind(boom,'x')
ok(e && e.kind!=='TENANT_NOT_EMPTY' && !/放行/.test(String(e)), `查询炸了会抛出来(${e?e.message.slice(0,20):'没抛 🔴'}),不会被当成「空店」放行`)
console.log(`\n  ${pass} 过 · ${fail} 红`)
process.exit(fail?1:0)
