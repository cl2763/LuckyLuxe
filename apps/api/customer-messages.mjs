// Only delivered in-app records addressed to the authenticated customer.
export function customerMessages(req, res, {db, requireCustomer, resolveTenant, query, apiError, json, tenantTimezone, localParts}) {
  const user=requireCustomer(req),tid=resolveTenant(req,query)
  if(!db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(user.id,tid)) throw apiError(403,'FORBIDDEN','不能查看其他门店的消息。')
  const rows=db.prepare("SELECT id,payload_json,delivered_at FROM notification_logs WHERE tenant_id=? AND target_user_id=? AND channel='inapp' AND status='sent' ORDER BY delivered_at DESC,id DESC LIMIT 100").all(tid,user.id)
  const messages=rows.flatMap(r=>{let p;try{p=JSON.parse(r.payload_json)}catch{return []}return typeof p?.text==='string'&&p.text.trim()?[{id:r.id,text:p.text,sentAt:r.delivered_at,timeText:r.delivered_at ? (()=>{const d=localParts(r.delivered_at,tenantTimezone(tid));return d.date+' '+d.time})() : ''}]:[]})
  return json(res,200,{messages})
}
