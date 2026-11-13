export function createMemberDocumentRoutes({db,policy,documents,json,readBody,currentTenantId,apiError,requireCustomer}) {
  const readInput=async req=>{const value=await readBody(req);if(!value||typeof value!=='object'||Array.isArray(value))throw apiError(400,'BAD_REQUEST','请求内容须为对象。');return value}
  return async function(req,res,{path,query={},adminSession}) {
    if(path==='/admin/member-pricing/documents') {
      if(req.method==='POST'){json(res,201,documents.create(await readInput(req),adminSession));return true}
      if(req.method==='GET') {
        const rows=db.prepare('SELECT id FROM member_service_documents WHERE tenant_id=? ORDER BY rowid DESC LIMIT 100').all(currentTenantId())
        json(res,200,{documents:rows.flatMap(r=>{try{return [documents.shape(documents.adminRow(r.id,adminSession))]}catch(e){if(e.status===403)return [];throw e}})});return true
      }
    }
    let match=path.match(/^\/admin\/member-pricing\/documents\/([^/]+)(?:\/(sign-link|void|requote|amend))?$/)
    if(match) {
      const id=decodeURIComponent(match[1])
      if(req.method==='GET'&&!match[2]){json(res,200,documents.shape(documents.adminRow(id,adminSession)));return true}
      if(req.method==='POST'&&match[2]==='sign-link'){json(res,201,documents.issueToken(id,adminSession));return true}
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
