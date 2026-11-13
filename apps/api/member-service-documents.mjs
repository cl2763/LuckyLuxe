import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {pricingDigest} from './member-pricing-calculation.mjs'
import {makeActorOf} from './actor-name.mjs'
export function ensureMemberDocumentSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS member_document_groups(
    id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,
    input_json TEXT NOT NULL,context_json TEXT NOT NULL,proof_hash TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(tenant_id,operation_id));
    CREATE TABLE IF NOT EXISTS member_service_documents(
      id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,group_id TEXT NOT NULL,user_id TEXT NOT NULL,beneficiary_key TEXT NOT NULL,
      status TEXT NOT NULL,dependency_id TEXT,quote_json TEXT NOT NULL,confirmation_hash TEXT NOT NULL,
      signed_json TEXT,signed_at TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(group_id,beneficiary_key));
    CREATE TABLE IF NOT EXISTS member_document_components(
      settlement_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,document_id TEXT NOT NULL,component_index INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS member_document_coupon_allocations(
      settlement_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,document_id TEXT NOT NULL,grant_id TEXT NOT NULL,amount_cents INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS member_document_events(
      id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,document_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS member_document_events_no_update BEFORE UPDATE ON member_document_events BEGIN SELECT RAISE(ABORT,'document history is immutable');END;
    CREATE TRIGGER IF NOT EXISTS member_document_events_no_delete BEFORE DELETE ON member_document_events BEGIN SELECT RAISE(ABORT,'document history is immutable');END;
    CREATE TABLE IF NOT EXISTS member_document_tokens(
      token_hash TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,document_id TEXT NOT NULL,expires_at TEXT NOT NULL,active INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS member_document_signed_update BEFORE UPDATE ON member_service_documents WHEN OLD.status='signed'
      BEGIN SELECT RAISE(ABORT,'signed person document is immutable');END;
    CREATE TRIGGER IF NOT EXISTS member_document_signed_delete BEFORE DELETE ON member_service_documents WHEN OLD.status='signed'
      BEGIN SELECT RAISE(ABORT,'signed person document is immutable');END;`)
}
export function createMemberServiceDocuments({db,policy,preview,apiError,currentTenantId,createSettlementGroup,signLedger,balanceOf,getPricingRules,activeDepositReceipts,logCouponGrant,requireCustomer,assertStaff,amendSettlement,amendmentShape}) {
  const actorOf=makeActorOf({apiError}),now=()=>new Date().toISOString()
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
  const digest=v=>pricingDigest(canonical(v))
  const tokenHash=token=>createHash('sha256').update(String(token||'')).digest('hex')
  function get(id,tenantId=null) {
    const row=db.prepare('SELECT * FROM member_service_documents WHERE id=?').get(String(id))
    if(!row||(tenantId&&row.tenant_id!==tenantId)) throw apiError(404,'NOT_FOUND','没有这张服务单。')
    return row
  }
  function components(row) {return db.prepare(`SELECT s.* FROM member_document_components c JOIN settlements s ON s.id=c.settlement_id
    WHERE c.document_id=? AND c.tenant_id=? ORDER BY c.component_index`).all(row.id,row.tenant_id)}
  function proof(tid,sheets) {
    const ids=[...new Set(sheets.flatMap(s=>[...(s.items||[]).map(i=>i.serviceId),s.timecardServiceId].filter(Boolean)))].sort()
    const packageIds=[...new Set(sheets.flatMap(s=>[s.rechargePackageId,s.purchasePackageId].filter(Boolean)))].sort()
    const couponIds=[...new Set(sheets.map(s=>s.couponGrantId).filter(Boolean))].sort()
    const {active,membershipEnabled,settlementTypes}=policy.config(tid)
    return digest({config:{active,membershipEnabled,settlementTypes},membership:policy.getMembershipConfig(tid),rules:getPricingRules(tid),
      services:ids.map(id=>({id,prices:policy.prices(tid,id,'settlement'),service:db.prepare('SELECT * FROM services WHERE id=? AND tenant_id=?').get(id,tid)})),
      packages:packageIds.map(id=>db.prepare('SELECT * FROM membership_packages WHERE id=? AND tenant_id=?').get(id,tid)),
      coupons:couponIds.map(id=>db.prepare('SELECT c.*,g.expires_at FROM coupons c JOIN coupon_grants g ON g.coupon_id=c.id WHERE g.id=? AND g.tenant_id=?').get(id,tid))})
  }
  function shape(row) {
    const quote=JSON.parse(row.quote_json),signed=row.signed_json?JSON.parse(row.signed_json):null
    return {id:row.id,groupId:row.group_id,status:row.status,userId:row.user_id,beneficiaryKey:row.beneficiary_key,
      dependencyId:row.dependency_id||null,expiresAt:null,confirmationHash:row.confirmation_hash,quote,signed,signedAt:row.signed_at,
      components:components(row).map(c=>({id:c.id,code:c.code,status:c.status,...amendmentShape(c)})),snapshotUrl:signed?`/member-documents/${row.id}/snapshot`:null}
  }
  function groupView(groupId,tid) {return {groupId,documents:db.prepare('SELECT * FROM member_service_documents WHERE group_id=? AND tenant_id=? ORDER BY rowid').all(groupId,tid).map(shape)}}
  function create(body,admin,options={}) {
    const tid=currentTenantId(),id=String(body.operationId||'')
    if(!['owner','staff'].includes(admin.role))throw apiError(403,'FORBIDDEN','需要门店员工身份。')
    if(!/^[\w-]{1,64}$/.test(id))throw apiError(400,'OPERATION_ID_REQUIRED','请提供本次开单操作编号。')
    const actor=actorOf(admin),payloadHash=digest({body,actor})
    db.exec('SAVEPOINT create_person_documents')
    try {
      const old=db.prepare('SELECT * FROM member_document_groups WHERE tenant_id=? AND operation_id=?').get(tid,id)
      if(old) {
        if(old.payload_hash!==payloadHash)throw apiError(409,'IDEMPOTENCY_CONFLICT','同一开单编号的内容发生变化。')
        const result=groupView(old.id,tid);db.exec('RELEASE create_person_documents');return {...result,duplicate:true}
      }
      const {view,sheets,context,userId}=preview.prepare(tid,body,admin)
      const preparedSheets=sheets.map((s,i)=>({...s,couponGrantId:view.components[i].coupon?.grantId||null,payIntent:s.payIntent||body.payIntent}))
      const made=createSettlementGroup({...body,__demoSeed:null,cardOwnerUserId:userId,settlements:preparedSheets},admin,{computedSheets:view.components,documentMode:true,sharedBookingGroupId:options.sharedBookingGroupId})
      const input=JSON.stringify(sheets),timestamp=now(),groupId=made.groupId
      db.prepare('INSERT INTO member_document_groups VALUES(?,?,?,?,?,?,?,?,?)').run(groupId,tid,userId,id,payloadHash,input,JSON.stringify(context),proof(tid,sheets),timestamp)
      let primaryId=null
      for(const person of view.documents) {
        const docId=randomUUID(),own=person.componentIndexes.map(i=>view.components[i])
        if(own.some(c=>c.recharge))primaryId=docId
        const quote={...person,components:own.map(c=>{const {couponOptions,...v}=c;return v}),personalDiscount:view.personalDiscount,
          cardOwnerUserId:userId,replacesDocumentId:options.replacesDocumentId||null,currency:own[0]?.currency,currencyDisplay:own[0]?.currencyDisplay}
        delete quote.couponOptions
        const hash=digest(quote)
        db.prepare('INSERT INTO member_service_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(docId,tid,groupId,userId,person.beneficiaryKey,'pending_sign',primaryId&&primaryId!==docId?primaryId:null,JSON.stringify(quote),hash,null,null,actor,timestamp)
        for(const i of person.componentIndexes) {
          db.prepare('INSERT INTO member_document_components VALUES(?,?,?,?)').run(made.settlements[i].id,tid,docId,i)
          if(person.coupon&&view.components[i].couponDiscountCents>0)db.prepare('INSERT INTO member_document_coupon_allocations VALUES(?,?,?,?,?)').run(made.settlements[i].id,tid,docId,person.coupon.grantId,view.components[i].couponDiscountCents)
        }
      }
      db.exec('RELEASE create_person_documents');return groupView(groupId,tid)
    }catch(e){db.exec('ROLLBACK TO create_person_documents; RELEASE create_person_documents');throw e}
  }
  function adminRow(id,admin) {
    const row=get(id,currentTenantId())
    if(!['owner','staff'].includes(admin.role))throw apiError(403,'FORBIDDEN','需要门店员工身份。')
    if(admin.role==='staff'&&row.created_by!==actorOf(admin))for(const c of components(row))assertStaff(admin,c)
    return row
  }
  function issueToken(id,admin) {
    const row=adminRow(id,admin)
    if(row.status!=='pending_sign')throw apiError(409,'DOCUMENT_NOT_PENDING','服务单已签署或已撤回。')
    const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+30*60000).toISOString()
    db.exec('SAVEPOINT document_token')
    try {
      db.prepare('UPDATE member_document_tokens SET active=0 WHERE document_id=?').run(id)
      db.prepare('INSERT INTO member_document_tokens VALUES(?,?,?,?,1)').run(tokenHash(token),row.tenant_id,id,expiresAt)
      db.exec('RELEASE document_token')
    }catch(e){db.exec('ROLLBACK TO document_token; RELEASE document_token');throw e}
    return {token,expiresAt,documentId:id}
  }
  function authorize(req,row,body=null) {
    const token=req.headers['x-document-token']
    if(token) {
      const t=db.prepare('SELECT * FROM member_document_tokens WHERE token_hash=?').get(tokenHash(token))
      if(!t||!t.active||t.expires_at<=now())throw apiError(401,'DOCUMENT_LINK_EXPIRED','签署链接无效或已过期。')
      if(t.document_id!==row.id||t.tenant_id!==row.tenant_id)throw apiError(403,'DOCUMENT_TOKEN_MISMATCH','这份链接不能用于其他服务单。')
      if(body&&body.signerConfirmed!==true)throw apiError(400,'SIGNER_CONFIRMATION_REQUIRED','请核对卡主及被服务者后再确认。')
      return
    }
    const customer=requireCustomer(req)
    if(customer.id!==row.user_id)throw apiError(403,'DOCUMENT_OWNER_REQUIRED','只能由卡主授权本次扣款。')
  }
  function guardComponent(row) {
    const link=db.prepare('SELECT document_id FROM member_document_components WHERE settlement_id=?').get(row.id)
    if(link){const error=apiError(409,'PERSON_DOCUMENT_REQUIRED','请通过完整服务单操作，不能单独签署或修改其中一个项目。');error.details={documentId:link.document_id};throw error}
  }
  function sign(id,body,req) {
    let row=get(id);authorize(req,row,body)
    if(body.disclaimerAccepted!==true)throw apiError(400,'DISCLAIMER_REQUIRED','请先确认服务及充值明细。')
    if(body.confirmationHash!==row.confirmation_hash)throw apiError(409,'DOCUMENT_CHANGED','服务单内容已变化，请重新核对。')
    const signature=String(body.signature||'').trim(),strokes=body.strokes||[]
    if(!signature||signature.length>200||!Array.isArray(strokes)||JSON.stringify(strokes).length>250000)throw apiError(400,'SIGNATURE_REQUIRED','签名格式无效。')
    db.exec('BEGIN IMMEDIATE')
    try {
      row=get(id)
      if(row.status==='signed'){const result=shape(row);db.exec('COMMIT');return {...result,duplicate:true}}
      if(row.status!=='pending_sign')throw apiError(409,'DOCUMENT_VOIDED','这张服务单已撤回。')
      if(row.dependency_id&&get(row.dependency_id).status!=='signed')throw apiError(409,'RECHARGE_DOCUMENT_FIRST','请先签署包含随单充值的服务单，再确认本单。')
      const group=db.prepare('SELECT * FROM member_document_groups WHERE id=?').get(row.group_id),context=JSON.parse(group.context_json)
      if(proof(row.tenant_id,JSON.parse(group.input_json))!==group.proof_hash)throw apiError(409,'PRICING_CHANGED','价格或会员规则已变化，请联系商家更新服务单后重新确认。')
      const previous=db.prepare("SELECT * FROM member_discount_events WHERE tenant_id=? AND user_id=? AND source='recharge' AND source_id=?").get(row.tenant_id,row.user_id,`document-group:${row.group_id}`)
      const current=policy.discount(row.tenant_id,row.user_id)
      policy.revision(previous?previous.revision:context.oldRevision,current.revision)
      const comp=components(row),quote=JSON.parse(row.quote_json),hasRecharge=comp.some(c=>c.recharge_json)
      if(!hasRecharge&&!context.eligible&&current.eligible)throw apiError(409,'MEMBERSHIP_CHANGED','会员资格已变化，请商家重新核对价格。')
      // Once this visit has started signing, its confirmed price is frozen; subsequent visits re-evaluate qualification.
      const begun=db.prepare("SELECT 1 FROM member_service_documents WHERE group_id=? AND status='signed'").get(row.group_id)
      if(!hasRecharge&&context.eligible&&!current.eligible) {
        const membership=policy.getMembershipConfig(row.tenant_id)
        const zeroRule=membership.memberQualify==='balance_gt_0'||(membership.memberQualify==='any_recharge'&&membership.keepMemberAfterRefund==='drop')
        const recent=membership.expireDays?db.prepare("SELECT 1 FROM stored_value_transactions WHERE tenant_id=? AND user_id=? AND type IN ('recharge','migrate_opening') AND created_at>=? LIMIT 1").get(row.tenant_id,row.user_id,new Date(Date.now()-membership.expireDays*86400000).toISOString()):true
        if(!begun||!zeroRule||current.balanceCents>0||!recent)throw apiError(409,'MEMBERSHIP_CHANGED','会员资格已变化，请商家重新核对价格。')
      }
      if(comp.some(c=>c.status!=='pending_sign'))throw apiError(409,'DOCUMENT_COMPONENT_CHANGED','服务项目状态已变化，请联系商家重新核对。')
      const balanceBefore=balanceOf(row.user_id,row.tenant_id)
      let rechargeReceipt=null
      for(const c of comp) {
        // A displayed deposit cannot be silently reused after another document settles it.
        if(c.deposit_deduct_cents>0) {
          const receipts={n:activeDepositReceipts(c.booking_id,c.tenant_id).filter(r=>!r.settled_settlement_id).reduce((n,r)=>n+r.amount_cents,0)}
          if(receipts.n<c.deposit_deduct_cents)throw apiError(409,'DEPOSIT_CHANGED','定金已被其他单使用，请重新核对。')
        }
        const depositTarget=c.booking_id?db.prepare("SELECT id FROM settlements WHERE booking_id=? AND tenant_id=? AND status='pending_sign' AND deposit_deduct_cents>0 ORDER BY rowid LIMIT 1").get(c.booking_id,c.tenant_id):null
        const ledger=signLedger(c,{signature,signedBy:row.user_id,strokes,withinTransaction:true,couponLogDiscountCents:quote.coupon?.discountCents,finalizeDeposit:!depositTarget||depositTarget.id===c.id})
        if(ledger.rechargeTxnId)rechargeReceipt={rechargeTxnId:ledger.rechargeTxnId,bonusTxnId:ledger.bonusTxnId,documentId:row.id}
      }
      let afterDiscount=current
      if(hasRecharge) afterDiscount=policy.setDiscount(row.tenant_id,row.user_id,{rateBps:context.proposedRateBps,expectedRevision:context.oldRevision,reason:context.reason},
        {actor:context.actor,role:context.role,source:'recharge',sourceId:`document-group:${row.group_id}`})
      if(rechargeReceipt)db.prepare('INSERT INTO member_pricing_operations VALUES(?,?,?,?,?,?,?)').run(row.tenant_id,`inline:${row.group_id}`,'recharge',row.user_id,digest(rechargeReceipt),JSON.stringify({...rechargeReceipt,discountReceipt:{before:current,after:afterDiscount,actor:context.actor,source:'recharge'}}),now())
      const signedAt=now(),signed={...quote,documentId:row.id,signature,strokes,signedAt,signedBy:row.user_id,
        balanceBeforeCents:balanceBefore.totalCents,balanceAfterCents:balanceOf(row.user_id,row.tenant_id).totalCents,
        discountAfter:afterDiscount,confirmationHash:row.confirmation_hash,componentCodes:comp.map(c=>c.code)}
      db.prepare("UPDATE member_service_documents SET status='signed',signed_json=?,signed_at=? WHERE id=?").run(JSON.stringify(signed),signedAt,row.id)
      for(const bookingId of new Set(comp.map(c=>c.booking_id).filter(Boolean))) {
        const pending=db.prepare("SELECT 1 FROM settlements WHERE booking_id=? AND tenant_id=? AND status='pending_sign'").get(bookingId,row.tenant_id)
        if(pending)db.prepare("UPDATE bookings SET status='CONFIRMED' WHERE id=? AND tenant_id=? AND status='COMPLETED'").run(bookingId,row.tenant_id)
      }
      const alive=db.prepare("SELECT status FROM member_service_documents WHERE group_id=? AND status<>'voided'").all(row.group_id)
      db.prepare('UPDATE settlement_groups SET status=?,updated_at=? WHERE id=?').run(alive.every(d=>d.status==='signed')?'signed':'pending_sign',now(),row.group_id)
      db.exec('COMMIT');return shape(get(id))
    }catch(e){db.exec('ROLLBACK');throw e}
  }
  function voidDocument(id,body,admin) {
    const row=adminRow(id,admin),reason=String(body.reason||'').trim()
    if(!reason)throw apiError(400,'REASON_REQUIRED','撤回原因必填。')
    if(row.status==='signed')throw apiError(409,'ALREADY_SIGNED','已签署单据不能撤回，请走更正流程。')
    if(row.status==='voided')return shape(row)
    // Cancelling an unsigned recharge also cancels every unsigned dependent document.
    const targets=db.prepare("SELECT * FROM member_service_documents WHERE (id=? OR dependency_id=?) AND status='pending_sign'").all(id,id)
    db.exec('SAVEPOINT void_person_documents')
    try {
      for(const d of targets) {
        for(const c of components(d)) {
          if(c.coupon_grant_id)logCouponGrant({tenantId:d.tenant_id,grantId:c.coupon_grant_id,action:'released',settlementCode:c.code,detail:reason,actor:actorOf(admin)})
          db.prepare("UPDATE settlements SET status='voided',coupon_grant_id=NULL,coupon_id=NULL,coupon_name=NULL,coupon_discount_cents=0,updated_at=? WHERE id=? AND status='pending_sign'").run(now(),c.id)
          db.prepare("UPDATE settlement_payments SET status='void' WHERE settlement_id=?").run(c.id)
        }
        db.prepare("UPDATE member_service_documents SET status='voided' WHERE id=?").run(d.id)
        db.prepare('INSERT INTO member_document_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),d.tenant_id,d.id,'voided',actorOf(admin),reason,now())
        db.prepare('UPDATE member_document_tokens SET active=0 WHERE document_id=?').run(d.id)
      }
      const alive=db.prepare("SELECT status FROM member_service_documents WHERE group_id=? AND status<>'voided'").all(row.group_id)
      db.prepare('UPDATE settlement_groups SET status=?,updated_at=? WHERE id=?').run(!alive.length?'voided':alive.every(d=>d.status==='signed')?'signed':'pending_sign',now(),row.group_id)
      db.exec('RELEASE void_person_documents');return {documents:targets.map(d=>shape(get(d.id)))}
    }catch(e){db.exec('ROLLBACK TO void_person_documents; RELEASE void_person_documents');throw e}
  }
  function amend(id,body,admin) {
    if(admin.role!=='owner')throw apiError(403,'FORBIDDEN','只有老板可以更正已签服务单。')
    const row=adminRow(id,admin),reason=String(body.reason||'').trim(),changes=body.components
    if(row.status!=='signed')throw apiError(409,'NOT_SIGNED','未签服务单请撤回后重开。')
    if(!reason||!Array.isArray(changes)||!changes.length||changes.length>100)throw apiError(400,'CORRECTION_REQUIRED','请填写更正原因及对应项目。')
    const existing=new Map(components(row).map(c=>[c.id,c])),seen=new Set()
    db.exec('BEGIN IMMEDIATE')
    try {
      for(const change of changes) {
        const c=existing.get(change.id)
        if(!c||seen.has(c.id))throw apiError(400,'INVALID_COMPONENT','更正项目必须属于本单且不能重复。')
        seen.add(c.id)
        const prepaid=(JSON.parse(c.recharge_json||'null')?.amountCents||0)+(JSON.parse(c.purchase_json||'null')?.priceCents||0)
        if(change.totalCents!==undefined&&(!Number.isSafeInteger(change.totalCents)||change.totalCents<prepaid))throw apiError(400,'RECHARGE_REFUND_REQUIRED','充值及购卡款须走对应退款流程，不能通过服务金额更正退回。')
        amendSettlement(c.id,{...change,reason},admin)
      }
      db.prepare('INSERT INTO member_document_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),row.tenant_id,row.id,'amended',actorOf(admin),reason,now())
      db.exec('COMMIT');return shape(get(id))
    }catch(e){db.exec('ROLLBACK');throw e}
  }
  function requote(id,body,admin) {
    const row=adminRow(id,admin)
    const requestHash=digest({body,actor:actorOf(admin)})
    for(const event of db.prepare("SELECT reason FROM member_document_events WHERE document_id=? AND tenant_id=? AND action='requoted'").all(id,row.tenant_id)) {
      const receipt=JSON.parse(event.reason)
      if(receipt.operationId!==body.operationId)continue
      if(receipt.requestHash!==requestHash)throw apiError(409,'IDEMPOTENCY_CONFLICT','同一重开编号的内容发生变化。')
      return {...groupView(receipt.groupId,row.tenant_id),duplicate:true}
    }
    if(row.status!=='pending_sign')throw apiError(409,'DOCUMENT_NOT_PENDING','只能重开待签服务单。')
    const groupRows=db.prepare("SELECT * FROM member_service_documents WHERE group_id=? AND status<>'voided'").all(row.group_id)
    const hasSigned=groupRows.some(r=>r.status==='signed')
    const next={...body,userId:row.user_id,cardOwnerUserId:row.user_id}
    const incoming=Array.isArray(next.settlements)?next.settlements:[next]
    const originalBookings=[...new Set((hasSigned?[row]:groupRows).flatMap(r=>components(r).map(c=>c.booking_id)).filter(Boolean))]
    for(const s of incoming) {
      s.bookingId=s.bookingId||next.bookingId||(originalBookings.length===1?originalBookings[0]:null)
      if(!s.bookingId||!originalBookings.includes(s.bookingId))throw apiError(400,'REQUOTE_BOOKING_REQUIRED','重开单须保留原预约归属，请为项目选择对应的原预约。')
    }
    if(hasSigned && incoming.some(s=>(s.beneficiaryKey||(!s.servedPersonName?'self':''))!==row.beneficiary_key || s.rechargePackageId || s.rechargeAmountCents!==undefined))throw apiError(400,'REQUOTE_PERSON_ONLY','部分签署后，只能重开这位被服务者的待签项目，不能重复随单充值。')
    db.exec('BEGIN IMMEDIATE')
    try {
      for(const r of hasSigned?[row]:groupRows) if(get(r.id).status==='pending_sign')voidDocument(r.id,{reason:body.reason||'更新待签服务单'},admin)
      const result=create(next,admin,{sharedBookingGroupId:hasSigned?row.group_id:null,replacesDocumentId:row.id})
      db.prepare('INSERT INTO member_document_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),row.tenant_id,row.id,'requoted',actorOf(admin),JSON.stringify({operationId:body.operationId,requestHash,groupId:result.groupId,reason:body.reason||'更新待签服务单'}),now())
      db.exec('COMMIT');return result
    }catch(e){db.exec('ROLLBACK');throw e}
  }
  return {create,get,shape,groupView,adminRow,issueToken,authorize,sign,voidDocument,requote,amend,guardComponent}
}
