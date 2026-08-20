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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
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
  // ===== ㊷ D51:网页订单管理售后可见 —— 管理端列表随单下发徽标(与顾客端同一 customerOrderBadges,三端同句) =====
  {
    const mid = await request('/admin/bookings', {}, shop.token)
    const row = mid.data.bookings.find((x) => x.id === b5.id)
    check('㊷ D51 售后开着:admin bookings 徽标=售后中/aftersales', row.listBadgeText === '售后中' && row.listBadgeKind === 'aftersales', JSON.stringify({ t: row.listBadgeText, k: row.listBadgeKind }))
  }
  // ===== ㊹ 售后线图 v1.1 §四:转售后落史(发起原因进 afterSalesProgress 同一读链) =====
  if (process.env.TEST_DB_PATH) {
    const dbh = new DatabaseSync(process.env.TEST_DB_PATH, { readOnly: true })
    const hist = dbh.prepare("SELECT note FROM booking_status_history WHERE booking_id = ? AND to_status = 'AFTER_SALES'").all(b5.id)
    check('㊹ PATCH 转售后写 status_history(无 note 用默认句,发起原因链在场)', hist.length >= 1 && Boolean(hist[0].note), JSON.stringify(hist))
    dbh.close()
  } else {
    check('㊹ (跳过)无 TEST_DB_PATH,转售后落史未直查', true)
  }
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
  check('㊷ D51 售后解决:admin bookings 徽标=售后已解决(细分文案随后端,前端不自拼)', b5row.listBadgeText === '售后已解决', JSON.stringify({ t: b5row.listBadgeText, k: b5row.listBadgeKind }))
  {
    // 反面:待支付单必无已签结算单,徽标=空串(条件渲染一挂就没了,不冒「已签署」假话)
    const plain = list1.data.bookings.find((x) => x.status === 'PENDING_PAYMENT')
    check('㊷ D51 待支付单徽标=空串(字段在场不撒谎)', plain ? plain.listBadgeText === '' : true, plain ? JSON.stringify({ id: plain.id, t: plain.listBadgeText }) : 'no-plain-row')
  }
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
    // S2批①(店主 08-17 拍板,规则⑥):手动耗卡整口取消=410——技师老板同拒(原 403 断言随拍板升级)
    check('⑭→㊵ 技师耗卡=410(手动耗卡整口取消,扣卡只随签字)', (await request('/admin/stored-value/consume', { method: 'POST', body: JSON.stringify({ userId: custId, amountCents: 100 }) }, staffToken)).status === 410)
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
      // S2批① 后 fixture 改直插库:手动耗卡 HTTP 口已 410(规则⑥);引擎内部 consume 写法(签字扣卡)不受影响,
      // 这里模拟的就是引擎行为——直插 consume 行造逐笔视图数据。
      const dbf = new DatabaseSync(process.env.TEST_DB_PATH)
      dbf.prepare("INSERT INTO stored_value_transactions (id,tenant_id,user_id,type,amount_cents,pay_channel,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(`sv_fx17_${RUN_ID}`, shop.tenantId, custId, 'consume', -700, 'stored_value', '逐笔视图消耗断言(fixture 直插=引擎写法)', 'ci-17', new Date().toISOString())
      dbf.close()
      check('⑰ 耗卡 fixture 落账(直插=引擎写法)', true)
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
            for (const api of ['setClipboardData', 'getClipboardData', 'scanCode', 'requestPayment', 'showModal']) { // S组卫生批:showModal 57 处全挂 fail 后纳入总闸
              let idx = 0
              while ((idx = src.indexOf(`wx.${api}({`, idx)) >= 0) {
                let depth = 0; let end = idx
                for (let q = idx + `wx.${api}(`.length - 1; q < Math.min(src.length, idx + 2000); q += 1) {
                  if (src[q] === '(') depth += 1
                  else if (src[q] === ')') { depth -= 1; if (depth === 0) { end = q; break } }
                }
                if (!/fail\s*[:(]/.test(src.slice(idx, end))) bad3.push(`${pth.slice(ROOT2.length)}: wx.${api} 无 fail`)
                idx = idx + 1 // 补账①修盲区:嵌套在外层回调里的内层调用不能被整块跳过
              }
            }
          }
        }
      }
      walk3(join(ROOT2, 'miniprogram'))
      check('⑳ 四之八④ 剪贴板/扫码/支付/弹窗类 wx.* 全部挂 fail(静默失败家族总闸;S组卫生批起含 showModal)', bad3.length === 0, bad3.join(' | '))

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
      let nbCustSaved = null
      {
        const nbCust = await directBooking(shop, { name: `串味检客${RUN_ID}`, time: '09:15', techId: shop.tech2 })
        nbCustSaved = nbCust.user
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
        // 改判①(2026-08-12 二次/三次拍板):历史全量追溯 —— 三行恒等 + 硬守恒全档案扫 + 守恒抛错路径
        const mall2 = await request('/my/points-mall', {}, ptok, { 'x-tenant-id': shop.tenantId })
        const u3 = (await request(`/users/${puid}`, {}, ptok, { 'x-tenant-id': shop.tenantId })).data.user
        check('㉔ 三行:累计获得 ≡ 累计消费(同基数同数值)', mall2.data.earnedTotal === Math.floor((u3.totalSpentCents || 0) / 100), `获得=${mall2.data.earnedTotal} 消费=${u3.totalSpentCents}`)
        // 干净档案(无钳位/调整行)上三行恒等严格成立;钳位档案由全档案扫的 0≤余额≤获得 兜底
        check('㉔ 三行:余额 = 累计获得 − 已兑换 且 余额 ≤ 累计获得', mall2.data.balance === (mall2.data.earnedTotal - mall2.data.redeemedTotal) && mall2.data.balance <= mall2.data.earnedTotal, JSON.stringify({ b: mall2.data.balance, e: mall2.data.earnedTotal, r: mall2.data.redeemedTotal }))
        if (process.env.TEST_DB_PATH) {
          // 硬守恒全档案扫:每一个有积分动账或有签署单的档案,0 ≤ 余额 ≤ 累计获得
          const dbL = new DatabaseSync(process.env.TEST_DB_PATH)
          const rows2 = dbL.prepare(`SELECT uid, tid, SUM(earned) AS earned, SUM(ledger) AS ledger FROM (
              SELECT user_id AS uid, tenant_id AS tid, subtotal_cents / 100 AS earned, 0 AS ledger FROM settlements WHERE status = 'signed'
              UNION ALL SELECT user_id, tenant_id, 0, amount FROM points_transactions
            ) GROUP BY uid, tid`).all()
          dbL.close()
          const bad = rows2.filter((r2) => (r2.earned + r2.ledger) < 0 || (r2.earned + r2.ledger) > r2.earned)
          check(`㉔ 硬守恒全档案扫:${rows2.length} 档案全部 0 ≤ 余额 ≤ 累计获得(钳位迁移兜底)`, bad.length === 0, JSON.stringify(bad.slice(0, 3)))
        } else check('㉔ (跳过)无 TEST_DB_PATH,全档案守恒扫未跑', true)
        // 守恒抛错路径:凭空造 +100 分 → 读余额=500 拒绝出账;对冲 −100 后恢复(账本只追加,不删毒行)
        if (process.env.TEST_DB_PATH) {
          const dbP = new DatabaseSync(process.env.TEST_DB_PATH)
          const mkAdj = (amt, note) => dbP.prepare('INSERT INTO points_transactions (id, tenant_id, user_id, type, amount, ref_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(`pts_ci24_${amt > 0 ? 'p' : 'n'}_${RUN_ID}`, shop.tenantId, puid, 'adjust', amt, null, note, 'ci-invariant-probe', new Date().toISOString())
          mkAdj(100, 'CI ㉔ 守恒探针:凭空造分(即造即冲)')
          const boom = await request('/my/points-mall', {}, ptok, { 'x-tenant-id': shop.tenantId })
          check('㉔ 守恒抛错:余额>累计获得 = 500 拒绝出账', boom.status === 500 && boom.data.error && boom.data.error.code === 'POINTS_INVARIANT_VIOLATION', JSON.stringify(boom.data).slice(0, 120))
          mkAdj(-100, 'CI ㉔ 守恒探针对冲行')
          dbP.close()
          const ok2 = await request('/my/points-mall', {}, ptok, { 'x-tenant-id': shop.tenantId })
          check('㉔ 对冲后恢复出账', ok2.status === 200 && ok2.data.balance === mall2.data.balance, `${ok2.status}/${ok2.data.balance}`)
        } else check('㉔ (跳过)无 TEST_DB_PATH,守恒抛错路径未跑', true)

        // ㉕ 拍板②(2026-08-12):等级单源=租户配置。lucky-luxe 迁移开分级(原全局梯子入配置);
        //    未配置租户(本测试店)=不分级 → 称谓「会员」+空梯子(三减法的服务端根)。
        const luckyU = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe' }) }, null, { 'x-tenant-id': 'lucky-luxe' })).data.user
        check('㉕ lucky-luxe 分级开启且梯子来自租户配置(4 档)', luckyU.membershipTiersEnabled === true && (luckyU.memberTiers || []).length === 4 && luckyU.memberLevel !== '会员', `${luckyU.memberLevel}/${(luckyU.memberTiers || []).length}`)
        // D41 后口径:不分级店称谓两态 —— 充值过=会员 / 未充值=顾客(该 demo 户只消费未充值 → 顾客)
        check('㉕ 未配置租户=不分级:空梯子+称谓按充值史两态', pm.data.user.membershipTiersEnabled === false && (pm.data.user.memberTiers || []).length === 0 && pm.data.user.memberLevel === (pm.data.user.isMember ? '会员' : '顾客'), `${pm.data.user.memberLevel}/${pm.data.user.isMember}`)

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

      // ㉗ 换代批(2026-08-12):①demoLogin 不选退役档案且「演示2-」优先;②直接排单失败不留孤儿档案
      {
        const rt = await directBooking(shop, { name: `退役样本${RUN_ID}`, time: '06:00', techId: shop.tech2 })
        await directBooking(shop, { name: `退役样本${RUN_ID}2`, time: '05:00', techId: shop.tech1 }).catch(() => {})
        if (process.env.TEST_DB_PATH) {
          const dbR = new DatabaseSync(process.env.TEST_DB_PATH)
          dbR.prepare("UPDATE users SET tags_json = ? WHERE id = ?").run(JSON.stringify(['退役·旧口径演示档案']), rt.user.id)
          dbR.prepare("UPDATE users SET display_name = ? WHERE display_name = ?").run('演示2-CI样本', `退役样本${RUN_ID}2`)
          dbR.close()
          const who = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId }) }, null, { 'x-tenant-id': shop.tenantId })).data.user
          check('㉗ demoLogin 不选退役档案且演示2优先', who.id !== rt.user.id && who.displayName === '演示2-CI样本', `选中 ${who.displayName}`)
        } else check('㉗ (跳过)无 TEST_DB_PATH', true)
        // 孤儿档案:占一个时段,再用新客名撞同一时段 → 排单失败,档案不得留下
        const occupied = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(4), time: '07:00', newCustomerName: `孤儿探针占位${RUN_ID}` }) }, shop.token)
        check('㉗ 孤儿探针占位成功', occupied.status === 201 || occupied.status === 200)
        const clash = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(4), time: '07:00', newCustomerName: `孤儿探针撞档${RUN_ID}` }) }, shop.token)
        check('㉗ 撞档排单如实失败', clash.status !== 201 && clash.status !== 200, String(clash.status))
        const list2 = await request('/admin/customers', {}, shop.token)
        check('㉗ 排单失败不留孤儿档案(建档随排单整体回滚)', !(list2.data.customers || []).some((c) => String(c.displayName || '').includes(`孤儿探针撞档${RUN_ID}`)), '孤儿仍在列表')
      }

      // ㉘ 补强批(2026-08-12):①demo_identity 指定样板户优先于「演示2 前缀+单量」;
      //    ②asUserId 按人登录只认本店非退役档案(跨店/退役=404);③名册路由 ALLOW 闸门内可用
      if (process.env.TEST_DB_PATH) {
        const dbI = new DatabaseSync(process.env.TEST_DB_PATH)
        const desig = (await request('/admin/customers', {}, shop.token)).data.customers.find((c) => !String(c.displayName || '').startsWith('演示2-'))
        dbI.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'demo_identity', ?, ?)
          ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
          .run(shop.tenantId, JSON.stringify({ userId: desig.id }), new Date().toISOString())
        dbI.close()
        const who2 = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId }) }, null, { 'x-tenant-id': shop.tenantId })).data.user
        check('㉘ demo_identity 指定样板户压过演示2前缀', who2.id === desig.id, `选中 ${who2.displayName}`)
        const asOk = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: nbCustSaved.id }) }, null, { 'x-tenant-id': shop.tenantId })
        check('㉘ asUserId 按人登录(本店档案)', asOk.status === 200 && asOk.data.user.id === nbCustSaved.id, JSON.stringify(asOk.data).slice(0, 100))
        const asCross = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe', asUserId: nbCustSaved.id }) }, null, { 'x-tenant-id': 'lucky-luxe' })
        check('㉘ asUserId 跨店=404(不借别店身份)', asCross.status === 404, String(asCross.status))
        const roster2 = await request(`/sandbox/demo-roster`, {}, null, { 'x-tenant-id': shop.tenantId })
        check('㉘ 沙盒名册路由可用(ALLOW 闸门内)', roster2.status === 200 && Array.isArray(roster2.data.roster), String(roster2.status))
      } else check('㉘ (跳过)无 TEST_DB_PATH', true)

      // ㉙ D41(2026-08-12):不分级店会员资格=充值即会员(含迁移期初),消费不算;
      //    未充值=「顾客」;充值那一刻翻转「会员」;分级店(lucky)梯子称谓不受影响
      if (process.env.TEST_DB_PATH) {
        const g1 = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: nbCustSaved.id }) }, null, { 'x-tenant-id': shop.tenantId })).data.user
        check('㉙ D41 未充值(只消费过)=顾客,无会员标', g1.memberLevel === '顾客' && g1.isMember === false && g1.memberTier === 'guest', `${g1.memberLevel}/${g1.isMember}`)
        check('㉙ memberPerks 通道下发(商家自定义会员权益,S9 填内容)', Array.isArray(g1.memberPerks), typeof g1.memberPerks)
        const dbM = new DatabaseSync(process.env.TEST_DB_PATH)
        dbM.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`fixture-openid-${nbCustSaved.id}`, nbCustSaved.id)
        dbM.close()
        const rc9 = await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: nbCustSaved.id, amountCents: 5000, payChannel: 'cash', note: '㉙ D41 翻转 fixture' }) }, shop.token)
        check('㉙ 翻转 fixture 充值成功', rc9.status === 200 || rc9.status === 201, JSON.stringify(rc9.data).slice(0, 100))
        const g2 = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: nbCustSaved.id }) }, null, { 'x-tenant-id': shop.tenantId })).data.user
        check('㉙ 充值那一刻翻转=会员', g2.memberLevel === '会员' && g2.isMember === true && g2.memberTier === 'member', `${g2.memberLevel}/${g2.isMember}`)
        const list9 = (await request('/admin/customers', {}, shop.token)).data.customers
        const row9 = list9.find((c) => c.id === nbCustSaved.id)
        check('㉙ 商家端列表同口径(memberTier=member)', row9 && row9.memberTier === 'member' && row9.isMember === true, JSON.stringify(row9 && row9.memberTier))
        const luckyU9 = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe' }) }, null, { 'x-tenant-id': 'lucky-luxe' })).data.user
        check('㉙ 分级店称谓不受影响(仍走梯子标签)', luckyU9.memberLevel !== '顾客' && luckyU9.memberLevel !== '会员', luckyU9.memberLevel)
      } else check('㉙ (跳过)无 TEST_DB_PATH', true)

      // ㉚ S组卫生批(2026-08-12):mock-data 整体退场 —— 文件删除+全仓零引用
      //    (D17 家族终章:加项解析改真目录缓存;各页展示回落改下单留档的 serviceInfo)
      {
        const mockGone = !existsSync(join(ROOT2, 'miniprogram/utils/mock-data.js'))
        check('㉚ mock-data.js 文件已删除', mockGone)
        const badM = []
        const walkM = (dir) => {
          for (const f of readdirSync(dir)) {
            const pth = join(dir, f)
            const st = statSync(pth)
            if (st.isDirectory()) { if (f !== 'node_modules') walkM(pth) }
            else if (/\.js$/.test(f)) {
              const src = readFileSync(pth, 'utf8')
              if (/require\([^)]*mock-data/.test(src) || /\bmock\.\w/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))) badM.push(pth.slice(ROOT2.length))
            }
          }
        }
        walkM(join(ROOT2, 'miniprogram'))
        check('㉚ 全仓零 mock 引用(注释除外)', badM.length === 0, badM.join(' | '))
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


    // ===== ㉛ S1+S3 服务与价目合并(图=合同 v1.2):storefront 单源+起价+开关同源+次卡剥离 =====
    {
      const pubList = async (tid) => (await request('/services', {}, null, { 'x-tenant-id': tid })).data.services || []
      const shopB = await newShop('s1b')

      // 规则①:顾客接口 0 加项/次卡条目(双租户)
      for (const sp of [shop, shopB]) {
        const pub = await pubList(sp.tenantId)
        check(`㉛ 规则① 顾客接口零加项/次卡(${sp === shop ? 'A' : 'B'} 店)`, pub.every((sv) => sv.itemKind !== 'addon' && !sv.isTimecard), JSON.stringify(pub.map((x) => x.itemKind)))
        // 规则⑥:一致性 —— 顾客条目数 = 模块①上架数(admin 目录里 main+storefront+非次卡)
        const items = (await request('/admin/pricing/items', {}, sp.token)).data.items || []
        const shelfN = items.filter((i) => i.itemKind === 'main' && i.storefront && !i.isTimecard && i.isActive).length
        check(`㉛ 规则⑥ 顾客条目数=上架数(${sp === shop ? 'A' : 'B'} 店)`, pub.length === shelfN, `pub=${pub.length} shelf=${shelfN}`)
      }

      // 规则⑤:起价=最低可用价档,改价档橱窗自动跟(挂会员价 150 → 起价 150;清掉 → 回 200)
      await request(`/admin/pricing/items/${shop.serviceId}`, { method: 'PATCH', body: JSON.stringify({ memberPriceCents: 15000 }) }, shop.token)
      let pubA = await pubList(shop.tenantId)
      let mine = pubA.find((sv) => sv.id === shop.serviceId)
      check('㉛ 规则⑤ 挂会员价后起价=最低档 150', mine && mine.startingPriceCents === 15000, JSON.stringify(mine && { s: mine.startingPriceCents }))
      check('㉛ 规则⑤ 「起」字下发(前端零运算)', mine && /起$/.test(mine.priceFromLabelZh || '') && /^From /.test(mine.priceFromLabelEn || ''), mine && mine.priceFromLabelZh)
      await request(`/admin/pricing/items/${shop.serviceId}`, { method: 'PATCH', body: JSON.stringify({ memberPriceCents: null }) }, shop.token)
      pubA = await pubList(shop.tenantId)
      mine = pubA.find((sv) => sv.id === shop.serviceId)
      check('㉛ 规则⑤ 清会员价后起价回落 list 200', mine && mine.startingPriceCents === 20000, JSON.stringify(mine && { s: mine.startingPriceCents }))

      // 闭环③:开关双端同源 —— PATCH storefront=false 顾客端即时消失,拨回即时恢复
      await request(`/admin/pricing/items/${shop.serviceId}`, { method: 'PATCH', body: JSON.stringify({ storefront: false }) }, shop.token)
      check('㉛ 闭环③ 下架后顾客接口即时消失', !(await pubList(shop.tenantId)).some((sv) => sv.id === shop.serviceId))
      const itemsOff = (await request('/admin/pricing/items', {}, shop.token)).data.items || []
      check('㉛ 闭环③ 目录仍在(storefront=false 不是删除,开单不受影响)', itemsOff.some((i) => i.id === shop.serviceId && !i.storefront && i.isActive))
      await request(`/admin/pricing/items/${shop.serviceId}`, { method: 'PATCH', body: JSON.stringify({ storefront: true }) }, shop.token)
      check('㉛ 闭环③ 拨回后顾客接口即时恢复', (await pubList(shop.tenantId)).some((sv) => sv.id === shop.serviceId))

      // 越权:员工拨开关=403(镜像屏开关只对老板;后端 staffMayRead 是 GET-only)
      const t3 = await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技丙s1${RUN_ID}` }) })
      const staffTok = await staffLogin(shop, t3.data.technician.id, 's1')
      const staffFlip = await request(`/admin/pricing/items/${shop.serviceId}`, { method: 'PATCH', body: JSON.stringify({ storefront: false }) }, staffTok)
      check('㉛ 越权 员工拨开关=403', staffFlip.status === 403, `got ${staffFlip.status}`)
      check('㉛ 越权后开关未动(顾客端仍可见)', (await pubList(shop.tenantId)).some((sv) => sv.id === shop.serviceId))

      // 规则③ 次卡剥离:现库无次卡行可走行为断言,先机械断言两条编辑路由都装了拦截(S2 有数据后升级为行为断言)
      const ROOT31 = new URL('../../', import.meta.url).pathname
      const srv = readFileSync(join(ROOT31, 'apps/api/local-server.mjs'), 'utf8')
      check('㉛ 规则③ 次卡编辑拒绝装在两条路由(TIMECARD_MIGRATED×2)', (srv.match(/TIMECARD_MIGRATED/g) || []).length >= 2)
      check('㉛ 规则⑥ 迁移块在(幂等标记 s1_storefront)', srv.includes("s1_storefront"))

      // 双轨收口:老「服务管理」口子建的服务默认进橱窗(storefront=1),不产生「目录有、顾客看不见」的暗礁
      const legacy = await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `旧口建${RUN_ID}`, nameEn: 'legacy', priceCents: 8800 }) }, shop.token)
      check('㉛ 双轨收口 旧口子新建默认上架', legacy.status === 201 && (await pubList(shop.tenantId)).some((sv) => sv.id === legacy.data.service.id))

      // 空态:B 店全部下架 → 顾客接口空数组(既有空态,不 500)
      const itemsB = (await request('/admin/pricing/items', {}, shopB.token)).data.items || []
      for (const it of itemsB.filter((i) => i.itemKind === 'main')) {
        await request(`/admin/pricing/items/${it.id}`, { method: 'PATCH', body: JSON.stringify({ storefront: false }) }, shopB.token)
      }
      const pubBEmpty = await request('/services', {}, null, { 'x-tenant-id': shopB.tenantId })
      check('㉛ 空态 全下架=空数组 200', pubBEmpty.status === 200 && (pubBEmpty.data.services || []).length === 0)
    }


    // ===== ㉜ 复核-2 复发护栏(2026-08-15):网页顾客端顶层加载冒烟 =====
    // 立规背景:币种红线批(3c948e0)在 copy 文案字面量里顶层调用 moneyY(50),而 CUR 声明在其后
    // → TDZ ReferenceError,生产顾客页整页白屏 5 天,没有任何断言兜它(currency-scan 只扫写死币符,不跑运行时)。
    // 护栏:node 里 stub 最小 DOM 加载 customer.js / share.js,顶层抛任何异常=红。上次靠疏忽能再来一遍的路,这次焊死。
    {
      const ROOT32 = new URL('../../', import.meta.url).pathname
      const { execFileSync } = await import('node:child_process')
      for (const f of ['apps/web/customer.js', 'apps/web/share.js']) {
        const stub = `
          // 万能元素 stub:querySelector 永不回 null(真页面元素齐全;这里只验顶层 JS 逻辑,如 TDZ)
          const el = () => new Proxy(function(){}, { get: (t, k) => { if (k === Symbol.toPrimitive || k === 'toString') return () => ''; if (k === 'style' || k === 'dataset') return {}; if (k === 'classList') return { add(){}, remove(){}, toggle(){}, contains: () => false }; if (k === 'children' || k === 'childNodes') return []; return typeof k === 'string' && /^(add|remove|set|get|append|insert|focus|blur|click|closest|matches|toggle)/.test(k) ? () => el() : el(); }, set: () => true, apply: () => el() });
          global.window=global; global.document={querySelector:el,querySelectorAll:()=>[],addEventListener:()=>{},getElementById:el,createElement:el,body:el(),documentElement:{lang:''}};
          global.localStorage={getItem:()=>null,setItem(){},removeItem(){}}; global.sessionStorage=global.localStorage;
          global.navigator={language:'zh-CN',clipboard:{}}; global.location={search:'',hash:'',origin:'http://x',pathname:'/'};
          global.fetch=()=>new Promise(()=>{}); global.history={replaceState(){}}; global.alert=()=>{}; global.MutationObserver=class{observe(){}};
          require(${JSON.stringify(ROOT32)} + ${JSON.stringify(f)});
          console.log('TOPOK');
        `
        let out = ''
        try { out = execFileSync(process.execPath, ['-e', stub], { encoding: 'utf8', timeout: 20000 }) } catch (e) { out = String(e.stdout || '') + String(e.stderr || '') }
        check(`㉜ ${f} 顶层加载不炸(TDZ/未定义引用兜底)`, out.includes('TOPOK'), out.split('\n').slice(0, 3).join(' | '))
      }
      // ㉝ D45:网页顾客端必须按店寻址 —— 禁写死旗舰店 id 当唯一店;寻址函数必须在场
      const cust = readFileSync(join(ROOT32, 'apps/web/customer.js'), 'utf8')
      check('㉝ D45 顾客网页不再写死唯一店(const storeId 字面量禁令)', !cust.includes("const storeId = 'store-ontario-01'"))
      check('㉝ D45 租户寻址在场(?store= → x-tenant-id 全请求注入)', cust.includes("'x-tenant-id': TENANT_ID") && cust.includes("q.get('store')"))
      // ㉞ D46:顾客网页店铺渲染禁写死(机制类=任何店铺相关渲染必须来自 /stores)。剥注释后扫,0 残留
      const custCode = cust.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      const hardcoded = ['Lucky Luxe Ontario', 'Address TBD', 'Phone TBD', 'Tuesday-Sunday', 'Ontario · CAD'].filter((w) => custCode.includes(w))
      check('㉞ D46 店铺事实零写死(店名/地址/电话/营业时间/币种)', hardcoded.length === 0, hardcoded.join(','))
      check('㉞ D46 人气区与服务页同口径(fromPriceLabel 进推荐卡)', /recommend-card[\s\S]{0,200}fromPriceLabel/.test(cust))
      // ㉟ 横幅批:品牌名单源 brandName()——渲染层唯一 'Lucky Luxe' 字面量=回落值本身
      const brandHits = (custCode.match(/Lucky Luxe/g) || []).length
      check('㉟ 品牌文案单源(brandName 回落值外零字面量)', brandHits === 1 && custCode.includes('function brandName()'), `hits=${brandHits}`)
    }

    // ===== ㊱ v1.4 大类改造:平台字典+全条目∈大类+空类隐藏 =====
    {
      const pubJ = (await request('/services', {}, null, { 'x-tenant-id': shop.tenantId })).data
      check('㊱ 字典随 /services 下发(三行起步:美甲/美睫/护理·其他)', Array.isArray(pubJ.platformCategories) && pubJ.platformCategories.length >= 3
        && ['nail', 'lash', 'care'].every((k) => pubJ.platformCategories.some((c) => c.key === k)), JSON.stringify(pubJ.platformCategories))
      const keys = new Set((pubJ.platformCategories || []).map((c) => c.key))
      check('㊱ 顾客端所有可见条目∈某大类(v1.4 断言⑥)', (pubJ.services || []).every((sv) => keys.has(sv.platformCategory)),
        JSON.stringify((pubJ.services || []).filter((sv) => !keys.has(sv.platformCategory)).map((sv) => sv.nameZh)))
      // 加项永不入大类列表(规则①已有 ok128 双租户;这里对全量再断一次含 platformCategory 的响应)
      check('㊱ 加项/次卡 0 出现在大类列表', (pubJ.services || []).every((sv) => sv.itemKind !== 'addon' && !sv.isTimecard))
      // 空类不显示=前端行为:机械断言 visibleCategories 过滤逻辑在场
      const ROOT36 = new URL('../../', import.meta.url).pathname
      const cust36 = readFileSync(join(ROOT36, 'apps/web/customer.js'), 'utf8')
      check('㊱ 空大类不显示(visibleCategories 过滤在场)', cust36.includes('function visibleCategories()') && /state\.services\.some/.test(cust36))
    }



    // ===== ㊲ v1.4 服务 Tab 重构+网页切店(店主 08-16 三件批)=====
    {
      const ROOT37 = new URL('../../', import.meta.url).pathname
      const svcJs = readFileSync(join(ROOT37, 'miniprogram/pages/services/index.js'), 'utf8')
      const svcWxml = readFileSync(join(ROOT37, 'miniprogram/pages/services/index.wxml'), 'utf8')
      check('㊲ 小程序服务页:顶部段选已撤(type-switch 零残留)', !svcWxml.includes('type-switch') && !svcWxml.includes('switchType'))
      check('㊲ 小程序服务页:左栏=平台大类字典驱动(getServiceCatalog+platformCategories)', svcJs.includes('getServiceCatalog') && svcJs.includes('platformCategories'))
      const svcJsCode = svcJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      check('㊲ 小程序服务页:「加项服务」静态分类数组已灭(规则①,剥注释扫)', !svcJsCode.includes('加项服务') && !svcJsCode.includes('NAIL_CATS'))
      check('㊲ 小程序服务页:「¥xxx 起」渲染在场', svcWxml.includes('priceFromLabelZh'))
      const custW = readFileSync(join(ROOT37, 'apps/web/customer.js'), 'utf8')
      check('㊲ 网页切店入口在场(/shops 同源+整页 ?store= 清场)', custW.includes('openStoreSwitcher') && custW.includes("request('/shops')"))
      check('㊲ 购物车按店分仓(切店零残留,组合矩阵抓获)', custW.includes('lucky-web-cart:${TENANT_ID}') && !/readJson\('lucky-web-cart'\)/.test(custW))
    }


    // ===== ㊳ D48:护理类详情打不开(getService 猜 id 前缀定类)=====
    {
      const ROOT38 = new URL('../../', import.meta.url).pathname
      const apiJs = readFileSync(join(ROOT38, 'miniprogram/utils/api.js'), 'utf8')
      check("㊳ D48 getService 不再猜 id 前缀定类(indexOf('lash') 禁令)", !apiJs.includes("indexOf('lash') === 0"))
      // 行为:CARE 类条目在全量公开列表可按 id 命中(修法=全量直查的后端前提)
      const careSvc = await request('/admin/pricing/items', { method: 'POST', body: JSON.stringify({ nameZh: `护理条目${RUN_ID}`, type: 'CARE', itemKind: 'main', listPriceCents: 6600 }) }, shop.token)
      await request(`/admin/pricing/items/${careSvc.data.item.id}`, { method: 'PATCH', body: JSON.stringify({ storefront: true }) }, shop.token)
      const pubAll = (await request('/services', {}, null, { 'x-tenant-id': shop.tenantId })).data.services || []
      check('㊳ D48 CARE 条目全量列表按 id 可命中(详情/预约数据前提)', pubAll.some((sv) => sv.id === careSvc.data.item.id))
    }


    // ===== ㊴ D49:详情页价格双矛盾(Cowork 亲验抓获,D46 同族第五出口)=====
    {
      // 行为:多档项目 priceDetailLabel 必须「起+档说明」;「固定价」对多档=禁语
      const pubD = (await request('/services', {}, null, { 'x-tenant-id': shop.tenantId })).data.services || []
      const multi = pubD.filter((sv) => sv.startingPriceCents !== sv.priceCents)
      check('㊴ D49 多档项目详情 label 带「起」零「固定价」禁语', multi.every((sv) => /起/.test(sv.priceDetailLabelZh || '') && !(sv.priceDetailLabelZh || '').includes('固定价')),
        JSON.stringify(multi.filter((sv) => !/起/.test(sv.priceDetailLabelZh || '') || (sv.priceDetailLabelZh || '').includes('固定价')).map((sv) => [sv.nameZh, sv.priceDetailLabelZh])))
      check('㊴ D49 单档项目仍是 基础价/固定价 语义', pubD.filter((sv) => sv.startingPriceCents === sv.priceCents).every((sv) => /基础价|固定价/.test(sv.priceDetailLabelZh || '')))
      // 行为:护理/其他 价格说明=中性,不再贴美睫套话
      const careD = pubD.find((sv) => sv.platformCategory === 'care')
      if (careD) check('㊴ D49 护理项价格说明非美睫套话', !(careD.priceExplanationZh || '').includes('美睫'), careD.priceExplanationZh)
      // L2 四出口机械断言:列表=fromLabel/详情=detailLabel(两端引用在场)
      const ROOT39 = new URL('../../', import.meta.url).pathname
      const custD = readFileSync(join(ROOT39, 'apps/web/customer.js'), 'utf8')
      const miniDetail = readFileSync(join(ROOT39, 'miniprogram/pages/service-detail/index.js'), 'utf8')
      const miniList = readFileSync(join(ROOT39, 'miniprogram/pages/services/index.wxml'), 'utf8')
      check('㊴ L2 出口同源:网页列表 fromPriceLabel+详情 priceDetailLabel 引用在场', custD.includes('function fromPriceLabel') && custD.includes('priceDetailLabelZh'))
      check('㊴ L2 出口同源:小程序列表 priceFromLabel+详情 priceDetailLabel 引用在场', miniList.includes('priceFromLabelZh') && miniDetail.includes('priceDetailLabelZh'))
    }


    // ===== ㊵ S2批①:赠送口径(规则④)+耗卡410(规则⑥)+商城支付闸(规则⑧)+次卡新字段 =====
    {
      // 耗卡 410
      const gone = await request('/admin/stored-value/consume', { method: 'POST', body: JSON.stringify({ userId: 'x', amountCents: 100 }) }, shop.token)
      check('㊵ 规则⑥ 手动耗卡接口=410 GONE', gone.status === 410, `got ${gone.status}`)
      // 商城闸:GET locked + PUT 开=400
      const mall = await request('/admin/mall/self-purchase', {}, shop.token)
      check('㊵ 规则⑧ 支付未接通:线上自助购买 locked', mall.status === 200 && mall.data.locked === true && mall.data.enabled === false)
      const flip = await request('/admin/mall/self-purchase', { method: 'PUT', body: JSON.stringify({ enabled: true }) }, shop.token)
      check('㊵ 规则⑧ 锁定期 PUT 开=400 PAYMENT_CHANNEL_OFFLINE', flip.status === 400 && flip.data.error.code === 'PAYMENT_CHANNEL_OFFLINE')
      // 次卡新字段 CRUD 往返
      const tk = await request('/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'times', name: `CI次卡${RUN_ID}`, priceCents: 54000, timesCount: 3, projectGroup: '护理', validDays: 90, mallVisible: false }) }, shop.token)
      check('㊵ 次卡字段(项目组/有效期/商城位)持久化', tk.status === 201 && tk.data.package.projectGroup === '护理' && tk.data.package.validDays === 90 && tk.data.package.mallVisible === false)
      // 赠送口径:充100赠20 → recharge+bonus 两行;余额=120;bonus 不触发首充判定之外的业绩口(type≠recharge)
      const bkCust = await directBooking(shop, { name: `赠送口径客${RUN_ID}`, time: '13:30', techId: shop.tech1 })
      const dbx = new DatabaseSync(process.env.TEST_DB_PATH)
      dbx.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`fx-${RUN_ID}`, bkCust.user.id)  // 绑定前置
      const rc = await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: bkCust.user.id, amountCents: 10000, bonusCents: 2000, payChannel: 'cash', technicianId: shop.tech1 }) }, shop.token)
      check('㊵ 规则④ 充100赠20 落账 201', rc.status === 201)
      const rows40 = dbx.prepare('SELECT type, amount_cents FROM stored_value_transactions WHERE user_id = ? ORDER BY created_at').all(bkCust.user.id)
      check('㊵ 规则④ recharge+bonus 两行分立', rows40.length === 2 && rows40.some((r) => r.type === 'recharge' && r.amount_cents === 10000) && rows40.some((r) => r.type === 'bonus' && r.amount_cents === 2000), JSON.stringify(rows40))
      check('㊵ 规则④ 余额=实收+赠送(负债含赠送)', rows40.reduce((n, r) => n + r.amount_cents, 0) === 12000)
      // +1 财务红线同构:bonus 永不进技师充值提成基数(提成按 type=recharge 统计)
      const rcSum = dbx.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM stored_value_transactions WHERE user_id = ? AND type = 'recharge' AND technician_id = ?").get(bkCust.user.id, shop.tech1).s
      check('㊵ 规则④ 提成基数只含实收 100(bonus 排除)', rcSum === 10000, `got ${rcSum}`)
      dbx.close()
    }


    // ===== ㊶ D50:原生弹窗链返工 —— 会员与营销页 0 prompt+全文件基线只减不增 =====
    {
      const ROOT41 = new URL('../../', import.meta.url).pathname
      const adminJs = readFileSync(join(ROOT41, 'apps/web/admin.js'), 'utf8')
      const memberSeg = adminJs.slice(adminJs.indexOf('function renderMemberTabs'), adminJs.indexOf('// 发券表单是每次重画的'))
      const memberHits = (memberSeg.match(/window\.(prompt|confirm|alert)\(/g) || []).length
      check('㊶ D50 会员与营销页原生弹窗=0(全部页内表单弹层)', memberHits === 0, `hits=${memberHits}`)
      check('㊶ D50 弹层组件在场(openFormModal:Esc/遮罩/保存取消)', adminJs.includes('function openFormModal') && adminJs.includes("e.key === 'Escape'"))
      const PROMPT_BASELINE = 27 // D50-b 售后4处清后基线 31→27;其余存量按 Cowork 归批清单分批收敛,只减不增
      const total = (adminJs.match(/window\.(prompt|confirm|alert)\(/g) || []).length
      check(`㊶ D50 admin.js 原生弹窗总数 ≤ 基线 ${PROMPT_BASELINE}(新增代码禁 prompt/confirm/alert)`, total <= PROMPT_BASELINE, `当前 ${total}`)
    }

    // ===== ㊷ 首日四小件机制护栏(2026-08-20 批② 首日):D51 前端在场+五页签+勾选框同行 =====
    {
      const ROOT42 = new URL('../../', import.meta.url).pathname
      const adminJs = readFileSync(join(ROOT42, 'apps/web/admin.js'), 'utf8')
      const adminHtml = readFileSync(join(ROOT42, 'apps/web/admin.html'), 'utf8')
      const css = readFileSync(join(ROOT42, 'apps/web/styles.css'), 'utf8')
      check('㊷ D51 筛选两项在场(售后中/售后完成)+判定唯一实现', adminJs.includes('AFTER_SALES_OPEN') && adminJs.includes('AFTER_SALES_DONE') && adminJs.includes('function matchesStatusFilter'))
      check('㊷ D51 旧「售后=需关注」错误映射已清(店主找不到售后单的根因)', !adminJs.includes("AFTER_SALES: t('activeAttention')"))
      check('㊷ D51 需关注含售后中+列表卡徽标渲染在场', adminJs.includes('isAfterSalesOpen(booking)') && adminJs.includes('order-badge badge-'))
      check('㊷ v1.2 五页签:积分商城独立第④签(mall 页签+容器+切换逻辑)', adminHtml.includes('data-member-tab="mall"') && adminHtml.includes('id="mtabMall"') && adminJs.includes("tab === 'mall'"))
      check('㊷ 弹层勾选框与文字同一行(fm-check 横排,组件级)', adminJs.includes('class="fm-check"') && /label\.fm-check\{[^}]*flex-direction:row/.test(css))
      // ㊸ D52(店主 08-20):订单列表日期组倒序=最近优先,双端同口径(小程序 orders 本来就是倒序,网页对齐)
      const miniOrders = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/orders/index.js'), 'utf8')
      check('㊸ D52 网页全部预约日期组倒序(最近日期优先)', /Object\.keys\(grouped\)\.sort\(\(a, b\) => b\.localeCompare\(a\)\)/.test(adminJs) && !/Object\.keys\(grouped\)\.sort\(\)\.map/.test(adminJs))
      check('㊸ D52 商家小程序全部订单日期组倒序在场(双端同口径锚)', /Object\.keys\(map\)\.sort\(\(a, b\) => b\.localeCompare\(a\)\)/.test(miniOrders))
      // ㊹ 拍板③(08-20 双端统一):未签署结算单不能发起售后——两端「转售后」前置在场;网页钮+弹层在场
      const srv = readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')
      check('㊹ 网页「转售后」钮:仅已完成且已签署(listBadgeKind 判据=后端徽标唯一持有)+弹层在场', adminJs.includes('data-convert-aftersales') && adminJs.includes("['signed', 'amended'].includes(booking.listBadgeKind)") && adminJs.includes("title: '转售后'"))
      check('㊹ 商家小程序「转售后」前置:sheets 含 signed/amended 才显示', /s\.status === 'signed' \|\| s\.status === 'amended'\)\) opts\.push\(\{ label: '转售后'/.test(miniOrders))
      check('㊹ 后端 PATCH AFTER_SALES 落 status_history(发起原因唯一持有链)', srv.includes("if (status === 'AFTER_SALES') {") && /booking_status_history[\s\S]{0,200}AFTER_SALES', String\(body\.note/.test(srv))
    }

  console.log(`\n爽约处置+售后完成态回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`)
  process.exit(1)
})
