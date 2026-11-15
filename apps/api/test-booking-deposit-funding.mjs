import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {randomUUID} from 'node:crypto'
import {createBookingDepositFunding} from './booking-deposit-funding.mjs'
import {createAccountRefund} from './account-refund.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE stored_value_transactions(id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,type TEXT,amount_cents INTEGER,pay_channel TEXT,note TEXT,created_by TEXT,created_at TEXT,bucket TEXT,paid_part_cents INTEGER,bonus_part_cents INTEGER,request_id TEXT UNIQUE,reversal_of TEXT);CREATE TABLE deposit_receipts(id TEXT PRIMARY KEY,tenant_id TEXT,booking_id TEXT,kind TEXT,amount_cents INTEGER,pay_channel TEXT);`)
const bal=(u,t)=>{const r=db.prepare("SELECT SUM(amount_cents) n,SUM(CASE WHEN bucket='legacy' THEN amount_cents ELSE 0 END) l FROM stored_value_transactions WHERE tenant_id=? AND user_id=?").get(t,u);return {totalCents:r.n||0,legacyCents:r.l||0,normalCents:(r.n||0)-(r.l||0)}}
const err=(s,c,m)=>Object.assign(new Error(m),{status:s,code:c})
const refund=createAccountRefund({db,apiError:err,formatMoneyCents:String,currentTenantId:()=> 'A'})
const args={db,randomId:()=>randomUUID(),apiError:err,balanceOf:bal,refundFacts:refund.refundFacts,formatMoneyCents:String}
let funding=createBookingDepositFunding(args),checks=0
const check=(name,fn)=>{fn();console.log(`ok ${++checks} - ${name}`)}
const b={id:'b',tenant_id:'A',user_id:'u'},r={id:'r',tenant_id:'A',user_id:'u',amount_cents:900}
db.exec("INSERT INTO stored_value_transactions(id,tenant_id,user_id,type,amount_cents,bucket) VALUES('l','A','u','migrate_opening',777,'legacy'),('p','A','u','recharge',123,'normal'),('g','A','u','bonus',100,'normal')")
check('迁移本金优先，普通本金及赠金各有实际来源',()=>{db.exec('BEGIN IMMEDIATE');const p=funding.hold(b,900,r);assert.deepEqual(p,[777,123,0,0]);db.exec('COMMIT');assert.deepEqual(bal('u','A'),{totalCents:100,legacyCents:0,normalCents:100});assert.equal(refund.refundFacts('u','A').bonusRemainingCents,100)})
const r2={...r,id:'r2',amount_cents:100}
check('纯赠金抵扣不冒充实付，返还恢复赠金性质',()=>{db.exec('BEGIN IMMEDIATE');const p=funding.hold(b,100,r2);assert.deepEqual(p,[0,0,100,0]);assert.equal(bal('u','A').totalCents,0);funding.giveBack(b,r2,p);assert.equal(refund.refundFacts('u','A').bonusRemainingCents,100);db.exec('COMMIT')})
check('部分退款分币守恒且原桶不串，重复操作被唯一键拦截',()=>{const p=funding.parts(r),back=funding.split(p,451);assert.equal(back.reduce((n,v)=>n+v,0),451);db.exec('BEGIN IMMEDIATE');funding.giveBack(b,r,back);db.exec('COMMIT');assert.equal(bal('u','A').legacyCents,back[0]);assert.equal(bal('u','A').totalCents,551);assert.throws(()=>funding.giveBack(b,r,back),/UNIQUE/);assert.equal(bal('u','A').totalCents,551)})
check('扣款后关联来源写入失败，外层事务整笔回滚',()=>{const before=bal('u','A');db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON booking_deposit_funding BEGIN SELECT RAISE(ABORT,'injected funding failure');END;BEGIN IMMEDIATE");assert.throws(()=>funding.hold(b,200,{...r,id:'fail',amount_cents:200}),/injected/);db.exec('ROLLBACK;DROP TRIGGER injected_failure');assert.deepEqual(bal('u','A'),before);assert.equal(db.prepare("SELECT COUNT(*) n FROM stored_value_transactions WHERE request_id LIKE '%fail%'").get().n,0)})
check('零/超额/分币边界及跨店隔离',()=>{assert.deepEqual(funding.split([1,1,1,0],2),[1,1,0,0]);assert.deepEqual(funding.split([0,0,0,0],0),[0,0,0,0]);assert.throws(()=>funding.split([1,1],3));assert.throws(()=>funding.split([1],.1));assert.deepEqual(funding.parts({...r,tenant_id:'B'}),[0,0,0,900]);assert.throws(()=>funding.hold({...b,tenant_id:'B'},1,{...r,id:'cross',tenant_id:'B'}),/余额/);assert.equal(bal('u','B').totalCents,0)})
check('来源不可改删，重复初始化不改历史',()=>{const before=JSON.stringify(db.prepare('SELECT * FROM booking_deposit_funding').all());assert.throws(()=>db.exec('DELETE FROM booking_deposit_funding'),/append-only/);assert.throws(()=>db.exec('UPDATE booking_deposit_funding SET paid_cents=0'),/append-only/);funding=createBookingDepositFunding(args);assert.equal(JSON.stringify(db.prepare('SELECT * FROM booking_deposit_funding').all()),before)})
console.log(`\n${checks} checks passed`)
