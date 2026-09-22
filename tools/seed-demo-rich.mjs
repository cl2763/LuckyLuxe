/* 🔴 此脚本永不对生产跑(J-114,店主 2026-09-22 立) —— 它会凭空造出人或钱。 */
/* D169 · 把 4310 沙箱三家店灌成「一家真在营业的店」(店主 05t 段 2)
 *
 * ══ 为什么要有这把 ══
 * 店主原话:「每个 mock 店都应该多灌一些数据,我才能看到全功能的效果」。
 * 05t 现查:`jics-store` 1 单 / 0 日结,`luvia-bj` 50 单 / 0 完成 / 0 账本 ——
 * 三家店打开首页,大数一律 0,四小牌全 0。**这不是页面画错了,是库里没东西。**
 *
 * ══ 范围红线(店主定,不许商量)══
 * 只写 **4310 沙箱库**(`apps/api/sandbox-data/lucky-luxe.sqlite`);
 * **4128 本机库一行不动** —— 所以这把刀自己拒绝在非 `sandbox-data/` 的库上跑(J-33 同族)。
 *
 * ══ 三条写法纪律 ══
 * ① **INSERT-only**:不 UPDATE 任何既有行。要「已完成 + 已签单 + 作品已上架」的单,
 *    就**建的时候就是那个样子**,不许先建后改。(账本与储值本来也有 no-update 触发器守着。)
 * ② **幂等按「做过没有」**,不按「还剩多少」(店主《幂等判据律》):
 *    历史一次性标记 `rich-v1:hist`,今天那一片标记 `rich-v1:day:<门店当天>` ——
 *    同一天重跑一分不动,隔天重跑只补当天。
 *    ⚠️ 不许拿「今天有几单」当幂等键:正常经营会把它改大改小,那样必然重复灌。
 * ③ **账本走唯一写入口** `createFinanceLedger().insertFinanceTransaction`(公约④ 先搜复用):
 *    哈希链得咬合,自己拼 INSERT 就把链写断了,而链断了**验签当场就红**。
 *
 * ══ 假数回落红线第 6 条 ══
 * 「演示铺单造的『已完成』必须连带开单 + 签署」—— 所以每一张完成单都配一张 `signed` 结算单
 * 和一行账本收入。只有这样顾客端的订单卡、累计消费、到店次数才说同一句话。
 *
 * 用法:
 *   SEED_DB=/…/apps/api/sandbox-data/lucky-luxe.sqlite node tools/seed-demo-rich.mjs
 *   (加 --dry 只报计划不写库)
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { requireTarget, requireSandbox, reportTarget, countRows } from './db-target.mjs'
import { backupDb } from './db-backup.mjs'
import { createFinanceLedger } from '../apps/api/finance-ledger.mjs'

const SEED = 'rich-v1'
const DRY = process.argv.includes('--dry')

const DB_PATH = requireTarget({
  envName: 'SEED_DB=<沙箱库绝对路径>',
  value: process.env.SEED_DB,
  hint: '(只许沙箱:…/apps/api/sandbox-data/lucky-luxe.sqlite)',
})
/* 🔴 自己拒绝跑在别的库上 —— **闸在 `db-target.mjs` 里**(唯一出口)。
   为什么不在这儿写那句路径判断:护栏扫描器会把它读成「硬编码目标」并当场红,
   而它其实是**拦截用的字面量**,不是要写的库(现测栽过一次:`test-db-target-guard ①d` 点名两行)。
   字面量只留一处,这里一句路径都不写。 */
requireSandbox(DB_PATH, 'seed-demo-rich')
if (!existsSync(DB_PATH)) { console.error(`\n❌ 库文件不存在:${DB_PATH}\n`); process.exit(2) }

/* ── 三家店的「像真店」参数 ─────────────────────────────────────────
   金额量级各随各店(店主 05t 段 2 第 6 条):加拿大店 CAD 80–260,北京店 ¥300–800。
   币种/时区**从库里现读**,这里只写「客单价区间」这一件库里问不出来的事。 */
const SHOPS = {
  'lucky-luxe': { low: 8000, high: 26000, names: ['Amy Wong', 'Grace Li', 'Chloe Tan', 'Sophia Ng', 'Ivy Chan', 'Karen Ho', 'Bella Xu', 'Nina Guo', 'Elaine Su', 'Fiona Ye'] },
  'jics-store': { low: 30000, high: 80000, names: ['林晓琳', '周雨萱', '陈佳怡', '黄可欣', '吴静怡', '许乐乐', '孙嘉宁', '曹一诺', '邓思远', '冯小满'] },
  'luvia-bj': { low: 30000, high: 80000, names: ['苏念', '白露', '沈清和', '顾一涵', '温窈', '柏舟', '陆星野', '祁夏', '文迟', '宋知意'] },
}

/* 可重跑要「同一天同一份」,所以随机数用**定死种子**的伪随机,不用 Math.random() */
let _s = 20260908
const rnd = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) % 100000) / 100000 }
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length]
const between = (lo, hi) => lo + Math.round(rnd() * (hi - lo) / 100) * 100
const rid = (p) => `${p}_${SEED}_${randomBytes(5).toString('hex')}`

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA foreign_keys = OFF')

/* ── 门店时区里的「今天」:CLAUDE.md 头一条,不许用裸 new Date() 推日期 ── */
const ymdIn = (tz, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const hourIn = (tz, d = new Date()) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', hour12: false }).format(d))
const shiftDay = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/* 预约时间怎么摆:全仓的日期比较用的是 `substr(appointment_start,1,10)`,也就是**UTC 日期前缀**。
   所以这里挑的 UTC 小时必须让「UTC 日期 == 门店当天」——
   多伦多(UTC−4)本地 9–18 点 → UTC 13–22 点,同一天;北京(UTC+8)本地 10–20 点 → UTC 02–12 点,同一天。
   这一段是**口径**,不是随手写的常量:摆错一个小时,单子就掉到隔壁那天去了。 */
const UTC_HOURS = { 'America/Toronto': [13, 15, 17, 19, 21], 'Asia/Shanghai': [2, 4, 6, 8, 10] }
const at = (day, h, m = 0) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`

/* 小图:`data:` 开头才算「商家上传过」(《占位零回落律》的地基定义),
   所以作品与小记的图用内联 SVG data URI —— 不许用 /assets/…,那等于没传过。 */
const shot = (label, hue) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="hsl(${hue},38%,86%)"/>`
  + `<circle cx="120" cy="104" r="46" fill="hsl(${hue},46%,72%)"/>`
  + `<text x="120" y="196" font-size="18" text-anchor="middle" fill="hsl(${hue},30%,32%)">${label}</text></svg>`)

let TID = 'lucky-luxe'
const ledger = createFinanceLedger({
  db, createHash, randomId: rid, iso: (d) => new Date(d).toISOString(),
  currentTenantId: () => TID,
  localParts: (d) => ({ date: new Date(d).toISOString().slice(0, 10) }),
  storeIdOfTenant: (tid) => db.prepare('SELECT id FROM stores WHERE tenant_id = ? LIMIT 1').get(tid)?.id || null,
  DEFAULT_TENANT_ID: 'lucky-luxe',
})

const one = (sql, ...a) => db.prepare(sql).get(...a)
const all = (sql, ...a) => db.prepare(sql).all(...a)
const run = (sql, ...a) => db.prepare(sql).run(...a)

/* ── 幂等:标记存在 tenant_settings,记的是**「做过没有」** ── */
const markKey = (what) => `seed_${SEED}_${what}`
const done = (tid, what) => Boolean(one('SELECT 1 AS n FROM tenant_settings WHERE tenant_id = ? AND key = ?', tid, markKey(what)))
const mark = (tid, what, info) => run(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
tid, markKey(what), JSON.stringify(info), new Date().toISOString())

/* ── 顾客:补到 30 位 ───────────────────────────────────────── */
function ensureCustomers(tid, want = 30) {
  const have = one('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?', tid).n
  const names = SHOPS[tid].names
  let made = 0
  for (let i = have; i < want; i += 1) {
    const nm = `${names[i % names.length]}${i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''}`
    run(`INSERT INTO users (id, display_name, phone, tenant_id, tags_json, notes, is_migrated, legacy_total_spend_cents)
      VALUES (?, ?, ?, ?, '[]', ?, 0, 0)`,
    rid('u'), nm, `1${String(3000000000 + Math.floor(rnd() * 899999999))}`, tid, `[${SEED}] 演示顾客`)
    made += 1
  }
  return made
}

const custIds = (tid) => all('SELECT id FROM users WHERE tenant_id = ? ORDER BY rowid', tid).map((r) => r.id)
const techIds = (tid) => all('SELECT id FROM technicians WHERE tenant_id = ? AND name NOT LIKE ? ORDER BY rowid', tid, '测试技师%').map((r) => r.id)
const mainServices = (tid) => all(`SELECT id, name_zh, price_cents, base_duration_min, type FROM services
  WHERE tenant_id = ? AND is_active = 1 AND (item_kind IS NULL OR item_kind = 'main') AND price_mode = 'fixed'`, tid)
const storeOf = (tid) => one('SELECT id, timezone, currency FROM stores WHERE tenant_id = ? LIMIT 1', tid)

/* ── 一张完整的单:预约 + 结算单(已签)+ 账本一行 ─────────────────
   这三件必须一起落 —— 只落预约就是《假数回落红线》第 6 条禁的那种「凭空的已完成」。 */
function fullOrder({ tid, store, day, hour, svc, cust, tech, status, gallery = false, payChannel = 'offline', arrived = false }) {
  const price = Math.max(SHOPS[tid].low, Math.min(SHOPS[tid].high, svc.price_cents || between(SHOPS[tid].low, SHOPS[tid].high)))
  const dur = svc.base_duration_min || 90
  const start = at(day, hour)
  const end = at(day, hour + Math.ceil(dur / 60))
  const bid = rid('booking')
  const completed = status === 'COMPLETED'
  const imgs = gallery ? JSON.stringify([shot(svc.name_zh, (hour * 37) % 360)]) : '[]'
  run(`INSERT INTO bookings (id, public_code, user_id, store_id, technician_id, service_id, status,
      appointment_start, appointment_end, addons_json, reference_images_json, work_images_json,
      approved_work_images_json, gallery_status, gallery_locked_at, source_channel, notes,
      service_price_cents, deposit_cents, deposit_required_cents, final_due_cents, total_duration_min,
      created_at, updated_at, arrived_at, tenant_id, demo_seed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, 'demo-seed', ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
  bid, `RH${randomBytes(4).toString('hex').toUpperCase()}`, cust, store.id, tech, svc.id, status,
  start, end, imgs, imgs, gallery ? 'approved' : 'draft', gallery ? start : null,
  `[${SEED}] 演示单`, price, price, dur, start, start,
  (status === 'COMPLETED' || arrived) ? start : null, tid, SEED)

  if (!completed) return { bid, price }

  /* 已完成 → 必须有一张**已签**的结算单(红线 6) */
  const sid = rid('stl')
  run(`INSERT INTO settlements (id, tenant_id, group_id, booking_id, user_id, code, status,
      list_total_cents, subtotal_cents, total_cents, pay_intent, signature_data, signed_at,
      disclaimer_accepted, perf_alloc_status, created_by, created_at, updated_at, demo_seed)
    VALUES (?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?, 'balance_plus_offline', ?, ?, 1, 'pending', 'seed', ?, ?, ?)`,
  sid, tid, rid('sgrp'), bid, cust, `RH-${day.replace(/-/g, '')}-${randomBytes(2).toString('hex').toUpperCase()}`,
  price, price, price, '演示顾客', start, start, start, SEED)
  run(`INSERT INTO settlement_items (id, tenant_id, settlement_id, item_no, kind, service_id, name_snapshot,
      qty, list_unit_cents, unit_price_cents, list_amount_cents, amount_cents)
    VALUES (?, ?, ?, 1, 'main', ?, ?, 1, ?, ?, ?, ?)`,
  rid('sitem'), tid, sid, svc.id, svc.name_zh, price, price, price, price)
  run(`INSERT INTO settlement_technicians (id, tenant_id, settlement_id, technician_id, role, item_nos_json)
    VALUES (?, ?, ?, ?, 'main', '[1]')`, rid('stech'), tid, sid, tech)

  /* 账本一行 —— 走唯一写入口,哈希链才咬得上 */
  const category = payChannel === 'stored_value' ? '服务收入-耗卡'
    : (payChannel === 'times_card' ? '服务收入-次卡核销' : '服务收入-到店')
  ledger.insertFinanceTransaction({
    type: 'income', source: 'settlement', category, amountCents: payChannel === 'times_card' ? 0 : price,
    payChannel, occurredOn: day, note: `[${SEED}] ${svc.name_zh}`, bookingId: bid,
    createdBy: 'seed', storeId: store.id, tenantId: tid,
  })
  return { bid, price, sid }
}

/* ── 历史:近 12 个月 + 本周,每天几单 + 已确认日结 ───────────────── */
function seedHistory(tid, store, today) {
  const svcs = mainServices(tid); const techs = techIds(tid); const cs = custIds(tid)
  const hours = UTC_HOURS[store.timezone] || UTC_HOURS['America/Toronto']
  let bookings = 0; let closes = 0; let works = 0
  const dayList = []
  /* 12 个月各挑 4 天(折线 12 个点都得有值);本周再逐天补,月/周两个维度都不空 */
  for (let m = 11; m >= 0; m -= 1) {
    const base = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
    base.setUTCMonth(base.getUTCMonth() - m)
    const ym = base.toISOString().slice(0, 7)
    for (const d of [4, 11, 18, 25]) {
      const day = `${ym}-${String(d).padStart(2, '0')}`
      if (day < today) dayList.push(day)
    }
  }
  for (let i = 7; i >= 1; i -= 1) { const d = shiftDay(today, -i); if (!dayList.includes(d)) dayList.push(d) }

  const yday = shiftDay(today, -1)
  for (const day of dayList) {
    /* 🔴 这一天已经日结过了就整天跳过 —— 不是「先建单再补日结」。
       往一个已确认的日子里补单,会让日结快照(order_count / revenue_cents)和当天真单对不上,
       而首页那天的营收读的正是快照:数字对不上账,比数字小更糟。 */
    if (one('SELECT 1 AS n FROM daily_closes WHERE tenant_id = ? AND date = ?', tid, day)) continue
    const n = 2 + Math.floor(rnd() * 3)
    let revenue = 0
    for (let k = 0; k < n; k += 1) {
      /* 作品:每个月留几张上架的(建出来就是 approved,不走 UPDATE) */
      const gallery = works < 12 && k === 0 && day.endsWith('11')
      const r = fullOrder({ tid, store, day, hour: hours[k % hours.length], svc: pick(svcs),
        cust: pick(cs), tech: pick(techs), status: 'COMPLETED', gallery })
      revenue += r.price; bookings += 1; if (gallery) works += 1
    }
    /* 已确认日结 —— **昨天那天故意不确认**,首页「待日结」才有得看(店主要的五项待办之一) */
    if (day !== yday) {
      run(`INSERT INTO daily_closes (id, tenant_id, date, status, order_count, revenue_cents,
          confirmed_by, confirmed_at, created_at, updated_at)
        VALUES (?, ?, ?, 'confirmed', ?, ?, 'seed', ?, ?, ?)`,
      rid('dclose'), tid, day, n, revenue, at(day, 23), at(day, 23), at(day, 23))
      closes += 1
    }
  }
  return { bookings, closes, works }
}

/* ── 卡:储值充值 / 次卡购买 / 耗卡 —— 六个指标里的「总卡耗」「新增持卡」靠它 ── */
function seedCards(tid, store, today) {
  const cs = custIds(tid); const svcs = mainServices(tid); const techs = techIds(tid)
  const hours = UTC_HOURS[store.timezone] || UTC_HOURS['America/Toronto']
  const big = SHOPS[tid].high * 10
  let n = 0
  /* 往月里散几笔:充值(现金业绩)+ 次卡购买(现金业绩 + 新增持卡) */
  for (let m = 5; m >= 0; m -= 1) {
    const base = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
    base.setUTCMonth(base.getUTCMonth() - m)
    const day = `${base.toISOString().slice(0, 7)}-12`
    if (day >= today) continue
    const u = cs[(m * 3) % cs.length]
    run(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bucket)
      VALUES (?, ?, ?, 'recharge', ?, 'wechat', ?, 'seed', ?, 'normal')`,
    rid('sv'), tid, u, big, `[${SEED}] 演示充值`, at(day, 12))
    run(`INSERT INTO member_timecards (id, tenant_id, user_id, name, total_times, used_times, price_cents, created_at, card_source)
      VALUES (?, ?, ?, ?, 10, ?, ?, ?, 'seed')`,
    rid('tc'), tid, cs[(m * 5 + 1) % cs.length], '十次卡 · 演示', 2 + (m % 4), SHOPS[tid].high * 8, at(day, 12))
    n += 2
  }
  return n
}

/* ── 今天那一笔卡:**跟着「当天」走,不跟着「历史」走** ────────────────
   🔴 现测(09-09 跨天后):`seedCards` 整个挂在一次性的历史闸里,于是第二天
   「总卡耗 / 新增持卡」双双掉回 0 —— 判据「今日六指标非 0 ≥5」当场红。
   卡这件事有两半:**往月里散的那些是历史**(一次就够),**今天这一笔是当天的**(天天要有)。
   两半挂在两个闸上,这才是「跨天重跑只补当天」的正确切法。 */
function seedCardsToday(tid, store, today) {
  const cs = custIds(tid); const svcs = mainServices(tid); const techs = techIds(tid)
  const hours = UTC_HOURS[store.timezone] || UTC_HOURS['America/Toronto']
  const big = SHOPS[tid].high * 10
  const uToday = cs[cs.length - 1]
  run(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bucket)
    VALUES (?, ?, ?, 'recharge', ?, 'wechat', ?, 'seed', ?, 'normal')`,
  rid('sv'), tid, uToday, big, `[${SEED}] 今日充值`, at(today, hours[0]))
  run(`INSERT INTO member_timecards (id, tenant_id, user_id, name, total_times, used_times, price_cents, created_at, card_source)
    VALUES (?, ?, ?, ?, 10, 1, ?, ?, 'seed')`,
  rid('tc'), tid, cs[cs.length - 2], '十次卡 · 演示', SHOPS[tid].high * 8, at(today, hours[0]))
  /* 耗卡(储值支付的一单)与次卡核销(次数不折钱)各一单 —— 两个数都要出得来 */
  fullOrder({ tid, store, day: today, hour: hours[0], svc: pick(svcs), cust: uToday, tech: pick(techs),
    status: 'COMPLETED', payChannel: 'stored_value' })
  fullOrder({ tid, store, day: today, hour: hours[0], svc: pick(svcs), cust: cs[cs.length - 2], tech: pick(techs),
    status: 'COMPLETED', payChannel: 'times_card' })
  return 4
}

/* ── 排班:今天 + 往后 7 天全天班 ──────────────────────────────
   🔴 为什么要有这一段(D173 重放时咬出来的):`getAvailability` 要有**在岗的技师**才给得出时段。
   夹具里一行排班都没有 → 顾客问「下周一」时,店休那条路想给「最近两个有位的日子」,
   往后找 7 天**一天都找不到**,只能退回「换一天好吗」——
   看起来像功能没做,其实是**景没造**(店主《造景律》:谁出走查单谁先把景造好)。
   INSERT-only + 主键 (technician_id, date) 去重,重跑一分不动。 */
function seedSchedule(tid, today) {
  const techs = techIds(tid)
  let n = 0
  for (let i = 0; i <= 7; i += 1) {
    const day = shiftDay(today, i)
    for (const t of techs) {
      const has = one('SELECT 1 AS n FROM technician_schedules WHERE technician_id = ? AND date = ?', t, day)
      if (has) continue
      run(`INSERT INTO technician_schedules (technician_id, date, start_time, end_time, is_working, tenant_id)
        VALUES (?, ?, '10:00', '19:00', 1, ?)`, t, day, tid)
      n += 1
    }
  }
  return n
}

/* ── 今天:三态齐全 + 一个「下一位」 ───────────────────────────── */
function seedToday(tid, store, today) {
  const svcs = mainServices(tid); const techs = techIds(tid); const cs = custIds(tid)
  const tz = store.timezone
  const hours = UTC_HOURS[tz] || UTC_HOURS['America/Toronto']
  const nowH = hourIn(tz, new Date())
  /* 「下一位」摆在 1–2 小时后;若那会儿门店还没开(北京店在跑种子时是当地凌晨),
     就摆在当天最早的营业时段 —— **不许摆一个门店关着的时间点**,那种数据自己就说不通。 */
  const localOf = (utcH) => (tz === 'Asia/Shanghai' ? (utcH + 8) % 24 : (utcH + 24 - 4) % 24)
  const future = hours.filter((h) => localOf(h) > nowH + 0.5)
  const waitHours = (future.length >= 2 ? future : hours).slice(0, 2)
  const doneHours = hours.filter((h) => !waitHours.includes(h)).slice(0, 3)

  let made = 0
  for (const h of doneHours) {                       // 已完成 ≥3(每张都带签署单 + 账本)
    fullOrder({ tid, store, day: today, hour: h, svc: pick(svcs), cust: pick(cs), tech: pick(techs), status: 'COMPLETED' })
    made += 1
  }
  /* 🔴「在做」= **CONFIRMED + 已到店**,不是一个叫 ARRIVED 的状态。
     现查:全库 bookings.status 只有 CANCELLED / COMPLETED / CONFIRMED 三种,
     台面的状态白名单里也没有 ARRIVED —— 造一个库里不存在的状态值,
     大屏能数出来、台面上却看不见,那就是**只有演示数据才有的病**。 */
  fullOrder({ tid, store, day: today, hour: doneHours[doneHours.length - 1], svc: pick(svcs),
    cust: pick(cs), tech: pick(techs), status: 'CONFIRMED', arrived: true })          // 在做 1
  made += 1
  for (const h of waitHours) {                       // 待到店 2(第一条就是「下一位」)
    fullOrder({ tid, store, day: today, hour: h, svc: pick(svcs), cust: pick(cs), tech: pick(techs), status: 'CONFIRMED' })
    made += 1
  }
  return made
}

/* ── 服务小记 / 待办 ──────────────────────────────────────────── */
function seedNotesAndTodos(tid, today) {
  const cs = custIds(tid); const techs = techIds(tid)
  /* 小记挂在**过去**的完成单上;今天的完成单故意不写 —— 「待写小记」那一项要有数 */
  const past = all(`SELECT b.id, b.user_id, b.technician_id, s.name_zh FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.tenant_id = ? AND b.status = 'COMPLETED' AND substr(b.appointment_start,1,10) < ?
      AND b.id NOT IN (SELECT booking_id FROM service_notes WHERE booking_id IS NOT NULL)
    ORDER BY b.appointment_start DESC LIMIT 12`, tid, today)
  let notes = 0
  past.forEach((b, i) => {
    const withImg = i % 2 === 0          // 一半带图、一半不带 —— 占位三态里的「有图 / 没配图」都看得见
    run(`INSERT INTO service_notes (id, tenant_id, user_id, booking_id, technician_id, technician_name,
        service_name, raw_text, structured_json, images_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 'seed', ?)`,
    rid('note'), tid, b.user_id, b.id, b.technician_id,
    one('SELECT name AS n FROM technicians WHERE id = ? AND tenant_id = ?', b.technician_id, tid)?.n || '',
    b.name_zh || '', `[${SEED}] 顾客甲面偏薄,下次先做加固;喜欢暖调裸色。`,
    withImg ? JSON.stringify([shot('小记', (i * 53) % 360)]) : '[]', new Date().toISOString())
    notes += 1
  })
  /* 待人工 ≥2:客服台那一项 */
  let convs = 0
  const needHuman = one("SELECT COUNT(*) AS n FROM wechat_conversations WHERE tenant_id = ? AND status = 'needs_human'", tid).n
  /* 🔴 外部用户 id 要**接着往下编**,不能从 0 数起:
     收尾刀(J-33)把上一轮那两通关掉之后,`needs_human` 掉回 0,而 `rich-v1-guest-0/1` 这两行**还在**
     (只是 status 变了)—— 从 0 数起就撞 UNIQUE,整个事务回滚,首页那两项永远补不上。
     现测栽过一次:lucky-luxe 报 `UNIQUE constraint failed: wechat_conversations…`。
     **也不去把已关的那通重新打开** —— 那是改历史;补一通新的才是真事(店里确实又来人了)。 */
  /* 用「已有几条」当序号也不行:序号不是密的(现测库里只剩 `-guest-1`,数出来是 1,又撞上了)。
     直接给一段随机后缀 —— 这个 id 只是「哪一位访客」,不需要连号。 */
  for (let i = needHuman; i < 2; i += 1) {
    run(`INSERT INTO wechat_conversations (id, provider, external_user_id, source_channel, status,
        last_intent, last_message, tenant_id, created_at, updated_at)
      VALUES (?, 'mock', ?, 'wechat', 'needs_human', 'other', ?, ?, ?, ?)`,
    rid('conv'), `${SEED}-guest-${randomBytes(3).toString('hex')}`, `[${SEED}] 想问问能不能改期,顺便问下会员折扣`, tid,
    new Date().toISOString(), new Date().toISOString())
    convs += 1
  }
  /* 待报价 ≥1:状态用库里真值 `PENDING_STAFF`(不是 'pending' —— D170 就是栽在这上面) */
  let quotes = 0
  const pending = one("SELECT COUNT(*) AS n FROM quote_requests WHERE tenant_id = ? AND status = 'PENDING_STAFF'", tid).n
  for (let i = pending; i < 2; i += 1) {
    run(`INSERT INTO quote_requests (id, user_id, source_channel, service_type, status, customer_message,
        customer_lang, tenant_id, created_at, updated_at)
      VALUES (?, ?, 'wechat', 'nail', 'PENDING_STAFF', ?, 'zh', ?, ?, ?)`,
    rid('qr'), pick(cs), `[${SEED}] 想做这种手绘,大概多少钱?`, tid, new Date().toISOString(), new Date().toISOString())
    quotes += 1
  }
  return { notes, convs, quotes }
}

/* ── AI 今日一句:落 `tenant_settings.ai_daily_line`,与 `dashboard-pulse.rememberAiLine`
     写的是**同一个形状**(那边是唯一定义处;这里只是把今天这条先铺上)。 ── */
function seedAiLine(tid, today, tz) {
  const bk = one("SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND substr(appointment_start,1,10) = ? AND status NOT IN ('CANCELLED','NO_SHOW')", tid, today).n
  const note = one("SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND status = 'COMPLETED' AND substr(appointment_start,1,10) = ? AND id NOT IN (SELECT booking_id FROM service_notes WHERE booking_id IS NOT NULL)", tid, today).n
  const text = `今日 ${bk} 个预约,${note} 单做完还没写小记;昨天的日结还没确认,记得顺手点一下。`
  /* `atText` = **门店当地的时刻**(页面上显示的是「· 10:05」,不是一串 ISO)。
     形状与 `dashboard-pulse.rememberAiLine` 写的那一份保持一致 —— 那边是唯一定义处。 */
  const atText = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  run(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'ai_daily_line', ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  tid, JSON.stringify({ date: today, text, at: new Date().toISOString(), atText }), new Date().toISOString())
  return text
}

/* ══════════ 主流程 ══════════ */
const before = countRows(DB_PATH)
reportTarget('seed-demo-rich 开跑前', DB_PATH)
if (!DRY) {
  const out = DB_PATH.replace(/\.sqlite$/, `.before-${SEED}-${Date.now()}.sqlite`)
  backupDb(DB_PATH, out)
  console.log(`  已备份:${out}`)
}

const report = []
for (const tid of Object.keys(SHOPS)) {
  TID = tid
  const store = storeOf(tid)
  if (!store) { report.push({ tid, skip: '这家店没有 stores 行' }); continue }
  const today = ymdIn(store.timezone)
  const r = { tid, today, tz: store.timezone, currency: store.currency }

  if (DRY) { report.push({ ...r, dry: true, hist: done(tid, 'hist'), day: done(tid, `day:${today}`) }); continue }

  db.exec('BEGIN IMMEDIATE')
  try {
    r.customers = ensureCustomers(tid, 30)
    if (!done(tid, 'hist')) {
      const h = seedHistory(tid, store, today)
      r.history = h
      r.cards = seedCards(tid, store, today)
      mark(tid, 'hist', { at: new Date().toISOString(), ...h })
    } else r.history = '已灌过,跳过'
    if (!done(tid, `day:${today}`)) {
      r.todayMade = seedToday(tid, store, today)
      r.cardsToday = seedCardsToday(tid, store, today)   // 今天那一笔卡跟着当天走(不然跨天后卡耗/新增持卡掉回 0)
      mark(tid, `day:${today}`, { at: new Date().toISOString() })
    } else r.todayMade = '今天已灌过,跳过'
    /* 🔴 待办那三项**不进幂等门**,每次跑都补到「至少 2 条」。
       这不是违反《幂等判据律》——那条律禁的是「拿剩余量当**做过没有**的判据」;
       这里做的是**状态保证**(补到 2 就停),有上界、重跑不增长。
       为什么必须每次补:收尾刀(J-33)会把跑机开的会话与积压报价请求关掉,
       关完首页那两项就掉回 0 —— 而 0 正是这一批在治的病。两把刀一收一补,得对得上。 */
    r.todos = seedNotesAndTodos(tid, today)
    /* 排班也不进幂等门:它按 (技师, 日期) 去重,每天跑一次就把窗口往后推一天 */
    r.schedule = seedSchedule(tid, today)
    /* AI 今日一句**不进幂等门**:它是覆盖写(一天一条),每次跑都该按当下的数重算一遍。
       放进门里的话,今天早上灌过之后,下午再跑它就还挂着早上那句(数字都对不上了)。 */
    r.aiLine = seedAiLine(tid, today, store.timezone)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); r.error = e.message; }
  report.push(r)
}

console.log(`\n════ 灌数据结果 ════`)
for (const r of report) console.log(' ', JSON.stringify(r))
reportTarget('seed-demo-rich 跑完', DB_PATH, before)
db.close()
if (report.some((r) => r.error)) process.exit(1)
