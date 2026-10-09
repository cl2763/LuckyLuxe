import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { miniCodeScope, demoLoginAllowed } from './data-scope.mjs'
import { storeCodeInfo, storeForScene } from './store-code.mjs'
import { getMiniCode, codeEnvironment } from './wechat-mini-code.mjs'
import { customerVisitDaysCount, lastCustomerVisitAt } from './customer-facts.mjs'
const require=createRequire(import.meta.url), nav=require('../../miniprogram/pages/portfolio/navigation.js')
let checks=0
const test=(name,fn)=>{fn();console.log(`ok ${++checks} - ${name}`)}
const exp={NODE_ENV:'production',RAILWAY_ENVIRONMENT:'experience',RAILWAY_ENVIRONMENT_NAME:'experience'}
const prod={NODE_ENV:'production',RAILWAY_ENVIRONMENT:'production',RAILWAY_ENVIRONMENT_NAME:'production'}
test('Railway hardened experience targets trial codes',()=>assert.equal(miniCodeScope('sandbox',exp),'experience'))
for(const scope of ['local','production','unknown']) test('experience name cannot switch real data '+scope,()=>assert.equal(miniCodeScope(scope,exp),'production'))
for(const scope of ['local','sandbox','production']) test('production QR remains release '+scope,()=>assert.equal(miniCodeScope(scope,prod),'production'))
test('development CI targets trial',()=>assert.equal(miniCodeScope('ci',{}),'ci'))
test('QR fix cannot open real demo auth gate',()=>assert.equal(demoLoginAllowed({dataDir:'/app/local-data',env:{...exp,ALLOW_DEMO_ADMIN_LOGIN:'true'}}),false))
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE tenants(id TEXT,name TEXT,kind TEXT,status TEXT);
INSERT INTO tenants VALUES ('star','Star','demo_ai','active'),('real','Real','real','active');
CREATE TABLE bookings(id TEXT,user_id TEXT,tenant_id TEXT,status TEXT,appointment_start TEXT,arrived_at TEXT);
CREATE TABLE settlements(id TEXT,user_id TEXT,tenant_id TEXT,booking_id TEXT,status TEXT,created_at TEXT,signed_at TEXT);`)
const error=(status,code,message)=>Object.assign(new Error(message),{status,code})
const info=storeCodeInfo(db,'star',miniCodeScope('sandbox',exp),error)
test('same deployed scope admits experience store code',()=>assert.equal(info.envVersion,'trial'))
test('same code resolves experience store entry',()=>assert.equal(storeForScene(db,info.scene,miniCodeScope('sandbox',exp)).id,'star'))
test('demo store remains excluded from formal production',()=>assert.throws(()=>storeCodeInfo(db,'star',miniCodeScope('local',prod),error),/不可用/))
test('real production store targets release',()=>assert.equal(storeCodeInfo(db,'real',miniCodeScope('local',prod),error).envVersion,'release'))
test('production review code may target trial without changing data scope',()=>assert.equal(codeEnvironment('production','trial'),'trial'))
test('formal code defaults to release',()=>assert.equal(codeEnvironment('production',null),'release'))
test('invalid QR environment cannot enter arbitrary version',()=>assert.equal(codeEnvironment('production','sandbox'),'release'))
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(120)])
for(const kind of ['p','m','s','b','d']) {
 const scene=kind==='m'?'mDIT03LTK':kind+'a'.repeat(24), bodies=[]
 await getMiniCode({appid:'scope18',secret:'test',scene,envVersion:miniCodeScope('sandbox',exp)==='production'?'release':'trial',fetcher:async(url,opts)=>{
  if(url.includes('/cgi-bin/token'))return {ok:true,json:async()=>({access_token:'test',expires_in:7200})}
  bodies.push(JSON.parse(opts.body));return {ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>png}
 }})
 test(kind+' code uses trial and does not require released page',()=>{assert.equal(bodies[0].env_version,'trial');assert.equal(bodies[0].check_path,false)})
}
const book=(id,date,status='COMPLETED',arrived=null,tenant='a')=>db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?)').run(id,'u',tenant,status,date,arrived)
const sign=(id,booking,signed,created=signed,status='signed',tenant='a')=>db.prepare('INSERT INTO settlements VALUES(?,?,?,?,?,?,?)').run(id,'u',tenant,booking,status,created,signed)
const localParts=(at,tz)=>({date:new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))})
const now=new Date('2026-10-08T22:00:00Z'),count=(at=now,tz='America/Toronto')=>customerVisitDaysCount(db,'u','a',tz,localParts,at)
book('early','2026-10-12T21:30:00Z');sign('s1','early','2026-10-08T20:55:00Z')
test('future appointment already signed counts actual visit now',()=>assert.equal(count(),1))
test('last visit also uses actual early completion',()=>assert.equal(lastCustomerVisitAt(db,'u','a',now),'2026-10-08T20:55:00.000Z'))
test('passing original appointment date cannot add second visit',()=>assert.equal(count(new Date('2026-10-13T00:00:00Z')),1))
db.prepare("UPDATE settlements SET status='amended' WHERE id='s1'").run()
sign('s1-corrected','early','2026-10-10T20:00:00Z')
test('later correction of early-completed visit does not invent another visit',()=>assert.equal(count(new Date('2026-10-13T00:00:00Z')),1))
sign('s2',null,'2026-10-08T21:00:00Z')
test('multiple signed services on same day count once',()=>assert.equal(count(),1))
book('late','2026-10-06T19:00:00Z');sign('s3','late','2026-10-08T21:00:00Z','2026-10-06T19:00:00Z')
test('late signature keeps historical service day',()=>assert.equal(count(),2))
book('future','2026-10-15T12:00:00Z','CONFIRMED');book('fake','2026-10-15T12:00:00Z');book('cancel','2026-10-07T12:00:00Z','CANCELLED');sign('void',null,'2026-10-07T12:00:00Z',undefined,'voided');sign('other',null,'2026-10-07T12:00:00Z',undefined,'signed','b')
test('unrealized future, cancelled, voided and foreign records excluded',()=>assert.equal(count(),2))
book('arrived','2026-10-15T12:00:00Z','COMPLETED','2026-10-07T23:55:00Z');sign('arr','arrived','2026-10-08T00:10:00Z')
test('early service with arrival uses actual arrival day',()=>assert.equal(count(),3))
test('timezone natural-day deduplication',()=>assert.equal(count(now,'Asia/Shanghai'),3))
test('missing customer is zero',()=>assert.equal(customerVisitDaysCount(db,'missing','a','UTC',localParts,now),0))
const works=Array.from({length:7},(_,i)=>({id:String(i),albumId:i<3?'visit1':i<5?'visit2':'visit3',image:'photo'+i,technician:{id:i<5?'A':'B'}}))
let albums=nav.albumsOf(works)
test('albums never merge different services by same technician',()=>assert.deepEqual(albums.map(a=>a.works.length),[3,2,2]))
albums=nav.moveAlbum(albums,'visit1',1)
test('one click advances exactly one photo in one card',()=>assert.equal(albums[0].current.id,'1'))
albums=nav.moveAlbum(albums,'visit1',9)
test('last photo clamps without empty card',()=>assert.equal(albums[0].current.id,'2'))
test('moving one card cannot change its neighbor',()=>assert.equal(albums[1].current.id,'3'))
test('enlarged next remains in the same service',()=>assert.equal(nav.previewOf(works,works[1],1).work.id,'2'))
test('enlarged last cannot enter same technician other service',()=>assert.equal(nav.previewOf(works,works[2],1).work.id,'2'))
test('enlarged previous first remains valid',()=>assert.equal(nav.previewOf(works,works[0],-1).work.id,'0'))
test('empty albums are excluded',()=>assert.equal(nav.albumsOf([{id:'empty'}]).length,0))
test('single photo remains navigable without a next item',()=>assert.equal(nav.previewOf([works[0]],works[0],1).total,1))
const {buildOwnerHome}=require('../../miniprogram/utils/dashboard-view.js')
const labels=['00:00–04:00','04:00–08:00','08:00–12:00','12:00–16:00','16:00–20:00','20:00–24:00']
const home=buildOwnerHome({pulse:{metrics:[{key:'visits',unit:'people',value:1,spark:[0,1,0,0,null,null],sparkDates:labels.map(()=> '2026-10-08'),sparkLabels:labels}]},headKey:'visits',period:'today',now:{},todo:{}})
test('intraday labels split into two nonoverlapping short lines',()=>assert.deepEqual(home.sparkTicks.map(t=>[t.label,t.labelEnd]),labels.map(l=>l.split('–'))))
test('same-day tick rendering keys are unique',()=>assert.equal(new Set(home.sparkTicks.map(t=>t.tickId)).size,6))
db.close();console.log(`PASS ${checks} checks`)
