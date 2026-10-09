import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'

// A disposable CI database reproduces returning customers, a synthetic demo
// OpenID on a cardholder, and a different real identity. No live database is contacted.
let checks = 0
const verify = (name, actual, expected) => { assert.equal(actual, expected, name); console.log(`ok ${++checks} - ${name}`) }
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.demo-claim-'))
const port = 47000 + Math.floor(Math.random() * 1000)
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: new URL('.', import.meta.url).pathname,
  env: { ...process.env, PORT:String(port), DATA_DIR:dir, OWNER_TOKEN:'demo-claim-test-token',
    WECHAT_MINI_TOKEN_SECRET:'demo-claim-test-secret', ALLOW_DEMO_ADMIN_LOGIN:'true', NOTIFY_TICK:'off' },
  stdio:'ignore'
})
const base = `http://127.0.0.1:${port}`
const ownerToken = 'demo-claim-test-token'
const wait = ms => new Promise(resolve => setTimeout(resolve,ms))
const request = async (path, code, auth) => {
  const response = await fetch(base+path, code ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})}
    : {headers:auth?{authorization:`Bearer ${auth}`}:{}})
  return {status:response.status,data:await response.json()}
}
const uid = n => `demo-ai-cust-${n}`
const scene = id => `m${id.replace(/[^a-z0-9]/gi,'').slice(-8).toUpperCase().padStart(8,'0')}`
try {
  let up=false
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok){up=true;break}}catch{} await wait(250)}
  verify('isolated server started', up, true)
  const db = new DatabaseSync(join(dir,'lucky-luxe.sqlite'))
  db.prepare("UPDATE tenants SET kind='demo' WHERE id='lucky-luxe'").run()
  const add = async (n, fakeOpenId='') => {
    const response=await fetch(base+'/admin/customers',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${ownerToken}`},body:JSON.stringify({displayName:`演示顾客${n}`,phone:`1380000${String(n).padStart(4,'0')}`,requestId:`demo-claim-customer-${n}`})})
    const data=await response.json()
    verify(`create disposable customer ${n}`, response.status, 201)
    const id=data.customer.id
    if(fakeOpenId) verify(`prepare customer identity ${n}`, (await request(`/scan/${scene(id)}/claim`,'stub:'+fakeOpenId)).status, 200)
    return id
  }
  const ordinary=await add(14)
  const cardholder=await add(7,`demo-openid-${uid(7)}`)
  const realOther=await add(22,'real-other-wechat-id')
  const first=await request(`/scan/${scene(ordinary)}/claim`,'stub:real-person-ordinary')
  verify('ordinary returning customer may claim', first.status, 200)
  verify('claim retains original ordinary profile', first.data.user.id, ordinary)
  verify('ordinary profile stores real identity', db.prepare('SELECT wechat_open_id FROM users WHERE id=?').get(ordinary).wechat_open_id, 'real-person-ordinary')
  verify('claim preserves original phone', db.prepare('SELECT phone FROM users WHERE id=?').get(ordinary).phone, '13800000014')
  const repeat=await request(`/scan/${scene(ordinary)}/claim`,'stub:real-person-ordinary')
  verify('repeat claim is idempotent', repeat.data.alreadyBound, true)
  const member=await request(`/scan/${scene(cardholder)}/claim`,'stub:real-person-member')
  verify('synthetic member identity may be claimed', member.status, 200)
  verify('member claim retains original profile', member.data.user.id, cardholder)
  verify('member profile stores real identity', db.prepare('SELECT wechat_open_id FROM users WHERE id=?').get(cardholder).wechat_open_id, 'real-person-member')
  verify('member identity is not duplicated', db.prepare("SELECT COUNT(*) AS n FROM user_identities WHERE user_id=? AND provider='wechat_miniprogram'").get(cardholder).n, 1)
  const protectedClaim=await request(`/scan/${scene(realOther)}/claim`,'stub:different-person')
  verify('different real identity cannot take profile', protectedClaim.status, 409)
  verify('conflict preserves existing real identity', db.prepare('SELECT wechat_open_id FROM users WHERE id=?').get(realOther).wechat_open_id, 'real-other-wechat-id')
  db.close()
  console.log('ok: demo ordinary/member claims bind original rows; repeat is idempotent; real identity conflict remains blocked')
} finally {
  child.kill('SIGTERM')
  await wait(200)
  rmSync(dir,{recursive:true,force:true})
}
