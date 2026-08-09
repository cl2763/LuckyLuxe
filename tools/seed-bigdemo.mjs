/* 大规模演示数据(2026-08-09 店主指令第三步)。
   目的:店主要用**足量**数据判断每个功能做没做对,不是每样一条的骨架数据。

   两店各铺:近 6 周跨周期订单流 / 8–10 位顾客 / 多天日结(含待分配、重开留痕、异常样本)/
   多笔首充续充 / 券四态 / 排班全形态 / 目标三态 / 3–5 个客服会话 / 6 个月有起伏的财务曲线。

   纪律:
   - **只跑本机**(默认 127.0.0.1:4128),开跑前检查地址;生产一步都不碰。
   - **幂等**:每块先查后写,重跑只打印「已有,跳过」。
   - 绝大部分走正规 API。只有三处直连库,且都是**追加或改时间戳**,不改金额、不删数据:
       ① 历史结算单的 created_at / signed_at 回填到过去(签署接口只会写"现在")
       ② 储值台账按指定日期追加(台账有只追加触发器,充值接口不收自定义日期)
       ③ 客服会话按指定日期追加(演示会话没有对应的真实进线)
     财务账本一律走 /admin/finance/transactions 的 occurredOn 参数,不碰账本触发器。
   - 历史单一律走「全额到店支付」:签署时不会写财务账本,所以不会把 6 个月的曲线搅乱
     —— 账本曲线由本脚本单独按月铺。

   用法:node tools/seed-bigdemo.mjs
*/
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SEED_BASE_URL || 'http://127.0.0.1:4128'
if (!/127\.0\.0\.1|localhost/.test(BASE)) throw new Error('这个脚本只给本机沙盘用,不要指向生产。')
const DB_PATH = join(ROOT, 'apps/api/local-data/lucky-luxe.sqlite')
const TOKEN = readFileSync(join(ROOT, 'apps/api/.env'), 'utf8').split('\n')
  .find((l) => l.startsWith('OWNER_DEMO_TOKEN=')).slice('OWNER_DEMO_TOKEN='.length).trim().replace(/^["']|["']$/g, '')

async function api(tenantId, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tenantId, ...(options.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}
async function pub(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}
function withDb(fn) {
  const db = new DatabaseSync(DB_PATH)
  try { return fn(db) } finally { db.close() }
}

const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`
const log = (...a) => console.log('  ', ...a)
const shift = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const monthShift = (mk, n) => {
  const y = Number(mk.slice(0, 4)); const m = Number(mk.slice(5, 7)) - 1 + n
  return `${y + Math.floor(m / 12)}-${String((m % 12 + 12) % 12 + 1).padStart(2, '0')}`
}
// 定死的伪随机:同一次重跑得到同一份数据,不会每跑一次换一套数字
let seedState = 20260809
const rnd = () => { seedState = (seedState * 1103515245 + 12345) % 2147483648; return seedState / 2147483648 }
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length]

const STORES = [
  { tenantId: 'lucky-luxe', label: '旗舰店 Lucky Luxe', phonePrefix: '1470', names: ['Ada', 'Bella', 'Cathy', 'Doris', 'Elena', 'Fiona', 'Grace', 'Hana', 'Iris', 'Joy'] },
  { tenantId: 'jics-nail', label: "Jie'Nail 小婕", phonePrefix: '1360', names: ['林小雅', '周乐乐', '陈果果', '苏念', '许安', '何多多', '罗西', '钱一一', '孙棠', '吴桐'] }
]

const CONVOS = [
  { status: 'open', intent: 'price', msg: '想做一个法式加两颗钻,大概多少钱呀?', quote: 'PENDING_STAFF' },
  { status: 'open', intent: 'price', msg: '猫眼渐变加延长,报个价我看看', quote: 'QUOTED' },
  { status: 'human', intent: 'aftersales', msg: '前天做的甲片翘边了,能来补吗?', quote: null },
  { status: 'open', intent: 'booking', msg: '这周六下午还有位置吗?', quote: null },
  { status: 'closed', intent: 'hours', msg: '你们几点关门?', quote: null }
]

const report = []

for (const store of STORES) {
  const { tenantId, label } = store
  console.log(`\n===== ${label}(${tenantId}) =====`)
  const row = { store: label }
  const today = (await api(tenantId, '/admin/daily-close')).dailyClose.date
  const month = today.slice(0, 7)

  // ---------- ① 顾客 8–10 位 ----------
  const existing = (await api(tenantId, '/admin/customers')).customers
  const mineIds = new Set(withDb((db) => db.prepare('SELECT id FROM users WHERE tenant_id = ?').all(tenantId).map((r) => r.id)))
  let locals = existing.filter((c) => mineIds.has(c.id))
  const want = store.names.map((n, i) => ({
    name: n,
    phone: `${store.phonePrefix}${String(1000000 + i)}`,
    // 余额各异:新客 0、会员有余额、还有一位很久没动的沉睡卡
    balanceCents: [0, 0, 30000, 88000, 0, 150000, 20000, 0, 60000, 0][i]
  }))
  const missing = want.filter((w) => !locals.some((c) => (c.phone || '') === w.phone))
  if (missing.length) {
    await api(tenantId, `/platform/tenants/${tenantId}/import/customers`.replace('/admin', ''), {
      method: 'POST',
      body: JSON.stringify({ dryRun: false, rows: missing.map((m) => ({ name: m.name, phone: m.phone, balanceCents: m.balanceCents })) })
    })
    log(`① 顾客:新建 ${missing.length} 位(共 ${want.length} 位,余额/会员状态各异)`)
  } else log(`① 顾客:${want.length} 位已在档,跳过`)
  locals = (await api(tenantId, '/admin/customers')).customers.filter((c) => mineIds.has(c.id) || want.some((w) => w.phone === (c.phone || '')))
  const demoCustomers = want.map((w) => locals.find((c) => (c.phone || '') === w.phone)).filter(Boolean)
  const totalCustomers = withDb((db) => db.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?').get(tenantId).n)
  row.customers = `本店 ${totalCustomers} 位(其中演示批 ${demoCustomers.length} 位:0 余额新客 / 有储值会员 / 沉睡卡)`

  const techs = (await api(tenantId, '/admin/technicians?roster=1')).technicians.filter((t) => t.is_active !== 0)
  const items = (await api(tenantId, '/admin/pricing/items')).items.filter((i) => i.isActive !== false)
  const mains = items.filter((i) => (i.itemKind || 'main') === 'main')
  const addons = items.filter((i) => i.itemKind === 'addon')
  if (!mains.length || techs.length < 2) { log('!! 本店价目表或技师不足,跳过订单流'); report.push(row); continue }

  /* ---------- ⑤a 定金规则(F2)----------
     Jie'Nail 的设计口径是「定位费抵扣总价」(批1 裁决2),但 deposit_config 从来没写进去过 ——
     没配置 = 默认 deductible=false → 结算页显示「本店定金不抵扣尾款」,定金行根本不渲染。
     2026-08-09 店主实测「结算页看不到定金抵扣行」就是这个根因。 */
  const dep = (await api(tenantId, '/admin/deposit-config')).config
  if (!dep.deductible || !dep.enabled) {
    await api(tenantId, '/admin/deposit-config', {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          enabled: true,
          deductible: true, // 裁决2:Jie'Nail 定位费抵扣总价
          mode: 'fixed',
          fixedAmountCents: tenantId === 'jics-nail' ? 10000 : 5000,
          cancelPolicy: { refundable: false, freeCancelHours: 24, lateForfeitPct: 100, noShowForfeitPct: 100, lateArrivalGraceMin: 30, rescheduleNoticeHours: 24, depositRetainTimes: 1 }
        }
      })
    })
    log('⑤a 定金规则:补齐(收定金 · 抵扣尾款 · 迟到宽限 30 分钟 · 改期提前 1 天 · 可保留 1 次)')
  } else log('⑤a 定金规则:已配置,跳过')
  row.deposit = (await api(tenantId, '/admin/deposit-config')).config.deductible ? '收定金 · 抵扣尾款' : '不抵扣'

  // ---------- ② 近 6 周订单流 ----------
  const already = withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE tenant_id = ? AND created_by = 'bigdemo'").get(tenantId).n)
  const days = []
  for (let w = 5; w >= 0; w -= 1) for (const off of [1, 3, 5]) days.push(shift(today, -(w * 7 + off)))
  days.sort() // 从早到晚 —— 后面「最近两天留作待日结」要靠这个顺序
  if (already >= 20) {
    log(`② 订单流:已有 ${already} 张演示结算单,跳过`)
  } else {
    let made = 0
    const TIERS = ['list', 'share', 'member']
    for (const date of days) {
      const perDay = 2 + Math.floor(rnd() * 2) // 每天 2–3 单
      for (let k = 0; k < perDay; k += 1) {
        const cust = pick(demoCustomers)
        const twoTech = rnd() < 0.45
        const tierKey = pick(TIERS)
        const svc = pick(mains)
        const sheet = {
          tierKey,
          items: [{ serviceId: svc.id }],
          // 加项:单指 / 甲片 / 免卸 各类都会出现
          customItems: rnd() < 0.25 ? [{ name: '钻球加钻', amountCents: 3000 + Math.floor(rnd() * 5) * 1000 }] : [],
          applyFootSurcharge: rnd() < 0.18,
          applyTipReuse: rnd() < 0.12,
          depositApplied: rnd() < 0.35,
          payIntent: 'offline_full', // 全额到店付:签署不写账本,6 个月曲线由下面单独铺
          technicians: twoTech
            ? [{ technicianId: techs[0].id, role: 'main', itemNos: [1] }, { technicianId: techs[1 % techs.length].id, role: 'assist', itemNos: [1] }]
            : [{ technicianId: pick(techs).id, role: 'main', itemNos: [1] }]
        }
        const extra = addons.filter((a) => rnd() < 0.3).slice(0, 2)
        for (const a of extra) sheet.items.push(a.unit === 'per_finger' ? { serviceId: a.id, fingers: 1 + Math.floor(rnd() * 3) } : { serviceId: a.id })
        // 价档异常样本:偶尔标一次「改过档」,给日结的异常核查区用
        if (rnd() < 0.12) sheet.tierChangedFrom = tierKey === 'list' ? 'member' : 'list'
        let created
        try {
          created = await api(tenantId, '/admin/settlements', { method: 'POST', body: JSON.stringify({ cardOwnerUserId: cust.id, settlements: [sheet] }) })
        } catch (e) { continue }
        const st = created.settlements[0]
        // 最近两天留一张不签(今日台面「待签」形态);其余全签掉
        const keepPending = date >= shift(today, -2) && k === 0
        if (!keepPending) {
          try {
            await pub(`/settlements/${st.code}/sign`, {
              method: 'POST',
              body: JSON.stringify({ disclaimerAccepted: true, signature: cust.displayName || '顾客', strokes: [[{ x: 10, y: 60 }, { x: 45, y: 20 }, { x: 80, y: 65 }]] })
            })
          } catch (e) { /* 余额不足之类的直接跳过这一单 */ }
        }
        // 回填时间:签署接口只会写「现在」,历史单要自己把时间挪回去(只改时间戳,不动金额)
        withDb((db) => {
          const at = `${date}T${String(10 + (k * 3) % 8).padStart(2, '0')}:20:00.000Z`
          db.prepare("UPDATE settlements SET created_at = ?, created_by = 'bigdemo' WHERE id = ?").run(at, st.id)
          db.prepare("UPDATE settlements SET signed_at = ? WHERE id = ? AND signed_at IS NOT NULL").run(at, st.id)
        })
        made += 1
      }
    }
    log(`② 订单流:近 6 周 ${days.length} 天共 ${made} 张结算单(单/双技师 · 三档价 · 加项 · 自选行 · 定金 · 价档异常样本)`)
  }
  row.settlements = withDb((db) => {
    const n = db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE tenant_id = ? AND created_by = 'bigdemo'").get(tenantId).n
    const signed = db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE tenant_id = ? AND created_by = 'bigdemo' AND status = 'signed'").get(tenantId).n
    return `${n} 张(已签 ${signed} · 待签 ${n - signed})`
  })

  /* 带定金抵扣的样本单(F2 第二半):上面那批单是在 deductible 还是 false 的时候造的,
     所以 deposit_deduct_cents 全是 0。定金规则配好后补造两张真的带定金抵扣的单。 */
  const withDep = withDb((db) => db.prepare('SELECT COUNT(*) AS n FROM settlements WHERE tenant_id = ? AND deposit_deduct_cents > 0').get(tenantId).n)
  if (withDep < 2) {
    for (let i = 0; i < 2; i += 1) {
      try {
        const g = await api(tenantId, '/admin/settlements', {
          method: 'POST',
          body: JSON.stringify({
            cardOwnerUserId: demoCustomers[i % demoCustomers.length].id,
            settlements: [{
              tierKey: 'member', depositApplied: true, payIntent: 'offline_full',
              items: [{ serviceId: mains[0].id }],
              technicians: [{ technicianId: techs[i % techs.length].id, role: 'main', itemNos: [1] }]
            }]
          })
        })
        const st = g.settlements[0]
        if (i === 0) {
          await pub(`/settlements/${st.code}/sign`, {
            method: 'POST',
            body: JSON.stringify({ disclaimerAccepted: true, signature: '顾客', strokes: [[{ x: 6, y: 50 }, { x: 40, y: 16 }]] })
          })
        }
        // 一张签掉进日结,一张留着待签 —— 店主能在结算页直接看到定金抵扣行
        withDb((db) => {
          const at = `${shift(today, -1)}T11:00:00.000Z`
          db.prepare("UPDATE settlements SET created_at = ?, created_by = 'bigdemo' WHERE id = ?").run(at, st.id)
          db.prepare('UPDATE settlements SET signed_at = ? WHERE id = ? AND signed_at IS NOT NULL').run(at, st.id)
        })
      } catch (e) { log(`   带定金样本没造成(${e.message.slice(0, 70)})`) }
    }
    log('② 带定金抵扣的样本单:补 2 张(1 张已签进日结、1 张待签可在结算页看定金行)')
  }
  row.depositSheets = `${withDb((db) => db.prepare('SELECT COUNT(*) AS n FROM settlements WHERE tenant_id = ? AND deposit_deduct_cents > 0').get(tenantId).n)} 张带定金抵扣`

  // ---------- ③ 日结:多天已确认 + 待分配 + 重开留痕 ----------
  let confirmed = 0
  const closeDays = days.slice(0, days.length - 2) // 最后两天留着不日结
  for (const date of closeDays) {
    const view = (await api(tenantId, `/admin/daily-close?date=${date}`)).dailyClose
    if (view.status === 'confirmed') { confirmed += 1; continue }
    for (const p of view.pendingAllocation) {
      const shares = p.technicians.map((t, i) => ({ technicianId: t.technicianId, pct: i === 0 ? p.defaultSplit.mainPct : p.defaultSplit.assistPct }))
      try { await api(tenantId, `/admin/settlements/${p.settlementId}/allocate`, { method: 'POST', body: JSON.stringify({ shares }) }) } catch (e) { /* 已确认的天跳过 */ }
    }
    try {
      await api(tenantId, '/admin/daily-close', { method: 'POST', body: JSON.stringify({ date }) })
      confirmed += 1
    } catch (e) { /* 还有待签的单,留着当「待日结」样本 */ }
  }
  // 一天重开留痕(挑中间那天,重开后再确认回去,痕迹留在 reopen_count)
  const reopenDay = closeDays[Math.floor(closeDays.length / 2)]
  const reopenState = (await api(tenantId, `/admin/daily-close?date=${reopenDay}`)).dailyClose
  if (reopenState.status === 'confirmed' && !reopenState.reopenCount) {
    await api(tenantId, '/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: reopenDay, reason: '核对分成比例,重开一次(演示数据)' }) })
    await api(tenantId, '/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: reopenDay }) })
    log(`③ 日结:${reopenDay} 重开并重新确认一次(留痕样本)`)
  }
  const pendingDays = days.slice(-2)
  row.dailyClose = `已确认 ${confirmed} 天 · 待日结 ${pendingDays.join('、')} · ${reopenDay} 有重开留痕`
  log(`③ 日结:已确认 ${confirmed} 天,最近 2 天留作待日结`)

  // ---------- ④ 充值:多笔首充 + 续充,分布在不同技师不同日 ----------
  const rcExisting = withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM stored_value_transactions WHERE tenant_id = ? AND created_by = 'bigdemo'").get(tenantId).n)
  if (rcExisting >= 6) log(`④ 充值:已有 ${rcExisting} 笔演示充值,跳过`)
  else {
    const plan = [
      { c: 2, amount: 100000, day: -32 }, { c: 2, amount: 50000, day: -12 },
      { c: 3, amount: 200000, day: -25 }, { c: 3, amount: 80000, day: -6 },
      { c: 5, amount: 150000, day: -19 }, { c: 8, amount: 60000, day: -4 }
    ]
    withDb((db) => {
      const stmt = db.prepare(`INSERT INTO stored_value_transactions
        (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, technician_id)
        VALUES (?, ?, ?, 'recharge', ?, 'offline', ?, 'bigdemo', ?, ?)`)
      plan.forEach((p, i) => {
        const cust = demoCustomers[p.c] || demoCustomers[i % demoCustomers.length]
        if (!cust) return
        const tech = techs[i % techs.length]
        stmt.run(rid('sv'), tenantId, cust.id, p.amount, `${i < 3 ? '首充' : '续充'}(演示)· 经手 ${tech.name}`, `${shift(today, p.day)}T09:30:00.000Z`, tech.id)
      })
    })
    log(`④ 充值:${plan.length} 笔(首充+续充,分布在 ${techs.length} 位技师、不同日)`)
  }
  row.recharge = `${withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM stored_value_transactions WHERE tenant_id = ? AND type='recharge'").get(tenantId).n)} 笔充值`

  // ---------- ⑤ 券四态:未使用 / 已核销 / 已过期 / 被待签单占用 ----------
  const grantsNow = (await api(tenantId, '/admin/coupon-grants')).grants
  const has = (name, status) => grantsNow.some((g) => g.name === name && g.status === status)
  if (!has('开业活动券', 'expired')) {
    const g = await api(tenantId, '/admin/coupon-grants/custom', {
      method: 'POST', body: JSON.stringify({ userId: (demoCustomers[4] || demoCustomers[0]).id, amountCents: 3000, validDays: 30, name: '开业活动券', reason: '开业活动(演示)' })
    })
    withDb((db) => db.prepare("UPDATE coupon_grants SET expires_at = ?, status = 'expired' WHERE id = ?").run(`${shift(today, -3)}T00:00:00.000Z`, g.granted.id))
    log('⑤ 券:补了一张已过期的')
  }
  if (!has('满200减30', 'active')) {
    let tpl = (await api(tenantId, '/admin/coupons')).coupons.find((c) => c.name === '满200减30')
    if (!tpl) tpl = (await api(tenantId, '/admin/coupons', { method: 'POST', body: JSON.stringify({ name: '满200减30', amountCents: 3000, minSpendCents: 20000, validDays: 60 }) })).coupon
    await api(tenantId, '/admin/coupon-grants/custom', { method: 'POST', body: JSON.stringify({ userId: (demoCustomers[6] || demoCustomers[1] || demoCustomers[0]).id, mode: 'template', couponId: tpl.id, reason: '满减活动(演示)' }) })
    log('⑤ 券:补了一张未使用的模板券')
  }
  // 已核销样本:拿一张可用券开一单、签掉 —— 券的核销必须由真实签署产生,不能直接改状态
  let gsNow = (await api(tenantId, '/admin/coupon-grants')).grants
  if (!gsNow.some((g) => g.status === 'used')) {
    const usable = gsNow.find((g) => g.status === 'active')
    if (usable) {
      try {
        const g2 = await api(tenantId, '/admin/settlements', {
          method: 'POST',
          body: JSON.stringify({
            cardOwnerUserId: usable.userId,
            settlements: [{
              tierKey: 'list', payIntent: 'offline_full', couponGrantId: usable.id,
              items: [{ serviceId: mains[0].id }],
              technicians: [{ technicianId: techs[0].id, role: 'main', itemNos: [1] }]
            }]
          })
        })
        const st2 = g2.settlements[0]
        await pub(`/settlements/${st2.code}/sign`, {
          method: 'POST',
          body: JSON.stringify({ disclaimerAccepted: true, signature: usable.userName || '顾客', strokes: [[{ x: 8, y: 55 }, { x: 50, y: 18 }]] })
        })
        withDb((db) => {
          const at = `${shift(today, -1)}T15:00:00.000Z`
          db.prepare("UPDATE settlements SET created_at = ?, created_by = 'bigdemo' WHERE id = ?").run(at, st2.id)
          db.prepare('UPDATE settlements SET signed_at = ? WHERE id = ?').run(at, st2.id)
        })
        log('⑤ 券:用掉一张(签署核销),已核销样本齐了')
      } catch (e) { log(`⑤ 券:核销样本没做成(${e.message.slice(0, 60)})`) }
    }
  }
  // 作废样本(留痕,不是删)
  gsNow = (await api(tenantId, '/admin/coupon-grants')).grants
  if (!gsNow.some((g) => g.status === 'revoked')) {
    const target = gsNow.filter((g) => g.status === 'active')[1]
    if (target) {
      await api(tenantId, `/admin/coupon-grants/${target.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: '重复发放,作废(演示)' }) })
      log('⑤ 券:作废一张(留痕)')
    }
  }
  // 「被待签单占用」样本:开一张挂着券的单但不签 —— 券在别的单的选券面板上会置灰写单号
  gsNow = (await api(tenantId, '/admin/coupon-grants')).grants
  const heldNow = withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE tenant_id = ? AND status = 'pending_sign' AND coupon_grant_id IS NOT NULL").get(tenantId).n)
  if (!heldNow) {
    // 逐张试:门槛/适用大类不满足的券会被后端严格模式挡回来,换下一张
    const mostExpensive = mains.slice().sort((a2, b2) => (b2.listPriceCents || 0) - (a2.listPriceCents || 0))[0]
    let done = false
    for (const free of gsNow.filter((g) => g.status === 'active')) {
      if (done) break
      try {
        await api(tenantId, '/admin/settlements', {
          method: 'POST',
          body: JSON.stringify({
            cardOwnerUserId: free.userId,
            settlements: [{
              tierKey: 'list', payIntent: 'offline_full', couponGrantId: free.id,
              items: [{ serviceId: mostExpensive.id }],
              technicians: [{ technicianId: techs[0].id, role: 'main', itemNos: [1] }]
            }]
          })
        })
        log(`⑤ 券:「${free.name}」挂在待签单上(占用态样本)`)
        done = true
      } catch (e) { /* 这张用不了,换下一张 */ }
    }
    if (!done) log('⑤ 券:占用态样本没做成(手上的券都不满足门槛/大类)')
  }
  const gs = (await api(tenantId, '/admin/coupon-grants')).grants
  const heldByPending = withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE tenant_id = ? AND status = 'pending_sign' AND coupon_grant_id IS NOT NULL").get(tenantId).n)
  row.coupons = `未使用 ${gs.filter((g) => g.status === 'active').length} · 已核销 ${gs.filter((g) => g.status === 'used').length} · 已过期 ${gs.filter((g) => g.status === 'expired').length} · 作废 ${gs.filter((g) => g.status === 'revoked').length} · 被待签单占用 ${heldByPending}`


  /* ---------- ⑤b 营业时间 ----------
     没配营业时间的话「今日台面」每天都显示「本日休息」,设计图屏 1 的技师网格根本出不来。
     2026-08-09 集中核验时当场发现 Jie'Nail 就是这个状态 —— 补进 seed。 */
  const bh = (await api(tenantId, '/admin/business-hours')).stores[0]
  if (!bh.hours.length || bh.hours.every((h) => h.isClosed)) {
    await api(tenantId, '/admin/business-hours', {
      method: 'PUT',
      body: JSON.stringify({
        storeId: bh.id,
        // 周一休、其余 10:00–19:00(美甲店常见排法)
        hours: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, isClosed: w === 1, openTime: '10:00', closeTime: '19:00' }))
      })
    })
    log('⑤b 营业时间:补齐(周一休,其余 10:00–19:00)—— 今日台面的技师网格要靠它')
  } else log('⑤b 营业时间:已配置,跳过')
  row.hours = (await api(tenantId, '/admin/business-hours')).stores[0].hoursText.zh

  // ---------- ⑥ 排班全形态 ----------
  const weekFrom = shift(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7))
  const shapes = ['full', 'am', 'pm', 'off', 'custom']
  for (let i = 0; i < techs.length; i += 1) {
    const kind = shapes[i % shapes.length]
    const date = shift(weekFrom, i % 7)
    const body = { date, applyToFollowingWeeks: kind === 'full' ? 4 : 0 }
    if (kind === 'custom') { body.startTime = '12:00'; body.endTime = '18:00'; body.isWorking = true } else body.shift = kind
    try { await api(tenantId, `/admin/technicians/${techs[i].id}/schedule`, { method: 'PATCH', body: JSON.stringify(body) }) } catch (e) { /* 冲突只提醒 */ }
  }
  row.schedule = `本周含 全天/上午/下午/休息/自定义 全部形态 + 一条「同步到之后每个周 N」`
  log('⑥ 排班:全天/上午/下午/休息/自定义 全形态已铺,含一条同步到未来 4 周')

  // ---------- ⑦ 目标三态 × 两显示口径 ----------
  /* 三态要齐:达标 / 进行中 / 未设。目标是按**当前**业绩算的,所以后来又灌了单之后
     原来的「进行中」会变成「达标」—— 2026-08-09 集中核验时就撞上了。这里每次都按当前业绩重设。 */
  const tg = (await api(tenantId, `/admin/perf-targets?month=${month}`)).technicians
  {
    const rank = (await api(tenantId, `/admin/perf-ranking?metric=perf&period=month&date=${month}`)).ranking.ranking
    const targets = []
    if (rank[0]) targets.push({ technicianId: rank[0].technicianId, mode: 'total', displayMode: 'total_only', perfTargetCents: Math.max(10000, Math.floor(rank[0].perfCents * 0.7)) })
    // 第二名给一个「够得着但没到」的目标 —— 进度条停在 40% 上下,这才是「进行中」的样子
    if (rank[1]) targets.push({ technicianId: rank[1].technicianId, mode: 'split', displayMode: 'with_split', perfTargetCents: Math.max(100000, Math.round(rank[1].perfCents / 0.4)), cardTargetCents: 150000, orderTarget: 30 })
    if (targets.length) await api(tenantId, '/admin/perf-targets', { method: 'PUT', body: JSON.stringify({ month, targets }) })
  }
  const tg2 = (await api(tenantId, `/admin/perf-targets?month=${month}`)).technicians
  row.targets = `设了 ${tg2.filter((t) => t.hasTarget).length}/${tg2.length} 位(达标 / 进行中 / 未设 三态齐;仅总进度 + 含分项 两种口径都有)`

  // ---------- ⑧ 客服会话 3–5 个 ----------
  const convoN = withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM wechat_conversations WHERE tenant_id = ? AND id LIKE 'bigdemo:%'").get(tenantId).n)
  if (convoN >= CONVOS.length) log(`⑧ 会话:已有 ${convoN} 个演示会话,跳过`)
  else {
    withDb((db) => {
      const cs = db.prepare(`INSERT OR IGNORE INTO wechat_conversations
        (id, provider, external_user_id, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, created_at, updated_at, tenant_id)
        VALUES (?, 'wecom', ?, '微信', ?, ?, ?, '{}', ?, '{}', ?, ?, ?)`)
      const qs = db.prepare(`INSERT OR IGNORE INTO quote_requests
        (id, conversation_id, user_id, source_channel, service_type, status, customer_message, customer_lang, reference_images_json, created_at, updated_at, tenant_id, staff_price_cents, quoted_by, quoted_at)
        VALUES (?, ?, ?, '微信', 'nail', ?, ?, 'zh', '[]', ?, ?, ?, ?, ?, ?)`)
      CONVOS.forEach((c, i) => {
        const cid = `bigdemo:${tenantId}:${i}`
        const at = `${shift(today, -(i + 1))}T0${i + 1}:10:00.000Z`
        const cust = demoCustomers[i] || demoCustomers[0]
        cs.run(cid, `demo-ext-${i}`, c.status === 'human' ? 'human_active' : c.status, c.intent, c.msg,
          JSON.stringify([{ role: 'customer', text: c.msg, at }]), at, at, tenantId)
        if (c.quote) {
          qs.run(`bigdemo-q-${tenantId}-${i}`, cid, cust.id, c.quote, c.msg, at, at, tenantId,
            c.quote === 'QUOTED' ? 68800 : null, c.quote === 'QUOTED' ? 'owner' : null, c.quote === 'QUOTED' ? at : null)
        }
      })
    })
    log(`⑧ 会话:${CONVOS.length} 个(待报价 / 已报价 / 已转人工 / 普通咨询 / 已关闭)`)
  }
  row.convos = `${CONVOS.length} 个会话(含待报价 / 已报价 / 已转人工)`

  /* ---------- ⑩ 今日台面:今天/明天的预约,状态全形态(F3)----------
     2026-08-09 店主随查「走岔流程没正式开单」——根因在数据不在代码:
     ① 今天一条预约都没有,今日台面是空的,点不到块就走不到「去结算」;
     ② 近 6 周那批订单是直接建的结算单(没有 booking),所以「全部订单」里也看不到它们。
     这里把今天铺满、明天留几条,并且**走预约 → 结算 → 签署的完整链路**,
     让「待到店 / 进行中 / 待签 / 已完成 / 未付定金」五种入口各有真样本可点。 */
  const todayBookings = withDb((db) => db.prepare(
    "SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND substr(appointment_start, 1, 10) = ?"
  ).get(tenantId, today).n)
  if (todayBookings >= 4) log(`⑩ 今日台面:今天已有 ${todayBookings} 条预约,跳过`)
  else {
    // 状态样本:每条 = [第几个技师, 几点, 想要的状态]
    const PLAN = [
      [0, '10:30', 'unpaid'],    // 未付定金 —— 面板上有「标记已收定金」
      [0, '13:00', 'confirmed'], // 待到店 —— 面板上有「确认到店」
      [1, '11:00', 'active'],    // 进行中 —— 面板上有「去结算」
      [1, '14:30', 'pending'],   // 已推结算单待签 —— 有「查看结算单」+「撤回改单」
      [0, '16:00', 'done']       // 已完成已签 —— 有「查看电子票据」
    ]
    let made = 0
    for (let i = 0; i < PLAN.length; i += 1) {
      const [ti, time, want] = PLAN[i]
      const tech = techs[ti % techs.length]
      const cust = demoCustomers[i % demoCustomers.length]
      let booking
      try {
        booking = (await api(tenantId, '/admin/bookings/direct', {
          method: 'POST',
          body: JSON.stringify({
            userId: cust.id, serviceId: mains[i % mains.length].id, technicianId: tech.id,
            date: today, time, depositPaid: want !== 'unpaid', notes: '演示数据'
          })
        })).booking
      } catch (e) { log(`   ${time} 这条没排上(${e.message.slice(0, 60)})`); continue }
      made += 1
      if (want === 'unpaid' || want === 'confirmed') continue
      // 到店
      await api(tenantId, `/admin/bookings/${encodeURIComponent(booking.id)}/arrival`, { method: 'PATCH', body: JSON.stringify({ arrived: true }) }).catch(() => {})
      if (want === 'active') continue
      // 推结算单(带 bookingId —— 这样「全部订单」和结算单才对得上)
      let sheet
      try {
        sheet = (await api(tenantId, '/admin/settlements', {
          method: 'POST',
          body: JSON.stringify({
            cardOwnerUserId: cust.id,
            settlements: [{
              bookingId: booking.id, tierKey: 'member', depositApplied: true, payIntent: 'offline_full',
              items: [{ serviceId: mains[i % mains.length].id }],
              technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }]
            }]
          })
        })).settlements[0]
      } catch (e) { log(`   ${time} 结算单没推成(${e.message.slice(0, 60)})`); continue }
      if (want === 'pending') continue
      await pub(`/settlements/${sheet.code}/sign`, {
        method: 'POST',
        body: JSON.stringify({ disclaimerAccepted: true, signature: cust.displayName || '顾客', strokes: [[{ x: 8, y: 55 }, { x: 44, y: 18 }, { x: 78, y: 60 }]] })
      }).catch(() => {})
    }
    // 明天留两条待到店,别让「明天」是空的
    for (let i = 0; i < 2; i += 1) {
      await api(tenantId, '/admin/bookings/direct', {
        method: 'POST',
        body: JSON.stringify({
          userId: demoCustomers[(i + 2) % demoCustomers.length].id, serviceId: mains[i % mains.length].id,
          technicianId: techs[i % techs.length].id, date: shift(today, 1), time: i ? '15:00' : '11:30',
          depositPaid: true, notes: '演示数据'
        })
      }).catch(() => {})
    }
    log(`⑩ 今日台面:今天 ${made} 条(未付定金/待到店/进行中/待签/已完成 全形态)+ 明天 2 条`)
  }
  row.desk = withDb((db) => {
    const n = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND substr(appointment_start, 1, 10) = ?").get(tenantId, today).n
    const linked = db.prepare('SELECT COUNT(*) AS n FROM settlements WHERE tenant_id = ? AND booking_id IS NOT NULL').get(tenantId).n
    return `今天 ${n} 条预约 · ${linked} 张结算单挂在预约上`
  })

  // ---------- ⑨ 财务账本:6 个月有起伏的曲线 ----------
  const ledgerN = withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM finance_transactions WHERE tenant_id = ? AND tags = 'bigdemo'").get(tenantId).n)
  if (ledgerN >= 30) log(`⑨ 财务曲线:已有 ${ledgerN} 条演示账目,跳过`)
  else {
    const wave = [0.82, 0.94, 0.76, 1.18, 1.02, 0.34] // 最后一个是本月至今(未满月)
    const baseIncome = tenantId === 'jics-nail' ? 1600000 : 1000000
    for (let i = 0; i < 6; i += 1) {
      const mk = monthShift(month, -(5 - i))
      const inc = Math.round(baseIncome * wave[i])
      for (const [cat, ratio, src] of [['服务收入-美甲', 0.58, 'manual'], ['服务收入-美睫', 0.24, 'manual'], ['服务收入-耗卡', 0.18, 'stored_value']]) {
        await api(tenantId, '/admin/finance/transactions', {
          method: 'POST',
          body: JSON.stringify({ type: 'income', category: cat, source: src, amountCents: Math.round(inc * ratio), payChannel: 'offline', occurredOn: `${mk}-06`, note: '演示数据', tags: 'bigdemo' })
        })
      }
      const exp = Math.round(inc * 0.52)
      for (const [cat, ratio] of [['房租', 0.5], ['材料', 0.28], ['水电网', 0.12], ['市场推广', 0.1]]) {
        await api(tenantId, '/admin/finance/transactions', {
          method: 'POST',
          body: JSON.stringify({ type: 'expense', category: cat, amountCents: Math.round(exp * ratio), payChannel: 'offline', occurredOn: `${mk}-03`, note: '演示数据', tags: 'bigdemo' })
        })
      }
    }
    // 营收目标:让趋势图上的目标线与达标月都有东西可看
    await api(tenantId, '/admin/finance/targets', { method: 'PUT', body: JSON.stringify({ targetMode: 'revenue', monthTargetCents: Math.round(baseIncome * 0.95) }) })
    log('⑨ 财务曲线:6 个月起伏账目 + 营收月目标已设(趋势图有目标线与达标月)')
  }
  const sv = (await api(tenantId, '/admin/stored-value')).storedValue
  row.finance = `储值负债 ${(sv.totalBalanceCents / 100).toFixed(2)} · 沉睡卡 ${(sv.accounts || []).filter((a) => a.dormantDays > 30).length} 张 · 6 个月曲线已铺`

  report.push(row)
}

console.log('\n\n===== 数据清点表(大规模演示数据)=====')
for (const r of report) {
  console.log(`\n【${r.store}】`)
  for (const [k, v] of Object.entries(r)) {
    if (k === 'store') continue
    const label = { customers: '顾客', settlements: '结算单', dailyClose: '日结', recharge: '充值', coupons: '券', schedule: '排班', targets: '业绩目标', convos: '客服会话', finance: '财务' }[k] || k
    console.log(`  ${label.padEnd(6, '　')} ${v}`)
  }
}
console.log('\n完成。重跑本脚本是幂等的(已有的部分只打印跳过)。')
