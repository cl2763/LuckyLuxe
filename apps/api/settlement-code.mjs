import {randomInt} from 'node:crypto'
// Called inside the existing settlement write transaction. Preserve historical
// codes and the printed format; check the globally unique index, not one shop.
export function nextSettlementCode({db,tenantId,date,suffix=()=>randomInt(36**4).toString(36).padStart(4,'0').toUpperCase()}){
 const prefix=String(tenantId||'').replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase()||'LL'
 const exists=db.prepare('SELECT 1 FROM settlements WHERE code=?')
 for(let attempt=0;attempt<32;attempt++){
  const code=`${prefix}-${date.replace(/-/g,'')}-${suffix()}`
  if(!exists.get(code))return code
 }
 throw Object.assign(new Error('服务单号生成冲突，请重试。'),{status:503,code:'SETTLEMENT_CODE_RETRY'})
}
