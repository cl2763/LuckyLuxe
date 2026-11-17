import {beginWriteSavepoint} from './write-savepoint.mjs'
// Compatibility is derived on reads. Existing merchant settings are never backfilled at startup.
export function legacyDepositEnabled(db,tid) {
  const row=db.prepare("SELECT value FROM tenant_settings WHERE tenant_id=? AND key='booking_rules'").get(tid)
  if(!row)return true
  try{return JSON.parse(row.value||'{}').onlineDeposit!==false}catch{return true}
}
export function writeDepositConfig(db,tid,next,now) {
  beginWriteSavepoint(db, 'unified_deposit_switch', 'tenant_settings')
  try {
    const row=db.prepare("SELECT value FROM tenant_settings WHERE tenant_id=? AND key='booking_rules'").get(tid)
    let previous={};try{previous=JSON.parse(row?.value||'{}')}catch{}
    const put=db.prepare('INSERT INTO tenant_settings(tenant_id,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
    put.run(tid,'deposit_config',JSON.stringify(next),now)
    put.run(tid,'booking_rules',JSON.stringify({...previous,onlineDeposit:next.enabled}),now)
    db.exec('RELEASE unified_deposit_switch')
  }catch(e){db.exec('ROLLBACK TO unified_deposit_switch; RELEASE unified_deposit_switch');throw e}
}
