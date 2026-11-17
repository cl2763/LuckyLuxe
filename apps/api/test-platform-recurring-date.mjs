import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
import {createRecurringSetup} from './recurring-setup-routes.mjs'
const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE finance_recurring_rules(id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,category TEXT,tags TEXT,amount_cents INTEGER,cadence TEXT,day_of_month INTEGER,active INTEGER,created_by TEXT,created_at TEXT,updated_at TEXT,last_run_on TEXT);CREATE TABLE ledger(id INTEGER PRIMARY KEY,tenant TEXT,rule TEXT,date TEXT,amount INTEGER)`)
let today='2035-01-01',seq=0,tenant='a'
const deps={db,apiError:(status,code,message)=>Object.assign(Error(message),{status,code}),currentTenantId:()=>tenant,tenantTimezone:()=> 'America/Toronto',localParts:()=>({date:today}),randomId:()=>String(++seq),actorOf:()=> 'isolated',iso:d=>d.toISOString(),insertFinanceTransaction:r=>db.prepare('INSERT INTO ledger(tenant,rule,date,amount) VALUES(?,?,?,?)').run(tenant,r.recurringRuleId,r.occurredOn,r.amountCents)}
let api=createRecurringSetup(deps),checks=0
const check=(name,v)=>{assert.ok(v,name);checks++;console.log('ok '+checks+' - '+name)}
const r=api.configure({path:'/admin/finance/recurring',method:'POST',adminSession:{role:'owner'},body:{name:'未来费用',category:'房租',amountCents:10000,dayOfMonth:1,effectiveFrom:'2035-02-15'}},{platform:true})
check('配置不生成当前账目',db.prepare('SELECT COUNT(*) n FROM ledger').get().n===0)
check('生效之前无账目',api.materialize()===0)
today='2035-02-28';check('不补生效日期之前的当月账目',api.materialize()===0)
today='2035-03-01';check('首个有效计费日只生成一次',api.materialize()===1)
check('重复生成幂等',api.materialize()===0)
api=createRecurringSetup(deps);check('重复启动不重记账',api.materialize()===0)
today='2035-04-30';check('下月生成一笔',api.materialize()===1)
check('金额和日期保持正确',JSON.stringify(db.prepare('SELECT date,amount FROM ledger ORDER BY id').all())===JSON.stringify([{date:'2035-03-01',amount:10000},{date:'2035-04-01',amount:10000}]))
tenant='b';check('其他店不会生成这条费用',api.materialize()===0)
tenant='a';db.prepare("INSERT INTO finance_recurring_rules(id,tenant_id,name,category,amount_cents,day_of_month,active,created_at) VALUES('old','a','原有规则','房租',200,1,1,'2035-04-15T10:00:00Z')").run();check('旧规则仍沿用原本补当月行为',api.materialize()===1);check('原有未配置生效日期保持空值',db.prepare("SELECT effective_from FROM finance_recurring_rules WHERE id='old'").get().effective_from===null)
console.log(checks+' isolated recurring date checks passed');db.close()
