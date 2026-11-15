import {randomBytes,randomUUID,createHash} from 'node:crypto'
/** One invitation for one payer's complete visit. Tokens remain tenant/group scoped. */
export function createMemberDocumentBatch({db,documents,apiError,requireCustomer,currentTenantId,isUserBound}) {
 const hash=t=>createHash('sha256').update(String(t||'')).digest('hex')
 const rows=id=>db.prepare('SELECT * FROM member_service_documents WHERE group_id=? ORDER BY rowid').all(id)
 function group(id){const original=rows(id);if(!original.length)throw apiError(404,'NOT_FOUND','没有这批服务单。');const seen=new Set();function latest(row){if(row.status!=='voided'||seen.has(row.id))return [row];seen.add(row.id);const replacements=db.prepare("SELECT * FROM member_service_documents WHERE tenant_id=? AND user_id=? AND json_extract(quote_json,'$.replacesDocumentId')=? ORDER BY rowid").all(row.tenant_id,row.user_id,row.id);return replacements.length?replacements.flatMap(latest):[row]}const result=[...new Map(original.flatMap(latest).map(r=>[r.id,r])).values()];return result.filter(r=>r.status!=='voided'||!result.some(n=>n.status!=='voided'&&n.beneficiary_key===r.beneficiary_key))}
 function adminGroup(id,admin){const all=group(id);for(const row of all)documents.adminRow(row.id,admin);return all}
 function authorize(req,all,id){const token=req.headers['x-document-token'];if(token){
  const row=db.prepare('SELECT * FROM member_document_tokens WHERE token_hash=?').get(hash(token))
  if(!String(token).startsWith('group_')||!row||!row.active||row.expires_at<=new Date().toISOString())throw apiError(401,'DOCUMENT_LINK_EXPIRED','签署链接已失效，请重新打开订单。')
  const anchor=documents.get(row.document_id);if(anchor.group_id!==id||anchor.tenant_id!==all[0].tenant_id)throw apiError(403,'DOCUMENT_TOKEN_MISMATCH','不能查看其他服务单。')
 }else if(requireCustomer(req).id!==all[0].user_id)throw apiError(403,'DOCUMENT_OWNER_REQUIRED','只能由卡主本人查看。')}
 function view(all){return {groupId:all[0].group_id,documents:all.map(documents.shape),customerName:db.prepare('SELECT display_name FROM users WHERE id=? AND tenant_id=?').get(all[0].user_id,all[0].tenant_id)?.display_name||'',customerBound:isUserBound(all[0].user_id)}}
 function issue(all,id=all[0].group_id){const anchor=rows(id)[0],token='group_'+randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+30*60000).toISOString();db.prepare('INSERT INTO member_document_tokens VALUES(?,?,?,?,1)').run(hash(token),anchor.tenant_id,anchor.id,expiresAt);return {groupId:id,token,expiresAt,url:'/web/member-sign.html?group='+encodeURIComponent(id)+'#token='+encodeURIComponent(token)}}
 function deliver(id,admin,body){const all=adminGroup(id,admin);if(!all.some(r=>r.status==='pending_sign'))throw apiError(409,'DOCUMENT_NOT_PENDING','本次已没有待签单。');if(!isUserBound(all[0].user_id))throw apiError(409,'CUSTOMER_NOT_BOUND','请沿用现有扫码流程完成绑定。');
  const op=String(body.operationId||'');if(!/^[\w-]{1,64}$/.test(op))throw apiError(400,'OPERATION_ID_REQUIRED','请提供推送操作编号。')
  const messageId='member-doc-'+all[0].group_id+'-'+op,at=new Date().toISOString(),payload={text:'本次服务确认单已准备好，请核对全部项目及支付明细后逐张签署。',memberDocumentGroupId:id}
  const prior=db.prepare('SELECT id FROM notification_logs WHERE id=? AND tenant_id=? AND target_user_id=?').get(messageId,currentTenantId(),all[0].user_id)
  if(!prior)db.prepare("INSERT INTO notification_logs(id,tenant_id,task_id,rule_type,target_user_id,channel,status,payload_json,attempted_at,delivered_at) VALUES(?,?,?,?,?,'inapp','sent',?,?,?)").run(messageId,currentTenantId(),randomUUID(),'member_document_sign',all[0].user_id,JSON.stringify(payload),at,at)
  return {delivered:true,channel:'inapp',messageId,statusText:'已推送至本人站内消息和订单，等待签署。微信服务通知尚未发送。'}
 }
 return {adminView:(id,a)=>({...view(adminGroup(id,a)),groupId:id}),read:(id,req)=>{const all=group(id);authorize(req,all,id);return {...view(all),groupId:id}},archiveLink:(id,a)=>issue(adminGroup(id,a),id),merchantLink:(id,a)=>{const all=adminGroup(id,a);if(!isUserBound(all[0].user_id))throw apiError(409,'CUSTOMER_NOT_BOUND','请先完成顾客身份绑定。');return issue(all,id)},customerLink:(id,req)=>{const all=group(id);if(requireCustomer(req).id!==all[0].user_id)throw apiError(403,'DOCUMENT_OWNER_REQUIRED','只能查看本人服务单。');return issue(all,id)},deliver}
}
