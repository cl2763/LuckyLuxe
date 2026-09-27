import { insertNewCustomer } from './write-intake.mjs'

export function ensureCustomerCreateSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS customer_create_requests (
    tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, user_id TEXT NOT NULL,
    payload TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id,request_id))`)
}
import { validateCustomerInput } from './customer-input.mjs'
const comparable = value => String(value||'').replace(/[^\d]/g,'')
export function createCustomerCreator({db,apiError,randomId,maskPhone}) {
  return ({body,tenantId,role}) => {
    if (role !== 'owner') throw apiError(403,'FORBIDDEN','仅老板可新建顾客档案。')
    const input = validateCustomerInput(body,apiError)
    const key=String(body.requestId||'')
    if (!/^[a-zA-Z0-9_-]{12,100}$/.test(key)) throw apiError(400,'BAD_REQUEST','建档请求标识无效，请重新打开建档窗口。')
    const payload=JSON.stringify(input)
    db.exec('BEGIN IMMEDIATE')
    try {
      const prior=db.prepare('SELECT * FROM customer_create_requests WHERE tenant_id=? AND request_id=?').get(tenantId,key)
      if (prior) {
        if (prior.payload!==payload) throw apiError(409,'REQUEST_CONFLICT','这次请求的内容已变更，请重新打开建档窗口。')
        const row=db.prepare('SELECT id,display_name,phone FROM users WHERE id=? AND tenant_id=?').get(prior.user_id,tenantId)
        if (!row) throw apiError(409,'REQUEST_CONFLICT','这份档案已变更，请刷新客户档案。')
        db.exec('COMMIT');return {customer:{id:row.id,displayName:row.display_name,phone:row.phone},replayed:true}
      }
      const matches=input.phone ? db.prepare('SELECT id,display_name,phone FROM users WHERE tenant_id=? AND phone IS NOT NULL').all(tenantId).filter(r=>comparable(r.phone)===comparable(input.phone)) : []
      if (matches.length && body.allowDuplicatePhone!==true) throw apiError(409,'PHONE_EXISTS','本店已有相同联系电话的档案，请核对后选择。',{candidates:matches.map(r=>({id:r.id,displayName:r.display_name,phoneMasked:maskPhone(r.phone)}))})
      const id=randomId('user')
      insertNewCustomer(db,{id,displayName:input.displayName,body:input,tenantId})
      db.prepare('INSERT INTO customer_create_requests VALUES(?,?,?,?,?)').run(tenantId,key,id,payload,new Date().toISOString())
      db.exec('COMMIT');return {customer:{id,...input},replayed:false}
    } catch(e) {db.exec('ROLLBACK');throw e}
  }
}
