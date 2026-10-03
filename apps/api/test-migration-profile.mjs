import {migrationProfileFields} from '../../tools/migrations/profile-fields.mjs'
import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {createCustomerMigrationProfile,validateMigrationProfile} from './customer-migration-profile.mjs'
import {createMigrationCenter} from './migration-center.mjs'
const db=new DatabaseSync(':memory:')
const fail=(s,c,m)=>Object.assign(new Error(m),{status:s,code:c})
db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,tenant_id TEXT);INSERT INTO users VALUES('a','A'),('b','B');`)
const service=createCustomerMigrationProfile({db,apiError:fail,currentTenantId:()=> 'A',iso:d=>d.toISOString()})
const migration=createMigrationCenter({db,apiError:fail,randomId:()=>randomUUID(),iso:d=>d.toISOString(),createHash,normalizePhone:s=>s,importTenantCustomers:()=>{throw new Error('not used')}})
let n=0
function check(label,fn){fn();console.log('ok',++n,label)}
check('old users gain nullable-in-practice optional fields with empty defaults',()=>{service.ensureSchema();assert.deepEqual(service.get('A','a'),{acquisitionSource:'',originalJoinedDate:''})})
check('repeat startup preserves existing records and optional fields',()=>{service.save('A','a',{acquisitionSource:'朋友介绍',originalJoinedDate:'2024-02-29'},'ownerA');service.ensureSchema();assert.equal(service.get('A','a').originalJoinedDate,'2024-02-29');assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,2)})
check('partial updates preserve the other field and audit only real changes',()=>{service.save('A','a',{acquisitionSource:'美团'},'ownerA');assert.equal(service.get('A','a').originalJoinedDate,'2024-02-29');const n=db.prepare('SELECT count(*) n FROM customer_profile_changes').get().n;service.save('A','a',{acquisitionSource:'美团'},'ownerA');assert.equal(db.prepare('SELECT count(*) n FROM customer_profile_changes').get().n,n)})
check('invalid calendar dates and oversized input reject without modification',()=>{for(const date of ['2023-02-29','2024-02-30','2024-13-01','2024-01-01T00:00:00Z',null,12])assert.throws(()=>service.save('A','a',{originalJoinedDate:date},'ownerA'));assert.throws(()=>service.save('A','a',{acquisitionSource:'x'.repeat(121)},'ownerA'));assert.equal(service.get('A','a').acquisitionSource,'美团')})
check('explicit clearing supported and cross-tenant reads/writes denied',()=>{service.save('A','a',{originalJoinedDate:''},'ownerA');assert.equal(service.get('A','a').originalJoinedDate,'');assert.throws(()=>service.get('A','b'));assert.throws(()=>service.save('A','b',{acquisitionSource:'wrong'},'ownerA'));assert.equal(service.get('B','b').acquisitionSource,'')})
check('archive is paginated and retains long source text safely as data',()=>{migration.ensureSchema();for(let i=0;i<32;i++)db.prepare(`INSERT INTO customer_legacy_transactions(id,tenant_id,user_id,batch_id,source_system,source_record_id,source_item_id,raw_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('tx'+i,'A','a','batch','test','customer','tx'+i,JSON.stringify({text:'<script>no execute</script>'+'长'.repeat(3000)}),'2026-10-02');const a=service.archive('A','a');assert.equal(a.transactions.length,30);assert.equal(a.hasMore,true);assert.equal(service.archive('A','a',1).transactions.length,2);assert.equal(service.archive('B','b').transactions.length,0);assert.ok(a.transactions[0].details.text.length>3000)})
for(const role of ['staff','finance','customer']){
 await assert.rejects(()=>service.route({req:{method:'GET'},res:{},path:'/admin/customers/a/migration-archive',query:{},adminSession:{role},json:()=>{},readBody:async()=>({})}),e=>e.status===403);console.log('ok',++n,role+' denied source archive')
}
let result
await service.route({req:{method:'GET'},res:{},path:'/admin/customers/a/migration-archive',query:{},adminSession:{role:'owner'},json:(_,status,d)=>result={status,d}})
assert.equal(result.status,200);console.log('ok',++n,'owner archive allowed')
await assert.rejects(()=>service.route({req:{method:'GET'},res:{},path:'/admin/customers/a/migration-archive',query:{page:'-1'},adminSession:{role:'owner'},json:()=>{}}),e=>e.status===400);console.log('ok',++n,'bad pagination rejected')
check('source adapter promotes only unambiguous explicit fields',()=>{
 assert.deepEqual(migrationProfileFields({'来源渠道':'美团','建档日期':'2020/2/29'}),{acquisitionSource:'美团',originalJoinedDate:'2020-02-29'})
 for(const source of [{'建档日期':'2023-02-29'},{'建档日期':'不知道'},{'创建时间':'2020-01-01'},{'建档日期':'2020-01-01','入会日期':'2021-01-01'},{'来源渠道':'美团','获客来源':'朋友'}])assert.deepEqual(migrationProfileFields(source),{})
})
check('malformed request bodies reject without writes',()=>{for(const body of [null,[],12,'text'])assert.throws(()=>service.save('A','a',body,'ownerA'),e=>e.status===400)})
console.log(n+' profile/archive checks passed')
db.close()
