/** Additive entry metadata. Historical settlements remain on their existing reader. */
export function memberDocumentRootGroup(db,row){const seen=new Set();while(!seen.has(row.id)){seen.add(row.id);const previous=JSON.parse(row.quote_json).replacesDocumentId;if(!previous)break;const old=db.prepare('SELECT * FROM member_service_documents WHERE id=? AND tenant_id=? AND user_id=?').get(previous,row.tenant_id,row.user_id);if(!old)break;row=old}return row.group_id}
export function memberDocumentSummary(db,bookingId,tenantId,money) {
 const linked=db.prepare(`SELECT DISTINCT d.* FROM member_service_documents d JOIN member_document_components c ON c.document_id=d.id JOIN settlements s ON s.id=c.settlement_id WHERE s.booking_id=? AND s.tenant_id=? AND d.tenant_id=? ORDER BY d.rowid`).all(bookingId,tenantId,tenantId)
 if(!linked.length)return null
 const roots=[...new Set(linked.map(row=>memberDocumentRootGroup(db,row)))],seen=new Set();function latest(row){if(seen.has(row.id))return [];seen.add(row.id);if(row.status!=='voided')return [row];return db.prepare("SELECT * FROM member_service_documents WHERE tenant_id=? AND user_id=? AND json_extract(quote_json,'$.replacesDocumentId')=? ORDER BY rowid").all(tenantId,row.user_id,row.id).flatMap(latest)}
 const rows=roots.flatMap(id=>db.prepare('SELECT * FROM member_service_documents WHERE group_id=? AND tenant_id=? ORDER BY rowid').all(id,tenantId)).flatMap(latest)
 if(!rows.length)return null
 const documents=rows.map(row=>{const q=JSON.parse(row.signed_json||row.quote_json);return {id:row.id,groupId:row.group_id,name:q.display?.beneficiaryName||q.name,status:row.status,statusText:row.status==='signed'?'已签署':'待签署',items:q.display?.lines.map(l=>l.name).join('、')||'',amountText:money(q.totalCents-q.rechargeCents-q.purchaseCents),containsRecharge:q.rechargeCents>0}})
 const signed=documents.filter(d=>d.status==='signed').length
 return {groupId:roots[0],documents,statusText:`已签 ${signed}/${documents.length} 张`,actionText:signed===documents.length?'查看本次全部服务单':'核对本次全部服务单'}
}
export function dailyMemberDocuments(db,rows,tenantId,money,amendmentShape){
 const found=new Map();for(const r of rows){const link=db.prepare('SELECT d.* FROM member_document_components c JOIN member_service_documents d ON d.id=c.document_id WHERE c.settlement_id=? AND d.tenant_id=?').get(r.id,tenantId);if(link&&!found.has(link.id))found.set(link.id,link)}
 return [...found.values()].map(d=>{const q=JSON.parse(d.signed_json||d.quote_json),components=db.prepare('SELECT s.* FROM settlements s JOIN member_document_components c ON c.settlement_id=s.id WHERE c.document_id=? ORDER BY c.component_index').all(d.id),amount=components.reduce((n,c)=>n+(amendmentShape(c).actualDueCents??c.total_cents)-(JSON.parse(c.recharge_json||'null')?.amountCents||0)-(JSON.parse(c.purchase_json||'null')?.priceCents||0),0);return {id:d.id,groupId:d.group_id,code:components[0]?.code,name:q.display?.beneficiaryName,discountText:q.display?.discountText,amountText:money(amount),projectCount:components.length,items:q.display?.lines.map(l=>l.name).join('、')||'',note:'服务按人合单签署；下方项目分配保留各项目技师归属。'}})
}
