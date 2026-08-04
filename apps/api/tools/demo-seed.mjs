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
  for (const [k, v] of Object.entries(data)) if (names.includes(k) && v !== undefined) row[k] = v
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
      timezone: TZ, currency: 'CAD', business_hours: 'Tue-Sun 10:00-19:00',
      description: '这是有迹的演示门店,数据均为虚构,可随时重置。',
      created_at: now, updated_at: now
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
        id, tenant_id: tenantId, store_id: storeId,
        name_zh: name, name_en: name, name,
        type, category: cat, price_cents: price, price: price / 100,
        duration_min: dur, is_active: 1, sort_order: i + 1,
        suitable_for: fit, description_zh: `${name}:演示用项目说明。`,
        description: `${name}:演示用项目说明。`, pricing_type: 'fixed',
        created_at: now, updated_at: now
      })
    })

    // 技师
    const techIds = []
    techs.forEach(([name, level], i) => {
      const id = `${tenantId}-tech-${i + 1}`
      techIds.push({ id, name })
      insertRow('technicians', {
        id, tenant_id: tenantId, store_id: storeId, name, is_active: 1,
        level, sort_order: i + 1, specialty: i % 2 === 0 ? '美甲' : '美睫',
        created_at: now, updated_at: now
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
      insertRow('users', {
        id, tenant_id: tenantId, display_name: name, name,
        phone: `1380000${String(1000 + i).slice(-4)}`,
        email: `demo${i + 1}@example.invalid`,
        total_spend_cents: profile.spend,
        member_tier: profile.spend >= 250000 ? 'diamond' : profile.spend >= 120000 ? 'platinum' : profile.spend >= 50000 ? 'gold' : 'silver',
        stored_value_balance_cents: kind === 'vip' && i % 2 === 0 ? 88000 : (i % 7 === 0 ? 30000 : 0),
        points: 0,
        created_at: iso(new Date(Date.now() - profile.firstDays * 86400000)), updated_at: now
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
        service_price_cents: svc.price + addonCents, total_price_cents: svc.price + addonCents,
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
    const mkTxn = (type, category, cents, occurredAt, note, tags) => {
      insertRow('finance_transactions', {
        id: uid(`${tenantId}-txn`), tenant_id: tenantId, type, category,
        amount_cents: cents, occurred_at: occurredAt, note,
        source: 'demo', tags: tags || '', created_at: occurredAt, created_by: 'demo-seed'
      }, false)
    }
    done.forEach((b) => mkTxn('income', '服务收入', b.svc.price, b.start, `${b.svc.name} · ${b.cust.name}`, b.techId))
    // 支出:多类目,过去 4 个月每月都有,报表/趋势才好看
    for (let m = 3; m >= 0; m -= 1) {
      const base = -m * 30
      mkTxn('expense', '房租', 260000, at(dayOffset(base - 1), '09:00'), '门店租金')
      mkTxn('expense', '水电', 42000 + m * 1800, at(dayOffset(base - 8), '09:00'), '水电网费')
      mkTxn('expense', '材料', 68000 + m * 5200, at(dayOffset(base - 12), '18:00'), '甲油胶/睫毛耗材采购')
      mkTxn('expense', '材料', 31000 + m * 2400, at(dayOffset(base - 22), '18:00'), '工具与消耗品')
      mkTxn('expense', '推广', 28000, at(dayOffset(base - 16), '11:00'), '小红书/朋友圈推广')
      if (m > 0) mkTxn('expense', '工资', 980000 + m * 20000, at(dayOffset(base - 2), '10:00'), `${m} 月前员工工资发放`)
    }
    // 储值充值也计收入(和储值流水对得上)
    custIds.filter((c) => c.kind === 'vip').slice(0, 4).forEach((c, i) => {
      mkTxn('income', '储值充值', [100000, 300000, 300000, 500000][i], at(dayOffset(-(20 + i * 9)), '15:00'), `${c.name} 储值卡充值`, techIds[i % techIds.length].id)
    })

    // 服务小记 + 结构化画像
    if (hasTable('service_notes')) {
      // 覆盖大部分完成单,但**最近 6 天的完成单一律不写**——这样「服务小记」待办列表里始终有东西可演示
      const cutoff = Date.now() - 6 * 86400000
      done.filter((b, i) => new Date(b.start).getTime() < cutoff && i % 4 !== 3).forEach((b, i) => {
        const structured = {
          styles: [NOTE_STYLES[i % NOTE_STYLES.length]],
          personality: [NOTE_PERSON[i % NOTE_PERSON.length]],
          preferences: [NOTE_PREF[i % NOTE_PREF.length]],
          companions: i % 7 === 0 ? ['和闺蜜一起来'] : [],
          safetyFlags: i % 9 === 0 ? [NOTE_SAFE[i % NOTE_SAFE.length]] : []
        }
        insertRow('service_notes', {
          id: uid(`${tenantId}-note`), tenant_id: tenantId, user_id: b.userId,
          booking_id: b.id, technician_id: b.techId,
          content: `${structured.styles[0]};${structured.personality[0]};${structured.preferences[0]}`,
          structured_json: JSON.stringify(structured),
          created_at: b.start, updated_at: b.start
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
        amount_cents: [100000, 300000, 300000, 500000][i], bonus_cents: [10000, 45000, 45000, 90000][i],
        balance_after_cents: 88000, technician_id: techIds[i % techIds.length].id,
        note: '储值卡充值', created_at: rAt, created_by: 'demo-seed'
      }, false)
      insertRow('stored_value_transactions', {
        id: uid(`${tenantId}-sv`), tenant_id: tenantId, user_id: c.id, type: 'consume',
        amount_cents: -[38800, 45800, 28800, 52800][i], balance_after_cents: 88000,
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
          id: `${tenantId}-kb-${i + 1}`, tenant_id: tenantId, question: q, answer: a,
          kind: 'qa', is_active: 1, sort_order: i + 1, created_at: now, updated_at: now
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
        feature_key: 'ai_customer_service', enabled: withAi ? 1 : 0,
        note: withAi ? '演示店:AI 全开' : '演示店:无 AI 版本',
        created_at: now, updated_at: now
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
