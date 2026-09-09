/* ══ 心跳白名单:这三张表为什么允许在「本机库未动」的前提下还在长(店主 05x §三 要求理由随码)══
 *
 * 判「未动」的两把刀(`tools/db-snapshot.mjs` 逐表行数、`tools/tenant-fingerprint.mjs` 逐行指纹)
 * 会把**调度器自己跑出来的变化**也算成「动了」。它们确实在动,但那是**服务在跑**,不是本批代码写的。
 * 所以这三张表进白名单 —— **但每一行都要过 `tools/heartbeat-shape.mjs` 的形状刀**,不是整表放行:
 *
 * | 表 | 哪一种变化算心跳 | 哪一种算事故(照红) |
 * |---|---|---|
 * | `reminder_tasks` | 同一行 `PENDING → SENT/FAILED`,`sent_at`/`updated_at` 跟着落,**其余列一个字节不变** | payload/金额/归属被改 · 行被删 · 状态往回翻 · 除那三列外任何一列变了 |
 * | `notification_logs` | **只追加**:每发出一条提醒追一行(带 `task_id`) | 旧行被改、被删 —— **一行都算红**(裁 #26 原话) |
 * | `notify_scan_marks` | **只追加**:每天每店一行扫描水位 | 同上 |
 *
 * 形状怎么验(不是靠信任):开批指纹快照里存着每一行的哈希 ——
 * 「状态推进」那种把当前行倒推回发送前再算哈希,必须能在快照里找到;
 * 「只许追加」那种要求快照里的哈希**一条不少地还在**。改一个字节哈希就变,删一行就少一条。
 */
/* P3 通知调度器(店主 2026-08-30g 开工令;蓝图=《商家回访11项需求_完整方案》P3.1-3.3 + 《有迹待办总方案》§5)
   —— 调度器本体现在建,发送通道等 ICP:sender 抽象一层,只有「站内/记录」通道真实落地,
      微信订阅消息/短信只留接口位(实装另批报批)。

   复用地基(公约④先搜复用):
   - 队列表 = 既有 reminder_tasks(报价提醒同表;本域只认 NOTIFY_TYPES 里的 type,
     不碰报价提醒的行,报价那头的 /admin/reminder-tasks 流程原样)。
   - 状态机 = PENDING / SENT / FAILED / CANCELLED(沿用既有大写族,新增 CANCELLED)。
   - 时区 = 门店时区唯一源(deps.localParts + deps.tenantTimezone,不裸 new Date 推日期)。

   纪律件落点:
   - 幂等:每条任务带 dedupe_key(唯一索引),键=「这件事发生过没有」(事件身份),
     不是「现在还剩多少」(幂等判据律);重启/重扫零重复、零丢单(全在库里,无内存态)。
   - 确定终点:每 tick 限量批(TICK_LIMIT),函数必然返回;心跳日志一 tick 一行。
   - 静默失败器零容忍:发送失败必落 FAILED + fail_reason + notification_logs,不吞。 */

/* 《通知与回访设置图 v1.0》(店主 08-31 出图,退回件重做):
   两组八类,每类卡=开关+参数+**可编辑文案模板**(变量芯片+实时预览+恢复默认);
   group='booking'(预约通知,默认开)/ group='care'(关怀回访,默认关,开了才扫)。
   vars=该类允许的变量白名单(N2:保存时未知变量 400,渲染后零 {xx} 残留);
   template=恢复默认的那份(N3:置空=自动恢复默认,不许存空)。 */
export const NOTIFY_TYPES = [
  { type: 'booking_created', label: '新预约确认', kind: 'event', enabled: 1, group: 'booking',
    vars: ['顾客名', '门店名', '日期', '时间', '服务'],
    template: '{顾客名},您在 {门店名} 的预约已确认:{日期} {时间} · {服务}。' },
  { type: 'booking_rescheduled', label: '预约改期通知', kind: 'event', enabled: 1, group: 'booking',
    vars: ['顾客名', '门店名', '日期', '时间', '服务'],
    template: '{顾客名},您在 {门店名} 的预约({日期} {时间} · {服务})已改期,新时段以新预约为准。' },
  { type: 'booking_cancelled', label: '预约取消通知', kind: 'event', enabled: 1, group: 'booking',
    vars: ['顾客名', '门店名', '日期', '时间', '服务'],
    template: '{顾客名},您在 {门店名} 的预约({日期} {时间} · {服务})已取消。' },
  { type: 'arrival_reminder', label: '预约前提醒', kind: 'planned', enabled: 1, offsetMinutes: 120, group: 'booking',
    vars: ['顾客名', '门店名', '日期', '时间', '服务'],
    template: '{顾客名},提醒您 {日期} {时间} 在 {门店名} 有 {服务} 的预约,期待您的光临。' },
  { type: 'card_expiring', label: '次卡到期', kind: 'scan', enabled: 0, advanceDays: 7, group: 'care',
    vars: ['顾客名', '门店名', '余额', '到期日'],
    template: '{顾客名},您在 {门店名} 的次卡还剩 {余额} 次,{到期日} 到期,记得来用。' },
  { type: 'birthday', label: '生日祝福', kind: 'scan', enabled: 0, group: 'care',
    vars: ['顾客名', '门店名'],
    template: '{顾客名},{门店名} 祝您生日快乐!' },
  { type: 'revisit', label: '定期回访', kind: 'scan', enabled: 0, revisitDays: 30, group: 'care',
    vars: ['顾客名', '门店名', '日期'],
    template: '{顾客名},好久不见啦~上次到店还是 {日期},{门店名} 想你了。' },
  /* 券临期:开工令清单没点名,但范围句点到蓝图 P3 件(P3.3 就是它)—— 按蓝图落,默认关,回执报裁 */
  { type: 'coupon_expiring', label: '优惠券临期', kind: 'scan', enabled: 0, advanceDays: 7, group: 'care',
    vars: ['顾客名', '门店名', '到期日'],
    template: '{顾客名},您在 {门店名} 的优惠券将于 {到期日} 过期,别忘了用。' }
]

/* 渲染唯一出口(N2):已知变量全替换,渲染完不许残留任何 {xx} —— 残留即上游没给值,直接抛 */
export function renderNotifyTemplate(tpl, vars) {
  let out = String(tpl || '')
  for (const [k, v] of Object.entries(vars || {})) out = out.split(`{${k}}`).join(String(v ?? ''))
  const left = out.match(/\{[^{}]{1,12}\}/g)
  if (left) throw new Error(`通知文案渲染残留变量:${left.join(' ')}`)
  return out
}
const TYPE_SET = NOTIFY_TYPES.map((t) => t.type)
const TICK_LIMIT = 200

export function createNotifyScheduler(deps) {
  const { db, randomId, iso, apiError, json, readBody, parseJson, localParts, tenantTimezone, DEFAULT_TENANT_ID, dataScope } = deps

  function ensureSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_rules (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        offset_minutes INTEGER,
        advance_days INTEGER,
        revisit_days INTEGER,
        template_id TEXT,
        template_text TEXT,
        channel_priority_json TEXT NOT NULL DEFAULT '["inapp"]',
        quiet_hours_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, type)
      );
      CREATE TABLE IF NOT EXISTS notification_logs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        target_user_id TEXT,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        fail_reason TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        attempted_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notification_logs_task ON notification_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant ON notification_logs(tenant_id, attempted_at);
      CREATE TABLE IF NOT EXISTS notify_scan_marks (
        tenant_id TEXT NOT NULL,
        scan_date TEXT NOT NULL,
        done_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, scan_date)
      );
    `)
    /* 队列表扩列(纪律8:老库跟上一律 try/catch ALTER;reminder_tasks 的 CREATE 在 local-server 顶部,
       此处必然已存在 —— 不会重演 service_notes 那次「表未建先 ALTER」) */
    for (const col of ['dedupe_key TEXT', 'fail_reason TEXT', 'template_id TEXT']) {
      try { db.exec(`ALTER TABLE reminder_tasks ADD COLUMN ${col}`) } catch (error) {
        if (!String(error.message || '').includes('duplicate column')) throw error
      }
    }
    try { db.exec('ALTER TABLE notification_rules ADD COLUMN template_text TEXT') } catch (error) {
      if (!String(error.message || '').includes('duplicate column')) throw error
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_tasks_dedupe ON reminder_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL')
  }

  /* ===== 规则:每店可配 开/关、提前量、回访间隔(缺行=用默认;读口永远回全类型) ===== */
  function rulesOf(tenantId) {
    const rows = db.prepare('SELECT * FROM notification_rules WHERE tenant_id = ?').all(tenantId)
    const byType = new Map(rows.map((r) => [r.type, r]))
    return NOTIFY_TYPES.map((spec) => {
      const r = byType.get(spec.type)
      return {
        type: spec.type, label: spec.label, kind: spec.kind, group: spec.group,
        enabled: r ? Boolean(r.enabled) : Boolean(spec.enabled),
        offsetMinutes: r?.offset_minutes ?? spec.offsetMinutes ?? null,
        advanceDays: r?.advance_days ?? spec.advanceDays ?? null,
        revisitDays: r?.revisit_days ?? spec.revisitDays ?? null,
        vars: spec.vars, defaultTemplate: spec.template,
        templateText: (r && r.template_text) || spec.template,
        customized: Boolean(r && r.template_text),
        channels: (r && parseJson(r.channel_priority_json)) || ['inapp']
      }
    })
  }
  function ruleOf(tenantId, type) { return rulesOf(tenantId).find((r) => r.type === type) }

  function saveRules(tenantId, list) {
    if (!Array.isArray(list)) throw apiError(400, 'BAD_REQUEST', 'rules 必须是数组。')
    const now = iso(new Date())
    const posInt = (v, min, max) => {
      const n = Number(v)
      if (!Number.isFinite(n) || n < min || n > max) return null
      return Math.round(n)
    }
    for (const item of list) {
      const spec = NOTIFY_TYPES.find((s) => s.type === item.type)
      if (!spec) throw apiError(400, 'BAD_REQUEST', `未知通知类型:${String(item.type).slice(0, 40)}`)
      /* 部分 PUT 保底(重做途中咬获的真缺陷):没带的参数按「已存值→默认」回落,
         不许把老板调过的提前量悄悄打回出厂 —— 「点即存」的开关只动开关 */
      const cur = db.prepare('SELECT * FROM notification_rules WHERE tenant_id = ? AND type = ?').get(tenantId, spec.type)
      /* 后端是最终闸:提前量/间隔越界直接 400,不靠前端拦 */
      const offset = spec.type === 'arrival_reminder' ? posInt(item.offsetMinutes ?? cur?.offset_minutes ?? spec.offsetMinutes, 5, 7 * 24 * 60) : null
      if (spec.type === 'arrival_reminder' && offset === null) throw apiError(400, 'BAD_REQUEST', '预约前提醒的提前量须在 5 分钟 ~ 7 天之间。')
      const adv = ('advanceDays' in spec) ? posInt(item.advanceDays ?? cur?.advance_days ?? spec.advanceDays, 1, 60) : null
      if (('advanceDays' in spec) && adv === null) throw apiError(400, 'BAD_REQUEST', `${spec.label}的提前天数须在 1~60 天之间。`)
      const rev = spec.type === 'revisit' ? posInt(item.revisitDays ?? cur?.revisit_days ?? spec.revisitDays, 3, 365) : null
      if (spec.type === 'revisit' && rev === null) throw apiError(400, 'BAD_REQUEST', '回访间隔须在 3~365 天之间。')
      /* 图合同三+N2/N3:文案模板 —— 空=自动恢复默认(存 NULL);变量必须全在该类白名单里 */
      let tplText = null
      if (item.templateText !== undefined) {
        const t = String(item.templateText || '').trim()
        if (t && t !== spec.template) {
          const used = t.match(/\{[^{}]{1,12}\}/g) || []
          const bad = used.filter((u) => !spec.vars.includes(u.slice(1, -1)))
          if (bad.length) throw apiError(400, 'BAD_REQUEST', `「${spec.label}」文案里有不认识的变量:${bad.join(' ')}(可用:${spec.vars.map((v) => `{${v}}`).join('')})`)
          tplText = t.slice(0, 300)
        }
      }
      db.prepare(`INSERT INTO notification_rules (id, tenant_id, type, enabled, offset_minutes, advance_days, revisit_days, template_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, type) DO UPDATE SET enabled = excluded.enabled, offset_minutes = excluded.offset_minutes,
          advance_days = excluded.advance_days, revisit_days = excluded.revisit_days,
          template_text = CASE WHEN ? THEN excluded.template_text ELSE notification_rules.template_text END,
          updated_at = excluded.updated_at`)
        .run(randomId('nrule'), tenantId, spec.type, item.enabled === false ? 0 : 1, offset, adv, rev, tplText, now, now,
          item.templateText !== undefined ? 1 : 0)
    }
    return rulesOf(tenantId)
  }

  /* ===== 入队(幂等唯一出口):INSERT OR IGNORE by dedupe_key ===== */
  function enqueue({ tenantId, type, userId = null, bookingId = null, scheduledAt, dedupeKey, text, refId = null }) {
    const now = iso(new Date())
    const r = db.prepare(`INSERT OR IGNORE INTO reminder_tasks
      (id, tenant_id, user_id, booking_id, type, channel, status, scheduled_at, dedupe_key, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'inapp', 'PENDING', ?, ?, ?, ?, ?)`)
      .run(randomId('ntask'), tenantId, userId, bookingId, type, scheduledAt, dedupeKey, JSON.stringify({ text, refId }), now, now)
    return { created: r.changes > 0 }
  }

  function bookingRow(bookingId) { return db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId) }
  function userName(userId) {
    return (db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) || {}).display_name || '顾客'
  }
  function storeNameOf(tenantId) {
    return (db.prepare('SELECT name FROM stores WHERE tenant_id = ? AND is_active = 1 LIMIT 1').get(tenantId) || {}).name || '本店'
  }
  const cnDate = (ymd) => `${Number(String(ymd).slice(5, 7))}月${Number(String(ymd).slice(8, 10))}日`
  function bookingVars(booking, tid, tz) {
    const p = localParts(booking.appointment_start, tz)
    const svc = booking.service_id ? db.prepare('SELECT name_zh FROM services WHERE id = ?').get(booking.service_id) : null
    return { '顾客名': userName(booking.user_id), '门店名': storeNameOf(tid), '日期': cnDate(p.date), '时间': p.time, '服务': (svc && svc.name_zh) || '到店服务' }
  }
  function textOf(tid, type, vars) {
    return renderNotifyTemplate(ruleOf(tid, type).templateText, vars)
  }

  /* ===== 事件钩(预约创建/改期/取消)+ 预约前提醒的排/重排/撤 ===== */
  function onBookingEvent({ event, bookingId }) {
    const b = bookingRow(bookingId)
    if (!b) return
    const tid = b.tenant_id || DEFAULT_TENANT_ID
    const tz = tenantTimezone(tid)
    const nowIso = iso(new Date())
    const vars = bookingVars(b, tid, tz)
    const rule = ruleOf(tid, `booking_${event}`)
    if (rule?.enabled) {
      enqueue({
        tenantId: tid, type: `booking_${event}`, userId: b.user_id, bookingId: b.id,
        scheduledAt: nowIso, dedupeKey: `${tid}|booking_${event}|${b.id}|${b.appointment_start}`,
        text: textOf(tid, `booking_${event}`, vars)
      })
    }
    if (event === 'created') {
      const ar = ruleOf(tid, 'arrival_reminder')
      if (ar?.enabled && b.appointment_start > nowIso) {
        const at = new Date(new Date(b.appointment_start).getTime() - (ar.offsetMinutes || 120) * 60000)
        /* 临期建单(提前量够不着)→ 立即提醒,不丢 */
        const schedAt = iso(at) < nowIso ? nowIso : iso(at)
        enqueue({
          tenantId: tid, type: 'arrival_reminder', userId: b.user_id, bookingId: b.id, scheduledAt: schedAt,
          dedupeKey: `${tid}|arrival_reminder|${b.id}|${b.appointment_start}`,
          text: textOf(tid, 'arrival_reminder', vars)
        })
      }
    }
    if (event === 'cancelled') cancelPendingForBooking(b.id, '预约已取消')
    /* 本仓改期=撤原单另建新单:原单的未发提醒当场撤(新单建单钩会排自己的新提醒);
       发送闸还会兜一层(status 不在 CONFIRMED/PENDING_PAYMENT 就不发)—— 双保险,窗口零漏发 */
    if (event === 'rescheduled') cancelPendingForBooking(b.id, '预约已改期')
  }
  function onArrived(bookingId) { cancelPendingForBooking(bookingId, '顾客已到店') }
  function cancelPendingForBooking(bookingId, reason) {
    db.prepare(`UPDATE reminder_tasks SET status = 'CANCELLED', fail_reason = ?, updated_at = ?
      WHERE booking_id = ? AND type = 'arrival_reminder' AND status = 'PENDING'`).run(reason, iso(new Date()), bookingId)
  }

  /* ===== 每日扫描(店本地日界一店一天一次;任务本身幂等,重扫也零重复) ===== */
  function daysAfter(dateStr, days) {
    const d = new Date(`${dateStr}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  function runDailyScans(tenantId, parts, nowIso) {
    const rules = rulesOf(tenantId)
    const on = (t) => rules.find((r) => r.type === t)
    const card = on('card_expiring')
    if (card?.enabled) {
      const until = daysAfter(parts.date, card.advanceDays || 7)
      for (const c of db.prepare(`SELECT * FROM member_timecards WHERE tenant_id = ? AND expires_at IS NOT NULL AND expires_at != ''
        AND used_times < total_times AND substr(expires_at, 1, 10) >= ? AND substr(expires_at, 1, 10) <= ?`).all(tenantId, parts.date, until)) {
        enqueue({
          tenantId, type: 'card_expiring', userId: c.user_id, scheduledAt: nowIso,
          dedupeKey: `${tenantId}|card_expiring|${c.id}|${String(c.expires_at).slice(0, 10)}`, refId: c.id,
          text: textOf(tenantId, 'card_expiring', { '顾客名': userName(c.user_id), '门店名': storeNameOf(tenantId), '余额': c.total_times - c.used_times, '到期日': String(c.expires_at).slice(0, 10) })
        })
      }
    }
    const bd = on('birthday')
    if (bd?.enabled) {
      const mmdd = parts.date.slice(5)
      for (const u of db.prepare(`SELECT id, display_name FROM users WHERE tenant_id = ? AND birthday IS NOT NULL AND birthday != ''
        AND substr(birthday, length(birthday) - 4) = ?`).all(tenantId, mmdd)) {
        enqueue({
          tenantId, type: 'birthday', userId: u.id, scheduledAt: nowIso,
          dedupeKey: `${tenantId}|birthday|${u.id}|${parts.date.slice(0, 4)}`,
          text: textOf(tenantId, 'birthday', { '顾客名': u.display_name || '顾客', '门店名': storeNameOf(tenantId) })
        })
      }
    }
    const rv = on('revisit')
    if (rv?.enabled) {
      const days = rv.revisitDays || 30
      for (const row of db.prepare(`SELECT user_id, MAX(substr(appointment_start, 1, 10)) AS last_date
        FROM bookings WHERE tenant_id = ? AND status = 'COMPLETED' GROUP BY user_id`).all(tenantId)) {
        if (!row.last_date) continue
        const dueDate = daysAfter(row.last_date, days)
        if (parts.date < dueDate) continue
        enqueue({
          tenantId, type: 'revisit', userId: row.user_id, scheduledAt: nowIso,
          dedupeKey: `${tenantId}|revisit|${row.user_id}|${dueDate}`,
          text: textOf(tenantId, 'revisit', { '顾客名': userName(row.user_id), '门店名': storeNameOf(tenantId), '日期': row.last_date })
        })
      }
    }
    const cp = on('coupon_expiring')
    if (cp?.enabled) {
      const until = daysAfter(parts.date, cp.advanceDays || 7)
      for (const g of db.prepare(`SELECT g.*, c.name AS coupon_name FROM coupon_grants g LEFT JOIN coupons c ON c.id = g.coupon_id
        WHERE g.tenant_id = ? AND g.status = 'active' AND g.used_at IS NULL AND g.expires_at IS NOT NULL AND g.expires_at != ''
        AND substr(g.expires_at, 1, 10) >= ? AND substr(g.expires_at, 1, 10) <= ?`).all(tenantId, parts.date, until)) {
        /* 每人每券只提醒一次(蓝图 P3.3):键=券的发放行身份,不带日期 */
        enqueue({
          tenantId, type: 'coupon_expiring', userId: g.user_id, scheduledAt: nowIso,
          dedupeKey: `${tenantId}|coupon_expiring|${g.id}`, refId: g.id,
          text: textOf(tenantId, 'coupon_expiring', { '顾客名': userName(g.user_id), '门店名': storeNameOf(tenantId), '到期日': String(g.expires_at).slice(0, 10) })
        })
      }
    }
  }

  /* ===== 发送闸(后端是最终闸):到点先验事由还成不成立,不成立=CANCELLED 有名有姓 ===== */
  function sendGuard(task) {
    if (task.type === 'arrival_reminder') {
      const b = task.booking_id ? bookingRow(task.booking_id) : null
      if (!b) return '预约不存在'
      if (b.arrived_at) return '顾客已到店'
      if (!['CONFIRMED', 'PENDING_PAYMENT'].includes(b.status)) return `预约已是 ${b.status},不再提醒`
    }
    if (task.type === 'coupon_expiring') {
      const refId = (parseJson(task.payload_json) || {}).refId
      const g = refId ? db.prepare('SELECT * FROM coupon_grants WHERE id = ?').get(refId) : null
      if (!g || g.status !== 'active' || g.used_at) return '券已使用或已失效'
    }
    if (task.type === 'card_expiring') {
      const refId = (parseJson(task.payload_json) || {}).refId
      const c = refId ? db.prepare('SELECT * FROM member_timecards WHERE id = ?').get(refId) : null
      if (!c) return '次卡不存在'
      if (c.used_times >= c.total_times) return '次卡已用完'
    }
    return null
  }

  /* ===== 通道抽象:只有「站内/记录」真实落地;微信订阅/短信=接口位(等 ICP,实装另批报批) ===== */
  const senders = {
    inapp(task, text) {
      /* 站内通道的「送达」= 这句话落进店内可见的通知记录(notification_logs 即记录面,队列页读它) */
      return { ok: true, deliveredText: text }
    },
    wechat_subscribe() { throw new Error('CHANNEL_NOT_IMPLEMENTED:微信订阅消息通道等 ICP/资质,实装另批报批') },
    sms() { throw new Error('CHANNEL_NOT_IMPLEMENTED:短信通道等资质,实装另批报批') }
  }

  function logAttempt({ task, channel, status, failReason = null, deliveredAt = null, nowIso }) {
    db.prepare(`INSERT INTO notification_logs (id, tenant_id, task_id, rule_type, target_user_id, channel, status, fail_reason, payload_json, attempted_at, delivered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomId('nlog'), task.tenant_id, task.id, task.type, task.user_id, channel, status, failReason, task.payload_json || '{}', nowIso, deliveredAt)
  }

  /* ===== tick:确定终点(限量批)+ 心跳一行;重启零内存态,库里从哪断从哪续 ===== */
  function runTick(opts = {}) {
    const now = opts.now ? new Date(opts.now) : new Date()
    const nowIso = iso(now)
    const summary = { at: nowIso, tenants: 0, scans: 0, due: 0, sent: 0, failed: 0, cancelled: 0 }
    let tenants = []
    try { tenants = db.prepare("SELECT id FROM tenants WHERE status = 'active'").all().map((r) => r.id) } catch { tenants = [] }
    if (!tenants.length) tenants = [DEFAULT_TENANT_ID]
    summary.tenants = tenants.length
    for (const tid of tenants) {
      const parts = localParts(now, tenantTimezone(tid))
      if (!db.prepare('SELECT 1 FROM notify_scan_marks WHERE tenant_id = ? AND scan_date = ?').get(tid, parts.date)) {
        runDailyScans(tid, parts, nowIso)
        /* 🔴 J-23 白名单理由(随码复核律,Cowork 05i §一):
           这一行就是让 `notify_scan_marks` 进「服务心跳表白名单」的**唯一理由** ——
           调度器**每天每店写一行**,只要 4128 开着就会长,与任何一批代码改动无关。
           `tools/receipt-db-proof.sh` 因此把它排除在「有动」之外。
           ⚠️ 哪天这张表不再由这里写、或写的不只是心跳,**白名单要跟着撤**。 */
        db.prepare('INSERT OR IGNORE INTO notify_scan_marks (tenant_id, scan_date, done_at) VALUES (?, ?, ?)').run(tid, parts.date, nowIso)
        summary.scans += 1
      }
    }
    const due = db.prepare(`SELECT * FROM reminder_tasks WHERE status = 'PENDING' AND scheduled_at <= ?
      AND type IN (${TYPE_SET.map(() => '?').join(',')}) ORDER BY scheduled_at ASC LIMIT ${TICK_LIMIT}`).all(nowIso, ...TYPE_SET)
    summary.due = due.length
    for (const task of due) {
      try {
        const cancelReason = sendGuard(task)
        if (cancelReason) {
          db.prepare("UPDATE reminder_tasks SET status = 'CANCELLED', fail_reason = ?, updated_at = ? WHERE id = ?").run(cancelReason, nowIso, task.id)
          summary.cancelled += 1
          continue
        }
        const text = (parseJson(task.payload_json) || {}).text || ''
        const chain = ruleOf(task.tenant_id, task.type)?.channels || ['inapp']
        let sent = false, lastErr = null
        for (const ch of chain) {
          try {
            const sender = senders[ch]
            if (!sender) throw new Error(`未知通道 ${ch}`)
            sender(task, text)
            logAttempt({ task, channel: ch, status: 'sent', deliveredAt: nowIso, nowIso })
            db.prepare("UPDATE reminder_tasks SET status = 'SENT', channel = ?, sent_at = ?, updated_at = ? WHERE id = ?").run(ch, nowIso, nowIso, task.id)
            sent = true
            break
          } catch (err) {
            lastErr = err
            logAttempt({ task, channel: ch, status: 'failed', failReason: String(err.message || err).slice(0, 300), nowIso })
          }
        }
        if (sent) { summary.sent += 1 } else {
          db.prepare("UPDATE reminder_tasks SET status = 'FAILED', fail_reason = ?, updated_at = ? WHERE id = ?")
            .run(String(lastErr?.message || '所有通道均失败').slice(0, 300), nowIso, task.id)
          summary.failed += 1
        }
      } catch (err) {
        /* 单条炸不许拖垮整批,但绝不吞:落 FAILED + 原因 */
        try {
          db.prepare("UPDATE reminder_tasks SET status = 'FAILED', fail_reason = ?, updated_at = ? WHERE id = ?")
            .run(`tick 处理异常:${String(err.message || err).slice(0, 260)}`, nowIso, task.id)
        } catch { /* 连落败都落不了才走到这,把原始错误抛给心跳层 */ }
        summary.failed += 1
      }
    }
    console.log(`[notify] tick ${nowIso} 店${summary.tenants} 扫${summary.scans} 到点${summary.due} 发${summary.sent} 败${summary.failed} 撤${summary.cancelled}`)
    return summary
  }

  /* ===== 路由(由 local-server 在租户闸门之后分发;纪律7) ===== */
  /* D93(2026-09-01 走查重铺自检咬出):计划/发出时刻原先只回裸 ISO,网页(notify-settings.js)与
     小程序(notify-settings 页)各自 slice(5,16) —— 切出来的是 UTC,21:30 单的提醒显示成「23:30」。
     修法=后端唯一出口:whenText/sentText 按**店时区**算好下发,两端零切串(假数回落红线③同族)。 */
  function taskTimeText(isoStr, tid) {
    if (!isoStr) return ''
    const p = localParts(isoStr, tenantTimezone(tid))
    return `${p.date.slice(5)} ${p.time}`
  }
  function serializeTask(r) {
    const payload = parseJson(r.payload_json) || {}
    return {
      id: r.id, type: r.type, typeLabel: (NOTIFY_TYPES.find((t) => t.type === r.type) || {}).label || r.type,
      userId: r.user_id, customerName: r.user_id ? userName(r.user_id) : '',
      bookingId: r.booking_id, channel: r.channel, status: r.status,
      scheduledAt: r.scheduled_at, sentAt: r.sent_at, failReason: r.fail_reason || '',
      whenText: taskTimeText(r.scheduled_at, r.tenant_id), sentText: taskTimeText(r.sent_at, r.tenant_id),
      text: payload.text || '', createdAt: r.created_at
    }
  }
  async function route(req, res, ctx) {
    const { path, adminSession, tenantId } = ctx
    if (!path.startsWith('/admin/notify/')) return false
    if (req.method === 'GET' && path === '/admin/notify/rules') {
      json(res, 200, { rules: rulesOf(tenantId) })
      return true
    }
    if (req.method === 'PUT' && path === '/admin/notify/rules') {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '通知设置是店铺级配置,仅老板可改。')
      const body = await readBody(req)
      json(res, 200, { rules: saveRules(tenantId, body.rules) })
      return true
    }
    if (req.method === 'GET' && path === '/admin/notify/queue') {
      const status = String(ctx.query?.status || '').toUpperCase()
      const wanted = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'].includes(status) ? [status] : ['PENDING', 'SENT', 'FAILED', 'CANCELLED']
      const rows = db.prepare(`SELECT * FROM reminder_tasks WHERE tenant_id = ? AND type IN (${TYPE_SET.map(() => '?').join(',')})
        AND status IN (${wanted.map(() => '?').join(',')}) ORDER BY scheduled_at DESC LIMIT 200`).all(tenantId, ...TYPE_SET, ...wanted)
      json(res, 200, { tasks: rows.map(serializeTask) })
      return true
    }
    if (req.method === 'POST' && path === '/admin/notify/preview') {
      const body = await readBody(req)
      const spec = NOTIFY_TYPES.find((t) => t.type === body.type)
      if (!spec) throw apiError(400, 'BAD_REQUEST', '未知通知类型。')
      const t = String(body.templateText || '').trim() || spec.template
      const used = t.match(/\{[^{}]{1,12}\}/g) || []
      const bad = used.filter((u) => !spec.vars.includes(u.slice(1, -1)))
      if (bad.length) throw apiError(400, 'BAD_REQUEST', `文案里有不认识的变量:${bad.join(' ')}(可用:${spec.vars.map((v) => `{${v}}`).join('')})`)
      const SAMPLE = { '顾客名': '小美', '门店名': storeNameOf(tenantId), '日期': '9月2日', '时间': '14:00', '服务': '手部美甲', '余额': 6, '到期日': '09-05' }
      const sample = Object.fromEntries(spec.vars.map((v) => [v, SAMPLE[v]]))
      json(res, 200, { preview: renderNotifyTemplate(t, sample) })
      return true
    }
    if (req.method === 'POST' && path === '/admin/notify/tick') {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可手动跑一轮。')
      const body = await readBody(req)
      /* 假「现在」只在非 live 库放行 —— 生产不许时间旅行 */
      const fakeNow = body.now && dataScope !== 'live' ? body.now : null
      json(res, 200, { tick: runTick(fakeNow ? { now: fakeNow } : {}) })
      return true
    }
    return false
  }

  return { ensureSchema, rulesOf, saveRules, onBookingEvent, onArrived, runTick, route, NOTIFY_TYPES }
}
