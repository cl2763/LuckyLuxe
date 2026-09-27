import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { customerSpendCents, lastCustomerVisitAt, bindingBadgeText } from './customer-facts.mjs'
import { createMembershipConfig } from './membership-config.mjs'
import { createDashboardPulse } from './dashboard-pulse.mjs'
const db=new DatabaseSync(':memory:'); let checks=0
const check=(name,fn)=>{fn();console.log(`ok ${++checks} - ${name}`)}
db.exec(`CREATE TABLE users(id TEXT,tenant_id TEXT,legacy_total_spend_cents INTEGER,tags_json TEXT);
CREATE TABLE bookings(id TEXT,user_id TEXT,tenant_id TEXT,status TEXT,appointment_start TEXT,arrived_at TEXT);
CREATE TABLE settlements(id TEXT,user_id TEXT,tenant_id TEXT,booking_id TEXT,status TEXT,subtotal_cents INTEGER,created_at TEXT,signed_at TEXT);
CREATE TABLE tenant_settings(tenant_id TEXT,key TEXT,value TEXT,updated_at TEXT);
CREATE TABLE stored_value_transactions(tenant_id TEXT,user_id TEXT,type TEXT,amount_cents INTEGER,created_at TEXT);
CREATE TABLE member_timecards(tenant_id TEXT,user_id TEXT,price_cents INTEGER,created_at TEXT);
CREATE TABLE finance_transactions(tenant_id TEXT,occurred_on TEXT,type TEXT,amount_cents INTEGER,pay_channel TEXT);
CREATE TABLE daily_closes(tenant_id TEXT,date TEXT,status TEXT,revenue_cents INTEGER);`)
db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('u','a',5000,'[]')
const book=(id,status,at,tid='a',arrived=null)=>db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?)').run(id,'u',tid,status,at,arrived)
const sheet=(id,status,amount,created,signed,booking=null,tid='a')=>db.prepare('INSERT INTO settlements VALUES(?,?,?,?,?,?,?,?)').run(id,'u',tid,booking,status,amount,created,signed)
book('past','COMPLETED','2026-09-24T12:00:00Z');book('future','CONFIRMED','2026-09-29T12:00:00Z')
book('cancel','CANCELLED','2026-09-25T10:00:00Z');book('fake-future','COMPLETED','2030-01-01T12:00:00Z')
book('other','COMPLETED','2026-09-25T12:00:00Z','b')
sheet('paid','signed',28800,'2026-09-24T12:00:00Z','2026-09-25T01:00:00Z','past')
sheet('draft','draft',100000,'2026-09-25T10:00:00Z',null)
sheet('old','amended',40000,'2026-09-01T12:00:00Z','2026-09-01T13:00:00Z')
sheet('void','voided',50000,'2026-09-25T10:00:00Z','2026-09-25T11:00:00Z')
sheet('foreign','signed',999999,'2026-09-25T10:00:00Z','2026-09-25T11:00:00Z',null,'b')
check('消费只计有效已签及本店迁移期初',()=>assert.equal(customerSpendCents(db,'u','a'),33800))
check('资格滚动窗口不把历史期初塞进当期',()=>assert.equal(customerSpendCents(db,'u','a','2026-09-25T00:00:00Z'),28800))
check('签署时间比较支持显式时区',()=>assert.equal(customerSpendCents(db,'u','a','2026-09-25T08:30:00+08:00'),28800))
check('过期消费不在滚动资格',()=>assert.equal(customerSpendCents(db,'u','a','2026-09-26T00:00:00Z'),0))
check('没有档案与流水返回空消费',()=>assert.equal(customerSpendCents(db,'none','a'),0))
check('最近到店排除未来、取消、外店',()=>assert.equal(lastCustomerVisitAt(db,'u','a',new Date('2026-09-26T00:00:00Z')),'2026-09-24T12:00:00.000Z'))
sheet('walkin','signed',12300,'2026-09-25T10:00:00-04:00','2026-09-25T16:00:00Z')
check('无预约已签单也是真实到店事实',()=>assert.equal(lastCustomerVisitAt(db,'u','a',new Date('2026-09-26T00:00:00Z')),'2026-09-25T14:00:00.000Z'))
db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?)').run('onsite','onsite-user','a','CONFIRMED','2026-09-25T18:00:00Z','2026-09-25T15:00:00Z')
db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?)').run('not-yet','onsite-user','a','CONFIRMED','2026-09-25T16:00:00Z',null)
db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?)').run('cancelled-arrival','onsite-user','a','CANCELLED','2026-09-25T17:00:00Z','2026-09-25T17:00:00Z')
check('已到店未签算真实到店，普通预约和取消残留到店标记不算',()=>assert.equal(lastCustomerVisitAt(db,'onsite-user','a',new Date('2026-09-25T16:30:00Z')),'2026-09-25T15:00:00.000Z'))
check('无到店事实返回null',()=>assert.equal(lastCustomerVisitAt(db,'none','a'),null))
check('绑定标签不推断新老或会员身份',()=>{assert.equal(bindingBadgeText(false),'未绑定微信');assert.equal(bindingBadgeText(true),'')})
const member=createMembershipConfig({db,iso:d=>d.toISOString(),currentTenantId:()=> 'a',storedValueBalanceDetail:()=>({totalCents:0}),apiError:(s,c,m)=>new Error(m)})
db.prepare('INSERT INTO tenant_settings VALUES(?,?,?,?)').run('a','membership_config',JSON.stringify({memberQualify:'total_spend',qualifyValueCents:46100}),'')
check('会员门槛恰等于档案消费即满足',()=>{assert.equal(member.customerTotalSpendCents('u','a'),46100);assert.equal(member.isMemberOf('u','a'),true)})
db.prepare('UPDATE tenant_settings SET value=?').run(JSON.stringify({memberQualify:'total_spend',qualifyValueCents:46101}))
check('门槛多一分不满足，完成预约不能补足',()=>assert.equal(member.isMemberOf('u','a'),false))

let locked=false
const zones={cn:'Asia/Shanghai',ca:'America/Toronto'}
const current={cn:'2026-09-26',ca:'2026-09-25'}
const pulse=createDashboardPulse({db,currentTenantId:()=> 'cn',tenantTimezone:tid=>zones[tid],todayOf:tid=>current[tid],tenantCurrencyCodeOrNull:()=> 'CNY',currencyDisplayOf:()=>({}),financeLocked:()=>locked,todayBoardOf:()=>({}),storeClosedOn:()=>false,storeClockText:()=>'',aiRetouchCard:()=>null})
const recharge=(tid,u,amt,at)=>db.prepare('INSERT INTO stored_value_transactions VALUES(?,?,?,?,?)').run(tid,u,'recharge',amt,at)
const card=(tid,u,amt,at)=>db.prepare('INSERT INTO member_timecards VALUES(?,?,?,?)').run(tid,u,amt,at)
for(const tid of ['cn','ca']) {
 recharge(tid,'first',10000,'2026-09-25T23:30:00Z')
 recharge(tid,'old',5000,'2026-09-24T15:00:00Z')
 recharge(tid,'old',2000,'2026-09-26T00:30:00Z')
 card(tid,'newcard',3000,'2026-09-26 00:45:00')
 card(tid,'first',4000,'2026-09-26T00:50:00Z') // same person card+recharge counts once
 book(tid+'visit','COMPLETED','2026-09-26T00:05:00Z',tid)
 book(tid+'book','CONFIRMED','2026-09-25T23:00:00Z',tid)
 book(tid+'arrived','CONFIRMED','2026-09-26T00:50:00Z',tid,'2026-09-26T00:30:00Z')
 book(tid+'cancel','CANCELLED','2026-09-26T00:30:00Z',tid,'2026-09-26T00:20:00Z')
}
const metric=(tid,key)=>pulse.pulse({tenantId:tid}).metrics.find(m=>m.key===key).value
for(const tid of ['cn','ca']) {
 check(tid+' 充值+购卡按门店日期，含SQLite UTC时间',()=>assert.equal(metric(tid,'cash'),19000))
 check(tid+' 首卡按顾客本地首日去重',()=>assert.equal(metric(tid,'newCard'),2))
 check(tid+' 到店按门店日期',()=>assert.equal(metric(tid,'visits'),2))
 check(tid+' 预约按门店日期且取消不计',()=>assert.equal(metric(tid,'bookings'),3))
}
check('现金来源拆分与总额精确相等',()=>{
 const m=pulse.pulse({tenantId:'cn'}).metrics.find(m=>m.key==='cash')
 assert.deepEqual(m.breakdown,{ledgerCents:0,rechargeCents:12000,timecardPurchaseCents:7000})
 assert.equal(Object.values(m.breakdown).reduce((a,b)=>a+b,0),m.value)
})
// Counterexample: even with value hidden, old prev+deltaAbs reconstructs it.
for(const [day,amount,channel] of [['2026-09-26',12345,'cash'],['2026-09-26',6789,'stored_value'],['2026-09-25',2468,'cash'],['2026-09-25',1357,'stored_value']]) {
 db.prepare('INSERT INTO finance_transactions VALUES(?,?,?,?,?)').run('cn',day,'income',amount,channel)
}
const beforeLock=pulse.pulse({tenantId:'cn'})
check('反例夹具三个金额指标非零且能由旧差额字段还原',()=>{
 for(const m of beforeLock.metrics.filter(m=>m.unit==='money')){assert.ok(m.value>0);assert.equal(m.prev+m.deltaAbs,m.value);assert.ok(m.prev>0)}
})
db.prepare('INSERT INTO tenant_settings VALUES(?,?,?,?)').run('cn','ai_daily_line',JSON.stringify({date:current.cn,text:'今日营业收入191.34，昨日38.25',atText:'12:00',at:'2026-09-26T04:00:00Z'}),'')
const unlockedLine=pulse.aiLine({tenantId:'cn'})
check('未锁时AI首页摘要保留原句',()=>assert.match(unlockedLine.line.text,/191.34/))
locked=true
for(const period of ['today','week','month','year']) check('财务锁 '+period+' 全部指标只返回卡片元数据，不能还原金额',()=>{
 const result=pulse.pulse({tenantId:'cn',period})
 assert.equal(result.locked,true)
 for(const m of result.metrics){assert.deepEqual(Object.keys(m).sort(),['key','locked','unit']);assert.equal(m.locked,true)}
 for(const key of ['value','prev','deltaAbs','deltaPct','extra','spark','breakdown'])assert.equal(JSON.stringify(result).includes('"'+key+'":'),false,key+' leaked')
})
check('财务锁不能从AI摘要文本泄漏金额',()=>assert.deepEqual(pulse.aiLine({tenantId:'cn'}),{line:null}))
locked=false
check('解锁后原金额、拆分、对比、卡耗附加字段原样恢复',()=>assert.deepEqual(pulse.pulse({tenantId:'cn'}).metrics,beforeLock.metrics))
check('解锁恢复原AI摘要，不删除或重生成',()=>assert.deepEqual(pulse.aiLine({tenantId:'cn'}),unlockedLine))
// DST rollback: both 01:30 occurrences belong to the same Toronto day.
current.ca='2026-11-01';recharge('ca','dst1',111,'2026-11-01T05:30:00Z');recharge('ca','dst2',222,'2026-11-01T06:30:00Z')
check('夏令时回拨两个01:30均归同一日',()=>assert.equal(metric('ca','cash'),333))
check('员工响应不泄漏统计金额',()=>assert.equal(pulse.pulse({tenantId:'ca',role:'staff'}).metrics,undefined))
db.close();console.log(`PASS ${checks} checks`)
