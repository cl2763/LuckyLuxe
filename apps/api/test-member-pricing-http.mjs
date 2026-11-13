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
async function ensureCategory(token, body) {
  const made = await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify(body) }, token)
  if (made.data && made.data.category) return made.data.category
  const list = (await request('/admin/pricing/categories', {}, token)).data.categories || []
  return list.find((c) => c.key === body.key) || list.find((c) => c.name === body.name) || list[0]
}

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
assert.equal(signed.data.signed.discountAfter.rateBps,7000)
assert.equal(signed.data.signed.components.length,2)
assert.ok(signed.data.components.every(c=>c.status==='signed'))
assert.equal((await docSign(primary,pLink)).data.duplicate,true)
signed=await docSign(friend,fLink)
assert.equal(signed.status,200,JSON.stringify(signed.data));assert.equal(signed.data.signed.balanceAfterCents,69200)
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
rdb.close()
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
