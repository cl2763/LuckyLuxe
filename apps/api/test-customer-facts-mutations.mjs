/* New guards must fail on the defects they claim to prevent. Each variant runs in
   a fresh Node process against in-memory SQLite; product files remain unchanged. */
import assert from 'node:assert/strict'
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const files=['customer-facts.mjs','membership-config.mjs','dashboard-pulse.mjs','test-customer-facts-timezone.mjs']
const cases=[
 ['未绑定重新误判新客','customer-facts.mjs',s=>s.replace("'未绑定微信'","'新客 · 未绑定'")],
 ['草稿重新混进累计消费','customer-facts.mjs',s=>s.replace("status='signed'","status IN ('signed','draft')")],
 ['未来预约重新冒充到店','customer-facts.mjs',s=>s.replace("ELSE NULL END","ELSE appointment_start END").replace('WHERE julianday(at)<=julianday(?)','WHERE ? IS NOT NULL')],
 ['充值重新按UTC日期归日','dashboard-pulse.mjs',s=>s.replace('inRange(tid, row.at, from, to) ? row.c', 'String(row.at).slice(0, 10) >= from && String(row.at).slice(0, 10) <= to ? row.c')],
 ['已到店重新依赖不存在的ARRIVED状态','customer-facts.mjs',s=>s.replace("status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED','AFTER_SALES')","status IN ('ARRIVED','COMPLETED')")],
 ['财务锁恢复旧黑名单导致差额泄漏','dashboard-pulse.mjs',s=>s.replace('metrics.map(({ key, unit }) => ({ key, unit, locked: true }))','metrics.map(({ value, spark, breakdown, ...rest }) => ({ ...rest, locked: true }))')],
 ['财务锁重新下发含金额的AI摘要','dashboard-pulse.mjs',s=>s.replace('if (financeLocked(tenantId)) return { line: null }','')],
 ['预约重新按UTC日期归日','dashboard-pulse.mjs',s=>s.replace('datedCount(bookingRows().all(tid), tid, from, to)', 'bookingRows().all(tid).filter(row => String(row.at).slice(0, 10) >= from && String(row.at).slice(0, 10) <= to).length')]
]
for(const [name,file,mutate] of cases){
 const dir=mkdtempSync('/tmp/ll-facts-mutation-')
 try {
  for(const f of files){const original=readFileSync(new URL(f,import.meta.url),'utf8');const value=f===file?mutate(original):original;if(f===file)assert.notEqual(value,original,'mutation must change actual source');writeFileSync(dir+'/'+f,value)}
  const result=spawnSync(process.execPath,['--experimental-sqlite',dir+'/test-customer-facts-timezone.mjs'],{encoding:'utf8'})
  assert.notEqual(result.status,0,name+' must be detected')
  assert.match(result.stderr,/AssertionError/,name+' must fail a behavioral assertion, not a loader error')
  console.log('ok - 反例被现有新判据检出: '+name)
 }finally{rmSync(dir,{recursive:true,force:true})}
}
console.log(`PASS ${cases.length} mutation checks`)
