import {createSetupReviewStatus} from './platform-setup-review-status.mjs'
import {setupDeliveryInfo} from './setup-delivery-info.mjs'
import {setupReviewRows} from './setup-review-presentation.mjs'
import {validateSetupBody} from './platform-setup-validation.mjs'
import {createHash,randomBytes} from 'node:crypto'
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v
const fingerprint=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')
export function createSetupWorkflow({db,apiError,json,getSetupAdapters,getEntitlements,tenantContext,currencyOf=()=>'',platformOperator=()=> 'platform'}){
  db.exec(`CREATE TABLE IF NOT EXISTS platform_setup_drafts (
    id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,module TEXT NOT NULL,target_id TEXT,revision INTEGER NOT NULL,
    base_hash TEXT NOT NULL,base_json TEXT NOT NULL,body_json TEXT NOT NULL,proposed_json TEXT NOT NULL,
    source_json TEXT NOT NULL DEFAULT '[]',source_note TEXT NOT NULL DEFAULT '',owner_feedback TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,applied_at TEXT,result_json TEXT);
    CREATE TABLE IF NOT EXISTS platform_setup_events (
    id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,draft_id TEXT NOT NULL,action TEXT NOT NULL,
    operator TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS platform_setup_events_no_update BEFORE UPDATE ON platform_setup_events BEGIN SELECT RAISE(ABORT,'setup audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS platform_setup_events_no_delete BEFORE DELETE ON platform_setup_events BEGIN SELECT RAISE(ABORT,'setup audit is append-only'); END;`)
  try{db.exec("ALTER TABLE platform_setup_drafts ADD COLUMN source_json TEXT NOT NULL DEFAULT '[]'")}catch(e){if(!/duplicate column/i.test(e.message))throw e}
  try{db.exec("ALTER TABLE platform_setup_drafts ADD COLUMN source_note TEXT NOT NULL DEFAULT ''")}catch(e){if(!/duplicate column/i.test(e.message))throw e}
  try{db.exec("ALTER TABLE platform_setup_drafts ADD COLUMN owner_feedback TEXT NOT NULL DEFAULT ''")}catch(e){if(!/duplicate column/i.test(e.message))throw e}
  const now=()=>new Date().toISOString(),id=()=>randomBytes(18).toString('hex')
  function adapter(tid,key){
    if(!db.prepare("SELECT id FROM tenants WHERE id=? AND status='active'").get(tid))throw apiError(404,'NOT_FOUND','门店不存在或已停用。')
    const a=getSetupAdapters()[key]
    if(!a)throw apiError(404,'NOT_FOUND','没有这个配置模块。')
    if(a.feature&&!getEntitlements(tid).features[a.feature]?.enabled)throw apiError(403,'FEATURE_NOT_ENABLED','本店尚未开通这个模块。')
    return a
  }
  const run=(tid,fn)=>tenantContext.run({tenantId:tid},fn)
  const configFingerprint=(a,value)=>fingerprint(a.conflictData?a.conflictData(value):value)
  function snapshot(tid,a){return run(tid,()=>a.read(tid))}
  function row(tid,draftId){const r=db.prepare('SELECT * FROM platform_setup_drafts WHERE tenant_id=? AND id=?').get(tid,draftId);if(!r)throw apiError(404,'NOT_FOUND','配置草稿不存在。');return r}
  function serialize(r){const needsOwnerConfirmation=!!getSetupAdapters()[r.module]?.ownerConfirmation;return {ownerFeedback:r.owner_feedback||'',sourceNote:r.source_note||'',sources:JSON.parse(r.source_json||'[]'),needsOwnerConfirmation,ownerConfirmed:!!db.prepare("SELECT 1 FROM platform_setup_events WHERE tenant_id=? AND draft_id=? AND action='owner_confirmed' AND revision=?").get(r.tenant_id,r.id,r.revision),id:r.id,tenantId:r.tenant_id,module:r.module,targetId:r.target_id,revision:r.revision,status:r.status,base:JSON.parse(r.base_json),proposed:JSON.parse(r.proposed_json),body:JSON.parse(r.body_json),updatedAt:r.updated_at,appliedAt:r.applied_at,result:r.result_json?JSON.parse(r.result_json):null}}
  function presentDraft(r){const draft=serialize(r),tid=r.tenant_id;return {...draft,...(draft.status==='draft'&&getSetupAdapters()[r.module]?.impact?{impact:run(tid,()=>getSetupAdapters()[r.module].impact(tid,draft.body))}:{}),title:getSetupAdapters()[r.module]?.title||r.module,changes:setupReviewRows(draft,{currency:currencyOf(tid),technicianName:id=>referenceName(tid,'technicianId',id),referenceName:(key,id)=>referenceName(tid,key,id)})}}
  function event(tid,draftId,action,operator,revision){db.prepare('INSERT INTO platform_setup_events VALUES(?,?,?,?,?,?,?)').run(id(),tid,draftId,action,operator,revision,now())}
  function preview(tid,draftId,request={}){
    const r=row(tid,draftId),a=adapter(tid,r.module)
    if(r.status!=='draft')throw apiError(409,'DRAFT_NOT_ACTIVE','这份草稿已经应用，请查看当前正式配置。')
    if(configFingerprint(a,snapshot(tid,a))!==r.base_hash)throw apiError(409,'CONFIG_CONFLICT','商家已修改相关配置，请重新核对草稿。')
    const proposed=JSON.parse(r.proposed_json)
    const data=run(tid,()=>a.previewData?a.previewData(proposed,request):proposed);return {draft:serialize(r),path:a.previewPath,data,responses:{[a.previewPath]:data,...(a.previewResponses?run(tid,()=>a.previewResponses(proposed,request)):{})}}
  }
  const moduleReviews=createSetupReviewStatus({db,apiError,getSetupAdapters,getEntitlements,snapshot,fingerprint,event,now})
  async function input(req){let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>13000000)throw apiError(413,'TOO_LARGE','配置内容过大。')}try{return JSON.parse(raw||'{}')}catch{throw apiError(400,'BAD_REQUEST','配置格式无效。')}}
  async function route({req,res,path,isPlatform}){
    const match=path.match(/^\/platform\/tenants\/([^/]+)\/setup(?:\/(modules|drafts|reviews)(?:\/([^/]+))?(?:\/(apply|preview|discard))?)?$/)
    if(!match)return false
    if(!isPlatform())throw apiError(401,'UNAUTHORIZED','请先登录平台。')
    const [,tid,section,item,action]=match,operator=platformOperator(req)
    if(!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid))throw apiError(404,'NOT_FOUND','门店不存在。')
    const reply=(value,status=200)=>{json(res,status,value,{'cache-control':'private, no-store'});return true}
    if(req.method==='GET'&&!section){
      const ent=getEntitlements(tid)
      return reply({tenantId:tid,reviews:moduleReviews.list(tid),entitlements:ent,modules:Object.entries(getSetupAdapters()).map(([key,a])=>({key,title:a.title,feature:a.feature||null,enabled:!a.feature||ent.features[a.feature]?.enabled===true,previewPath:a.previewPath,ownerConfirmation:!!a.ownerConfirmation})),events:db.prepare('SELECT * FROM platform_setup_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200').all(tid),drafts:db.prepare('SELECT * FROM platform_setup_drafts WHERE tenant_id=? ORDER BY updated_at DESC').all(tid).map(presentDraft)})
    }
    if(req.method==='POST'&&section==='reviews'&&item)return reply(moduleReviews.save(tid,item,await input(req),operator))
    if(req.method==='GET'&&section==='modules'&&item){const a=adapter(tid,item),current=snapshot(tid,a);return reply({module:item,current,fingerprint:configFingerprint(a,current)})}
    if(req.method==='GET'&&section==='drafts'&&item)return reply(action==='preview'?preview(tid,item):{draft:presentDraft(row(tid,item))})
    if(req.method==='POST'&&section==='drafts'&&!item){
      const b=await input(req),a=adapter(tid,b.module)
      if(!['hero','guide','services'].includes(b.module)&&Buffer.byteLength(JSON.stringify(b))>200000)throw apiError(413,'TOO_LARGE','配置内容过大。')
      if(!b.body||typeof b.body!=='object'||Array.isArray(b.body))throw apiError(400,'BAD_REQUEST','请填写配置内容。')
      validateSetupBody(b.module,b.body,apiError)
      if(Object.keys(b.body).some(k=>!a.fields.includes(k)))throw apiError(400,'UNKNOWN_FIELD','配置包含不支持的字段，请刷新编辑器。')
      if(b.targetId!==undefined&&b.targetId!==null&&(typeof b.targetId!=='string'||b.targetId.length>120))throw apiError(400,'BAD_REQUEST','配置对象无效。')
      const sourceNote=b.sourceNote??'';if(typeof sourceNote!=='string'||sourceNote.length>2000)throw apiError(400,'BAD_SOURCE_NOTE','资料位置或确认说明最多2000字。')
      const sourceIds=b.sourceIds||[];if(!Array.isArray(sourceIds)||sourceIds.length>60||sourceIds.some(x=>typeof x!=='string'))throw apiError(400,'BAD_SOURCES','资料来源无效。')
      const sources=[...new Set(sourceIds)].map(fileId=>{const f=db.prepare('SELECT id,name,section,sha256 FROM platform_setup_intake_files WHERE id=? AND tenant_id=?').get(fileId,tid);if(!f)throw apiError(404,'SOURCE_NOT_FOUND','资料已移除或不属于本店，请重新选择。');return f})
      const draftId=id(),time=now();let original,proposed
      // Synchronous shared domain methods only: never hold a SQLite transaction across await.
      db.exec('SAVEPOINT setup_validate')
      try{
        original=snapshot(tid,a)
        if(b.fingerprint!==configFingerprint(a,original))throw apiError(409,'CONFIG_CONFLICT','正式配置已变化，请重新读取后核对。')
        run(tid,()=>a.write(tid,b.body,b.targetId||null));proposed=snapshot(tid,a)
      }finally{db.exec('ROLLBACK TO setup_validate; RELEASE setup_validate')}
      db.exec('SAVEPOINT setup_save')
      try{
        db.prepare('INSERT INTO platform_setup_drafts(id,tenant_id,module,target_id,revision,base_hash,base_json,body_json,proposed_json,source_json,source_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(draftId,tid,b.module,b.targetId||null,1,configFingerprint(a,original),JSON.stringify(original),JSON.stringify(b.body),JSON.stringify(proposed),JSON.stringify(sources),sourceNote.trim(),time,time)
        if(b.replacesDraftId){const previous=row(tid,b.replacesDraftId);if(previous.status!=='draft'||previous.revision!==b.replacesRevision||previous.module!==b.module||previous.target_id!==(b.targetId||null))throw apiError(409,'REVISION_CONFLICT','原草稿已变化，请重新读取。');db.prepare("UPDATE platform_setup_drafts SET status='discarded',updated_at=? WHERE id=? AND tenant_id=?").run(time,previous.id,tid);event(tid,previous.id,'replaced_by:'+draftId,operator,previous.revision)}
        event(tid,draftId,'draft_saved',operator,1);db.exec('RELEASE setup_save')
      }catch(e){db.exec('ROLLBACK TO setup_save; RELEASE setup_save');throw e}
      return reply({draft:serialize(row(tid,draftId)),note:'仅保存草稿，商家正式配置未改变。'},201)
    }
    if(req.method==='POST'&&section==='drafts'&&item&&action==='discard'){
      const b=await input(req),r=row(tid,item);if(b.revision!==r.revision)throw apiError(409,'REVISION_CONFLICT','草稿版本已变化。');if(r.status==='applied')throw apiError(409,'ALREADY_APPLIED','已生效配置不能撤回为草稿，请新建变更。')
      if(r.status!=='discarded'){db.exec('SAVEPOINT setup_discard');try{db.prepare("UPDATE platform_setup_drafts SET status='discarded',updated_at=? WHERE id=? AND tenant_id=?").run(now(),item,tid);event(tid,item,'discarded',operator,r.revision);db.exec('RELEASE setup_discard')}catch(e){db.exec('ROLLBACK TO setup_discard; RELEASE setup_discard');throw e}}
      return reply({draft:serialize(row(tid,item))})
    }
    if(req.method==='POST'&&section==='drafts'&&item&&action==='apply'){
      const b=await input(req);let handoff=null
      if(b.confirm!==true)throw apiError(400,'CONFIRM_REQUIRED','请先核对这份草稿的变更。')
      db.exec('SAVEPOINT setup_apply')
      try{
        const r=row(tid,item),a=adapter(tid,r.module)
        if(b.revision!==r.revision)throw apiError(409,'REVISION_CONFLICT','草稿版本已变化。')
        if(r.status==='applied'){db.exec('RELEASE setup_apply');return reply({draft:serialize(r),alreadyApplied:true})}
        if(r.status!=='draft')throw apiError(409,'DRAFT_NOT_ACTIVE','草稿已撤回。')
        if(a.ownerConfirmation&&!serialize(r).ownerConfirmed)throw apiError(409,'OWNER_CONFIRMATION_REQUIRED','这项配置需由本店老板在商家端核对确认。')
        if(configFingerprint(a,snapshot(tid,a))!==r.base_hash)throw apiError(409,'CONFIG_CONFLICT','商家已修改相关配置；本次没有覆盖，请重新核对。')
        const result=run(tid,()=>a.write(tid,JSON.parse(r.body_json),r.target_id)),time=now()
        db.prepare("UPDATE platform_setup_drafts SET status='applied',applied_at=?,updated_at=?,result_json=? WHERE id=? AND tenant_id=?").run(time,time,JSON.stringify((a.publicResult?a.publicResult(result):result)??{}),item,tid)
        if(a.privateResult)handoff=a.privateResult(result)
        event(tid,item,'applied',operator,r.revision);db.exec('RELEASE setup_apply')
      }catch(e){db.exec('ROLLBACK TO setup_apply; RELEASE setup_apply');throw e}
      return reply({draft:serialize(row(tid,item)),alreadyApplied:false,...(handoff?{handoff}:{})})
    }
    throw apiError(405,'METHOD_NOT_ALLOWED','配置操作不受支持。')
  }
  function referenceName(tid,key,id){
    const refs={technicianId:['technicians','name'],serviceId:['services','name_zh'],serviceIds:['services','name_zh'],categoryId:['service_categories','name'],scopeCategoryIds:['service_categories','name'],couponId:['coupons','name'],packageId:['membership_packages','name']},ref=refs[key]
    if(!ref)return String(id)
    const r=db.prepare('SELECT '+ref[1]+' AS name FROM '+ref[0]+' WHERE tenant_id=? AND id=?').get(tid,id)
    return r?.name||'关联项目已变更'
  }
  function delivery(tid){
    const ent=getEntitlements(tid),reviews=moduleReviews.list(tid)
    return Object.entries(getSetupAdapters()).map(([key,a])=>{const review=reviews.find(r=>r.module===key),latest=db.prepare("SELECT applied_at FROM platform_setup_drafts WHERE tenant_id=? AND module=? AND status='applied' ORDER BY applied_at DESC LIMIT 1").get(tid,key)
      return {module:key,title:a.title,enabled:!a.feature||ent.features[a.feature]?.enabled===true,appliedAt:latest?.applied_at||null,status:review?.stale?'stale':review?.status||'unreviewed',note:review?.note||'',...setupDeliveryInfo(key)}
    })
  }
  function inbox(tid,admin){
    if(admin?.role!=='owner'||admin.provider!=='account'||admin.preview||admin.tenantId!==tid)return []
    return db.prepare(`SELECT e.id,e.action,e.created_at,d.module FROM platform_setup_events e
      JOIN platform_setup_drafts d ON d.id=e.draft_id AND d.tenant_id=e.tenant_id
      WHERE e.tenant_id=? AND ((d.status='applied' AND e.action='applied') OR
      (d.status='draft' AND e.action='draft_saved' AND NOT EXISTS
        (SELECT 1 FROM platform_setup_events c WHERE c.tenant_id=d.tenant_id AND c.draft_id=d.id AND c.revision=d.revision AND c.action='owner_confirmed')))
      ORDER BY e.created_at DESC,e.id DESC LIMIT 100`).all(tid).map(r=>({id:'setup:'+r.id,
        title:r.action==='applied'?'平台配置已应用':'平台配置待核对',
        text:(getSetupAdapters()[r.module]?.title||'门店配置')+(r.action==='applied'?'已由平台应用，可查看交付说明与后续修改入口。':'已由平台整理，请查看具体变更；正式配置尚未改变。'),
        at:r.created_at,action:'setup_review',actionLabel:'查看平台配置'}))
  }
  async function merchantRoute(req,res,{path,adminSession}){
    const match=path.match(/^\/admin\/setup-review(?:\/([^/]+)\/(confirm|reject))?$/);if(!match)return false
    if(adminSession?.role!=='owner'||adminSession.provider!=='account'||adminSession.preview)throw apiError(403,'FORBIDDEN','仅本店老板可核对平台准备的配置。')
    const tid=adminSession.tenantId
    if(req.method==='GET'&&!match[1]){const drafts=db.prepare("SELECT * FROM platform_setup_drafts WHERE tenant_id=? AND status='draft' ORDER BY updated_at DESC").all(tid).map(presentDraft);json(res,200,{drafts,delivery:delivery(tid)},{'cache-control':'private, no-store'});return true}
    if(req.method==='POST'&&match[1]){
      const b=await input(req);db.exec('SAVEPOINT setup_owner_review')
      try{const r=row(tid,match[1]);adapter(tid,r.module);if(r.status!=='draft'||r.revision!==b.revision)throw apiError(409,'REVISION_CONFLICT','配置已经变化，请重新读取。');preview(tid,r.id)
        if(b.confirm!==true)throw apiError(400,'CONFIRM_REQUIRED','请核对后确认。')
        const action=match[2]==='confirm'?'owner_confirmed':'owner_rejected'
        const feedback=b.feedback??'';if(typeof feedback!=='string'||feedback.length>2000)throw apiError(400,'BAD_FEEDBACK','修改说明最多2000字。')
        if(action==='owner_rejected'&&!feedback.trim())throw apiError(400,'FEEDBACK_REQUIRED','请填写需要平台修改的内容。')
        if(!db.prepare('SELECT 1 FROM platform_setup_events WHERE draft_id=? AND action=? AND revision=?').get(r.id,action,r.revision))event(tid,r.id,action,adminSession.email||adminSession.username||'merchant-owner',r.revision)
        if(action==='owner_rejected')db.prepare("UPDATE platform_setup_drafts SET status='discarded',updated_at=?,owner_feedback=? WHERE id=? AND tenant_id=?").run(now(),feedback.trim(),r.id,tid)
        db.exec('RELEASE setup_owner_review');json(res,200,{draft:serialize(row(tid,r.id))},{'cache-control':'private, no-store'});return true
      }catch(e){db.exec('ROLLBACK TO setup_owner_review; RELEASE setup_owner_review');throw e}
    }
    throw apiError(405,'METHOD_NOT_ALLOWED','核对操作不受支持。')
  }
  return {route,preview,merchantRoute,inbox,currentPreview:(tid,key)=>{const a=adapter(tid,key);return snapshot(tid,a)}}
}
