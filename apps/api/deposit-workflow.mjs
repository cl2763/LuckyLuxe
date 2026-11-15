import {createHash} from 'node:crypto'

// Append-only operational receipts. Existing merchant rows are never backfilled.
export function createDepositWorkflow(d) {
  const {db,apiError,randomId,activeDepositReceipts,funding,checkout,getDepositConfig,formatMoneyCents}=d
  db.exec(`CREATE TABLE IF NOT EXISTS deposit_workflow_operations (
    tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,booking_id TEXT NOT NULL,kind TEXT NOT NULL,
    request_hash TEXT NOT NULL,amount_cents INTEGER NOT NULL,pay_channel TEXT NOT NULL,
    actor TEXT NOT NULL,note TEXT NOT NULL,store_date TEXT NOT NULL,created_at TEXT NOT NULL,response_json TEXT NOT NULL,
    PRIMARY KEY(tenant_id,operation_id));
    CREATE INDEX IF NOT EXISTS idx_deposit_workflow_booking ON deposit_workflow_operations(tenant_id,booking_id);
    CREATE TRIGGER IF NOT EXISTS deposit_workflow_no_update BEFORE UPDATE ON deposit_workflow_operations BEGIN SELECT RAISE(ABORT,'deposit operations are append-only');END;
    CREATE TRIGGER IF NOT EXISTS deposit_workflow_no_delete BEFORE DELETE ON deposit_workflow_operations BEGIN SELECT RAISE(ABORT,'deposit operations are append-only');END;`)
  db.exec(`CREATE TABLE IF NOT EXISTS deposit_settlement_snapshots(tenant_id TEXT NOT NULL,settlement_id TEXT NOT NULL,detail_json TEXT NOT NULL,PRIMARY KEY(tenant_id,settlement_id));CREATE TRIGGER IF NOT EXISTS deposit_snapshot_no_update BEFORE UPDATE ON deposit_settlement_snapshots BEGIN SELECT RAISE(ABORT,'deposit snapshots are immutable');END;CREATE TRIGGER IF NOT EXISTS deposit_snapshot_no_delete BEFORE DELETE ON deposit_settlement_snapshots BEGIN SELECT RAISE(ABORT,'deposit snapshots are immutable');END;`)
  const need=['tenant_id','operation_id','booking_id','kind','request_hash','amount_cents','pay_channel','actor','note','store_date','created_at','response_json']
  const columns=db.prepare('PRAGMA table_info(deposit_workflow_operations)').all().map(x=>x.name)
  if(need.some(x=>!columns.includes(x)))throw Error('deposit_workflow_operations schema mismatch')
  const money=(n,t)=>formatMoneyCents(n,t,2),sum=rs=>rs.reduce((n,r)=>n+r.amount_cents,0)
  const now=()=>new Date().toISOString()
  const channelLabels={cash:'现金',card:'刷卡',transfer:'线下转账',offline:'线下收款',unknown:'其他',wechat:'微信转账',alipay:'支付宝转账'}
  function latest(b){const r=db.prepare('SELECT * FROM bookings WHERE id=? AND tenant_id=?').get(b.id,b.tenant_id);if(!r)throw apiError(404,'NOT_FOUND','找不到这张预约。');return r}
  function required(b){return Math.max(0,b.source_channel==='owner_direct'?d.depositAmountForService(d.getService(b.service_id),getDepositConfig(b.tenant_id),b.tenant_id):(b.deposit_required_cents||0)-(b.deposit_waived_cents||0))}
  function operations(b){return db.prepare('SELECT * FROM deposit_workflow_operations WHERE tenant_id=? AND booking_id=? ORDER BY created_at,operation_id').all(b.tenant_id,b.id)}
  function summary(b) {
    const rs=activeDepositReceipts(b.id,b.tenant_id),paid=rs.filter(r=>r.pay_channel!=='refund_due'),available=paid.filter(r=>!r.settled_settlement_id)
    const original=checkout.oldCancel(b),op=operations(b),refunded=op.filter(x=>x.kind==='refund').reduce((n,x)=>n+x.amount_cents,0)
    const stored=paid.reduce((n,r)=>n+funding.parts(r).slice(0,3).reduce((a,v)=>a+v,0),0),offline=sum(paid)-stored
    const due=b.status==='CANCELLED'?0:Math.max(0,required(b)-sum(paid))
    const refundDue=rs.filter(r=>r.pay_channel==='refund_due').reduce((n,r)=>n+r.amount_cents,0)
    const config=getDepositConfig(b.tenant_id),cancelled=b.status==='CANCELLED',settled=paid.some(r=>r.settled_settlement_id)
    const status=cancelled?(refundDue?'待门店线下退款':original?'退款已处理':'预约已取消'):sum(paid)===0?(required(b)?'未收定金':'无需定金'):due?'定金部分已收':settled?(sum(available)?'部分定金已用于结算 · 仍有未抵扣金额':'定金已用于结算'):config.deductible?'已收齐 · 待结算抵扣':'已收齐 · 本店不抵尾款'
    const fmt=n=>money(n,b.tenant_id)
    const receiptRows=db.prepare('SELECT * FROM deposit_receipts WHERE tenant_id=? AND booking_id=? ORDER BY created_at,id').all(b.tenant_id,b.id)
    const actorLabel=v=>({'booking_checkout':'预约系统','system':'系统'})[v]||v||'系统'
    const history=receiptRows.filter(r=>r.pay_channel!=='refund_due'&&!/^(本单抵扣|未使用定金保留|取消预约：|线下退款已登记|结算部分使用)/.test(r.reason||'')).map(r=>({id:r.id,label:r.kind==='revoke'?'已撤销原定金登记':funding.parts(r).slice(0,3).some(Boolean)?'已抵扣储值定金':'已登记线下收取',amountText:fmt(r.amount_cents),actor:actorLabel(r.actor),createdAt:d.formatTime(r.created_at,b.tenant_id),sortAt:r.created_at,note:r.reason||'',channel:channelLabels[r.pay_channel]||({'stored_value':'已有储值余额',retain_carry:'留存定金'})[r.pay_channel]||'',settlementId:r.settled_settlement_id||''}))
    for(const x of op.filter(x=>x.kind==='refund'))history.push({id:x.operation_id,label:'已登记线下退款',amountText:fmt(x.amount_cents),actor:actorLabel(x.actor),createdAt:d.formatTime(x.created_at,b.tenant_id),sortAt:x.created_at,note:x.note,channel:channelLabels[x.pay_channel]})
    const cancelledAt=original?db.prepare('SELECT created_at FROM booking_deposit_cancellations WHERE booking_id=? AND tenant_id=?').get(b.id,b.tenant_id)?.created_at:null
    if(original?.refundToStoredCents)history.push({id:'stored-refund',label:'储值返还原账户 · 已到账',amountText:fmt(original.refundToStoredCents),actor:'系统',createdAt:cancelledAt?d.formatTime(cancelledAt,b.tenant_id):'',sortAt:cancelledAt||'',note:'按原定金资金来源返还',channel:'原储值账户'})
    if(original?.forfeitCents)history.push({id:'forfeit',label:'按取消规则不退部分',amountText:fmt(original.forfeitCents),actor:'系统',createdAt:cancelledAt?d.formatTime(cancelledAt,b.tenant_id):'',sortAt:cancelledAt||'',note:'按本次预约适用的门店规则处理',channel:''})
    for(const x of paid.filter(x=>x.settled_settlement_id)){const st=db.prepare('SELECT code,signed_at FROM settlements WHERE id=? AND tenant_id=?').get(x.settled_settlement_id,b.tenant_id);history.push({id:'used-'+x.id,label:'用于服务结算',amountText:fmt(x.amount_cents),actor:'顾客签署',createdAt:st?.signed_at?d.formatTime(st.signed_at,b.tenant_id):'',sortAt:st?.signed_at||'',channel:'定金抵扣',note:st?.code||x.settled_settlement_id})}
    history.sort((a,b)=>(a.sortAt||'').localeCompare(b.sortAt||''));history.forEach(x=>delete x.sortAt)
    const canCollect=!cancelled&&!settled&&due>0&&config.enabled&&!db.prepare("SELECT 1 FROM settlements WHERE tenant_id=? AND booking_id=? AND status<>'voided'").get(b.tenant_id,b.id)
    return {cancelled,requiredCents:required(b),collectedCents:sum(paid),storedCents:stored,offlineCents:offline,offlineDueCents:due,availableCents:sum(available),cashRefundDueCents:refundDue,cashRefundedCents:refunded,canCollect,canRefund:cancelled&&refundDue>0,canDeduct:config.deductible&&sum(available)>0&&!cancelled,history,
      display:{status,requiredText:fmt(required(b)),collectedText:fmt(original?original.paidDepositCents:sum(paid)),storedText:fmt(stored),offlineText:fmt(offline),offlineDueText:fmt(due),availableText:fmt(sum(available)),collectAmountValue:(due/100).toFixed(2),refundAmountValue:(refundDue/100).toFixed(2),storedRefundText:fmt(original?.refundToStoredCents||0),cashRefundDueText:fmt(refundDue),cashRefundedText:fmt(refunded),forfeitText:fmt(original?.forfeitCents||0),
        collectTitle:'登记线下已收定金',collectButton:'登记线下已收',collectConfirm:`确认已收到 ${fmt(due)}`,collectNote:'请在实际收到款项后登记。本操作只记收款，不会扣顾客储值余额。',refundButton:'处理线下退款',refundNote:'请先向顾客实际退还线下款，再登记完成。系统不会发起线上退款。',
        settlementNote:config.deductible?'已收定金将在本次结算中带入，不需要再次收取。':'本店预约规则：定金不抵扣服务尾款。已收记录保留，可查看原规则。',
        cancelNote:refundDue?`${original?.refundToStoredCents?'储值部分已退回原账户。':''}线下收取的 ${fmt(refundDue)} 尚待门店退还，请联系门店核对。`:'退款处理记录已更新，请核对实际到账。'}}
  }
  function transact(b,body,kind,actor,run) {
    if(!body||typeof body!=='object'||Array.isArray(body))throw apiError(400,'INVALID_INPUT','请核对提交内容。')
    const explicit=body.amountCents!==undefined,key=body.operationId
    if((explicit||kind==='refund')&&!/^[A-Za-z0-9_-]{8,100}$/.test(String(key||'')))throw apiError(400,'OPERATION_ID_REQUIRED','请保留本次操作编号后重试。')
    if(explicit&&(!Number.isSafeInteger(body.amountCents)||body.amountCents<=0||body.amountCents>100000000))throw apiError(400,'INVALID_DEPOSIT_AMOUNT','金额必须是大于零的整数分，请核对金额。')
    const channel=body.payChannel||'offline';if(!Object.hasOwn(channelLabels,channel))throw apiError(400,'INVALID_DEPOSIT_CHANNEL','请选择实际线下收款或退款方式，储值不能作为线下收款登记。')
    if(typeof (body.note??'')!=='string'||(body.note||'').length>200)throw apiError(400,'INVALID_NOTE','备注不得超过200字。')
    const hash=createHash('sha256').update(JSON.stringify({bookingId:b.id,kind,amount:body.amountCents??null,channel,note:body.note||'',technicianId:body.technicianId||''})).digest('hex')
    db.exec('BEGIN IMMEDIATE')
    try {
      const prior=key?db.prepare('SELECT * FROM deposit_workflow_operations WHERE tenant_id=? AND operation_id=?').get(b.tenant_id,key):null
      if(prior){if(prior.request_hash!==hash)throw apiError(409,'IDEMPOTENCY_CONFLICT','该操作编号已有不同记录，请核对原操作。');db.exec('COMMIT');return {...JSON.parse(prior.response_json),duplicate:true,created:false}}
      const booking=latest(b),result=run(booking,channel)
      if(result.created!==false){db.prepare('INSERT INTO deposit_workflow_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(b.tenant_id,key||randomId('dep_op'),b.id,kind,hash,result.amountCents,channel,actor,body.note||'',d.todayOf(b.tenant_id),now(),JSON.stringify(result))}
      db.exec('COMMIT');return result
    }catch(e){db.exec('ROLLBACK');throw e}
  }
  function receive({booking,actor='admin',...body}) {
    return transact(booking,body,'collect',actor,(b,channel)=>{
      if(b.status==='CANCELLED')throw apiError(409,'BOOKING_CANCELLED','已取消的预约不能再收定金。')
      const rs=activeDepositReceipts(b.id,b.tenant_id),cfg=getDepositConfig(b.tenant_id)
      if(!cfg.enabled)throw apiError(400,'DEPOSIT_DISABLED','本店没有开启定金，请先核对门店规则。')
      if(rs.some(r=>r.settled_settlement_id)){if(body.amountCents!==undefined)throw apiError(409,'DEPOSIT_ALREADY_SETTLED','定金已用于结算，不能再收取。');return {receipt:d.serializeReceipt(rs[0]),created:false}}
      if(db.prepare("SELECT 1 FROM settlements WHERE tenant_id=? AND booking_id=? AND status<>'voided'").get(b.tenant_id,b.id))throw apiError(409,'SETTLEMENT_EXISTS','已有待签服务单，请先撤回并重新核对，再登记定金。')
      const collected=sum(rs),due=Math.max(0,required(b)-collected),amount=body.amountCents??due
      if(!due&&rs.length){if(body.amountCents!==undefined)throw apiError(409,'DEPOSIT_AMOUNT_EXCEEDS_DUE','本次定金已收齐，请勿重复登记。');return {receipt:d.serializeReceipt(rs[0]),created:false}}
      if(!due)throw apiError(400,'DEPOSIT_AMOUNT_ZERO','本次预约无需补收定金。')
      if(amount>due)throw apiError(409,'DEPOSIT_AMOUNT_EXCEEDS_DUE','实际待收金额已变化，请重新核对，不能多记定金。')
      const tech=body.technicianId||b.technician_id||''
      if(tech&&!db.prepare('SELECT 1 FROM technicians WHERE id=? AND tenant_id=?').get(tech,b.tenant_id))throw apiError(404,'NOT_FOUND','经手技师不存在。')
      const id=randomId('dep'),at=now()
      db.prepare("INSERT INTO deposit_receipts(id,tenant_id,booking_id,user_id,kind,amount_cents,technician_id,pay_channel,reason,actor,created_at) VALUES(?,?,?,?,'receipt',?,NULLIF(?,''),?,?,?,?)").run(id,b.tenant_id,b.id,b.user_id||null,amount,tech,channel,body.note||'',actor,at)
      db.prepare('UPDATE bookings SET deposit_cents=?,final_due_cents=MAX(0,service_price_cents-?),direct_deposit_unpaid=?,updated_at=? WHERE id=? AND tenant_id=?').run(collected+amount,cfg.deductible?collected+amount:0,due>amount?1:0,at,b.id,b.tenant_id)
      db.prepare("UPDATE payments SET amount_cents=?,status=?,updated_at=? WHERE booking_id=? AND provider='OFFLINE'").run(due-amount,due>amount?'REQUIRES_PAYMENT':'SUCCEEDED',at,b.id)
      return {amountCents:amount,receipt:d.serializeReceipt(db.prepare('SELECT * FROM deposit_receipts WHERE id=?').get(id)),created:true}
    })
  }
  function refund({booking,actor='admin',...body}) {
    return transact(booking,body,'refund',actor,(b,channel)=>{
      if(b.status!=='CANCELLED')throw apiError(409,'BOOKING_NOT_CANCELLED','请先按门店规则取消预约，再登记线下退款。')
      const rs=activeDepositReceipts(b.id,b.tenant_id).filter(r=>r.pay_channel==='refund_due'&&!r.settled_settlement_id),due=sum(rs),amount=body.amountCents
      if(!Number.isSafeInteger(amount)||amount<=0||amount>due)throw apiError(409,'REFUND_CHANGED','待退金额已变化，请重新核对。')
      let left=amount
      for(const r of rs){if(!left)break;const part=Math.min(left,r.amount_cents);db.prepare("INSERT INTO deposit_receipts(id,tenant_id,booking_id,user_id,kind,amount_cents,revoke_of,reason,actor,created_at) VALUES(?,?,?,?,'revoke',?,?,?,?,?)").run(randomId('dep'),b.tenant_id,b.id,b.user_id,r.amount_cents,r.id,'线下退款已登记：'+(body.note||''),actor,now());if(part<r.amount_cents)db.prepare("INSERT INTO deposit_receipts(id,tenant_id,booking_id,user_id,kind,amount_cents,pay_channel,reason,actor,created_at) VALUES(?,?,?,?,'receipt',?,'refund_due','线下退款余款',?,?)").run(randomId('dep'),b.tenant_id,b.id,b.user_id,r.amount_cents-part,actor,now());left-=part}
      return {created:true,amountCents:amount,amountText:money(amount,b.tenant_id),remainingCents:due-amount,payChannel:channel,note:'已登记实际线下退款，储值余额不重复返还。'}
    })
  }
  function revoke({booking,actor='admin',reason='',receiptId=''}) {
    if(typeof reason!=='string'||reason.length>200)throw apiError(400,'INVALID_NOTE','原因不得超过200字。')
    db.exec('BEGIN IMMEDIATE')
    try {
      const b=latest(booking),rs=activeDepositReceipts(b.id,b.tenant_id)
      if(b.status==='CANCELLED')throw apiError(409,'BOOKING_CANCELLED','已取消预约请使用线下退款登记。')
      if(db.prepare("SELECT 1 FROM settlements WHERE tenant_id=? AND booking_id=? AND status<>'voided'").get(b.tenant_id,b.id))throw apiError(409,'SETTLEMENT_EXISTS','请先撤回待签服务单，再更正定金记录。')
      const target=receiptId?rs.find(r=>r.id===receiptId):rs[0]
      if(!target)throw apiError(400,'NO_DEPOSIT_RECEIPT','这张预约没有可撤销的定金记录。')
      if(target.settled_settlement_id)throw apiError(400,'DEPOSIT_ALREADY_SETTLED','定金已用于结算，请走金额更正。')
      if(funding.parts(target).slice(0,3).some(Boolean)||target.pay_channel==='retain_carry')throw apiError(409,'STORED_DEPOSIT_REQUIRES_CANCEL','储值或留存定金请按原资金来源处理，不能按线下误标撤销。')
      const at=now(),id=randomId('dep'),rest=sum(rs.filter(r=>r.id!==target.id)),due=Math.max(0,required(b)-rest)
      db.prepare("INSERT INTO deposit_receipts(id,tenant_id,booking_id,user_id,kind,amount_cents,revoke_of,reason,actor,created_at) VALUES(?,?,?,?,'revoke',?,?,?,?,?)").run(id,b.tenant_id,b.id,b.user_id,target.amount_cents,target.id,reason,actor,at)
      db.prepare('UPDATE bookings SET deposit_cents=?,final_due_cents=MAX(0,service_price_cents-?),direct_deposit_unpaid=?,updated_at=? WHERE id=? AND tenant_id=?').run(rest,getDepositConfig(b.tenant_id).deductible?rest:0,due>0?1:0,at,b.id,b.tenant_id)
      db.prepare("UPDATE payments SET amount_cents=?,status=?,updated_at=? WHERE booking_id=? AND provider='OFFLINE'").run(due,due?'REQUIRES_PAYMENT':'SUCCEEDED',at,b.id)
      const original=operations(b).find(o=>o.kind==='collect'&&JSON.parse(o.response_json).receipt?.id===target.id)
      if(original)db.prepare('INSERT INTO deposit_workflow_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(b.tenant_id,id,b.id,'revoke',target.id,target.amount_cents,original.pay_channel,actor,reason,d.todayOf(b.tenant_id),at,JSON.stringify({revokeOf:target.id}))
      db.exec('COMMIT');return {revoked:true,revokeOf:target.id}
    }catch(e){db.exec('ROLLBACK');throw e}
  }
  function settlementView(bookingId,tenantId,deductCents=0) {
    const b=bookingId?db.prepare('SELECT * FROM bookings WHERE id=? AND tenant_id=?').get(bookingId,tenantId):null
    if(!b)return null
    const w=summary(b),rs=activeDepositReceipts(b.id,tenantId).filter(r=>!r.settled_settlement_id&&r.pay_channel!=='refund_due')
    const portions=funding.split(rs.map(r=>r.amount_cents),Math.min(deductCents,sum(rs))),taken=rs.reduce((a,r,i)=>funding.split(funding.parts(r),portions[i]).map((v,k)=>a[k]+v),[0,0,0,0])
    return {bookingId,w,storedAppliedCents:taken[0]+taken[1]+taken[2],offlineAppliedCents:taken[3],
      sourceText:deductCents?`定金来源：储值余额 ${money(taken[0]+taken[1]+taken[2],tenantId)}；门店线下收取 ${money(taken[3],tenantId)}。`:'',
      deductionNote:deductCents?`本次抵扣 ${money(deductCents,tenantId)}。储值部分在预约时已扣，本次不会再扣一次。`:w.canDeduct?`本单有 ${w.display.availableText} 已收定金，尚未抵扣。请核对处理方式。`:w.display.settlementNote,
      warning:`本次预约有 ${w.display.availableText} 已收定金尚未抵扣。关闭抵扣不会把“已收”改成“未收”，也不会自动退款。请核对本单应付金额。`}
  }
  function capture(id,tid,c){if(c.depositDetail?.w?.availableCents)db.prepare('INSERT INTO deposit_settlement_snapshots VALUES(?,?,?)').run(tid,id,JSON.stringify({deductible:c.depositDeductible,storedAppliedCents:c.depositDetail.storedAppliedCents,offlineAppliedCents:c.depositDetail.offlineAppliedCents}))}
  function snapshot(s){const row=db.prepare('SELECT detail_json FROM deposit_settlement_snapshots WHERE tenant_id=? AND settlement_id=?').get(s.tenant_id,s.id);return row?JSON.parse(row.detail_json):null}
  function validate(s){const snap=snapshot(s);if(snap&&snap.deductible!==(getDepositConfig(s.tenant_id).deductible!==false))throw apiError(409,'DEPOSIT_RULE_CHANGED','定金抵扣规则已变化，请店员重新核对服务单后再签署。')}
  function sourceRows(s){const snap=snapshot(s);return snap&&s.deposit_deduct_cents>0?[{key:'depositStoredSource',label:'其中：储值已抵定金（不再扣余额）',amountText:money(snap.storedAppliedCents,s.tenant_id)},{key:'depositOfflineSource',label:'其中：门店线下收取',amountText:money(snap.offlineAppliedCents,s.tenant_id)}]:[]}
  // Caller owns the signing transaction. Only the amount actually applied is released.
  function settle(s,actor='system') {
    if(!s?.booking_id)return
    validate(s)
    const rs=activeDepositReceipts(s.booking_id,s.tenant_id).filter(r=>!r.settled_settlement_id&&r.pay_channel!=='refund_due'),deductible=getDepositConfig(s.tenant_id).deductible
    const amount=deductible?(s.deposit_deduct_cents||0):sum(rs)
    if(!amount)return
    if(amount>sum(rs))throw apiError(409,'DEPOSIT_CHANGED','已收定金已变化，请重新核对服务单。')
    const portions=funding.split(rs.map(r=>r.amount_cents),amount)
    for(let i=0;i<rs.length;i++) {
      if(!portions[i])continue
      let r=rs[i];const used=portions[i]
      if(used<r.amount_cents){
        const source=r,values=funding.parts(source),take=funding.split(values,used),at=now()
        db.prepare("INSERT INTO deposit_receipts(id,tenant_id,booking_id,user_id,kind,amount_cents,revoke_of,reason,actor,created_at) VALUES(?,?,?,?,'revoke',?,?,?,?,?)").run(randomId('dep'),s.tenant_id,s.booking_id,source.user_id,source.amount_cents,source.id,'结算部分使用：拆分留存原记录',actor,at)
        for(const [n,parts,label] of [[used,take,'本单抵扣'],[source.amount_cents-used,values.map((v,k)=>v-take[k]),'未使用定金保留']]){
          const id=randomId('dep');db.prepare("INSERT INTO deposit_receipts(id,tenant_id,booking_id,user_id,kind,amount_cents,pay_channel,reason,actor,created_at) VALUES(?,?,?,?,'receipt',?,?,?,?,?)").run(id,s.tenant_id,s.booking_id,source.user_id,n,source.pay_channel,label+' · '+source.id,actor,at)
          const created=db.prepare('SELECT * FROM deposit_receipts WHERE id=?').get(id);funding.record(created,parts,[source.id]);if(label==='本单抵扣')r=created
        }
      }
      d.insertFinanceTransaction({tenantId:s.tenant_id,type:'income',source:'settlement',tags:s.code,category:deductible?'服务收入-定金':'定金收入',amountCents:funding.normalAmount(r),payChannel:r.pay_channel||'offline',occurredOn:d.todayOf(s.tenant_id),bookingId:s.booking_id,note:deductible?`服务单 ${s.code} 实际抵扣定金转收入`:`${s.code} 定金转收入（本店不抵尾款）`,createdBy:actor})
      db.prepare('UPDATE deposit_receipts SET settled_settlement_id=? WHERE id=?').run(s.id,r.id)
    }
    if(deductible)db.prepare("UPDATE settlement_payments SET status='paid' WHERE settlement_id=? AND leg='deposit' AND status<>'paid'").run(s.id)
  }
  function drawer(date,tenantId){const rows=db.prepare("SELECT kind,amount_cents FROM deposit_workflow_operations WHERE tenant_id=? AND store_date=? AND pay_channel='cash'").all(tenantId,date);return {depositCashCents:rows.reduce((n,r)=>n+(r.kind==='collect'?1:-1)*r.amount_cents,0),depositCashCount:rows.length}}
  async function routes(req,res,{path,adminSession}) {
    const match=path.match(/^\/admin\/bookings\/([^/]+)\/(deposit-receipt|deposit-refund|deposit-cancel-preview)$/)
    if(!match||!['GET','POST'].includes(req.method))return false
    if(!['owner','staff'].includes(adminSession.role))throw apiError(403,'FORBIDDEN','需要员工或老板权限。')
    const b=db.prepare('SELECT * FROM bookings WHERE id=? AND tenant_id=?').get(decodeURIComponent(match[1]),d.currentTenantId())
    if(!b)throw apiError(404,'NOT_FOUND','找不到这张预约。');d.assertStaff(adminSession,b)
    if(match[2]==='deposit-cancel-preview'){if(req.method!=='GET')throw apiError(405,'METHOD_NOT_ALLOWED','请重新核对取消预览。');d.json(res,200,checkout.cancelPreview(b));return true}
    if(req.method==='GET'){const receipts=db.prepare('SELECT * FROM deposit_receipts WHERE tenant_id=? AND booking_id=? ORDER BY created_at,id').all(b.tenant_id,b.id);d.json(res,200,{receipts:receipts.map(d.serializeReceipt),activeCents:sum(activeDepositReceipts(b.id,b.tenant_id)),workflow:summary(b),operator:d.actorOf(adminSession),bookingLabel:[db.prepare('SELECT display_name FROM users WHERE id=? AND tenant_id=?').get(b.user_id,b.tenant_id)?.display_name,b.public_code,b.appointment_start?d.formatTime(b.appointment_start,b.tenant_id):''].filter(Boolean).join(" · ")});return true}
    const body=await d.readBody(req);if(!body||typeof body!=='object'||Array.isArray(body))throw apiError(400,'INVALID_INPUT','请核对提交内容。');const out=(match[2]==='deposit-refund'?refund:receive)({...body,booking:b,actor:d.actorOf(adminSession)})
    d.json(res,out.created?201:200,{...out,workflow:summary(latest(b)),booking:d.serializeBooking(latest(b))});return true
  }
  return {summary,receive,refund,revoke,settlementView,settle,drawer,routes,capture,validate,sourceRows}
}
