// Starts only an isolated regression server and stops only its own child process.
import {spawn} from 'node:child_process'
import {mkdtempSync,openSync,closeSync,writeFileSync,mkdirSync} from 'node:fs'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:net'
const suites=process.argv.slice(2)
if(!suites.length||suites.some(s=>!/^test-[a-z0-9-]+\.mjs$/.test(s)))throw Error('Specify explicit API test filenames')
const dir=mkdtempSync('/tmp/ll-ci-data.feedback-regression-'),owner=randomBytes(24).toString('hex'),secret=randomBytes(24).toString('hex')
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port
const env={PATH:process.env.PATH,HOME:process.env.HOME,LC_ALL:'C',NODE_OPTIONS:'--experimental-sqlite',DATA_DIR:dir,TEST_DB_PATH:dir+'/lucky-luxe.sqlite',TEST_BASE_URL:base,PORT:String(port),HOST:'127.0.0.1',OWNER_TOKEN:owner,TEST_ADMIN_TOKEN:owner,WECHAT_MINI_TOKEN_SECRET:secret,WECHAT_APP_SECRET:'configured-test-only',ALLOW_DEMO_ADMIN_LOGIN:'true',MERGE_WINDOW_MS:'0',NOTIFY_TICK:'off'}
const fd=openSync(dir+'/server.log','w'),server=spawn(process.execPath,['--experimental-sqlite','apps/api/local-server.mjs'],{env,stdio:['ignore',fd,fd]}),results=[];let failed=false
console.log('Isolated regression: '+dir+' on '+base)
try{
 let healthy=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Test server exited');try{const r=await fetch(base+'/health'),d=await r.json();if(r.ok&&d.dataFile===dir+'/lucky-luxe.sqlite'){healthy=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}if(!healthy)throw Error('Isolated target health check failed')
 const seed=await fetch(base+'/admin/demo/full-seed',{method:'POST',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:'{}'});if(!seed.ok)throw Error('Isolated fixture seeding failed '+seed.status)
 for(const suite of suites){const log=openSync(dir+'/'+suite+'.log','w'),start=Date.now(),child=spawn(process.execPath,['--experimental-sqlite','apps/api/'+suite],{env,stdio:['ignore',log,log]}),timer=setTimeout(()=>child.kill('SIGTERM'),180000);const status=await new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));clearTimeout(timer);closeSync(log);const result={suite,...status,elapsedMs:Date.now()-start};results.push(result);console.log(JSON.stringify(result));if(status.code!==0){failed=true;break}}
}catch(e){failed=true;console.error(e.message)}finally{server.kill('SIGTERM');if(server.exitCode===null)await new Promise(r=>server.once('exit',r));closeSync(fd);writeFileSync(dir+'/results.json',JSON.stringify(results,null,2));console.log('Evidence retained: '+dir);process.exitCode=failed?1:0}
