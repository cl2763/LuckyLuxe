import {createMigrationPaidTimecards} from './migration-paid-timecards.mjs'
import {createMigrationGifts} from './migration-gifts.mjs'
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

db.exec(`CREATE TABLE services(id TEXT,tenant_id TEXT,is_active INTEGER);INSERT INTO services VALUES('svc','A',1);
CREATE TABLE member_timecards(id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,package_id TEXT,name TEXT,total_times INTEGER,used_times INTEGER,price_cents INTEGER,project_group TEXT,expires_at TEXT,source_settlement_id TEXT,created_at TEXT,card_source TEXT,refunded_times INTEGER DEFAULT 0);
CREATE TABLE timecard_refunds(id TEXT PRIMARY KEY,tenant_id TEXT,card_id TEXT,user_id TEXT,times INTEGER,amount_cents INTEGER,pay_channel TEXT,reason TEXT,created_by TEXT,created_at TEXT);`)
createMigrationGifts(common).ensureSchema()
const paid=createMigrationPaidTimecards({...common,balanceSource:service.source});paid.ensureSchema()
function cardSeed(id){const b=seed(id);db.prepare("INSERT INTO customer_legacy_assets VALUES(?,'A',?,?,'test',?,?,'card','旧次卡','{}',?)").run('asset'+id,id,'batch'+id,id,'item'+id,cutoff);return {...b,confirmVersion:service.preview('A',id,id).version,allBalanceAllocated:true,equalPerUsePrincipal:true,cards:[{assetId:'asset'+id,kind:'paid_timecard',paidCents:10000,bonusCents:0,remainingTimes:10,serviceId:'svc',noExpiry:true}]}}
const act=(id,b)=>paid.activate('A',id,id,b,'owner-A'),reject=(id,b,code)=>assert.throws(()=>act(id,b),e=>e.code===code)
const b=cardSeed('paid');let receipt
check('分卡不增加储值或现金收入',()=>{receipt=act('paid',b);assert.equal(receipt.storedValueAddedCents,0);assert.equal(receipt.cards.length,1);assert.equal(db.prepare('SELECT count(*) n FROM stored_value_transactions').get().n,0);assert.equal(db.prepare('SELECT sum(amount_cents) n FROM finance_transactions').get().n,777);assert.equal(db.prepare('SELECT price_cents FROM member_timecards').get().price_cents,10000)})
check('重复启用返回原回执且不重复建卡',()=>{assert.equal(act('paid',b).replayed,true);assert.equal(db.prepare('SELECT count(*) n FROM member_timecards').get().n,1);reject('paid',{...b,evidence:'changed'},'REQUEST_CONFLICT');reject('paid',{...b,requestId:'another_request'},'ALREADY_ACTIVATED')})
check('分卡启用后不能再次启用汇总余额',()=>assert.throws(()=>service.activate('A','paid','paid',{...b,requestId:'aggregate_again'},'owner-A'),e=>e.code==='ALREADY_ACTIVATED'))
check('汇总余额先启用后不能分卡',()=>{const x=cardSeed('aggregate');service.activate('A','aggregate','aggregate',x,'owner-A');reject('aggregate',{...x,requestId:'cards_again'},'ALREADY_ACTIVATED')})
check('混合赠送金与不均匀分币保持待核对',()=>{const x=cardSeed('unsupported');reject('unsupported',{...x,cards:[{...x.cards[0],paidCents:9000,bonusCents:1000}]},'CARD_RULES_UNSUPPORTED');reject('unsupported',{...x,cards:[{...x.cards[0],remainingTimes:3}]},'CARD_RULES_UNSUPPORTED')})
check('余额差额、错误服务、过早切换被拒绝',()=>{const x=cardSeed('invalid');reject('invalid',{...x,cards:[{...x.cards[0],paidCents:9000}]},'NOT_BALANCED');reject('invalid',{...x,cards:[{...x.cards[0],serviceId:'other'}]},'SERVICE_REQUIRED');reject('invalid',{...x,cutoverAt:'2019-01-01T00:00:00Z'},'CUTOVER_TOO_EARLY')})
check('来源变化后确认失效',()=>{const x=cardSeed('stale');db.prepare("UPDATE customer_legacy_assets SET raw_json='changed' WHERE user_id='stale'").run();reject('stale',x,'SOURCE_CHANGED')})
check('失败时卡、来源状态和回执全部回滚',()=>{const x=cardSeed('rollback');db.exec("CREATE TRIGGER fail_paid BEFORE INSERT ON migration_balance_activations WHEN NEW.user_id='rollback' BEGIN SELECT RAISE(ABORT,'injected');END");assert.throws(()=>act('rollback',x));assert.equal(db.prepare("SELECT count(*) n FROM member_timecards WHERE user_id='rollback'").get().n,0);assert.equal(service.preview('A','rollback','rollback').status,'pending')})
check('不存在的日历日期不能用于切换',()=>{const x=cardSeed('bad-date');reject('bad-date',{...x,cutoverAt:'2024-02-30T00:00:00Z'},'CUTOVER_REQUIRED')})
const refund=createAccountRefund({...common,formatMoneyCents:c=>String(c)}),r={cardId:receipt.cards[0].cardId,times:2,amountCents:2000,payChannel:'cash',reason:'退剩余两次',operator:'owner-A',requestId:'refund_paid_1'}
check('退款受对应次数原本金上限约束',()=>assert.throws(()=>refund.refundTimecard({...r,amountCents:2001}),e=>e.code==='REFUND_EXCEEDS_SOURCE_PRINCIPAL'))
check('退款重复请求不重复扣次数或写账',()=>{assert.equal(refund.refundTimecard(r).remainingTimes,8);assert.equal(refund.refundTimecard(r).duplicate,true);assert.equal(db.prepare('SELECT count(*) n FROM timecard_refunds').get().n,1);assert.throws(()=>refund.refundTimecard({...r,times:1}),e=>e.code==='REQUEST_CONFLICT')})
check('退款回执失败则次数和退款流水一并回滚',()=>{db.exec("CREATE TRIGGER fail_refund BEFORE INSERT ON migration_timecard_refund_receipts BEGIN SELECT RAISE(ABORT,'injected');END");assert.throws(()=>refund.refundTimecard({...r,requestId:'refund_paid_2'}));assert.equal(refund.timecardRefundFacts(r.cardId).remainingTimes,8);assert.equal(db.prepare('SELECT count(*) n FROM timecard_refunds').get().n,1)})
check('重复启动保留来源回执',()=>{paid.ensureSchema();assert.equal(act('paid',b).id,receipt.id)})
for(const role of ['staff','finance','customer']){await assert.rejects(()=>paid.route({req:{method:'POST'},path:'/admin/customers/paid/migration-balances/paid/activate-timecards',adminSession:{role}}),e=>e.status===403);console.log('ok',++n,role+' denied')}
console.log(n+' paid timecard checks passed');db.close()
