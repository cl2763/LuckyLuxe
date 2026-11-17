import {assertRecordActive} from './record-lifecycle.mjs'
// Shared new-staff-account boundary; existing accounts/passwords are never reset here.
export function createStaffAccountSetup({db,json,apiError,readBody,currentTenantId,requireAdmin,tenantContext,defaultTenantId,nameToUsername,isValidUsername,randomPassword,randomId,adminPasswordHash,iso}){
 function handle(req,res,{path,query={},adminSession},input,json){
  if (req.method === 'GET' && path === '/admin/staff-accounts') {
    const admin = adminSession
    if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const rows = db.prepare("SELECT id, username, role, technician_id, status, must_change_password, last_login_at FROM admin_accounts WHERE role = 'staff' AND tenant_id = ? ORDER BY created_at ASC").all(currentTenantId())
    return json(res, 200, {
      accounts: rows.map((row) => ({
        id: row.id, username: row.username, technicianId: row.technician_id, status: row.status,
        mustChangePassword: Boolean(row.must_change_password), lastLoginAt: row.last_login_at
      }))
    })
  }
  // 建号弹窗要预填一个用户名 —— 拼音表只在服务端一份,前端问一下就好
  if (req.method === 'GET' && path === '/admin/staff-accounts/suggest') {
    const admin = adminSession
    if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const tech = db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(String(query.technicianId || ''), currentTenantId())
    if (!tech) throw apiError(404, 'NOT_FOUND', 'Technician not found.')
    assertRecordActive(db,apiError,currentTenantId(),'technicians',tech.id)
    const base = nameToUsername(tech.name) || 'staff'
    let username = base
    let suffix = 1
    while (db.prepare('SELECT id FROM admin_accounts WHERE LOWER(username) = ?').get(username)) { suffix += 1; username = `${base}${suffix}` }
    return json(res, 200, { username, base, name: tech.name })
  }
  if (req.method === 'POST' && path === '/admin/staff-accounts') {
    const admin = adminSession
    if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = input
    const tech = db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(String(body.technicianId || ''), currentTenantId())
    if (!tech) throw apiError(404, 'NOT_FOUND', 'Technician not found.')
    assertRecordActive(db,apiError,currentTenantId(),'technicians',tech.id)
    if (db.prepare('SELECT id FROM admin_accounts WHERE technician_id = ?').get(tech.id)) {
      throw apiError(409, 'DUPLICATE', '该技师已有登录账号,可重置密码或停用。')
    }
    /* 用户名(店主 2026-08-09 拍板):**拼音自动生成**(小婕 → xiaojie),重名加数字后缀;
       店主可以在建号弹窗里自己改(仍限英数并查重)。存量的 staff/staff2 不迁移。 */
    const wanted = String(body.username || '').trim().toLowerCase()
    if (wanted && !isValidUsername(wanted)) throw apiError(400, 'BAD_USERNAME', '用户名只能用英文字母和数字,3–20 位。')
    if (wanted && db.prepare('SELECT id FROM admin_accounts WHERE LOWER(username) = ?').get(wanted)) {
      throw apiError(409, 'DUPLICATE', '这个用户名已经有人用了,换一个。')
    }
    const base = wanted || nameToUsername(tech.name) || 'staff'
    let username = base
    let suffix = 1
    while (db.prepare('SELECT id FROM admin_accounts WHERE LOWER(username) = ?').get(username)) { suffix += 1; username = `${base}${suffix}` }
    const initialPassword = randomPassword()
    db.prepare(`INSERT INTO admin_accounts (id, tenant_id, username, display_name, role, technician_id, password_hash, must_change_password, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'staff', ?, ?, 1, 'active', ?, ?)`)
      .run(randomId('acct'), currentTenantId(), username, tech.name, tech.id, adminPasswordHash(username, initialPassword), iso(new Date()), iso(new Date()))
    return json(res, 201, { username, initialPassword, note: '初始密码只显示这一次,请立即发给员工;员工首次登录会被要求改密。' })
  }

 }
 const matches=(method,path)=>method==='GET'&&['/admin/staff-accounts','/admin/staff-accounts/suggest'].includes(path)||method==='POST'&&path==='/admin/staff-accounts'
 function configure({path,method='GET',query={},body={},adminSession}){let out;if(!matches(method,path))throw apiError(405,'METHOD_NOT_ALLOWED','账号操作不支持。');handle({method},null,{path,query,adminSession},body,(_r,status,data)=>out={status,data});return out}
 async function route(req,res,{path,query}){if(!matches(req.method,path))return false;const adminSession=requireAdmin(req);tenantContext.enterWith({tenantId:adminSession.tenantId||defaultTenantId});const r=configure({path,method:req.method,query,body:req.method==='POST'?await readBody(req):{},adminSession});json(res,r.status,r.data);return true}
 return {configure,route}
}
