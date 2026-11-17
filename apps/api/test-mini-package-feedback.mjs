import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
let checks=0;const checked=name=>console.log('ok '+(++checks)+' - '+name)
let def,tid='a',token='owner-a',failure=false,delayed=null
const packages=[{id:'old',kind:'stored_value',name:'旧储值',priceCents:10000,giftItems:[{name:'护理油',quantity:1}],defaultPersonalDiscount:{rateBps:8500}},{id:'new',kind:'recharge',name:'新充值'},{id:'card',kind:'times',name:'次卡'},{id:'unknown',kind:'other',name:'待核对'}]
const api={currentTenantId:()=>tid,getAdminAuth:()=>({accessToken:token}),adminGet:async path=>{
 if(path==='/admin/packages'){if(failure)throw Error('网络请求失败');if(delayed)return await new Promise(resolve=>delayed.push(resolve));return {packages}}
 return path==='/admin/coupons'?{coupons:[]}:{customers:[]}
}}
runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/member/index.js',import.meta.url),'utf8'),{Page:p=>def=p,require:p=>p.endsWith('/api')?api:p.endsWith('storeclock')?{storeMoney:c=>String(c),refreshStoreClock:async()=>{}}:{active:()=>true},wx:{stopPullDownRefresh(){}},setTimeout,clearTimeout,console})
const page={...def,data:structuredClone(def.data),setData(d){Object.assign(this.data,d)}}
await page.loadAll();assert.equal(page.data.recharges.length,2);assert.equal(page.data.timesCards.length,1);assert.equal(page.data.unknownKinds,1);assert.equal(page.data.recharges[0].discountText,'8.5 折');assert.equal(page.data.recharges[0].giftText,'护理油 × 1')
checked('旧储值与新充值共同展示，未知类型单独提示且赠品折扣完整')
failure=true;await page.loadAll();assert.match(page.data.listError,/网络/);assert.equal(page.data.recharges.length,2);assert.equal(page.data.listLoading,false)
checked('网络失败保留既有列表并结束加载状态')
failure=false;await page.loadAll();assert.equal(page.data.listError,'')
checked('重新读取成功后清除错误')
delayed=[];const pending=page.loadAll();await Promise.resolve();tid='b';token='owner-b';const pending2=page.loadAll();await Promise.resolve();assert.equal(page.data.recharges.length,0)
checked('切店后立即清空上一门店列表')
delayed[1]({packages:[]});await pending2;delayed[0]({packages});await pending;assert.equal(page.data.recharges.length,0);assert.equal(page.data.unknownKinds,0);assert.equal(page.data.listReady,true)
checked('上一门店迟到响应不覆盖新门店的空列表')
delayed=[];const hidden=page.loadAll();await Promise.resolve();page.onHide();delayed[0]({packages});await hidden;assert.equal(page.data.recharges.length,0)
checked('页面隐藏后不接纳迟到响应')
console.log('PASS: old/new/unknown types, gifts/discount, failure preservation, retry, empty success, tenant response ordering, hidden-page response cancellation')
