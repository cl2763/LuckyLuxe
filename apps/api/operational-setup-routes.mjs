// Shared configuration-only boundaries. No payroll closing, payouts or ledger writes.
export function createOperationalSetupRules({db,json,apiError,readBody,currentTenantId,quoteState,iso,staffVisibilityOf,STAFF_VISIBILITY_MODES,monthKeyOf,randomId,actorOf,parseJson2,serializeSalaryPlan,effectiveSalaryPlan}){
 function handle(req,res,{path,query={},adminSession},input,json){
  if (req.method === 'GET' && path === '/admin/quote-settings') {
    return json(res, 200, quoteState.settingsOf(currentTenantId()))
  }
  if (req.method === 'PUT' && path === '/admin/quote-settings') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可改报价设置。')
    const body = input
    const clamp = (v, min, max, name2) => {
      const n = Math.round(Number(v))
      if (!Number.isFinite(n) || n < min || n > max) throw apiError(400, 'BAD_REQUEST', `${name2}须在 ${min}~${max} 之间。`)
      return n
    }
    const now2 = iso(new Date())
    if (body.gapHours !== undefined) {
      db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'session_gap_hours', ?, ?)
        ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(currentTenantId(), String(clamp(body.gapHours, 1, 72, '会话豁口小时')), now2)
    }
    if (body.validHours !== undefined) {
      db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'quote_valid_hours', ?, ?)
        ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(currentTenantId(), String(clamp(body.validHours, 1, 336, '报价有效小时')), now2)
    }
    return json(res, 200, quoteState.settingsOf(currentTenantId()))
  }

  if (path === '/admin/staff-visibility') {
    const tid = currentTenantId()
    if (req.method === 'GET') return json(res, 200, { visibility: staffVisibilityOf(tid), modes: STAFF_VISIBILITY_MODES })
    if (req.method === 'PUT') {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可改员工可见范围。')
      const body = input
      if (!STAFF_VISIBILITY_MODES.includes(body.visibility)) throw apiError(400, 'BAD_REQUEST', '可见性只能是 perf_only / perf_and_salary / salary_only。')
      db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'staff_visibility', ?, ?)
        ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(tid, body.visibility, iso(new Date()))
      return json(res, 200, { visibility: body.visibility })
    }
  }
  /* ===== P2 业绩目标(设置=目标怎么定 / 显示=员工端看什么,两组开关独立)===== */
  if (req.method === 'GET' && path === '/admin/perf-targets') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '业绩目标由店长设置。')
    const tid = currentTenantId()
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(query.month || '')) ? query.month : monthKeyOf()
    const rows = db.prepare('SELECT * FROM perf_targets WHERE tenant_id = ? AND month = ?').all(tid, month)
    const byTech = {}
    for (const r of rows) byTech[r.technician_id] = r
    return json(res, 200, {
      month,
      // 系统默认:设置=总目标、显示=仅总进度。没设过的技师也列出来,但 hasTarget=false
      technicians: db.prepare('SELECT id, name, title FROM technicians WHERE tenant_id = ? ORDER BY name ASC').all(tid).map((t) => {
        const r = byTech[t.id]
        return {
          technicianId: t.id, name: t.name, title: t.title || '',
          hasTarget: Boolean(r),
          mode: r ? r.mode : 'total',
          displayMode: r ? r.display_mode : 'total_only',
          perfTargetCents: r ? r.perf_target_cents : 0,
          cardTargetCents: r ? r.card_target_cents : 0,
          orderTarget: r ? r.order_target : 0
        }
      })
    })
  }
  if (req.method === 'PUT' && path === '/admin/perf-targets') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '业绩目标由店长设置。')
    const tid = currentTenantId()
    const body = input
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.month || '')) ? body.month : monthKeyOf()
    const now = iso(new Date())
    const stmt = db.prepare(`INSERT INTO perf_targets
      (id, tenant_id, technician_id, month, mode, display_mode, perf_target_cents, card_target_cents, order_target, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, technician_id, month) DO UPDATE SET
        mode = excluded.mode, display_mode = excluded.display_mode,
        perf_target_cents = excluded.perf_target_cents, card_target_cents = excluded.card_target_cents,
        order_target = excluded.order_target, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    for (const t of Array.isArray(body.targets) ? body.targets : []) {
      const techId = String(t.technicianId || '')
      if (!db.prepare('SELECT 1 FROM technicians WHERE id = ? AND tenant_id = ?').get(techId, tid)) {
        throw apiError(400, 'BAD_REQUEST', '技师不属于本店。')
      }
      stmt.run(randomId('ptgt'), tid, techId, month,
        t.mode === 'split' ? 'split' : 'total',
        t.displayMode === 'with_split' ? 'with_split' : 'total_only',
        Math.max(0, Math.round(Number(t.perfTargetCents) || 0)),
        Math.max(0, Math.round(Number(t.cardTargetCents) || 0)),
        Math.max(0, Math.round(Number(t.orderTarget) || 0)),
        actorOf(adminSession), now)
    }
    const rows = db.prepare('SELECT * FROM perf_targets WHERE tenant_id = ? AND month = ?').all(tid, month)
    return json(res, 200, { month, saved: rows.length })
  }

  if (req.method === 'GET' && path === '/admin/segment-rules') {
    const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'segment_rules'").get(currentTenantId())
    const defaults = { aDays: 45, aVisits: 3, aSpendCents: 50000, nDays: 30, sDays: 60 }
    return json(res, 200, { rules: Object.assign(defaults, row ? parseJson2(row.value) : {}) })
  }
  if (req.method === 'PUT' && path === '/admin/segment-rules') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可调整分层规则。')
    const body = input
    const nz = (v, dft, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dft }
    const rules = {
      aDays: nz(body.aDays, 45, 1, 365),
      aVisits: nz(body.aVisits, 3, 1, 50),
      aSpendCents: nz(body.aSpendCents, 50000, 0, 100000000),
      nDays: nz(body.nDays, 30, 1, 180),
      sDays: nz(body.sDays, 60, 7, 365)
    }
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'segment_rules', ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(currentTenantId(), JSON.stringify(rules), iso(new Date()))
    return json(res, 200, { rules })
  }

  if (req.method === 'GET' && path === '/admin/salary-plans') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可看薪资方案。')
    const tid = currentTenantId()
    const dft = db.prepare("SELECT * FROM salary_plans WHERE tenant_id = ? AND technician_id = ''").get(tid)
    const customs = db.prepare("SELECT * FROM salary_plans WHERE tenant_id = ? AND technician_id != ''").all(tid)
    const names = {}
    db.prepare('SELECT id, name FROM technicians WHERE tenant_id = ?').all(tid).forEach((t) => { names[t.id] = t.name })
    return json(res, 200, {
      defaultPlan: serializeSalaryPlan(dft),
      plans: customs.map((r) => Object.assign(serializeSalaryPlan(r), { technicianName: names[r.technician_id] || '' }))
    })
  }
  // 生效方案(owner 任意;员工只能查自己)
  if (req.method === 'GET' && path === '/admin/salary-plans/effective') {
    const techId = String(query.technicianId || '').trim()
    if (adminSession.role !== 'owner' && techId !== adminSession.technicianId) throw apiError(403, 'FORBIDDEN', '只能查看自己的方案。')
    const r = effectiveSalaryPlan(techId, currentTenantId())
    return json(res, 200, r)
  }
  // 保存方案(owner):technicianId 空串=全店默认;每个数字均可改(前端已全 input 化)
  if (req.method === 'PUT' && path === '/admin/salary-plans') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可配置薪资方案。')
    const body = input
    const tid = currentTenantId()
    const techId = String(body.technicianId || '').trim()
    if (techId && !db.prepare('SELECT id FROM technicians WHERE id = ? AND tenant_id = ?').get(techId, tid)) {
      throw apiError(404, 'NOT_FOUND', '技师不存在。')
    }
    const template = ['commission', 'base_ladder', 'base_flat'].includes(body.template) ? body.template : 'base_ladder'
    const nz = (v) => Math.max(0, Math.round(Number(v) || 0))
    const pctOk = (v) => Math.min(100, Math.max(0, Number(v) || 0))
    const ladder = (Array.isArray(body.ladder) ? body.ladder : []).slice(0, 8)
      .map((t) => ({ minCents: nz(t.minCents), maxCents: t.maxCents == null ? null : nz(t.maxCents), pct: pctOk(t.pct) }))
      .sort((a, b) => a.minCents - b.minCents)
    if (template === 'base_ladder' && !ladder.length) throw apiError(400, 'BAD_REQUEST', '阶梯模板至少要有一档。')
    // 没传 ladderMode 就保持这份方案原来的算法 —— 存量方案默认 whole,不会因为一次保存被悄悄改成累进
    const prev = db.prepare('SELECT ladder_mode FROM salary_plans WHERE tenant_id = ? AND technician_id = ?').get(tid, techId)
    const ladderMode = body.ladderMode === 'progressive' ? 'progressive'
      : (body.ladderMode === 'whole' ? 'whole' : ((prev && prev.ladder_mode) || 'whole'))
    const onOff = (v) => (v === false ? 0 : 1)
    const customCommissions = (Array.isArray(body.customCommissions) ? body.customCommissions : []).slice(0, 10)
      .map((c) => ({ name: String(c.name || '').trim().slice(0, 30) || '自定义提成', pct: pctOk(c.pct), packageId: c.packageId ? String(c.packageId).slice(0, 60) : null }))
      .filter((c) => c.pct > 0)
    const now = iso(new Date())
    const existing = db.prepare('SELECT id FROM salary_plans WHERE tenant_id = ? AND technician_id = ?').get(tid, techId)
    if (existing) {
      db.prepare(`UPDATE salary_plans SET template = ?, ladder_mode = ?, base_salary_cents = ?, handwork_fee_cents = ?, ladder_json = ?, flat_pct = ?,
        first_recharge_pct = ?, renew_recharge_pct = ?, custom_commissions_json = ?,
        enable_base = ?, enable_handwork = ?, enable_overtime = ?, enable_card_commission = ?,
        overtime_rate_cents = ?, overtime_unit_min = ?, updated_at = ? WHERE id = ?`)
        .run(template, ladderMode, nz(body.baseSalaryCents), nz(body.handworkFeeCents), JSON.stringify(ladder), pctOk(body.flatPct),
          pctOk(body.firstRechargePct), pctOk(body.renewRechargePct), JSON.stringify(customCommissions),
          onOff(body.enableBase), onOff(body.enableHandwork), onOff(body.enableOvertime), onOff(body.enableCardCommission),
          nz(body.overtimeRateCents), body.overtimeUnitMin === 60 ? 60 : 30, now, existing.id)
    } else {
      db.prepare(`INSERT INTO salary_plans (id, tenant_id, technician_id, template, ladder_mode, base_salary_cents, handwork_fee_cents, ladder_json, flat_pct,
        first_recharge_pct, renew_recharge_pct, custom_commissions_json, enable_base, enable_handwork, enable_overtime, enable_card_commission,
        overtime_rate_cents, overtime_unit_min, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomId('splan'), tid, techId, template, ladderMode, nz(body.baseSalaryCents), nz(body.handworkFeeCents), JSON.stringify(ladder), pctOk(body.flatPct),
          pctOk(body.firstRechargePct), pctOk(body.renewRechargePct), JSON.stringify(customCommissions),
          onOff(body.enableBase), onOff(body.enableHandwork), onOff(body.enableOvertime), onOff(body.enableCardCommission),
          nz(body.overtimeRateCents), body.overtimeUnitMin === 60 ? 60 : 30, now, now)
    }
    return json(res, 200, effectiveSalaryPlan(techId, tid))
  }

 }
 const paths=new Set(['/admin/quote-settings','/admin/staff-visibility','/admin/perf-targets','/admin/segment-rules','/admin/salary-plans','/admin/salary-plans/effective'])
 function configure({path,method='GET',body={},query={},adminSession}){
  if(!paths.has(path)||!['GET','PUT'].includes(method)||path.endsWith('/effective')&&method!=='GET')throw apiError(405,'METHOD_NOT_ALLOWED','配置操作不受支持。')
  let out
  db.exec('SAVEPOINT operational_setup')
  try{handle({method},null,{path,query,adminSession},body,(_r,status,data)=>{out={status,data}});if(!out)throw apiError(405,'METHOD_NOT_ALLOWED','配置操作不受支持。');db.exec('RELEASE operational_setup');return out}
  catch(e){db.exec('ROLLBACK TO operational_setup; RELEASE operational_setup');throw e}
 }
 async function route(req,res,ctx){if(!paths.has(ctx.path)||!['GET','PUT'].includes(req.method))return false;const r=configure({...ctx,method:req.method,body:req.method==='PUT'?await readBody(req):{}});json(res,r.status,r.data);return true}
 return {configure,route}
}
