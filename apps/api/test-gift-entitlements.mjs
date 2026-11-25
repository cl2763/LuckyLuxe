import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {normalizeGiftItems} from './gifts.mjs'
import {createGiftEntitlements} from './gift-entitlements.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE coupons(id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,discount_type TEXT,amount_cents INTEGER,percent_off INTEGER,min_spend_cents INTEGER,valid_days INTEGER,total_qty INTEGER,issued_qty INTEGER,is_active INTEGER,created_at TEXT,scope_categories_json TEXT,is_custom INTEGER);
CREATE TABLE coupon_grants(id TEXT PRIMARY KEY,tenant_id TEXT,coupon_id TEXT,user_id TEXT,code TEXT,status TEXT,expires_at TEXT,created_at TEXT,grant_source TEXT,granted_by TEXT,grant_reason TEXT);
CREATE TABLE coupon_grant_logs(id TEXT,tenant_id TEXT,grant_id TEXT,action TEXT,detail TEXT,actor TEXT,created_at TEXT);
CREATE TABLE services(id TEXT,tenant_id TEXT,is_active INTEGER);
CREATE TABLE member_timecards(id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,package_id TEXT,name TEXT,total_times INTEGER,used_times INTEGER,refunded_times INTEGER DEFAULT 0,price_cents INTEGER,project_group TEXT,expires_at TEXT,created_at TEXT,card_source TEXT);
CREATE TABLE settlements(id TEXT,tenant_id TEXT,user_id TEXT,timecard_id TEXT,signed_at TEXT);
CREATE TABLE stored_value_transactions(id TEXT,tenant_id TEXT,user_id TEXT,type TEXT);
INSERT INTO services VALUES('nail','shop',1),('lash','shop',1),('foreign','other',1);
INSERT INTO stored_value_transactions VALUES('recharge','shop','customer','recharge'),('legacy','shop','customer','recharge');
INSERT INTO coupons VALUES('friend','shop','同行八五折','percent',0,15,0,30,10,0,1,'2026-11-21','[]',0);`)
const gifts=createGiftEntitlements({db,todayOf:()=> '2026-11-21',enabled:tid=>tid==='shop'})
gifts.ensureSchema();db.prepare("UPDATE coupons SET recipient_mode='friend_original'").run()
let count=0;const check=(name,fn)=>{fn();count++;console.log('ok '+count+' - '+name)}
const item={kind:'physical',name:'护理油',quantity:3,unitValueCents:null,validDays:null}
check('空参考价值与0保留不同值',()=>{assert.equal(normalizeGiftItems([item])[0].unitValueCents,null);assert.equal(normalizeGiftItems([{...item,unitValueCents:0}])[0].unitValueCents,0)})
check('数量金额类别及引用校验',()=>{for(const g of [{...item,quantity:0},{...item,quantity:1.1},{...item,unitValueCents:-1},{...item,kind:'unknown'},{...item,kind:'service_voucher'}])assert.throws(()=>normalizeGiftItems([g]));assert.throws(()=>gifts.validate('shop',[{...item,kind:'service_voucher',serviceId:'foreign'}]),{code:'GIFT_SERVICE_NOT_FOUND'});assert.throws(()=>gifts.validate('other',[item]),{code:'GIFT_FEATURE_NOT_ENABLED'})})
check('升级重复启动不生成历史权益',()=>{gifts.ensureSchema();assert.equal(gifts.list('shop','customer').length,0);gifts.issue({tenantId:'shop',userId:'customer',sourceTxnId:'legacy',giftItems:[{name:'旧物品',quantity:1,unitValueCents:1200}],actor:'boss'});assert.equal(gifts.list('shop','customer').length,0)})
const items=[item,{kind:'service_voucher',name:'美甲兑换',quantity:1,unitValueCents:null,serviceId:'nail',validDays:30},{kind:'service_timecard',name:'美睫三次',quantity:3,unitValueCents:0,serviceId:'lash',validDays:null},{kind:'coupon',name:'同行券',quantity:2,unitValueCents:null,couponId:'friend',validDays:null}]
let ids
check('一次充值混合发放实物兑换券次卡及同行券',()=>{ids=gifts.issue({tenantId:'shop',userId:'customer',sourceTxnId:'recharge',giftItems:items,actor:'boss'});assert.equal(ids.length,4);assert.equal(db.prepare('SELECT COUNT(*) n FROM coupon_grants').get().n,2);assert.deepEqual(db.prepare('SELECT price_cents FROM member_timecards').all().map(x=>x.price_cents),[0,0]);assert.equal(db.prepare("SELECT recipient_mode FROM coupons WHERE id LIKE '%template'").get().recipient_mode,'friend_original')})
check('重复发放不增券不增卡',()=>{assert.deepEqual(gifts.issue({tenantId:'shop',userId:'customer',sourceTxnId:'recharge',giftItems:items,actor:'boss'}),ids);assert.equal(db.prepare('SELECT COUNT(*) n FROM coupon_grants').get().n,2)})
let claim
check('分次领取及重试不重复扣减',()=>{const body={quantity:1,requestId:'first'};claim=gifts.physical('shop','customer',ids[0],'claim',body,'staff');assert.equal(claim.remaining,2);assert.equal(gifts.physical('shop','customer',ids[0],'claim',body,'staff').duplicate,true);assert.equal(gifts.list('shop','customer').find(g=>g.id===ids[0]).remaining,2);assert.throws(()=>gifts.physical('shop','customer',ids[0],'claim',{...body,quantity:2},'staff'),{code:'REQUEST_CONFLICT'})})
check('超领、跨顾客、服务手动核销受阻',()=>{assert.throws(()=>gifts.physical('shop','customer',ids[0],'claim',{quantity:3,requestId:'over'},'staff'),{code:'GIFT_INSUFFICIENT'});assert.throws(()=>gifts.physical('shop','other',ids[0],'claim',{quantity:1,requestId:'cross'},'staff'),{code:'GIFT_NOT_FOUND'});assert.throws(()=>gifts.physical('shop','customer',ids[1],'claim',{quantity:1,requestId:'service'},'staff'),{code:'GIFT_NOT_PHYSICAL'})})
check('退回必须关联原领取且不可超退，历史不删除',()=>{assert.equal(gifts.physical('shop','customer',ids[0],'return',{quantity:1,requestId:'return',claimId:claim.eventId,reason:'误登记'},'boss').remaining,3);assert.throws(()=>gifts.physical('shop','customer',ids[0],'return',{quantity:1,requestId:'again',claimId:claim.eventId,reason:'误登记'},'boss'),{code:'RETURN_EXCEEDS_CLAIM'});assert.throws(()=>db.exec('DELETE FROM recharge_gift_events'),/append-only/);assert.throws(()=>db.exec('UPDATE recharge_gift_grants SET name=\'oops\''),/immutable/)})
check('赠送服务必须匹配具体项目',()=>{gifts.assertService('shop',ids[1],'nail');assert.throws(()=>gifts.assertService('shop',ids[1],'lash'),{code:'GIFT_SERVICE_MISMATCH'})})
check('耗用以后重跑发放不复活权益',()=>{db.prepare('UPDATE member_timecards SET used_times=1 WHERE id=?').run(ids[1]);gifts.issue({tenantId:'shop',userId:'customer',sourceTxnId:'recharge',giftItems:items,actor:'boss'});assert.equal(gifts.list('shop','customer').find(g=>g.id===ids[1]).remaining,0);gifts.ensureSchema();assert.equal(gifts.list('shop','customer').find(g=>g.id===ids[1]).remaining,0)})
console.log(`${count} gift entitlement checks passed`)
