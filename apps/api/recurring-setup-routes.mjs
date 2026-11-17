import {beginWriteSavepoint} from './write-savepoint.mjs'
// Rule configuration is separate from generation of recurring ledger entries.
export function createRecurringSetup({db,json,apiError,readBody,currentTenantId,tenantTimezone,localParts,randomId,actorOf,iso,insertFinanceTransaction}){
 try{db.exec('ALTER TABLE finance_recurring_rules ADD COLUMN effective_from TEXT')}catch(e){if(!/duplicate column/i.test(e.message))throw e}
function materialize() {
  const today = localParts(new Date(),tenantTimezone(currentTenantId())).date
  const rules = db.prepare('SELECT * FROM finance_recurring_rules WHERE tenant_id = ? AND active = 1').all(currentTenantId())
  let generated = 0
  for (const rule of rules) {
    const startFrom = rule.last_run_on || rule.effective_from || String(rule.created_at || today).slice(0, 10)
    let cursor = new Date(`${startFrom.slice(0, 7)}-01T12:00:00`)
    for (let i = 0; i < 24; i += 1) {
      const year = cursor.getFullYear()
      const month = cursor.getMonth()
      const lastDay = new Date(year, month + 1, 0).getDate()
      const day = Math.min(rule.day_of_month, lastDay)
      const occurrence = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (occurrence > today) break
      if ((!rule.effective_from || occurrence >= rule.effective_from) && (!rule.last_run_on || occurrence > rule.last_run_on)) {
        insertFinanceTransaction({
          type: 'expense',
          source: 'recurring',
          category: rule.category,
          tags: rule.tags,
          amountCents: rule.amount_cents,
          payChannel: 'unknown',
          occurredOn: occurrence,
          note: `固定支出自动入账：${rule.name}`,
          recurringRuleId: rule.id,
          createdBy: 'recurring-engine'
        })
        rule.last_run_on = occurrence
        db.prepare('UPDATE finance_recurring_rules SET last_run_on = ?, updated_at = ? WHERE id = ?').run(occurrence, iso(new Date()), rule.id)
        generated += 1
      }
      cursor = new Date(year, month + 1, 1, 12)
    }
  }
  return generated
}
 function handle(req,res,{path,adminSession},input,json){
  if (req.method === 'GET' && path === '/admin/finance/recurring') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, {
      rules: db.prepare('SELECT * FROM finance_recurring_rules WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
        .map((row) => ({ id: row.id, name: row.name, category: row.category, tags: row.tags, amountCents: row.amount_cents, cadence: row.cadence, dayOfMonth: row.day_of_month, active: Boolean(row.active), lastRunOn: row.last_run_on,effectiveFrom:row.effective_from }))
    })
  }
  if (req.method === 'POST' && path === '/admin/finance/recurring') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = input
    const name = String(body.name || '').trim()
    const category = String(body.category || '').trim()
    const amountCents = Number(body.amountCents ?? Number(body.amount || 0) * 100)
    const dayOfMonth = Math.min(31, Math.max(1, Number(body.dayOfMonth || 1)))
    if (!name || !category || !Number.isFinite(amountCents) || amountCents <= 0) throw apiError(400, 'BAD_REQUEST', 'name, category and positive amount are required.')
    const id = randomId('finrule')
    db.prepare(`
      INSERT INTO finance_recurring_rules (id, tenant_id, name, category, tags, amount_cents, cadence, day_of_month, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'monthly', ?, 1, ?, ?, ?)
    `).run(id, currentTenantId(), name, category, String(body.tags || ''), amountCents, dayOfMonth, actorOf(adminSession), iso(new Date()), iso(new Date()))
    const generated = 0
    return json(res, 201, { rule: { id, name, category, amountCents, dayOfMonth }, generated })
  }
  const financeRuleMatch = path.match(/^\/admin\/finance\/recurring\/([^/]+)$/)
  if (req.method === 'PATCH' && financeRuleMatch) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const ruleId = decodeURIComponent(financeRuleMatch[1])
    const current = db.prepare('SELECT * FROM finance_recurring_rules WHERE id = ? AND tenant_id = ?').get(ruleId, currentTenantId())
    if (!current) throw apiError(404, 'NOT_FOUND', 'Rule not found.')
    const body = input
    db.prepare(`
      UPDATE finance_recurring_rules SET
        name = ?, category = ?, tags = ?, amount_cents = ?, day_of_month = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(body.name ?? current.name),
      String(body.category ?? current.category),
      String(body.tags ?? current.tags),
      body.amountCents !== undefined ? Math.round(Number(body.amountCents)) : (body.amount !== undefined ? Math.round(Number(body.amount) * 100) : current.amount_cents),
      body.dayOfMonth !== undefined ? Math.min(31, Math.max(1, Number(body.dayOfMonth))) : current.day_of_month,
      body.active === undefined ? current.active : Number(Boolean(body.active)),
      iso(new Date()),
      ruleId
    )
    return json(res, 200, { updated: true })
  }

 }

 const matches=(method,path)=>['GET','POST'].includes(method)&&path==='/admin/finance/recurring'||method==='PATCH'&&/^\/admin\/finance\/recurring\/[^/]+$/.test(path)
 function configure({path,method='GET',body={},adminSession},{platform=false}={}){
  if(!matches(method,path))throw apiError(405,'METHOD_NOT_ALLOWED','固定费用配置不支持。')
  let out
  if(platform&&method!=='GET'){
    if(method!=='POST')throw apiError(409,'EXISTING_RECURRING','已有自动记账规则请由老板在财务模块核对，本次不覆盖。')
    const date=String(body.effectiveFrom||''),today=localParts(new Date(),tenantTimezone(currentTenantId())).date
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||date<=today)throw apiError(400,'FUTURE_DATE_REQUIRED','请选择今天之后的生效日期，初始配置不补记过去账目。')
  }
  beginWriteSavepoint(db, 'recurring_config', 'finance_recurring_rules')
  try{handle({method},null,{path,adminSession},body,(_r,status,data)=>out={status,data});if(platform&&method==='POST'){db.prepare('UPDATE finance_recurring_rules SET effective_from=? WHERE id=? AND tenant_id=?').run(body.effectiveFrom,out.data.rule.id,currentTenantId());out.data.rule.effectiveFrom=body.effectiveFrom}db.exec('RELEASE recurring_config');return out}catch(e){db.exec('ROLLBACK TO recurring_config; RELEASE recurring_config');throw e}
 }
 async function route(req,res,ctx){if(!matches(req.method,ctx.path))return false;const r=configure({...ctx,method:req.method,body:req.method==='GET'?{}:await readBody(req)});if(req.method==='POST')r.data.generated=materialize();json(res,r.status,r.data);return true}
 return {route,configure,materialize}
}
