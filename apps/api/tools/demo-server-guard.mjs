/* Local generator process guards. No product code imports this tool module. */
import {openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createConnection} from 'node:net';
import {requireTarget,requireSandbox} from '../../../tools/db-target.mjs';

// Resolve the two generator targets together; health checks below verify the child
// still owns this exact database before every write. Product servers never use it.
export function resolveDemoTargets(target, portValue=4368){
 const explicit=requireTarget({envName:'--dir',value:target,hint:'explicit absolute NEW demo directory'});
 if(!explicit.startsWith('/'))throw new Error('--dir must be an absolute NEW directory');
 const dir=resolve(explicit),dataDir=resolve(dir,'sandbox-data');
 const dbPath=requireSandbox(resolve(dataDir,'lucky-luxe.sqlite'),'consistent-demo');
 const port=Number(portValue);
 if(!Number.isInteger(port)||port<1024||port>65535||[4128,4310,4360].includes(port))throw new Error('Dedicated port required; existing user servers forbidden');
 return {dir,dataDir,dbPath,port,base:`http://127.0.0.1:${port}`,markerPath:resolve(dir,'consistent-demo.json')};
}

export function lockDemoPort(port){
 const path=join(tmpdir(),`youji-consistent-demo-port-${port}.lock`);
 let fd;try{fd=openSync(path,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error(`Demo generation port ${port} is locked; another generator may be running. Do not reuse it.`);throw e;}
 writeFileSync(fd,JSON.stringify({pid:process.pid,port}));closeSync(fd);
 let released=false;return()=>{if(!released){released=true;unlinkSync(path);}};
}
export async function assertDemoPortUnused(port){
 await new Promise((ok,no)=>{
  const socket=createConnection({host:'127.0.0.1',port});
  socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();no(new Error(`Port ${port} already serves a process; refusing to write`));});
  socket.once('error',e=>e.code==='ECONNREFUSED'?ok():no(e));socket.once('timeout',()=>{socket.destroy();no(new Error('Port probe timed out; refusing to assume it is free'));});
 });
}
export function assertDemoChildAlive(server){
 if(server.exitCode!==null||server.signalCode!==null||!server.pid)throw new Error(`Demo child exited (exit=${server.exitCode}, signal=${server.signalCode}); no request may target a replacement server`);
}
export async function assertDemoServerTarget({server,base,dbPath}){
 assertDemoChildAlive(server);
 const r=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});
 if(!r.ok)throw new Error('Demo child health not ready');
 const h=await r.json();assertDemoChildAlive(server);
 if(h.dataScopeName!=='sandbox'||typeof h.dataFile!=='string'||resolve(h.dataFile)!==resolve(dbPath))throw new Error(`Demo server database mismatch: expected ${dbPath}, got ${h.dataFile || '(missing)'}`);
 return h;
}
export async function waitForDemoServer(options){
 for(let n=0;n<150;n++){
  assertDemoChildAlive(options.server);
  try{return await assertDemoServerTarget(options);}catch(e){
   assertDemoChildAlive(options.server);
   if(e.message.includes('database mismatch'))throw e;
   if(n===149)throw new Error('Demo child did not become ready: '+e.message);
  }
  await new Promise(r=>setTimeout(r,100));
 }
}
