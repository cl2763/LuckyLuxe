import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {ensureMemberPricingSchema,createMemberPricingPolicy} from './member-pricing-policy.mjs'
import {createMemberPricingTransactions} from './member-pricing-transactions.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE users(id TEXT,tenant_id TEXT);INSERT INTO users VALUES('u','a'),('v','b');
CREATE TABLE test_ledger(id INTEGER PRIMARY KEY,tenant_id TEXT,user_id TEXT,amount INTEGER);`)
ensureMemberPricingSchema(db)
const apiError=(status,code,message)=>Object.assign(new Error(message),{status,code})
const balanceOf=(u,t)=>db.prepare('SELECT COALESCE(SUM(amount),0) n FROM test_ledger WHERE tenant_id=? AND user_id=?').get(t,u).n
const p=createMemberPricingPolicy({db,apiError,balanceOf,isMemberOf:(u,t)=>balanceOf(u,t)>0,getMembershipConfig:()=>({})})
p.setConfig('a',{expectedRevision:0,active:true})
const tx=createMemberPricingTransactions({db,policy:p,apiError})
const admin={role:'staff',email:'synthetic-staff'}
const base={tenantId:'a',userId:'u',admin,source:'recharge'}
const body={operationId:'r1',amountCents:10000,discountConfirmation:{rateBps:8500,expectedRevision:0}}
const insert=amount=>{db.prepare('INSERT INTO test_ledger(tenant_id,user_id,amount) VALUES(?,?,?)').run('a','u',amount);return {amountCents:amount}}
assert.throws(()=>tx.run({...base,body:{operationId:'bad'},execute:()=>insert(10000)}),{code:'DISCOUNT_CONFIRMATION_REQUIRED'})
assert.equal(balanceOf('u','a'),0)
const r=tx.run({...base,body,execute:()=>insert(10000)})
assert.equal(r.discountReceipt.after.effectiveRateBps,8500)
assert.equal(r.discountReceipt.before.balanceCents,0)
assert.equal(r.discountReceipt.after.balanceCents,10000)
assert.equal(tx.run({...base,body,execute:()=>insert(10000)}).duplicate,true)
assert.equal(balanceOf('u','a'),10000)
assert.throws(()=>tx.run({...base,body:{...body,amountCents:20000},execute:()=>insert(20000)}),{code:'IDEMPOTENCY_CONFLICT'})
assert.throws(()=>tx.run({...base,userId:'v',body:{...body,operationId:'cross'},execute:()=>insert(10000)}),{code:'NOT_FOUND'})
assert.throws(()=>tx.run({...base,body:{...body,operationId:'stale'},execute:()=>insert(10000)}),{code:'PRICING_CHANGED'})
assert.throws(()=>tx.run({...base,source:'refund',body,execute:()=>insert(-10000)}),{code:'FORBIDDEN'})
// A late audit write failure must undo the already executed financial write.
db.exec(`CREATE TRIGGER injected_failure BEFORE INSERT ON member_discount_events BEGIN SELECT RAISE(ABORT,'injected');END;`)
const refund={operationId:'f1',amountCents:10000,reason:'退充值确认',discountConfirmation:{rateBps:10000,expectedRevision:1}}
assert.throws(()=>tx.run({...base,admin:{role:'owner',email:'synthetic-owner'},source:'refund',body:refund,execute:()=>insert(-10000)}),/injected/)
assert.equal(balanceOf('u','a'),10000);assert.equal(p.discount('a','u').rateBps,8500)
assert.equal(db.prepare('SELECT COUNT(*) n FROM member_pricing_operations').get().n,1)
db.exec('DROP TRIGGER injected_failure')
const after=tx.run({...base,admin:{role:'owner',email:'synthetic-owner'},source:'refund',body:refund,execute:()=>insert(-10000)})
assert.equal(after.discountReceipt.after.rateBps,10000)
assert.equal(after.discountReceipt.after.eligible,false)
assert.equal(p.history('a','u').length,2)
assert.equal(balanceOf('u','a'),0)
console.log('ok 1 - confirmed recharge/refund: authorization, idempotency, conflict, stale revision, tenant isolation, zero balance and atomic failure rollback')
