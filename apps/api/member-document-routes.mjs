import {createMemberDocumentBatch} from './member-document-batch.mjs'
export function createMemberDocumentRoutes({db,policy,documents,json,readBody,currentTenantId,apiError,requireCustomer,isUserBound}) {
  const batch=createMemberDocumentBatch({db,documents,apiError,requireCustomer,currentTenantId,isUserBound})
  const readInput=async req=>{const value=await readBody(req);if(!value||typeof value!=='object'||Array.isArray(value))throw apiError(400,'BAD_REQUEST','请求内容须为对象。');return value}
  return async function(req,res,{path,query={},adminSession}) {
    const legacy=path.match(/^\/(my|admin)\/settlements\/([^/]+)\/(sign-link|document-link|sign-token|snapshots)$/)
    if(legacy && ((req.method==='GET'&&['document-link','snapshots'].includes(legacy[3]))||req.method==='POST')) {
      const key=decodeURIComponent(legacy[2]),row=db.prepare('SELECT d.* FROM member_document_components c JOIN settlements s ON s.id=c.settlement_id JOIN member_service_documents d ON d.id=c.document_id WHERE (s.code=? OR s.id=?)').get(key,key)
      if(row){const link=legacy[1]==='admin'?(legacy[3]==='snapshots'?batch.archiveLink(row.group_id,adminSession):batch.merchantLink(row.group_id,adminSession)):batch.customerLink(row.group_id,req);json(res,200,{...link,memberDocumentGroupId:row.group_id}, {'cache-control':'no-store'});return true}
    }
    let bm=path.match(/^\/admin\/member-pricing\/groups\/([^/]+)(?:\/(sign-link|archive-link|deliver))?$/)
    if(bm){const id=decodeURIComponent(bm[1]);if(req.method==='GET'&&!bm[2]){json(res,200,batch.adminView(id,adminSession));return true}if(req.method==='POST'&&bm[2]){json(res,200,bm[2]==='deliver'?batch.deliver(id,adminSession,await readInput(req)):bm[2]==='archive-link'?batch.archiveLink(id,adminSession):batch.merchantLink(id,adminSession),{'cache-control':'no-store'});return true}}
    bm=path.match(/^\/my\/member-document-groups\/([^/]+)\/sign-link$/)
    if(bm&&req.method==='POST'){json(res,200,batch.customerLink(decodeURIComponent(bm[1]),req),{'cache-control':'no-store'});return true}
    bm=path.match(/^\/member-document-groups\/([^/]+)$/)
    if(bm&&req.method==='GET'){json(res,200,batch.read(decodeURIComponent(bm[1]),req),{'cache-control':'no-store'});return true}
    if(path==='/admin/member-pricing/documents') {
      if(req.method==='POST'){json(res,201,documents.create(await readInput(req),adminSession));return true}
      if(req.method==='GET') {
        const rows=db.prepare('SELECT id FROM member_service_documents WHERE tenant_id=? ORDER BY rowid DESC LIMIT 100').all(currentTenantId())
        json(res,200,{documents:rows.flatMap(r=>{try{return [documents.shape(documents.adminRow(r.id,adminSession))]}catch(e){if(e.status===403)return [];throw e}})});return true
      }
    }
    let match=path.match(/^\/admin\/member-pricing\/documents\/([^/]+)(?:\/(sign-link|void|requote|amend|amend-preview|review|refresh))?$/)
    if(match) {
      const id=decodeURIComponent(match[1])
      if(req.method==='GET'&&match[2]==='review'){json(res,200,documents.review(id,adminSession));return true}
      if(req.method==='POST'&&match[2]==='refresh'){json(res,200,documents.refresh(id,await readInput(req),adminSession));return true}
      if(req.method==='GET'&&!match[2]){json(res,200,documents.shape(documents.adminRow(id,adminSession)));return true}
      if(req.method==='POST'&&match[2]==='sign-link'){json(res,201,documents.issueToken(id,adminSession));return true}
      if(req.method==='POST'&&match[2]==='amend-preview'){json(res,200,documents.amendPreview(id,await readInput(req),adminSession));return true}
      if(req.method==='POST'&&match[2]==='amend'){json(res,200,documents.amend(id,await readInput(req),adminSession));return true}
      if(req.method==='POST'&&match[2]==='requote'){json(res,201,documents.requote(id,await readInput(req),adminSession));return true}
      if(req.method==='POST'&&match[2]==='void'){json(res,200,documents.voidDocument(id,await readInput(req),adminSession));return true}
    }
    if(path==='/my/member-pricing'&&req.method==='GET'){const customer=requireCustomer(req);const user=db.prepare('SELECT tenant_id FROM users WHERE id=?').get(customer.id);json(res,200,policy.discount(user.tenant_id,customer.id),{'cache-control':'no-store'});return true}
    if(path==='/my/member-documents'&&req.method==='GET') {
      const customer=requireCustomer(req)
      const rows=db.prepare('SELECT * FROM member_service_documents WHERE user_id=? ORDER BY rowid DESC LIMIT 100').all(customer.id)
      json(res,200,{documents:rows.map(documents.shape)},{'cache-control':'no-store'});return true
    }
    match=path.match(/^\/member-documents\/([^/]+)(?:\/(sign|snapshot))?$/)
    if(!match)return false
    const id=decodeURIComponent(match[1]),row=documents.get(id)
    if(req.method==='POST'&&match[2]==='sign'){json(res,200,documents.sign(id,await readInput(req),req),{'cache-control':'no-store'});return true}
    documents.authorize(req,row)
    if(req.method==='GET') {
      if(match[2]==='snapshot'&&!row.signed_json)throw apiError(404,'NOT_SIGNED','这张单还没有已签凭证。')
      json(res,200,match[2]==='snapshot'?JSON.parse(row.signed_json):documents.shape(row),{'cache-control':'no-store'});return true
    }
    return false
  }
}
