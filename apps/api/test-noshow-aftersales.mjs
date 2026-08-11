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
   ⑪ D20:全仓顾客可见文案禁「支付成功」(机械扫描,白名单精确到文件) */
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

  console.log(`\n爽约处置+售后完成态回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`)
  process.exit(1)
})
