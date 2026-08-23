/* 演示孪生店铺设 + 跨店同一身份档案(店主 2026-08-23「演示租户与跨店串号检测批」)。

   为什么要孪生店:**店主的真账本不许混演示数据**(边界令①的延伸)。
   每家真店配一个演示孪生租户,演示顾客只进孪生店;真店(lucky-luxe / jics-nail)一行不写。

   本脚本做三件事(全部幂等,重跑只打印「已有,跳过」):
     ① 给演示店补齐目录:服务 / 技师 / 充值套餐 / 次卡套餐 / 券模板
     ② 每店建演示顾客,**会员信息全可见**:等级 / 成长值 / 累计消费 / 到店次数 /
        储值余额 / 次卡 / 券 / 积分 / 历史订单(含已签署单,五读方齐动)
     ③ 造**跨店同一个微信身份**的档案(同一 openid 在两店各一行 users,数字一眼可分辨),
        供跨店串号检测走查

   🔒 边界:
     - 只跑本机/沙箱(BASE 必须是 127.0.0.1 或 localhost),生产一步不碰;
     - 只写「演示租户」白名单里的租户,写别的直接拒绝;
     - 不动任何真店数据。

   用法:SEED_BASE_URL=http://127.0.0.1:4310 node tools/seed-demo-twin.mjs
*/
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SEED_BASE_URL || 'http://127.0.0.1:4310'
if (!/127\.0\.0\.1|localhost/.test(BASE)) throw new Error('演示铺设只给本机沙箱用,不要指向生产。')
const TOKEN = process.env.OWNER_TOKEN || (readFileSync(join(ROOT, 'apps/api/.env'), 'utf8').split('\n')
  .find((l) => l.startsWith('OWNER_DEMO_TOKEN=')) || '').slice('OWNER_DEMO_TOKEN='.length).trim().replace(/^["']|["']$/g, '')

/* 演示租户白名单:名字里必须带「演示」,且 id 不是任何真店。写别的租户直接拒绝。 */
const DEMO_TENANTS = [
  { tenantId: 'demo-lucky-luxe', label: 'Lucky Luxe(演示)', currency: 'CAD', timezone: 'America/Toronto',
    twin: { balance: 88800, timecardTimes: 5, coupons: 1, orders: 2, timecardRemaining: 4, name: '演示·跨店阿珍' } },
  { tenantId: 'jics-sandbox', label: '小婕的店(演示)', currency: 'CNY', timezone: 'Asia/Shanghai',
    twin: { balance: 36600, timecardTimes: 5, coupons: 3, orders: 1, timecardRemaining: 2, name: '演示·跨店阿珍' } }
]
const REAL_TENANTS = ['lucky-luxe', 'jics-nail', 'jics-store']
const CROSS_OPENID = 'demo-openid-crossshop-a-zhen'   // 同一个微信身份,两店各一行 users

async function api(tenantId, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tenantId, 'x-tenant-id': tenantId, ...(options.headers || {}) }
  })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch (e) { data = { raw: text.slice(0, 200) } }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}
async function platform(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch (e) { data = { raw: text.slice(0, 200) } }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}
/* 演示店贴 openid 用(见 seedMember 里的说明);不给就跳过绑定,充值会被 D25 闸挡下 */
const DB_PATH = process.env.SEED_DB_PATH || ''
const log = (...a) => console.log(...a)
const dateStr = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
}

async function ensureTenant(spec) {
  if (REAL_TENANTS.includes(spec.tenantId)) throw new Error(`拒绝:${spec.tenantId} 是真店,演示数据不许写进去。`)
  const list = (await platform('/platform/tenants')).tenants || []
  const hit = list.find((t) => t.id === spec.tenantId)
  if (hit) { log(`  租户已有:${spec.tenantId}(${hit.name})`); return }
  const created = await platform('/platform/tenants', {
    method: 'POST',
    body: JSON.stringify({ id: spec.tenantId, name: spec.label, plan: 'chain', initialTerm: 'year', currency: spec.currency, timezone: spec.timezone })
  })
  log(`  ✅ 新建演示租户:${spec.tenantId}(${spec.label});老板账号 ${created.owner.username}(初始密码只显示这一次,演示店无需交付)`)
}

async function ensureCatalog(spec) {
  const services = (await api(spec.tenantId, '/admin/services')).services || []
  const mains = services.filter((s) => (s.itemKind || 'main') === 'main' && !s.isTimecard)
  if (mains.length < 2) {
    for (const s of [
      { nameZh: '演示·经典单色', nameEn: 'Demo Classic', type: 'NAIL', priceCents: 16800, baseDurationMin: 90 },
      { nameZh: '演示·美睫自然款', nameEn: 'Demo Lash', type: 'LASH', priceCents: 19800, baseDurationMin: 120 }
    ]) {
      const exists = mains.find((m) => m.nameZh === s.nameZh)
      if (exists) continue
      await api(spec.tenantId, '/admin/services', { method: 'POST', body: JSON.stringify({ ...s, storefront: true, isActive: true }) })
      log(`  ✅ 建服务:${s.nameZh}`)
    }
  } else log(`  服务已有 ${mains.length} 项,跳过`)

  const techs = (await api(spec.tenantId, '/admin/technicians')).technicians || []
  if (techs.length < 2) {
    for (const name of ['演示技师 A', '演示技师 B']) {
      if (techs.some((t) => t.name === name)) continue
      await api(spec.tenantId, '/admin/technicians', { method: 'POST', body: JSON.stringify({ name, isActive: true }) })
      log(`  ✅ 建技师:${name}`)
    }
  } else log(`  技师已有 ${techs.length} 位,跳过`)

  const packages = (await api(spec.tenantId, '/admin/packages')).packages || []
  if (!packages.some((p) => p.kind === 'recharge')) {
    await api(spec.tenantId, '/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'recharge', name: '演示充值套餐', priceCents: 30000, bonusCents: 6000, mallVisible: true }) })
    log('  ✅ 建充值套餐')
  }
  if (!packages.some((p) => p.kind === 'times')) {
    await api(spec.tenantId, '/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'times', name: '演示次卡(5 次)', priceCents: 60000, timesCount: 5, mallVisible: true }) })
    log('  ✅ 建次卡套餐')
  }
  const coupons = (await api(spec.tenantId, '/admin/coupons')).coupons || []
  if (!coupons.length) {
    await api(spec.tenantId, '/admin/coupons', { method: 'POST', body: JSON.stringify({ name: '演示满减券', discountType: 'amount', amountCents: 3000, minSpendCents: 20000, validDays: 60, totalQty: 100 }) })
    log('  ✅ 建券模板')
  }
}

/* 一位演示顾客:开单签署(积分/累计消费/到店次数)+ 储值 + 次卡 + 券,会员卡上每一格都有数。
   **逐项幂等**:哪一项缺就补哪一项(顾客已存在但资产没铺完时,重跑能补齐)。 */
async function seedMember(spec, { name, openId, balance, timecardTimes, coupons, orders, slotHour = 10, timecardRemaining = 0 }) {
  const services = ((await api(spec.tenantId, '/admin/services')).services || []).filter((s) => (s.itemKind || 'main') === 'main' && !s.isTimecard)
  const techs = (await api(spec.tenantId, '/admin/technicians')).technicians || []
  const svc = services[0]
  const tech = techs[0]
  let userId = (((await api(spec.tenantId, '/admin/customers')).customers || []).find((c) => c.displayName === name) || {}).id || null

  // 撞档就换时段重试(演示铺设不该因为一个时间点被占就整批失败)
  const bookOnce = async (dayOffset, hour) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const h = String((hour + attempt) % 24).padStart(2, '0')
      const body = userId
        ? { userId, serviceId: svc.id, technicianId: tech.id, date: dateStr(dayOffset), time: `${h}:00` }
        : { newCustomerName: name, serviceId: svc.id, technicianId: tech.id, date: dateStr(dayOffset), time: `${h}:00` }
      try {
        const bk = (await api(spec.tenantId, '/admin/bookings/direct', { method: 'POST', body: JSON.stringify(body) })).booking
        userId = userId || bk.userId || bk.user_id || (bk.user && bk.user.id)
        return bk
      } catch (e) {
        if (!/SLOT_UNAVAILABLE|BUSY|CLOSED|OUTSIDE/i.test(e.message)) throw e
      }
    }
    throw new Error(`${name}:连续 10 个时段都排不进(${dateStr(dayOffset)})`)
  }
  const settleAndSign = async (bookingId, extra = {}) => {
    await api(spec.tenantId, `/admin/bookings/${bookingId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) })
    const sh = (await api(spec.tenantId, '/admin/settlements', {
      method: 'POST',
      body: JSON.stringify({ userId, settlements: [{ bookingId, payIntent: 'offline_full', items: [{ serviceId: svc.id, qty: 1 }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }], ...extra }] })
    })).settlements[0]
    await fetch(`${BASE}/settlements/${encodeURIComponent(sh.code)}/sign`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': spec.tenantId },
      body: JSON.stringify({ signature: '演示签名', disclaimerAccepted: true })
    })
  }

  // ① 历史已签署单(=积分/累计消费/到店次数/成长值的来源)
  let signed = 0
  if (userId && DB_PATH) {
    const db = new DatabaseSync(DB_PATH)
    try {
      signed = db.prepare("SELECT COUNT(*) n FROM settlements WHERE user_id = ? AND tenant_id = ? AND status = 'signed'").get(userId, spec.tenantId).n
    } finally { db.close() }
  }
  for (let i = signed; i < orders; i += 1) {
    const bk = await bookOnce(-3 - i, slotHour + i)
    await settleAndSign(bk.id)
    log(`  ✅ ${name}:补第 ${i + 1} 张已签署单`)
  }

  // ② 绑微信身份(跨店同一 openid:每家店各一行 users —— 这正是要验的隔离面)。
  //    直连库贴 openid:真实路径是顾客扫签署码授权(claimUserByOpenId),演示铺设没有真人扫码;
  //    只写 users.wechat_open_id 这一个字段,金额/账本一分不碰。D25 闸(未绑不可充值)也靠它。
  if (openId && DB_PATH && userId) {
    const db = new DatabaseSync(DB_PATH)
    try { db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ? AND tenant_id = ?').run(openId, userId, spec.tenantId) } finally { db.close() }
  }

  // ③ 储值(缺才充)
  const customerRow = async () => ((await api(spec.tenantId, '/admin/customers')).customers || []).find((c) => c.id === userId) || {}
  if (balance && userId) {
    const cur = await customerRow()
    if (!cur.storedValueBalanceCents) {
      await api(spec.tenantId, '/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId, amountCents: balance, payChannel: 'cash', note: '演示储值' }) })
      log(`  ✅ ${name}:充演示储值 ${balance / 100}`)
    }
  }

  // ④ 次卡(缺才买:随一张单一起购,与真实开单同路径)
  if (timecardTimes && userId) {
    let cards = []
    if (DB_PATH) {
      const db = new DatabaseSync(DB_PATH)
      try { cards = db.prepare('SELECT id FROM member_timecards WHERE user_id = ? AND tenant_id = ?').all(userId, spec.tenantId) } finally { db.close() }
    }
    if (!cards.length) {
      const pkg = ((await api(spec.tenantId, '/admin/packages')).packages || []).find((p) => p.kind === 'times')
      if (pkg) {
        const bk = await bookOnce(-1, slotHour + orders + 1)
        await settleAndSign(bk.id, { purchasePackageId: pkg.id, timecardServiceId: svc.id })
        log(`  ✅ ${name}:买次卡(${pkg.name})`)
      }
    }
  }

  /* ④b 核销次卡(走正规开单用卡路径):让两家演示店的「次卡剩余」不同,
     店主一眼就能看出切店后换了一套数,而不是两边碰巧一样。 */
  if (timecardRemaining && userId && DB_PATH) {
    const readCard = () => {
      const db = new DatabaseSync(DB_PATH)
      try { return db.prepare('SELECT id, total_times, used_times FROM member_timecards WHERE user_id = ? AND tenant_id = ? ORDER BY rowid ASC LIMIT 1').get(userId, spec.tenantId) } finally { db.close() }
    }
    let card = readCard()
    let guard = 0
    while (card && (card.total_times - card.used_times) > timecardRemaining && guard < 6) {
      const bk = await bookOnce(-1, slotHour + orders + 4 + guard)
      await settleAndSign(bk.id, { timecardId: card.id, timecardServiceId: svc.id })
      log(`  ✅ ${name}:核销次卡 1 次(演示两店剩余不同:目标剩 ${timecardRemaining} 次)`)
      card = readCard()
      guard += 1
    }
  }

  // ⑤ 券(缺几张发几张)
  if (coupons && userId) {
    let have = 0
    if (DB_PATH) {
      const db = new DatabaseSync(DB_PATH)
      try { have = db.prepare("SELECT COUNT(*) n FROM coupon_grants WHERE user_id = ? AND tenant_id = ? AND status = 'active'").get(userId, spec.tenantId).n } finally { db.close() }
    }
    const cpn = ((await api(spec.tenantId, '/admin/coupons')).coupons || [])[0]
    for (let i = have; i < coupons && cpn; i += 1) {
      await api(spec.tenantId, `/admin/coupons/${cpn.id}/grant`, { method: 'POST', body: JSON.stringify({ userId }) })
      log(`  ✅ ${name}:发第 ${i + 1} 张券`)
    }
  }
  log(`  → ${name} 就绪(${userId})`)
  return userId
}

async function main() {
  log(`演示孪生店铺设 · ${BASE}`)
  for (const spec of DEMO_TENANTS) {
    log(`\n===== ${spec.label}(${spec.tenantId}) =====`)
    await ensureTenant(spec)
    await ensureCatalog(spec)
    await seedMember(spec, { name: spec.twin.name, openId: CROSS_OPENID, ...spec.twin, slotHour: 9 })
    // 本店常客:各店**各自的** openid(与跨店身份区分开),这样也能演示充值(D25 闸要求已绑定)
    await seedMember(spec, { name: '演示·本店常客', openId: `demo-openid-${spec.tenantId}-regular`, balance: 12000, timecardTimes: 0, coupons: 1, orders: 1, slotHour: 15 })
  }
  log('\n===== 跨店对照(同一个微信身份 · 两店各一套数)=====')
  for (const spec of DEMO_TENANTS) {
    const c = ((await api(spec.tenantId, '/admin/customers')).customers || []).find((x) => x.displayName === spec.twin.name)
    if (!c) { log(`  ${spec.label}:没找到跨店档案`); continue }
    let cards = 0
    let cpns = 0
    if (DB_PATH) {
      const db = new DatabaseSync(DB_PATH)
      try {
        cards = db.prepare('SELECT COALESCE(SUM(total_times - used_times),0) n FROM member_timecards WHERE user_id = ? AND tenant_id = ?').get(c.id, spec.tenantId).n
        cpns = db.prepare("SELECT COUNT(*) n FROM coupon_grants WHERE user_id = ? AND tenant_id = ? AND status = 'active'").get(c.id, spec.tenantId).n
      } finally { db.close() }
    }
    log(`  ${spec.label}:储值 ${(c.storedValueBalanceCents || 0) / 100} · 累计消费 ${(c.totalSpentCents || 0) / 100} · 到店 ${c.visitCount} 次 · 次卡剩 ${cards} 次 · 券 ${cpns} 张 · users.id=${c.id}`)
  }
}
main().catch((e) => { console.error('铺设失败:', e.message); process.exit(1) })
