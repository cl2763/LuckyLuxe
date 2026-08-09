/* 顾客端单据现场:屏 D2 消费记录徽标三态 + 屏 D3 售后进度(2026-08-10 核验轮补)。

   为什么要单开一块:seed-bigdemo ⑪ 铺的更正单挂在 `created_by='bigdemo'` 的批量单上,
   那批单 **booking_id 是 NULL** —— 顾客端消费记录是按预约列的,挂不上预约的单顾客一辈子看不见。
   同时顾客端演示登录**按店挑顾客**(signInWechatMiniUser 的 demoLogin 旁路,本轮一并修好:
   原来无论进哪家店都登录旗舰店的 demo-cust-01,她在 Jie'Nail 连档案都没有)。
   两头一凑,D2/D3 在顾客端就是纯空页 —— 接口断言全绿也没用,店主开检点进去什么都没有。

   本脚本给**演示登录那个顾客本人**在两店各铺三张单,正好凑齐徽标三态:
     ① 已签署(绿)—— 干净单,金额行保持现状「已结清 …」
     ② 已更正(暖橙)—— 已签后走正规更正链追加一笔差额,右侧金额=实际应付
     ③ 售后中(蓝)—— 已签单转 AFTER_SALES,卡里出三步进度 +「查看服务确认单」

   纪律:
   - 只跑本机(默认 127.0.0.1:4128),不碰生产;开跑先查地址。
   - 全部走正规 API:建预约 → 到店 → 开单(带 bookingId)→ 顾客签 → 更正 / 转售后。
     一处直连库都没有,原单一分不改(更正只追加 settlement_amendments)。
   - 幂等:靠 notes 上的标记先查后写,重跑打印「已有,跳过」,数字一分不动。

   用法:node tools/seed-customer-doc-scene.mjs
*/
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SEED_BASE_URL || 'http://127.0.0.1:4128'
if (!/127\.0\.0\.1|localhost/.test(BASE)) throw new Error('这个脚本只给本机沙盘用,不要指向生产。')
const DB_PATH = join(ROOT, 'apps/api/local-data/lucky-luxe.sqlite')
const TOKEN = readFileSync(join(ROOT, 'apps/api/.env'), 'utf8').split('\n')
  .find((l) => l.startsWith('OWNER_DEMO_TOKEN=')).slice('OWNER_DEMO_TOKEN='.length).trim().replace(/^["']|["']$/g, '')

const TAG = 'D2D3现场'   // 幂等标记:写进预约 notes
const TENANTS = ['jics-nail', 'lucky-luxe']

async function api(tenantId, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tenantId, ...(options.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data).slice(0, 240)}`)
  return data
}
async function pub(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data).slice(0, 240)}`)
  return data
}
function withDb(fn) {
  const db = new DatabaseSync(DB_PATH)
  try { return fn(db) } finally { db.close() }
}
const log = (...a) => console.log(' ', ...a)

// 「今天」问后端要门店时区的今天,别用这台机器的日期(跨零点会差一天)
async function storeToday(tenantId) {
  return (await api(tenantId, '/admin/store-clock')).today
}

/* 现场必须摆在**演示登录真会落到的那个顾客**头上,否则铺了也不是她看到的那一屏。
   这里跟 local-server.mjs signInWechatMiniUser 的 demoLogin 旁路同一条挑法:
   本店单量最多的那位,没有再回落 demo-cust-01。两边口径必须一致。 */
function demoCustomerOf(tenantId) {
  return withDb((db) => db.prepare(`SELECT u.id, u.display_name FROM users u
      WHERE u.tenant_id = ?
      ORDER BY (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.tenant_id = ?) DESC, u.id ASC
      LIMIT 1`).get(tenantId, tenantId)
    || db.prepare('SELECT id, display_name FROM users WHERE id = ?').get('demo-cust-01'))
}

async function seedStore(tenantId) {
  console.log(`\n== ${tenantId} ==`)
  const cust = demoCustomerOf(tenantId)
  if (!cust) { log('这家店一个顾客档案都没有,跳过'); return }
  log(`演示登录会落到:${cust.display_name}(${cust.id})`)
  if (sceneComplete(tenantId, cust.id)) { log('三态齐,跳过(幂等)'); return }

  const techs = (await api(tenantId, '/admin/technicians')).technicians.filter((t) => t.isActive !== false)
  const services = (await api(tenantId, '/admin/services')).services
    .filter((s) => Number(s.priceCents || 0) > 0)
  if (!techs.length || services.length < 3) { log('技师或服务不够,跳过'); return }
  const today = await storeToday(tenantId)

  const scenes = [
    { key: 'signed', note: `${TAG}·已签署`, svc: services[0], tech: techs[0] },
    { key: 'amended', note: `${TAG}·已更正`, svc: services[1 % services.length], tech: techs[1 % techs.length] },
    { key: 'aftersales', note: `${TAG}·售后中`, svc: services[2 % services.length], tech: techs[2 % techs.length] }
  ]
  // 今天的台面已经被演示数据铺满了,挨着试到排得上为止(SLOT_UNAVAILABLE 就换时间/换技师)
  const SLOTS = ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']
  const taken = new Set()

  for (const s of scenes) {
    /* 逐屏续跑而不是全有全无:上一次跑到一半失败留下的半成品(有预约没单 / 有单没更正)
       接着往下做完,不重复建、也不删任何已签的单(账目只追加)。 */
    let booking = existingBooking(tenantId, cust.id, s.note)
    let lastErr = ''
    if (booking) log(`${s.note}:接着上次的 ${booking.public_code}`)
    outer: if (!booking) for (const tech of [s.tech, ...techs]) {
      for (const time of SLOTS) {
        if (taken.has(`${tech.id}@${time}`)) continue
        try {
          booking = (await api(tenantId, '/admin/bookings/direct', {
            method: 'POST',
            body: JSON.stringify({
              userId: cust.id, serviceId: s.svc.id, technicianId: tech.id,
              date: today, time, depositPaid: true, notes: s.note
            })
          })).booking
          taken.add(`${tech.id}@${time}`)
          s.tech = tech
          break outer
        } catch (e) { lastErr = e.message; if (!/SLOT_UNAVAILABLE|OUTSIDE/.test(e.message)) throw e }
      }
    }
    if (!booking) { log(`${s.note}:没排上(${lastErr.slice(0, 90)})`); continue }
    const bookingId = booking.id
    const bookingCode = booking.publicCode || booking.public_code
    await api(tenantId, `/admin/bookings/${encodeURIComponent(bookingId)}/arrival`, { method: 'PATCH', body: JSON.stringify({ arrived: true }) }).catch(() => {})

    let sheet = signedSheetOf(bookingId)
    if (!sheet) {
      /* 卡主(签字人)必须是**本店 users 行**(createSettlementGroup 的两道校验)。
         这也是为什么演示登录要按店挑顾客:跨店的账号根本开不出单来。 */
      const created = (await api(tenantId, '/admin/settlements', {
        method: 'POST',
        body: JSON.stringify({
          cardOwnerUserId: cust.id,
          settlements: [{
            bookingId, tierKey: 'member', depositApplied: false, payIntent: 'offline_full',
            items: [{ serviceId: s.svc.id }],
            technicians: [{ technicianId: s.tech.id, role: 'main', itemNos: [1] }]
          }]
        })
      })).settlements[0]
      // 顾客本人签(手写笔迹进快照,和真实签一条路)
      await pub(`/settlements/${created.code}/sign`, {
        method: 'POST',
        body: JSON.stringify({
          disclaimerAccepted: true, signature: cust.display_name || '顾客',
          strokes: [[{ x: 8, y: 55 }, { x: 30, y: 20 }, { x: 52, y: 58 }, { x: 76, y: 22 }]]
        })
      })
      sheet = signedSheetOf(bookingId)
    }
    if (!sheet) { log(`${s.note}:单没签成,跳过`); continue }

    if (s.key === 'amended' && !amendCountOf(sheet.id)) {
      // 更正链:退回 ¥20(只追加 amendments,原单合计一个字节不改)
      await api(tenantId, `/admin/settlements/${encodeURIComponent(sheet.id)}/amend`, {
        method: 'POST',
        body: JSON.stringify({ totalCents: Math.max(0, sheet.total_cents - 2000), reason: '技师少做了一项,退回差额' })
      })
    }
    if (s.key === 'aftersales' && booking.status !== 'AFTER_SALES') {
      await api(tenantId, `/admin/bookings/${encodeURIComponent(bookingId)}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'AFTER_SALES' }) })
    }
    log(`${s.note}:${bookingCode} · ${sheet.code}`)
  }
}

// —— 下面三个只读查库,给幂等判断用 ——
function existingBooking(tenantId, userId, note) {
  return withDb((db) => db.prepare(
    'SELECT id, public_code, status FROM bookings WHERE tenant_id = ? AND user_id = ? AND notes = ? ORDER BY rowid DESC LIMIT 1'
  ).get(tenantId, userId, note)) || null
}
function signedSheetOf(bookingId) {
  return withDb((db) => db.prepare(
    "SELECT id, code, total_cents FROM settlements WHERE booking_id = ? AND status = 'signed' ORDER BY rowid DESC LIMIT 1"
  ).get(bookingId)) || null
}
function amendCountOf(settlementId) {
  return withDb((db) => db.prepare('SELECT COUNT(*) AS n FROM settlement_amendments WHERE settlement_id = ?').get(settlementId).n)
}
function sceneComplete(tenantId, userId) {
  const rows = withDb((db) => db.prepare(`
    SELECT b.status, s.id AS sid, (SELECT COUNT(*) FROM settlement_amendments a WHERE a.settlement_id = s.id) AS amd
    FROM bookings b LEFT JOIN settlements s ON s.booking_id = b.id AND s.status = 'signed'
    WHERE b.tenant_id = ? AND b.user_id = ? AND b.notes LIKE ?`).all(tenantId, userId, `%${TAG}%`))
  return rows.some((r) => r.sid && !r.amd && r.status !== 'AFTER_SALES')
    && rows.some((r) => r.amd > 0)
    && rows.some((r) => r.status === 'AFTER_SALES' && r.sid)
}

for (const t of TENANTS) {
  try { await seedStore(t) } catch (e) { console.error(`  !! ${t} 没铺成:${e.message}`) }
}

// 铺完自己核一遍:演示登录的顾客在两店各看得见几个徽标
console.log('\n== 清点(顾客端演示登录看得到的) ==')
for (const t of TENANTS) {
  const rows = withDb((db) => db.prepare(`
    SELECT b.status, s.code, (SELECT COUNT(*) FROM settlement_amendments a WHERE a.settlement_id = s.id) AS amd
    FROM bookings b LEFT JOIN settlements s ON s.booking_id = b.id AND s.status = 'signed'
    WHERE b.tenant_id = ? AND b.user_id = ? AND b.notes LIKE ?`).all(t, (demoCustomerOf(t) || {}).id || '', `%${TAG}%`))
  const signed = rows.filter((r) => r.code && !r.amd && r.status !== 'AFTER_SALES').length
  const amended = rows.filter((r) => r.amd > 0).length
  const after = rows.filter((r) => r.status === 'AFTER_SALES').length
  console.log(`  ${t}:已签署 ${signed} · 已更正 ${amended} · 售后中 ${after}`)
}
