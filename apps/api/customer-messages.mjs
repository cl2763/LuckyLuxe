export function ensureCustomerMessageSchema(db) {
 db.exec('CREATE TABLE IF NOT EXISTS customer_message_reads(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,message_id TEXT NOT NULL,read_at TEXT NOT NULL,PRIMARY KEY(tenant_id,user_id,message_id))')
}
// Only delivered in-app records addressed to the authenticated customer.
export function customerMessages(req, res, {db, requireCustomer, resolveTenant, query, apiError, json, tenantTimezone, localParts, messageId}) {
  const user=requireCustomer(req),tid=resolveTenant(req,query)
  if(!db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(user.id,tid)) throw apiError(403,'FORBIDDEN','不能查看其他门店的消息。')
  if(messageId){
   const owned=db.prepare("SELECT id FROM notification_logs WHERE id=? AND tenant_id=? AND target_user_id=? AND channel='inapp' AND status='sent'").get(messageId,tid,user.id)
   if(!owned)throw apiError(404,'NOT_FOUND','消息不存在或无权查看。')
   db.prepare('INSERT OR IGNORE INTO customer_message_reads VALUES(?,?,?,?)').run(tid,user.id,messageId,new Date().toISOString())
   return json(res,200,{ok:true})
  }
  const receipts=new Map(db.prepare('SELECT message_id,read_at FROM customer_message_reads WHERE tenant_id=? AND user_id=?').all(tid,user.id).map(r=>[r.message_id,r.read_at]))
  const rows=db.prepare("SELECT id,payload_json,delivered_at FROM notification_logs WHERE tenant_id=? AND target_user_id=? AND channel='inapp' AND status='sent' ORDER BY delivered_at DESC,id DESC LIMIT 100").all(tid,user.id)
  const messages=rows.flatMap(r=>{let p;try{p=JSON.parse(r.payload_json)}catch{return []}return typeof p?.text==='string'&&p.text.trim()?[{id:r.id,readAt:receipts.get(r.id)||null,text:p.text,sentAt:r.delivered_at,timeText:r.delivered_at ? (()=>{const d=localParts(r.delivered_at,tenantTimezone(tid));return d.date+' '+d.time})() : ''}]:[]})
  return json(res,200,{messages,unreadCount:messages.filter(m=>!m.readAt).length})
}
