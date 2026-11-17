import {randomUUID} from 'node:crypto'
import {configFingerprint} from './config-fingerprint.mjs'
const TYPES={customers:{table:'users',name:'display_name',label:'顾客'},technicians:{table:'technicians',name:'name',label:'员工'},packages:{table:'membership_packages',name:'name',label:'套餐'},coupons:{table:'coupons',name:'name',label:'优惠券模板'},'points-prizes':{table:'points_prizes',name:'id',label:'积分奖品'},services:{table:'services',name:'name_zh',label:'服务项目'},categories:{table:'service_categories',name:'name',label:'服务分类'}}
export function recordIsArchived(db,tid,kind,id){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='record_lifecycle'").get()&&db.prepare('SELECT status FROM record_lifecycle WHERE tenant_id=? AND kind=? AND record_id=?').get(tid,kind,id)?.status==='archived'}
export function assertRecordActive(db,apiError,tid,kind,id){if(id&&recordIsArchived(db,tid,kind,id))throw apiError(409,'RECORD_ARCHIVED','资料已归档，请先由老板恢复后办理新业务。')}
export const activeRecords=(db,tid,kind,rows)=>rows.filter(r=>!recordIsArchived(db,tid,kind,r.id))
export function createRecordLifecycle({db,apiError,json,readBody,currentTenantId,todayOf,actorOf}){
 db.exec(`CREATE TABLE IF NOT EXISTS record_lifecycle(tenant_id TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,kind,record_id));
 CREATE TABLE IF NOT EXISTS record_lifecycle_events(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS record_lifecycle_events_no_update BEFORE UPDATE ON record_lifecycle_events BEGIN SELECT RAISE(ABORT,'lifecycle audit is append-only');END;
 CREATE TRIGGER IF NOT EXISTS record_lifecycle_events_no_delete BEFORE DELETE ON record_lifecycle_events BEGIN SELECT RAISE(ABORT,'lifecycle audit is append-only');END;`)
 const state=(tid,kind,id)=>db.prepare('SELECT status FROM record_lifecycle WHERE tenant_id=? AND kind=? AND record_id=?').get(tid,kind,id)?.status||'active'
 const filter=(tid,kind,rows,archive=false)=>rows.filter(r=>archive?state(tid,kind,r.id)==='archived':state(tid,kind,r.id)!=='archived')
 function requireActive(tid,kind,id){if(state(tid,kind,id)==='archived')throw apiError(409,'RECORD_ARCHIVED','这份资料已归档，请先由老板在已归档列表恢复。')}
 function record(tid,kind,id){const spec=TYPES[kind];if(!spec)throw apiError(404,'NOT_FOUND','不支持此资料类型。');const row=db.prepare(`SELECT * FROM ${spec.table} WHERE id=? AND tenant_id=?`).get(id,tid);if(!row)throw apiError(404,'NOT_FOUND','本店没有这份资料。');return {spec,row}}
 function references(tid,kind,id){
  const ignored=new Set(['record_lifecycle','record_lifecycle_events','customer_create_requests',...(kind==='services'?['service_prices','service_price_systems','technician_services']:[]),...(kind==='technicians'?['technician_services']:[]),...(kind==='packages'?['recharge_package_discounts']:[])]);const found=[]
  // Inspect actual persisted references, including snapshots. Unknown references prevent deletion.
  for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
   if(ignored.has(name)||name===TYPES[kind].table)continue
   const cols=db.prepare(`PRAGMA table_info("${name}")`).all(),fields=cols.filter(c=>c.name!=='id'&&(/_id$/.test(c.name)||/_json$/.test(c.name))).map(c=>c.name)
   if(!fields.length)continue
   const tenant=cols.some(c=>c.name==='tenant_id'),terms=fields.map(c=>`"${c}" ${c.endsWith('_json')?'LIKE':'='} ?`),params=fields.map(c=>c.endsWith('_json')?'%'+JSON.stringify(id)+'%':id)
   if(tenant)params.push(tid)
   const n=db.prepare(`SELECT count(*) n FROM "${name}" WHERE (${terms.join(' OR ')})${tenant?' AND tenant_id=?':''}`).get(...params).n
   if(n)found.push({source:name,count:n})
  }
  if(kind==='packages'&&['recharge','stored_value'].includes(record(tid,kind,id).row.kind)&&db.prepare("SELECT 1 FROM stored_value_transactions WHERE tenant_id=? AND type='recharge' LIMIT 1").get(tid)&&!found.some(r=>r.source==='member_pricing_operations'))found.push({source:'legacy_recharge_unattributed',count:1})
  if(kind==='services'||kind==='categories'){
   const row=db.prepare("SELECT value FROM tenant_settings WHERE tenant_id=? AND key='booking_addons'").get(tid)
   if(row?.value.includes(JSON.stringify(id)))found.push({source:'booking_addon_configuration',count:1})
  }
  return found
 }
 function summary(tid,kind,id){
  if(kind==='customers')return {
   ...db.prepare('SELECT phone,email FROM users WHERE tenant_id=? AND id=?').get(tid,id),
   balanceCents:db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM stored_value_transactions WHERE tenant_id=? AND user_id=?').get(tid,id).n,
   pendingCount:db.prepare("SELECT count(*) n FROM bookings WHERE tenant_id=? AND user_id=? AND (status IN ('CONFIRMED','PENDING_PAYMENT','AFTER_SALES') OR after_sales_status IN ('open','pending'))").get(tid,id).n,
   lastVisitAt:db.prepare("SELECT MAX(appointment_start) v FROM bookings WHERE tenant_id=? AND user_id=? AND status='COMPLETED'").get(tid,id).v
  }
  if(kind==='technicians'){const account=db.prepare('SELECT status FROM admin_accounts WHERE tenant_id=? AND technician_id=? ORDER BY created_at DESC LIMIT 1').get(tid,id);return {
   pendingCount:db.prepare("SELECT count(*) n FROM bookings WHERE tenant_id=? AND technician_id=? AND status IN ('CONFIRMED','PENDING_PAYMENT') AND appointment_end>?").get(tid,id,new Date().toISOString()).n,
   accountStatus:account?.status||'none',isActive:!!db.prepare('SELECT is_active FROM technicians WHERE tenant_id=? AND id=?').get(tid,id)?.is_active
  }}
  return {}
 }
 function inspect(tid,kind,id){const {row,spec}=record(tid,kind,id),blockers=[],refs=references(tid,kind,id),now=new Date().toISOString(),today=todayOf(tid)
  const count=(sql,...args)=>db.prepare(sql).get(...args)?.n||0
  const block=(label,n)=>{if(n)blockers.push({label,count:n})}
  if(kind==='customers'){
   block('储值余额未结清',count('SELECT COALESCE(SUM(amount_cents),0) n FROM stored_value_transactions WHERE tenant_id=? AND user_id=?',tid,id)!==0?1:0)
   block('积分余额未处理',count('SELECT COALESCE(SUM(amount),0) n FROM points_transactions WHERE tenant_id=? AND user_id=?',tid,id)!==0?1:0)
   block('仍有可用次卡',count('SELECT count(*) n FROM member_timecards WHERE tenant_id=? AND user_id=? AND total_times-used_times-COALESCE(refunded_times,0)>0 AND (expires_at IS NULL OR expires_at>=?)',tid,id,now))
   block('仍有有效优惠券',count("SELECT count(*) n FROM coupon_grants WHERE tenant_id=? AND user_id=? AND status NOT IN ('used','revoked','expired') AND (expires_at IS NULL OR expires_at>=?)",tid,id,now))
   block('预约或售后尚未结束',count("SELECT count(*) n FROM bookings WHERE tenant_id=? AND user_id=? AND (status IN ('CONFIRMED','PENDING_PAYMENT','AFTER_SALES') OR after_sales_status IN ('open','pending'))",tid,id))
   block('待签服务单',count("SELECT count(*) n FROM settlements WHERE tenant_id=? AND user_id=? AND status='pending_sign'",tid,id)+count("SELECT count(*) n FROM member_service_documents WHERE tenant_id=? AND user_id=? AND status NOT IN ('signed','voided')",tid,id))
   block('尚有留存定金',count("SELECT count(*) n FROM deposit_retains WHERE tenant_id=? AND user_id=? AND status='active'",tid,id))
   block('导入余额待核对',count("SELECT count(*) n FROM migration_pending_balances WHERE tenant_id=? AND user_id=? AND status='pending'",tid,id))
   block('导入赠品尚有余量',count("SELECT count(*) n FROM migration_asset_activations a WHERE a.tenant_id=? AND a.user_id=? AND a.kind='physical' AND (a.expires_on IS NULL OR a.expires_on>=?) AND a.quantity+COALESCE((SELECT SUM(delta) FROM migration_gift_events e WHERE e.grant_id=a.id),0)>0",tid,id,today))
  }
  if(kind==='technicians'){
   block('老板主账号不允许删除或归档',count("SELECT count(*) n FROM admin_accounts WHERE tenant_id=? AND technician_id=? AND role='owner'",tid,id))
   block('未来预约需移交',count("SELECT count(*) n FROM bookings WHERE tenant_id=? AND technician_id=? AND status IN ('CONFIRMED','PENDING_PAYMENT') AND appointment_end>?",tid,id,now))
   block('薪酬尚未结清',count('SELECT count(*) n FROM salary_payrolls WHERE tenant_id=? AND technician_id=? AND paid_at IS NULL',tid,id))
   block('待签单据需处理',count("SELECT count(*) n FROM settlement_technicians st JOIN settlements s ON s.id=st.settlement_id WHERE st.tenant_id=? AND st.technician_id=? AND s.status='pending_sign'",tid,id))
  }
  if(kind==='categories')block('分类内仍有服务项目',count('SELECT count(*) n FROM services WHERE tenant_id=? AND category_id=?',tid,id))
  const status=state(tid,kind,id),actions=status==='archived'?['restore']:blockers.length?[]:refs.length?['archive']:['delete','archive']
  const result={kind,id,name:row[spec.name],status,blockers,references:refs.map(r=>({label:({bookings:'预约记录',settlements:'服务单据',stored_value_transactions:'储值流水',member_timecards:'已发次卡',coupon_grants:'已发优惠券',legacy_recharge_unattributed:'存在未保留套餐编号的历史充值，无法确认未使用',admin_accounts:'关联登录账号',technician_services:'服务分工',technician_schedules:'排班记录',salary_payrolls:'薪酬记录',booking_addon_configuration:'预约附加服务配置'})[r.source]||'相关业务或配置记录',count:r.count})),actions,requiresSalaryReview:kind==='technicians'&&refs.length>0}
  return {...result,summary:summary(tid,kind,id),reviewHash:configFingerprint([row,refs,blockers,status])}
 }
 function perform(tid,kind,id,body,actor){const action=body.action;if(!['delete','archive','restore'].includes(action))throw apiError(400,'BAD_ACTION','操作无效。');const reason=String(body.reason||'').trim();if(!reason||reason.length>200)throw apiError(400,'REASON_REQUIRED','请填写200字以内的操作原因。')
  db.exec('SAVEPOINT record_lifecycle_change')
  try{const info=inspect(tid,kind,id);if(body.reviewHash!==info.reviewHash)throw apiError(409,'REVIEW_CHANGED','关联记录已变化，请重新核对。');if(!info.actions.includes(action))throw apiError(409,'RECORD_IN_USE','请先处理关联事项，历史资料可以归档，不能直接删除。',{review:info});if(action==='archive'&&info.requiresSalaryReview&&body.salaryReviewed!==true)throw apiError(400,'SALARY_REVIEW_REQUIRED','请核对离职薪酬后勾选确认。')
   const {spec}=record(tid,kind,id),now=new Date().toISOString()
   if(action==='delete'){if(kind==='services'){for(const table of ['service_prices','service_price_systems','technician_services'])db.prepare(`DELETE FROM ${table} WHERE service_id=?`).run(id)}if(kind==='technicians')db.prepare('DELETE FROM technician_services WHERE technician_id=?').run(id);if(kind==='packages')db.prepare('DELETE FROM recharge_package_discounts WHERE package_id=? AND tenant_id=?').run(id,tid);db.prepare(`DELETE FROM ${spec.table} WHERE id=? AND tenant_id=?`).run(id,tid)}
   else if(action==='archive'&&kind!=='customers'&&kind!=='categories')db.prepare(`UPDATE ${spec.table} SET is_active=0 WHERE id=? AND tenant_id=?`).run(id,tid)
   if(action==='archive'&&kind==='technicians'){
    db.prepare('DELETE FROM admin_sessions WHERE account_id IN (SELECT id FROM admin_accounts WHERE tenant_id=? AND technician_id=? AND role<>?)').run(tid,id,'owner')
    db.prepare("UPDATE admin_accounts SET status='disabled',updated_at=? WHERE tenant_id=? AND technician_id=? AND role<>'owner'").run(now,tid,id)
   }
   db.prepare('INSERT INTO record_lifecycle VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,kind,record_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').run(tid,kind,id,action==='archive'?'archived':action==='delete'?'deleted':'active',now)
   db.prepare('INSERT INTO record_lifecycle_events VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),tid,kind,id,action,reason,actor,now)
   db.exec('RELEASE record_lifecycle_change');return {ok:true,action,note:action==='restore'?(kind==='customers'?'顾客档案已恢复到日常列表。':kind==='technicians'?'已恢复员工资料；接客状态及登录仍需另行启用。':'已恢复到管理列表；上架状态仍需另行启用。'):action==='archive'?'已归档，历史业务记录保留。':'已删除未使用资料，保留操作记录。'}
  }catch(e){db.exec('ROLLBACK TO record_lifecycle_change; RELEASE record_lifecycle_change');throw e}
 }
 async function route(req,res,{path,query,adminSession}){const m=path.match(/^\/admin\/records\/(customers|technicians|packages|coupons|points-prizes|services|categories)(?:\/([^/]+))?$/);if(!m)return false;if(adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','仅老板可管理资料归档与删除。');const tid=currentTenantId(),[,kind,encoded]=m,id=encoded?decodeURIComponent(encoded):null
  if(req.method==='GET'&&!id){const spec=TYPES[kind],rows=db.prepare(`SELECT id,"${spec.name}" name FROM ${spec.table} WHERE tenant_id=? ORDER BY rowid DESC`).all(tid);json(res,200,{records:filter(tid,kind,rows,query.archived==='1').map(r=>({...r,status:state(tid,kind,r.id),...(query.summary==='1'?summary(tid,kind,r.id):{})})),kind});return true}
  if(req.method==='GET'&&id){json(res,200,inspect(tid,kind,id));return true}
  if(req.method==='POST'&&id){json(res,200,perform(tid,kind,id,await readBody(req),actorOf(adminSession)));return true}
  throw apiError(405,'METHOD_NOT_ALLOWED','不支持此操作。')
 }
 return {route,inspect,perform,filter,requireActive,state}
}
