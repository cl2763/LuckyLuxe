// A merchant inbox reads existing event sources; reading never rewrites notification history.
export function createMerchantMessages({db, apiError, json, localParts, tenantTimezone}) {
  function ensureSchema() {
    db.exec(`CREATE TABLE IF NOT EXISTS merchant_message_reads (
      tenant_id TEXT NOT NULL, account_id TEXT NOT NULL, message_id TEXT NOT NULL,
      read_at TEXT NOT NULL, PRIMARY KEY(tenant_id,account_id,message_id)
    )`)
  }
  function identity(admin) {
    if (!['owner','staff'].includes(admin?.role)) throw apiError(403,'FORBIDDEN','需要商家账号。')
    const key=admin.accountId || admin.email || (admin.provider==='demo-token'?'system-owner':null)
    if (!key) throw apiError(403,'FORBIDDEN','请重新登录商家账号。')
    return key
  }
  function sources(tid, admin) {
    if (admin.role==='staff') {
      if (!admin.technicianId) return []
      return db.prepare('SELECT id,type,message,created_at,read_at FROM staff_nudges WHERE tenant_id=? AND technician_id=? ORDER BY created_at DESC,id DESC LIMIT 100')
        .all(tid,admin.technicianId).map(r=>({id:'nudge:'+r.id,title:r.type.startsWith('duty:')?'值日提醒':'工作提醒',text:r.message,at:r.created_at,readAt:r.read_at}))
    }
    return db.prepare(`SELECT id,type,payload_json,created_at,booking_id FROM reminder_tasks
      WHERE tenant_id=? AND type IN ('booking_created','booking_rescheduled','booking_cancelled')
      ORDER BY created_at DESC,id DESC LIMIT 100`).all(tid).map(r=>{
        let payload;try{payload=JSON.parse(r.payload_json)}catch{payload={}}
        return {id:'booking:'+r.id,title:({booking_created:'新预约',booking_rescheduled:'预约改期',booking_cancelled:'预约取消'})[r.type],text:typeof payload?.text==='string'?payload.text:'该预约事件的消息内容暂不可用。',at:r.created_at,bookingId:r.booking_id}
      })
  }
  function list(tid,admin) {
    const key=identity(admin)
    const read=new Map(db.prepare('SELECT message_id,read_at FROM merchant_message_reads WHERE tenant_id=? AND account_id=?').all(tid,key).map(r=>[r.message_id,r.read_at]))
    const messages=sources(tid,admin).map(r=>{
      const p=localParts(r.at,tenantTimezone(tid))
      return {...r,readAt:r.readAt || read.get(r.id) || null,timeText:p.date+' '+p.time}
    })
    return {messages,unreadCount:messages.filter(r=>!r.readAt).length,scopeText:'最近100条消息中的未读数量；站内消息不代表微信推送已送达。'}
  }
  function markRead(tid,admin,id) {
    const key=identity(admin)
    if(typeof id!=='string'||id.length>200) throw apiError(400,'BAD_REQUEST','无效消息。')
    const row=sources(tid,admin).find(r=>r.id===id)
    if(!row)throw apiError(404,'NOT_FOUND','消息不存在或无权查看。')
    const now=new Date().toISOString()
    if(id.startsWith('nudge:')) {
      db.prepare('UPDATE staff_nudges SET read_at=COALESCE(read_at,?) WHERE id=? AND tenant_id=? AND technician_id=?').run(now,id.slice(6),tid,admin.technicianId)
    } else {
      db.prepare('INSERT OR IGNORE INTO merchant_message_reads(tenant_id,account_id,message_id,read_at) VALUES(?,?,?,?)').run(tid,key,id,now)
    }
    return {ok:true}
  }
  async function route(req,res,{path,tenantId,adminSession}) {
    if(path==='/admin/messages'&&req.method==='GET'){json(res,200,list(tenantId,adminSession));return true}
    const match=path.match(/^\/admin\/messages\/([^/]+)\/read$/)
    if(match&&req.method==='POST'){let id;try{id=decodeURIComponent(match[1])}catch{throw apiError(400,'BAD_REQUEST','无效消息。')};json(res,200,markRead(tenantId,adminSession,id));return true}
    return false
  }
  return {ensureSchema,list,markRead,route}
}
