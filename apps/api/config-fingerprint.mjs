import {createHash} from 'node:crypto'
export const configFingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Read-only revision discovery: no startup backfill or changes to merchant rows.
export function createConfigRevision(db){
 const tables=['record_lifecycle','stores','business_hours','store_special_dates','services','service_prices','service_price_systems','service_categories','membership_packages','recharge_package_discounts','coupons','points_prizes','technicians','technician_services','technician_schedules','tenant_settings']
 let sources,schemaVersion
 const cache=new Map()
 return tid=>{
  const schema=db.prepare('PRAGMA schema_version').get().schema_version
  if(schema!==schemaVersion){sources=tables.map(name=>({name,cols:db.prepare(`PRAGMA table_info("${name}")`).all().map(c=>c.name)})).filter(x=>x.cols.length);schemaVersion=schema;cache.clear()}
  const version=db.prepare('SELECT total_changes() n').get().n+':'+db.prepare('PRAGMA data_version').get().data_version
  if(cache.get(tid)?.version===version)return {revision:cache.get(tid).revision,checkedAt:new Date().toISOString()}
  const h=createHash('sha256')
  for(const {name,cols} of sources){
   const clause=cols.includes('tenant_id')?'tenant_id=?':cols.includes('store_id')?'store_id IN (SELECT id FROM stores WHERE tenant_id=?)':cols.includes('technician_id')?'technician_id IN (SELECT id FROM technicians WHERE tenant_id=?)':null
   if(!clause)continue
   h.update(name);h.update(JSON.stringify(db.prepare(`SELECT * FROM "${name}" WHERE ${clause} ORDER BY rowid`).all(tid)))
  }
  const revision=h.digest('hex');cache.set(tid,{version,revision});return {revision,checkedAt:new Date().toISOString()}
 }
}
