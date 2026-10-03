import {DatabaseSync} from 'node:sqlite'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {createStoredValue} from './stored-value.mjs'
import {createAccountRefund} from './account-refund.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,tenant_id TEXT,display_name TEXT);INSERT INTO users VALUES('u','A','Test');
CREATE TABLE stored_value_transactions(id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,type TEXT,amount_cents INTEGER,pay_channel TEXT,note TEXT,created_by TEXT,created_at TEXT,technician_id TEXT,customer_confirmed_at TEXT,paid_part_cents INTEGER,bonus_part_cents INTEGER,request_id TEXT,reversal_of TEXT,bucket TEXT NOT NULL DEFAULT 'normal');
INSERT INTO stored_value_transactions(id,tenant_id,user_id,type,amount_cents,bucket) VALUES('legacy','A','u','migrate_opening',10000,'legacy');
CREATE TRIGGER no_update BEFORE UPDATE ON stored_value_transactions BEGIN SELECT RAISE(ABORT,'immutable');END;
CREATE TRIGGER no_delete BEFORE DELETE ON stored_value_transactions BEGIN SELECT RAISE(ABORT,'immutable');END;`)
const common={db,apiError:(status,code,message)=>Object.assign(new Error(message),{status,code}),randomId:p=>p+randomUUID(),iso:d=>d.toISOString(),currentTenantId:()=> 'A',formatMoneyCents:c=>String(c)}
const value=createStoredValue(common),refund=createAccountRefund({...common,...value})
let n=0;const check=(name,fn)=>{fn();console.log('PASS',++n,name)}
const doRefund=(amount,requestId)=>refund.refundStoredValue({userId:'u',amountCents:amount,reason:'synthetic migration regression',operator:'ownerA',requestId,tenantId:'A'})
check('legacy-only refund reduces legacy while normal stays zero',()=>{doRefund(3000,'first');assert.deepEqual(value.storedValueBalanceDetail('u','A'),{totalCents:7000,legacyCents:7000,normalCents:0})})
check('new recharge remains normal and does not resurrect refunded legacy',()=>{value.insertStoredValueTransaction({userId:'u',type:'recharge',amountCents:5000});assert.deepEqual(value.storedValueBalanceDetail('u','A'),{totalCents:12000,legacyCents:7000,normalCents:5000})})
check('mixed-source refund uses existing legacy first and preserves remainder',()=>{const r=doRefund(9000,'mixed');assert.equal(r.refundedCents,9000);assert.deepEqual(value.storedValueBalanceDetail('u','A'),{totalCents:3000,legacyCents:0,normalCents:3000});assert.equal(db.prepare('SELECT legacy_cents FROM stored_value_refund_allocations WHERE txn_id=?').get(r.txnId).legacy_cents,7000)})
check('same refund retry does not allocate twice',()=>{const c=db.prepare('SELECT count(*) n FROM stored_value_refund_allocations').get().n;assert.equal(doRefund(9000,'mixed').duplicate,true);assert.equal(db.prepare('SELECT count(*) n FROM stored_value_refund_allocations').get().n,c)})
check('normal-only refund does not produce fake legacy allocation',()=>{const c=db.prepare('SELECT count(*) n FROM stored_value_refund_allocations').get().n;doRefund(1000,'normal');assert.equal(db.prepare('SELECT count(*) n FROM stored_value_refund_allocations').get().n,c);assert.equal(value.storedValueBalanceDetail('u','A').normalCents,2000)})
check('source snapshot remains unchanged; repeat schema does not rewrite allocations',()=>{createStoredValue(common);assert.equal(db.prepare("SELECT amount_cents FROM stored_value_transactions WHERE id='legacy'").get().amount_cents,10000);assert.equal(value.storedValueBalanceDetail('u','A').totalCents,2000);assert.throws(()=>db.exec('DELETE FROM stored_value_refund_allocations'))})
check('allocation failure rolls back ledger insert',()=>{db.exec("CREATE TRIGGER allocation_fail BEFORE INSERT ON stored_value_refund_allocations BEGIN SELECT RAISE(ABORT,'injected failure');END;");const before=db.prepare('SELECT count(*) n FROM stored_value_transactions').get().n;assert.throws(()=>value.insertStoredValueTransaction({userId:'u',type:'refund',amountCents:100,legacyRefundCents:100}));assert.equal(db.prepare('SELECT count(*) n FROM stored_value_transactions').get().n,before)})
console.log(n+' refund allocation checks passed');db.close()
