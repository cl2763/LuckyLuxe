// Stored value → deposit is a liability transfer, not a sale or cash receipt.
// Funding allocations are append-only; refunds restore precisely the original buckets.
export function createBookingDepositFunding({db,randomId,apiError,balanceOf,refundFacts,formatMoneyCents}) {
  db.exec(`CREATE TABLE IF NOT EXISTS booking_deposit_funding (
    receipt_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,
    legacy_cents INTEGER NOT NULL CHECK(legacy_cents>=0),paid_cents INTEGER NOT NULL CHECK(paid_cents>=0),bonus_cents INTEGER NOT NULL CHECK(bonus_cents>=0),
    source_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS booking_deposit_funding_no_update BEFORE UPDATE ON booking_deposit_funding BEGIN SELECT RAISE(ABORT,'deposit funding is append-only');END;
    CREATE TRIGGER IF NOT EXISTS booking_deposit_funding_no_delete BEFORE DELETE ON booking_deposit_funding BEGIN SELECT RAISE(ABORT,'deposit funding is append-only');END;`)
  const sum=a=>a.reduce((n,x)=>n+x,0)
  function parts(r){const f=db.prepare('SELECT * FROM booking_deposit_funding WHERE receipt_id=? AND tenant_id=?').get(r.id,r.tenant_id);return f?[f.legacy_cents,f.paid_cents,f.bonus_cents,r.amount_cents-f.legacy_cents-f.paid_cents-f.bonus_cents]:[0,0,0,r.amount_cents]}
  function split(values,amount){if(values.some(v=>!Number.isSafeInteger(v)||v<0))throw apiError(409,'DEPOSIT_RECONCILIATION_REQUIRED','定金来源金额无效，请先核对。');const total=sum(values);if(!Number.isSafeInteger(total)||!Number.isSafeInteger(amount)||amount<0||amount>total)throw apiError(409,'DEPOSIT_RECONCILIATION_REQUIRED','定金来源与金额不一致，请核对。');if(!total)return values.map(()=>0);const out=values.map(v=>Number(BigInt(v)*BigInt(amount)/BigInt(total)));let rest=amount-sum(out);const ranked=values.map((v,i)=>({i,r:Number(BigInt(v)*BigInt(amount)%BigInt(total))})).sort((a,b)=>b.r-a.r||a.i-b.i);for(const x of ranked){if(rest<=0)break;if(out[x.i]<values[x.i]){out[x.i]++;rest--}}return out}
  function record(receipt,values,sources){if(!sum(values.slice(0,3)))return;db.prepare('INSERT INTO booking_deposit_funding VALUES(?,?,?,?,?,?,?,?)').run(receipt.id,receipt.tenant_id,receipt.user_id,...values.slice(0,3),JSON.stringify(sources),new Date().toISOString())}
  function ledger({tenantId,userId,bookingId,values,type,source}){
    const now=new Date().toISOString(),ids=[];for(const [bucket,amount,paid,bonus] of [['legacy',values[0],values[0],0],['normal',values[1]+values[2],values[1],values[2]]]){if(!amount)continue;const id=randomId('sv');db.prepare(`INSERT INTO stored_value_transactions(id,tenant_id,user_id,type,amount_cents,pay_channel,note,created_by,created_at,bucket,paid_part_cents,bonus_part_cents,request_id) VALUES(?,?,?,?,?,'stored_value',?,'booking_deposit',?,?,?,?,?)`).run(id,tenantId,userId,type,type==='deposit_hold'?-amount:amount,`${type==='deposit_hold'?'预约定金储值抵扣':'取消预约定金返还'} · ${bookingId} · ${source}`,now,bucket,paid,bonus,`${type}:${source}:${bucket}`);ids.push(id)}return ids
  }
  function hold(booking,amount,receipt){const bal=balanceOf(booking.user_id,booking.tenant_id),facts=refundFacts(booking.user_id,booking.tenant_id);if(amount>bal.totalCents)throw apiError(409,'INSUFFICIENT_BALANCE','账户余额已变化，请重新核对。');const legacy=Math.min(amount,Math.max(0,bal.legacyCents)),normal=amount-legacy,paid=Math.min(normal,Math.max(0,facts.paidRefundableCents-legacy));const values=[legacy,paid,normal-paid,0],ids=ledger({tenantId:booking.tenant_id,userId:booking.user_id,bookingId:booking.id,values,type:'deposit_hold',source:receipt.id});record(receipt,values,ids);return values}
  function giveBack(booking,receipt,values){return ledger({tenantId:booking.tenant_id,userId:booking.user_id,bookingId:booking.id,values,type:'deposit_return',source:receipt.id})}
  function summary(booking){
    const n=db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM payments WHERE booking_id=? AND provider='STORED_VALUE'").get(booking.id).n
    const carried=db.prepare("SELECT COALESCE(SUM(f.legacy_cents+f.paid_cents+f.bonus_cents),0) n FROM booking_deposit_funding f JOIN deposit_receipts r ON r.id=f.receipt_id WHERE r.tenant_id=? AND r.booking_id=? AND r.kind='receipt' AND r.pay_channel='retain_carry' AND r.reason LIKE '留存转入%'").get(booking.tenant_id,booking.id).n
    if(!n&&!carried)return null
    const offlineDueCents=booking.status==='CANCELLED'?0:db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM payments WHERE booking_id=? AND provider='OFFLINE' AND status='REQUIRES_PAYMENT'").get(booking.id).n
    return {storedDeductionCents:n,storedDeductionText:formatMoneyCents(n,booking.tenant_id,2),retainedStoredCents:carried,retainedStoredText:formatMoneyCents(carried,booking.tenant_id,2),offlineDueCents,offlineDueText:formatMoneyCents(offlineDueCents,booking.tenant_id,2)}
  }
  return {parts,split,record,hold,giveBack,summary,normalAmount:r=>r.amount_cents-parts(r)[0]}
}
