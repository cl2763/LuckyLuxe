import assert from 'node:assert/strict'
import {reconcileMigrationCards,createMigrationCardReconciliation} from './migration-card-reconciliation.mjs'
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code})
const ctx={snapshotAmountCents:10001,currency:'CNY',assets:[{id:'a'},{id:'b'}]}
const card=(assetId,paidCents,bonusCents)=>({assetId,kind:'paid_timecard',paidCents,bonusCents,remainingTimes:3,serviceId:'svc',noExpiry:true})
const body={currency:'CNY',cards:[card('a',6000,1),card('b',4000,0)]}
let n=0;const check=(s,f)=>{f();console.log('PASS',++n,s)}
check('split sums in integer cents; never activates',()=>{const x=reconcileMigrationCards(ctx,body,fail);assert.equal(x.balanced,true);assert.equal(x.paidCents,10000);assert.equal(x.bonusCents,1);assert.equal(x.canActivate,false)})
check('unknown card prevents false balance claim',()=>{const x=reconcileMigrationCards(ctx,{...body,cards:[card('a',10001,0),{assetId:'b',kind:'unresolved'}]},fail);assert.equal(x.differenceCents,0);assert.equal(x.balanced,false)})
check('duplicate missing and foreign sources refused',()=>{for(const cards of [[card('a',1,0)], [card('a',1,0),card('a',1,0)],[card('a',1,0),card('foreign',1,0)]])assert.throws(()=>reconcileMigrationCards(ctx,{...body,cards},fail))})
check('invalid money counts and dates refused',()=>{for(const changes of [{paidCents:null},{bonusCents:-1},{remainingTimes:1.2},{remainingTimes:0},{noExpiry:false,expiresOn:'2026-02-30'},{expiresOn:'2026-10-01'},{serviceId:''}])assert.throws(()=>reconcileMigrationCards(ctx,{...body,cards:[{...body.cards[0],...changes},body.cards[1]]},fail))})
check('currency mismatch not converted',()=>assert.throws(()=>reconcileMigrationCards(ctx,{...body,currency:'CAD'},fail),e=>e.code==='CURRENCY_MISMATCH'))
check('over-allocation remains negative difference, never silently clamped',()=>assert.equal(reconcileMigrationCards(ctx,{...body,cards:[card('a',10001,0),card('b',1,0)]},fail).differenceCents,-1))
check('zero exhausted card and past expiry retained without extension',()=>{const c={...body.cards[0],paidCents:0,bonusCents:0,remainingTimes:0,noExpiry:false,expiresOn:'2020-01-01'};assert.equal(reconcileMigrationCards(ctx,{...body,cards:[c,body.cards[1]]},fail).cards[0].expiresOn,'2020-01-01')})
const service=createMigrationCardReconciliation({apiError:fail})
for(const role of ['staff','finance','customer']){await assert.rejects(()=>service.route({req:{method:'POST'},path:'/admin/customers/u/migration-balances/p/reconciliation',adminSession:{role}}),e=>e.status===403);console.log('PASS',++n,role+' denied')}
console.log(n+' reconciliation checks passed')
