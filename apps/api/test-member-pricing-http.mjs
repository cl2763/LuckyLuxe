import {ensurePricingCategory} from './pricing-category-fixture.mjs'
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

const financeKeys = new Map()
async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const fk = token ? financeKeys.get(token) : null
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(fk ? { 'x-finance-key': fk } : {}),
      ...extraHeaders,
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

/* 分类唯一真相律(店主 2026-08-25):建店即落平台三大类(美甲/美睫/护理·其他),
   所以夹具再建同 key 的大类会撞 409 —— 改成「有就用,没有才建」。判据跟着口径走。 */
async function ensureCategory(token,body){return ensurePricingCategory({base:BASE_URL,platformToken:PLATFORM,merchantToken:token,body})}

async function newShop(label) {
  const id = `p1s-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `结算店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  const unlock = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) financeKeys.set(token, unlock.data.financeKey)
  return { tenantId: id, token }
}

import assert from 'node:assert/strict'
import {createAndLoginCustomerViaFrontDoor,loginStaffViaFrontDoor} from './customer-login-fixture.mjs'
const shop=await newShop('personal'),other=await newShop('outside')
const call=(path,body,method='POST',token=shop.token)=>request(path,{method,body:JSON.stringify(body)},token)
const ok=async(p,b,m='POST')=>{const r=await call(p,b,m);assert.ok(r.status<300,`${p}: ${JSON.stringify(r.data)}`);return r.data}
const cat=await ensureCategory(shop.token,{key:'nail',name:'美甲'})
const svc=(await ok('/admin/pricing/items',{nameZh:'个人折扣测试项目',type:'NAIL',categoryId:cat.id,itemKind:'main',listPriceCents:10001,memberPriceCents:9000})).item
const addon=(await ok('/admin/pricing/items',{nameZh:'收费加项',type:'NAIL',categoryId:cat.id,itemKind:'addon',listPriceCents:101,memberPriceCents:91,addonScope:[cat.id]})).item
const tech=(await ok('/admin/technicians',{name:`折扣测试技师${RUN_ID}`,isActive:true})).technician
const cust=await createAndLoginCustomerViaFrontDoor({base:BASE_URL,tenantId:shop.tenantId,ownerToken:shop.token,name:'折扣测试顾客',phone:`139${String(Date.now()).slice(-8)}`,serviceId:svc.id,technicianId:tech.id})
const uid=cust.userId||cust.body?.user?.id
assert.ok(uid,"fixture customer creation")
const staff=await loginStaffViaFrontDoor({base:BASE_URL,tenantId:shop.tenantId,ownerToken:shop.token,technicianId:tech.id})
assert.ok(staff.accessToken)
await ok('/admin/member-pricing/config',{expectedRevision:0,active:true,displayTypes:['list'],settlementTypes:['list','member']},'PUT')
let input={userId:uid,items:[{serviceId:svc.id}],tierKey:'member'}
assert.equal((await call('/admin/member-pricing/preview',input)).data.error.code,'MEMBER_REQUIRED')
assert.equal((await call(`/admin/member-pricing/members/${uid}`,{rateBps:8000,reason:'越权',operationId:'forbidden',expectedRevision:0},'PUT',staff.accessToken)).status,403)
assert.equal((await request(`/admin/member-pricing/members/${uid}`,{},other.token)).status,404)
const recharge={userId:uid,amountCents:100000,payChannel:'cash',operationId:`recharge-${RUN_ID}`,discountConfirmation:{rateBps:8500,expectedRevision:0}}
assert.equal((await call('/admin/stored-value/recharge',{userId:uid,amountCents:100000})).data.error.code,'OPERATION_ID_REQUIRED')
let r=await call('/admin/stored-value/recharge',recharge,'POST',staff.accessToken)
assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.discountReceipt.after.rateBps,8500)
assert.equal(r.data.balanceCents,100000)
assert.equal(r.data.discountReceipt.suggestedRateBps,null)
assert.equal(r.data.discountReceipt.suggestionSource,'store-default')
assert.equal((await call('/admin/stored-value/recharge',recharge,'POST',staff.accessToken)).data.duplicate,true)
assert.equal((await call('/admin/stored-value/recharge',{...recharge,amountCents:200000},'POST',staff.accessToken)).data.error.code,'IDEMPOTENCY_CONFLICT')
await ok('/admin/pricing/rules',{rules:{foot_surcharge:{isActive:true,config:{amountCents:1000}},tip_reuse:{isActive:true,config:{amountCents:101}}}},'PUT')
const draft={...input,items:[{serviceId:svc.id},{serviceId:addon.id}],customItems:[{name:'手填服务费',amountCents:101}],applyFootSurcharge:true,applyTipReuse:true}
let preview=await ok('/admin/member-pricing/preview',draft)
assert.equal(preview.totals.listTotalCents,11304)
assert.equal(preview.totals.subtotalCents,9608)
assert.equal(preview.components[0].lines.reduce((n,l)=>n+l.amountCents,0),9608)
assert.equal(preview.components[0].personalPricing,undefined)
assert.equal(preview.documents.length,1)
// Public and settlement originals really are independent.
await ok(`/admin/member-pricing/services/${svc.id}/display`,{expectedRevision:0,prices:{list:{priceCents:30000}}},'PUT')
assert.equal((await ok('/admin/member-pricing/preview',input)).totals.subtotalCents,8501)
await ok(`/admin/member-pricing/services/${svc.id}/settlement`,{expectedRevision:1,prices:{list:{priceCents:20000},member:{priceCents:19000}}},'PUT')
assert.equal((await ok('/admin/member-pricing/preview',input)).totals.subtotalCents,17000)
// Pending inline recharge changes only this preview; another draft still uses 8.5折.
const inline=await ok('/admin/member-pricing/preview',{...input,rechargeAmountCents:10000,personalRateBps:8000})
assert.equal(inline.totals.subtotalCents,16000);assert.equal(inline.personalDiscount.pendingRecharge,true)
assert.equal((await ok('/admin/member-pricing/preview',input)).totals.subtotalCents,17000)
assert.equal((await request(`/admin/member-pricing/members/${uid}`,{},shop.token)).data.balanceCents,100000)
assert.equal((await call('/admin/member-pricing/preview',{...input,personalRateBps:8000})).data.error.code,'RECHARGE_REQUIRED')
assert.equal((await call('/admin/member-pricing/preview',{...input,rechargeAmountCents:10000,personalRateBps:8550})).data.error.code,'INVALID_PRICING_VALUE')
// A single person's rounding is over all charged services, not per project group.
await ok(`/admin/member-pricing/services/${svc.id}/settlement`,{expectedRevision:2,prices:{list:{priceCents:1}}},'PUT')
const multi={userId:uid,settlements:[{items:[{serviceId:svc.id}]},{items:[{serviceId:svc.id}]},{items:[{serviceId:svc.id}]},{items:[{serviceId:svc.id}]}]}
preview=await ok('/admin/member-pricing/preview',multi)
assert.equal(preview.totals.subtotalCents,3);assert.equal(preview.documents.length,1)
const proxy=await ok('/admin/member-pricing/preview',{...multi,settlements:[...multi.settlements,{items:[{serviceId:svc.id}],beneficiaryKey:'friend1',servedPersonName:'朋友'}]})
assert.equal(proxy.documents.length,2)
assert.equal((await call('/admin/member-pricing/preview',{...input,servedPersonName:'朋友'})).data.error.code,'BENEFICIARY_REQUIRED')
// Owner refund must explicitly reconfirm; cannot silently keep the old rate.
assert.equal((await call('/admin/stored-value/refund',{userId:uid,amountCents:1000,reason:'测试退充值',requestId:'refund-missing'})).data.error.code,'DISCOUNT_CONFIRMATION_REQUIRED')
const refund={userId:uid,amountCents:1000,reason:'测试退充值',requestId:`refund-${RUN_ID}`,discountConfirmation:{rateBps:10000,expectedRevision:1}}
r=await ok('/admin/stored-value/refund',refund)
assert.equal(r.discountReceipt.after.rateBps,10000);assert.equal(r.discountReceipt.after.balanceCents,99000)
assert.equal((await ok('/admin/stored-value/refund',refund)).duplicate,true)
assert.equal((await ok('/admin/member-pricing/preview',input)).totals.subtotalCents,1)
const history=(await request(`/admin/member-pricing/members/${uid}/history`,{},shop.token)).data.events
assert.equal(history.length,2);assert.equal(history[0].source,'refund');assert.equal(history[1].source,'recharge')
console.log('ok 1 - member pricing HTTP: defaults, permissions, all service charges, independent systems, draft-only recharge, 0.1折 validation, per-person rounding, duplicate requests, refund reconfirmation')
const wheel=(await request('/admin/member-pricing/discount-input',{},shop.token)).data
assert.equal(wheel.options[0].label,'无折扣');assert.equal(wheel.options[15].label,'8.5折')
const pair1=await ok('/admin/stored-value/recharge',{userId:uid,amountCents:1000,bonusCents:100,operationId:`pair1-${RUN_ID}`,discountConfirmation:{rateBps:10000,expectedRevision:2}})
await ok('/admin/stored-value/recharge',{userId:uid,amountCents:2000,bonusCents:200,operationId:`pair2-${RUN_ID}`,discountConfirmation:{rateBps:10000,expectedRevision:3}})
const reversalBody={operationId:`reverse-${RUN_ID}`,reason:'纠正第一笔测试充值',discountConfirmation:{rateBps:8500,expectedRevision:4}}
const reversed=await ok(`/admin/stored-value/txns/${pair1.rechargeTxnId}/reverse`,reversalBody)
assert.equal(reversed.reversedBonusCents,100)
assert.equal(reversed.discountReceipt.after.balanceCents,101200)
assert.equal(reversed.discountReceipt.after.rateBps,8500)
assert.equal((await ok(`/admin/stored-value/txns/${pair1.rechargeTxnId}/reverse`,reversalBody)).duplicate,true)
console.log('ok 2 - wheel contract and exact recharge/bonus reversal linkage with discount reconfirmation')
// One person signs all their services once; friends have a separate document.
await ok(`/admin/member-pricing/services/${svc.id}/settlement`,{expectedRevision:3,prices:{list:{priceCents:20000},member:{priceCents:19000}}},'PUT')
const docsInput={operationId:`docs-${RUN_ID}`,userId:uid,settlements:[
  {beneficiaryKey:'friend1',servedPersonName:'朋友',items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id}]},
  {items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id}]},
  {items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id}],rechargeAmountCents:10000,personalRateBps:7000}
]}
const made=await ok('/admin/member-pricing/documents',docsInput)
assert.equal(made.documents.length,2)
const primary=made.documents.find(d=>d.beneficiaryKey==='self'),friend=made.documents.find(d=>d.beneficiaryKey==='friend1')
assert.equal(primary.components.length,2);assert.equal(friend.dependencyId,primary.id)
assert.equal(primary.expiresAt,null)
assert.equal(primary.quote.subtotalCents,28000);assert.equal(friend.quote.subtotalCents,14000)
assert.equal((await ok('/admin/member-pricing/documents',docsInput)).duplicate,true)
const pLink=await ok(`/admin/member-pricing/documents/${primary.id}/sign-link`,{}),fLink=await ok(`/admin/member-pricing/documents/${friend.id}/sign-link`,{})
const signingBody=d=>({signature:'synthetic-customer',strokes:[[{x:1,y:1},{x:20,y:20}]],signerConfirmed:true,disclaimerAccepted:true,confirmationHash:d.confirmationHash})
const docSign=(d,link)=>request(`/member-documents/${d.id}/sign`,{method:'POST',body:JSON.stringify(signingBody(d))},null,{'x-document-token':link.token})
assert.equal((await docSign(friend,fLink)).data.error.code,'RECHARGE_DOCUMENT_FIRST')
assert.equal((await docSign(friend,pLink)).data.error.code,'DOCUMENT_TOKEN_MISMATCH')
assert.equal((await request(`/member-documents/${primary.id}`,{},null)).status,401)
assert.equal((await request(`/admin/member-pricing/documents/${primary.id}`,{},other.token)).status,404)
assert.equal((await call(`/settlements/${primary.components[0].code}/sign`,{signature:'x',disclaimerAccepted:true})).data.error.code,'PERSON_DOCUMENT_REQUIRED')
assert.equal((await call(`/admin/settlements/${primary.components[0].id}/void`,{})).data.error.code,'PERSON_DOCUMENT_REQUIRED')
assert.equal((await request(`/admin/member-pricing/members/${uid}`,{},shop.token)).data.balanceCents,101200)
let signed=await docSign(primary,pLink)
assert.equal(signed.status,200,JSON.stringify(signed.data))
assert.equal(signed.data.signed.balanceAfterCents,83200)
assert.equal(primary.quote.display.paymentRows.find(r=>r.label==='本单扣款后余额（预计）').value,signed.data.signed.balanceAfterText)
assert.equal(signed.data.signed.discountAfter.rateBps,7000)
assert.equal(signed.data.signed.components.length,2)
assert.ok(signed.data.components.every(c=>c.status==='signed'))
assert.equal((await docSign(primary,pLink)).data.duplicate,true)
signed=await docSign(friend,fLink)
assert.equal(signed.status,200,JSON.stringify(signed.data));assert.equal(signed.data.signed.balanceAfterCents,69200)
assert.equal(friend.quote.display.paymentRows.find(r=>r.label==='本单扣款后余额（预计）').value,signed.data.signed.balanceAfterText)
assert.ok(signed.data.signedAtText.includes('America/Toronto'))
const snap=await request(`/member-documents/${friend.id}/snapshot`,{},null,{'x-document-token':fLink.token})
assert.equal(snap.data.confirmationHash,friend.confirmationHash)
assert.equal(snap.data.personalDiscount.effectiveRateBps,7000)
// Cancelling the primary cancels unsigned dependent documents, without charging anything.
const cancelled=await ok('/admin/member-pricing/documents',{...docsInput,operationId:`cancel-${RUN_ID}`})
await ok(`/admin/member-pricing/documents/${cancelled.documents[0].id}/void`,{reason:'测试撤回'})
assert.equal((await request(`/admin/member-pricing/documents/${cancelled.documents[1].id}`,{},shop.token)).data.status,'voided')
assert.equal((await request(`/admin/member-pricing/members/${uid}`,{},shop.token)).data.balanceCents,69200)
// Owner changes after the quote cannot silently change signed prices or revive stale pending quotes.
const stale=await ok('/admin/member-pricing/documents',{operationId:`stale-${RUN_ID}`,userId:uid,items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id}]})
const staleLink=await ok(`/admin/member-pricing/documents/${stale.documents[0].id}/sign-link`,{})
await ok(`/admin/member-pricing/members/${uid}`,{expectedRevision:6,rateBps:8000,reason:'独立修改测试',operationId:`owner-${RUN_ID}`},'PUT')
assert.equal((await docSign(stale.documents[0],staleLink)).data.error.code,'PRICING_CHANGED')
assert.equal((await request(`/member-documents/${friend.id}/snapshot`,{},null,{'x-document-token':fLink.token})).data.personalDiscount.effectiveRateBps,7000)
console.log('ok 3 - person documents: one signature per person, inline recharge commits once, ordered shared-card signing, authorization, immutable historical quote, stale drafts and cancellation')
// Public catalog and private rights have separate values and endpoints.
const catalog=await request('/services',{},null,{'x-tenant-id':shop.tenantId})
const publicService=catalog.data.services?.find(s=>s.id===svc.id)
assert.ok(publicService,JSON.stringify(catalog.data).slice(0,180))
assert.equal(publicService.priceCents,30000)
assert.equal(publicService.startingPriceCents,30000)
assert.deepEqual(Object.keys(publicService.displayPricing),['list'])
assert.equal(publicService.referenceOnly,true)
assert.equal((await request('/my/member-pricing',{},cust.accessToken)).data.rateBps,8000)
const requoteBody={operationId:`requote-${RUN_ID}`,items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id}],reason:'老板调整后重新确认'}
const requoted=await ok(`/admin/member-pricing/documents/${stale.documents[0].id}/requote`,requoteBody)
assert.equal((await ok(`/admin/member-pricing/documents/${stale.documents[0].id}/requote`,requoteBody)).duplicate,true)
assert.equal((await call(`/admin/member-pricing/documents/${stale.documents[0].id}/requote`,{...requoteBody,reason:'更改了内容'})).data.error.code,'IDEMPOTENCY_CONFLICT')
assert.equal(requoted.documents[0].quote.subtotalCents,16000)
assert.equal(requoted.documents[0].quote.replacesDocumentId,stale.documents[0].id)
assert.equal((await request(`/admin/member-pricing/documents/${stale.documents[0].id}`,{},shop.token)).data.status,'voided')
await ok(`/admin/member-pricing/documents/${requoted.documents[0].id}/void`,{reason:'测试清理待签单'})
// One coupon qualifies on the combined person document and is allocated across components.
const grant=await ok('/admin/coupon-grants/custom',{userId:uid,amountCents:30000,minSpendCents:30000,validDays:30,name:'跨项目券',reason:'测试合单叠加'})
const couponPreview=await ok('/admin/member-pricing/preview',{userId:uid,settlements:[{items:[{serviceId:svc.id}],couponGrantId:grant.granted.id},{items:[{serviceId:svc.id}]}]})
const offeredCoupon=couponPreview.documents[0].couponOptions.find(o=>o.grantId===grant.granted.id)
assert.ok(offeredCoupon?.usable);assert.ok(offeredCoupon.deductText);assert.equal(offeredCoupon.deductText,offeredCoupon.discountText)
const couponDoc=(await ok('/admin/member-pricing/documents',{operationId:`coupon-${RUN_ID}`,userId:uid,settlements:[
  {items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id}],couponGrantId:grant.granted.id},
  {items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id}]}
]})).documents[0]
assert.equal(couponDoc.quote.subtotalCents,32000)
assert.equal(couponDoc.quote.couponDiscountCents,30000)
assert.equal(couponDoc.quote.totalCents,2000)
assert.equal(couponDoc.quote.components[1].couponDiscountCents,14000)
const cLink=await ok(`/admin/member-pricing/documents/${couponDoc.id}/sign-link`,{})
assert.equal((await docSign(couponDoc,cLink)).status,200)
const couponStats=(await request('/admin/finance/coupon-discounts',{},shop.token)).data.couponDiscounts
assert.equal(couponStats.totalCents,30000);assert.equal(couponStats.customCents,30000);assert.equal(couponStats.count,1)
assert.equal((await request(`/admin/member-pricing/members/${uid}`,{},shop.token)).data.balanceCents,67200)
// A failure in the second component must undo the first component's recharge AND consumption.
const times=(await ok('/admin/packages',{kind:'times',name:'原子签署测试卡',priceCents:10000,timesCount:2,isActive:true})).package
const purchased=(await ok('/admin/member-pricing/documents',{operationId:`buy-${RUN_ID}`,userId:uid,purchasePackageId:times.id,timecardServiceId:svc.id,technicians:[{technicianId:tech.id}]})).documents[0]
const buyLink=await ok(`/admin/member-pricing/documents/${purchased.id}/sign-link`,{})
assert.equal((await docSign(purchased,buyLink)).status,200)
const {DatabaseSync}=await import('node:sqlite')
assert.ok(process.env.TEST_DB_PATH,'isolated test DB is required')
const rdb=new DatabaseSync(process.env.TEST_DB_PATH,{readOnly:true})
const timecard=rdb.prepare('SELECT * FROM member_timecards WHERE source_settlement_id=?').get(purchased.components[0].id)
assert.ok(timecard)
const cardItem={timecardId:timecard.id,timecardServiceId:svc.id,technicians:[{technicianId:tech.id}]}
const failing=(await ok('/admin/member-pricing/documents',{operationId:`atomic-${RUN_ID}`,userId:uid,settlements:[{items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id}],rechargeAmountCents:10000,personalRateBps:7500},cardItem]})).documents[0]
const race=(await ok('/admin/member-pricing/documents',{operationId:`race-${RUN_ID}`,userId:uid,...cardItem})).documents[0]
const raceLink=await ok(`/admin/member-pricing/documents/${race.id}/sign-link`,{})
assert.equal((await docSign(race,raceLink)).status,200)
const failLink=await ok(`/admin/member-pricing/documents/${failing.id}/sign-link`,{})
const countBefore=rdb.prepare('SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id=? AND user_id=?').get(shop.tenantId,uid).n
const failed=await docSign(failing,failLink)
assert.equal(failed.data.error.code,'TIMECARD_RACE',JSON.stringify(failed.data))
assert.equal(rdb.prepare('SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id=? AND user_id=?').get(shop.tenantId,uid).n,countBefore)
const afterFailure=(await request(`/admin/member-pricing/members/${uid}`,{},shop.token)).data
assert.equal(afterFailure.balanceCents,67200);assert.equal(afterFailure.rateBps,8000)
assert.ok((await request(`/admin/member-pricing/documents/${failing.id}`,{},shop.token)).data.components.every(c=>c.status==='pending_sign'))
const originalCodes=made.documents.flatMap(d=>d.components.map(c=>c.code))
const serviceIncome=rdb.prepare(`SELECT SUM(amount_cents) n FROM finance_transactions WHERE tenant_id=? AND tags IN (${originalCodes.map(()=>'?').join(',')})`).get(shop.tenantId,...originalCodes).n
assert.equal(serviceIncome,42000,'inline recharge cash must never be service revenue')

console.log('ok 4 - public/private price separation, requote, aggregated coupon accounting, timecard concurrency and all-or-nothing multi-component signing')
// Coupon scope cannot leak across project categories when services are merged.
const lashCat=await ensureCategory(shop.token,{key:'lash_scope',name:'美睫范围测试'})
const lashSvc=(await ok('/admin/pricing/items',{nameZh:'范围外美睫',type:'LASH',categoryId:lashCat.id,itemKind:'main',listPriceCents:25000,memberPriceCents:24000})).item
const scopeCoupon=await ok('/admin/coupon-grants/custom',{userId:uid,amountCents:30000,minSpendCents:10000,scopeCategoryIds:[cat.id],reason:'范围测试',name:'仅美甲券'})
const mixed={userId:uid,settlements:[{items:[{serviceId:svc.id}],couponGrantId:scopeCoupon.granted.id},{items:[{serviceId:lashSvc.id}]}]}
const scoped=await ok('/admin/member-pricing/preview',mixed)
assert.equal(scoped.totals.subtotalCents,36000)
assert.equal(scoped.totals.couponDiscountCents,16000)
assert.equal(scoped.components[1].couponDiscountCents,0)
const minCoupon=await ok('/admin/coupon-grants/custom',{userId:uid,amountCents:30000,minSpendCents:20000,scopeCategoryIds:[cat.id],reason:'范围门槛测试',name:'仅美甲满200'})
assert.equal((await call('/admin/member-pricing/preview',{...mixed,settlements:[{...mixed.settlements[0],couponGrantId:minCoupon.granted.id},mixed.settlements[1]]})).data.error.code,'COUPON_UNUSABLE')
// Package amount/default discount save atomically; a stale revision rolls back the package edit.
const defaultPackage=(await ok('/admin/packages',{kind:'recharge',name:'默认七五折套餐',priceCents:10000,bonusCents:1000,defaultPersonalDiscount:{expectedRevision:0,rateBps:7500}})).package
assert.equal(defaultPackage.defaultPersonalDiscount.rateBps,7500)
const defaultPreview=await ok('/admin/member-pricing/preview',{userId:uid,items:[{serviceId:svc.id}],rechargePackageId:defaultPackage.id})
assert.equal(defaultPreview.personalDiscount.proposedRateBps,7500)
assert.equal(defaultPreview.components[0].recharge.bonusCents,1000)
assert.equal((await call(`/admin/packages/${defaultPackage.id}`,{priceCents:20000,defaultPersonalDiscount:{expectedRevision:0,rateBps:8000}},'PATCH')).data.error.code,'PRICING_CHANGED')
assert.equal((await request('/admin/recharge-packages',{},shop.token)).data.packages.find(p=>p.id===defaultPackage.id).priceCents,10000)
const quotedSvc=(await ok('/admin/pricing/items',{nameZh:'需报价项目',type:'NAIL',categoryId:cat.id,itemKind:'main',priceMode:'quote',listPriceCents:0})).item
assert.equal((await call('/admin/member-pricing/preview',{userId:uid,items:[{serviceId:quotedSvc.id}]})).data.error.code,'QUOTED_PRICE_REQUIRED')
assert.equal((await ok('/admin/member-pricing/preview',{userId:uid,items:[{serviceId:quotedSvc.id,quotedListCents:10000}]})).totals.subtotalCents,8000)
assert.equal((await call('/admin/member-pricing/config',{expectedRevision:1,membershipEnabled:false,settlementTypes:['list']},'PUT')).status,403)
assert.equal((await call('/admin/member-pricing/documents',null)).status,400)
// Service corrections append history; the signed document's original values do not change.
const amendment=await ok(`/admin/member-pricing/documents/${friend.id}/amend`,{reason:'服务金额更正测试',components:[{id:friend.components[0].id,totalCents:13000}]})
assert.equal(amendment.signed.subtotalCents,14000)
assert.equal(amendment.components[0].actualDueCents,13000)
assert.equal((await call(`/admin/member-pricing/documents/${primary.id}/amend`,{reason:'不能当退充值',components:[{id:primary.components[0].id,totalCents:0}]})).data.error.code,'RECHARGE_REFUND_REQUIRED')
console.log('ok 6 - scoped coupons, package atomicity, explicit quoted originals, platform permissions and append-only service corrections')
// Both signing entry points authorize the entire visit, and actual delivery is idempotent.
const batchDraft=await ok('/admin/member-pricing/documents',{...docsInput,operationId:`batch-ui-${RUN_ID}`})
const batchLink=await ok(`/admin/member-pricing/groups/${batchDraft.groupId}/sign-link`,{})
assert.ok(batchLink.url.includes('#token=group_'))
const readBatch=await request(`/member-document-groups/${batchDraft.groupId}`,{},null,{'x-document-token':batchLink.token})
assert.equal(readBatch.status,200);assert.equal(readBatch.data.documents.length,2)
assert.equal((await request(`/member-document-groups/${made.groupId}`,{},null,{'x-document-token':batchLink.token})).status,403)
assert.equal((await call(`/admin/member-pricing/groups/${batchDraft.groupId}/sign-link`,{},'POST',other.token)).status,404)
const ownerCard=(await request('/admin/customers',{},shop.token)).data.customers.find(c=>c.id===uid);assert.equal(ownerCard.personalDiscount.rateBps,8000);
const staffCard=(await request('/admin/customers',{},staff.accessToken)).data.customers.find(c=>c.id===uid);assert.equal(staffCard.personalDiscount.discountText,'8.0折');assert.equal('balanceCents' in staffCard.personalDiscount,false);
const delivery=await ok(`/admin/member-pricing/groups/${batchDraft.groupId}/deliver`,{operationId:`delivery-${RUN_ID}`})
assert.equal(delivery.channel,'inapp')
assert.equal((await ok(`/admin/member-pricing/groups/${batchDraft.groupId}/deliver`,{operationId:`delivery-${RUN_ID}`})).messageId,delivery.messageId)
const inbox=(await request('/my/messages',{},cust.accessToken,{'x-tenant-id':shop.tenantId})).data
assert.equal(inbox.messages.filter(m=>m.memberDocumentGroupId===batchDraft.groupId).length,1)
const entry=(await request(`/my/settlements/${batchDraft.documents[0].components[0].code}/sign-link`,{method:'POST',body:'{}'},cust.accessToken)).data
assert.equal(entry.groupId,batchDraft.groupId)
const legacyComponent=batchDraft.documents[0].components[0]
const legacyLink=await ok(`/admin/settlements/${legacyComponent.id}/sign-token`,{})
assert.equal(legacyLink.settlement.id,legacyComponent.id)
assert.equal(legacyLink.settlement.groupTotal,2)
assert.equal(legacyLink.settlement.subtotalCents,batchDraft.documents[0].quote.subtotalCents)
assert.equal(legacyLink.customerBound,true)
assert.equal(legacyLink.state,'waiting')
// The released mini-program appends theme after the fragment. Token parsing
// must still work when opening the new shared signing page through that shell.
const legacyOpenedUrl=new URL(legacyLink.url+'&theme=light',BASE_URL)
assert.equal(new URLSearchParams(legacyOpenedUrl.hash.slice(1)).get('token'),legacyLink.token)
assert.equal((await request(`/member-document-groups/${batchDraft.groupId}`,{},null,{'x-document-token':legacyLink.token})).status,200)
assert.equal((await call(`/admin/settlements/${legacyComponent.id}/sign-token`,{},'POST',other.token)).status,404)
assert.equal((await request(`/admin/settlements/${legacyComponent.id}/sign-state`,{},other.token)).status,404)
assert.equal((await request(`/admin/settlements/${legacyComponent.id}/sign-state`,{},null)).status,401)
assert.equal((await request(`/admin/settlements/${legacyComponent.id}/sign-state`,{},shop.token)).data.state,'waiting')
const pending=(await request('/my/pending-sign',{},cust.accessToken,{'x-tenant-id':shop.tenantId})).data.pendingSign
assert.equal(pending.filter(p=>p.memberDocumentGroupId===batchDraft.groupId).length,1)
// Changing only display prices must not invalidate a service confirmation.
const beforeDisplay=(await request(`/admin/member-pricing/services/${svc.id}/display`,{},shop.token)).data
await ok(`/admin/services/${svc.id}`,{priceCents:45000,priceSystemUpdate:{system:'display',expectedRevision:beforeDisplay.revision,prices:{list:{priceCents:45000}}}},'PATCH')
assert.equal((await docSign(batchDraft.documents[0],batchLink)).status,200)
assert.equal((await request(`/admin/settlements/${legacyComponent.id}/sign-state`,{},shop.token)).data.state,'waiting','one signed person must not dismiss the entire visit')
assert.equal((await docSign(batchDraft.documents[1],batchLink)).status,200)
assert.equal((await request(`/admin/settlements/${legacyComponent.id}/sign-state`,{},shop.token)).data.state,'signed')
const beforeMetadata=(await request('/admin/pricing/items',{},shop.token)).data.items.find(i=>i.id===svc.id)
const failedMetadata=await call(`/admin/services/${svc.id}`,{nameZh:'不该落库',priceSystemUpdate:{system:'display',expectedRevision:beforeDisplay.revision,prices:{list:{priceCents:99000}}}},'PATCH')
assert.equal(failedMetadata.status,409)
assert.equal((await request('/admin/pricing/items',{},shop.token)).data.items.find(i=>i.id===svc.id).nameZh,beforeMetadata.nameZh)
const proof=(await request(`/member-documents/${batchDraft.documents[0].id}/snapshot`,{},null,{'x-document-token':batchLink.token})).data
assert.equal(proof.display.customerName,'折扣测试顾客');assert.ok(proof.balanceAfterText)
const docAmend=await ok(`/admin/member-pricing/documents/${batchDraft.documents[0].id}/amend`,{serviceTotalCents:27000,reason:'合单更正测试'})
assert.equal(docAmend.correction.serviceTotalCents,27000)
assert.equal(docAmend.signed.subtotalCents,28000)
console.log('ok 7 - batch authorization, real inbox delivery, legacy entry routing, display-only changes, atomic price edits and whole-document corrections')
export const uiFixture={shop,cust,svc,addon,tech,defaultPackage,batchDraft}

const refreshDraft=await ok('/admin/member-pricing/documents',{...docsInput,operationId:`refresh-draft-${RUN_ID}`})
const refreshLink=await ok(`/admin/member-pricing/groups/${refreshDraft.groupId}/sign-link`,{})
assert.equal((await docSign(refreshDraft.documents[0],refreshLink)).status,200)
const pendingDoc=refreshDraft.documents[1]
const review=(await request(`/admin/member-pricing/documents/${pendingDoc.id}/review`,{},shop.token)).data
assert.ok(review.reviewHash,JSON.stringify(review))
const refreshed=await ok(`/admin/member-pricing/documents/${pendingDoc.id}/refresh`,{reviewHash:review.reviewHash,operationId:`refresh-ui-${RUN_ID}`})
assert.equal(refreshed.documents.length,1)
assert.equal(refreshed.documents[0].beneficiaryKey,pendingDoc.beneficiaryKey)
assert.equal((await ok(`/admin/member-pricing/documents/${pendingDoc.id}/refresh`,{reviewHash:review.reviewHash,operationId:`refresh-ui-${RUN_ID}`})).duplicate,true)
assert.equal((await request(`/admin/member-pricing/documents/${batchDraft.documents[0].id}`,{},shop.token)).data.status,'signed')
console.log('ok 8 - current quote review updates only unsigned friend document; retry idempotent and signed owner preserved')

const reopened=(await request(`/member-document-groups/${refreshDraft.groupId}`,{},null,{'x-document-token':refreshLink.token})).data
assert.equal(reopened.documents.length,2)
assert.equal(reopened.documents.filter(d=>d.status==='signed').length,1)
assert.equal(reopened.documents.find(d=>d.status==='pending_sign').id,refreshed.documents[0].id)
assert.equal((await docSign(refreshed.documents[0],refreshLink)).status,200)
console.log('ok 9 - same invitation follows unsigned replacements and authorizes only its own descendant documents')

// Independent prices, lifecycle controls, and conflict-safe retry remain valid through the editor route.
await ok(`/admin/services/${svc.id}`,{storefront:false},'PATCH')
assert.equal((await request('/admin/pricing/items',{},shop.token)).data.items.find(x=>x.id===svc.id).storefront,false)
await ok(`/admin/services/${svc.id}`,{storefront:true},'PATCH')
assert.equal((await call(`/admin/member-pricing/documents/${pendingDoc.id}/refresh`,{reviewHash:'changed',operationId:`refresh-ui-${RUN_ID}`})).data.error.code,'IDEMPOTENCY_CONFLICT')
console.log('ok 10 - storefront control persists independently and refresh retry rejects changed confirmation')

const correctionPath=`/admin/member-pricing/documents/${friend.id}`
const counts=()=>['settlement_amendments','stored_value_transactions','finance_transactions','member_document_events'].map(t=>rdb.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n)
const beforePreview=counts(),beforePreviewBalance=(await request(`/admin/member-pricing/members/${uid}`,{},shop.token)).data.balanceCents
const correctionPreview=await ok(correctionPath+'/amend-preview',{serviceTotalCents:12000})
assert.equal(correctionPreview.amountDeltaCents,-1000);assert.equal(correctionPreview.autoBalanceAdjustCents,1000);assert.match(correctionPreview.balanceEffectText,/退回储值/)
assert.deepEqual(counts(),beforePreview)
assert.equal((await call(correctionPath+'/amend-preview',{serviceTotalCents:-1})).status,400)
assert.equal((await call(correctionPath+'/amend-preview',{serviceTotalCents:12000},'POST',staff.accessToken)).status,403)
assert.equal((await request(correctionPath+'/amend-preview',{method:'POST',body:JSON.stringify({serviceTotalCents:12000})},other.token)).status,404)
await ok(correctionPath+'/amend',{serviceTotalCents:12500,reason:'并发更正核验'})
assert.equal((await call(correctionPath+'/amend',{serviceTotalCents:12000,reason:'旧预览不得覆盖',reviewHash:correctionPreview.reviewHash})).data.error.code,'CORRECTION_CHANGED')
const nextPreview=await ok(correctionPath+'/amend-preview',{serviceTotalCents:12000})
assert.equal(nextPreview.autoBalanceAdjustCents,500)
await ok(correctionPath+'/amend',{serviceTotalCents:12000,reason:'经重新核对更正',reviewHash:nextPreview.reviewHash})
assert.equal((await request(`/admin/member-pricing/members/${uid}`,{},shop.token)).data.balanceCents,beforePreviewBalance+1000)
console.log('ok 11 - correction preview performs no writes; exact refund, owner/tenant guards and concurrent stale-review protection')
const day=(await request('/admin/store-clock',{},shop.token)).data.today
const daily=(await request('/admin/daily-close?date='+day,{},shop.token)).data.dailyClose
assert.ok(daily.personDocuments.some(d=>d.id===primary.id))
const signedRows=rdb.prepare("SELECT * FROM settlements WHERE tenant_id=? AND status='signed'").all(shop.tenantId)
const totalPrepaid=signedRows.reduce((n,r)=>n+(JSON.parse(r.recharge_json||'null')?.amountCents||0)+(JSON.parse(r.purchase_json||'null')?.priceCents||0),0)
const actualTotal=signedRows.reduce((n,r)=>n+r.total_cents+rdb.prepare('SELECT COALESCE(SUM(amount_delta_cents),0) n FROM settlement_amendments WHERE settlement_id=?').get(r.id).n,0)
assert.ok(totalPrepaid>0);assert.equal(daily.revenueCents,actualTotal-totalPrepaid)
const offline=rdb.prepare("SELECT COALESCE(SUM(p.amount_cents),0) n FROM settlement_payments p JOIN settlements s ON s.id=p.settlement_id WHERE s.tenant_id=? AND s.status='signed' AND p.leg='offline'").get(shop.tenantId).n
const dailyInline=signedRows.reduce((n,r)=>n+(JSON.parse(r.recharge_json||'null')?.amountCents||0),0)
assert.ok(dailyInline>0);assert.equal(daily.cashDrawer.storefrontCents,offline-dailyInline)
const personCount=rdb.prepare("SELECT COUNT(DISTINCT COALESCE(c.document_id,s.id)) n FROM settlements s LEFT JOIN member_document_components c ON c.settlement_id=s.id AND c.tenant_id=s.tenant_id WHERE s.tenant_id=? AND s.status='signed'").get(shop.tenantId).n
const monthStatus=(await request('/admin/daily-close/month?month='+day.slice(0,7),{},shop.token)).data
assert.equal(monthStatus.days.find(d=>d.date===day).revenueCents,daily.revenueCents)
assert.equal(monthStatus.days.find(d=>d.date===day).orderCount,personCount)
const trend=(await request('/admin/finance/trend?granularity=month&periods=2',{},shop.token)).data.trend
const point=trend.points.find(p=>p.key===day.slice(0,7));assert.ok(point)
assert.equal(point.orderCount,personCount);assert.equal(point.avgTicketCents,Math.round(daily.revenueCents/personCount))
console.log('ok 12 - daily close exposes per-person documents and excludes inline recharge from service revenue and duplicate cash collection')

// Acceptance journeys use normal customer/account/signing routes, not seeded balances.
let journeySequence=0
async function journeyCustomer(name,amountCents,rateBps) {
  const customer=await createAndLoginCustomerViaFrontDoor({base:BASE_URL,tenantId:shop.tenantId,ownerToken:shop.token,name,
    phone:`137${String(Date.now()+ ++journeySequence).slice(-8)}`,serviceId:svc.id,technicianId:tech.id})
  await ok('/admin/stored-value/recharge',{userId:customer.userId,amountCents,payChannel:'cash',operationId:`journey-${RUN_ID}-${journeySequence}`,discountConfirmation:{rateBps,expectedRevision:0}})
  return customer
}
const memberState=async userId=>(await request(`/admin/member-pricing/members/${userId}`,{},shop.token)).data
async function setZeroRule(value) {
  const result=await request(`/platform/tenants/${shop.tenantId}/membership-config`,{method:'PUT',body:JSON.stringify({config:{memberQualify:'any_recharge',keepMemberAfterRefund:value,tiersEnabled:false}})})
  assert.equal(result.status,200,JSON.stringify(result.data))
}
const journeyService=(await ok('/admin/pricing/items',{nameZh:'生命周期收费服务',type:'NAIL',categoryId:cat.id,itemKind:'main',listPriceCents:10000,memberPriceCents:9000})).item
const journeySheet={items:[{serviceId:journeyService.id}],technicians:[{technicianId:tech.id}]}
async function makeJourney(customer,key,extra={}) {
  return (await ok('/admin/member-pricing/documents',{userId:customer.userId,operationId:`journey-${RUN_ID}-${key}`,...journeySheet,...extra})).documents
}
async function signJourney(document) {
  return docSign(document,await ok(`/admin/member-pricing/documents/${document.id}/sign-link`,{}))
}
await setZeroRule('keep')
const defaults=await journeyCustomer('未设置与无折扣核验',100000,null)
const defaultDraft={userId:defaults.userId,...journeySheet,tierKey:'member'}
assert.equal((await ok('/admin/member-pricing/preview',defaultDraft)).totals.subtotalCents,9000)
for(const [n,rate,expected] of [[0,10000,10000],[1,100,100],[2,9900,9900]]) {
  const before=await memberState(defaults.userId)
  await ok(`/admin/member-pricing/members/${defaults.userId}`,{rateBps:rate,expectedRevision:before.revision,operationId:`rate-journey-${RUN_ID}-${n}`,reason:'真实接口折扣边界核验'},'PUT')
  assert.equal((await ok('/admin/member-pricing/preview',defaultDraft)).totals.subtotalCents,expected)
}
const beforeInvalidRate=await memberState(defaults.userId)
for(const rate of [0,-100,8550,10001]) {
  const invalid=await call(`/admin/member-pricing/members/${defaults.userId}`,{rateBps:rate,expectedRevision:beforeInvalidRate.revision,operationId:`bad-rate-${RUN_ID}-${rate}`,reason:'拒绝异常折扣'},'PUT')
  assert.equal(invalid.status,400)
}
assert.deepEqual(await memberState(defaults.userId),beforeInvalidRate)
console.log('ok 13 - unset uses store member price; explicit no-discount and 0.1/9.9 boundaries use original price; invalid rates make no changes')

const lifecycle=await journeyCustomer('耗尽余额资格核验',8500,8500)
const lifeDoc=(await makeJourney(lifecycle,'consume-zero'))[0]
const signedLife=await signJourney(lifeDoc)
assert.equal(signedLife.status,200)
assert.equal(signedLife.data.signed.discountAfter.balanceCents,0)
assert.equal(signedLife.data.signed.discountAfter.eligible,true)
let life=await memberState(lifecycle.userId)
assert.equal(life.balanceCents,0);assert.equal(life.eligible,true);assert.equal(life.rateBps,8500)
await setZeroRule('drop')
life=await memberState(lifecycle.userId)
assert.equal(life.eligible,false);assert.equal(life.effectiveRateBps,null);assert.equal(life.rateBps,8500)
assert.equal((await call('/admin/member-pricing/preview',{userId:lifecycle.userId,...journeySheet,tierKey:'member'})).data.error.code,'MEMBER_REQUIRED')
const publicLife=(await request('/my/member-pricing',{},lifecycle.accessToken)).data
assert.equal(publicLife.eligible,false);assert.equal(publicLife.rateBps,8500)
await ok('/admin/stored-value/recharge',{userId:lifecycle.userId,amountCents:1000,operationId:`life-recharge-${RUN_ID}`,discountConfirmation:{rateBps:8000,expectedRevision:life.revision}})
life=await memberState(lifecycle.userId)
assert.equal(life.eligible,true);assert.equal(life.effectiveRateBps,8000)
await ok('/admin/stored-value/refund',{userId:lifecycle.userId,amountCents:1000,requestId:`life-refund-${RUN_ID}`,reason:'充值退回时重新确认折扣',discountConfirmation:{rateBps:8500,expectedRevision:life.revision}})
life=await memberState(lifecycle.userId)
assert.equal(life.balanceCents,0);assert.equal(life.eligible,false);assert.equal(life.rateBps,8500)
await setZeroRule('keep')
assert.equal((await memberState(lifecycle.userId)).effectiveRateBps,8500)
console.log('ok 14 - real signed consumption reaches zero: keep/drop rules, public eligibility, recharge recovery and refund reconfirmation agree')

await setZeroRule('drop')
const shared=await journeyCustomer('共卡余额耗尽核验',8500,8500)
const sharedDocs=await makeJourney(shared,'same-name',{settlements:[journeySheet,
  {...journeySheet,beneficiaryKey:'friend-a',servedPersonName:'同名朋友'},
  {...journeySheet,beneficiaryKey:'friend-b',servedPersonName:'同名朋友'}]})
assert.equal(sharedDocs.length,3);assert.equal(new Set(sharedDocs.map(d=>d.beneficiaryKey)).size,3)
assert.ok(sharedDocs.every(d=>d.quote.subtotalCents===8500))
const signedSharedFirst=await signJourney(sharedDocs[0])
assert.equal(signedSharedFirst.status,200)
assert.equal(signedSharedFirst.data.signed.discountAfter.balanceCents,0)
assert.equal(signedSharedFirst.data.signed.discountAfter.eligible,false)
assert.equal(signedSharedFirst.data.signed.discountAfter.effectiveRateBps,null)
assert.equal(signedSharedFirst.data.signed.personalDiscount.current.rateBps,8500)
assert.equal((await memberState(shared.userId)).balanceCents,0)
assert.equal((await memberState(shared.userId)).eligible,false)
for(const document of sharedDocs.slice(1)) {
  const result=await signJourney(document)
  assert.equal(result.status,200,JSON.stringify(result.data))
  assert.equal(result.data.signed.balanceAfterCents,0)
  assert.equal(result.data.signed.discountAfter.balanceCents,0)
  assert.equal(result.data.signed.discountAfter.eligible,false)
  assert.equal(result.data.signed.subtotalCents,8500)
}
const sharedCodes=sharedDocs.flatMap(d=>d.components.map(c=>c.code))
const sharedRevenue=rdb.prepare(`SELECT SUM(amount_cents) n FROM finance_transactions WHERE tenant_id=? AND tags IN (${sharedCodes.map(()=>'?').join(',')})`).get(shop.tenantId,...sharedCodes).n
assert.equal(sharedRevenue,25500)
assert.equal((await memberState(shared.userId)).balanceCents,0)
console.log('ok 15 - same-name friends retain distinct documents; this visit can finish at its agreed rate after its first document exhausts the card')

const unrelated=await journeyCustomer('其它结算消耗余额核验',8500,8500)
const held=(await makeJourney(unrelated,'unrelated-held'))[0]
const spent=(await makeJourney(unrelated,'unrelated-spent'))[0]
assert.equal((await signJourney(spent)).status,200)
const blocked=await signJourney(held)
assert.equal(blocked.status,409);assert.equal(blocked.data.error.code,'MEMBERSHIP_CHANGED')
assert.equal((await request(`/admin/member-pricing/documents/${held.id}`,{},shop.token)).data.status,'pending_sign')
assert.equal((await memberState(unrelated.userId)).balanceCents,0)
const heldReview=(await request(`/admin/member-pricing/documents/${held.id}/review`,{},shop.token)).data
const heldFresh=await ok(`/admin/member-pricing/documents/${held.id}/refresh`,{reviewHash:heldReview.reviewHash,operationId:`review-other-${RUN_ID}`})
assert.equal(heldFresh.documents[0].quote.subtotalCents,10000)
assert.equal((await request(`/admin/member-pricing/documents/${spent.id}`,{},shop.token)).data.signed.subtotalCents,8500)
console.log('ok 16 - another visit exhausting the card blocks an old member quote; recheck uses original price and never alters the signed visit')

const concurrent=await journeyCustomer('并发充值折扣核验',10000,8500)
const concurrentBefore=await memberState(concurrent.userId)
const concurrentBodies=[1000,2000].map((amountCents,i)=>({userId:concurrent.userId,amountCents,payChannel:'cash',operationId:`concurrent-discount-${RUN_ID}-${i}`,discountConfirmation:{rateBps:i?7500:8000,expectedRevision:concurrentBefore.revision}}))
const concurrentResults=await Promise.all(concurrentBodies.map(body=>call('/admin/stored-value/recharge',body)))
assert.deepEqual(concurrentResults.map(x=>x.status).sort(),[201,409])
const winningIndex=concurrentResults.findIndex(x=>x.status===201),losing=concurrentResults.find(x=>x.status===409)
assert.equal(losing.data.error.code,'PRICING_CHANGED')
const committed=await memberState(concurrent.userId)
assert.equal(committed.balanceCents,10000+concurrentBodies[winningIndex].amountCents)
assert.equal(committed.revision,concurrentBefore.revision+1)
assert.equal(committed.rateBps,concurrentBodies[winningIndex].discountConfirmation.rateBps)
assert.equal((await ok('/admin/stored-value/recharge',concurrentBodies[winningIndex])).duplicate,true)
assert.deepEqual(await memberState(concurrent.userId),committed)
console.log('ok 17 - concurrent recharges with the same discount revision accept exactly one; rejected operation and successful retry cannot add money twice')

// Public quote calculator has a separate, read-only display-price path.
const refPath='/admin/member-pricing/reference-preview',refBody={tierKey:'list',items:[{serviceId:svc.id,qty:2}],applyFootSurcharge:true}
const refBefore=await memberState(uid),refDocs=rdb.prepare('SELECT count(*) n FROM member_service_documents WHERE tenant_id=?').get(shop.tenantId).n
const ref=await call(refPath,refBody,'POST',staff.accessToken)
assert.equal(ref.status,200,JSON.stringify(ref.data));assert.equal(ref.data.referenceOnly,true)
assert.equal(ref.data.settlement.subtotalCents,91000);assert.equal(ref.data.settlement.lines[0].unitPriceCents,45000)
assert.equal(ref.data.settlement.payment.storedUsedCents,0);assert.equal(ref.data.settlement.couponDiscountCents,0)
assert.equal((await call(refPath,{...refBody,tierKey:'member'})).data.error.code,'PRICE_TYPE_DISABLED')
assert.equal((await call(refPath,{...refBody,userId:uid})).data.error.code,'REFERENCE_ONLY')
assert.equal((await call(refPath,{...refBody,rechargeAmountCents:10000})).data.error.code,'REFERENCE_ONLY')
assert.equal((await call(refPath,{...refBody,items:[{serviceId:svc.id,qty:0}]})).status,400)
const otherPricingActive=(await request('/admin/member-pricing/config',{},other.token)).data.config.active
assert.equal((await call(refPath,refBody,'POST',other.token)).status,otherPricingActive?404:409)
const refConfig=(await request('/admin/member-pricing/config',{},shop.token)).data.config
await ok('/admin/member-pricing/config',{expectedRevision:refConfig.revision,displayTypes:['list','share']},'PUT')
assert.equal((await call(refPath,{...refBody,tierKey:'share'})).data.error.code,'PRICE_NOT_CONFIGURED')
await ok('/admin/member-pricing/config',{expectedRevision:refConfig.revision+1,displayTypes:refConfig.displayTypes},'PUT')
assert.deepEqual(await memberState(uid),refBefore)
assert.equal(rdb.prepare('SELECT count(*) n FROM member_service_documents WHERE tenant_id=?').get(shop.tenantId).n,refDocs)
console.log('ok 18 - staff public quote uses only configured display prices, validates scope/input and creates no member, money or document writes')

rdb.close()

assert.equal(refreshed.documents[0].visitGroupId,refreshDraft.groupId)
assert.equal((await request(`/admin/member-pricing/documents/${refreshed.documents[0].id}`,{},shop.token)).data.visitGroupId,refreshDraft.groupId)
console.log('ok 19 - refreshed descendant keeps the original visit group for reopened merchant and customer entry points')
