// 只造临时沙箱验证同步/撤销；不接触运行中的店铺库。
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { requireTarget } from '../../tools/db-target.mjs'
const dir=mkdtempSync('/tmp/ll-ci-data.sandbox-data-sync-')
const target=requireTarget({envName:'临时沙箱',value:dir+'/fixture.sqlite'})
const db=new DatabaseSync(target), dumpPath=dir+'/dump.json',journal=dir+'/journal.json'
const tables=['stores','service_categories','services','service_prices','technicians','business_hours','technician_services']
let n=0;const failures=[]
const check=(name,ok)=>{console.log(`${ok?'ok':'not ok'} ${++n} - ${name}`);if(!ok)failures.push(name)}
const snap=()=>Object.fromEntries([...tables,'protected_records'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()]))
const run=(dump,mode='')=>{writeFileSync(dumpPath,JSON.stringify(dump));return spawnSync(process.execPath,[fileURLToPath(new URL('../../tools/sync-sandbox-from-prod.mjs',import.meta.url)),'--dump',dumpPath,...(mode?[mode]:[])],{env:{...process.env,SANDBOX_DB:target,SYNC_JOURNAL:journal},encoding:'utf8'})}
try{
  for(const t of tables.filter(t=>!['technician_services','business_hours'].includes(t)))db.exec(`CREATE TABLE ${t}(id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,is_active INTEGER,price_cents INTEGER,deposit_cents INTEGER,base_duration_min INTEGER)`)
  db.exec('CREATE TABLE business_hours(store_id TEXT,weekday INTEGER,tenant_id TEXT,open_time TEXT,close_time TEXT,PRIMARY KEY(store_id,weekday))')
  db.exec('CREATE TABLE technician_services(technician_id TEXT REFERENCES technicians(id),service_id TEXT REFERENCES services(id),PRIMARY KEY(technician_id,service_id));CREATE TABLE protected_records(id TEXT PRIMARY KEY,name TEXT)')
  db.prepare('INSERT INTO protected_records VALUES(?,?)').run('protected','不能同步的顾客')
  for(const tid of ['lucky-luxe','luvia-bj','jics-nail','other']){
    for(const t of tables.filter(t=>!['technician_services','business_hours'].includes(t)))db.prepare(`INSERT INTO ${t} VALUES(?,?,?,?,?,?,?)`).run(t+'-'+tid,tid,'旧值',1,10000,5000,60)
    db.prepare('INSERT INTO business_hours VALUES(?,?,?,?,?)').run('stores-'+tid,1,tid,'10:00','19:00')
    db.prepare('INSERT INTO technician_services VALUES(?,?)').run('technicians-'+tid,'services-'+tid)
  }
  const before=snap(),beforeText=JSON.stringify(before)
  const dump=Object.fromEntries(tables.map(t=>[t,before[t].filter(r=>t==='technician_services'?!r.technician_id.endsWith('-other'):r.tenant_id!=='other').map(r=>({...r,...(t==='technician_services'?{}:t==='business_hours'?{open_time:'09:00'}:{name:'新值'})}))]))
  dump.services.push({...dump.services.find(r=>r.tenant_id==='lucky-luxe'),id:'new-service'})
  dump.technician_services.push({technician_id:'technicians-lucky-luxe',service_id:'new-service'})
  const missing={...dump};delete missing.technician_services
  check('缺技师项目表拒绝且原库完整不变',run(missing).status!==0&&JSON.stringify(snap())===beforeText)
  const cross={...dump,technician_services:[...dump.technician_services,{technician_id:'technicians-lucky-luxe',service_id:'services-jics-nail'}]}
  check('跨店技师项目关联拒绝且原库不变',run(cross).status!==0&&JSON.stringify(snap())===beforeText)
  const written=run(dump)
  check('完整七表同步成功',written.status===0)
  if(written.status!==0)console.log(written.stderr)
  check('新增服务关联实际存在',Boolean(db.prepare('SELECT 1 FROM technician_services WHERE service_id=?').get('new-service')))
  check('第四家店与白名单外数据不被复制覆盖',JSON.stringify(snap().protected_records)===JSON.stringify(before.protected_records)&&db.prepare('SELECT name FROM stores WHERE tenant_id=?').get('other').name==='旧值')
  check('逐表校验通过',run(dump,'--verify').status===0)
  check('未撤销流水不能被再次同步覆盖',run(dump).status!==0)
  db.prepare('DELETE FROM technician_services WHERE service_id=?').run('new-service')
  check('缺失一个关联能被校验发现',run(dump,'--verify').status!==0)
  const undone=run(dump,'--undo')
  check('撤销恢复完整前像，包含关联且移除新增项目',undone.status===0&&JSON.stringify(snap())===beforeText)
  if(undone.status!==0)console.log(undone.stderr)
  check('恢复流水明确绑定目标库',JSON.parse(readFileSync(journal)).target===target)
}finally{db.close();if(!failures.length)rmSync(dir,{recursive:true,force:true});else console.log('失败现场 '+dir)}
console.log(`${n} checks; ${failures.length} failures`);process.exitCode=failures.length?1:0
