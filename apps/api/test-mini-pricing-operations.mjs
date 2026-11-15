import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
let page,fail=false,active=true,sends=[]
const items=[{id:'a',nameZh:'主项目',categoryId:'nail',itemKind:'main',listPriceCents:20000,memberPriceCents:16000,displayReference:{prices:{list:{priceCents:30400},share:{priceCents:15000}}}},{id:'b',nameZh:'未填分享价',categoryId:'nail',listPriceCents:9900,displayReference:{prices:{list:{priceCents:10000}}}}]
items.push({id:'card',nameZh:'次卡',categoryId:'nail',isTimecard:true,displayReference:{prices:{list:{priceCents:10000}}}})
const api={adminGet:async p=>p.endsWith('categories')?{categories:[{id:'nail',name:'美甲'}]}:p.endsWith('config')?{config:{active,displayTypes:['list','share']}}:{items},adminPost:async(p,b)=>{sends.push({p,b});if(fail)throw Error('失联');return {settlement:{subtotalCents:30400,lines:[{name:'主项目',amountCents:30400}]}}}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/quote-calc/index.js',import.meta.url),'utf8'),{Page:x=>page=x,require:p=>p.endsWith('/api')?api:{formatMoney:x=>String(x),displayOf:()=>({})},wx:{showToast(){}},setTimeout:()=>0,clearTimeout(){}})
page.data=JSON.parse(JSON.stringify(page.data));page.setData=x=>Object.assign(page.data,x)
await page.boot();assert.equal(page.allItems.length,2);assert.deepEqual(Array.from(page.data.tiers,t=>t.key),['list','share']);assert.equal(page.data.items[0].priceText,'30400')
page.toggleItem({currentTarget:{dataset:{id:'a'}}});await page.doPreview();assert.equal(sends[0].p,'/admin/member-pricing/reference-preview');assert.deepEqual(Object.keys(sends[0].b),['tierKey','items','applyFootSurcharge']);assert.equal(page.data.preview.subtotalCents,30400)
active=false;await page.boot();assert.deepEqual(Array.from(page.data.tiers,t=>t.key),['list','share','member']);active=true;await page.boot();page.toggleItem({currentTarget:{dataset:{id:'a'}}});
console.log('ok 1 - active public quote uses configured display prices and the reference-only endpoint')
page.toggleItem({currentTarget:{dataset:{id:'b'}}});page.pickTier({currentTarget:{dataset:{k:'share'}}});assert.equal(page.data.items.length,1);assert.equal(page.data.items[0].priceText,'15000');assert.equal(page.data.picked.b,undefined);assert.equal(page.data.preview,null)
page.pickTier({currentTarget:{dataset:{k:'member'}}});assert.equal(page.data.tierKey,'share');page.toggleItem({currentTarget:{dataset:{id:'b'}}});assert.equal(page.data.picked.b,undefined)
console.log('ok 2 - disabled display type and blank per-service prices cannot fall back to settlement values or stay selected')
await page.doPreview();assert.ok(page.quoteText());fail=true;await page.doPreview();assert.equal(page.data.preview,null);assert.equal(page.data.view,null);assert.equal(page.quoteText(),'');assert.equal(page.data.error,'失联')
console.log('ok 3 - failed repricing clears old totals and prevents copying or filling stale quotes')
const docsPath=new URL('../../miniprogram/pages/merchant/orders/member-documents.js',import.meta.url)
let mixin;vm.runInNewContext(readFileSync(docsPath,'utf8'),{require:p=>p.endsWith('/api')?{}:p.endsWith('/money')?{formatMoney:String,displayOf:()=>({})}:{},module:{get exports(){return mixin},set exports(v){mixin=v}}})
const doc=(id,status,extra={})=>({id,groupId:'g',status,userId:'u',beneficiaryKey:id==='a'?'self':'friend',quote:{totalCents:100,display:{customerName:'卡主',beneficiaryName:id,lines:[{name:'服务'}],discountText:'8折'}},...extra})
const g=mixin.groups([doc('b','pending_sign',{dependencyId:'a'}),doc('a','signed')])[0];assert.equal(g.pending,1);assert.equal(g.signed,1);assert.equal(g.documents[0].id,'a');assert.equal(g.documents[1].statusText,'待签署')
console.log('ok 4 - order service-document groups preserve one document per person and distinguish partial signing')

const regrouped=mixin.groups([doc('new','pending_sign',{groupId:'replacement',visitGroupId:'g'}),doc('b','voided'),doc('a','signed')]);assert.equal(regrouped.length,1);assert.equal(regrouped[0].id,'g');assert.equal(regrouped[0].signed,1);assert.equal(regrouped[0].pending,1);assert.equal(regrouped[0].documents.length,2)
console.log('ok 5 - refreshed document stays beside its signed companion under original visit; voided predecessor excluded')
