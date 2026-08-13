/* 爽约定金处置 + 售后完成态 + D19/D20 红线回归(2026-08-11 图 A/B 部,店主已确认)。
   corner case 为主:
   ① A⑤ 无收取记录的爽约单处置=拒绝;未爽约的单处置=拒绝
   ② A① 越权:员工调处置接口=403
   ③ A② 留存:负债转档案零收入;下次预约自动带出为收取记录(留痕引用来源)
   ④ A③ 没收:独立「定金收入·爽约没收」行;**不进日结、不进技师业绩**(+1 财务红线同构)
   ⑤ A④ 幂等/append-only:重复处置=409;撤销后可重新处置
   ⑥ A①-2 到期自动转没收(直连库把 expires_at 拨到过去,读路径触发惰性收口)
   ⑦ B① 权限:别的技师写进展=403;标已解决空结果=400;关闭非老板=403
   ⑧ B⓪ 状态只前进:resolved 后 close=409;resolve 两次=409
   ⑨ B② 售后接口无金额字段:带 amountCents 的请求不产生任何账目行
   ⑩ D19:跨租户 storeId 下单=400 STORE_TENANT_MISMATCH
   ⑪ D20:全仓顾客可见文案禁「支付成功」(机械扫描,白名单精确到文件)
   ⑫ D22 金额红线 ⑬ 结算单服务分组 ⑭ 技师代充权限边界

   ⚠️ standalone 跑法(护栏,2026-08-12 店主裁决②后立):**绝不许直接打 4128 真库** ——
     rm -rf /tmp/ll-x && mkdir /tmp/ll-x
     DATA_DIR=/tmp/ll-x PORT=4300 node local-server.mjs &
     TEST_BASE_URL=http://127.0.0.1:4300 TEST_DB_PATH=/tmp/ll-x/lucky-luxe.sqlite node 本文件
   (2026-08-11 有人少了 TEST_BASE_URL,在真库建了 nsas-a-msok023f 测试租户,已停用挂账。) */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `nsas-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `爽约店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  await request(`/platform/tenants/${id}/business-hours`, {
    method: 'PUT',
    body: JSON.stringify({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openTime: '00:00', closeTime: '23:30', isClosed: false })) })
  })
  const t1 = await request(`/platform/tenants/${id}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技甲${label}${RUN_ID}` }) })
  const t2 = await request(`/platform/tenants/${id}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技乙${label}${RUN_ID}` }) })
  const svc = await request(`/platform/tenants/${id}/services`, {
    method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `项目${label}${RUN_ID}`, nameEn: 'item', priceCents: 20000, depositCents: 10000, baseDurationMin: 60 })
  })
  // 固定 ¥100 定金,方便断言
  await request('/admin/deposit-config', { method: 'PUT', body: JSON.stringify({ enabled: true, mode: 'fixed', fixedAmountCents: 10000, deductible: true }) }, token)
  return { tenantId: id, token, tech1: t1.data.technician.id, tech2: t2.data.technician.id, serviceId: svc.data.service.id }
}

// 员工账号:老板生成 → 首登改密(响应把 username/initialPassword 放在顶层,同 test-admin-accounts)
async function staffLogin(shop, technicianId, tag) {
  const gen = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId }) }, shop.token)
  const username = gen.data.username
  const initialPassword = gen.data.initialPassword
  if (!username || !initialPassword) throw new Error(`员工账号生成响应意外: ${JSON.stringify(gen.data)}`)
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `St-${RUN_ID}-${tag}1`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  return again.data.auth.accessToken
}

function dateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function directBooking(shop, { name, time, techId }) {
  const r = await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ serviceId: shop.serviceId, technicianId: techId || shop.tech1, date: dateStr(1), time, newCustomerName: name })
  }, shop.token)
  if (r.status !== 200 && r.status !== 201) throw new Error(`直接排单失败: ${JSON.stringify(r.data)}`)
  return r.data.booking
}

async function financeRows(shop) {
  const r = await request('/admin/finance/transactions?limit=100', {}, shop.token)
  return (r.data && (r.data.transactions || r.data.rows)) || []
}

const main = async () => {
  const shop = await newShop('a')

  // ===== ① A⓪/A⑤:没收取记录、没爽约,处置都得被拒 =====
  const b1 = await directBooking(shop, { name: `王小雅${RUN_ID}`, time: '10:00' })
  let r = await request(`/admin/bookings/${b1.id}/deposit-disposal`, { method: 'POST', body: JSON.stringify({ action: 'forfeit' }) }, shop.token)
  check('① 未爽约的单处置=400', r.status === 400)
  r = await request(`/admin/bookings/${b1.id}/no-show`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('① 标记爽约成功且落 no_show_at', r.status === 200)
  r = await request(`/admin/bookings/${b1.id}/deposit-disposal`, { method: 'POST', body: JSON.stringify({ action: 'retain' }) }, shop.token)
  check('① A⑤ 无收取记录的爽约单处置=400', r.status === 400 && r.data.error.code === 'NO_DEPOSIT_RECEIPT', JSON.stringify(r.data))

  // ===== ② 有收取记录的爽约单:员工越权 403,老板留存成功 =====
  const b2 = await directBooking(shop, { name: `苏念${RUN_ID}`, time: '11:30' })
  await request(`/admin/bookings/${b2.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  await request(`/admin/bookings/${b2.id}/no-show`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  const staffToken = await staffLogin(shop, shop.tech1, 'a')
  r = await request(`/admin/bookings/${b2.id}/deposit-disposal`, { method: 'POST', body: JSON.stringify({ action: 'retain' }) }, staffToken)
  check('② A① 员工调处置接口=403', r.status === 403)
  const before = await financeRows(shop)
  r = await request(`/admin/bookings/${b2.id}/deposit-disposal`, { method: 'POST', body: JSON.stringify({ action: 'retain', note: '顾客临时有事' }) }, shop.token)
  check('② 老板留存成功', r.status === 201 && r.data.disposal.action === 'retain', JSON.stringify(r.data))
  check('② A② 留存零收入(账目行数不变)', (await financeRows(shop)).length === before.length)
  r = await request(`/admin/bookings/${b2.id}/deposit-disposal`, { method: 'POST', body: JSON.stringify({ action: 'forfeit' }) }, shop.token)
  check('② A④ 重复处置=409', r.status === 409)

  // ===== ③ A② 下次预约自动带出为收取记录(留痕引用来源) =====
  const list0 = await request('/admin/bookings', {}, shop.token)
  const b2row = list0.data.bookings.find((x) => x.id === b2.id)
  const userId = b2row.user && b2row.user.id
  check('③ 爽约单有档案可留存', Boolean(userId))
  const b3 = await request('/admin/bookings/direct', {
    method: 'POST', body: JSON.stringify({ serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(2), time: '10:00', userId })
  }, shop.token)
  check('③ 同顾客再排单成功', b3.status === 200 || b3.status === 201)
  const rec = await request(`/admin/bookings/${b3.data.booking.id}/deposit-receipt`, {}, shop.token)
  const carried = (rec.data.receipts || []).find((x) => x.payChannel === 'retain_carry' || x.pay_channel === 'retain_carry' || /留存带出/.test(x.reason || ''))
  check('③ A② 新单上自动带出收取记录(retain_carry)', Boolean(carried), JSON.stringify(rec.data))
  check('③ A② 带出金额=留存金额 ¥100', (carried.amountCents || carried.amount_cents) === 10000)

  // ===== ④ A③ 没收:独立收入行,不进日结不进业绩 =====
  const b4 = await directBooking(shop, { name: `陈果果${RUN_ID}`, time: '14:00', techId: shop.tech2 })
  await request(`/admin/bookings/${b4.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  await request(`/admin/bookings/${b4.id}/no-show`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  r = await request(`/admin/bookings/${b4.id}/deposit-disposal`, { method: 'POST', body: JSON.stringify({ action: 'forfeit', note: '联系不上' }) }, shop.token)
  check('④ 没收成功', r.status === 201 && r.data.disposal.action === 'forfeit')
  const rows = await financeRows(shop)
  const forfeitRow = rows.find((x) => x.category === '定金收入·爽约没收')
  check('④ A③ 独立「定金收入·爽约没收」行存在且=¥100', Boolean(forfeitRow) && forfeitRow.amountCents === 10000, JSON.stringify(rows.slice(0, 3)))
  const dc = await request(`/admin/daily-close?date=${dateStr(0)}`, {}, shop.token)
  const dcStr = JSON.stringify(dc.data)
  check('④ A③ 没收不进今天的日结区', !dcStr.includes('爽约没收'), dcStr.slice(0, 200))
  const perf = await request(`/admin/finance/summary`, { method: 'POST', body: JSON.stringify({ granularity: 'day', date: dateStr(0) }) }, shop.token)
  const perfStr = JSON.stringify(perf.data)
  check('④ +1 红线:技师业绩不含没收额(summary 里无技师挂 ¥100 业绩)', !/10000[^,]*技/.test(perfStr))

  // ===== ⑤ 守恒审计:留存与没收都审计 ok =====
  r = await request('/admin/finance/deposit-conservation', {}, shop.token)
  const broken = (r.data && (r.data.broken || r.data.records)) || r.data || []
  check('⑤ A④ 守恒审计 0 条不守恒', Array.isArray(broken) ? broken.length === 0 : JSON.stringify(broken).includes('[]'), JSON.stringify(r.data))

  // ===== ⑥ A①-2 到期自动转没收(直连库拨过期) =====
  await request('/admin/deposit-config', { method: 'PUT', body: JSON.stringify({ retainValidDays: 30 }) }, shop.token)
  const cfg = await request('/admin/deposit-config', {}, shop.token)
  check('⑥ retainValidDays 配置可存取', (cfg.data.config || cfg.data).retainValidDays === 30)
  if (process.env.TEST_DB_PATH) {
    // ② 的留存在 ③ 已被下一单带出核销 —— 造一笔新的留存来过期(反例数据要新鲜)
    const b6 = await directBooking(shop, { name: `过期客${RUN_ID}`, time: '17:30' })
    await request(`/admin/bookings/${b6.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
    await request(`/admin/bookings/${b6.id}/no-show`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
    r = await request(`/admin/bookings/${b6.id}/deposit-disposal`, { method: 'POST', body: JSON.stringify({ action: 'retain' }) }, shop.token)
    check('⑥ 配置时长后留存带 expires_at', r.status === 201 && Boolean(r.data.retain && r.data.retain.expires_at), JSON.stringify(r.data))
    const db2 = new DatabaseSync(process.env.TEST_DB_PATH)
    db2.prepare("UPDATE deposit_retains SET expires_at = '2000-01-01T00:00:00.000Z' WHERE tenant_id = ? AND status = 'active' AND source = 'no_show'").run(shop.tenantId)
    db2.close()
    const beforeRows = (await financeRows(shop)).filter((x) => x.category === '定金收入·爽约没收').length
    await request('/admin/customers', {}, shop.token)   // 任一读路径触发惰性收口
    const afterRows = (await financeRows(shop)).filter((x) => x.category === '定金收入·爽约没收')
    const autoRow = afterRows.find((x) => /留存到期自动没收/.test(x.note || ''))
    check('⑥ A①-2 到期留存自动转没收(note 留痕)', afterRows.length === beforeRows + 1 && Boolean(autoRow), JSON.stringify(afterRows))
    r = await request('/admin/finance/deposit-conservation', {}, shop.token)
    const broken2 = (r.data && (r.data.broken || r.data.records)) || []
    check('⑥ 自动没收后守恒仍 0 条', Array.isArray(broken2) ? broken2.length === 0 : true)
  } else {
    check('⑥ (跳过)无 TEST_DB_PATH,到期路径未测', true)
  }

  // ===== ⑦⑧⑨ 售后完成态 =====
  const b5 = await directBooking(shop, { name: `售后客${RUN_ID}`, time: '16:00', techId: shop.tech1 })
  await request(`/admin/bookings/${b5.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
  await request(`/admin/bookings/${b5.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'AFTER_SALES' }) }, shop.token)
  const staff2Token = await staffLogin(shop, shop.tech2, 'b')
  r = await request(`/admin/bookings/${b5.id}/after-sales/progress`, { method: 'POST', body: JSON.stringify({ text: '我不是这单的技师' }) }, staff2Token)
  check('⑦ B① 别的技师写进展=403', r.status === 403)
  r = await request(`/admin/bookings/${b5.id}/after-sales/progress`, { method: 'POST', body: JSON.stringify({ text: '已联系顾客,约后天到店补钻' }) }, staffToken)
  check('⑦ B① 当单技师写进展成功→处理中', r.status === 201 && r.data.afterSales.status === 'processing', JSON.stringify(r.data))
  r = await request(`/admin/bookings/${b5.id}/after-sales/resolve`, { method: 'POST', body: JSON.stringify({ resultText: '' }) }, shop.token)
  check('⑦ B④ 空结果标解决=400', r.status === 400)
  r = await request(`/admin/bookings/${b5.id}/after-sales/close`, { method: 'POST', body: JSON.stringify({ reason: '试试员工关' }) }, staffToken)
  check('⑦ B① 员工关闭=403', r.status === 403)
  const led0 = (await financeRows(shop)).length
  r = await request(`/admin/bookings/${b5.id}/after-sales/resolve`, {
    method: 'POST', body: JSON.stringify({ resultText: '到店免费补钻 2 颗,顾客确认满意', amountCents: 99999, refundCents: 5000 })
  }, staffToken)
  check('⑧ 当单技师标已解决成功', r.status === 200 && r.data.afterSales.status === 'resolved')
  check('⑨ B② 带金额字段的请求不产生任何账目行', (await financeRows(shop)).length === led0)
  r = await request(`/admin/bookings/${b5.id}/after-sales/resolve`, { method: 'POST', body: JSON.stringify({ resultText: '再来一次' }) }, shop.token)
  check('⑧ B⓪ resolve 两次=409', r.status === 409)
  r = await request(`/admin/bookings/${b5.id}/after-sales/close`, { method: 'POST', body: JSON.stringify({ reason: '想关掉' }) }, shop.token)
  check('⑧ B⓪ resolved 后 close=409(状态只前进)', r.status === 409)
  const list1 = await request('/admin/bookings', {}, shop.token)
  const b5row = list1.data.bookings.find((x) => x.id === b5.id)
  check('⑧ B⓪ 状态机随单下发:resolved + 时间线 ≥3 条(发起/进展/解决)', b5row.afterSales.status === 'resolved' && b5row.afterSales.timeline.length >= 3, JSON.stringify(b5row.afterSales))
  check('⑧ B④ 时间线带操作人', b5row.afterSales.timeline.every((e) => e.at))

  // ===== ⑩ D19 跨租户 storeId =====
  const shopB = await newShop('b')
  const storesB = await request('/stores', {}, null, { 'x-tenant-id': shopB.tenantId })
  const storeBId = storesB.data.stores[0].id
  // 用 A 店租户头 + B 店 storeId 下单(顾客侧公开注册太长,直接用 direct 路由验证同一断言)
  r = await request('/admin/bookings/direct', {
    method: 'POST', body: JSON.stringify({ serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(3), time: '10:00', newCustomerName: '串味客', storeId: storeBId })
  }, shop.token)
  check('⑩ D19 跨租户 storeId 下单=400 STORE_TENANT_MISMATCH', r.status === 400 && r.data.error.code === 'STORE_TENANT_MISMATCH', JSON.stringify(r.data))

  // ===== ⑪ D20 文案扫描:顾客可见文案禁「支付成功」 =====
  const ROOT = new URL('../../', import.meta.url).pathname
  const scanDirs = ['miniprogram/pages', 'miniprogram/utils', 'apps/web']
  const allow = new Set([])   // 白名单精确到文件;当前应为空
  const bad = []
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (/\.(js|wxml|html)$/.test(f)) {
        const rel = p.slice(ROOT.length)
        if (allow.has(rel)) continue
        if (readFileSync(p, 'utf8').includes('支付成功')) bad.push(rel)
      }
    }
  }
  for (const d of scanDirs) walk(join(ROOT, d))
  check('⑪ D20 顾客可见文案 0 处「支付成功」(§十-2)', bad.length === 0, bad.join(', '))

  // ===== ⑫ D22 金额红线(店主 2026-08-11 抓出「手部精修前置」幽灵行):
  //        预览单的价目表行必须与请求的 items **一一对应** —— 多一行少一行都是红。
  //        含取消场景:去掉一项再预览,那一行必须消失,合计跟着降。
  {
    const svcA = await request(`/platform/tenants/${shop.tenantId}/services`, {
      method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `主项A${RUN_ID}`, nameEn: 'a', priceCents: 30000, depositCents: 0, baseDurationMin: 60 })
    })
    const svcB = await request(`/platform/tenants/${shop.tenantId}/services`, {
      method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `主项B${RUN_ID}`, nameEn: 'b', priceCents: 5800, depositCents: 0, baseDurationMin: 30 })
    })
    const idA = svcA.data.service.id, idB = svcB.data.service.id
    const preview = (body) => request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify(body) }, shop.token)
    const p2 = await preview({ tierKey: 'list', items: [{ serviceId: idA, qty: 1 }, { serviceId: idB, qty: 1 }], customItems: [{ name: '钻球', amountCents: 5000 }], payIntent: 'offline_full', depositApplied: false })
    const ids2 = p2.data.settlement.lines.filter((l) => l.serviceId).map((l) => l.serviceId).sort()
    check('⑫ D22 预览行与请求项一一对应(两项+自选)', JSON.stringify(ids2) === JSON.stringify([idA, idB].sort()), JSON.stringify(ids2))
    check('⑫ D22 合计≡勾选行之和', p2.data.settlement.subtotalCents === 30000 + 5800 + 5000, String(p2.data.settlement.subtotalCents))
    const p3 = await preview({ tierKey: 'list', items: [{ serviceId: idA, qty: 1 }], customItems: [{ name: '钻球', amountCents: 5000 }], payIntent: 'offline_full', depositApplied: false })
    const ids3 = p3.data.settlement.lines.filter((l) => l.serviceId).map((l) => l.serviceId)
    check('⑫ D22 取消场景:去掉的项不再出行、合计同步降', JSON.stringify(ids3) === JSON.stringify([idA]) && p3.data.settlement.subtotalCents === 35000, `${JSON.stringify(ids3)} ${p3.data.settlement.subtotalCents}`)
  }

  // ===== ⑬ 结算单服务分组(图 v2.2)金额红线:组合计≡Σ各单、每组行≡该组请求项、快照随组 =====
  {
    const mk = (name, cents) => request(`/platform/tenants/${shop.tenantId}/services`, {
      method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `${name}${RUN_ID}`, nameEn: 'g', priceCents: cents, depositCents: 0, baseDurationMin: 60 })
    })
    const g1 = (await mk('组项甲', 30000)).data.service.id
    const g2 = (await mk('组项乙', 12000)).data.service.id
    const sheets = [
      { tierKey: 'list', items: [{ serviceId: g1, qty: 1 }], customItems: [{ name: '钻球', amountCents: 5000 }], technicians: [], servedPersonName: '' },
      { tierKey: 'list', tierChangedFrom: 'member', items: [{ serviceId: g2, qty: 1 }], customItems: [], technicians: [], servedPersonName: '朋友小美' }
    ]
    const gp = await request('/admin/settlements/preview', {
      method: 'POST', body: JSON.stringify({ payIntent: 'offline_full', settlements: sheets })
    }, shop.token)
    check('⑬ 组预览返回 sheets+group 两层', Array.isArray(gp.data.sheets) && gp.data.sheets.length === 2 && Boolean(gp.data.group), JSON.stringify(gp.data).slice(0, 120))
    const sum = (k) => gp.data.sheets.reduce((n, s) => n + (s[k] || 0), 0)
    for (const k of ['listTotalCents', 'subtotalCents', 'discountTotalCents', 'totalCents']) {
      check(`⑬ 组合计 ${k} ≡ Σ各单`, gp.data.group[k] === sum(k), `${gp.data.group[k]} vs ${sum(k)}`)
    }
    check('⑬ 组① 行≡该组请求项(不含组② 的项)', JSON.stringify(gp.data.sheets[0].lines.filter((l) => l.serviceId).map((l) => l.serviceId)) === JSON.stringify([g1]), JSON.stringify(gp.data.sheets[0].lines.map((l) => l.serviceId)))
    check('⑬ 组② 行≡该组请求项(不含组① 的项与自选)', gp.data.sheets[1].lines.every((l) => l.serviceId !== g1 && l.kind !== 'custom') && gp.data.sheets[1].lines.some((l) => l.serviceId === g2), JSON.stringify(gp.data.sheets[1].lines))
    check('⑬ 纯线下:到店应收≡组合计', gp.data.group.payment.offlineDueCents === gp.data.group.totalCents, JSON.stringify(gp.data.group.payment))
    // 组建单:快照价档/改档留痕/被服务者随组,1/N 顺序,未签可撤
    const cb = await request('/admin/bookings/direct', {
      method: 'POST', body: JSON.stringify({ serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(4), time: '11:00', newCustomerName: `组卡主${RUN_ID}` })
    }, shop.token)
    const cardOwner = (cb.data.booking.user || {}).id || cb.data.booking.userId
    const made = await request('/admin/settlements', {
      method: 'POST', body: JSON.stringify({ userId: cardOwner, payerUserId: cardOwner, cardOwnerUserId: cardOwner, payIntent: 'offline_full', settlements: [{ ...sheets[0], tierKey: 'member' }, sheets[1]] })
    }, shop.token)
    const rows = made.data.settlements || []
    check('⑬ 组建单 2 张同组各有单号', rows.length === 2 && rows[0].groupId === rows[1].groupId && rows[0].code !== rows[1].code, JSON.stringify(rows.map((s) => s.code)))
    check('⑬ 快照价档随组(member/list)+改档留痕只落改档组', rows[0].tierKey === 'member' && rows[1].tierKey === 'list' && !rows[0].tierChangedFrom && rows[1].tierChangedFrom === 'member', `${rows[0].tierKey}/${rows[1].tierKey}/${rows[1].tierChangedFrom}`)
    check('⑬ 被服务者随组+1/N 顺序', rows[0].servedPersonName === '' && rows[1].servedPersonName === '朋友小美' && rows[0].groupIndex === 1 && rows[1].groupIndex === 2 && rows[1].groupTotal === 2, JSON.stringify(rows.map((s) => [s.servedPersonName, s.groupIndex, s.groupTotal])))
    check('⑬ 两张合计≡组预览合计(member 档另算)', rows[1].totalCents === gp.data.sheets[1].totalCents, `${rows[1].totalCents} vs ${gp.data.sheets[1].totalCents}`)
    for (const s of rows) {
      const v = await request(`/admin/settlements/${s.id}/void`, { method: 'POST', body: JSON.stringify({ reason: 'CI 分组断言,即建即撤' }) }, shop.token)
      check(`⑬ 未签可撤 ${s.groupIndex}/2`, v.status === 200, JSON.stringify(v.data).slice(0, 120))
    }
  }

  // ===== ⑭ 技师代充放行(店主 2026-08-12 拍板)权限边界:
  //        充值=预收轻动作放技师(经手人强制=当前技师留痕);耗卡/总览/档位配置/财务页寸步不让。
  {
    // tech1/tech2 在售后块已生成过账号,这里新建技师走全新账号(fixture 每步验状态码的老教训)
    const t3 = await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技代充${RUN_ID}` }) })
    if (t3.status >= 300) throw new Error(`fixture 技师失败 ${t3.status}`)
    const gen = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: t3.data.technician.id }) }, shop.token)
    const staffUser = gen.data.username
    if (!staffUser || !gen.data.initialPassword) throw new Error(`员工账号响应意外: ${JSON.stringify(gen.data)}`)
    const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: staffUser, password: gen.data.initialPassword }) }, null)
    const sp = `Sv-${RUN_ID}-9a`
    await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: gen.data.initialPassword, newPassword: sp, confirmPassword: sp }) }, first.data.auth.accessToken)
    const staffToken = (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: staffUser, password: sp }) }, null)).data.auth.accessToken
    const cust = await directBooking(shop, { name: `代充客${RUN_ID}`, time: '18:30' })
    const custId = cust.user.id
    check('⑭ 技师可读充值档位(选套餐用,只读)', (await request('/admin/recharge-tiers', {}, staffToken)).status === 200)
    check('⑭ 技师改档位配置=403(读写分明)', (await request('/admin/recharge-tiers', { method: 'POST', body: JSON.stringify({ amountCents: 10000 }) }, staffToken)).status === 403)
    // ⑮ D25(《财务总逻辑》3-1b):未绑定轻档案不可充值 —— 技师/老板同拦;绑定后放行
    const rvBody = JSON.stringify({ userId: custId, amountCents: 3300, payChannel: 'manual', note: '结算单内代充·档位 实收30 + 赠3', technicianId: shop.tech2 })
    r = await request('/admin/stored-value/recharge', { method: 'POST', body: rvBody }, staffToken)
    check('⑮ D25 未绑定档案技师充值=400 UNBOUND_NO_RECHARGE', r.status === 400 && r.data.error.code === 'UNBOUND_NO_RECHARGE', JSON.stringify(r.data).slice(0, 120))
    r = await request('/admin/stored-value/recharge', { method: 'POST', body: rvBody }, shop.token)
    check('⑮ D25 未绑定档案老板充值同拦(同受约束)', r.status === 400 && r.data.error.code === 'UNBOUND_NO_RECHARGE')
    if (!process.env.TEST_DB_PATH) throw new Error('⑮ 需要 TEST_DB_PATH 直连库绑定 fixture(同 ⑥ 先例)')
    const db4 = new DatabaseSync(process.env.TEST_DB_PATH)
    db4.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`wx-test-${RUN_ID}`, custId)
    db4.close()
    r = await request('/admin/stored-value/recharge', { method: 'POST', body: rvBody }, staffToken)
    check('⑮ D25 绑定后技师代充放行=201(无需财务钥匙)', r.status === 201, JSON.stringify(r.data).slice(0, 120))
    if (process.env.TEST_DB_PATH) {
      const db3 = new DatabaseSync(process.env.TEST_DB_PATH)
      const tx = db3.prepare("SELECT technician_id, created_by FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'recharge' ORDER BY created_at DESC LIMIT 1").get(shop.tenantId, custId)
      db3.close()
      check('⑭ 经手人强制=当前技师(body 冒名 tech2 不认)', tx.technician_id === t3.data.technician.id, JSON.stringify(tx))
      check('⑭ 留痕 created_by=员工账号', tx.created_by === staffUser, `${tx.created_by} vs ${staffUser}`)
    } else {
      check('⑭ (跳过)无 TEST_DB_PATH,留痕直连断言未跑', true)
    }
    check('⑭ 技师耗卡=403(确认收入,寸步不让)', (await request('/admin/stored-value/consume', { method: 'POST', body: JSON.stringify({ userId: custId, amountCents: 100 }) }, staffToken)).status === 403)
    check('⑭ 技师储值总览=403', (await request('/admin/stored-value', {}, staffToken)).status === 403)
    check('⑭ 技师财务页=403(财务门禁整体不变)', (await request('/admin/finance/deposit-conservation', {}, staffToken)).status === 403)

    // ===== ⑯ 绑定码全链(图 v2.3 规则⑦):铸码→确认卡→确认绑定→充值解锁;两把钥匙边界 =====
    {
      const nb = await directBooking(shop, { name: `绑定客${RUN_ID}`, time: '21:15' })
      const nbId = nb.user.id
      const mint = await request(`/admin/customers/${nbId}/bind-token`, { method: 'POST', body: '{}' }, staffToken)
      check('⑯ 技师可铸绑定码(现场是技师递手机)', mint.status === 201 && Boolean(mint.data.token) && String(mint.data.url).includes('/bind?t='), JSON.stringify(mint.data).slice(0, 140))
      const card = await request(`/bind-tokens/${mint.data.token}`, {}, null)
      check('⑯ 确认卡只有称呼/店名,无单无金额字段', card.status === 200 && card.data.displayName && card.data.alreadyBound === false
        && !JSON.stringify(card.data).match(/totalCents|amountCents|settlement/), JSON.stringify(card.data).slice(0, 160))
      const cfm = await request(`/bind-tokens/${mint.data.token}/confirm`, { method: 'POST', body: JSON.stringify({ openid: `wx-fresh-${RUN_ID}` }) }, null)
      check('⑯ 新 openid 确认=绑定成功', cfm.status === 200 && cfm.data.bound === true && !cfm.data.conflict, JSON.stringify(cfm.data).slice(0, 120))
      r = await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: nbId, amountCents: 1000, payChannel: 'manual', note: '绑定后解锁验证' }) }, staffToken)
      check('⑯ 绑定后充值解锁=201(D25 闭环)', r.status === 201)
      const again = await request(`/admin/customers/${nbId}/bind-token`, { method: 'POST', body: '{}' }, shop.token)
      check('⑯ 已绑定档案再铸码=400 ALREADY_BOUND', again.status === 400 && again.data.error.code === 'ALREADY_BOUND')
      check('⑯ 废令牌=404(用过的码不能再进确认卡)', (await request(`/bind-tokens/${mint.data.token}`, {}, null)).status === 404)
      check('⑯ 假令牌=404', (await request('/bind-tokens/bind_fake_notexist', {}, null)).status === 404)
      // 冲突路:同一个 openid 再绑本店另一档案 → 不覆盖,进合并队列
      const nb2 = await directBooking(shop, { name: `冲突客${RUN_ID}`, time: '22:15', techId: shop.tech2 })
      const mint2 = await request(`/admin/customers/${nb2.user.id}/bind-token`, { method: 'POST', body: '{}' }, shop.token)
      const cfm2 = await request(`/bind-tokens/${mint2.data.token}/confirm`, { method: 'POST', body: JSON.stringify({ openid: `wx-fresh-${RUN_ID}` }) }, null)
      check('⑯ 同 openid 绑本店另一档案=冲突进合并队列不覆盖(S4 规则⑤同构)', cfm2.status === 200 && cfm2.data.conflict === true && cfm2.data.mergeQueued === true, JSON.stringify(cfm2.data).slice(0, 120))
    }

    // ===== ⑰ 储值逐笔视图(2026-08-12 裁决;同日扩消耗):充值Σ≡月充值+消耗Σ≡月耗卡;回链;技师=403 =====
    {
      const fk = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({}) }, shop.token)
      const kh = { 'x-finance-key': fk.data.financeKey || '' }
      // 造一笔手工耗卡(老板+钥匙,既有路由;红线:耗卡=确认收入,这笔是测试店内数据)
      const cs = await request('/admin/stored-value/consume', { method: 'POST', body: JSON.stringify({ userId: custId, amountCents: 700, note: '逐笔视图消耗断言' }), headers: kh }, shop.token)
      check('⑰ 手工耗卡 fixture 落账', cs.status === 201)
      const txns = await request('/admin/stored-value/txns', { headers: kh }, shop.token)
      const overview = await request('/admin/stored-value', { headers: kh }, shop.token)
      const sv = overview.data.storedValue
      const rSum = txns.data.txns.filter((t) => t.type === 'recharge').reduce((n, t) => n + t.amountCents, 0)
      const cSum = txns.data.txns.filter((t) => t.type === 'consume').reduce((n, t) => n + Math.abs(t.amountCents), 0)
      check('⑰ 充值行Σ≡下发合计≡聚合卡月充值', rSum === txns.data.rechargeTotalCents && rSum === sv.monthRechargeCents, `${rSum} vs ${sv.monthRechargeCents}`)
      check('⑰ 消耗行Σ≡下发合计≡聚合卡月耗卡', cSum === txns.data.consumeTotalCents && cSum === sv.monthConsumeCents, `${cSum} vs ${sv.monthConsumeCents}`)
      check('⑰ 行含 类型/时间/顾客/金额 且充值带经手人', txns.data.txns.length > 0 && txns.data.txns.every((t) => t.type && t.at && t.userName && typeof t.amountCents === 'number' && (t.type !== 'recharge' || t.handler)), JSON.stringify(txns.data.txns[0] || {}))
      check('⑰ 消耗行金额为负、手工耗卡来源=手工耗卡且无单号', txns.data.txns.filter((t) => t.type === 'consume').every((t) => t.amountCents < 0) && txns.data.txns.some((t) => t.type === 'consume' && t.source === '手工耗卡' && t.settlementCode === ''), JSON.stringify(txns.data.txns.filter((t) => t.type === 'consume')))
      check('⑰ 金额纯 cents 下发(币符前端拼,币种红线)', !JSON.stringify(txns.data.txns).match(/[¥$]/))
      // 结算扣卡回链:直连库造一行同格式消耗(签署路径写的就是这个 note,同 ⑥ 直连先例)
      {
        const db5 = new DatabaseSync(process.env.TEST_DB_PATH)
        db5.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at)
          VALUES (?, ?, ?, 'consume', -500, 'stored_value', ?, 'test', ?)`)
          .run(`sv-link-${RUN_ID}`, shop.tenantId, custId, `服务单 JI-LINK-${RUN_ID} 结算扣卡`, new Date().toISOString())
        db5.close()
        const t2 = await request('/admin/stored-value/txns', { headers: kh }, shop.token)
        const linked = t2.data.txns.find((t) => t.id === `sv-link-${RUN_ID}`)
        check('⑰ 结算扣卡行回链单号解析+来源=结算抵扣', Boolean(linked) && linked.settlementCode === `JI-LINK-${RUN_ID}` && linked.source === '结算抵扣', JSON.stringify(linked))
      }
      check('⑰ 技师看逐笔=403', (await request('/admin/stored-value/txns', {}, staffToken)).status === 403)
    }

    // ===== ⑱ D28:showModal 按钮文案 4 汉字上限机械扫描(超限=整窗静默 fail,「递给顾客签」惨案) =====
    {
      const ROOT2 = new URL('../../', import.meta.url).pathname
      const bad2 = []
      const walk2 = (dir) => {
        for (const f of readdirSync(dir)) {
          const pth = join(dir, f)
          const st = statSync(pth)
          if (st.isDirectory()) walk2(pth)
          else if (/\.js$/.test(f)) {
            const src = readFileSync(pth, 'utf8')
            for (const m of src.matchAll(/(confirmText|cancelText):\s*['"`]([^'"`]+)['"`]/g)) {
              /* 口径(店主一问的答复):报错原文说 4 Chinese characters,官方文档说「最多 4 个字符」
                 (中英同计)—— 取更严的**总字符 >4 即红**,中英混排一并拦住。 */
              if (m[2].length > 4) bad2.push(`${pth.slice(ROOT2.length)}: ${m[1]}='${m[2]}'`)
            }
          }
        }
      }
      walk2(join(ROOT2, 'miniprogram/pages'))
      check('⑱ D28 全仓 showModal 按钮文案 ≤4 字符(中英同计;超限=弹窗静默死)', bad2.length === 0, bad2.join(' | '))

      // ⑳ 波及面回归律④(四之八):静默失败家族 —— 剪贴板/扫码类 wx.* 必须挂 fail
      //    (类定义:失败无系统提示、用户动作被无声吞掉的 API;showModal 参数问题由 ⑱ 拦,
      //     导航类栈满另立统一 nav util 待裁决 —— 见回归报告乙①)
      const bad3 = []
      const walk3 = (dir) => {
        for (const f of readdirSync(dir)) {
          const pth = join(dir, f)
          const st = statSync(pth)
          if (st.isDirectory()) walk3(pth)
          else if (/\.js$/.test(f)) {
            const src = readFileSync(pth, 'utf8')
            for (const api of ['setClipboardData', 'getClipboardData', 'scanCode', 'requestPayment']) {
              let idx = 0
              while ((idx = src.indexOf(`wx.${api}({`, idx)) >= 0) {
                let depth = 0; let end = idx
                for (let q = idx + `wx.${api}(`.length - 1; q < Math.min(src.length, idx + 2000); q += 1) {
                  if (src[q] === '(') depth += 1
                  else if (src[q] === ')') { depth -= 1; if (depth === 0) { end = q; break } }
                }
                if (!/fail\s*[:(]/.test(src.slice(idx, end))) bad3.push(`${pth.slice(ROOT2.length)}: wx.${api} 无 fail`)
                idx = end
              }
            }
          }
        }
      }
      walk3(join(ROOT2, 'miniprogram'))
      check('⑳ 四之八④ 剪贴板/扫码/支付类 wx.* 全部挂 fail(静默失败家族总闸)', bad3.length === 0, bad3.join(' | '))

      // ㉑ 裁决②(2026-08-12):裸导航基线拦增量 —— 新增代码一律走 utils/nav.js;
      //    存量 106 处=分叉债 F2(随 S 组迁移清零,清一处基线只准降不准升)。
      let navCount = 0
      const walk4 = (dir) => {
        for (const f of readdirSync(dir)) {
          const pth = join(dir, f)
          const st = statSync(pth)
          if (st.isDirectory()) walk4(pth)
          else if (/\.js$/.test(f) && !pth.endsWith('utils/nav.js')) {
            const src = readFileSync(pth, 'utf8')
            navCount += (src.match(/wx\.(navigateTo|redirectTo|switchTab|reLaunch)\(/g) || []).length
          }
        }
      }
      walk4(join(ROOT2, 'miniprogram'))
      // ㉒ D34(《财务总逻辑》休息日不可开单,2026-08-12 拍板):
      //    休息日排单=400 REST_DAY;设置改营业=放行;顾客端可约时段不含休息日(跨端)。
      {
        const stores = await request('/stores', {}, null, { 'x-tenant-id': shop.tenantId })
        const sid = stores.data.stores[0].id
        // 造一个特殊休息日(明天+9)
        const d9 = dateStr(9)
        await request('/admin/special-dates', { method: 'POST', body: JSON.stringify({ storeId: sid, date: d9, isClosed: true, note: 'CI 休息日' }) }, shop.token)
        let rr = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ serviceId: shop.serviceId, technicianId: shop.tech2, date: d9, time: '12:00', newCustomerName: `休息日客${RUN_ID}` }) }, shop.token)
        check('㉒ D34 休息日排单=400 REST_DAY(提示原句)', rr.status === 400 && rr.data.error.code === 'REST_DAY' && rr.data.error.message.includes('如需接单请到设置将今日改为营业'), JSON.stringify(rr.data).slice(0, 140))
        const av = await request(`/availability?storeId=${sid}&serviceId=${shop.serviceId}&date=${d9}`, {}, null, { 'x-tenant-id': shop.tenantId })
        const avStr = JSON.stringify(av.data)
        check('㉒ D34 顾客端休息日无可约时段(跨端)', av.status !== 200 || !/"available":true/.test(avStr) || (av.data.slots || []).filter((x) => x.available).length === 0, avStr.slice(0, 120))
        // 改营业 → 放行
        await request('/admin/special-dates', { method: 'POST', body: JSON.stringify({ storeId: sid, date: d9, isClosed: false, openTime: '10:00', closeTime: '20:00' }) }, shop.token)
        rr = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ serviceId: shop.serviceId, technicianId: shop.tech2, date: d9, time: '12:00', newCustomerName: `休息日客${RUN_ID}` }) }, shop.token)
        check('㉒ D34 改营业后放行', rr.status === 201 || rr.status === 200, JSON.stringify(rr.data).slice(0, 120))
      }

      // ㉓ D35(核查二抓获,2026-08-12):默认店(旗舰)客户列表不得含他店档案 ——
      //    历史 bug=默认店不加过滤全库大杂烩;统一口径后跨租户逐向断言。
      {
        const nbCust = await directBooking(shop, { name: `串味检客${RUN_ID}`, time: '09:15', techId: shop.tech2 })
        const defList = await request('/admin/customers', {}, PLATFORM)   // PLATFORM=默认店 owner
        check('㉓ D35 默认店客户列表不含测试店档案', defList.status === 200 && !(defList.data.customers || []).some((c) => c.id === nbCust.user.id), `混入 ${nbCust.user.id}`)
        const shopList = await request('/admin/customers', {}, shop.token)
        check('㉓ D35 测试店列表含自己的档案(过滤没矫枉过正)', (shopList.data.customers || []).some((c) => c.id === nbCust.user.id))
        // D35-b:拿他店档案在默认店直接排单=400(D19 storeId 拦截的 userId 姊妹条)
        const cross = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: nbCust.user.id, serviceId: 'facial-basic', date: dateStr(3), time: '10:00', technicianId: 'tech-mia' }) }, PLATFORM)
        check('㉓ D35-b 他店档案跨店排单=400 USER_TENANT_MISMATCH', cross.status === 400 && cross.data.error && cross.data.error.code === 'USER_TENANT_MISMATCH', JSON.stringify(cross.data).slice(0, 140))
      }

      // ㉔ 拍板①(店主 2026-08-12,《财务总逻辑》恒等式区):积分口径 B ——
      //    新单积分 ≡ 档位小计 × 1元=1分(不按标价、不按实收);历史单不追溯;
      //    积分列表必须能加总出余额(D36 三账不齐的闭环断言)。
      {
        // 新口径侧:测试店 demo 顾客,明天的单(永远 ≥ 切换时点),结算 qty2+自选 1234 分币
        const pm = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId }) }, null, { 'x-tenant-id': shop.tenantId })
        const ptok = pm.data.auth.accessToken
        const puid = pm.data.user.id
        const mall0 = await request('/my/points-mall', {}, ptok, { 'x-tenant-id': shop.tenantId })
        const bal0 = mall0.data.balance || 0
        const pbk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: puid, serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(2), time: '13:15' }) }, shop.token)
        check('㉔ 积分 fixture 排单成功', pbk.status === 201 || pbk.status === 200, JSON.stringify(pbk.data).slice(0, 120))
        const pmk = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({
          userId: puid, payerUserId: puid, cardOwnerUserId: puid, payIntent: 'offline_full',
          settlements: [{ bookingId: pbk.data.booking.id, tierKey: 'list', items: [{ serviceId: shop.serviceId, qty: 2 }], customItems: [{ name: '积分分币项', amountCents: 1234 }], technicians: [{ technicianId: shop.tech1, role: 'main', itemNos: [] }], servedPersonName: '' }]
        }) }, shop.token)
        const pst = pmk.data.settlements[0]
        const listPrice = pbk.data.booking.servicePriceCents || pbk.data.booking.service_price_cents || 0
        check('㉔ 前提:档位小计 ≠ 预约标价(否则新旧口径无法区分)', pst.subtotalCents !== listPrice, `subtotal=${pst.subtotalCents} list=${listPrice}`)
        const midBal = (await request('/my/points-mall', {}, ptok, { 'x-tenant-id': shop.tenantId })).data.balance || 0
        check('㉔ 未签不产生积分(积分随签署,不随开单)', midBal === bal0, `${bal0}→${midBal}`)
        const sg = await request(`/settlements/${encodeURIComponent(pst.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '积分口径B验签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
        check('㉔ 签署成功', sg.status === 200, JSON.stringify(sg.data).slice(0, 120))
        const mall1 = await request('/my/points-mall', {}, ptok, { 'x-tenant-id': shop.tenantId })
        const bal1 = mall1.data.balance || 0
        const wantPts = Math.floor(pst.subtotalCents / 100)
        check('㉔ 新单积分 ≡ 档位小计(floor 到分币)', bal1 - bal0 === wantPts, `Δ=${bal1 - bal0} 应为 ${wantPts}(subtotal=${pst.subtotalCents})`)
        check('㉔ 新单积分 ≠ 旧口径(预约标价推导)', bal1 - bal0 !== Math.floor(listPrice / 100), `旧口径会给 ${Math.floor(listPrice / 100)}`)
        const histSum = (mall1.data.history || []).reduce((n, h) => n + (h.delta || 0), 0)
        check('㉔ D36 三账闭环:积分明细加总 ≡ 余额(赚分行+兑换行同列)', histSum === bal1, `Σ明细=${histSum} 余额=${bal1}`)
        check('㉔ 明细里有这笔赚分行', (mall1.data.history || []).some((h) => h.delta === wantPts), JSON.stringify(mall1.data.history).slice(0, 160))
        // 历史不追溯侧:默认店 demo 顾客的种子单全在切换时点前 —— API 余额必须等于旧口径直算
        if (process.env.TEST_DB_PATH) {
          const dm = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe' }) }, null, { 'x-tenant-id': 'lucky-luxe' })
          const dbL = new DatabaseSync(process.env.TEST_DB_PATH)
          const frac = dbL.prepare("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND tenant_id = 'lucky-luxe' AND status IN ('COMPLETED', 'AFTER_SALES') AND service_price_cents % 100 != 0").get(dm.data.user.id).n
          const legacySum = dbL.prepare("SELECT COALESCE(SUM(service_price_cents / 100), 0) AS s FROM bookings WHERE user_id = ? AND tenant_id = 'lucky-luxe' AND status IN ('COMPLETED', 'AFTER_SALES') AND appointment_start < '2026-08-14T00:00:00.000Z'").get(dm.data.user.id).s // 口径②:售后中的单照常计积分
          const ledgerSum = dbL.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM points_transactions WHERE user_id = ? AND tenant_id = 'lucky-luxe'").get(dm.data.user.id).s
          dbL.close()
          check('㉔ 前提:种子单无分币残数(旧口径 floor(Σ) 与 Σfloor 等值)', frac === 0, `${frac} 单带分币`)
          const dBal = (await request('/my/points-mall', {}, dm.data.auth.accessToken, { 'x-tenant-id': 'lucky-luxe' })).data.balance || 0
          check('㉔ 历史积分不追溯(切换前种子单仍按标价推导,一分不动)', dBal === legacySum + ledgerSum, `API=${dBal} 直算=${legacySum}+${ledgerSum}`)
        } else check('㉔ (跳过)无 TEST_DB_PATH,历史不追溯直算未跑', true)

        // ㉕ 拍板②(2026-08-12):等级单源=租户配置。lucky-luxe 迁移开分级(原全局梯子入配置);
        //    未配置租户(本测试店)=不分级 → 称谓「会员」+空梯子(三减法的服务端根)。
        const luckyU = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe' }) }, null, { 'x-tenant-id': 'lucky-luxe' })).data.user
        check('㉕ lucky-luxe 分级开启且梯子来自租户配置(4 档)', luckyU.membershipTiersEnabled === true && (luckyU.memberTiers || []).length === 4 && luckyU.memberLevel !== '会员', `${luckyU.memberLevel}/${(luckyU.memberTiers || []).length}`)
        check('㉕ 未配置租户=不分级:称谓「会员」+空梯子', pm.data.user.membershipTiersEnabled === false && (pm.data.user.memberTiers || []).length === 0 && pm.data.user.memberLevel === '会员', `${pm.data.user.memberLevel}/${(pm.data.user.memberTiers || []).length}`)

        // ㉖ D38(2026-08-12 末验):累计消费 ≡ Σ已签结算单档位小计(与积分同基数);
        //    口径②:签署后预约转售后,积分与累计消费都不增不减(已签即计,不要复杂逻辑)
        {
          const u1 = (await request(`/users/${puid}`, {}, ptok, { 'x-tenant-id': shop.tenantId })).data.user
          const spentBefore = pm.data.user.totalSpentCents || 0
          check('㉖ D38 累计消费Δ ≡ 本次签署档位小计', (u1.totalSpentCents - spentBefore) === pst.subtotalCents, `Δ=${u1.totalSpentCents - spentBefore} 应为 ${pst.subtotalCents}`)
          check('㉖ D38 累计消费 ≠ 预约标价口径', (u1.totalSpentCents - spentBefore) !== listPrice, `标价口径会给 ${listPrice}`)
          const flip = await request(`/admin/bookings/${pbk.data.booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'AFTER_SALES', note: '㉖ 口径② fixture:签后转售后' }) }, shop.token)
          check('㉖ 口径② fixture 转售后成功', flip.status === 200, JSON.stringify(flip.data).slice(0, 100))
          const balAS = (await request('/my/points-mall', {}, ptok, { 'x-tenant-id': shop.tenantId })).data.balance || 0
          check('㉖ 口径② 售后中积分不增不减(已签即计)', balAS === bal1, `${bal1}→${balAS}`)
          const u2 = (await request(`/users/${puid}`, {}, ptok, { 'x-tenant-id': shop.tenantId })).data.user
          check('㉖ 口径② 售后中累计消费不变', u2.totalSpentCents === u1.totalSpentCents, `${u1.totalSpentCents}→${u2.totalSpentCents}`)
          await request(`/admin/bookings/${pbk.data.booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED', note: '㉖ fixture 还原' }) }, shop.token)
        }
      }

      const NAV_BASELINE = 106
      check(`㉑ 裸导航调用数 ≤ 基线 ${NAV_BASELINE}(F2 只减不增;新增代码走 utils/nav.js)`, navCount <= NAV_BASELINE, `当前 ${navCount}`)
    }

    // ===== ⑲ D28:单据预览排版件 —— 合计≡各单之和、行≡落库行、单号可查 =====
    {
      const pb = await directBooking(shop, { name: `预览客${RUN_ID}`, time: '12:30', techId: shop.tech2 })
      const made = await request('/admin/settlements', {
        method: 'POST', body: JSON.stringify({
          userId: pb.user.id, payerUserId: pb.user.id, cardOwnerUserId: pb.user.id, payIntent: 'offline_full',
          settlements: [
            { bookingId: pb.id, tierKey: 'list', items: [{ serviceId: shop.serviceId, qty: 1 }], customItems: [{ name: '预览自选', amountCents: 1200 }], technicians: [{ technicianId: shop.tech1, role: 'main', itemNos: [1] }], servedPersonName: '' },
            { tierKey: 'list', items: [{ serviceId: shop.serviceId, qty: 1 }], customItems: [], technicians: [{ technicianId: shop.tech2, role: 'main', itemNos: [] }], servedPersonName: '预览朋友' }
          ]
        })
      }, shop.token)
      const rows2 = made.data.settlements
      const pc = await request(`/admin/settlements/${rows2[0].id}/preview-card`, {}, shop.token)
      check('⑲ 排版件 200 且分组数=组内单数', pc.status === 200 && pc.data.card.groups.length === 2, JSON.stringify(pc.data).slice(0, 150))
      const t = pc.data.card.totals
      const sum2 = (k) => rows2.reduce((n, r) => n + (r[k] || 0), 0)
      check('⑲ 排版件合计≡各单之和(原价/小计/应收)', t.listTotalCents === sum2('listTotalCents') && t.subtotalCents === sum2('subtotalCents') && t.dueCents === sum2('totalCents'), JSON.stringify(t))
      check('⑲ 组② 标题带被服务者', pc.data.card.groups[1].title.includes('预览朋友'))
      check('⑲ 待签状态章=已结算待签(未签无签名区)', pc.data.card.statusKey === 'pending' && pc.data.card.signature === null)
      check('⑲ 用单号也能查同一张', (await request(`/admin/settlements/${encodeURIComponent(rows2[0].code)}/preview-card`, {}, shop.token)).data.card.settlementId === rows2[0].id)
      check('⑲ 金额纯 cents(币符前端拼)', !JSON.stringify(pc.data.card.totals).match(/[¥$]/))
      for (const s2 of rows2) await request(`/admin/settlements/${s2.id}/void`, { method: 'POST', body: JSON.stringify({ reason: 'CI ⑲ 排版件断言,即建即撤' }) }, shop.token)
      check('⑲ 全撤后排版件=410(voided 不出预览,也不出假「已签署」)', (await request(`/admin/settlements/${rows2[0].id}/preview-card`, {}, shop.token)).status === 410)
    }
  }

  console.log(`\n爽约处置+售后完成态回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`)
  process.exit(1)
})
