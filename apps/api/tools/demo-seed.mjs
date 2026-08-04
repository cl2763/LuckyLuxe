#!/usr/bin/env node
// 有迹 · 演示店种子脚本(生产可跑)
//
// 用途:在生产库里造两家**纯演示**门店,给店主对外演示用,与真实商户数据完全隔离。
//   demo-ai     「星野美甲(AI版)」   —— AI 全开:智能客服/日报/召回话术/参考图报价/小记结构化
//   demo-basic  「悦容美甲(基础版)」 —— 完全无 AI,展示不买 AI 智能包的形态
//
// 隔离与安全(设计前提):
//   1. 租户 id 一律以 `demo-` 开头。服务端已据此做两件事:
//      · GET /shops 排除 demo-%,顾客端「选店」列表里看不到,扫码也进不去;
//      · 账本只追加触发器对 demo-% 豁免,所以这些数据能被整体销毁(真实租户的只追加保证不变)。
//   2. 演示账号密码只有店主知道,别人登录不了。
//   3. 顾客端要看演示店:在小程序「选店」页用隐藏入口切租户,或直接 wx.setStorageSync('lucky_tenant','demo-ai')。
//
// 用法(在 apps/api 目录下):
//   node tools/demo-seed.mjs --list                 只看两家店当前有多少数据
//   node tools/demo-seed.mjs --reset                销毁并重建两家(最常用)
//   node tools/demo-seed.mjs --reset --tenant=demo-ai
//   node tools/demo-seed.mjs --destroy              只销毁,不重建
//   加 --db=/path/to.sqlite 指定库;不加则用默认本地库路径。
//
// 纪律:脚本只碰 tenant_id 以 demo- 开头的行。任何删除都先打印命中行数,--destroy/--reset 才真正写库。

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => args.some((a) => a === `--${name}`)
const val = (name, dflt = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

const DB_PATH = val('db') || join(__dirname, '..', 'local-data', 'lucky-luxe.sqlite')
if (!existsSync(DB_PATH)) {
  console.error(`[demo-seed] 找不到数据库:${DB_PATH}`)
  process.exit(1)
}
const db = new DatabaseSync(resolve(DB_PATH))
db.exec('PRAGMA foreign_keys = OFF;')

const TZ = 'America/Toronto'
const iso = (d) => new Date(d).toISOString()
const uid = (p) => `${p}-${randomUUID().slice(0, 8)}`
// 必须和 local-server.mjs 的 adminPasswordHash 完全一致,否则演示账号登不进去
const adminPasswordHash = (username, password) =>
  createHash('sha256').update(`admin:${String(username).toLowerCase()}:${String(password)}`).digest('hex')
const DEMO_PASSWORD = 'demo1234'

// ── 门店时区下的"今天",预约全部按相对日期生成,演示永远不会变成一屏死数据 ──
function storeToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return parts // YYYY-MM-DD
}
function dayOffset(n) {
  const [y, m, d] = storeToday().split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + n)
  return base.toISOString().slice(0, 10)
}
// 门店本地时刻 → UTC ISO(多伦多夏令时 -4)
function at(dateStr, hhmm) {
  return `${dateStr}T${hhmm}:00.000-04:00`
}
function plusMin(isoStr, min) {
  return iso(new Date(new Date(isoStr).getTime() + min * 60000))
}

// ── 通用插入:只写库里真实存在的列,并自动补齐「NOT NULL 且无默认值」的列 ──
// 这样脚本对 schema 差异免疫(本地库和生产库字段不完全一致时不会炸)。
const colCache = {}
function columnsOf(table) {
  if (!colCache[table]) colCache[table] = db.prepare(`PRAGMA table_info(${table})`).all()
  return colCache[table]
}
function hasTable(table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table))
}
function insertRow(table, data, replace = true) {
  const cols = columnsOf(table)
  const names = cols.map((c) => c.name)
  const row = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue
    if (!names.includes(k)) {
      // 字段名写错会被静默丢弃(曾导致 occurred_at/occurred_on 写空、财务页整页没数),这里必须吼出来
      console.warn(`[warn] ${table} 无字段 "${k}",该值被丢弃 —— 检查字段名是否写错`)
      continue
    }
    row[k] = v
  }
  for (const c of cols) {
    if (c.pk) continue
    if (c.notnull && c.dflt_value === null && row[c.name] === undefined) {
      const t = String(c.type || '').toUpperCase()
      row[c.name] = t.includes('INT') || t.includes('REAL') || t.includes('NUM') ? 0 : ''
    }
  }
  const keys = Object.keys(row)
  db.prepare(`INSERT OR ${replace ? 'REPLACE' : 'ABORT'} INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => row[k]))
}

// ── 表清单:凡是带 tenant_id 的表都要能被销毁,漏一张就会留垃圾 ──
function tenantTables() {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  const out = []
  for (const r of rows) {
    const cols = db.prepare(`PRAGMA table_info(${r.name})`).all()
    if (cols.some((c) => c.name === 'tenant_id')) out.push(r.name)
  }
  return out
}

function countFor(tenantId) {
  const per = {}
  let total = 0
  for (const t of tenantTables()) {
    const n = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE tenant_id = ?`).get(tenantId).c
    if (n) { per[t] = n; total += n }
  }
  return { total, per }
}

// 有几张表没有 tenant_id(按 technician_id / store_id 关联),销毁时要按 demo 前缀单独清,否则会留孤儿行。
const ORPHAN_TABLES = [
  ['technician_schedules', 'technician_id'],
  ['schedule_change_requests', 'technician_id'],
  ['technician_services', 'technician_id'],
  ['business_hours', 'store_id'],
  ['store_special_dates', 'store_id']
]

function destroy(tenantId, apply) {
  if (!tenantId.startsWith('demo-')) throw new Error(`拒绝:${tenantId} 不是演示租户(必须 demo- 开头)`)
  const before = countFor(tenantId)
  console.log(`\n[destroy] ${tenantId} 命中 ${before.total} 行:`, JSON.stringify(before.per))
  if (!apply) { console.log('[destroy] dry-run,未写库'); return }
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const t of tenantTables()) db.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).run(tenantId)
    // 无 tenant_id 的关联表:按 demo 前缀清理(id 形如 demo-ai-tech-1 / demo-ai-store)
    for (const [table, col] of ORPHAN_TABLES) {
      if (!hasTable(table)) continue
      const n = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} LIKE ?`).get(`${tenantId}-%`).c
      if (n) {
        db.prepare(`DELETE FROM ${table} WHERE ${col} LIKE ?`).run(`${tenantId}-%`)
        console.log(`  └ ${table}(按 ${col})清理 ${n} 行`)
      }
    }
    db.prepare('DELETE FROM tenants WHERE id = ?').run(tenantId)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  const after = countFor(tenantId)
  console.log(`[destroy] ${tenantId} 完成,剩余 ${after.total} 行`)
}

// ══════════════ 演示数据本体 ══════════════
const SERVICES_AI = [
  ['日式基础款', 'NAIL', '手部美甲', 28800, 90, '想要干净耐看的日常款'],
  ['猫眼进阶款', 'NAIL', '手部美甲', 38800, 120, '喜欢有光泽变化的款式'],
  ['法式微钻', 'NAIL', '手部美甲', 45800, 120, '约会/拍照场合'],
  ['单色延长', 'NAIL', '手部美甲', 52800, 150, '想要修饰甲型'],
  ['足部日常', 'NAIL', '足部美甲', 32800, 90, '凉鞋季必备'],
  ['自然仿真睫', 'LASH', '美睫', 26800, 90, '第一次做睫毛'],
  ['浓密开扇睫', 'LASH', '美睫', 36800, 120, '想要明显放大眼型'],
  ['手部深层护理', 'CARE', '护理', 12800, 45, '甲面偏薄需要养护']
]
const SERVICES_BASIC = [
  ['经典单色', 'NAIL', '手部美甲', 19800, 60, '日常通勤'],
  ['渐变晕染', 'NAIL', '手部美甲', 26800, 90, '想要柔和层次'],
  ['足部基础', 'NAIL', '足部美甲', 22800, 60, '夏季护理'],
  ['自然嫁接睫', 'LASH', '美睫', 21800, 90, '日常自然款'],
  ['卸甲护理', 'CARE', '护理', 6800, 30, '换款前的养护']
]
const TECHS_AI = [['Nora', 'senior'], ['Kiki', 'senior'], ['Wendy', 'junior'], ['Sasa', 'junior']]
const TECHS_BASIC = [['小雅', 'senior'], ['阿May', 'junior']]
const SURNAMES = ['林', '陈', '王', '李', '张', '刘', '周', '吴', '郑', '孙', '徐', '朱', '许', '何', '曹']
const GIVEN = ['佳怡', '雨桐', '思彤', '嘉禾', '亦菲', '若曦', 'книга', '梦琪', '欣妍', '子涵', '雅静', '雪儿', '安琪', 'корица', '海琳']
const NOTE_STYLES = ['奶油法式', '猫眼酒红', '裸色简约', '碎钻点缀', '雾面豆沙']
const NOTE_PERSON = ['话不多,喜欢安静做完', '很健谈,喜欢聊新款', '时间紧,要求准时结束', '喜欢拍照发朋友圈']
const NOTE_PREF = ['偏爱短甲', '不喜欢太亮的闪', '喜欢暖色调', '指甲偏薄要轻磨']
const NOTE_SAFE = ['对某品牌卸甲水过敏', '孕期,避免刺激气味']

function seedTenant(cfg) {
  const { tenantId, tenantName, storeName, services, techs, custCount, withAi, bossUser, staffPrefix } = cfg
  const now = iso(new Date())
  console.log(`\n[seed] 开始建 ${tenantId}(${tenantName})`)
  db.exec('BEGIN IMMEDIATE')
  try {
    // 租户 + 套餐(AI 版给连锁档自带 AI,基础版给单店档无 AI)
    insertRow('tenants', {
      id: tenantId, name: tenantName, status: 'active',
      plan: withAi ? 'chain' : 'single',
      plan_expires_at: iso(new Date(Date.now() + 365 * 86400000)),
      created_at: now, updated_at: now
    })

    // 门店
    const storeId = `${tenantId}-store`
    insertRow('stores', {
      id: storeId, tenant_id: tenantId, name: storeName, is_active: 1,
      address: '演示地址 · 仅用于产品演示', phone: '000-0000-0000',
      timezone: TZ, currency: 'CAD'
    })

    // 营业时间(周一休息,周二至周日 10:00-19:00)——不种这张表台面会显示「今日休息」
    if (hasTable('business_hours')) {
      db.prepare('DELETE FROM business_hours WHERE store_id = ?').run(storeId)
      for (let wd = 0; wd <= 6; wd += 1) {
        insertRow('business_hours', {
          store_id: storeId, weekday: wd,
          open_time: '10:00', close_time: '19:00',
          is_closed: wd === 1 ? 1 : 0, updated_at: now, updated_by: 'demo-seed'
        })
      }
    }

    // 服务
    const svcIds = []
    services.forEach(([name, type, cat, price, dur, fit], i) => {
      const id = `${tenantId}-svc-${i + 1}`
      svcIds.push({ id, name, price, dur, type })
      insertRow('services', {
        id, tenant_id: tenantId, name_zh: name, name_en: name,
        type, category: cat, price_cents: price, deposit_cents: 0,
        base_duration_min: dur, is_active: 1, sort_order: i + 1,
        description_zh: `${fit}。${name}是店里的常做款,做完约可维持 3-4 周。`,
        description_en: `${name} — a popular option at our studio.`,
        process_json: JSON.stringify(['修型打磨', '底胶护理', '上色/嫁接', '封层与保养建议']),
        notice_json: JSON.stringify(['请提前 10 分钟到店', '如需卸甲请预约时备注'])
      })
    })

    // 技师
    const techIds = []
    techs.forEach(([name, level], i) => {
      const id = `${tenantId}-tech-${i + 1}`
      techIds.push({ id, name })
      insertRow('technicians', {
        id, tenant_id: tenantId, store_id: storeId, name, is_active: 1,
        title: level === 'senior' ? (i % 2 === 0 ? '资深美甲师' : '资深美睫师') : (i % 2 === 0 ? '美甲师' : '美睫师')
      })
    })

    // 顾客:按 RFM 分层刻意分布,保证客户分层页四层都有人、召回名单不为空
    //   sleep 沉睡(>60天未到店) / vip 高价值活跃 / fresh 新客(首访≤30天) / normal 普通
    const cohorts = []
    const push = (kind, n) => { for (let i = 0; i < n; i += 1) cohorts.push(kind) }
    if (custCount >= 20) { push('sleep', 6); push('vip', 7); push('fresh', 5); push('normal', custCount - 18) }
    else { push('sleep', 3); push('vip', 3); push('fresh', 3); push('normal', Math.max(0, custCount - 9)) }

    const custIds = []
    cohorts.forEach((kind, i) => {
      const id = `${tenantId}-cust-${i + 1}`
      const name = `${SURNAMES[i % SURNAMES.length]}${GIVEN[(i * 3) % GIVEN.length]}`
      // 每层的到店节奏:visits=历史到店次数,lastDays=最近一次距今天数,firstDays=首访距今
      const profile = {
        sleep: { visits: 2 + (i % 3), lastDays: 68 + i * 9, firstDays: 210 + i * 6, spend: 68000 + i * 12000 },
        vip: { visits: 5 + (i % 4), lastDays: 6 + (i % 26), firstDays: 260 + i * 4, spend: 168000 + i * 26000 },
        fresh: { visits: 1, lastDays: 3 + (i % 22), firstDays: 3 + (i % 22), spend: 28800 },
        normal: { visits: 2 + (i % 2), lastDays: 24 + (i % 28), firstDays: 120 + i * 3, spend: 52000 + i * 6000 }
      }[kind]
      // 注意:消费额/会员等级/最近到店 都是从预约与账本**推导**出来的,users 表里没有这些列,
      // 所以顾客的"分层长什么样"完全由下面生成的预约决定。
      const tagPool = { sleep: ['需回访'], vip: ['高价值', '常客'], fresh: ['新客'], normal: [] }[kind]
      insertRow('users', {
        id, tenant_id: tenantId, display_name: name,
        phone: `1380000${String(1000 + i).slice(-4)}`,
        email: `demo${i + 1}@example.invalid`,
        tags_json: JSON.stringify(tagPool),
        notes: kind === 'vip' ? '老客,喜欢安静的时段' : (kind === 'fresh' ? '朋友推荐来的' : ''),
        birthday: i % 4 === 0 ? `${1990 + (i % 12)}-0${(i % 9) + 1}-1${i % 9}` : ''
      })
      custIds.push({ id, name, kind, ...profile })
    })

    // 预约:过去 6 周已完成 + 今天台面(三种状态)+ 未来一周已确认
    const CHANNELS = ['小程序', '微信客服', '到店直排', '老客推荐']
    const ADDONS = [[], [], [{ name: '甲油加固', priceCents: 3800 }], [{ name: '手部按摩', priceCents: 5800 }]]
    const mkBooking = (dateStr, hhmm, cust, svc, techId, status, extra = {}) => {
      const id = uid(`${tenantId}-bk`)
      const start = at(dateStr, hhmm)
      const addons = extra.addons || ADDONS[Math.floor(Math.random() * ADDONS.length)]
      const addonCents = addons.reduce((s, a) => s + a.priceCents, 0)
      insertRow('bookings', {
        id, tenant_id: tenantId, store_id: storeId, user_id: cust.id,
        service_id: svc.id, technician_id: techId, status,
        appointment_start: start, appointment_end: plusMin(start, svc.dur),
        service_price_cents: svc.price + addonCents,
        final_due_cents: svc.price + addonCents,
        total_duration_min: svc.dur, deposit_cents: 0, deposit_required_cents: 0,
        addons_json: JSON.stringify(addons),
        source_channel: extra.channel || CHANNELS[Math.floor(Math.random() * CHANNELS.length)],
        member_level_at_booking: 'silver',
        notes: extra.notes,
        arrived_at: extra.arrivedAt,
        direct_deposit_unpaid: extra.unpaid ? 1 : 0,
        attribution_note: extra.attributionNote,
        public_code: `D${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        cancelled_at: status === 'CANCELLED' ? plusMin(start, -1440) : undefined,
        created_at: iso(new Date(new Date(start).getTime() - 3 * 86400000)), updated_at: now
      })
      return { id, svc: { ...svc, price: svc.price + addonCents }, start, userId: cust.id, techId, cust }
    }

    // 历史单:按每位顾客的分层节奏生成,保证「最近到店/到店次数」和 RFM 分层自洽
    const done = []
    custIds.forEach((cust, ci) => {
      for (let v = 0; v < cust.visits; v += 1) {
        const daysAgo = cust.lastDays + v * (cust.kind === 'vip' ? 22 : 34)
        if (daysAgo > 330) continue
        const svc = svcIds[(ci + v) % svcIds.length]
        const techId = techIds[(ci + v) % techIds.length].id
        const hh = ['10:30', '12:00', '14:00', '15:30', '17:00'][(ci + v) % 5]
        done.push(mkBooking(dayOffset(-daysAgo), hh, cust, svc, techId, 'COMPLETED'))
      }
    })

    // 沉睡客不能有"今天/未来"的单——「最近到店」按最后一条预约算,一旦排了就会被算成活跃,分层演示不出来。
    const futureCands = custIds.filter((c) => c.kind !== 'sleep')

    // 日常营业单:过去 100 天每个营业日 4-7 单。
    // 没有这批,月收入撑不起房租/工资的成本结构,演示店会显示成一家在亏钱的店。
    const dailyCount = withAi ? [5, 6, 7, 5, 6, 4] : [3, 4, 3, 4, 3, 2]
    for (let d = 120; d >= 1; d -= 1) {
      const date = dayOffset(-d)
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
      if (weekday === 1) continue // 周一休
      const n = dailyCount[d % dailyCount.length]
      for (let j = 0; j < n; j += 1) {
        const cust = futureCands[(d * 3 + j * 7) % futureCands.length]
        const svc = svcIds[(d + j * 3) % svcIds.length]
        const techId = techIds[(d + j) % techIds.length].id
        const hh = ['10:15', '11:45', '13:15', '14:45', '16:15', '17:45', '18:30'][j % 7]
        done.push(mkBooking(date, hh, cust, svc, techId, 'COMPLETED'))
      }
    }
    // 本月加密:月初演示时"本月收入"不能被月初就入账的房租压成负数,本月每天多排几单
    {
      const tm = storeToday().slice(0, 7)
      const todayDom0 = Number(storeToday().slice(8, 10))
      for (let dom = 1; dom <= todayDom0; dom += 1) {
        const date = `${tm}-${String(dom).padStart(2, '0')}`
        if (new Date(`${date}T12:00:00Z`).getUTCDay() === 1) continue
        for (let j = 0; j < (withAi ? 4 : 2); j += 1) {
          const cust = futureCands[(dom * 5 + j * 3) % futureCands.length]
          done.push(mkBooking(date, ['09:45', '12:30', '15:00', '18:15'][j % 4], cust,
            svcIds[(dom + j * 2) % svcIds.length], techIds[(dom + j) % techIds.length].id, 'COMPLETED'))
        }
      }
    }

    // 今日台面:三种状态齐全(已完成 / 进行中 / 未到),外加一条未收定金的直排单
    const today = storeToday()
    const tc = (n) => futureCands[n % futureCands.length]
    const t0 = mkBooking(today, '10:00', tc(0), svcIds[0], techIds[0].id, 'COMPLETED',
      { channel: '小程序', arrivedAt: at(today, '09:55') })
    done.push(t0)
    mkBooking(today, '11:30', tc(1), svcIds[1], techIds[0].id, 'CONFIRMED',
      { channel: '微信客服', arrivedAt: at(today, '11:28'), notes: '进行中' }) // 已到店=进行中
    mkBooking(today, '14:00', tc(2), svcIds[2], techIds[1].id, 'CONFIRMED', { channel: '小程序' }) // 未到
    mkBooking(today, '16:00', tc(3), svcIds[3], techIds[1].id, 'CONFIRMED',
      { channel: '到店直排', unpaid: true, notes: '电话预约,定金未收' })
    if (techIds[2]) mkBooking(today, '15:00', tc(4), svcIds[4 % svcIds.length], techIds[2].id, 'CONFIRMED', { channel: '老客推荐' })

    // 未来两周:陆续有单,演示"排期已经排出去了"
    for (let d = 1; d <= 12; d += 1) {
      const n = d % 3 === 0 ? 2 : 1
      for (let j = 0; j < n; j += 1) {
        const cust = futureCands[(d * 2 + j) % futureCands.length]
        mkBooking(dayOffset(d), ['11:00', '14:30', '16:30'][j % 3], cust,
          svcIds[(d + j) % svcIds.length], techIds[(d + j) % techIds.length].id, 'CONFIRMED')
      }
    }
    // 两条已取消(演示取消/爽约的处理)
    mkBooking(dayOffset(-4), '13:00', custIds[2], svcIds[1], techIds[0].id, 'CANCELLED')
    mkBooking(dayOffset(-11), '15:00', custIds[6], svcIds[2], techIds[1].id, 'CANCELLED')

    // 财务账本:每笔完成单记一条收入 + 每周若干支出
    // 账本字段是 occurred_on(YYYY-MM-DD 日期,不是时间戳),pay_channel/source 也要给对,否则报表分组不出来
    const CHANNELS_PAY = ['card', 'wechat', 'cash', 'alipay']
    const mkTxn = (type, category, cents, dateStr, note, opt = {}) => {
      insertRow('finance_transactions', {
        id: uid(`${tenantId}-txn`), tenant_id: tenantId, store_id: storeId,
        type, source: opt.source || (type === 'income' ? 'booking' : 'manual'),
        category, tags: opt.tags || '', amount_cents: cents,
        pay_channel: opt.payChannel || CHANNELS_PAY[Math.floor(Math.random() * CHANNELS_PAY.length)],
        occurred_on: dateStr, note, booking_id: opt.bookingId,
        created_by: 'demo-seed', created_at: iso(new Date(`${dateStr}T12:00:00Z`))
      }, false)
    }
    const dayOf = (isoStr) => new Date(isoStr).toISOString().slice(0, 10)

    // ① 每笔完成单 → 一条服务收入(带技师 tag 和 booking_id,业绩归属链路才对得上)
    done.forEach((b) => mkTxn('income', '服务收入', b.svc.price, dayOf(b.start),
      `${b.svc.name} · ${b.cust.name}`, { tags: b.techId, bookingId: b.id }))

    // ② 储值充值收入(与储值流水金额一一对应)
    custIds.filter((c) => c.kind === 'vip').slice(0, 4).forEach((c, i) => {
      mkTxn('income', '储值充值', [100000, 300000, 300000, 500000][i], dayOffset(-(20 + i * 9)),
        `${c.name} 储值卡充值`, { source: 'stored_value', tags: techIds[i % techIds.length].id })
    })

    // ③ 零售/加项等杂项收入,让收入结构不止一种
    for (let m = 5; m >= 0; m -= 1) {
      const mBase = -m * 30
      mkTxn('income', '产品零售', 12800 + m * 900, dayOffset(mBase - 6), '甲油/护手霜零售')
      if (m % 2 === 0) mkTxn('income', '产品零售', 8800, dayOffset(mBase - 19), '睫毛清洁套装')
    }

    // ④ 支出:近 6 个月每月完整成本结构(房租/水电/材料/推广/工资/杂项),月度趋势与利润才算得出来
    // 成本结构按"月收入的合理占比"设定,保证演示店是**盈利**的(美甲店毛利高,净利 35-45% 合理)
    // 只做近 4 个月,和日常营业单的覆盖范围对齐——否则更早的月份会出现"有支出没收入"的假亏损
    // 基础版是 2 技师小店(单量约为 AI 版的 1/3),成本要同比缩小,否则会显示成亏钱的店
    const scale = withAi ? 1 : 0.32
    for (let m = 3; m >= 0; m -= 1) {
      const mBase = -m * 30
      mkTxn('expense', '房租', Math.round(680000 * scale), dayOffset(mBase - 1), '门店租金', { payChannel: 'card' })
      mkTxn('expense', '水电', Math.round((52000 + m * 2200) * scale), dayOffset(mBase - 8), '水电网费')
      mkTxn('expense', '材料', Math.round((186000 + m * 9200) * scale), dayOffset(mBase - 12), '甲油胶/睫毛耗材采购')
      mkTxn('expense', '材料', Math.round((74000 + m * 3600) * scale), dayOffset(mBase - 22), '工具与消耗品')
      mkTxn('expense', '推广', Math.round(88000 * scale), dayOffset(mBase - 16), '小红书/朋友圈推广')
      mkTxn('expense', '其他', Math.round(11500 * scale), dayOffset(mBase - 15), '软件订阅费')
      // 工资:上月及更早已发放(本月还没发,正好演示「锁定工资表 → 发放入账」)
      if (m > 0) mkTxn('expense', '工资', Math.round((1880000 + m * 40000) * scale), dayOffset(mBase - 2), '员工工资发放', { payChannel: 'card' })
    }

    // ⑤ 本月密度补强:确保"本月收入/支出/利润"三个数都饱满(演示第一眼看的就是这个)
    const thisMonth = storeToday().slice(0, 7)
    const dim = new Date(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)), 0).getDate()
    const todayDom = Number(storeToday().slice(8, 10))
    for (let d = 1; d <= Math.min(todayDom, dim); d += 1) {
      const date = `${thisMonth}-${String(d).padStart(2, '0')}`
      if (d % 4 === 0) mkTxn('expense', '材料', 9800 + d * 260, date, '当日耗材补货')
      if (d % 6 === 0) mkTxn('income', '产品零售', 6800 + d * 180, date, '门店零售')
    }

    // 服务小记 + 结构化画像
    if (hasTable('service_notes')) {
      // 绝大多数完成单都写了小记(体现"这家店在好好用"),只留今天+昨天的几单没写,
      // 让「服务小记」待办列表有 5-8 条可演示——太多会显得积压,太少就没得点。
      const cutoff = Date.now() - 1.2 * 86400000
      done.filter((b, i) => new Date(b.start).getTime() < cutoff && i % 15 !== 7).forEach((b, i) => {
        const structured = {
          styles: [NOTE_STYLES[i % NOTE_STYLES.length]],
          personality: [NOTE_PERSON[i % NOTE_PERSON.length]],
          preferences: [NOTE_PREF[i % NOTE_PREF.length]],
          companions: i % 7 === 0 ? ['和闺蜜一起来'] : [],
          safetyFlags: i % 9 === 0 ? [NOTE_SAFE[i % NOTE_SAFE.length]] : []
        }
        const techName = (techIds.find((t) => t.id === b.techId) || {}).name || ''
        insertRow('service_notes', {
          id: uid(`${tenantId}-note`), tenant_id: tenantId, user_id: b.userId,
          booking_id: b.id, technician_id: b.techId, technician_name: techName,
          service_name: b.svc.name,
          raw_text: `做的${structured.styles[0]},${structured.personality[0]}。${structured.preferences[0]}${structured.safetyFlags.length ? ',注意:' + structured.safetyFlags[0] : ''}。`,
          structured_json: JSON.stringify(structured),
          created_by: techName, created_at: b.start
        })
      })
    }

    // ── 技师可做项目 + 未来两周排班 + 一条待处理排班申请 ──
    techIds.forEach((t, i) => {
      svcIds.forEach((s, j) => { if ((i + j) % 4 !== 3) insertRow('technician_services', { technician_id: t.id, service_id: s.id }) })
      for (let d = -7; d <= 14; d += 1) {
        const date = dayOffset(d)
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
        const off = weekday === 1 || (i === 1 && weekday === 4) // 周一全店休,Kiki 周四轮休
        insertRow('technician_schedules', {
          technician_id: t.id, date,
          start_time: i % 2 === 0 ? '10:00' : '11:00',
          end_time: i % 2 === 0 ? '19:00' : '20:00',
          is_working: off ? 0 : 1
        })
      }
    })
    if (hasTable('schedule_change_requests')) {
      insertRow('schedule_change_requests', {
        id: uid(`${tenantId}-sreq`), technician_id: techIds[techIds.length - 1].id,
        date: dayOffset(5), note: '下周三家里有事,想调休', status: 'PENDING', created_at: iso(new Date(Date.now() - 86400000))
      })
    }

    // ── 打卡考勤:过去两周,含加班与一条异常(忘打下班)──
    if (hasTable('store_wifi')) {
      insertRow('store_wifi', { id: `${tenantId}-wifi`, tenant_id: tenantId, store_id: storeId, ssid: 'DemoSalon-5G', bssid: 'a4:5e:60:d2:11:0' + (withAi ? 'a' : 'b'), created_at: now })
    }
    techIds.forEach((t, i) => {
      for (let d = 14; d >= 1; d -= 1) {
        const date = dayOffset(-d)
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
        if (weekday === 1) continue
        const inAt = at(date, i % 2 === 0 ? '09:52' : '10:58')
        const overtime = (d % 5 === 0) ? 45 + i * 10 : 0
        const forgot = (d === 3 && i === 0)
        insertRow('attendance_records', {
          id: uid(`${tenantId}-att`), tenant_id: tenantId, technician_id: t.id, work_date: date,
          clock_in_at: inAt,
          clock_out_at: forgot ? undefined : at(date, overtime ? '19:5' + String(i) : (i % 2 === 0 ? '19:04' : '20:06')),
          in_wifi_ssid: 'DemoSalon-5G', in_verified: 1,
          out_wifi_ssid: forgot ? undefined : 'DemoSalon-5G', out_verified: forgot ? 0 : 1,
          overtime_min: overtime, note: forgot ? '忘记打下班卡' : undefined,
          created_at: inAt, updated_at: inAt
        })
      }
      // 今天已上班打卡(演示"在岗"状态)
      insertRow('attendance_records', {
        id: uid(`${tenantId}-att`), tenant_id: tenantId, technician_id: t.id, work_date: today,
        clock_in_at: at(today, i % 2 === 0 ? '09:56' : '10:55'),
        in_wifi_ssid: 'DemoSalon-5G', in_verified: 1, out_verified: 0, overtime_min: 0,
        created_at: now, updated_at: now
      })
    })

    // ── 薪资方案:全店默认(底薪+阶梯提成)+ 一位技师专属(纯提成)──
    insertRow('salary_plans', {
      id: `${tenantId}-plan-default`, tenant_id: tenantId, technician_id: '',
      template: 'base_ladder', base_salary_cents: 260000, handwork_fee_cents: 2000,
      ladder_json: JSON.stringify([{ minCents: 0, pct: 0.12 }, { minCents: 800000, pct: 0.16 }, { minCents: 1500000, pct: 0.2 }]),
      flat_pct: 0, card_pct: 0.05, recharge_pct: 0.03,
      overtime_rate_cents: 3000, overtime_unit_min: 30, created_at: now, updated_at: now
    })
    insertRow('salary_plans', {
      id: `${tenantId}-plan-t1`, tenant_id: tenantId, technician_id: techIds[0].id,
      template: 'commission', base_salary_cents: 0, handwork_fee_cents: 3000,
      ladder_json: JSON.stringify([{ minCents: 0, pct: 0.22 }]),
      flat_pct: 0.22, card_pct: 0.06, recharge_pct: 0.04,
      overtime_rate_cents: 3500, overtime_unit_min: 30, created_at: now, updated_at: now
    })
    if (hasTable('salary_adjusts')) {
      insertRow('salary_adjusts', {
        tenant_id: tenantId, month: storeToday().slice(0, 7), technician_id: techIds[1].id,
        adjust_cents: -8000, note: '上月多算的耗卡提成,本月扣回', updated_at: now
      })
    }

    // ── 储值:会员套餐 + 充值/耗卡流水(带经手技师,工资里的充值/耗卡提成才有数)──
    if (hasTable('membership_packages')) {
      [['储值卡 · 入门', 100000, 10000], ['储值卡 · 常客', 300000, 45000], ['储值卡 · 至尊', 500000, 90000]]
        .forEach(([nm, price, bonus], i) => insertRow('membership_packages', {
          id: `${tenantId}-pkg-${i + 1}`, tenant_id: tenantId, kind: 'stored_value', name: nm,
          price_cents: price, bonus_cents: bonus, times_count: 0, scope: 'all',
          benefits: '储值即享折扣,余额永久有效', is_active: 1, sort_order: i + 1, created_at: now
        }))
    }
    custIds.filter((c) => c.kind === 'vip').slice(0, 4).forEach((c, i) => {
      const rAt = at(dayOffset(-(20 + i * 9)), '15:00')
      insertRow('stored_value_transactions', {
        id: uid(`${tenantId}-sv`), tenant_id: tenantId, user_id: c.id, type: 'recharge',
        amount_cents: [100000, 300000, 300000, 500000][i],
        pay_channel: ['wechat', 'card', 'cash', 'wechat'][i],
        technician_id: techIds[i % techIds.length].id,
        note: `储值卡充值(赠 ${[100, 450, 450, 900][i]} 元)`, created_at: rAt, created_by: 'demo-seed'
      }, false)
      insertRow('stored_value_transactions', {
        id: uid(`${tenantId}-sv`), tenant_id: tenantId, user_id: c.id, type: 'consume',
        amount_cents: -[38800, 45800, 28800, 52800][i], pay_channel: 'stored_value',
        technician_id: techIds[(i + 1) % techIds.length].id,
        note: '耗卡消费', created_at: at(dayOffset(-(6 + i * 4)), '16:00'), created_by: 'demo-seed'
      }, false)
    })

    // ── 券:4 种模板 + 发放(未用/已用/过期三态齐全)──
    const couponDefs = [
      ['新客体验券', 'amount', 2000, 0, 0, 30],
      ['老友回归券', 'amount', 3000, 0, 20000, 45],
      ['满减券', 'amount', 5000, 0, 30000, 60],
      ['八八折券', 'percent', 0, 12, 0, 90]
    ]
    const couponIds = []
    couponDefs.forEach(([nm, dtype, amt, pct, minSpend, vd], i) => {
      const id = `${tenantId}-cp-${i + 1}`
      couponIds.push(id)
      insertRow('coupons', {
        id, tenant_id: tenantId, name: nm, discount_type: dtype,
        amount_cents: amt, percent_off: pct, min_spend_cents: minSpend,
        valid_days: vd, total_qty: 200, issued_qty: 12 + i * 5, is_active: 1, created_at: now
      })
    })
    custIds.slice(0, 14).forEach((c, i) => {
      const status = i % 5 === 0 ? 'used' : (i % 7 === 3 ? 'expired' : 'unused')
      const grantedAt = at(dayOffset(-(10 + i * 3)), '12:00')
      insertRow('coupon_grants', {
        id: uid(`${tenantId}-cg`), tenant_id: tenantId, coupon_id: couponIds[i % couponIds.length],
        user_id: c.id, code: `DM${String(100000 + i * 137).slice(0, 6)}`,
        status, expires_at: status === 'expired' ? at(dayOffset(-3), '23:59') : at(dayOffset(30 + i), '23:59'),
        used_at: status === 'used' ? at(dayOffset(-(4 + i)), '16:00') : undefined,
        created_at: grantedAt
      })
    })

    // ── 积分商城:奖品 + 台账(有兑换记录)──
    if (hasTable('points_prizes')) {
      couponIds.forEach((cid, i) => insertRow('points_prizes', {
        id: `${tenantId}-prize-${i + 1}`, tenant_id: tenantId, coupon_id: cid,
        cost_points: [200, 300, 500, 800][i], stock: [50, 30, 20, 10][i],
        per_user_limit: 2, valid_days: 60, is_active: 1, redeemed_qty: [6, 3, 1, 0][i],
        created_at: now, updated_at: now
      }))
    }
    custIds.slice(0, 8).forEach((c, i) => {
      insertRow('points_transactions', {
        id: uid(`${tenantId}-pt`), tenant_id: tenantId, user_id: c.id, type: 'adjust',
        amount: 120 + i * 40, note: '开业活动赠送积分', created_by: 'demo-seed',
        created_at: at(dayOffset(-(30 + i)), '10:00')
      }, false)
      if (i < 3) insertRow('points_transactions', {
        id: uid(`${tenantId}-pt`), tenant_id: tenantId, user_id: c.id, type: 'redeem',
        amount: -200, note: `积分兑换 新客体验券 #${tenantId}-prize-1`, created_by: 'demo-seed',
        created_at: at(dayOffset(-(8 + i)), '14:00')
      }, false)
    })

    // ── 作品图库:挑 4 单标记为已授权展示 ──
    // 图片用内联 SVG data-uri(几百字节),不走 base64 照片,避免把生产库撑大;演示时视觉上是 4 张美甲色卡。
    const artwork = (c1, c2, label) => `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
      `<rect width="600" height="800" fill="url(#g)"/>` +
      `<circle cx="300" cy="330" r="120" fill="#ffffff" opacity="0.18"/>` +
      `<circle cx="300" cy="330" r="72" fill="#ffffff" opacity="0.22"/>` +
      `<text x="300" y="620" font-family="PingFang SC,sans-serif" font-size="44" fill="#ffffff" text-anchor="middle" opacity="0.92">${label}</text>` +
      `<text x="300" y="676" font-family="PingFang SC,sans-serif" font-size="24" fill="#ffffff" text-anchor="middle" opacity="0.6">演示作品</text></svg>`
    )}`
    const gallerySet = [
      ['#d9a7a0', '#8c5a52', '奶油法式'],
      ['#7d6a94', '#3d2f52', '猫眼酒红'],
      ['#c8a47e', '#8a6a3f', '裸色简约'],
      ['#88a8a0', '#3f6058', '雾面豆沙']
    ]
    done.slice(-4).forEach((b, i) => {
      const [c1, c2, label] = gallerySet[i % gallerySet.length]
      db.prepare(`UPDATE bookings SET gallery_status='approved', approved_work_images_json=?, work_images_json=?, gallery_locked_at=? WHERE id=?`)
        .run(JSON.stringify([artwork(c1, c2, label)]), JSON.stringify([artwork(c1, c2, label)]), b.start, b.id)
    })

    // ── 站内提醒(老板催员工写小记)──
    if (hasTable('staff_nudges')) {
      insertRow('staff_nudges', {
        id: uid(`${tenantId}-nudge`), tenant_id: tenantId, technician_id: techIds[0].id,
        type: 'service_note', message: '有 2 单还没写服务小记,记得补一下~',
        created_by: 'demo-boss', created_at: iso(new Date(Date.now() - 3600000))
      })
      if (techIds[1]) insertRow('staff_nudges', {
        id: uid(`${tenantId}-nudge`), tenant_id: tenantId, technician_id: techIds[1].id,
        type: 'service_note', message: '昨天的单子小记还差 1 条',
        created_by: 'demo-boss', created_at: iso(new Date(Date.now() - 7200000))
      })
    }

    // ── 财务:月目标 + 固定支出规则 + 多类目支出 ──
    if (hasTable('finance_targets')) {
      insertRow('finance_targets', {
        tenant_id: tenantId, target_mode: 'month', month_target_cents: withAi ? 4800000 : 2600000,
        year_target_cents: withAi ? 52000000 : 28000000, variable_cost_rate: 0.32,
        updated_by: 'demo-seed', updated_at: now
      })
    }
    if (hasTable('finance_recurring_rules')) {
      [['门店租金', '房租', 260000, 1], ['水电网', '水电', 42000, 8], ['软件订阅', '其他', 11500, 15]]
        .forEach(([nm, cat, amt, dom], i) => insertRow('finance_recurring_rules', {
          id: `${tenantId}-rr-${i + 1}`, tenant_id: tenantId, name: nm, category: cat, tags: '',
          amount_cents: amt, cadence: 'monthly', day_of_month: dom, active: 1,
          created_by: 'demo-seed', created_at: now, updated_at: now
        }))
    }

    // ── AI 版专属:客服会话三态 + 知识库 ──
    if (withAi && hasTable('wechat_conversations')) {
      const convs = [
        ['ai_replied', '周六下午还有位置吗?', '周六下午还有两个空档哦:14:00 和 16:30 🌟 手部美甲约 1.5 小时,你想约哪个时间?'],
        ['needs_human', '我上次做的甲片翘了一个角,能补吗?怎么算钱?', null],
        ['human_active', '想问下你们能不能做那种很复杂的手绘?', null]
      ]
      convs.forEach(([status, q, a], i) => {
        const cid = `wecom:${tenantId}-guest-${i + 1}`
        const t1 = iso(new Date(Date.now() - (i + 1) * 5400000))
        const transcript = [{ role: 'customer', content: q, at: t1 }]
        if (a) transcript.push({ role: 'assistant', content: a, at: plusMin(t1, 1) })
        if (status === 'human_active') transcript.push({ role: 'staff', content: '可以做的,复杂手绘按图案难度报价,方便发张参考图吗?', at: plusMin(t1, 6), staffName: '演示店长' })
        insertRow('wechat_conversations', {
          id: cid, tenant_id: tenantId, provider: 'wecom_customer_service',
          external_user_id: `${tenantId}-guest-${i + 1}`, open_kfid: 'demo-kf',
          status, last_intent: 'demo', last_message: transcript[transcript.length - 1].content,
          ai_reply_json: '{}', transcript_json: JSON.stringify(transcript), raw_event_json: '{}',
          created_at: t1, updated_at: t1
        })
      })
    }
    if (withAi && hasTable('tenant_kb_entries')) {
      [['营业时间', '周二至周日 10:00-19:00,周一固定休息。'],
       ['定金政策', '本店线上预约免定金,到店支付即可;临时取消请提前 4 小时告知。'],
       ['卸甲收费', '本店做的款式卸甲免费;他店款式卸甲 ¥30 起。'],
       ['停车', '门口有 2 小时免费路边停车位。']]
        .forEach(([q, a], i) => insertRow('tenant_kb_entries', {
          id: `${tenantId}-kb-${i + 1}`, tenant_id: tenantId, question: q,
          keywords: q, answer_zh: a, answer_en: '',
          enabled: 1, updated_by: 'demo-seed', created_at: now, updated_at: now
        }))
    }

    // 商家账号:老板 + 两名员工(员工绑技师,能演示员工端)
    const mkAccount = (username, role, techId, display) => {
      insertRow('admin_accounts', {
        id: uid(`${tenantId}-acc`), tenant_id: tenantId, username, role,
        password_hash: adminPasswordHash(username, DEMO_PASSWORD), status: 'active',
        display_name: display, technician_id: techId, must_change_password: 0,
        created_at: now, updated_at: now
      })
    }
    mkAccount(bossUser, 'owner', null, '演示店长')
    mkAccount(`${staffPrefix}1`, 'staff', techIds[0].id, techs[0][0])
    if (techIds[1]) mkAccount(`${staffPrefix}2`, 'staff', techIds[1].id, techs[1][0])

    // AI 权益:AI 版开,基础版明确关(演示"不买 AI 是什么样")
    if (hasTable('tenant_entitlements')) {
      insertRow('tenant_entitlements', {
        id: `${tenantId}-ent-ai`, tenant_id: tenantId,
        feature: 'ai_customer_service', enabled: withAi ? 1 : 0,
        note: withAi ? '演示店:AI 全开' : '演示店:无 AI 版本',
        updated_by: 'demo-seed', created_at: now, updated_at: now
      })
    }

    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  const after = countFor(tenantId)
  console.log(`[seed] ${tenantId} 完成,共 ${after.total} 行:`, JSON.stringify(after.per))
}

// ══════════════ 入口 ══════════════
const CONFIGS = {
  'demo-ai': {
    tenantId: 'demo-ai', tenantName: '星野美甲(演示·AI版)', storeName: '星野美甲 · 演示店',
    services: SERVICES_AI, techs: TECHS_AI, custCount: 24, withAi: true,
    bossUser: 'demo-ai-boss', staffPrefix: 'demo-ai-staff'
  },
  'demo-basic': {
    tenantId: 'demo-basic', tenantName: '悦容美甲(演示·基础版)', storeName: '悦容美甲 · 演示店',
    services: SERVICES_BASIC, techs: TECHS_BASIC, custCount: 12, withAi: false,
    bossUser: 'demo-basic-boss', staffPrefix: 'demo-basic-staff'
  }
}
// 历史遗留的空壳测试租户,与新演示店重名(都叫"悦容美甲")会让选店列表出现两条,统一清掉。
// 已确认代码/测试零引用。
const LEGACY = ['demo-shop-b']
const targets = val('tenant') ? [val('tenant')] : Object.keys(CONFIGS)

if (flag('list')) {
  for (const t of Object.keys(CONFIGS)) {
    const c = countFor(t)
    console.log(`${t}: ${c.total} 行`, JSON.stringify(c.per))
  }
  process.exit(0)
}
if (flag('destroy') || flag('reset')) {
  for (const t of targets) destroy(t, true)
  if (!val('tenant')) for (const t of LEGACY) destroy(t, true)
}
if (flag('reset')) {
  for (const t of targets) seedTenant(CONFIGS[t])
  console.log('\n登录信息(密码统一 demo1234):')
  console.log('  AI 版   老板 demo-ai-boss    员工 demo-ai-staff1 / demo-ai-staff2')
  console.log('  基础版  老板 demo-basic-boss  员工 demo-basic-staff1')
  console.log('顾客端看演示店:wx.setStorageSync("lucky_tenant","demo-ai") 或走选店隐藏入口')
}
if (!flag('list') && !flag('destroy') && !flag('reset')) {
  console.log('用法:--list | --reset | --destroy [--tenant=demo-ai] [--db=path]')
}
