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

// Scenario labels report groups of throwing node:assert assertions above them.
function reportScenario(name) { checks += 1; console.log(`ok ${checks} - ${name}`) }

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
const shop=await newShop('workflow'),other=await newShop('outside')
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
await config({enabled:true,mode:'fixed',fixedAmountCents:10000,memberWaive:'none',deductible:true,cancelPolicy:{refundable:true,freeCancelHours:24,lateForfeitPct:50,rescheduleNoticeHours:0,depositRetainTimes:3}})
await success('/admin/stored-value/recharge',{userId:uid,amountCents:6000,payChannel:'cash'},shop.token)
const f0=finance(), made=await checkout({items:[item()],useBalance:true}),b=made.bookings[0]
const receipt=`/admin/bookings/${b.id}/deposit-receipt`,refund=`/admin/bookings/${b.id}/deposit-refund`
assert.equal(balance(),0)
const first={operationId:`receipt-first-${RUN_ID}`,amountCents:2000,payChannel:'cash',note:'实际现金收取'}
let r=await success(receipt,first,shop.token)
assert.equal(r.workflow.collectedCents,8000);assert.equal(r.workflow.offlineDueCents,2000)
assert.equal((await success(receipt,first,shop.token)).duplicate,true)
assert.equal((await send(receipt,{...first,amountCents:1000},shop.token)).status,409)
check('储值加部分线下收款守恒，同号重试不多收',balance()===0&&finance()===f0)
for(const amountCents of [0,-1,.1,100000001,'2000',null])assert.equal((await send(receipt,{...first,operationId:`bad-${RUN_ID}`,amountCents},shop.token)).status,400)
assert.equal((await send(receipt,{amountCents:100},shop.token)).status,400)
assert.equal((await send(receipt,{...first,operationId:`excess-${RUN_ID}`,amountCents:2001},shop.token)).status,409)
assert.equal((await send(receipt,{...first,payChannel:'stored_value'},shop.token)).status,400)
assert.equal((await send(receipt,first,null)).status,401)
assert.equal((await send(receipt,first,other.token,other.tenantId)).status,404)
assert.equal((await send(receipt,{...first,note:'a'.repeat(201)},shop.token)).status,400)
assert.equal((await send(receipt,[],shop.token)).status,400)
reportScenario('金额边界、异常、未登录、跨店被拒绝')
const races=await Promise.all([1,2].map(n=>send(receipt,{operationId:`race-${n}-${RUN_ID}`,amountCents:2000,payChannel:'transfer',booking:{id:'forged'},actor:'forged'},shop.token)))
assert.deepEqual(races.map(x=>x.status).sort(),[201,409]);r=races.find(x=>x.status===201).data
assert.equal(r.workflow.collectedCents,10000);assert.equal(r.workflow.offlineDueCents,0)
assert.notEqual(db.prepare('SELECT actor FROM deposit_workflow_operations WHERE operation_id=?').get(races[0].status===201?`race-1-${RUN_ID}`:`race-2-${RUN_ID}`).actor,'forged')
check('并发不得超收，不能伪造订单与经手人',balance()===0&&finance()===f0)
await cancel(b);assert.equal(balance(),6000);assert.equal(finance(),f0)
const faultDb=new DatabaseSync(process.env.TEST_DB_PATH)
const receiptSnapshot=id=>JSON.stringify(db.prepare('SELECT * FROM deposit_receipts WHERE booking_id=? ORDER BY id').all(id))
const refundBefore=receiptSnapshot(b.id)
faultDb.exec(`CREATE TRIGGER deposit_refund_fault BEFORE INSERT ON deposit_workflow_operations WHEN NEW.tenant_id='${shop.tenantId}' AND NEW.kind='refund' BEGIN SELECT RAISE(ABORT,'injected refund failure');END`)
try{const failed=await send(refund,{operationId:`refund-fault-${RUN_ID}`,amountCents:1500,payChannel:'cash'},shop.token);assert.equal(failed.status,500);assert.equal(receiptSnapshot(b.id),refundBefore);assert.equal(balance(),6000)}finally{faultDb.exec('DROP TRIGGER deposit_refund_fault')}
reportScenario('线下退款后段注入失败，原退款待办和储值全量回滚')
r=await success(refund,{operationId:`refund-first-${RUN_ID}`,amountCents:1500,payChannel:'cash'},shop.token)
assert.equal(r.workflow.cashRefundDueCents,2500);assert.equal(balance(),6000)
assert.equal((await success(refund,{operationId:`refund-first-${RUN_ID}`,amountCents:1500,payChannel:'cash'},shop.token)).duplicate,true)
assert.equal((await send(refund,{operationId:`refund-excess-${RUN_ID}`,amountCents:2501},shop.token)).status,409)
await success(refund,{operationId:`refund-last-${RUN_ID}`,amountCents:2500,payChannel:'transfer'},shop.token)
r=await success(receipt,undefined,shop.token,'GET');assert.equal(r.workflow.cashRefundDueCents,0);assert.equal(r.workflow.cashRefundedCents,4000)
assert.equal(r.workflow.history.some(x=>x.label==='线下退款待处理'),false);assert.ok(r.workflow.history.some(x=>x.label==='储值返还原账户 · 已到账'));assert.equal(r.workflow.history.some(x=>x.actor==='booking_checkout'),false)
await cancel(b);assert.equal(balance(),6000);assert.equal(finance(),f0)
reportScenario('取消储值原路退一次，线下分次退款不再退余额、不虚增收入')
assert.equal(db.prepare("SELECT SUM(CASE WHEN kind='refund' THEN -amount_cents ELSE amount_cents END) n FROM deposit_workflow_operations WHERE tenant_id=? AND pay_channel='cash'").get(shop.tenantId).n,500)
const direct=(await checkout({items:[item('12:00')],useBalance:false})).bookings[0]
await success(`/admin/bookings/${direct.id}/deposit-receipt`,{operationId:`pure-offline-${RUN_ID}`,amountCents:10000,payChannel:'transfer'},shop.token)
const merchantCancelPreview=await success(`/admin/bookings/${direct.id}/deposit-cancel-preview`,undefined,shop.token,'GET');assert.equal(merchantCancelPreview.cashRefundCents,10000)
assert.equal((await send(`/admin/bookings/${direct.id}/status`,{action:'cancel',reviewHash:'stale'},shop.token,shop.tenantId,'PATCH')).status,409)
await success(`/admin/bookings/${direct.id}/status`,{action:'cancel',reviewHash:merchantCancelPreview.reviewHash},shop.token,'PATCH');r=await success(`/admin/bookings/${direct.id}/deposit-receipt`,undefined,shop.token,'GET')
assert.equal(r.workflow.cashRefundDueCents,10000);assert.equal(balance(),6000)
await success(`/admin/bookings/${direct.id}/deposit-refund`,{operationId:`pure-refund-${RUN_ID}`,amountCents:10000,payChannel:'transfer'},shop.token)
assert.equal((await send(receipt,{...first,operationId:`cancelled-${RUN_ID}`},shop.token)).status,409)
check('纯线下定金取消不丢退款待办，已取消不可再收',balance()===6000&&finance()===f0)
// Real signed documents, not an intermediate preview, prove liability release.
async function signOne(booking,applied,amount){
 const before=finance(),group=await success('/admin/settlements',{userId:uid,cardOwnerUserId:uid,payIntent:'offline_full',settlements:[{bookingId:booking.id,tierKey:'list',payIntent:'offline_full',depositApplied:applied,customItems:[{name:'收费服务',amountCents:amount}],technicians:[{technicianId:shop.techId,role:'main',itemNos:[1]}]}]},shop.token)
 const sheet=group.settlements[0],sl=await success(`/admin/settlements/${sheet.id}/sign-token`,{},shop.token)
 if(applied){
  const beforeReceipts=receiptSnapshot(booking.id),beforeBalance=balance()
  faultDb.exec(`CREATE TRIGGER deposit_settle_fault BEFORE UPDATE OF settled_settlement_id ON deposit_receipts WHEN NEW.booking_id='${booking.id}' BEGIN SELECT RAISE(ABORT,'injected settlement failure');END`)
  try{const failed=await request(`/settlements/${sheet.code}/sign`,{method:'POST',body:JSON.stringify({signature:'synthetic-deposit-workflow',disclaimerAccepted:true})},me.accessToken,{'x-tenant-id':shop.tenantId,'x-sign-token':sl.token});assert.equal(failed.status,500);assert.equal(receiptSnapshot(booking.id),beforeReceipts);assert.equal(finance(),before);assert.equal(balance(),beforeBalance);assert.equal(db.prepare('SELECT status FROM settlements WHERE id=?').get(sheet.id).status,'pending_sign')}finally{faultDb.exec('DROP TRIGGER deposit_settle_fault')}
 }
 const r=await request(`/settlements/${sheet.code}/sign`,{method:'POST',body:JSON.stringify({signature:'synthetic-deposit-workflow',disclaimerAccepted:true})},me.accessToken,{'x-tenant-id':shop.tenantId,'x-sign-token':sl.token})
 assert.ok(r.status<300,JSON.stringify(r.data));assert.equal(finance()-before,amount)
 return sheet
}
const skipped=(await checkout({items:[item('14:00')],useBalance:false})).bookings[0]
await success(`/admin/bookings/${skipped.id}/deposit-receipt`,{operationId:`skip-${RUN_ID}`,amountCents:10000,payChannel:'cash'},shop.token)
await signOne(skipped,false,12000)
r=await success(`/admin/bookings/${skipped.id}/deposit-receipt`,undefined,shop.token,'GET');assert.equal(r.workflow.availableCents,10000)
assert.equal(db.prepare('SELECT COUNT(*) n FROM deposit_receipts WHERE booking_id=? AND settled_settlement_id IS NOT NULL').get(skipped.id).n,0)
const partial=(await checkout({items:[item('16:00')],useBalance:true})).bookings[0]
await success(`/admin/bookings/${partial.id}/deposit-receipt`,{operationId:`partial-${RUN_ID}`,amountCents:4000,payChannel:'transfer'},shop.token)
const partialSheet=await signOne(partial,true,4000)
r=await success(`/admin/bookings/${partial.id}/deposit-receipt`,undefined,shop.token,'GET');assert.equal(r.workflow.availableCents,6000)
assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM finance_transactions WHERE tenant_id=? AND tags=? AND category='服务收入-定金'").get(shop.tenantId,partialSheet.code).n,4000)
assert.equal((await success('/admin/finance/deposit-conservation',undefined,shop.token,'GET')).ok,true)
reportScenario('不抵扣不兑现，定金超过服务费只兑现实抵金额，剩余负债守恒')
const correct=(await checkout({items:[item('18:00')],useBalance:false})).bookings[0],correctPath=`/admin/bookings/${correct.id}/deposit-receipt`
const cr=await success(correctPath,{operationId:`correction-${RUN_ID}`,amountCents:1000,payChannel:'cash'},shop.token)
await success(correctPath+'/revoke',{receiptId:cr.receipt.id,reason:'金额误登记'},shop.token)
r=await success(correctPath,undefined,shop.token,'GET');assert.equal(r.workflow.collectedCents,0);assert.equal(r.workflow.offlineDueCents,10000)
assert.equal(db.prepare("SELECT SUM(CASE WHEN kind='collect' THEN amount_cents ELSE -amount_cents END) n FROM deposit_workflow_operations WHERE booking_id=? AND pay_channel='cash'").get(correct.id).n,0)
reportScenario('误登记冲销同时还原待收额和现金净额，原行保留')
const frozen=(await checkout({items:[item('20:00')],useBalance:false})).bookings[0]
await success(`/admin/bookings/${frozen.id}/deposit-receipt`,{operationId:`freeze-${RUN_ID}`,amountCents:10000,payChannel:'transfer'},shop.token)
const frozenGroup=await success('/admin/settlements',{userId:uid,cardOwnerUserId:uid,payIntent:'offline_full',settlements:[{bookingId:frozen.id,tierKey:'list',payIntent:'offline_full',depositApplied:true,customItems:[{name:'规则校验服务',amountCents:12000}],technicians:[{technicianId:shop.techId,role:'main',itemNos:[1]}]}]},shop.token)
const frozenSheet=frozenGroup.settlements[0],frozenLink=await success(`/admin/settlements/${frozenSheet.id}/sign-token`,{},shop.token)
assert.ok(frozenSheet.flow.lines.some(x=>x.key==='depositOfflineSource'))
await config({deductible:false})
const blockedSign=await request(`/settlements/${frozenSheet.code}/sign`,{method:'POST',body:JSON.stringify({signature:'synthetic-deposit-workflow',disclaimerAccepted:true})},me.accessToken,{'x-tenant-id':shop.tenantId,'x-sign-token':frozenLink.token})
assert.equal(blockedSign.status,409);assert.equal(blockedSign.data.error?.code||blockedSign.data.code,'DEPOSIT_RULE_CHANGED');assert.equal(db.prepare('SELECT status FROM settlements WHERE id=?').get(frozenSheet.id).status,'pending_sign')
await config({deductible:true})
reportScenario('待签期间定金规则变化会拒签，来源快照保留，不提前写入账本')
const writable=new DatabaseSync(process.env.TEST_DB_PATH)
assert.throws(()=>writable.prepare('DELETE FROM deposit_workflow_operations WHERE tenant_id=?').run(shop.tenantId),/append-only/)
assert.throws(()=>writable.prepare('UPDATE deposit_workflow_operations SET amount_cents=1 WHERE tenant_id=?').run(shop.tenantId),/append-only/)
assert.throws(()=>writable.prepare("UPDATE deposit_settlement_snapshots SET detail_json='{}' WHERE tenant_id=?").run(shop.tenantId),/immutable/)
writable.close();faultDb.close();db.close()
reportScenario('收退操作记录不可修改或删除')
console.log(`deposit-workflow: ${checks} scenario groups passed`)
