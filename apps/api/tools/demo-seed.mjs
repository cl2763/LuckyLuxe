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

function destroy(tenantId, apply) {
  if (!tenantId.startsWith('demo-')) throw new Error(`拒绝:${tenantId} 不是演示租户(必须 demo- 开头)`)
  const before = countFor(tenantId)
  console.log(`\n[destroy] ${tenantId} 命中 ${before.total} 行:`, JSON.stringify(before.per))
  if (!apply) { console.log('[destroy] dry-run,未写库'); return }
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const t of tenantTables()) db.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).run(tenantId)
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

    // 顾客
    const custIds = []
    for (let i = 0; i < custCount; i += 1) {
      const id = `${tenantId}-cust-${i + 1}`
      const name = `${SURNAMES[i % SURNAMES.length]}${GIVEN[i % GIVEN.length]}`
      const spend = [0, 18800, 52000, 128000, 268000, 51000][i % 6]
      insertRow('users', {
        id, tenant_id: tenantId, display_name: name, name,
        phone: `1380000${String(1000 + i).slice(-4)}`,
        email: `demo${i + 1}@example.invalid`,
        total_spend_cents: spend,
        member_tier: spend >= 250000 ? 'diamond' : spend >= 120000 ? 'platinum' : spend >= 50000 ? 'gold' : 'silver',
        stored_value_balance_cents: i % 5 === 0 ? 30000 : 0,
        created_at: iso(new Date(Date.now() - (200 - i * 5) * 86400000)), updated_at: now
      })
      custIds.push({ id, name })
    }

    // 预约:过去 6 周已完成 + 今天台面(三种状态)+ 未来一周已确认
    const mkBooking = (dateStr, hhmm, ci, si, ti, status) => {
      const id = uid(`${tenantId}-bk`)
      const svc = svcIds[si % svcIds.length]
      const start = at(dateStr, hhmm)
      const userId = custIds[ci % custIds.length].id
      const techId = techIds[ti % techIds.length].id
      insertRow('bookings', {
        id, tenant_id: tenantId, store_id: storeId, user_id: userId,
        service_id: svc.id, technician_id: techId, status,
        appointment_start: start, appointment_end: plusMin(start, svc.dur),
        service_price_cents: svc.price, total_price_cents: svc.price,
        total_duration_min: svc.dur, deposit_cents: 0,
        public_code: `D${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        completed_at: status === 'COMPLETED' ? plusMin(start, svc.dur) : undefined,
        created_at: iso(new Date(new Date(start).getTime() - 3 * 86400000)), updated_at: now
      })
      return { id, svc, start, userId, techId }
    }
    const done = []
    let k = 0
    for (let w = 6; w >= 1; w -= 1) {
      for (let d = 0; d < 4; d += 1) {
        const day = dayOffset(-(w * 7) + d)
        const hh = ['10:30', '13:00', '15:30', '17:00'][d]
        done.push(mkBooking(day, hh, k, k, k, 'COMPLETED')); k += 1
      }
    }
    const today = storeToday()
    const todays = [
      mkBooking(today, '10:00', k + 1, 0, 0, 'COMPLETED'),
      mkBooking(today, '11:30', k + 2, 1, 1, 'CONFIRMED'),
      mkBooking(today, '14:00', k + 3, 2, 0, 'CONFIRMED'),
      mkBooking(today, '16:30', k + 4, 3, 1, 'CONFIRMED')
    ]
    done.push(todays[0])
    for (let d = 1; d <= 6; d += 1) {
      mkBooking(dayOffset(d), d % 2 ? '11:00' : '15:00', k + 10 + d, d, d, 'CONFIRMED')
    }

    // 财务账本:每笔完成单记一条收入 + 每周若干支出
    const mkTxn = (type, category, cents, occurredAt, note, tags) => {
      insertRow('finance_transactions', {
        id: uid(`${tenantId}-txn`), tenant_id: tenantId, type, category,
        amount_cents: cents, occurred_at: occurredAt, note,
        source: 'demo', tags: tags || '', created_at: occurredAt, created_by: 'demo-seed'
      }, false)
    }
    done.forEach((b) => mkTxn('income', '服务收入', b.svc.price, b.start, `${b.svc.name} 完成`, b.techId))
    for (let w = 6; w >= 0; w -= 1) {
      mkTxn('expense', '材料', 38000 + w * 1200, at(dayOffset(-(w * 7) + 1), '18:00'), '甲油胶/耗材采购')
      if (w % 2 === 0) mkTxn('expense', '房租', 260000, at(dayOffset(-(w * 7)), '09:00'), '门店租金')
    }

    // 服务小记 + 结构化画像
    if (hasTable('service_notes')) {
      done.slice(0, 18).forEach((b, i) => {
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
