import assert from 'node:assert/strict'
import {mkdtempSync,openSync,closeSync,readFileSync,writeFileSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {DatabaseSync} from 'node:sqlite'
import {loginCustomerViaFrontDoor,loginStaffViaFrontDoor} from './customer-login-fixture.mjs'
const dir=mkdtempSync('/tmp/ll-ci-data.gift-entitlements-'),port=Number(process.env.GIFT_TEST_PORT||4369),base=`http://127.0.0.1:${port}`,owner='isolated-gift-http-only',fd=openSync(dir+'/server.log','w')
const env={PATH:process.env.PATH,HOME:process.env.HOME,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',OWNER_TOKEN:owner,WECHAT_MINI_TOKEN_SECRET:'isolated-gift-signing-only',WECHAT_APP_SECRET:'configured-test-only',ALLOW_DEMO_ADMIN_LOGIN:'false',NOTIFY_TICK:'off',GIFT_ENTITLEMENTS_TENANTS:'gift-shop'}
const server=spawn(process.execPath,['--experimental-sqlite','local-server.mjs'],{cwd:fileURLToPath(new URL('.',import.meta.url)),env,stdio:['ignore',fd,fd]});let db;let n=0
const check=(name,fn)=>{fn();console.log('ok '+(++n)+' - '+name)}
async function req(path,body,method=body?'POST':'GET',token=owner,tid='gift-shop',headers={}){const r=await fetch(base+path,{method,headers:{'content-type':'application/json','x-admin-tenant-id':tid,'x-tenant-id':tid,...(token?{authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
const ok=async(...args)=>{const r=await req(...args);assert.ok(r.status<300,`${args[0]} ${JSON.stringify(r)}`);return r.data}
try{
 for(let i=0;i<150;i++){try{const h=await(await fetch(base+'/health')).json();if(h.dataFile===dir+'/lucky-luxe.sqlite')break}catch{}await new Promise(r=>setTimeout(r,100))}
 const health=await(await fetch(base+'/health')).json();assert.equal(health.dataFile,dir+'/lucky-luxe.sqlite');assert.equal(server.exitCode,null);db=new DatabaseSync(health.dataFile)
 for(const id of ['gift-shop','gift-off'])await ok('/platform/tenants',{id,name:id,plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'})
 const tech=(await ok('/admin/technicians',{name:'赠送测试技师',isActive:true})).technician
 const cat=(await ok('/admin/pricing/categories')).categories[0]
 const svc=(await ok('/admin/pricing/items',{nameZh:'美甲',type:'NAIL',categoryId:cat.id,itemKind:'main',listPriceCents:40000,memberPriceCents:36000})).item
 const addon=(await ok('/admin/pricing/items',{nameZh:'加项',type:'NAIL',categoryId:cat.id,itemKind:'addon',listPriceCents:10000,memberPriceCents:9000,addonScope:[cat.id]})).item
 const customer=await loginCustomerViaFrontDoor({base,tenantId:'gift-shop',openid:'gift-http-customer',phone:'13800001901',displayName:'赠送测试顾客'});assert.ok(customer.ok,JSON.stringify(customer.body));const uid=customer.user.id
 const staff=await loginStaffViaFrontDoor({base,tenantId:'gift-shop',ownerToken:owner,technicianId:tech.id});assert.ok(staff.ok)
 await ok('/admin/member-pricing/config',{expectedRevision:0,active:true,displayTypes:['list'],settlementTypes:['list','member']},'PUT')
 const coupon=(await ok('/admin/coupons',{name:'好友同行八五折',discountType:'percent',percentOff:15,minSpendCents:0,validDays:30,recipientMode:'friend_original',scopeCategoryIds:[]})).coupon
 const items=[{kind:'physical',name:'护理油',quantity:3,unitValueCents:null},{kind:'coupon',name:'同行八五折',quantity:1,couponId:coupon.id,unitValueCents:null},{kind:'service_voucher',name:'美甲兑换',quantity:1,serviceId:svc.id,unitValueCents:0},{kind:'service_timecard',name:'美甲三次',quantity:3,serviceId:svc.id,unitValueCents:null}]
 const pkg=(await ok('/admin/packages',{kind:'recharge',name:'千元礼遇',priceCents:100000,bonusCents:18800,giftItems:items,defaultPersonalDiscount:{expectedRevision:0,rateBps:9000}})).package
 check('套餐四类赠品与空价值往返保存',()=>{assert.equal(pkg.giftItems[0].unitValueCents,null);assert.equal(pkg.giftItems[2].unitValueCents,0);assert.equal(pkg.giftItems.length,4)})
 const projected=pkg.giftItems.map(g=>({name:g.name,quantity:g.quantity,unitValueCents:g.unitValueCents??0}))
 const preserved=(await ok('/admin/packages/'+pkg.id,{name:'千元礼遇兼容',giftItems:projected,expectedConfigRevision:pkg.configRevision},'PATCH')).package
 check('旧版只改套餐名称，分类、空价值和服务关联完整保留',()=>assert.deepEqual(preserved.giftItems,pkg.giftItems))
 const protectedSnapshot=db.prepare('SELECT * FROM membership_packages WHERE id=?').get(pkg.id)
 for(const changed of [[],projected.map((g,i)=>i?g:{...g,quantity:2})]){
  const denied=await req('/admin/packages/'+pkg.id,{name:'不可保存',giftItems:changed},'PATCH')
  assert.equal(denied.status,409);assert.equal(denied.data.error.code,'GIFT_EDITOR_UPGRADE_REQUIRED')
  assert.deepEqual(db.prepare('SELECT * FROM membership_packages WHERE id=?').get(pkg.id),protectedSnapshot)
 }
 check('旧版删改分类赠品被明确阻止，整份套餐保持原样',()=>assert.equal(protectedSnapshot.name,'千元礼遇兼容'))
 const clearPkg=(await ok('/admin/packages',{kind:'recharge',name:'清空兼容测试',priceCents:1000,giftItems:items})).package
 const cleared=(await ok('/admin/packages/'+clearPkg.id,{giftItems:[],giftSchemaVersion:1},'PATCH')).package
 check('新版明确清空赠品可以保存',()=>assert.equal(cleared.giftItems.length,0))
 const giftPath='/admin/customers/'+uid+'/gift-entitlements',initial=await ok(giftPath);assert.equal(initial.gifts.length,0)
 const foreign=await req(giftPath,undefined,'GET',owner,'gift-off');check('外店不能读取赠送权益',()=>assert.equal(foreign.status,404))
 assert.equal((await req(giftPath,undefined,'GET',staff.accessToken)).status,403)
 const input={userId:uid,settlements:[{beneficiaryKey:'self',items:[{serviceId:svc.id}],tierKey:'member',technicians:[{technicianId:tech.id}],rechargePackageId:pkg.id,personalRateBps:9000,giftDraftKey:'draft-one'},{beneficiaryKey:'friend1',servedPersonName:'朋友',tierKey:'list',items:[{serviceId:svc.id},{serviceId:addon.id}],technicians:[{technicianId:tech.id}]}]}
 let preview=await ok('/admin/member-pricing/preview',input);const pending=preview.documents.find(p=>p.beneficiaryKey==='friend1').couponOptions.find(c=>c.pendingGift)
 check('随单充值预览有待发券，尚未实际发放',()=>{assert.ok(pending?.usable);assert.equal(db.prepare('SELECT COUNT(*) n FROM coupon_grants WHERE user_id=?').get(uid).n,0)})
 input.settlements[1].couponGrantId=pending.grantId
 preview=await ok('/admin/member-pricing/preview',input)
 check('卡主400九折360，朋友500八五折425，优惠独立',()=>{assert.equal(preview.documents[0].subtotalCents,36000);assert.equal(preview.documents[1].totalCents,42500);assert.equal(preview.totals.totalCents-100000,78500)})
 const wrong=structuredClone(input);wrong.settlements[1].tierKey='member'
 const wrongResult=await req('/admin/member-pricing/preview',wrong);check('朋友会员价不能叠加同行券',()=>assert.equal(wrongResult.data.error.code,'COUPON_UNUSABLE'))
 const self=structuredClone(input);self.settlements[1].couponGrantId='';self.settlements[0].couponGrantId=pending.grantId;assert.equal((await req('/admin/member-pricing/preview',self)).data.error.code,'COUPON_UNUSABLE')
 const made=await ok('/admin/member-pricing/documents',{...input,operationId:'gift-docs-1'});const first=made.documents.find(d=>d.beneficiaryKey==='self'),friend=made.documents.find(d=>d.beneficiaryKey==='friend1')
 const link=async d=>ok('/admin/member-pricing/documents/'+d.id+'/sign-link',{})
 const l1=await link(first),l2=await link(friend)
 const sign=(d,l)=>req('/member-documents/'+d.id+'/sign',{signature:'gift-test-only',strokes:[[{x:1,y:1},{x:20,y:20}]],signerConfirmed:true,disclaimerAccepted:true,confirmationHash:d.confirmationHash},'POST',null,'gift-shop',{'x-document-token':l.token})
 assert.equal((await sign(friend,l2)).data.error.code,'RECHARGE_DOCUMENT_FIRST')
 let signed=await sign(first,l1);assert.equal(signed.status,200,JSON.stringify(signed))
 check('卡主签署后真实发放一次，朋友方可签署',()=>{assert.equal(db.prepare('SELECT COUNT(*) n FROM recharge_gift_grants WHERE user_id=?').get(uid).n,4);assert.equal(db.prepare('SELECT status FROM coupon_grants WHERE id=?').get(pending.grantId).status,'active')})
 signed=await sign(friend,l2);assert.equal(signed.status,200,JSON.stringify(signed));assert.equal((await sign(friend,l2)).data.duplicate,true)
 check('朋友签署核销同行券且余额与合计一致',()=>{assert.equal(db.prepare('SELECT status FROM coupon_grants WHERE id=?').get(pending.grantId).status,'used');assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM stored_value_transactions WHERE user_id=?').get(uid).n,40300)})
 const grants=(await ok(giftPath)).gifts,physical=grants.find(g=>g.kind==='physical'),voucher=grants.find(g=>g.kind==='service_voucher')
 const staffRead=await ok(giftPath,undefined,'GET',staff.accessToken);assert.equal(staffRead.gifts[0].sourceTxnId,undefined);assert.equal(staffRead.gifts[0].unitValueCents,undefined)
 const claimBody={quantity:1,requestId:'claim-one'};let claim=await ok(giftPath+'/'+physical.id+'/claim',claimBody,'POST',staff.accessToken)
 assert.equal((await req(giftPath+'/'+physical.id+'/return',{quantity:1,requestId:'staff-return',reason:'测试',claimId:claim.eventId},'POST',staff.accessToken)).status,403)
 assert.equal(claim.remaining,2);assert.equal((await ok(giftPath+'/'+physical.id+'/claim',claimBody,'POST',staff.accessToken)).duplicate,true)
 const concurrent=await Promise.all(['a','b'].map(id=>req(giftPath+'/'+physical.id+'/claim',{quantity:2,requestId:'concurrent-'+id})))
 check('并发领两次只成功一次，不超领',()=>{assert.equal(concurrent.filter(r=>r.status===200).length,1);assert.equal((concurrent.find(r=>r.status!==200)).data.error.code,'GIFT_INSUFFICIENT')})
 let pack=await ok('/my/card-pack',undefined,'GET',customer.accessToken);assert.equal(pack.cardPack.giftEntitlements[0].remaining,0)
 assert.equal(pack.cardPack.giftEntitlements[0].events[0].actor,undefined)
 const customerClaim=await req(giftPath+'/'+physical.id+'/claim',{quantity:1,requestId:'customer-claim'},'POST',customer.accessToken);check('顾客卡包与商家剩余同步，顾客没有领取写权限',()=>assert.equal(customerClaim.status,401))
 const oldSnapshot=db.prepare('SELECT signed_json FROM member_service_documents WHERE id=?').get(friend.id).signed_json
 const tcInput={userId:uid,operationId:'voucher-doc',items:[],tierKey:'list',timecardId:voucher.timecardId,timecardServiceId:svc.id,technicians:[{technicianId:tech.id}]}
 const tc=await ok('/admin/member-pricing/documents',tcInput),tcl=await link(tc.documents[0]);signed=await sign(tc.documents[0],tcl);assert.equal(signed.status,200,JSON.stringify(signed))
 check('服务兑换券只在签署时扣次且不增加收入',()=>{assert.equal(db.prepare('SELECT used_times FROM member_timecards WHERE id=?').get(voucher.timecardId).used_times,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_transactions WHERE tags=?").get(tc.documents[0].components[0].code).n,0)})
 const review=await ok('/admin/account-adjust/gift-review?userId='+uid),member=await ok('/admin/member-pricing/members/'+uid)
 const refund={userId:uid,amountCents:1000,reason:'测试退款并核对赠品',requestId:'gift-refund',operationId:'gift-refund',discountConfirmation:{rateBps:9000,expectedRevision:member.revision},giftReview:{reviewHash:review.reviewHash,items:review.items.map(g=>({id:g.id,action:'void',returnQuantity:g.kind==='physical'?1:0}))}}
 const missing=await req('/admin/stored-value/refund',{...refund,giftReview:undefined});assert.equal(missing.data.error.code,'GIFT_REVIEW_REQUIRED')
 const balanceBeforeRefund=db.prepare('SELECT SUM(amount_cents) n FROM stored_value_transactions WHERE user_id=?').get(uid).n
 const badReview=structuredClone(refund);badReview.giftReview.items[0].action='invalid'
 assert.equal((await req('/admin/stored-value/refund',badReview)).data.error.code,'GIFT_REVIEW_INCOMPLETE')
 assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM stored_value_transactions WHERE user_id=?').get(uid).n,balanceBeforeRefund)
 assert.equal((await ok('/admin/member-pricing/members/'+uid)).revision,member.revision)
 const rf=await ok('/admin/stored-value/refund',refund);assert.equal(rf.refundedCents,1000);assert.equal((await ok('/admin/stored-value/refund',refund)).duplicate,true)
 check('退款权益确认与金额原子提交，实物退一件保留两件',()=>{const g=db.prepare('SELECT COUNT(*) n FROM recharge_gift_events WHERE grant_id=?').get(physical.id);assert.ok(g.n>=5);assert.equal(db.prepare('SELECT signed_json FROM member_service_documents WHERE id=?').get(friend.id).signed_json,oldSnapshot)})
 const after=(await ok(giftPath)).gifts;assert.equal(after.find(g=>g.id===physical.id).claimed,2);assert.equal(after.find(g=>g.kind==='service_timecard').remaining,0);assert.ok(after.find(g=>g.kind==='service_voucher').records.some(r=>r.label==='服务单签署核销'));assert.ok(after.find(g=>g.kind==='coupon').records.some(r=>r.label==='优惠券核销'))
 pack=await ok('/my/card-pack',undefined,'GET',customer.accessToken)
 check('顾客历史保留已用券与用尽服务，不重复计入可用角标、不泄露内部备注',()=>{
  const h=pack.cardPack.giftHistory
  assert.equal(h.find(g=>g.kind==='service_voucher').used,1)
  assert.ok(h.find(g=>g.kind==='service_voucher').records.length)
  assert.equal(h.find(g=>g.kind==='service_timecard').voided,3)
  assert.equal(h.find(g=>g.kind==='coupon').used,1)
  assert.ok(h.find(g=>g.kind==='coupon').records.length)
  assert.equal(pack.cardPack.badgeCount,0)
  const event=pack.cardPack.giftEntitlements[0].events[0]
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(event.createdAt));const part=t=>fmt.find(p=>p.type===t).value
  assert.equal(event.createdText,part('year')+'-'+part('month')+'-'+part('day')+' '+part('hour')+':'+part('minute'))
  assert.equal(pack.cardPack.emptyText,'')
  assert.ok([...h,...pack.cardPack.giftEntitlements].every(g=>g.sourceTxnId===undefined&&g.unitValueCents===undefined&&g.events.every(e=>e.actor===undefined&&e.reason===undefined)))
 })
 const immutable=await req('/admin/coupons/'+grants.find(g=>g.kind==='coupon').id+'_template',{name:'篡改'},'PATCH');assert.equal(immutable.data.error.code,'GIFT_TEMPLATE_IMMUTABLE')
 check('已用单据、原券快照不受退款或改模板影响',()=>{assert.equal(db.prepare('SELECT status FROM coupon_grants WHERE id=?').get(pending.grantId).status,'used');assert.equal(db.prepare('SELECT signed_json FROM member_service_documents WHERE id=?').get(friend.id).signed_json,oldSnapshot)})
 writeFileSync(dir+'/fixture.json',JSON.stringify({uid,pkgId:pkg.id,couponId:coupon.id,serviceId:svc.id,addonId:addon.id,techId:tech.id,first,friend,customer}))
 console.log(n+' HTTP journeys passed; evidence '+dir)
}catch(e){console.error(e);console.error(readFileSync(dir+'/server.log','utf8').slice(-2500));process.exitCode=1}finally{db?.close();server.kill('SIGTERM');closeSync(fd)}
