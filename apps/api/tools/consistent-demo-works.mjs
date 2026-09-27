#!/usr/bin/env node
/* Only adds explicitly labelled vector test works to this generator's isolated
 * mock bookings, through the normal upload/review API. Never edits any ledger. */
import {readFileSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const tenant='demo-ai',batch='consistent-demo-v1';
function vector(index,variant=0){
 const colors=[['#ceb7a1','#76524d'],['#c8bbd6','#635174'],['#c7d8d0','#516e64']];
 const [paper,ink]=colors[index%3];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><rect width="900" height="1200" fill="${paper}"/><rect x="56" y="56" width="788" height="1088" rx="28" fill="none" stroke="${ink}" stroke-width="2"/><text x="100" y="145" font-family="sans-serif" font-size="28" fill="${ink}">YOUJI / VECTOR TEST ${index+1}.${variant+1}</text><circle cx="450" cy="470" r="218" fill="${ink}" opacity=".10"/>${[0,1,2,3,4].map((n)=>`<rect x="${182+n*110}" y="${332+Math.abs(n-2)*24}" width="85" height="${270-Math.abs(n-2)*24}" rx="42" fill="${ink}" opacity="${.35+n*.10}"/>`).join('')}<text x="450" y="796" text-anchor="middle" font-family="sans-serif" font-size="76" font-weight="700" fill="${ink}">DEMO</text><text x="450" y="870" text-anchor="middle" font-family="sans-serif" font-size="40" fill="${ink}">演示作品</text><text x="450" y="954" text-anchor="middle" font-family="sans-serif" font-size="24" fill="${ink}">矢量测试图 · 非真实顾客照片</text><text x="450" y="1060" text-anchor="middle" font-family="sans-serif" font-size="22" fill="${ink}">LAYOUT SAMPLE ${variant+1} / 3</text></svg>`;
 return 'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
}
export async function seedDemoWorks({dir,owner='consistent-demo-local-only'}={}){
 if(!dir||!String(dir).startsWith('/'))throw new Error('Explicit absolute demo directory required');
 dir=resolve(dir);const marker=JSON.parse(readFileSync(resolve(dir,'consistent-demo.json'),'utf8'));
 if(marker.generator!=='youji-consistent-demo-v1'||!['ready','building'].includes(marker.state)||!Number.isInteger(marker.port)||marker.port<1024||[4128,4310,4360].includes(marker.port))throw new Error('Recognized isolated demo marker and dedicated port required');
 const dataDir=resolve(dir,'sandbox-data');if(marker.dataDir!==dataDir||realpathSync(dataDir)!==dataDir)throw new Error('Demo path mismatch');
 const db=new DatabaseSync(resolve(dataDir,'lucky-luxe.sqlite'),{readOnly:true});
 try{
  if(db.prepare('SELECT kind FROM tenants WHERE id=?').get(tenant)?.kind!=='demo')throw new Error('Must be explicit demo tenant');
  const fingerprint=()=>createHash('sha256').update(JSON.stringify(['finance_transactions','stored_value_transactions','settlements','settlement_payments','settlement_items','settlement_technicians','daily_closes','daily_close_lines','points_transactions'].map(t=>({table:t,rows:db.prepare(`SELECT * FROM ${t} WHERE tenant_id=? ORDER BY rowid`).all(tenant)})))).digest('hex');
  const before=fingerprint(),manifestPath=resolve(dir,'demo-works.json');
  const base='http://127.0.0.1:'+marker.port;
  async function req(path,{method='GET',body}={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+owner,'content-type':'application/json','x-admin-tenant-id':tenant,'x-tenant-id':tenant,'x-demo-seed':batch},body:body&&JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(`${path}: ${r.status} ${JSON.stringify(d)}`);return d;}
  const health=await req('/health');if(health.dataScopeName!=='sandbox'||health.dataFile!==resolve(dataDir,'lucky-luxe.sqlite'))throw new Error('API must report sandbox scope');
  const choices=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')).works:db.prepare("SELECT id FROM bookings WHERE tenant_id=? AND demo_seed=? AND status='COMPLETED' ORDER BY appointment_start DESC,id LIMIT 5").all(tenant,batch).map((r,index)=>({bookingId:r.id,state:index<3?'approved':index===3?'pending':'empty',index}));
  if(choices.length!==5)throw new Error('Five API-generated completed bookings required');
  for(const c of choices){
   const row=db.prepare('SELECT * FROM bookings WHERE id=? AND tenant_id=? AND demo_seed=?').get(c.bookingId,tenant,batch);if(!row)throw new Error('Refusing unknown/non-mock booking');
   // API must resolve exactly the randomly generated booking from this sandbox.
   const fetched=await req('/bookings/'+c.bookingId);if(fetched.booking?.id!==row.id)throw new Error('API/database target mismatch');
   const existing=JSON.parse(row.work_images_json||'[]');
   if(c.state==='empty'){if(existing.length)throw new Error('Empty-state example has since been edited; refusing overwrite');continue;}
   const images=Array.from({length:c.state==='approved'?3:1},(_,i)=>vector(c.index,i));
   if(row.gallery_status==='approved'){
    if(c.state!=='approved'||JSON.stringify(JSON.parse(row.approved_work_images_json||'[]'))!==JSON.stringify(images))throw new Error('Approved images were changed; refusing overwrite');
    continue;
   }
   if(existing.length&&JSON.stringify(existing)!==JSON.stringify(images))throw new Error('Existing work images are not this mock; refusing overwrite');
   if(!existing.length)await req('/admin/bookings/'+c.bookingId+'/work-images',{method:'PATCH',body:{workImages:images}});
   if(c.state==='approved')await req('/admin/bookings/'+c.bookingId+'/gallery-approval',{method:'PATCH',body:{images}});
  }
  const after=fingerprint();if(after!==before)throw new Error('Money/settlement evidence changed unexpectedly');
  const works=choices.map(c=>({...c,url:base+'/share.html?bookingId='+encodeURIComponent(c.bookingId)+'&store='+tenant+'&audience=staff'}));
  const result={label:'明确标注 DEMO / 演示作品的矢量测试图',base,tenant,works,moneyEvidenceUnchanged:true};
  writeFileSync(manifestPath,JSON.stringify(result,null,2));return result;
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dir=process.argv.find(x=>x.startsWith('--dir='))?.slice(6);console.log(JSON.stringify(await seedDemoWorks({dir}),null,2));
}
