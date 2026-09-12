/* P3 通知调度器回归(店主 2026-08-30g 开工令件5)
   判据清单(指令原文):队列生成(各触发事由至少一形)/ 幂等(同事由重跑零重复)/
   隔离(A 店事件不进 B 店队列)/ 时区(门店时区唯一源)/ 失败必落 FAILED+原因(零吞)/
   后端终闸 / 越权 / 两端渲染链(一份数据两端渲染律)。
   ⚠️ standalone:bash apps/api/run-all-tests.sh(全量;单套跑法见 run-all-tests.sh 头注) */
import { assertTestTarget } from './test-guard.mjs'
import { readFileSync } from 'node:fs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}

const { DatabaseSync } = await import('node:sqlite')
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH(run-all-tests.sh 会给)') })())

/* ===== 夹具:A 店(多伦多)+ B 店(上海)—— 时区断言的两只脚 ===== */
const tA = `nfa-${RUN}`
const tB = `nfb-${RUN}`
check('夹具:A 店(America/Toronto)建店 201',
  (await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tA, name: `通知A店${RUN}`, plan: 'chain', timezone: 'America/Toronto' }) })).status === 201)
check('夹具:B 店(Asia/Shanghai)建店 201',
  (await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tB, name: `通知B店${RUN}`, plan: 'chain', timezone: 'Asia/Shanghai' }) })).status === 201)
const HA = { 'x-admin-tenant-id': tA, 'x-tenant-id': tA }
const HB = { 'x-admin-tenant-id': tB, 'x-tenant-id': tB }

const catA = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ name: '美甲', isBookable: true }) }, PLATFORM, HA)).data.category.id
const svcA = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `通知甲${RUN}`, nameEn: 'n', priceCents: 9900, baseDurationMin: 60, categoryId: catA }) }, PLATFORM, HA)).data.service.id
const techA = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `通知技${RUN}`, isActive: true }) }, PLATFORM, HA)).data.technician.id
const uA = (await request(`/platform/tenants/${tA}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `通知客A${RUN}`, phone: `137${RUN.slice(-8)}` }] }) })).data.users[0].userId
const uB = (await request(`/platform/tenants/${tB}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `通知客B${RUN}`, phone: `138${RUN.slice(-8)}` }] }) })).data.users[0].userId
const todayA = (await request('/admin/store-clock', {}, PLATFORM, HA)).data.today
/* 排单一律用「门店明天」:今天 2x:30 的时段在深夜 CI 里会变成过去,提醒不排 → 断言误红 */
const tmA = (() => { const d = new Date(`${todayA}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()

const queueOf = async (H, q = '') => (await request(`/admin/notify/queue${q}`, {}, PLATFORM, H)).data.tasks || []
const tick = async (H, now) => (await request('/admin/notify/tick', { method: 'POST', body: JSON.stringify(now ? { now } : {}) }, PLATFORM, H)).data.tick

/* ===== ① 规则面:默认形 + 后端终闸 + 越权 ===== */
{
  const rules = (await request('/admin/notify/rules', {}, PLATFORM, HA)).data.rules
  check('① 规则读口回全 8 类(事件+提醒默认开,扫描类默认关待店家打开)',
    rules.length === 8
    && rules.filter((r) => ['booking_created', 'booking_rescheduled', 'booking_cancelled', 'arrival_reminder'].includes(r.type)).every((r) => r.enabled)
    && rules.filter((r) => ['card_expiring', 'birthday', 'revisit', 'coupon_expiring'].includes(r.type)).every((r) => !r.enabled),
    JSON.stringify(rules.map((r) => [r.type, r.enabled])))
  check('① 后端终闸:提前量 0 分钟 → 400(前端拦只算体验)',
    (await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'arrival_reminder', enabled: true, offsetMinutes: 0 }] }) }, PLATFORM, HA)).status === 400)
  check('① 后端终闸:回访间隔 1 天 → 400',
    (await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'revisit', enabled: true, revisitDays: 1 }] }) }, PLATFORM, HA)).status === 400)
  check('① 后端终闸:未知类型 → 400',
    (await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'hack_type', enabled: true }] }) }, PLATFORM, HA)).status === 400)
  const staffLogin = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: 'staff@luckyluxeatelier.com', password: 'LuckyluxeStaff0312' }) }, null)
  const STAFF = staffLogin.data?.auth?.accessToken
  check('① 越权:员工 PUT 规则 → 403(店铺级配置仅老板)', STAFF
    ? (await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [] }) }, STAFF)).status === 403
    : false, STAFF ? '' : 'staff 登录失败')
  check('① 越权:员工手动 tick → 403',
    (await request('/admin/notify/tick', { method: 'POST', body: JSON.stringify({}) }, STAFF)).status === 403)
}

/* ===== ② 事件形:建单 → created 通知 + 预约前提醒(提前量数学恰等) ===== */
let bk1
{
  const mk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: uA, serviceId: svcA, technicianId: techA, date: tmA, time: '23:30', durationMin: 30 }) }, PLATFORM, HA)
  check('② 夹具:明日 23:30 建单 201', mk.status === 201, JSON.stringify(mk.data).slice(0, 120))
  bk1 = mk.data.booking.id
  const q = await queueOf(HA)
  const created = q.find((t) => t.type === 'booking_created' && t.bookingId === bk1)
  const rem = q.find((t) => t.type === 'arrival_reminder' && t.bookingId === bk1)
  check('🔴 ② 建单 → created 通知 + 预约前提醒双双入队(文案后端出句)',
    Boolean(created && rem) && /预约已确认/.test(created.text) && /提醒您/.test(rem.text), JSON.stringify(q).slice(0, 200))
  const bkRow = db.prepare('SELECT appointment_start FROM bookings WHERE id = ?').get(bk1)
  const expect = new Date(new Date(bkRow.appointment_start).getTime() - 120 * 60000).toISOString()
  check('🔴 ② 提醒时刻 = 预约开始 − 提前量(默认 120 分钟),毫秒恰等', rem.scheduledAt === expect, `${rem.scheduledAt} vs ${expect}`)
  // D93(31s 走查重铺自检):计划时刻人读句由后端按店时区出(whenText),两端不许再裸切 ISO(那切出来是 UTC)
  {
    const p93 = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(expect))
    const g93 = (t) => p93.find((x) => x.type === t).value
    const want93 = `${g93('month')}-${g93('day')} ${g93('hour')}:${g93('minute')}`
    check('🔴 D93 whenText=店时区人读句(不是 ISO 裸切的 UTC)', rem.whenText === want93, `${rem.whenText} vs ${want93}`)
    const { readFileSync: rf93 } = await import('node:fs')
    const R93 = new URL('../..', import.meta.url).pathname
    const web93 = rf93(`${R93}apps/web/notify-settings.js`, 'utf8')
    const mini93 = rf93(`${R93}miniprogram/pages/merchant/notify-settings/index.js`, 'utf8')
    check('D93 两端零裸切残留(L2 机械扫尽:scheduledAt 不再被 slice)', !web93.includes(".slice(5, 16)") && !mini93.includes(".slice(5, 16)") && web93.includes('t.whenText') && mini93.includes('t.whenText'))
  }
  const tk = await tick(HA)
  check('② tick:created 到点即发(站内通道),summary 六字段齐(心跳契约)',
    ['at', 'tenants', 'scans', 'due', 'sent', 'failed', 'cancelled'].every((k) => k in tk) && tk.sent >= 1, JSON.stringify(tk))
  const sent = (await queueOf(HA)).find((t) => t.id === created.id)
  check('② created 状态机 PENDING→SENT + 送达日志落 notification_logs', sent.status === 'SENT'
    && db.prepare("SELECT COUNT(*) AS n FROM notification_logs WHERE task_id = ? AND status = 'sent'").get(created.id).n === 1)
  await tick(HA)
  check('🔴 ② 不重发:再 tick 一轮,SENT 不回炉、送达日志仍恰 1 条(重启不重发同机制:状态在库不在内存)',
    db.prepare("SELECT COUNT(*) AS n FROM notification_logs WHERE task_id = ?").get(created.id).n === 1)
}

/* ===== ③ 改期 / 取消 / 到店:提醒撤得有名有姓 ===== */
{
  const rs = await request(`/admin/bookings/${bk1}/reschedule`, { method: 'POST', body: JSON.stringify({ reason: '试改期' }) }, PLATFORM, HA)
  check('③ 夹具:改期口 200', rs.status === 200, String(rs.status))
  const q = await queueOf(HA)
  check('🔴 ③ 改期 → rescheduled 通知入队 + 原单未发提醒 CANCELLED(原因=预约已改期)',
    q.some((t) => t.type === 'booking_rescheduled' && t.bookingId === bk1)
    && q.find((t) => t.type === 'arrival_reminder' && t.bookingId === bk1).status === 'CANCELLED'
    && q.find((t) => t.type === 'arrival_reminder' && t.bookingId === bk1).failReason === '预约已改期', JSON.stringify(q).slice(0, 260))

  const mk2 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: uA, serviceId: svcA, technicianId: techA, date: tmA, time: '22:30', durationMin: 30 }) }, PLATFORM, HA)
  const bk2 = mk2.data.booking.id
  await request(`/admin/bookings/${bk2}/status`, { method: 'PATCH', body: JSON.stringify({ action: 'cancel', note: '试取消' }) }, PLATFORM, HA)
  const q2 = await queueOf(HA)
  check('🔴 ③ 取消 → cancelled 通知入队 + 该单未发提醒 CANCELLED(原因=预约已取消)',
    q2.some((t) => t.type === 'booking_cancelled' && t.bookingId === bk2)
    && q2.find((t) => t.type === 'arrival_reminder' && t.bookingId === bk2).status === 'CANCELLED'
    && q2.find((t) => t.type === 'arrival_reminder' && t.bookingId === bk2).failReason === '预约已取消')

  const mk3 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: uA, serviceId: svcA, technicianId: techA, date: tmA, time: '21:30', durationMin: 30 }) }, PLATFORM, HA)
  const bk3 = mk3.data.booking.id
  await request(`/admin/bookings/${bk3}/arrival`, { method: 'PATCH', body: JSON.stringify({ arrived: true }) }, PLATFORM, HA)
  const q3 = await queueOf(HA)
  check('③ 到店 → 未发提醒 CANCELLED(原因=顾客已到店;蓝图闭环点)',
    q3.find((t) => t.type === 'arrival_reminder' && t.bookingId === bk3).status === 'CANCELLED'
    && q3.find((t) => t.type === 'arrival_reminder' && t.bookingId === bk3).failReason === '顾客已到店')
}

/* ===== ④ 扫描形:生日 / 次卡到期 / 回访 / 券临期,各至少一形(A 店开扫描) ===== */
{
  const put = await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [
    { type: 'card_expiring', enabled: true, advanceDays: 7 },
    { type: 'birthday', enabled: true },
    { type: 'revisit', enabled: true, revisitDays: 30 },
    { type: 'coupon_expiring', enabled: true, advanceDays: 7 }
  ] }) }, PLATFORM, HA)
  check('④ 夹具:A 店打开四类扫描 200(配置立即生效)', put.status === 200
    && put.data.rules.find((r) => r.type === 'birthday').enabled === true)

  check('④ 夹具:生日=门店今天', (await request(`/admin/customers/${uA}/profile`, { method: 'PATCH', body: JSON.stringify({ birthday: todayA }) }, PLATFORM, HA)).status === 200)
  /* 次卡/回访旧单:结算签署链太长,夹具走直连库造景(造景律:自己造好自己测;ok37 先例) */
  db.prepare(`INSERT INTO member_timecards (id, tenant_id, user_id, package_id, name, total_times, used_times, price_cents, expires_at, created_at)
    VALUES (?, ?, ?, NULL, ?, 10, 3, 88800, ?, ?)`)
    .run(`tcard-nf-${RUN}`, tA, uA, `临期次卡${RUN}`, `${todayA}T12:00:00.000Z`, new Date().toISOString())
  db.prepare(`INSERT INTO bookings (id, tenant_id, public_code, user_id, store_id, technician_id, service_id, status,
      appointment_start, appointment_end, addons_json, reference_images_json, notes, service_price_cents,
      deposit_cents, deposit_required_cents, deposit_waived_cents, final_due_cents, total_duration_min,
      source_channel, created_at, updated_at)
    SELECT ?, ?, ?, user_id, store_id, technician_id, service_id, 'COMPLETED', ?, ?, addons_json, reference_images_json,
      notes, service_price_cents, deposit_cents, deposit_required_cents, deposit_waived_cents, final_due_cents,
      total_duration_min, 'demo-seed', ?, ? FROM bookings WHERE id = ?`)
    .run(`bknf-old-${RUN}`, tA, `NFOLD${RUN}`.slice(0, 12), '2026-07-01T18:00:00.000Z', '2026-07-01T19:00:00.000Z', '2026-07-01T18:00:00.000Z', '2026-07-01T18:00:00.000Z', bk1)
  const cpn = (await request('/admin/coupons', { method: 'POST', body: JSON.stringify({ name: `临期券${RUN}`, discountType: 'amount', amountCents: 1000, validDays: 1 }) }, PLATFORM, HA)).data.coupon
  check('④ 夹具:发一张 1 天后过期的券 201', (await request(`/admin/coupons/${cpn.id}/grant`, { method: 'POST', body: JSON.stringify({ userId: uA, validDays: 1 }) }, PLATFORM, HA)).status === 201)

  db.prepare('DELETE FROM notify_scan_marks WHERE tenant_id = ?').run(tA)   // 让当日扫描重跑(任务幂等由 dedupe 键守,不靠扫描标记)
  await tick(HA)
  const q = await queueOf(HA)
  const has = (type) => q.some((t) => t.type === type && t.userId === uA)
  check('🔴 ④ 四类扫描各至少一形入队:生日/次卡到期/回访/券临期',
    has('birthday') && has('card_expiring') && has('revisit') && has('coupon_expiring'),
    JSON.stringify(q.map((t) => t.type)))
  check('④ 文案后端出句(零回落:句里点名对象与日期)',
    /生日/.test(q.find((t) => t.type === 'birthday').text)
    && /还剩 7 次/.test(q.find((t) => t.type === 'card_expiring').text)
    && /上次到店还是 2026-07-01/.test(q.find((t) => t.type === 'revisit').text))

  /* 🔴 幂等(幂等判据律:键=事件身份「发生过没有」,不是剩余量):删扫描标记强制重扫 → 零重复 */
  const before = q.length
  db.prepare('DELETE FROM notify_scan_marks WHERE tenant_id = ?').run(tA)
  await tick(HA)
  const after = (await queueOf(HA)).length
  check('🔴 ④ 幂等:强制重扫一轮,队列行数一分不动(dedupe_key 唯一索引在守,不是扫描标记在守)',
    after === before, `${before} -> ${after}`)
}

/* ===== ⑤ 隔离 + 时区(门店时区唯一源) ===== */
{
  const qB = await queueOf(HB)
  check('🔴 ⑤ 隔离:A 店一整批事件与扫描,B 店队列零沾染', qB.length === 0, JSON.stringify(qB).slice(0, 120))
  check('⑤ 隔离(库层复核):A 店任务行全部 tenant_id=A',
    db.prepare(`SELECT COUNT(*) AS n FROM reminder_tasks WHERE user_id = ? AND tenant_id != ?`).get(uA, tA).n === 0)

  /* 时区:挑一个「上海已是明天、多伦多还是前一天」的时刻(UTC 02:30 → 上海 10:30,多伦多 22:30 前一天)。
     A、B 各造一个**新**顾客(uA 在 ④ 已有生日任务,同 dedupe 键会盲掉反向断言 —— 判据律:
     先问「缺陷存在时这条会不会照样绿」,用新客让错发变得可观测),生日都=上海那边的日期:
     错的实现(用 UTC/统一时区推日期)会给 A 也发;对的实现只有 B 发 */
  const fake = new Date(Date.now() + 2 * 86400000)
  fake.setUTCHours(2, 30, 0, 0)
  const shDate = fake.toISOString().slice(0, 10)         // 上海本地日 = UTC 日(10:30)
  const uA2 = (await request(`/platform/tenants/${tA}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `时区客A2${RUN}`, phone: `135${RUN.slice(-8)}` }] }) })).data.users[0].userId
  const uB2 = (await request(`/platform/tenants/${tB}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `时区客B2${RUN}`, phone: `136${RUN.slice(-8)}` }] }) })).data.users[0].userId
  await request(`/admin/customers/${uA2}/profile`, { method: 'PATCH', body: JSON.stringify({ birthday: shDate }) }, PLATFORM, HA)
  await request(`/admin/customers/${uB2}/profile`, { method: 'PATCH', body: JSON.stringify({ birthday: shDate }) }, PLATFORM, HB)
  await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'birthday', enabled: true }] }) }, PLATFORM, HB)
  await tick(HA, fake.toISOString())
  const bHit = db.prepare(`SELECT COUNT(*) AS n FROM reminder_tasks WHERE tenant_id = ? AND type = 'birthday' AND user_id = ?`).get(tB, uB2).n
  const aHit = db.prepare(`SELECT COUNT(*) AS n FROM reminder_tasks WHERE tenant_id = ? AND type = 'birthday' AND user_id = ?`).get(tA, uA2).n
  check('🔴 ⑤ 时区:同一 UTC 时刻,上海店(已过日界)出生日任务、多伦多店(本地还是前一天)零生成 —— 门店时区唯一源',
    bHit === 1 && aHit === 0, `B=${bHit} A=${aHit} @${fake.toISOString()}`)
}

/* ===== ⑥ 失败零吞:通道链只配未实装通道 → FAILED + 原因 + 尝试日志 ===== */
{
  /* 先经 API 落行(没存过的类型库里没行,直接 UPDATE 是打空 —— 静默失败器,亲踩):再改通道并自证 changes>0 */
  await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'booking_created', enabled: true }] }) }, PLATFORM, HA)
  const mut = db.prepare(`UPDATE notification_rules SET channel_priority_json = '["sms"]' WHERE tenant_id = ? AND type = 'booking_created'`).run(tA)
  check('⑥ 夹具自证:通道链已真的改成 [sms](changes=1,不许打空)', mut.changes === 1, String(mut.changes))
  const mk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: uA, serviceId: svcA, technicianId: techA, date: tmA, time: '20:30', durationMin: 30 }) }, PLATFORM, HA)
  await tick(HA)
  const t2 = (await queueOf(HA)).find((x) => x.type === 'booking_created' && x.bookingId === mk.data.booking.id)
  check('🔴 ⑥ 发送失败必落 FAILED + fail_reason(静默失败器零容忍;短信通道=接口位未实装)',
    t2.status === 'FAILED' && /CHANNEL_NOT_IMPLEMENTED|短信/.test(t2.failReason), JSON.stringify(t2).slice(0, 200))
  check('⑥ 每次尝试落 notification_logs(failed 行带原因)',
    db.prepare("SELECT COUNT(*) AS n FROM notification_logs WHERE task_id = ? AND status = 'failed' AND fail_reason IS NOT NULL").get(t2.id).n === 1)
  db.prepare(`UPDATE notification_rules SET channel_priority_json = '["inapp"]' WHERE tenant_id = ? AND type = 'booking_created'`).run(tA)
}

/* ===== ⑥b 扫描类默认关(店主 08-30h 照准七条的补条判据):
   新店建出来,通知域零扫描任务 —— 防未来谁顺手改默认,把几百条回访砸进老店。
   反例数据律:给新店塞一个**今天生日**的顾客(最可能露馅的形)再 tick,默认关就必须一条不出;
   变异刀=把 NOTIFY_TYPES 里扫描类默认改开 → 本条必红 ===== */
{
  const tC = `nfc-${RUN}`
  check('⑥b 夹具:新店 C 建店 201',
    (await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tC, name: `默认面店${RUN}`, plan: 'chain', timezone: 'America/Toronto' }) })).status === 201)
  const HC = { 'x-admin-tenant-id': tC, 'x-tenant-id': tC }
  const uC = (await request(`/platform/tenants/${tC}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `默认面客${RUN}`, phone: `134${RUN.slice(-8)}` }] }) })).data.users[0].userId
  const todayC = (await request('/admin/store-clock', {}, PLATFORM, HC)).data.today
  await request(`/admin/customers/${uC}/profile`, { method: 'PATCH', body: JSON.stringify({ birthday: todayC }) }, PLATFORM, HC)
  db.prepare('DELETE FROM notify_scan_marks WHERE tenant_id = ?').run(tC)
  await tick(HC)
  const scanTasks = db.prepare(`SELECT COUNT(*) AS n FROM reminder_tasks WHERE tenant_id = ? AND type IN ('card_expiring','birthday','revisit','coupon_expiring')`).get(tC).n
  const defaults = (await request('/admin/notify/rules', {}, PLATFORM, HC)).data.rules
  check('🔴 ⑥b 扫描类默认关:新店有「今天生日」的顾客,tick 后通知域扫描任务仍为 0 且四类读口全 enabled=false(改默认开即红)',
    scanTasks === 0 && defaults.filter((r) => ['card_expiring', 'birthday', 'revisit', 'coupon_expiring'].includes(r.type)).every((r) => r.enabled === false),
    `scanTasks=${scanTasks}`)
}

/* ===== ⑦ 照《通知与回访设置图 v1.0》:两端渲染链(机械)+ N1-N6 ===== */
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const miniJs = strip(readFileSync(new URL('../../miniprogram/pages/merchant/notify-settings/index.js', import.meta.url), 'utf8'))
  const miniJsRaw = readFileSync(new URL('../../miniprogram/pages/merchant/notify-settings/index.js', import.meta.url), 'utf8')
  const miniWxml = readFileSync(new URL('../../miniprogram/pages/merchant/notify-settings/index.wxml', import.meta.url), 'utf8')
  const storeWxml = readFileSync(new URL('../../miniprogram/pages/merchant/store/index.wxml', import.meta.url), 'utf8')
  const manageJs = readFileSync(new URL('../../miniprogram/pages/merchant/manage/index.js', import.meta.url), 'utf8')
  const webJs = strip(readFileSync(new URL('../../apps/web/notify-settings.js', import.meta.url), 'utf8'))
  const webJsRaw = readFileSync(new URL('../../apps/web/notify-settings.js', import.meta.url), 'utf8')
  const adminJs = strip(readFileSync(new URL('../../apps/web/admin.js', import.meta.url), 'utf8'))
  const adminHtml = readFileSync(new URL('../../apps/web/admin.html', import.meta.url), 'utf8')
  /* 🔴 J族(刀N4 咬出):includes 子串盲 —— 'rules-v2' 含 'rules' 照样绿。判据加界定符:引号闭合的完整端点串 */
  check('🔴 ⑦ 两端读写同三口:rules/queue/preview 在小程序页与网页模块里都在(整串带引号钉)',
    ["'/admin/notify/rules'", "'/admin/notify/queue'", "'/admin/notify/preview'"].every((p2) => miniJs.includes(p2) && webJs.includes(p2)))
  const NOTICE_SENT = '微信/短信通道开通前,所有通知先记录在「记录」页,一条不丢;通道开通后自动补发未来的、不补发历史的。'
  check('⑦ 图合同五诚实句:两端同一句、逐字相等(N4 同文案)',
    miniJsRaw.includes(NOTICE_SENT) && webJsRaw.includes(NOTICE_SENT))
  check('⑦ 图合同二两组同文案:预约通知/关怀回访组题与说明两端逐字同串',
    ['预约通知', '关怀回访', '建议开启:预约的创建/改期/取消与到店前提醒,自动生成通知。', '默认关,开了才扫:次卡到期、生日、定期回访、优惠券临期。']
      .every((t2) => miniJsRaw.includes(t2) && webJsRaw.includes(t2)))
  check('⑦ 图合同三四件套(机械):模板编辑/变量芯片/预览/恢复默认/保存 两端都在',
    ['templateText', 'addChip', 'preview', 'resetTpl', 'saveCard'].every((k) => miniJsRaw.includes(k))
    && ['data-nfy-tpl', 'data-nfy-chip', 'data-nfy-prev', 'data-nfy-reset', 'data-nfy-save'].every((k) => webJsRaw.includes(k)))
  check('⑦ 图合同六记录页:三色点+失败原因+类型筛选 两端都在',
    miniWxml.includes('statusCls') && miniWxml.includes('failReason') && miniWxml.includes('pickFilter')
    && webJsRaw.includes('nfy-dot') && webJsRaw.includes('failReason') && webJsRaw.includes('data-nfy-filter'))
  check('⑦ 双击双发拦:小程序保存钮 _saving 闸在(D88 同族)', miniJsRaw.includes('this._saving) return'))
  /* N6 入口:网页=门店设置独立行(不再埋营业时间抽屉);小程序=门店设置页行,manage 网格入口已摘(入口统一) */
  /* 同族第二处(刀N6 咬出):id 加引号闭合钉,标题文案一并钉 */
  check('🔴 N6 网页门店设置存在「通知与回访」独立行 + 挂载调用(摘入口即红)',
    adminHtml.includes('id="notifySettingsTitle">通知与回访<') && adminHtml.includes('id="notifySettingsBody"')
    && adminJs.includes("NotifySettings.mount(document.querySelector('#notifySettingsBody')"))
  check('N6b 小程序入口=门店设置页行,manage 网格入口已摘(两端入口统一=图合同一)',
    storeWxml.includes('goNotify') && !manageJs.includes('notify-settings'))

  /* ===== N1-N3 行为面(用 A 店接着打) ===== */
  const putT = await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'booking_created', templateText: 'TESTX{顾客名}@{服务}' }] }) }, PLATFORM, HA)
  check('N1 夹具:自定义文案保存 200 且回读 customized', putT.status === 200
    && putT.data.rules.find((r) => r.type === 'booking_created').templateText === 'TESTX{顾客名}@{服务}', JSON.stringify(putT.data.rules?.find((r) => r.type === 'booking_created')).slice(0, 120))
  const mkN1 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: uA, serviceId: svcA, technicianId: techA, date: tmA, time: '19:30', durationMin: 30 }) }, PLATFORM, HA)
  const n1task = (await queueOf(HA)).find((t) => t.type === 'booking_created' && t.bookingId === mkN1.data.booking.id)
  check('🔴 N1 文案保存后,新生成的通知用新文案渲染(记录现测)',
    n1task && n1task.text.startsWith('TESTX') && n1task.text.includes('@'), n1task && n1task.text)
  check('🔴 N2 变量全替换零残留:渲染后的文案里没有任何 {xx}', !/\{[^{}]+\}/.test(n1task.text), n1task.text)
  check('🔴 N2 未知变量在保存口就被 400(后端终闸)',
    (await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'booking_created', templateText: '好{不存在}呀' }] }) }, PLATFORM, HA)).status === 400)
  check('N2b 预览口同闸:未知变量 400、正常文案回渲染句',
    (await request('/admin/notify/preview', { method: 'POST', body: JSON.stringify({ type: 'birthday', templateText: '{顾客名}{没这个}' }) }, PLATFORM, HA)).status === 400
    && /小美/.test((await request('/admin/notify/preview', { method: 'POST', body: JSON.stringify({ type: 'birthday', templateText: '{顾客名}生日快乐' }) }, PLATFORM, HA)).data.preview))
  const putEmpty = await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'booking_created', templateText: '  ' }] }) }, PLATFORM, HA)
  const backDef = putEmpty.data.rules.find((r) => r.type === 'booking_created')
  check('🔴 N3 置空=自动恢复默认(不存空):templateText 回到默认且 customized=false',
    backDef.templateText === backDef.defaultTemplate && backDef.customized === false, JSON.stringify(backDef).slice(0, 140))
  /* N5 员工:记录可读,规则写口 403 */
  const STAFF2 = (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: 'staff@luckyluxeatelier.com', password: 'LuckyluxeStaff0312' }) }, null)).data?.auth?.accessToken
  const stQ = await request('/admin/notify/queue', {}, STAFF2, HA)
  check('N5 员工:记录页可读(200)', stQ.status === 200, String(stQ.status))
  check('N5 员工:规则/文案写口 403',
    (await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'birthday', templateText: 'x{顾客名}' }] }) }, STAFF2, HA)).status === 403)
  /* 部分 PUT 保参数(重做途中咬获的缺陷,断言钉死):只发 enabled 不许把提前量打回默认 */
  await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'arrival_reminder', enabled: true, offsetMinutes: 45 }] }) }, PLATFORM, HA)
  await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'arrival_reminder', enabled: false }] }) }, PLATFORM, HA)
  const keepOff = (await request('/admin/notify/rules', {}, PLATFORM, HA)).data.rules.find((r) => r.type === 'arrival_reminder')
  check('🔴 部分 PUT 保参数:只动开关,提前量 45 不被打回默认 120', keepOff.offsetMinutes === 45, String(keepOff.offsetMinutes))
  await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: 'arrival_reminder', enabled: true, offsetMinutes: 120 }] }) }, PLATFORM, HA)
}

console.log(`✅ test-notify-scheduler 通过 ${checks} 项`)
