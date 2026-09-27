/* Local generator process guards. No product code imports this tool module. */
import {openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createConnection} from 'node:net';
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
