/* 本机自查数据补齐(2026-08-09 队首指令八项)。
   目的:两店每个页面都有东西可看 —— 待分配单、未日结黄条、冲卡列、薪资方案、业绩目标三态、
   员工账号、AI 话术模板(含一个「未配置」空态)。

   纪律:
   - 只跑本机(默认 127.0.0.1:4128),**不碰生产**;跑之前会检查地址。
   - 幂等:每一项都先查后写,重跑只会打印「已有,跳过」。
   - 除了「把充值落在 8 月 8 日」这一处,全部走正规 API。
     储值台账有「只追加」触发器(不能 UPDATE 改日期),而充值接口不收自定义日期,
     所以那两笔是按 insertStoredValueTransaction 的同一套字段**直接追加**进去的 —— 追加不违反台账纪律。
   - 员工账号初始密码写 handoff/本地自查账号.txt(已在 .gitignore 里),不进 git、不打印全文。

   用法:node tools/seed-selfcheck-data.mjs
*/
import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const BASE = process.env.SEED_BASE_URL || 'http://127.0.0.1:4128'
if (!/127\.0\.0\.1|localhost/.test(BASE)) throw new Error('这个脚本只给本机沙盘用,不要指向生产。')
const DB_PATH = join(ROOT, 'apps/api/local-data/lucky-luxe.sqlite')

const envLine = readFileSync(join(ROOT, 'apps/api/.env'), 'utf8').split('\n').find((l) => l.startsWith('OWNER_DEMO_TOKEN='))
const TOKEN = envLine.slice('OWNER_DEMO_TOKEN='.length).trim().replace(/^["']|["']$/g, '')

async function api(tenantId, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tenantId, ...(options.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data).slice(0, 260)}`)
  return data
}
// 顾客签署页不需要登录,单独一个不带 admin 头的请求
async function pub(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data).slice(0, 260)}`)
  return data
}

const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
const log = (...a) => console.log(' ', ...a)

const STORES = [
  {
    tenantId: 'lucky-luxe',
    label: '旗舰店 Lucky Luxe',
    // 薪资方案本批不动旗舰店(指令第 3 条:只配 Jie'Nail)
    salaryPlans: null,
    // 员工账号:指令点名 avalin
    staffTechNames: ['Ava Lin'],
    money: (n) => `CAD $${n}`
  },
  {
    tenantId: 'jics-nail',
    label: "Jie'Nail 小婕",
    salaryPlans: [
      // 阶段(whole)与阶梯(progressive)混配 + 首充/续卡比例 + 自定义卡提成行,全部标 demo
      { name: '小婕', template: 'base_ladder', ladderMode: 'progressive', baseSalaryCents: 300000, handworkFeeCents: 2000,
        ladder: [{ minCents: 0, maxCents: 800000, pct: 10 }, { minCents: 800000, maxCents: 1500000, pct: 15 }, { minCents: 1500000, maxCents: null, pct: 20 }],
        firstRechargePct: 8, renewRechargePct: 4, customCommissions: [{ name: '次卡提成(demo)', pct: 3 }] },
      { name: '鹤辰', template: 'base_ladder', ladderMode: 'whole', baseSalaryCents: 250000, handworkFeeCents: 1500,
        ladder: [{ minCents: 0, maxCents: 600000, pct: 8 }, { minCents: 600000, maxCents: null, pct: 12 }],
        firstRechargePct: 6, renewRechargePct: 3, customCommissions: [{ name: '疗程卡提成(demo)', pct: 2 }] },
      { name: '苏苏', template: 'base_flat', baseSalaryCents: 200000, flatPct: 12,
        firstRechargePct: 5, renewRechargePct: 2, customCommissions: [] },
      { name: '翠花', template: 'base_ladder', ladderMode: 'whole', baseSalaryCents: 220000, handworkFeeCents: 1000,
        ladder: [{ minCents: 0, maxCents: 500000, pct: 7 }, { minCents: 500000, maxCents: null, pct: 11 }],
        firstRechargePct: 5, renewRechargePct: 2.5, customCommissions: [{ name: '美睫卡提成(demo)', pct: 4 }] }
    ],
    staffTechNames: ['小婕', '苏苏'],
    money: (n) => `¥${n}`
  }
]

/* Jie'Nail 的话术用它自己已入库的原文改写(价格三档 / 足部加收 / 免卸甲 / 单指补),
   旗舰店沿用系统默认那几条,只补一条第二模板证明「一个场景可以放多条」。 */
const JIC_TEMPLATES = [
  { scene: 'pre_sale', title: '价格三档说明', content: '我们每个项目有三个价:原价、分享价(分享到朋友圈/小红书可享)、会员价(充值成为会员后享)。护理类还有疗程价,按次数打包更划算。' },
  { scene: 'pre_sale', title: '足部加收说明', content: '足部项目在最终金额上统一加 ¥100(任何价格档都一样加),款式价按你选的档位走。' },
  { scene: 'booking_confirmed_invite', title: '预约确认', content: '{customerName}你好,你的预约已确认:{bookingTime},{storeName}({storeAddress})。到店前有任何变动随时找我~' },
  { scene: 'arrival_reminder', title: '到店提醒', content: '{customerName}你好,明天 {bookingTime} 的预约记得来哦,{storeAddress}。需要改期提前说一声就行。' },
  { scene: 'in_service', title: '卸甲说明', content: '本单继续做甲的,可用「本店制作免卸甲」这一项免收;单纯来卸的按卸甲价目表收费,具体以技师现场确认为准。' },
  { scene: 'post_sale', title: '断甲单指补', content: '断了一根可以单独补:单指价按该单所用价格档的延长类项目价的 10% 每指算;纤维补甲、水晶甲矫正有固定单指价。' }
]

const report = []
const ACCOUNT_LINES = []

for (const store of STORES) {
  const { tenantId, label } = store
  console.log(`\n===== ${label}(${tenantId}) =====`)
  const row = { store: label }

  // ---------- 基础信息 ----------
  const techs = (await api(tenantId, '/admin/technicians?roster=1')).technicians.filter((t) => t.is_active !== 0)
  const techByName = {}
  for (const t of techs) techByName[t.name] = t
  const items = (await api(tenantId, '/admin/pricing/items')).items.filter((i) => i.isActive !== false && (i.itemKind || 'main') === 'main')
  const today = (await api(tenantId, '/admin/daily-close')).dailyClose.date
  const month = today.slice(0, 7)
  const customers = (await api(tenantId, '/admin/customers')).customers
  const mine = new Set(getTenantUserIds(tenantId))
  const local = customers.filter((c) => mine.has(c.id))

  // ---------- ② 08-08 两笔线下充值(首充 + 续充,各归属技师促成) ----------
  const RECHARGE_DAY = '2026-08-08'
  const already = countRecharges(tenantId, RECHARGE_DAY, '自查演示')
  if (already >= 2) {
    log(`② 充值:${RECHARGE_DAY} 已有 ${already} 笔自查演示充值,跳过`)
  } else {
    // 优先挑演示顾客(小红/momo),别把充值记到 asset-test 这种历史测试档案上
    const preferred = local.filter((c) => /小红|momo/i.test(c.displayName || ''))
    const target = preferred.find((c) => rechargeCountOf(tenantId, c.id) === 0)
      || local.find((c) => rechargeCountOf(tenantId, c.id) === 0)
      || preferred[0] || local[0]
    if (!target) throw new Error('本店没有可用顾客,先铺顾客档案')
    const t1 = techs[0]
    const t2 = techs[1] || techs[0]
    // 同一位顾客当天两笔:第一笔就是他在本店的首充,第二笔自然算续充
    appendRecharge({ tenantId, userId: target.id, amountCents: 100000, technicianId: t1.id, at: `${RECHARGE_DAY}T10:20:00.000Z`, note: `首充(自查演示)· 经手 ${t1.name}` })
    appendRecharge({ tenantId, userId: target.id, amountCents: 50000, technicianId: t2.id, at: `${RECHARGE_DAY}T15:40:00.000Z`, note: `续充(自查演示)· 经手 ${t2.name}` })
    log(`② 充值:${target.displayName} 首充 ${store.money(1000)}(${t1.name})+ 续充 ${store.money(500)}(${t2.name})`)
    // 08-08 已经日结确认过,冲卡是快照字段 —— 重开再确认一次,快照才会带上这两笔(顺带留一条重开痕迹)
    const close = await api(tenantId, `/admin/daily-close?date=${RECHARGE_DAY}`)
    if (close.dailyClose.status === 'confirmed') {
      await api(tenantId, '/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: RECHARGE_DAY, reason: '补录当日两笔充值,重算冲卡(自查数据补齐)' }) })
      await api(tenantId, '/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: RECHARGE_DAY }) })
      log(`   ${RECHARGE_DAY} 日结已重开并重新确认(冲卡快照已刷新,重开留痕可见)`)
    }
  }
  row.recharge = `${RECHARGE_DAY} 首充+续充各 1 笔`

  // ---------- ① 2 张已签未分配结算单(1 张双技师)+ 今天留着不日结 ----------
  const todayClose = await api(tenantId, `/admin/daily-close?date=${today}`)
  const pendingNow = todayClose.dailyClose.settlements.length
  if (pendingNow >= 2) {
    log(`① 今日结算单:已有 ${pendingNow} 张,跳过`)
  } else {
    if (todayClose.dailyClose.status === 'confirmed') {
      await api(tenantId, '/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: today, reason: '补自查演示单,今天留着不日结(自查数据补齐)' }) })
      log(`   ${today} 日结已重开(留一天未日结,给工资试算的黄条用)`)
    }
    const svc = items[0]
    const svc2 = items[1] || items[0]
    const buyer = local[0]
    const buyer2 = local[1] || local[0]
    // 双技师单 → 进「待分配」列表;单技师单 → 业绩直接归他,不占待分配位
    const g1 = await api(tenantId, '/admin/settlements', {
      method: 'POST',
      body: JSON.stringify({
        cardOwnerUserId: buyer.id,
        settlements: [{
          tierKey: 'list', items: [{ serviceId: svc.id }],
          technicians: [{ technicianId: techs[0].id, role: 'main', itemNos: [1] }, { technicianId: (techs[1] || techs[0]).id, role: 'assist', itemNos: [1] }]
        }]
      })
    })
    const g2 = await api(tenantId, '/admin/settlements', {
      method: 'POST',
      body: JSON.stringify({
        cardOwnerUserId: buyer2.id,
        settlements: [{ tierKey: 'list', items: [{ serviceId: svc2.id }], technicians: [{ technicianId: (techs[2] || techs[0]).id, role: 'main', itemNos: [1] }] }]
      })
    })
    for (const sheet of [g1.settlements[0], g2.settlements[0]]) {
      await pub(`/settlements/${sheet.code}/sign`, {
        method: 'POST',
        body: JSON.stringify({ disclaimerAccepted: true, signature: '自查演示', strokes: [[{ x: 12, y: 60 }, { x: 45, y: 22 }, { x: 78, y: 66 }]] })
      })
    }
    log(`① 今日两张已签单:${g1.settlements[0].code}(双技师·待分配)、${g2.settlements[0].code}(单技师)`)
  }
  const closeAfter = await api(tenantId, `/admin/daily-close?date=${today}`)
  row.today = `${today} · ${closeAfter.dailyClose.status} · 已签 ${closeAfter.dailyClose.settlements.length} 单 · 待分配 ${closeAfter.dailyClose.pendingAllocation.length}`

  // ---------- ③ 薪资方案(只 Jie'Nail) ----------
  if (store.salaryPlans) {
    let wrote = 0
    for (const plan of store.salaryPlans) {
      const tech = techByName[plan.name]
      if (!tech) { log(`③ 薪资方案:找不到技师 ${plan.name},跳过`); continue }
      const cur = await api(tenantId, `/admin/salary-plans/effective?technicianId=${encodeURIComponent(tech.id)}`)
      if (cur.source === 'custom') continue
      await api(tenantId, '/admin/salary-plans', { method: 'PUT', body: JSON.stringify({ technicianId: tech.id, ...plan, name: undefined }) })
      wrote += 1
    }
    log(`③ 薪资方案:${wrote ? `新配 ${wrote} 位` : '四位都已有专属方案,跳过'}(阶段/阶梯混配 + 首充续卡 + 自定义卡提成行,均标 demo)`)
    row.salary = `${store.salaryPlans.length} 位技师各一份(demo)`
  } else {
    log('③ 薪资方案:按指令旗舰店不动')
    row.salary = '按指令不动'
  }

  // ---------- ④ 业绩目标三态 ----------
  const existingTargets = (await api(tenantId, `/admin/perf-targets?month=${month}`)).technicians.filter((t) => t.hasTarget)
  if (existingTargets.length >= 2) {
    log(`④ 业绩目标:本月已设 ${existingTargets.length} 位,跳过`)
  } else {
    // 达标一位、进行中一位、第三位不设 —— 三种形态都能在页面上看到
    const perfNow = (await api(tenantId, `/admin/perf-ranking?metric=perf&period=month&date=${month}`)).ranking.ranking
    const top = perfNow[0]
    const second = perfNow[1]
    const targets = []
    if (top) targets.push({ technicianId: top.technicianId, mode: 'total', displayMode: 'total_only', perfTargetCents: Math.max(10000, Math.floor(top.perfCents * 0.6)) })
    if (second) {
      targets.push({
        technicianId: second.technicianId, mode: 'split', displayMode: 'with_split',
        perfTargetCents: Math.max(50000, second.perfCents * 4), cardTargetCents: 100000, orderTarget: 20
      })
    }
    if (targets.length) await api(tenantId, '/admin/perf-targets', { method: 'PUT', body: JSON.stringify({ month, targets }) })
    log(`④ 业绩目标:${top ? `${top.name} 已达标(仅总进度)` : ''}${second ? ` · ${second.name} 进行中(含分项)` : ''} · 其余不设`)
  }
  const tg = (await api(tenantId, `/admin/perf-targets?month=${month}`)).technicians
  row.targets = `设了 ${tg.filter((t) => t.hasTarget).length} 位 / 共 ${tg.length} 位(其余「未设不显示」)`

  // ---------- ⑤ 员工账号 ----------
  const accounts = (await api(tenantId, '/admin/staff-accounts')).accounts
  const created = []
  for (const name of store.staffTechNames) {
    const tech = techByName[name]
    if (!tech) { log(`⑤ 员工账号:找不到技师 ${name},跳过`); continue }
    const has = accounts.find((a) => a.technicianId === tech.id)
    if (has) {
      const reset = await api(tenantId, `/admin/staff-accounts/${has.id}/reset-password`, { method: 'POST' })
      created.push({ name, username: has.username, password: reset.initialPassword })
    } else {
      const made = await api(tenantId, '/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: tech.id }) })
      created.push({ name, username: made.username, password: made.initialPassword })
    }
  }
  log(`⑤ 员工账号:${created.map((c) => `${c.name}→${c.username}`).join('、')}(密码写进 handoff/本地自查账号.txt)`)
  row.accounts = created.map((c) => `${c.name}/${c.username}`).join('、')
  ACCOUNT_LINES.push(`## ${label}`, ...created.map((c) => `- ${c.name}:用户名 ${c.username} · 初始密码 ${c.password}(首次登录会强制改密)`), '')

  // ---------- ⑥ AI 话术模板 ----------
  const tplData = await api(tenantId, '/admin/message-templates')   // GET 会先补齐系统默认模板
  let templates = tplData.templates
  if (tenantId === 'jics-nail') {
    for (const t of JIC_TEMPLATES) {
      if (templates.some((x) => x.title === t.title)) continue
      await api(tenantId, '/admin/message-templates', { method: 'POST', body: JSON.stringify({ ...t, variables: (t.content.match(/\{[a-zA-Z]+\}/g) || []) }) })
    }
  } else if (!templates.some((x) => x.title === '到店前一天提醒(第二条)')) {
    await api(tenantId, '/admin/message-templates', {
      method: 'POST',
      body: JSON.stringify({
        scene: 'arrival_reminder', title: '到店前一天提醒(第二条)',
        content: '{customerName}你好,明天 {bookingTime} 见~ {storeName} 在 {storeAddress},到店直接找前台报名字就行。',
        variables: ['{customerName}', '{bookingTime}', '{storeName}', '{storeAddress}']
      })
    })
  }
  // 留一个场景是空的,让「未配置」空态也能看到
  templates = (await api(tenantId, '/admin/message-templates')).templates
  for (const t of templates.filter((x) => x.scene === 'coupon_expiry')) {
    await api(tenantId, `/admin/message-templates/${t.id}`, { method: 'DELETE' })
  }
  templates = (await api(tenantId, '/admin/message-templates')).templates
  const byScene = {}
  for (const t of templates) byScene[t.scene] = (byScene[t.scene] || 0) + 1
  log(`⑥ 话术模板:${templates.length} 条 · 覆盖 ${Object.keys(byScene).length}/6 个场景 · 「优惠券到期」留空(未配置态)`)
  row.templates = `${templates.length} 条 / ${Object.keys(byScene).length} 个场景有,1 个留空`

  // ---------- ⑦ 券(券批已发) ----------
  const grants = (await api(tenantId, '/admin/coupon-grants')).grants
  row.coupons = `发放记录 ${grants.length} 条 · 未使用 ${grants.filter((g) => g.status === 'active').length}`

  // ---------- 清点 ----------
  const dc0808 = (await api(tenantId, '/admin/daily-close?date=2026-08-08')).dailyClose
  row.day0808 = `${dc0808.status} · ${dc0808.orderCount} 单 · ${dc0808.technicians.map((t) => `${t.name} ${t.perfCents / 100}(冲卡 ${t.rechargeTotalCents / 100})`).join(' / ')}`
  row.techs = `${techs.length} 位在岗`
  report.push(row)
}

writeFileSync(join(ROOT, 'handoff/本地自查账号.txt'),
  `# 本地自查用员工账号(2026-08-09 生成,仅本机沙盘 ${BASE})\n# 这个文件在 .gitignore 里,不会进 git。生产环境没有这些账号。\n\n${ACCOUNT_LINES.join('\n')}`, 'utf8')

console.log('\n\n===== 数据清点表 =====')
for (const r of report) {
  console.log(`\n【${r.store}】`)
  console.log(`  技师        ${r.techs}`)
  console.log(`  今天        ${r.today}`)
  console.log(`  08-08 日结  ${r.day0808}`)
  console.log(`  充值        ${r.recharge}`)
  console.log(`  薪资方案    ${r.salary}`)
  console.log(`  业绩目标    ${r.targets}`)
  console.log(`  员工账号    ${r.accounts}`)
  console.log(`  话术模板    ${r.templates}`)
  console.log(`  优惠券      ${r.coupons}`)
}
console.log('\n员工账号初始密码已写入 handoff/本地自查账号.txt(未进 git)。')

/* ===== 直连库的三个小工具:只读查询 + 储值台账「追加」 ===== */
function withDb(fn) {
  const db = new DatabaseSync(DB_PATH)
  try { return fn(db) } finally { db.close() }
}
function getTenantUserIds(tenantId) {
  return withDb((db) => db.prepare('SELECT id FROM users WHERE tenant_id = ?').all(tenantId).map((r) => r.id))
}
function rechargeCountOf(tenantId, userId) {
  return withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'recharge'").get(tenantId, userId).n)
}
function countRecharges(tenantId, day, noteLike) {
  return withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM stored_value_transactions WHERE tenant_id = ? AND type = 'recharge' AND substr(created_at,1,10) = ? AND note LIKE ?")
    .get(tenantId, day, `%${noteLike}%`).n)
}
// 台账只追加:这里是 INSERT,不是 UPDATE —— 触发器允许,纪律也允许
function appendRecharge({ tenantId, userId, amountCents, technicianId, at, note }) {
  withDb((db) => db.prepare(`INSERT INTO stored_value_transactions
    (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, technician_id)
    VALUES (?, ?, ?, 'recharge', ?, 'offline', ?, 'selfcheck-seed', ?, ?)`)
    .run(rid('sv'), tenantId, userId, Math.abs(amountCents), note, at, technicianId))
}
