// Read-only review. Passing reconciliation is NOT permission to activate any card.
export function reconcileMigrationCards({snapshotAmountCents,assets,currency},body,apiError){
 const fail=(code,message)=>{throw apiError(400,code,message)}
 if(!body||body.currency!==currency)fail('CURRENCY_MISMATCH','请按门店币种核对，不自动换算。')
 if(!Array.isArray(body.cards)||!body.cards.length||body.cards.length>200)fail('CARDS_REQUIRED','请逐张核对旧卡，最多200张。')
 const allowed=new Set(assets.map(a=>a.id)),seen=new Set(),cards=[]
 const cents=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000000
 for(const c of body.cards){
  if(!c||!allowed.has(c.assetId)||seen.has(c.assetId))fail('INVALID_SOURCE_CARD','旧卡来源不属于本次核对，或重复填写。')
  seen.add(c.assetId)
  if(!['paid_timecard','stored_value','unresolved'].includes(c.kind))fail('CARD_KIND_REQUIRED','请选择卡项类型；未知请保留待核对。')
  if(c.kind==='unresolved'){cards.push({assetId:c.assetId,kind:c.kind});continue}
  if(!cents(c.paidCents)||!cents(c.bonusCents))fail('AMOUNT_REQUIRED','本金和赠送金必须分别明确填写，未知不能填零。')
  const item={assetId:c.assetId,kind:c.kind,paidCents:c.paidCents,bonusCents:c.bonusCents}
  if(c?.kind==='paid_timecard'){
   if(!Number.isSafeInteger(c.remainingTimes)||c.remainingTimes<0||c.remainingTimes>100000)fail('TIMES_REQUIRED','剩余次数必须是非负整数。')
   if(c.remainingTimes===0&&c.paidCents+c.bonusCents!==0)fail('EXHAUSTED_HAS_BALANCE','0次卡仍有余额，请先核对原卡规则。')
   if(typeof c.serviceId!=='string'||!c.serviceId)fail('SERVICE_REQUIRED','请指定服务；无法映射的卡保持待核对。')
   Object.assign(item,{remainingTimes:c.remainingTimes,serviceId:c.serviceId})
  }
  if(c.noExpiry===true){if(c.expiresOn)fail('EXPIRY_CONFLICT','无期限和到期日期不能同时填写。');item.expiresOn=null}
  else{const date=c.expiresOn,t=Date.parse(date+'T00:00:00Z');if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==date)fail('EXPIRY_REQUIRED','请核对到期日期，或明确选择无期限。');item.expiresOn=date}
  cards.push(item)
 }
 if(seen.size!==allowed.size)fail('INCOMPLETE_CARDS','本次所有旧卡都需列出；尚未核对的卡请标为待核对。')
 const paidCents=cards.reduce((n,c)=>n+(c.paidCents||0),0),bonusCents=cards.reduce((n,c)=>n+(c.bonusCents||0),0)
 const unresolvedCount=cards.filter(c=>c.kind==='unresolved').length
 const differenceCents=snapshotAmountCents-paidCents-bonusCents
 const issues=[]
 if(unresolvedCount)issues.push('仍有旧卡未核对，不能判断总额是否完整。')
 if(differenceCents)issues.push('分卡合计与原总余额不一致，需核对截止后的业务及原系统余额口径。')
 return {cards,currency,snapshotAmountCents,paidCents,bonusCents,differenceCents,unresolvedCount,
   balanced:!unresolvedCount&&differenceCents===0,canActivate:false,issues,
   message:'这是核对预览，不会增加可用余额或次数。金额相等也不代表卡项规则已支持。'}
}
export function createMigrationCardReconciliation({db,apiError,currentTenantId,balanceSource}){
 function context(tid,uid,pid){
  const s=balanceSource(tid,uid,pid)
  const assets=db.prepare("SELECT id,title,raw_json FROM customer_legacy_assets WHERE tenant_id=? AND user_id=? AND source_system=? AND source_record_id=? AND asset_kind='card' ORDER BY id").all(tid,uid,s.pending.source_system,s.pending.source_record_id)
  const posted=!!s.link?.opening_balance_applied_cents||!!db.prepare("SELECT 1 FROM stored_value_transactions WHERE tenant_id=? AND user_id=? AND (type='migrate_opening' OR (type='bonus' AND bucket='legacy')) LIMIT 1").get(tid,uid)
  return {s,assets,posted}
 }
 async function route({req,res,path,adminSession,readBody,json}){
  const m=path.match(/^\/admin\/customers\/([^/]+)\/migration-balances\/([^/]+)\/reconciliation$/)
  if(!m)return false
  if(adminSession?.role!=='owner')throw apiError(403,'FORBIDDEN','仅老板可核对分卡与总余额。')
  const tid=currentTenantId(),uid=decodeURIComponent(m[1]),pid=decodeURIComponent(m[2]),{s,assets,posted}=context(tid,uid,pid)
  if(req.method==='GET'){json(res,200,{version:s.version,currency:s.currency,snapshotAmountCents:s.pending.snapshot_amount_cents,alreadyPosted:posted,cards:assets.map(a=>({id:a.id,title:a.title,source:JSON.parse(a.raw_json)})),canActivate:false});return true}
  if(req.method!=='POST')throw apiError(405,'METHOD_NOT_ALLOWED','Method not allowed.')
  const body=await readBody(req)
  if(!body||body.confirmVersion!==s.version)throw apiError(409,'SOURCE_CHANGED','来源已变化，请重新读取后核对。')
  if(!Array.isArray(body.cards))throw apiError(400,'CARDS_REQUIRED','请逐张填写核对内容。')
  for(const c of body.cards)if(c?.kind==='paid_timecard'&&!db.prepare('SELECT id FROM services WHERE tenant_id=? AND id=? AND is_active=1').get(tid,c.serviceId||''))throw apiError(400,'SERVICE_REQUIRED','具体服务不属于本店或已下架。')
  const result=reconcileMigrationCards({snapshotAmountCents:s.pending.snapshot_amount_cents,assets,currency:s.currency},body,apiError)
  if(posted)result.issues.push('已有旧余额入账记录；分卡只可关联原账，不能再次入账。')
  json(res,200,{...result,alreadyPosted:posted});return true
 }
 return {route}
}
