import {DatabaseSync} from 'node:sqlite'
import {createHash,randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {createMigrationCenter} from './migration-center.mjs'
import {createMigrationBalanceActivation} from './migration-balance-activation.mjs'
import {createAccountRefund} from './account-refund.mjs'
const db=new DatabaseSync(':memory:'),err=(status,code,message)=>Object.assign(new Error(message),{status,code})
const common={db,apiError:err,randomId:p=>p+'-'+randomUUID(),iso:d=>d.toISOString(),createHash,currentTenantId:()=> 'A',tenantCurrencyCodeOrNull:tid=>db.prepare('SELECT currency FROM tenants WHERE id=?').get(tid)?.currency}
db.exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY,currency TEXT);INSERT INTO tenants VALUES('A','CNY'),('B','CAD');
 CREATE TABLE users(id TEXT PRIMARY KEY,tenant_id TEXT);INSERT INTO users VALUES('u','A'),('v','B');
 CREATE TABLE stored_value_transactions(id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,type TEXT,amount_cents INTEGER,pay_channel TEXT,note TEXT,created_by TEXT,created_at TEXT,bucket TEXT,paid_part_cents INTEGER,bonus_part_cents INTEGER,request_id TEXT,reversal_of TEXT);
 CREATE TABLE finance_transactions(id TEXT PRIMARY KEY,amount_cents INTEGER);INSERT INTO finance_transactions VALUES('old-income',777);
 CREATE TRIGGER no_ledger_update BEFORE UPDATE ON stored_value_transactions BEGIN SELECT RAISE(ABORT,'append-only');END;
 CREATE TRIGGER no_ledger_delete BEFORE DELETE ON stored_value_transactions BEGIN SELECT RAISE(ABORT,'append-only');END;`)
createMigrationCenter({...common,normalizePhone:s=>s}).ensureSchema()
const service=createMigrationBalanceActivation(common);service.ensureSchema()
let n=0
const check=(name,fn)=>{fn();console.log('ok',++n,name)}
const cutoff='2020-01-01T00:00:00Z'
function seed(id,amount=10000){
 db.prepare('INSERT INTO users VALUES(?,?)').run(id,'A')
 db.prepare(`INSERT INTO migration_batches(id,tenant_id,package_hash,source_system,source_exported_at,data_cutoff_at,source_timezone,mode,status,record_count,import_count,excluded_count,opening_balance_cents,created_at) VALUES(?,?,?,'test',?,?,'Asia/Shanghai','initial','executed',1,1,0,?,?)`).run('batch'+id,'A',id,cutoff,cutoff,amount,cutoff)
 db.prepare(`INSERT INTO migration_pending_balances(id,tenant_id,user_id,batch_id,source_system,source_record_id,snapshot_amount_cents,data_cutoff_at,created_at) VALUES(?,'A',?,?,'test',?,?,?,?)`).run(id,id,'batch'+id,id,amount,cutoff,cutoff)
 db.prepare(`INSERT INTO customer_migration_links(id,tenant_id,source_system,source_record_id,user_id,first_batch_id,last_batch_id,created_at,updated_at) VALUES(?,'A','test',?,?,?,?,?,?)`).run(id,id,id,'batch'+id,'batch'+id,cutoff,cutoff)
 db.prepare(`INSERT INTO customer_migration_records(id,batch_id,tenant_id,source_record_id,user_id,status,mapped_json,source_json,details_json,review_json,created_at) VALUES(?,?,'A',?,?,'imported','{}','{}','{}','{}',?)`).run(id,'batch'+id,id,id,cutoff)
 return {requestId:'request_'+id,confirmVersion:service.preview('A',id,id).version,paidCents:8000,bonusCents:2000,currency:'CNY',mode:'unrestricted_aggregate',noReliableCardBreakdown:true,unrestricted:true,noExpiry:true,sourceUseStopped:true,cutoverAt:'2020-01-02T00:00:00Z',evidence:'商家核对原系统后停止使用，核对记录A',differenceReason:''}
}
function activate(id,body){return service.activate('A',id,id,body,'owner-A')}
function fail(id,body,code){assert.throws(()=>activate(id,body),e=>e.code===code)}
const a=seed('a');let result
check('confirmation separates paid/bonus, writes legacy liability without income',()=>{result=activate('a',a);assert.equal(result.activatedCents,10000);assert.equal(result.incomeImpactCents,0);const rows=db.prepare('SELECT type,amount_cents,bucket FROM stored_value_transactions WHERE user_id=? ORDER BY amount_cents DESC').all('a');assert.deepEqual(rows.map(r=>[r.type,r.amount_cents,r.bucket]),[['migrate_opening',8000,'legacy'],['bonus',2000,'legacy']]);assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM finance_transactions').get().n,777)})
check('retry remains idempotent even after balance consumed',()=>{db.prepare("INSERT INTO stored_value_transactions(id,tenant_id,user_id,type,amount_cents,bucket) VALUES('consume','A','a','consume',-10000,'legacy')").run();assert.equal(activate('a',a).replayed,true);assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM stored_value_transactions WHERE user_id='a'").get().n,0)})
check('same request key cannot change content; different key cannot reactivate source',()=>{fail('a',{...a,paidCents:1},'REQUEST_CONFLICT');fail('a',{...a,requestId:'another_key_a'},'ALREADY_ACTIVATED')})
check('source snapshot remains unmodified; audit cannot update or delete',()=>{assert.equal(db.prepare("SELECT snapshot_amount_cents FROM migration_pending_balances WHERE id='a'").get().snapshot_amount_cents,10000);assert.equal(db.prepare("SELECT source_json FROM customer_migration_records WHERE id='a'").get().source_json,'{}');assert.throws(()=>db.exec('DELETE FROM migration_balance_activations'));assert.throws(()=>db.exec("UPDATE migration_balance_activations SET actor='someone'"))})
check('negative, fractional, non-number and oversized cents rejected',()=>{const b=seed('bad');for(const paidCents of [-1,.5,'8000',NaN,100000000001])fail('bad',{...b,paidCents},'BAD_AMOUNT');assert.equal(db.prepare("SELECT count(*) n FROM stored_value_transactions WHERE user_id='bad'").get().n,0)})
check('unknown/per-card/restricted/expiring rules cannot activate as cash',()=>{const b=seed('rules');for(const key of ['unrestricted','noExpiry','noReliableCardBreakdown','sourceUseStopped'])fail('rules',{...b,[key]:false},'RULES_NOT_SUPPORTED')})
check('currency mismatch and cutoff before snapshot rejected',()=>{const b=seed('currency');fail('currency',{...b,currency:'CAD'},'CURRENCY_MISMATCH');fail('currency',{...b,cutoverAt:'2019-01-01T00:00:00Z'},'CUTOVER_TOO_EARLY');fail('currency',{...b,cutoverAt:'2999-01-01T00:00:00Z'},'CUTOVER_CONFIRM_REQUIRED')})
check('amount change requires explicit reason; zero is exhausted without ledger',()=>{const b=seed('zero');fail('zero',{...b,paidCents:0,bonusCents:0},'DIFFERENCE_REASON_REQUIRED');assert.equal(activate('zero',{...b,paidCents:0,bonusCents:0,differenceReason:'原系统截止后已经核销完毕，凭证已核对'}).status,'exhausted');assert.equal(db.prepare("SELECT count(*) n FROM stored_value_transactions WHERE user_id='zero'").get().n,0)})
check('changed source data invalidates prior confirmation version',()=>{const b=seed('stale');db.prepare("UPDATE customer_migration_records SET source_json=? WHERE id='stale'").run('{"revision":2}');fail('stale',b,'SOURCE_CHANGED')})
check('old unlinked migration ledger blocks possible double opening',()=>{const b=seed('historical');db.prepare("INSERT INTO stored_value_transactions(id,tenant_id,user_id,type,amount_cents,bucket) VALUES('existing','A','historical','migrate_opening',10,'legacy')").run();fail('historical',b,'EXISTING_LEGACY_BALANCE')})
check('cross-tenant and wrong customer cannot preview or activate',()=>{const b=seed('private');assert.throws(()=>service.preview('B','private','private'),e=>e.status===404);assert.throws(()=>service.activate('B','private','private',b,'ownerB'),e=>e.status===404);assert.throws(()=>service.preview('A','u','private'),e=>e.status===404)})
check('failure at audit insert rolls back both ledger and source status',()=>{const b=seed('rollback');db.exec("CREATE TRIGGER inject_failure BEFORE INSERT ON migration_balance_activations WHEN NEW.user_id='rollback' BEGIN SELECT RAISE(ABORT,'injected');END;");assert.throws(()=>activate('rollback',b));assert.equal(db.prepare("SELECT count(*) n FROM stored_value_transactions WHERE user_id='rollback'").get().n,0);assert.equal(service.preview('A','rollback','rollback').status,'pending');db.exec('DROP TRIGGER inject_failure')})
check('refund facts retain principal/bonus distinction',()=>{const b=seed('refund');activate('refund',b);const refund=createAccountRefund({...common,formatMoneyCents:c=>String(c)});const f=refund.refundFacts('refund','A');assert.equal(f.paidCents,8000);assert.equal(f.bonusCents,2000);assert.equal(f.paidRefundableCents,8000)})
check('schema repeat startup preserves activation audit',()=>{service.ensureSchema();assert.equal(service.preview('A','a','a').confirmation.id,result.id)})
for(const role of ['staff','finance','customer']) { await assert.rejects(()=>service.route({req:{method:'GET'},path:'/admin/customers/a/migration-balances/a',adminSession:{role}}),e=>e.status===403);console.log('ok',++n,role+' cannot inspect or enable migrated balance') }
console.log(n+' migration activation checks passed')
db.close()
