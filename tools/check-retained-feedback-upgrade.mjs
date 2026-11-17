import {backupDb} from './db-backup.mjs'
import {requireTarget} from './db-target.mjs'
// Offline rehearsal only. The source snapshot is opened read-only and never booted.
import {DatabaseSync} from 'node:sqlite'
import {spawn,execFileSync} from 'node:child_process'
import {createHash,randomBytes} from 'node:crypto'
import {createServer} from 'node:net'
import {mkdtempSync,mkdirSync,existsSync,readFileSync,writeFileSync,openSync,closeSync,chmodSync} from 'node:fs'
import {resolve,join} from 'node:path'
import assert from 'node:assert/strict'
assert.equal(process.version,'v22.11.0','Match the verified production runtime exactly')
const source=resolve(requireTarget({envName:'RETAINED_SNAPSHOT',value:process.env.RETAINED_SNAPSHOT}))
const privateRoot=resolve(requireTarget({envName:'REHEARSAL_PRIVATE_DIR',value:process.env.REHEARSAL_PRIVATE_DIR}))
const dbFile=requireTarget({envName:'REHEARSAL_DB_FILE',value:process.env.REHEARSAL_DB_FILE})
const hostUrl=new URL(requireTarget({envName:'REHEARSAL_HOST_URL',value:process.env.REHEARSAL_HOST_URL}))
assert.ok(/^[a-zA-Z0-9_.-]+$/.test(dbFile),'Database name must be a single filename')
assert.ok(hostUrl.protocol==='http:'&&hostUrl.hostname==='127.0.0.1'&&!hostUrl.username&&!hostUrl.password,'Only isolated loopback HTTP is allowed')
const commit=process.env.REHEARSAL_BASE_COMMIT
assert.ok(privateRoot&&commit&&process.env.RETAINED_SNAPSHOT,'Explicit private snapshot, output directory and verified baseline commit required')
assert.ok(!privateRoot.startsWith(process.cwd()+'/'),'Private copies must remain outside the repository')
const run=mkdtempSync(join(privateRoot,'feedback-upgrade-'));chmodSync(run,0o700)
const sha=x=>createHash('sha256').update(x).digest('hex'),valueHash=x=>sha(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v)),q=x=>'"'+x.replaceAll('"','""')+'"'
const codeFiles=[...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','apps/api','apps/web','miniprogram'],{encoding:'utf8'}).trim().split('\n'))].filter(p=>/\.(?:mjs|js|json|html|css|wxml|wxss)$/.test(p)&&!/(?:^|\/)test[^/]*\.(?:mjs|js)$/.test(p)).sort()
const codeHash=()=>valueHash(codeFiles.map(p=>[p,existsSync(p)?sha(readFileSync(p)):'deleted'])),candidateSourceSha256=codeHash()
const originalHash=sha(readFileSync(source)),runtime=join(run,'baseline-runtime');mkdirSync(runtime)
execFileSync('git',['archive','--format=tar','--output='+join(run,'baseline.tar'),commit]);execFileSync('tar',['-xf',join(run,'baseline.tar'),'-C',runtime])
function capture(path,columns){const db=new DatabaseSync(path,{readOnly:true});try{
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
 const schema=columns||Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('PRAGMA table_info('+q(name)+')').all().map(c=>c.name)]))
 const tables=Object.fromEntries(Object.entries(schema).map(([t,cols])=>{const rows=db.prepare('SELECT '+cols.map(q).join(',')+' FROM '+q(t)).all().map(valueHash).sort();return[t,{count:rows.length,hash:valueHash(rows),rowHashes:rows}]}))
 return {schema,tables,triggers:db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(),foreignKeys:db.prepare('PRAGMA foreign_key_check').all().map(valueHash).sort()}
}finally{db.close()}}
const original=capture(source),diff=(a,b)=>Object.keys(a.tables).filter(t=>a.tables[t].hash!==b.tables[t]?.hash)
let child;async function stop(){if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}child=null}
async function boot(code,data){const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;const healthUrl=new URL('/health',hostUrl);healthUrl.port=String(port);await new Promise(r=>probe.close(r));const fd=openSync(join(data,'startup.log'),'a',0o600)
 child=spawn(process.execPath,['--experimental-sqlite',join(code,'apps/api/local-server.mjs')],{cwd:code,env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:data,OWNER_TOKEN:randomBytes(32).toString('hex'),WECHAT_MINI_TOKEN_SECRET:randomBytes(32).toString('hex'),ALLOW_DEMO_ADMIN_LOGIN:'false',NOTIFY_TICK:'off',BACKUP_ENABLED:'false'},stdio:['ignore',fd,fd]});closeSync(fd)
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Isolated startup failed; private log: '+data);try{const r=await fetch(healthUrl),d=await r.json();if(r.ok&&d.dataFile===join(data,dbFile))return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Isolated health check timeout')
}
const control=join(run,'ll-ci-data.control'),candidate=join(run,'ll-ci-data.candidate');for(const dir of [control,candidate])mkdirSync(dir,0o700);backupDb(source,join(control,dbFile));chmodSync(join(control,dbFile),0o600)
let priorCandidate,baseline;const checks=[]
try{
 for(let i=1;i<=2;i++){await boot(runtime,control);await stop()}
 baseline=capture(join(control,dbFile),original.schema)
 for(const [name,t] of Object.entries(original.tables)){const counts=new Map();for(const h of baseline.tables[name].rowHashes)counts.set(h,(counts.get(h)||0)+1);for(const h of t.rowHashes){assert.ok(counts.get(h)>0,'Verified production startup changed an original row in '+name);counts.set(h,counts.get(h)-1)}}
 // Existing production startup backfills random identity ids/timestamps. Seed the
 // candidate from that verified control, then compare every persisted value exactly.
 backupDb(join(control,dbFile),join(candidate,dbFile));chmodSync(join(candidate,dbFile),0o600)
 checks.push('production-code control retains every original row and column; candidate seeded from verified control')
 for(let i=1;i<=2;i++){
  await boot(process.cwd(),candidate);await stop();const after=capture(join(candidate,dbFile),original.schema)
  assert.deepEqual(diff(baseline,after),[],'Original columns differ from same-snapshot production-code control')
  for(const t of original.triggers)assert.ok(after.triggers.some(a=>a.name===t.name&&a.sql===t.sql),'Original trigger changed: '+t.name)
  assert.deepEqual(after.foreignKeys,baseline.foreignKeys,'New foreign-key violation')
  const complete=capture(join(candidate,dbFile));if(priorCandidate)assert.deepEqual(diff(priorCandidate,complete),[],'Repeated startup changed persisted content');priorCandidate=complete;checks.push('candidate startup '+i+': all original columns match baseline control; original triggers retained')
 }
 assert.equal(sha(readFileSync(source)),originalHash,'Source backup changed')
 assert.equal(codeHash(),candidateSourceSha256,'Candidate source changed during rehearsal')
 const report={candidateSourceSha256,sourceFiles:codeFiles.length,checkedAt:new Date().toISOString(),scope:'offline retained snapshot rehearsal; not a fresh production backup or a deployment',runtime:process.version,baselineCommit:commit,snapshotSha256:originalHash,checks,originalTables:Object.keys(original.schema).length,originalRows:Object.values(original.tables).reduce((n,t)=>n+t.count,0),originalTriggers:original.triggers.length,baselineExistingStartupChanges:diff(original,baseline),newTables:Object.keys(priorCandidate.schema).filter(t=>!original.schema[t]),repeatStartupStable:true,sourceUnchanged:true}
 writeFileSync(join(run,'report.json'),JSON.stringify(report,null,2));mkdirSync('handoff/feedback-20261117/evidence',{recursive:true});writeFileSync('handoff/feedback-20261117/evidence/retained-upgrade.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));console.log('Private rehearsal retained at '+run)
}finally{await stop();assert.equal(sha(readFileSync(source)),originalHash,'Source backup changed')}
