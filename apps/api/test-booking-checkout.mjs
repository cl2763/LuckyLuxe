// Cart deposit funding: atomic booking/debit, source-preserving refund, signing and tenant boundaries.
const TENANT_HEADER = process.env.TEST_TENANT_ID || 'lucky-luxe'
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

async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'x-tenant-id': TENANT_HEADER, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `p12-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `定金店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  // 临时店默认没有营业时间,先铺满一周(00:00-23:59),免得下单被「该日期门店休息」挡住
  await request(`/platform/tenants/${id}/business-hours`, {
    method: 'PUT',
    body: JSON.stringify({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openTime: '00:00', closeTime: '23:30', isClosed: false })) })
  })
  const tech = await request(`/platform/tenants/${id}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技师${label}${RUN_ID}` }) })
  const svc = await request(`/platform/tenants/${id}/services`, {
    method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `项目${label}${RUN_ID}`, nameEn: 'item', priceCents: 40000, depositCents: 5000, baseDurationMin: 60 })
  })
  return { tenantId: id, token, techId: tech.data.technician.id, serviceId: svc.data.service.id }
}

function dateStr(offsetDays = 0) {
  // 时区红线(复发登记 08-23,L2 同类):日期一律按门店时区推,裸 new Date() 在 CST 午夜跨天错位
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
}

// 老板直接排单不收定金(adminDirect),所以定金链路走顾客侧下单:注册一个演示顾客
async function customerBook(shop, { date, time, userToken }) {
  return request('/bookings', {
    method: 'POST',
    body: JSON.stringify({ storeId: `store-${shop.tenantId}`, serviceId: shop.serviceId, technicianId: shop.techId, date, time, addOns: [] })
  }, userToken, { 'x-tenant-id': shop.tenantId })
}

async function setConfig(shop, config) {
  return request('/admin/deposit-config', { method: 'PUT', body: JSON.stringify({ config }) }, shop.token)
}

import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createAndLoginCustomerViaFrontDoor} from './customer-login-fixture.mjs'
const shop=await newShop('checkout'),other=await newShop('outside')
const me=await createAndLoginCustomerViaFrontDoor({base:BASE_URL,tenantId:shop.tenantId,ownerToken:shop.token,name:'定金真实抵扣',phone:`138${String(Date.now()).slice(-8)}`,serviceId:shop.serviceId,technicianId:shop.techId})
assert.ok(me.ok,JSON.stringify(me.body));const uid=me.userId
const db=new DatabaseSync(process.env.TEST_DB_PATH,{readOnly:true})
const send=(p,b,token=me.accessToken,tid=shop.tenantId,method='POST')=>request(p,{method,...(b===undefined?{}:{body:JSON.stringify(b)})},token,{'x-tenant-id':tid})
const success=async(p,b,token=me.accessToken,method='POST')=>{const r=await send(p,b,token,shop.tenantId,method);assert.ok(r.status<300,`${p}: ${JSON.stringify(r.data)}`);return r.data}
const config=async c=>{const r=await setConfig(shop,c);assert.equal(r.status,200,JSON.stringify(r.data))}
const balance=()=>db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM stored_value_transactions WHERE tenant_id=? AND user_id=?').get(shop.tenantId,uid).n
const finance=()=>db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM finance_transactions WHERE tenant_id=?').get(shop.tenantId).n
const count=()=>db.prepare('SELECT COUNT(*) n FROM bookings WHERE tenant_id=?').get(shop.tenantId).n
let serial=0
const item=(time='10:00',day=15)=>({clientItemId:`i${++serial}`,storeId:`store-${shop.tenantId}`,serviceId:shop.serviceId,technicianId:shop.techId,date:dateStr(day),time,addOns:[]})
const preview=body=>success('/my/booking-checkout/preview',body)
const checkout=async body=>{const p=await preview(body);return success('/my/booking-checkout',{...body,reviewHash:p.reviewHash,operationId:`checkout-${RUN_ID}-${++serial}`})}
const cancel=async b=>{const p=await success(`/bookings/${b.id}/cancel-preview`,undefined,me.accessToken,'GET');return success(`/bookings/${b.id}/cancel`,{reviewHash:p.reviewHash,reason:'测试取消'})}
await config({enabled:true,mode:'fixed',fixedAmountCents:5000,memberWaive:'none',deductible:true,cancelPolicy:{refundable:true,freeCancelHours:24,lateForfeitPct:50,rescheduleNoticeHours:0,depositRetainTimes:3}})
await success('/admin/stored-value/recharge',{userId:uid,amountCents:7000,bonusCents:1000,payChannel:'cash'},shop.token)
let body={items:[item('10:00'),item('12:00')],useBalance:true},p=await preview(body)
assert.equal(p.totals.requiredCents,10000);assert.equal(p.totals.storedDeductionCents,8000);assert.equal(p.totals.offlineDueCents,2000)
const f0=finance(),requestBody={...body,reviewHash:p.reviewHash,operationId:`first-${RUN_ID}`}
const made=await success('/my/booking-checkout',requestBody);assert.equal(made.bookings.length,2);assert.equal(balance(),0);assert.equal(finance(),f0)
assert.equal(db.prepare("SELECT COUNT(*) n FROM payments WHERE booking_id IN (?,?) AND provider='STORED_VALUE' AND status='SUCCEEDED'").get(...made.bookings.map(b=>b.id)).n,2)
check('多项目足额/不足额真实扣款，定金为负债不提前记收入',made.bookings.length===2 && balance()===0 && finance()===f0)
const cnt=count();assert.equal((await success('/my/booking-checkout',requestBody)).duplicate,true);assert.equal(count(),cnt);assert.equal(balance(),0)
assert.equal((await send('/my/booking-checkout',{...requestBody,useBalance:false})).data.error.code,'IDEMPOTENCY_CONFLICT')
const refunded=await cancel(made.bookings[1]);assert.equal(refunded.refundReceipt.refundToStoredCents,3000);assert.equal(balance(),3000)
assert.equal((await cancel(made.bookings[1])).refundReceipt.refundToStoredCents,3000);assert.equal(balance(),3000)
await cancel(made.bookings[0]);assert.equal(balance(),8000);assert.equal(finance(),f0)
assert.equal(db.prepare("SELECT SUM(CASE WHEN type='deposit_hold' THEN bonus_part_cents WHEN type='deposit_return' THEN -bonus_part_cents ELSE 0 END) n FROM stored_value_transactions WHERE tenant_id=? AND user_id=?").get(shop.tenantId,uid).n,0)
check('同号重试只扣一次，取消原路返还，重复取消不多退',balance()===8000 && finance()===f0)
body={items:[item('14:00')],useBalance:true};p=await preview(body)
await success('/admin/stored-value/recharge',{userId:uid,amountCents:1,payChannel:'cash'},shop.token)
assert.equal((await send('/my/booking-checkout',{...body,reviewHash:p.reviewHash,operationId:`stale-${RUN_ID}`})).data.error.code,'CHECKOUT_CHANGED');assert.equal(count(),cnt)
const a=await checkout(body);assert.equal(balance(),3001)
await config({cancelPolicy:{refundable:true,freeCancelHours:null,lateForfeitPct:50}})
const cp=await success(`/bookings/${a.bookings[0].id}/cancel-preview`,undefined,me.accessToken,'GET');assert.equal(cp.forfeitCents,2500);assert.equal(cp.refundToStoredCents,2500)
await config({cancelPolicy:{lateForfeitPct:25}})
assert.equal((await send(`/bookings/${a.bookings[0].id}/cancel`,{reviewHash:cp.reviewHash})).data.error.code,'CANCEL_CHANGED');assert.equal(balance(),3001)
await config({cancelPolicy:{lateForfeitPct:50}});await cancel(a.bookings[0]);assert.equal(balance(),5501);assert.equal(finance(),f0+2500)
check('余额及取消规则变化要求重核对，部分退款与不退金额守恒',balance()===5501 && finance()===f0+2500)
body={items:[item('16:00'),item('16:00')],useBalance:true};p=await preview(body);const beforeCount=count(),beforeBalance=balance()
const fail=await send('/my/booking-checkout',{...body,reviewHash:p.reviewHash,operationId:`conflict-${RUN_ID}`});assert.ok(fail.status>=400);assert.equal(count(),beforeCount);assert.equal(balance(),beforeBalance)
check('第二项目冲突回滚整批预约、占位和第一笔扣款',count()===beforeCount && balance()===beforeBalance)
body={items:[item('16:00')],useBalance:true};p=await preview(body)
const concurrent=await Promise.all([send('/my/booking-checkout',{...body,reviewHash:p.reviewHash,operationId:`race1-${RUN_ID}`}),send('/my/booking-checkout',{...body,reviewHash:p.reviewHash,operationId:`race2-${RUN_ID}`})]);assert.equal(concurrent.filter(r=>r.status===201).length,1);assert.equal(balance(),501)
const unpaid=await checkout({items:[item('18:00')],useBalance:false});assert.equal(balance(),501);assert.equal(unpaid.bookings[0].depositCents,0)
assert.equal((await send('/my/booking-checkout/preview',{items:[],useBalance:true})).status,400)
assert.equal((await send('/my/booking-checkout/preview',{items:[null],useBalance:true})).status,400)
assert.equal((await send('/my/booking-checkout/preview',null)).status,400)
assert.equal((await send('/my/booking-checkout/preview',{items:[item()],useBalance:'true'})).status,400)
assert.equal((await send('/my/booking-checkout/preview',{items:[item()],useBalance:true},null)).status,401)
assert.ok((await send('/my/booking-checkout/preview',{items:[item()],useBalance:true},me.accessToken,other.tenantId)).status>=400)
assert.equal((await send(`/bookings/${a.bookings[0].id}/cancel-preview`,undefined,me.accessToken,other.tenantId,'GET')).status,404)
check('并发、未启用储值、空态、异常输入、未登录和跨店均有后端闸',concurrent.filter(r=>r.status===201).length===1 && balance()===501)
await config({cancelPolicy:{freeCancelHours:0,depositRetainTimes:3}})
const raceBooking=concurrent.find(r=>r.status===201).data.bookings[0];const rescheduled=await success(`/admin/bookings/${raceBooking.id}/reschedule`,{reason:'合规改期'},shop.token);assert.equal(rescheduled.reschedule.depositRetained,true)
const retained=await checkout({items:[item('10:00',16)],useBalance:true});assert.equal(retained.preview.totals.retainedCents,5000);assert.equal(retained.preview.totals.storedDeductionCents,0);assert.equal(balance(),501)
await cancel(retained.bookings[0]);assert.equal(balance(),5501)
check('合规改期留存来源转移，不重复扣余额，转单取消仍退原桶',retained.preview.totals.storedDeductionCents===0 && balance()===5501)
await config({memberWaive:'all'})
const free=await checkout({items:[item('12:00',16)],useBalance:true});assert.equal(free.preview.totals.waivedCents,5000);assert.equal(free.preview.totals.storedDeductionCents,0);assert.equal(balance(),5501)
check('免定金会员无需储值扣款',free.preview.totals.waivedCents===5000 && free.preview.totals.storedDeductionCents===0)
await config({memberWaive:'none',deductible:true})
await success('/admin/stored-value/recharge',{userId:uid,amountCents:10000,payChannel:'cash'},shop.token)
const signedBooking=(await checkout({items:[item('14:00',16)],useBalance:true})).bookings[0]
const beforeSign=balance(),beforeIncome=finance()
const group=await success('/admin/settlements',{userId:uid,payIntent:'offline_full',settlements:[{bookingId:signedBooking.id,depositApplied:true,payIntent:'offline_full',items:[{serviceId:shop.serviceId,qty:1}],technicians:[{technicianId:shop.techId,role:'main',itemNos:[1]}]}]},shop.token)
const sheet=group.settlements[0];assert.ok(sheet)
const sl=await success(`/admin/settlements/${sheet.id}/sign-token`,{},shop.token)
const sr=await request(`/settlements/${encodeURIComponent(sheet.code)}/sign`,{method:'POST',body:JSON.stringify({signature:'synthetic-deposit-test',disclaimerAccepted:true})},me.accessToken,{'x-tenant-id':shop.tenantId,'x-sign-token':sl.token})
assert.ok(sr.status<300,JSON.stringify(sr.data));assert.equal(balance(),beforeSign)
assert.equal(finance()-beforeIncome,40000)
assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM finance_transactions WHERE tenant_id=? AND tags=? AND category='服务收入-定金'").get(shop.tenantId,sheet.code).n,5000)
assert.ok((await send(`/bookings/${signedBooking.id}/cancel`,{})).status>=400)
check('签署只兑现已收定金，不再次扣卡；签署后不能取消退款',balance()===beforeSign && finance()-beforeIncome===40000)
const audit=await success('/admin/finance/deposit-conservation',undefined,shop.token,'GET')
assert.ok(!audit.broken?.length,JSON.stringify(audit))
await success('/admin/stored-value/recharge',{userId:uid,amountCents:10000,payChannel:'cash'},shop.token)
const ns=(await checkout({items:[item('16:00',16)],useBalance:true})).bookings[0],nsBal=balance(),nsIncome=finance()
await success(`/admin/bookings/${ns.id}/no-show`,{reason:'测试爽约'},shop.token)
await success(`/admin/bookings/${ns.id}/deposit-disposal`,{action:'retain',note:'保留定金'},shop.token)
const carried=(await checkout({items:[item('10:00',17)],useBalance:true}));assert.equal(carried.preview.totals.retainedCents,5000);assert.equal(balance(),nsBal);assert.equal(finance(),nsIncome)
await cancel(carried.bookings[0]);assert.equal(balance(),nsBal+5000)
const forfeit=(await checkout({items:[item('12:00',17)],useBalance:true})).bookings[0]
await success(`/admin/bookings/${forfeit.id}/no-show`,{reason:'测试没收'},shop.token)
await success(`/admin/bookings/${forfeit.id}/deposit-disposal`,{action:'forfeit',note:'按规则没收'},shop.token)
assert.equal(finance(),nsIncome+5000);assert.equal(balance(),nsBal)
assert.ok((await success('/admin/finance/deposit-conservation',undefined,shop.token,'GET')).ok)
check('爽约留存及没收：来源保留、取消可返、收入与负债不会同时重复',finance()===nsIncome+5000 && balance()===nsBal)

const mixedBefore=balance(),mixedIncome=finance()
await config({fixedAmountCents:mixedBefore+1000,cancelPolicy:{freeCancelHours:0}})
const mixed=(await checkout({items:[item('14:00',18)],useBalance:true})).bookings[0]
assert.equal(balance(),0)
const cash=await success(`/admin/bookings/${mixed.id}/deposit-receipt`,{payChannel:'cash'},shop.token)
assert.equal(cash.receipt.amountCents,1000)
assert.equal((await success(`/admin/bookings/${mixed.id}/deposit-receipt`,{payChannel:'cash'},shop.token)).created,false)
const mixedCancel=await cancel(mixed)
assert.equal(mixedCancel.refundReceipt.refundToStoredCents,mixedBefore)
assert.equal(mixedCancel.refundReceipt.cashRefundCents,1000)
assert.match(mixedCancel.refundReceipt.display.note,/线下.*门店/)
assert.equal(balance(),mixedBefore);assert.equal(finance(),mixedIncome)
assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM deposit_receipts WHERE booking_id=? AND pay_channel='refund_due'").get(mixed.id).n,1000)
await cancel(mixed);assert.equal(balance(),mixedBefore)
assert.equal((await send(`/admin/bookings/${mixed.id}/deposit-receipt`,{payChannel:'cash'},shop.token)).data.error.code,'BOOKING_CANCELLED')
assert.ok((await success('/admin/finance/deposit-conservation',undefined,shop.token,'GET')).ok)
check('余额与线下混合定金只补差额，取消原路退余额并明确线下待退，不能重收',balance()===mixedBefore && finance()===mixedIncome && mixedCancel.refundReceipt.cashRefundCents===1000)
console.log(`\n${checks} checks passed`)
