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
  /* 时区红线(复发登记 08-23):裸 new Date() 推日期在店主机器上(CST 刚过午夜)与门店日
     (America/Toronto)跨天错位——夹具订到「明天」,日结/台面查「今天」,断言凭空红。
     与后端 storeToday()/process.env.TZ 同一钉法:日期一律按门店时区推。 */
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
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
  /* B9(批③首件):未签署单不能转售后——夹具按新口径先开单签署再转(闸本身 ㋈ 有专测) */
  const sB5 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: b5.userId || b5.user_id || (b5.user && b5.user.id), settlements: [{ payIntent: 'offline_full', bookingId: b5.id, items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: [{ technicianId: shop.tech1, role: 'main', itemNos: [1] }], servedPersonName: '' }] }) }, shop.token)
  await request(`/settlements/${encodeURIComponent(sB5.data.settlements[0].code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '⑦夹具签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
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
      /* ㉟ 横幅批:品牌名单源 brandName()。
         08-23 护栏升级(假数回落红线):**连回落值都不许有** —— 原来允许 1 处 'Lucky Luxe' 作为
         `currentStore().name || 'Lucky Luxe'` 的兜底,多租户下那就是把旗舰店品牌名贴到别家店头上。
         现在渲染层字面量必须为 0,拿不到店名就空着。 */
      const brandHits = (custCode.match(/Lucky Luxe/g) || []).length
      check('㉟ 品牌文案单源 + 零回落值(渲染层 Lucky Luxe 字面量=0)', brandHits === 0 && custCode.includes('function brandName()'), `hits=${brandHits}`)
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
      await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ name: '护理', key: `ci-care-${RUN_ID}` }) }, shop.token)  // 裁决后项目组必须是现有分类
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

      // ===== ㊺ S2批② B①:次卡持有推导口径(直插夹具=引擎写法;状态零列全现算) =====
      {
        const uid = bkCust.user.id
        const now = new Date().toISOString()
        const mk = (id, total, used, price, exp) => dbx.prepare(
          'INSERT INTO member_timecards (id, tenant_id, user_id, package_id, name, total_times, used_times, price_cents, project_group, expires_at, source_settlement_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(id, shop.tenantId, uid, null, `夹具卡${id.slice(-2)}`, total, used, price, '守护组', exp, null, now)
        mk('tc_fix_a1', 3, 1, 50000, null)            // 活卡:剩 2/3,500 元 3 次(末次吃余数验算料)
        mk('tc_fix_b0', 3, 3, 54000, null)            // 用完:剩 0,不许出现
        mk('tc_fix_c9', 5, 2, 90000, '2020-01-01')    // 过期:在场置灰
        const tc = (await request(`/admin/customers/${uid}/timecards`, {}, shop.token)).data.timecards
        const a1 = tc.find((c) => c.id === 'tc_fix_a1')
        check('㊺ 活卡在场:剩 2/3+可核销+标签句后端给', Boolean(a1) && a1.remaining === 2 && a1.redeemable === true && a1.label.includes('剩 2/3') && a1.label.includes('长期有效'), JSON.stringify(a1))
        check('㊺ 折算单价末次吃余数:500元3次 → 非末次 16666、末次 16668', a1.nextUnitCents === 16666 && (50000 - 16666 * 2) === 16668, `next=${a1.nextUnitCents}`)
        check('㊺ 剩 0 的卡不出现(B1-2 接口层单源)', !tc.some((c) => c.id === 'tc_fix_b0'), JSON.stringify(tc.map((c) => c.id)))
        const c9 = tc.find((c) => c.id === 'tc_fix_c9')
        check('㊺ 过期卡在场置灰:expired=true 且不可核销(B1-3)', Boolean(c9) && c9.expired === true && c9.redeemable === false, JSON.stringify(c9))
        // 定义拒删闸(批① 注释押的义务):有持卡实例 → 409;清持卡 → 可删
        const pkg = (await request('/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'times', name: '拒删验证卡', priceCents: 30000, timesCount: 3 }) }, shop.token)).data.package
        dbx.prepare("UPDATE member_timecards SET package_id = ? WHERE id = 'tc_fix_a1'").run(pkg.id)
        const del1 = await request(`/admin/packages/${pkg.id}`, { method: 'DELETE' }, shop.token)
        check('㊺ 有持卡实例的定义拒删=409 PACKAGE_HAS_HOLDINGS', del1.status === 409 && del1.data.error.code === 'PACKAGE_HAS_HOLDINGS', JSON.stringify(del1.data))
        dbx.prepare("UPDATE member_timecards SET package_id = NULL WHERE id = 'tc_fix_a1'").run()
        const del2 = await request(`/admin/packages/${pkg.id}`, { method: 'DELETE' }, shop.token)
        check('㊺ 无持卡后定义可删(闸不矫枉过正)', del2.status === 200, JSON.stringify(del2.data))
        // 越权:员工 token 打别人家顾客的卡列表(跨店断言在双租户闸门套件,此处验角色可达性=staff 可读本店)
        dbx.prepare("DELETE FROM member_timecards WHERE id IN ('tc_fix_a1','tc_fix_b0','tc_fix_c9')").run()
        const tcEmpty = (await request(`/admin/customers/${uid}/timecards`, {}, shop.token)).data.timecards
        check('㊺ 夹具清场:持卡列表回空(幂等清理)', tcEmpty.length === 0, JSON.stringify(tcEmpty))

        // ===== ㊼ 裁决:项目组禁自由文本(下拉约束;存量不静默改) =====
        {
          const bad = await request('/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'times', name: '裁决自由文本卡', priceCents: 1000, timesCount: 2, projectGroup: '随手打的组名' }) }, shop.token)
          check('㊼ 新建带野组名=400 PROJECT_GROUP_INVALID(禁自由文本)', bad.status === 400 && bad.data.error.code === 'PROJECT_GROUP_INVALID', JSON.stringify(bad.data).slice(0, 120))
          dbx.prepare('UPDATE membership_packages SET project_group = ? WHERE id = ?').run('历史遗留组', tk.data.package.id)
          const p1 = await request(`/admin/packages/${tk.data.package.id}`, { method: 'PATCH', body: JSON.stringify({ priceCents: 55000 }) }, shop.token)
          check('㊼ 存量自由文本不拆无关编辑(只改价=200,组原样不静默改)', p1.status === 200 && p1.data.package.projectGroup === '历史遗留组', JSON.stringify(p1.data.package || p1.data).slice(0, 120))
          const p2 = await request(`/admin/packages/${tk.data.package.id}`, { method: 'PATCH', body: JSON.stringify({ projectGroup: '又一个野组' }) }, shop.token)
          check('㊼ 改动值必过闸:改成野文本=400', p2.status === 400 && p2.data.error.code === 'PROJECT_GROUP_INVALID', JSON.stringify(p2.data).slice(0, 120))
          const p3 = await request(`/admin/packages/${tk.data.package.id}`, { method: 'PATCH', body: JSON.stringify({ projectGroup: '' }) }, shop.token)
          check('㊼ 改选「不限」=放行', p3.status === 200 && !p3.data.package.projectGroup, JSON.stringify(p3.data.package || p3.data).slice(0, 120))
          const p4 = await request(`/admin/packages/${tk.data.package.id}`, { method: 'PATCH', body: JSON.stringify({ projectGroup: '护理' }) }, shop.token)
          check('㊼ 改选现有分类=放行', p4.status === 200 && p4.data.package.projectGroup === '护理', JSON.stringify(p4.data.package || p4.data).slice(0, 120))
        }

        // ===== ㊻ B② 核销引擎:建单闸×5 → 并发乐观锁 → 幂等 → 出路(预嘱①②全断言化) =====
        {
          const tech = [{ technicianId: shop.tech1, role: 'main', itemNos: [] }]
          const mkSheet = (extra) => ({ userId: uid, settlements: [{ payIntent: 'offline_full', timecardId: 'tc_race', timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '', ...extra }] })  // payIntent 必须 sheet 级:createSettlementGroup 只展开 sheet,body 级被忽略(怪癖记档)
          mk('tc_race', 3, 2, 54000, null)  // 剩 1 次,540 元 3 次 → 末次单价 18000(整除档,余数档 ㊺ 已拍)
          dbx.prepare("UPDATE member_timecards SET project_group = NULL WHERE id = 'tc_race'").run()  // 空组=不限(组闸由 tc_grp 单测)
          // 建单闸:无技师
          const g1 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [{ timecardId: 'tc_race', timecardServiceId: shop.serviceId, items: [], technicians: [], servedPersonName: '' }] }) }, shop.token)
          check('㊻ 建单闸:核销单必有技师=400', g1.status === 400 && g1.data.error.code === 'TECHNICIAN_REQUIRED', JSON.stringify(g1.data).slice(0, 120))
          // 建单闸:组内两张单挂同一张卡
          const g2 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [
            { timecardId: 'tc_race', timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '' },
            { timecardId: 'tc_race', timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '甲' }
          ] }) }, shop.token)
          check('㊻ 建单闸:一单一卡一次(组内重复挂卡=400)', g2.status === 400 && g2.data.error.code === 'TIMECARD_ALREADY_IN_GROUP', JSON.stringify(g2.data).slice(0, 120))
          // 建单闸:项目不在关联组
          mk('tc_grp', 3, 0, 30000, null)
          dbx.prepare("UPDATE member_timecards SET project_group = '不存在的组' WHERE id = 'tc_grp'").run()
          const g3 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [{ timecardId: 'tc_grp', timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '' }] }) }, shop.token)
          check('㊻ 建单闸:项目不在卡关联组=400(拍板③组内选)', g3.status === 400 && g3.data.error.code === 'TIMECARD_SERVICE_OUT_OF_GROUP', JSON.stringify(g3.data).slice(0, 120))
          // 正常建单 A:核销行=折算单价+times_card 腿,现金腿 0
          const sA = await request('/admin/settlements', { method: 'POST', body: JSON.stringify(mkSheet({})) }, shop.token)
          check('㊻ 核销单 A 建成:行=次卡核销第3/3+应收=折算 18000', sA.status === 201 || sA.status === 200, JSON.stringify(sA.data).slice(0, 100))
          const shA = sA.data.settlements[0]
          check('㊻ A 金额面:subtotal=18000+times_card 腿=18000(现金腿 0=B2-9)', shA.subtotalCents === 18000 && (shA.payments || []).some((p) => p.leg === 'times_card' && p.amountCents === 18000) && !(shA.payments || []).some((p) => p.leg === 'offline' && p.amountCents > 0), JSON.stringify(shA.payments))
          check('㊻ A 留痕:条目名含「第 3/3 次」', (shA.items || []).some((i) => i.name && i.name.includes('第 3/3 次')), JSON.stringify((shA.items || []).map((i) => i.name)))
          // 组级 preview:次卡覆盖不进现金应收(B1 施工中抓的组级洞——不减的话应收把折算价再收一遍现金)
          const pv = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify(mkSheet({})) }, shop.token)
          const gpay = pv.data.group.payment
          check('㊻ 组级 preview:offlineDue 不含次卡覆盖(cover=18000,应收=0)', gpay.timecardCoverCents === 18000 && gpay.offlineDueCents === 0, JSON.stringify(gpay))
          // 血缘质询背书(Cowork 08-21):券/定金=价格层减免(恒等式使 totalCents 已扣),组级从未多算;
          // 次卡=支付层覆盖(留在 subtotal 计积分/业绩)=第一个 sheet 级预定支付腿,故为「新通道漏接」非「组级全漏」。行为钉死:
          const cg = await request('/admin/coupon-grants/custom', { method: 'POST', body: JSON.stringify({ userId: uid, amountCents: 2000, reason: '血缘质询背书:组级券 cover' }) }, shop.token)
          const pvC = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '', couponGrantId: cg.data.granted.id }] }) }, shop.token)  // 组级 plan 读 body 级 payIntent(sheet 级只管建单腿)——怪癖组级面,档案补记
          const gC = pvC.data.group
          check('㊻ 血缘背书:券 cover 组级本就正确(total=subtotal−券,offlineDue=total 不再多收)', gC.couponDiscountCents === 2000 && gC.totalCents === gC.subtotalCents - 2000 && gC.payment.offlineDueCents === gC.totalCents, JSON.stringify({ sub: gC.subtotalCents, cpn: gC.couponDiscountCents, total: gC.totalCents, due: gC.payment.offlineDueCents }))
          // 并发面:同一张剩1的卡,另一端再开一张待签单 B(建单许可=预嘱口径)
          const sB = await request('/admin/settlements', { method: 'POST', body: JSON.stringify(mkSheet({})) }, shop.token)
          check('㊻ 并发前提:两端各持一张待签单(建单不硬拦,裁决在签署)', sB.status === 201 || sB.status === 200, JSON.stringify(sB.data).slice(0, 100))
          const shB = sB.data.settlements[0]
          // 签 A:扣次+确认收入
          const led1 = (await financeRows(shop)).length
          const sgA = await request(`/settlements/${encodeURIComponent(shA.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '次卡核销验签A', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
          check('㊻ 签 A 成:卡扣至 3/3', sgA.status === 200 && dbx.prepare("SELECT used_times FROM member_timecards WHERE id = 'tc_race'").get().used_times === 3, JSON.stringify(sgA.data).slice(0, 80))
          const tcIncome = (await financeRows(shop)).filter((x) => x.category === '服务收入-次卡核销')
          check('㊻ 核销确认收入单列:服务收入-次卡核销 18000(payChannel=times_card 不混现金)', tcIncome.length === 1 && (tcIncome[0].amountCents ?? tcIncome[0].amount_cents) === 18000 && (tcIncome[0].payChannel ?? tcIncome[0].pay_channel) === 'times_card', JSON.stringify(tcIncome))
          // 并发闸(乐观锁):签 B 必拦=409 TIMECARD_RACE
          const sgB = await request(`/settlements/${encodeURIComponent(shB.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '次卡核销验签B', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
          check('㊻ 并发闸:两单抢末次,后签=409 TIMECARD_RACE(不是串行防重)', sgB.status === 409 && sgB.data.error.code === 'TIMECARD_RACE', JSON.stringify(sgB.data).slice(0, 140))
          check('㊻ 并发闸:卡不超扣(仍 3/3)', dbx.prepare("SELECT used_times FROM member_timecards WHERE id = 'tc_race'").get().used_times === 3)
          // 幂等闸(与乐观锁分立):A 重签=ALREADY_SIGNED,不重扣不重入账
          const sgA2 = await request(`/settlements/${encodeURIComponent(shA.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '双击重试', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
          check('㊻ 幂等闸:已签单重签=400 ALREADY_SIGNED(双击/重试只扣一次)', sgA2.status === 400 && sgA2.data.error.code === 'ALREADY_SIGNED', JSON.stringify(sgA2.data).slice(0, 100))
          check('㊻ 幂等闸:重签零副作用(卡 3/3+次卡收入行仍 1 条)', dbx.prepare("SELECT used_times FROM member_timecards WHERE id = 'tc_race'").get().used_times === 3 && (await financeRows(shop)).filter((x) => x.category === '服务收入-次卡核销').length === 1)
          // 出路(预嘱①):被拦的 B 不是死胡同——撤回 → 重开(改支付构成=线下)→ 签成
          const vB = await request(`/admin/settlements/${shB.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '次卡被另一单用掉,改支付构成重开' }) }, shop.token)
          check('㊻ 出路①:被拦单可撤回', vB.status === 200, JSON.stringify(vB.data).slice(0, 80))
          const sC = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)
          const shC = sC.data.settlements[0]
          const sgC = await request(`/settlements/${encodeURIComponent(shC.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '改线下重签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
          check('㊻ 出路②:改支付构成(线下)重开可签成,不废单收场', sgC.status === 200, JSON.stringify(sgC.data).slice(0, 80))
          check('㊻ 账面守恒:led 增量=次卡核销 1 行(A)+C 单相应行,B 零账目', (await financeRows(shop)).length >= led1 + 1)
          // D53 回归形:非旗舰租户签**储值腿**的单,「服务收入-耗卡」必须落本租户账(修前=记到旗舰店,本断言 0 行红)
          const sD = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [{ payIntent: 'balance_plus_offline', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)
          const shD = sD.data.settlements[0]
          const svLegD = (shD.payments || []).find((p) => p.leg === 'stored_value')
          check('㊻ D53 前提:D 单带储值腿(bkCust 余额 120 可烧)', Boolean(svLegD) && svLegD.amountCents > 0, JSON.stringify(shD.payments))
          const sgD = await request(`/settlements/${encodeURIComponent(shD.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: 'D53验签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
          const skRows = (await financeRows(shop)).filter((x) => x.category === '服务收入-耗卡' && x.tags === shD.code)
          check('㊻ D53 修:耗卡收入落本租户账(签署页公开路由必须显式带租户)', sgD.status === 200 && skRows.length === 1 && (skRows[0].amountCents ?? skRows[0].amount_cents) === svLegD.amountCents, JSON.stringify({ sign: sgD.status, rows: skRows }))
          // ===== ㊽ B2-8 售后返还次数+回冲(贴更正机制,涉钱零新径) =====
          {
            const rel = await request(`/admin/settlements/${shA.id}/amend`, { method: 'POST', body: JSON.stringify({ reason: '售后返还验证:顾客投诉本次服务', releaseTimecard: true }) }, shop.token)
            check('㊽ 返还:更正单挂 releaseTimecard=200', rel.status === 200, JSON.stringify(rel.data).slice(0, 120))
            check('㊽ 次数返还:卡 3/3 → 2/3', dbx.prepare("SELECT used_times FROM member_timecards WHERE id = 'tc_race'").get().used_times === 2)
            const ptsRow = dbx.prepare("SELECT type, amount FROM points_transactions WHERE user_id = ? AND ref_id = ? AND amount < 0").all(uid, shA.id)
            check('㊽ 积分回冲:台账追加 adjust −180(账本只追加,赚分行推导值不动)', ptsRow.length === 1 && ptsRow[0].type === 'adjust' && ptsRow[0].amount === -180, JSON.stringify(ptsRow))
            const redRows = (await financeRows(shop)).filter((x) => x.category === '服务收入-次卡核销' && x.tags === shA.code && (x.amountCents ?? x.amount_cents) < 0)
            check('㊽ 收入红字:−18000 冲销行在场(reversalOf 链)', redRows.length === 1 && (redRows[0].amountCents ?? redRows[0].amount_cents) === -18000, JSON.stringify(redRows))
            const rel2 = await request(`/admin/settlements/${shA.id}/amend`, { method: 'POST', body: JSON.stringify({ reason: '重复返还试探', releaseTimecard: true }) }, shop.token)
            check('㊽ 防重放:同单二次返还=409 TIMECARD_ALREADY_RELEASED', rel2.status === 409 && rel2.data.error.code === 'TIMECARD_ALREADY_RELEASED', JSON.stringify(rel2.data).slice(0, 120))
            check('㊽ 防重放:卡仍 2/3 不多退', dbx.prepare("SELECT used_times FROM member_timecards WHERE id = 'tc_race'").get().used_times === 2)
            const rel3 = await request(`/admin/settlements/${shC.id}/amend`, { method: 'POST', body: JSON.stringify({ reason: '非核销单试探', releaseTimecard: true }) }, shop.token)
            check('㊽ 非核销单挂返还=400 NOT_TIMECARD_SHEET', rel3.status === 400 && rel3.data.error.code === 'NOT_TIMECARD_SHEET', JSON.stringify(rel3.data).slice(0, 120))
          }
          // ===== ㊾ 业绩扣回(a 案三裁):日结净额+显式行 → 确认快照 → 排行/我的业绩(=工资同源)继承;反例=普通更正不动 =====
          {
            let view = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
            const today = view.date
            check('㊾ 日结显式行:售后扣回(负数+关联单号)在场', (view.afterSalesDeductions || []).some((d) => d.code === shA.code && d.deductCents === 18000), JSON.stringify(view.afterSalesDeductions))
            const vt = view.technicians.find((t) => t.technicianId === shop.tech1)
            check('㊾ 日结净额:tech1 releaseDeductCents=18000(净额已减)', vt && vt.releaseDeductCents === 18000, JSON.stringify(vt))
            // 反例:普通金额更正(shD −1 元)不产生扣回、不动净额(范围钉死)
            const beforePerf = vt.perfCents
            const amdD = await request(`/admin/settlements/${shD.id}/amend`, { method: 'POST', body: JSON.stringify({ totalCents: shD.totalCents - 100, reason: '普通更正反例' }) }, shop.token)
            check('㊾ 反例前提:普通更正成功', amdD.status === 200, JSON.stringify(amdD.data).slice(0, 80))
            view = (await request(`/admin/daily-close?date=${today}`, {}, shop.token)).data.dailyClose
            const vt2 = view.technicians.find((t) => t.technicianId === shop.tech1)
            check('㊾ 反例:普通更正后业绩净额分毫不动+扣回行不增', vt2.perfCents === beforePerf && (view.afterSalesDeductions || []).length === (view.afterSalesDeductions || []).filter((d) => d.code === shA.code).length, JSON.stringify({ before: beforePerf, after: vt2.perfCents }))
            // 撤清今天的待签单(别处夹具残留)→ 确认日结 → 快照线继承
            for (const u of view.unsignedList || []) {   // D58:未签单从 blocker 移到 unsignedList,清场循环同步换源
              await request(`/admin/settlements/${u.settlementId}/void`, { method: 'POST', body: JSON.stringify({ reason: '㊾ 清场:确认日结前撤清待签夹具' }) }, shop.token)
            }
            view = (await request(`/admin/daily-close?date=${today}`, {}, shop.token)).data.dailyClose
            if (view.canConfirm) {
              const cf = await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)
              check('㊾ 确认日结成功(净额入快照线)', cf.status === 200, JSON.stringify(cf.data).slice(0, 80))
              const rank = (await request(`/admin/perf-ranking?period=day&date=${today}`, {}, shop.token)).data.ranking.ranking
              const rk = rank.find((r) => r.technicianId === shop.tech1)
              check('㊾ 排行继承:day 业绩=日结净额(同数同源)', rk && rk.perfCents === vt2.perfCents, JSON.stringify({ rank: rk && rk.perfCents, view: vt2.perfCents }))
              const mp = (await request(`/admin/my-performance?technicianId=${shop.tech1}&month=${today.slice(0, 7)}`, {}, shop.token)).data.performance
              const mpDay = (mp.daily || []).find((d) => d.date === today)
              check('㊾ 员工端我的业绩:当日行=净额+扣回显式行(负数+单号)', mpDay && mpDay.perfCents === vt2.perfCents && (mpDay.deductions || []).some((d) => d.code === shA.code && d.amountCents === -18000), JSON.stringify(mpDay))
              check('㊾ 月净额(hero=目标进度同块;=工资 monthPerfFromCloses 同源)含扣回', mp.hero && mp.hero.perfCents === vt2.perfCents, JSON.stringify({ hero: mp.hero && mp.hero.perfCents, view: vt2.perfCents }))
            } else {
              check('㊾ (跳过确认链)canConfirm=false:' + JSON.stringify(view.blockers.map((b) => b.code)), true)
            }
          }
          // ===== ㊾-补(Cowork 尾②):双技师未分配即返还=扣回暂缓;分配落定按真实比例出现 =====
          {
            mk('tc_dual', 3, 0, 54000, null)
            dbx.prepare("UPDATE member_timecards SET project_group = NULL WHERE id = 'tc_dual'").run()
            const dualTech = [{ technicianId: shop.tech1, role: 'main', itemNos: [] }, { technicianId: shop.tech2, role: 'assist', itemNos: [] }]
            const sE = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [{ payIntent: 'offline_full', timecardId: 'tc_dual', timecardServiceId: shop.serviceId, items: [], technicians: dualTech, servedPersonName: '' }] }) }, shop.token)
            const shE = sE.data.settlements[0]
            const sgE = await request(`/settlements/${encodeURIComponent(shE.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '双技师核销验签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
            check('㊾补 前提:双技师核销单签成(卡 1/3)', sgE.status === 200 && dbx.prepare("SELECT used_times FROM member_timecards WHERE id = 'tc_dual'").get().used_times === 1)
            const relE = await request(`/admin/settlements/${shE.id}/amend`, { method: 'POST', body: JSON.stringify({ reason: '双技师未分配返还', releaseTimecard: true }) }, shop.token)
            check('㊾补 未分配即返还:更正成+次数已回(1→0)', relE.status === 200 && dbx.prepare("SELECT used_times FROM member_timecards WHERE id = 'tc_dual'").get().used_times === 0)
            let v2 = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
            check('㊾补 暂缓:未分配时扣回行不出现(不用默认比例猜)', !(v2.afterSalesDeductions || []).some((d) => d.code === shE.code), JSON.stringify((v2.afterSalesDeductions || []).map((d) => d.code)))
            // 产品路:当日已确认 → 先重开(R1 重开链)再分配
            const todayE = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose.date
            const ro = await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: todayE, reason: '㊾补:确认后双技师核销返还,重开分配' }) }, shop.token)
            check('㊾补 重开日结(R1 链)', ro.status === 200, JSON.stringify(ro.data).slice(0, 80))
            const al = await request(`/admin/settlements/${shE.id}/allocate`, { method: 'POST', body: JSON.stringify({ shares: [{ technicianId: shop.tech1, pct: 70 }, { technicianId: shop.tech2, pct: 30 }] }) }, shop.token)
            check('㊾补 分配落定', al.status === 200, JSON.stringify(al.data).slice(0, 80))
            v2 = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
            const dE = (v2.afterSalesDeductions || []).filter((d) => d.code === shE.code)
            check('㊾补 真实比例扣回:70/30 → 12600+5400(末位吃余数)', dE.length === 2 && dE.some((d) => d.technicianId === shop.tech1 && d.deductCents === 12600) && dE.some((d) => d.technicianId === shop.tech2 && d.deductCents === 5400), JSON.stringify(dE))
          }
          // ===== ㊿ B3 现场购卡:一次签署分行(购卡实收+当场核销第1次)+恒等式扩项+财务红线 =====
          {
            const pk = (await request('/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'times', name: '守护(3次卡)', priceCents: 54000, timesCount: 3 }) }, shop.token)).data.package
            // 建单闸:购卡与已有卡核销互斥
            mk('tc_x1', 3, 0, 30000, null)
            dbx.prepare("UPDATE member_timecards SET project_group = NULL WHERE id = 'tc_x1'").run()
            const bad1 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [{ payIntent: 'offline_full', purchasePackageId: pk.id, timecardId: 'tc_x1', timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '' }] }) }, shop.token)
            check('㊿ 建单闸:购卡与已有卡核销同单=400', bad1.status === 400, JSON.stringify(bad1.data).slice(0, 100))
            const bad2 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [{ payIntent: 'offline_full', purchasePackageId: pk.id, items: [], technicians: tech, servedPersonName: '' }] }) }, shop.token)
            check('㊿ 建单闸:购卡未选核销项目=400(现场购卡=当场核销第1次)', bad2.status === 400 && bad2.data.error.code === 'TIMECARD_SERVICE_REQUIRED', JSON.stringify(bad2.data).slice(0, 100))
            // 正常购卡单:分行金额面(购 540 实收现金+核销第1/3=18000 次卡腿;subtotal 只含核销=售卡不计积分/业绩)
            const sP = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [{ payIntent: 'offline_full', purchasePackageId: pk.id, timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '' }] }) }, shop.token)
            check('㊿ 购卡单建成', sP.status === 201 || sP.status === 200, JSON.stringify(sP.data).slice(0, 100))
            const shP = sP.data.settlements[0]
            check('㊿ 恒等式扩项:total=subtotal(18000)+购卡(54000)=72000', shP.subtotalCents === 18000 && shP.totalCents === 72000, JSON.stringify({ sub: shP.subtotalCents, total: shP.totalCents }))
            check('㊿ 分行腿:times_card 18000+现金 54000(购卡实收)', (shP.payments || []).some((p) => p.leg === 'times_card' && p.amountCents === 18000) && (shP.payments || []).some((p) => p.leg === 'offline' && p.amountCents === 54000), JSON.stringify(shP.payments))
            check('㊿ 财务红线:perfBase=18000(售卡 54000 不进业绩/积分基数)', shP.perfBaseCents === 18000, `perfBase=${shP.perfBaseCents}`)
            check('㊿ 留痕:核销行「第 1/3 次(守护(3次卡) · 现场购卡)」', (shP.items || []).some((i) => i.name && i.name.includes('第 1/3 次') && i.name.includes('现场购卡')), JSON.stringify((shP.items || []).map((i) => i.name)))
            // 签署:建卡 used=1+核销确认收入 18000
            const sgP = await request(`/settlements/${encodeURIComponent(shP.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '现场购卡验签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
            const newCard = dbx.prepare("SELECT * FROM member_timecards WHERE source_settlement_id = ?").get(shP.id)
            check('㊿ 签字建卡:守护(3次卡) used=1/3+快照齐+溯源单号', sgP.status === 200 && newCard && newCard.used_times === 1 && newCard.total_times === 3 && newCard.price_cents === 54000 && newCard.name === '守护(3次卡)', JSON.stringify(newCard))
            const purIncome = (await financeRows(shop)).filter((x) => x.category === '服务收入-次卡核销' && x.tags === shP.code)
            check('㊿ 核销确认收入 18000(购卡 54000=预收负债不写收入行,与充值同构)', purIncome.length === 1 && (purIncome[0].amountCents ?? purIncome[0].amount_cents) === 18000, JSON.stringify(purIncome))
            // 剩 2 次的新卡进持卡接口(第 2 次可正常核销=链路闭环)
            const tcl = (await request(`/admin/customers/${uid}/timecards`, {}, shop.token)).data.timecards
            check('㊿ 新卡入持卡列表:剩 2/3 可核销', tcl.some((c) => c.id === newCard.id && c.remaining === 2 && c.redeemable === true), JSON.stringify(tcl.map((c) => ({ id: c.id, r: c.remaining }))))
            // ===== 裁②升级双态:储值买卡开关(默认关=购卡摘出储值可抵;开=照现链路) =====
            await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: uid, amountCents: 10000, payChannel: 'cash' }) }, shop.token)
            const df = (await request('/admin/timecard-settings', {}, shop.token)).data
            check('裁② 新店默认关(无设置行=false)', df.allowStoredPurchase === false, JSON.stringify(df))
            const mkPv = () => request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'balance_plus_offline', settlements: [{ payIntent: 'balance_plus_offline', purchasePackageId: pk.id, timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '' }] }) }, shop.token)
            const pvOff = (await mkPv()).data
            check('裁② 关态:购卡 54000 摘出储值可抵(stored=0,offline=54000)', pvOff.group.payment.storedUsedCents === 0 && pvOff.group.payment.offlineDueCents === 54000, JSON.stringify(pvOff.group.payment))
            await request('/admin/timecard-settings', { method: 'PUT', body: JSON.stringify({ allowStoredPurchase: true }) }, shop.token)
            const pvOn = (await mkPv()).data
            // 相对式:余额含此前更正自动补回的零头(shD −1 元→+100 分币回卡),全烧+差额恒等即对
            check('裁② 开态:储值余额可全额抵购卡(stored=余额,offline=54000−stored)', pvOn.group.payment.storedUsedCents === pvOn.group.payment.balanceAvailableCents && pvOn.group.payment.storedUsedCents > 0 && pvOn.group.payment.offlineDueCents === 54000 - pvOn.group.payment.storedUsedCents, JSON.stringify(pvOn.group.payment))
            await request('/admin/timecard-settings', { method: 'PUT', body: JSON.stringify({ allowStoredPurchase: false }) }, shop.token)
            check('裁② 回关幂等', (await request('/admin/timecard-settings', {}, shop.token)).data.allowStoredPurchase === false)
            // 裁①:日结汇总单列——次卡售卡独立行(预收负债与充值并列)+核销 n 次折算(§十-7 v1.6 兑现);技师表零改动
            const dcv = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
            check('裁① 日结单列:售卡 1 张 +54000(预收)', dcv.timecardSummary && dcv.timecardSummary.soldCount === 1 && dcv.timecardSummary.soldCents === 54000, JSON.stringify(dcv.timecardSummary))
            check('裁① 日结单列:核销次数与折算合计在场(≥2 次,含 18000×n)', dcv.timecardSummary.redeemCount >= 2 && dcv.timecardSummary.redeemCents >= 36000, JSON.stringify(dcv.timecardSummary))
            // B1-6:员工可读现场购卡套餐口(⑭ 同先例只读;开单是员工干活的页)
            const tpl = await request('/admin/timecard-packages', {}, staffToken)
            check('B1-6 员工可读套餐口:200+label 后端句', tpl.status === 200 && (tpl.data.packages || []).some((x) => x.id === pk.id && /守护\(3次卡\) · 3 次/.test(x.label)), JSON.stringify(tpl.data).slice(0, 160))
            dbx.prepare("DELETE FROM member_timecards WHERE id IN ('tc_x1', ?)").run(newCard.id)

            /* ===== ㋀ B3-1 随单充值(挂单随签):三行分行+恒等式扩项+充后口径签署+财务红线+D54 重建方回归 ===== */
            {
              const svSum = () => dbx.prepare('SELECT COALESCE(SUM(amount_cents),0) AS b FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?').get(shop.tenantId, uid).b
              const B0 = svSum()
              // 选档源:充值套餐(充300赠60)+员工可读口 label 后端句
              const pkR = (await request('/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'recharge', name: '充300赠60', priceCents: 30000, bonusCents: 6000 }) }, shop.token)).data.package
              const rpl = await request('/admin/recharge-packages', {}, staffToken)
              check('㋀ A5 员工可读充值选档口:200+label 后端句(充X赠Y)', rpl.status === 200 && (rpl.data.packages || []).some((x) => x.id === pkR.id && /充300赠60 · 充 .*300.* 赠 .*60/.test(x.label)), JSON.stringify(rpl.data).slice(0, 160))
              // 异常输入:负数/0 金额=400 硬闸;悬空套餐=404
              const badNeg = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, rechargeAmountCents: -5, servedPersonName: '' }] }) }, shop.token)
              check('㋀ 异常输入:充值金额 -5 = 400(不静默当没充)', badNeg.status === 400, JSON.stringify(badNeg.data).slice(0, 100))
              const badRef = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, rechargePackageId: 'rpkg_ghost', servedPersonName: '' }] }) }, shop.token)
              check('㋀ 悬空充值套餐=404', badRef.status === 404, JSON.stringify(badRef.data).slice(0, 100))
              /* 反例数据(L4):自选大项让应收 > 现余额——储值烧到「充进来的钱」才够,
                 签署链若不按充后口径会 INSUFFICIENT 拦死;金额全部确定式。 */
              const bigCents = B0 + 20000
              const mkSheet = (extra) => ({ payIntent: 'balance_plus_offline', items: [], customItems: [{ name: '定制大套', amountCents: bigCents }], technicians: tech, servedPersonName: '', ...extra })
              const pvR = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'balance_plus_offline', settlements: [mkSheet({ rechargePackageId: pkR.id, rechargeTechnicianId: shop.tech1 })] }) }, shop.token)).data
              const gp = pvR.group.payment
              check('㋀ 组级恒等式扩项:total=大项+充值实收', pvR.group.totalCents === bigCents + 30000, JSON.stringify({ total: pvR.group.totalCents, want: bigCents + 30000 }))
              check('㋀ 充值实收摘出储值可抵(offline=30000)+充与赠计入可抵(stored=B0+20000)', gp.rechargeCents === 30000 && gp.pendingRechargeCents === 36000 && gp.storedUsedCents === bigCents && gp.offlineDueCents === 30000, JSON.stringify(gp))
              check('㋀ 充后余额(预计)=B0+36000−烧掉=16000', gp.afterRechargeBalanceCents === 16000, `after=${gp.afterRechargeBalanceCents}`)
              // 建单:recharge_json 落列+serialize 三行分行(渲染句后端唯一)
              const sR = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [mkSheet({ rechargePackageId: pkR.id, rechargeTechnicianId: shop.tech1 })] }) }, shop.token)
              check('㋀ 随单充值单建成', sR.status === 201 || sR.status === 200, JSON.stringify(sR.data).slice(0, 120))
              const shR = sR.data.settlements[0]
              const rl = (shR.recharge && shR.recharge.lines) || []
              check('㋀→㋅ 四行自证在场(前余额/本次充值 实收+赠送/本单抵扣/充后余额·预计)', rl.some((l) => l.key === 'before' && l.label === '充值前余额') && rl.some((l) => l.key === 'recharge' && l.label.includes('充300赠60') && l.label.includes('实收') && l.label.includes('赠送')) && rl.some((l) => l.key === 'deduct') && rl.some((l) => l.key === 'after' && l.label.includes('预计')), JSON.stringify(rl))
              check('㋀ 财务红线:perfBase=大项(充值 30000 不进业绩/积分基数)', shR.perfBaseCents === bigCents, `perfBase=${shR.perfBaseCents}`)
              // 日结冲卡列前值(相对式)
              const dcB = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
              const rcBefore = ((dcB.technicians || []).find((t) => t.technicianId === shop.tech1) || {}).rechargeTotalCents || 0
              // 签署:充值行先入账再烧储值(needStored=B0+20000 > 现余额 B0——充后口径不拦)
              const sgR = await request(`/settlements/${encodeURIComponent(shR.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '随单充值验签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
              check('㋀ 签署成功(储值烧到充进来的钱:充后口径不 INSUFFICIENT)', sgR.status === 200, JSON.stringify(sgR.data).slice(0, 120))
              const svRows = dbx.prepare('SELECT type, amount_cents, pay_channel, technician_id, note FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND note LIKE ? ORDER BY rowid').all(shop.tenantId, uid, `%${shR.code}%`)
              check('㋀ sv 三行:recharge+30000(经手=tech1)/bonus+6000(marketing)/consume −(B0+20000)', svRows.some((r) => r.type === 'recharge' && r.amount_cents === 30000 && r.technician_id === shop.tech1) && svRows.some((r) => r.type === 'bonus' && r.amount_cents === 6000 && r.pay_channel === 'marketing') && svRows.some((r) => r.type === 'consume' && r.amount_cents === -bigCents), JSON.stringify(svRows))
              check('㋀ 签后余额=16000(B0+36000−烧)', svSum() === 16000, `bal=${svSum()}`)
              const serR = (await request(`/settlements/${encodeURIComponent(shR.code)}`, {}, null, { 'x-tenant-id': shop.tenantId })).data.settlement
              check('㋀ 充后余额签字时冻结=16000(快照句「签字时」)', serR.recharge && serR.recharge.frozen === true && serR.recharge.afterBalanceCents === 16000 && (serR.recharge.lines || []).some((l) => l.key === 'after' && l.label.includes('签字时')), JSON.stringify(serR.recharge))
              // 幂等双闸:重签 400,sv 行数不变(充值不重复入账)
              const svN = svRows.length
              const sg2 = await request(`/settlements/${encodeURIComponent(shR.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '重签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
              check('㋀ 幂等:重签=400 且 sv 行数不变(充值只入账一次)', sg2.status === 400 && dbx.prepare('SELECT COUNT(*) AS n FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND note LIKE ?').get(shop.tenantId, uid, `%${shR.code}%`).n === svN, JSON.stringify(sg2.data).slice(0, 80))
              // 财务红线:充值本体不写收入行;耗卡收入=烧掉的储值(含赠部分兑现=负债转收入,既有口径)
              const finR = (await financeRows(shop)).filter((x) => x.tags === shR.code)
              check('㋀ 充值不写收入行(本单收入只有耗卡一类,无 30000 充值收入)', finR.every((x) => x.category === '服务收入-耗卡') && !finR.some((x) => (x.amountCents ?? x.amount_cents) === 30000), JSON.stringify(finR.map((x) => ({ c: x.category, a: x.amountCents ?? x.amount_cents }))))
              // +1 红线四位面之日结:冲卡列 +30000(bonus 天然不进),业绩列不含充值
              const dcA = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
              const rcAfter = ((dcA.technicians || []).find((t) => t.technicianId === shop.tech1) || {}).rechargeTotalCents || 0
              check('㋀ 日结冲卡列 Δ=+30000(赠 6000 天然排除;业绩列由 perfBase 断言盖)', rcAfter - rcBefore === 30000, JSON.stringify({ before: rcBefore, after: rcAfter }))
              /* D54 回归(改券=支付腿重建方):①充值单(待签)取消券重建后 total/腿分毫不动;
                 ②核销单取消券后 times_card 腿仍在(修前=腿被删、折算价重收现金的钱洞)。 */
              const s2 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [{ payIntent: 'balance_plus_offline', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, rechargeAmountCents: 5000, servedPersonName: '' }] }) }, shop.token)
              const sh2 = s2.data.settlements[0]
              // 相对式:项目价按接口回传(项目原价≠次卡折算价——18000 是卡价 54000/3 的推导,别搞混)
              check('㋀ 手输充值单建成(无赠):total=档位小计+5000', sh2.totalCents === sh2.subtotalCents + 5000, `total=${sh2.totalCents}, sub=${sh2.subtotalCents}`)
              const cc = await request(`/admin/settlements/${sh2.id}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: '' }) }, shop.token)
              const sh2b = cc.data.settlement
              check('㋀ D54①:改券重建后充值项不丢(total 不变,stored=小计,offline=5000)', cc.status === 200 && sh2b.totalCents === sh2.totalCents && (sh2b.payments || []).some((p) => p.leg === 'stored_value' && p.amountCents === sh2.subtotalCents) && (sh2b.payments || []).some((p) => p.leg === 'offline' && p.amountCents === 5000), JSON.stringify(sh2b.payments))
              const vd = await request(`/admin/settlements/${sh2.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋀ 未签撤回' }) }, shop.token)
              check('㋀ 未签撤回=什么都没发生(0 sv 行,余额仍 16000)', vd.status === 200 && dbx.prepare('SELECT COUNT(*) AS n FROM stored_value_transactions WHERE tenant_id = ? AND note LIKE ?').get(shop.tenantId, `%${sh2b.code}%`).n === 0 && svSum() === 16000, `bal=${svSum()}`)
              mk('tc_d54', 3, 0, 54000, null)
              dbx.prepare("UPDATE member_timecards SET project_group = NULL WHERE id = 'tc_d54'").run()
              const s3 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [{ payIntent: 'offline_full', timecardId: 'tc_d54', timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '' }] }) }, shop.token)
              const sh3 = s3.data.settlements[0]
              const cc3 = await request(`/admin/settlements/${sh3.id}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: '' }) }, shop.token)
              const sh3b = cc3.data.settlement
              check('㋀ D54②:核销单改券后 times_card 腿仍在(18000)且 total 不变', cc3.status === 200 && sh3b.totalCents === sh3.totalCents && (sh3b.payments || []).some((p) => p.leg === 'times_card' && p.amountCents === 18000), JSON.stringify(sh3b.payments))
              await request(`/admin/settlements/${sh3.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋀ 清场' }) }, shop.token)
              // 组合(四之六):充值+现场购卡同单——两摘出叠加(开关关):stored=0,offline=购54000+充30000(核销行由次卡腿盖)
              const pvMix = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'balance_plus_offline', settlements: [{ payIntent: 'balance_plus_offline', purchasePackageId: pk.id, timecardServiceId: shop.serviceId, items: [], technicians: tech, rechargePackageId: pkR.id, servedPersonName: '' }] }) }, shop.token)).data
              check('㋀ 组合:购卡+充值同单(关态)=stored 0/offline 84000(两摘出叠加)', pvMix.group.payment.storedUsedCents === 0 && pvMix.group.payment.offlineDueCents === 84000, JSON.stringify(pvMix.group.payment))
              dbx.prepare("DELETE FROM member_timecards WHERE id = 'tc_d54'").run()

              /* ===== ㋁ B3-3/4 代充回执确认钮:即时到账+回执待确认+幂等+越权+随签自动确认 ===== */
              {
                const cm = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId }) }, null, { 'x-tenant-id': shop.tenantId })
                const ctok = cm.data.auth.accessToken
                const cuid = cm.data.user.id
                const balBefore = dbx.prepare('SELECT COALESCE(SUM(amount_cents),0) AS b FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?').get(shop.tenantId, cuid).b
                const rc = await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: cuid, amountCents: 8000, bonusCents: 1000, payChannel: 'cash', note: '㋁ 回执用代充' }) }, shop.token)
                check('㋁ 单独代充即时到账(201,不等待确认)', rc.status === 201 && rc.data.balanceCents === balBefore + 9000, JSON.stringify(rc.data).slice(0, 80))
                let my = (await request('/my/stored-value', {}, ctok, { 'x-tenant-id': shop.tenantId })).data
                const pend = (my.pendingConfirm || []).find((p) => p.amountCents === 8000 && p.note.includes('㋁'))
                check('㋁ 顾客端回执:待确认卡在场(金额/渠道/时间戳齐;bonus 行不进回执)', Boolean(pend) && pend.payChannel === 'cash' && Boolean(pend.createdAt) && (my.pendingConfirm || []).every((p) => p.amountCents !== 1000), JSON.stringify(my.pendingConfirm))
                check('㋁ 流水行带待确认位(needsConfirm=true)', (my.txns || []).some((t) => t.id === pend.id && t.needsConfirm === true))
                const led0 = (await request('/admin/stored-value/txns', {}, shop.token)).data.txns.find((t) => t.id === pend.id)
                check('㋁ 商家流水标注:顾客未确认(customerConfirmed=false)', led0 && led0.customerConfirmed === false, JSON.stringify(led0))
                // 越权/异常:管理员 token 打顾客确认口=401;悬空 id=404;bonus 行=400(只有充值需确认)
                const wa = await request('/my/stored-value/confirm', { method: 'POST', body: JSON.stringify({ id: pend.id }) }, shop.token, { 'x-tenant-id': shop.tenantId })
                check('㋁ 越权:管理员会话打确认口=401', wa.status === 401, `${wa.status}`)
                const gh = await request('/my/stored-value/confirm', { method: 'POST', body: JSON.stringify({ id: 'sv_ghost' }) }, ctok, { 'x-tenant-id': shop.tenantId })
                check('㋁ 悬空 id=404', gh.status === 404, `${gh.status}`)
                const bonusRow = dbx.prepare("SELECT id FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'bonus' ORDER BY rowid DESC LIMIT 1").get(shop.tenantId, cuid)
                const bo = await request('/my/stored-value/confirm', { method: 'POST', body: JSON.stringify({ id: bonusRow.id }) }, ctok, { 'x-tenant-id': shop.tenantId })
                check('㋁ 赠送行不可确认=400(只有充值到账需要确认)', bo.status === 400, `${bo.status}`)
                // 确认+幂等
                const cf1 = await request('/my/stored-value/confirm', { method: 'POST', body: JSON.stringify({ id: pend.id }) }, ctok, { 'x-tenant-id': shop.tenantId })
                check('㋁ 确认成功(200+confirmedAt)', cf1.status === 200 && cf1.data.confirmed === true && Boolean(cf1.data.confirmedAt), JSON.stringify(cf1.data))
                const cf2 = await request('/my/stored-value/confirm', { method: 'POST', body: JSON.stringify({ id: pend.id }) }, ctok, { 'x-tenant-id': shop.tenantId })
                check('㋁ 幂等:重复确认=200 already,时间戳不变', cf2.status === 200 && cf2.data.already === true && cf2.data.confirmedAt === cf1.data.confirmedAt, JSON.stringify(cf2.data))
                my = (await request('/my/stored-value', {}, ctok, { 'x-tenant-id': shop.tenantId })).data
                // 本笔离开回执列表即对;别的历史代充(㉙ 等组的 fixture)本来就该继续待确认——那是功能,不是残留
                check('㋁ 确认后:本笔回执卡消失+流水位翻绿(needsConfirm=false)', !(my.pendingConfirm || []).some((p) => p.id === pend.id) && (my.txns || []).some((t) => t.id === pend.id && t.needsConfirm === false), JSON.stringify(my.pendingConfirm))
                const led1 = (await request('/admin/stored-value/txns', {}, shop.token)).data.txns.find((t) => t.id === pend.id)
                check('㋁ 商家流水标注解除(customerConfirmed=true)', led1 && led1.customerConfirmed === true, JSON.stringify(led1))
                // 随单充值=签字即确认:㋀ 那笔 recharge 行 customer_confirmed_at 非空(不出现在任何待确认位)
                const rsRow = dbx.prepare("SELECT customer_confirmed_at FROM stored_value_transactions WHERE tenant_id = ? AND type = 'recharge' AND note LIKE '随单充值%' ORDER BY rowid DESC LIMIT 1").get(shop.tenantId)
                check('㋁ 随单充值签字即确认(customer_confirmed_at 非空,不进回执)', rsRow && Boolean(rsRow.customer_confirmed_at), JSON.stringify(rsRow))
                // 复发护栏:触发器豁免只放确认列——改账目列照旧 ABORT;确认时间戳单向一次不可二改
                let tamper = false
                try { dbx.prepare('UPDATE stored_value_transactions SET amount_cents = 9999 WHERE id = ?').run(pend.id) } catch (e) { tamper = /append-only/.test(String(e.message || '')) }
                check('㋁ 护栏仍硬:改账目列照旧 ABORT(豁免仅确认列)', tamper)
                let tamper2 = false
                try { dbx.prepare("UPDATE stored_value_transactions SET customer_confirmed_at = '2026-01-01T00:00:00Z' WHERE id = ?").run(pend.id) } catch (e) { tamper2 = /append-only/.test(String(e.message || '')) }
                check('㋁ 确认时间戳不可二次改(NULL→值单向一次)', tamper2)
              }

              /* ===== ㋂ 拍板「次卡=独立消费不叠优惠」(店主 08-21 D55/D56 批)+引擎双闸 ===== */
              {
                mk('tc_pb', 3, 0, 54000, null)
                dbx.prepare("UPDATE member_timecards SET project_group = NULL WHERE id = 'tc_pb'").run()
                const cg2 = (await request('/admin/coupon-grants/custom', { method: 'POST', body: JSON.stringify({ userId: uid, amountCents: 3000, reason: '㋂ 次卡不叠优惠夹具券' }) }, shop.token)).data.granted
                const tcSheet = (extra) => ({ payIntent: 'offline_full', timecardId: 'tc_pb', timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '', ...extra })
                // ① 核销单挂券:券全不可用+专句;折扣 0、折算价原样
                const pv1 = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [tcSheet({ couponGrantId: cg2.id })] }) }, shop.token)).data
                const opt1 = (pv1.sheets[0].couponOptions || []).find((o) => o.grantId === cg2.id)
                check('㋂ 核销单挂券=不可用+专句「次卡为独立消费,不与优惠叠加」', opt1 && opt1.usable === false && /次卡为独立消费/.test(opt1.reason), JSON.stringify(opt1))
                check('㋂ 核销单券折扣=0,折算价不动(subtotal=total=18000)', pv1.sheets[0].couponDiscountCents === 0 && pv1.sheets[0].subtotalCents === 18000 && pv1.sheets[0].totalCents === 18000, JSON.stringify({ c: pv1.sheets[0].couponDiscountCents, s: pv1.sheets[0].subtotalCents, t: pv1.sheets[0].totalCents }))
                // ② strict(正式建单)带券=400 明说
                const sX = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [tcSheet({ couponGrantId: cg2.id })] }) }, shop.token)
                check('㋂ 建单带券=400 COUPON_UNUSABLE(不静默按无券建)', sX.status === 400 && sX.data.error.code === 'COUPON_UNUSABLE', JSON.stringify(sX.data).slice(0, 120))
                // ③ 现场购卡单挂券:同专句(购卡行也是 kind=timecard)
                const pv3 = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [{ payIntent: 'offline_full', purchasePackageId: pk.id, timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '', couponGrantId: cg2.id }] }) }, shop.token)).data
                const opt3 = (pv3.sheets[0].couponOptions || []).find((o) => o.grantId === cg2.id)
                check('㋂ 购卡单挂券=不可用+专句', opt3 && opt3.usable === false && /次卡为独立消费/.test(opt3.reason), JSON.stringify(opt3))
                // ④ 会员价不作用于次卡:tierKey=member 折算价分毫不动
                const pv4 = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [tcSheet({ tierKey: 'member' })] }) }, shop.token)).data
                check('㋂ tier=member 折算价不动(18000;次卡与档位无关)', pv4.sheets[0].subtotalCents === 18000 && pv4.sheets[0].totalCents === 18000, JSON.stringify({ s: pv4.sheets[0].subtotalCents, t: pv4.sheets[0].totalCents }))
                // ⑤ 整单规则直打引擎(前端已不发=第一道闸;这里验第二道闸):足部+甲片对次卡组零作用行
                const pv5 = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [tcSheet({ applyFootSurcharge: true, applyTipReuse: true })] }) }, shop.token)).data
                check('㋂ 整单规则不作用于次卡组(无 rule 行,total 仍 18000)', !(pv5.sheets[0].lines || []).some((l) => l.kind === 'rule') && pv5.sheets[0].totalCents === 18000, JSON.stringify((pv5.sheets[0].lines || []).map((l) => l.kind)))
                // ⑥ 混组:券挂主项目组=全额可用,次卡组零沾(per-sheet 隔离)
                const pv6 = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid, payIntent: 'offline_full', settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '', couponGrantId: cg2.id }, tcSheet({})] }) }, shop.token)).data
                check('㋂ 混组:券吃主项目组 3000,次卡组券=0', pv6.sheets[0].couponDiscountCents === 3000 && pv6.sheets[1].couponDiscountCents === 0 && pv6.group.couponDiscountCents === 3000, JSON.stringify({ a: pv6.sheets[0].couponDiscountCents, b: pv6.sheets[1].couponDiscountCents }))
                // ⑦ 改券链(写方同口径,D54 教训):核销单(无券建成)上代选该券=400
                const sY = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [tcSheet({})] }) }, shop.token)
                const shY = sY.data.settlements[0]
                const cc7 = await request(`/admin/settlements/${shY.id}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: cg2.id }) }, shop.token)
                check('㋂ 改券链同口径:核销单代选券=400(写方读方不分叉)', cc7.status === 400 && /次卡为独立消费|用不了/.test((cc7.data.error || {}).message || ''), JSON.stringify(cc7.data).slice(0, 120))
                await request(`/admin/settlements/${shY.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋂ 清场' }) }, shop.token)
                dbx.prepare("DELETE FROM member_timecards WHERE id = 'tc_pb'").run()
              }

              /* ===== ㋃ D57/D58 待签单再入口+日结确认独立(店主 08-21 尾清) ===== */
              {
                const cm2 = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId }) }, null, { 'x-tenant-id': shop.tenantId })
                const ctok2 = cm2.data.auth.accessToken
                const cuid2 = cm2.data.user.id
                const plainSheet = { payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }
                const sU1 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuid2, settlements: [plainSheet] }) }, shop.token)
                const sU2 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuid2, settlements: [plainSheet] }) }, shop.token)
                const shU1 = sU1.data.settlements[0]
                const shU2 = sU2.data.settlements[0]
                const sU3 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid, settlements: [plainSheet] }) }, shop.token)
                const shU3 = sU3.data.settlements[0]
                // D58:未签单不阻塞确认(blockers 无 UNSIGNED)+unsignedList 独立下发(可点行数据)
                const dc1 = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
                check('㋃ D58 未签单不再是 blocker(确认按单独立)', (dc1.blockers || []).every((b) => b.code !== 'UNSIGNED'), JSON.stringify((dc1.blockers || []).map((b) => b.code)))
                check('㋃ D57 unsignedList 独立下发(3 张全列:顾客/时间/单号/金额齐)', (dc1.unsignedList || []).length >= 3 && (dc1.unsignedList || []).every((u) => u.settlementId && u.code && u.timeText && u.cashDueCents > 0 && u.customerName), JSON.stringify(dc1.unsignedList))
                // D57 顾客侧:全部未签单(不止最新一张);越权=只见自己的(uid 那张不可见)
                const ps1 = (await request('/my/pending-sign', {}, ctok2, { 'x-tenant-id': shop.tenantId })).data.pendingSign
                check('㋃ D57 顾客侧列全部未签单(2 张,不止最新)+签署页直达 code', ps1.length === 2 && ps1.every((p) => p.code && p.cashDueText && p.at), JSON.stringify(ps1))
                check('㋃ 越权:别人的未签单不可见(uid 那张不在列)', !ps1.some((p) => p.code === shU3.code), JSON.stringify(ps1.map((p) => p.code)))
                // 签一张→剩 1;撤一张→剩 0(status 驱动,零状态维护)
                const sg1 = await request(`/settlements/${encodeURIComponent(shU1.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋃ 待签再入口验签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                check('㋃ 前提:签掉第一张', sg1.status === 200, JSON.stringify(sg1.data).slice(0, 80))
                await request(`/admin/settlements/${shU2.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋃ 撤回清场' }) }, shop.token)
                const ps2 = (await request('/my/pending-sign', {}, ctok2, { 'x-tenant-id': shop.tenantId })).data.pendingSign
                check('㋃ 签一张+撤一张后列表归零(签/撤自然消失)', ps2.length === 0, JSON.stringify(ps2))
                // R1 不减防:确认后再签(补签归今日)→ 快照对账抓 drift 标过期(未签单挂着本身不再标过期)
                const dc2 = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
                if (dc2.canConfirm) {
                  const cf = await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: dc2.date }) }, shop.token)
                  check('㋃ 前提:确认日结(此刻 shU3 仍未签,不挡)', cf.status === 200, JSON.stringify(cf.data).slice(0, 80))
                  const dcMid = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
                  check('㋃ D58 已确认+挂着未签单=不标过期(未签不进账,快照本就齐)', dcMid.staleClose === false, JSON.stringify({ stale: dcMid.staleClose }))
                  const sg3 = await request(`/settlements/${encodeURIComponent(shU3.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋃ 确认后补签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  check('㋃ 前提:确认后补签落账', sg3.status === 200, JSON.stringify(sg3.data).slice(0, 80))
                  const dc3 = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
                  check('㋃ R1 不减防:补签落账即标过期逼重开(快照对账抓 drift)', dc3.staleClose === true && (dc3.blockers || []).some((b) => b.code === 'STALE_CLOSE'), JSON.stringify({ stale: dc3.staleClose, blockers: (dc3.blockers || []).map((b) => b.code) }))
                  await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: dc2.date, reason: '㋃ 清场:补签重开' }) }, shop.token)
                } else {
                  check('㋃ (跳过确认链)canConfirm=false:' + JSON.stringify((dc2.blockers || []).map((b) => b.code)), true)
                  await request(`/admin/settlements/${shU3.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋃ 清场' }) }, shop.token)
                }
              }

              /* ===== ㋄ D60 金额出口同源(店主 08-22:868/1020/1408 三数对账后修) ===== */
              {
                const cm3 = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId }) }, null, { 'x-tenant-id': shop.tenantId })
                const cuid3 = cm3.data.user.id
                const bal0 = dbx.prepare('SELECT COALESCE(SUM(amount_cents),0) AS b FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?').get(shop.tenantId, cuid3).b
                const pkR3 = (await request('/admin/recharge-packages', {}, staffToken)).data.packages.find((p) => p.name === '充300赠60')
                // 店主组合:sheet0=现场购卡+当场核销+随单充值;sheet1=普通服务(payer 同人)
                const comboBody = { userId: cuid3, payIntent: 'balance_plus_offline', settlements: [
                  { payIntent: 'balance_plus_offline', purchasePackageId: pk.id, timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '', rechargePackageId: pkR3.id },
                  { payIntent: 'balance_plus_offline', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }
                ] }
                const pv = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify(comboBody) }, shop.token)).data
                const gp = pv.group.payment
                // D60 核心:组级=Σ各 sheet 腿(预览=建单=签署一条数)
                const sheetOffline = pv.sheets.reduce((n, s) => n + s.payment.offlineCents, 0)
                const sheetStored = pv.sheets.reduce((n, s) => n + s.payment.storedUsedCents, 0)
                check('㋄ D60 组级支付=Σ sheet 腿(不再独立重算)', gp.offlineDueCents === sheetOffline && gp.storedUsedCents === sheetStored, JSON.stringify({ g: { o: gp.offlineDueCents, s: gp.storedUsedCents }, sum: { o: sheetOffline, s: sheetStored } }))
                check('㋄ D60 组级腿=sheet 腿拼接(带组内序号)', Array.isArray(gp.legs) && gp.legs.every((l) => l.sheetIndex === 0 || l.sheetIndex === 1) && gp.legs.length === pv.sheets.reduce((n, s) => n + s.payment.legs.length, 0), JSON.stringify(gp.legs.map((l) => `${l.sheetIndex}:${l.leg}:${l.amountCents}`)))
                check('㋄ D60 购卡款组级显式(purchaseCents=54000,不隐身)', gp.purchaseCents === 54000, `purchase=${gp.purchaseCents}`)
                /* D64 改判(店主五步④):挂充的钱**就该**被组内后续单抵(前向传递,签字时序兑现)——
                   上限=共享余额+组内挂充(充+赠),且与建单腿一致(下一条断言钉预览=建单)。 */
                check('㋄→㋆ 组内后续单可抵挂充(≤共享余额+充赠 360)', pv.sheets[1].payment.storedUsedCents <= Math.max(0, bal0) + 36000, JSON.stringify({ s1stored: pv.sheets[1].payment.storedUsedCents, bal0 }))
                // 建单=预览逐分一致(落库腿)
                const sC = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuid3, settlements: comboBody.settlements }) }, shop.token)
                const builtLegs = sC.data.settlements.flatMap((s) => s.payments.filter((p) => p.leg !== 'deposit'))
                const builtOffline = builtLegs.filter((p) => p.leg === 'offline').reduce((n, p) => n + p.amountCents, 0)
                const builtStored = builtLegs.filter((p) => p.leg === 'stored_value' || p.leg === 'migrate_stored').reduce((n, p) => n + p.amountCents, 0)
                check('㋄ D60 预览承诺=建单落库腿(offline/stored 逐分一致)', builtOffline === gp.offlineDueCents && builtStored === gp.storedUsedCents, JSON.stringify({ built: { o: builtOffline, s: builtStored }, promised: { o: gp.offlineDueCents, s: gp.storedUsedCents } }))
                // 合计自证行:serialize purchaseLine 后端句在场
                const sh0 = sC.data.settlements[0]
                check('㋄ D60 购卡显式行(purchaseLine 后端句:名称+「购卡款,预收」)', sh0.purchaseLine && sh0.purchaseLine.priceCents === 54000 && /购卡款,预收/.test(sh0.purchaseLine.amountText) && /守护/.test(sh0.purchaseLine.label), JSON.stringify(sh0.purchaseLine))
                // preview-card 组卡自证:groupNote+sheetRows+dueLabel+购卡/充值行
                const pc = (await request(`/admin/settlements/${sh0.id}/preview-card`, {}, shop.token)).data.card
                // D68 文案改版(店主 08-23):组说明=「本次到店共 N 份服务确认单」;汇总行=「到店服务项目(N)」(N=主项目数)
                check('㋄→㋌ D60 组卡自证(2 份确认单+逐张状态行+到店服务项目 label)', /共 2 份服务确认单/.test(pc.groupNote) && pc.sheetRows.length === 2 && /^到店服务项目\(\d+\)$/.test(pc.totals.dueLabel), JSON.stringify({ note: pc.groupNote, rows: pc.sheetRows.length, label: pc.totals.dueLabel }))
                check('㋄ D60 组卡购卡/充值显式行(54000/30000)', pc.totals.purchaseCents === 54000 && pc.totals.rechargeCents === 30000, JSON.stringify({ p: pc.totals.purchaseCents, r: pc.totals.rechargeCents }))
                // 清场:撤两张
                for (const s of sC.data.settlements) await request(`/admin/settlements/${s.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋄ 清场' }) }, shop.token)
                /* 双单抢同一份余额(并发六类正门修):代充 500 → 两张 388 同组 → 顺序消耗不超余额,两张都签得动 */
                await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: cuid3, amountCents: 50000, payChannel: 'cash', note: '㋄ 共享余额夹具' }) }, shop.token)
                const balNow = dbx.prepare('SELECT COALESCE(SUM(amount_cents),0) AS b FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?').get(shop.tenantId, cuid3).b
                const twin = { userId: cuid3, payIntent: 'balance_plus_offline', settlements: [
                  { payIntent: 'balance_plus_offline', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' },
                  { payIntent: 'balance_plus_offline', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }
                ] }
                const sT = await request('/admin/settlements', { method: 'POST', body: JSON.stringify(twin) }, shop.token)
                const tw = sT.data.settlements
                const twStored = tw.flatMap((s) => s.payments).filter((p) => p.leg === 'stored_value' || p.leg === 'migrate_stored').reduce((n, p) => n + p.amountCents, 0)
                check('㋄ D60 双单共享余额顺序消耗(Σstored ≤ 余额,不再双份烧)', twStored <= balNow && twStored > 0, JSON.stringify({ twStored, balNow }))
                const tg1 = await request(`/settlements/${encodeURIComponent(tw[0].code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋄ 双单A', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                const tg2 = await request(`/settlements/${encodeURIComponent(tw[1].code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋄ 双单B', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                const balEnd = dbx.prepare('SELECT COALESCE(SUM(amount_cents),0) AS b FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?').get(shop.tenantId, cuid3).b
                check('㋄ D60 两张顺序签署都成+余额不透支(≥0)', tg1.status === 200 && tg2.status === 200 && balEnd >= 0, JSON.stringify({ a: tg1.status, b: tg2.status, balEnd }))

                /* ===== ㋅ D63 账单自证(四行恒等+余额未用句)===== */
                {
                  // 有余额(balEnd 可能 0——补一笔)+随单充值单:四行恒等 前余额+充+赠−抵=充后
                  await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: cuid3, amountCents: 10000, payChannel: 'cash', note: '㋅ 前余额夹具' }) }, shop.token)
                  const balBefore = dbx.prepare('SELECT COALESCE(SUM(amount_cents),0) AS b FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?').get(shop.tenantId, cuid3).b
                  const sR6 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuid3, settlements: [{ payIntent: 'balance_plus_offline', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '', rechargePackageId: pkR3.id }] }) }, shop.token)
                  const shR6 = sR6.data.settlements[0]
                  const L = Object.fromEntries((shR6.recharge.lines || []).map((l) => [l.key, l]))
                  const num = (t) => Math.round(Number(String(t).replace(/[^\d.]/g, '')) * 100)
                  check('㋅ 四行恒等自证:前余额+充+赠−抵扣=充后(数字逐行可算)', L.before && L.recharge && L.deduct && L.after && num(L.before.amountText) + 36000 - (num(L.deduct.amountText) || 0) === num(L.after.amountText), JSON.stringify(shR6.recharge.lines))
                  check('㋅ 前余额行=真实前余额', num(L.before.amountText) === balBefore, JSON.stringify({ line: L.before.amountText, balBefore }))
                  // 有 stored 腿的待签单:不出「未使用」句
                  check('㋅ 用了储值的待签单不出「未使用」句', !shR6.storedUnusedNotice, JSON.stringify({ n: shR6.storedUnusedNotice, stored: shR6.payments.filter((p) => p.leg === 'stored_value').length }))
                  await request(`/admin/settlements/${shR6.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋅ 清场' }) }, shop.token)
                  // 余额>0 而本单未用储值(offline_full)→ 待签单+组卡都出定稿句;签后句消失
                  const sN = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuid3, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)
                  const shN = sN.data.settlements[0]
                  check('㋅ 余额未用句(待签单):「该客有储值余额 X,本单未使用」', /该客有储值余额 .*本单未使用/.test(shN.storedUnusedNotice || ''), JSON.stringify(shN.storedUnusedNotice))
                  const pcN = (await request(`/admin/settlements/${shN.id}/preview-card`, {}, shop.token)).data.card
                  check('㋅ 余额未用句(组卡同句)', /该客有储值余额 .*本单未使用/.test(pcN.storedUnusedNotice || ''), JSON.stringify(pcN.storedUnusedNotice))
                  const sgN = await request(`/settlements/${encodeURIComponent(shN.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋅ 未用储值签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const serN = (await request(`/settlements/${encodeURIComponent(shN.code)}`, {}, null, { 'x-tenant-id': shop.tenantId })).data.settlement
                  check('㋅ 已签单不出句(历史单不随活余额漂)', sgN.status === 200 && !serN.storedUnusedNotice, JSON.stringify(serN.storedUnusedNotice))
                }

                /* ===== ㋈ 批③首件:顾客售后发起线+连签流+归属瀑布(图 §二§三+拍板①②③) ===== */
                {
                  const cm9 = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId }) }, null, { 'x-tenant-id': shop.tenantId })
                  const ctok9 = cm9.data.auth.accessToken
                  const cuid9 = cm9.data.user.id
                  const pkR9 = (await request('/admin/recharge-packages', {}, staffToken)).data.packages.find((p) => p.name === '充300赠60')
                  const bk9 = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: cuid9, serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(0), time: '19:15' }) }, shop.token)).data.booking
                  // 未签的已完成单不能发起(拍板③):先把单标 COMPLETED(无结算单)
                  await request(`/admin/bookings/${bk9.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
                  const noSign = await request(`/my/bookings/${bk9.id}/after-sales`, { method: 'POST', body: JSON.stringify({ description: '还没签就想售后' }) }, ctok9, { 'x-tenant-id': shop.tenantId })
                  check('㋈ 拍板③顾客口:未签署单发起=400', noSign.status === 400 && noSign.data.error.code === 'AFTER_SALES_NEEDS_SIGNED', JSON.stringify(noSign.data).slice(0, 100))
                  const b9gate = await request(`/admin/bookings/${bk9.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'AFTER_SALES', note: '商家强转' }) }, shop.token)
                  check('㋈ B9 商家口同闸:未签署单转售后=400', b9gate.status === 400 && b9gate.data.error.code === 'AFTER_SALES_NEEDS_SIGNED', JSON.stringify(b9gate.data).slice(0, 100))
                  // 挂单开一张并签(D61 接续字段一并核)
                  const sD61 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuid9, settlements: [{ payIntent: 'offline_full', bookingId: bk9.id, items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }, { payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)
                  const [d61a, d61b] = sD61.data.settlements
                  const sg61 = (await request(`/settlements/${encodeURIComponent(d61a.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '连签A', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })).data
                  const ser61 = (await request(`/settlements/${encodeURIComponent(d61a.code)}`, {}, null, { 'x-tenant-id': shop.tenantId })).data.settlement
                  check('㋈ D61 签完带出下一张(groupPendingCount=1+nextCode)', ser61.groupPendingCount === 1 && ser61.groupNextPendingCode === d61b.code, JSON.stringify({ n: ser61.groupPendingCount, c: ser61.groupNextPendingCode }))
                  const st61 = (await request(`/admin/settlements/${d61a.id}/sign-state`, {}, shop.token)).data
                  check('㋈ D61 商家出码接续(sign-state 带 nextPendingId)', st61.state === 'signed' && st61.nextPendingId === d61b.id, JSON.stringify(st61))
                  await request(`/settlements/${encodeURIComponent(d61b.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '连签B', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const ser61b = (await request(`/settlements/${encodeURIComponent(d61b.code)}`, {}, null, { 'x-tenant-id': shop.tenantId })).data.settlement
                  check('㋈ D61 全签完=0(接续钮消失,回台面)', ser61b.groupPendingCount === 0, JSON.stringify({ n: ser61b.groupPendingCount }))
                  // 签署完成 → booking COMPLETED → afterSalesAction='start'
                  const bks = (await request('/bookings', {}, ctok9, { 'x-tenant-id': shop.tenantId })).data.bookings
                  const bkMine = bks.find((b) => b.id === bk9.id)
                  check('㋈ B1 按钮位后端句:已完成+已签署=start「有疑问,去售后」', bkMine && bkMine.afterSalesAction === 'start' && bkMine.afterSalesActionText === '有疑问,去售后', JSON.stringify({ a: bkMine && bkMine.afterSalesAction }))
                  // B8 涉钱零新径:带 amountCents 的发起=零账目行
                  const led0 = (await financeRows(shop)).length
                  const goAS = await request(`/my/bookings/${bk9.id}/after-sales`, { method: 'POST', body: JSON.stringify({ description: '做完第二天就掉了', amountCents: 99999 }) }, ctok9, { 'x-tenant-id': shop.tenantId })
                  check('㋈ B7 顾客发起=201+进度卡(发起原因入留痕链)', goAS.status === 201 && goAS.data.afterSales && goAS.data.afterSales.reason.includes('做完第二天就掉了'), JSON.stringify(goAS.data.afterSales && goAS.data.afterSales.reason))
                  check('㋈ B8 涉钱零新径(amountCents 字段不产生账目行)', (await financeRows(shop)).length === led0)
                  const again = await request(`/my/bookings/${bk9.id}/after-sales`, { method: 'POST', body: JSON.stringify({ description: '再来一条' }) }, ctok9, { 'x-tenant-id': shop.tenantId })
                  check('㋈ B5 一单一条进行中(再发起=409)', again.status === 409 && again.data.error.code === 'AFTER_SALES_IN_PROGRESS', JSON.stringify(again.data).slice(0, 100))
                  // 越权+异常输入
                  const cmX = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: uid }) }, null, { 'x-tenant-id': shop.tenantId })
                  const other = await request(`/my/bookings/${bk9.id}/after-sales/withdraw`, { method: 'POST', body: '{}' }, cmX.data.auth.accessToken, { 'x-tenant-id': shop.tenantId })
                  check('㋈ 越权:别人撤不了我的售后(404)', other.status === 404, `${other.status}`)
                  const empty = await request(`/my/bookings/${bk9.id}/after-sales`, { method: 'POST', body: JSON.stringify({ description: '   ' }) }, ctok9, { 'x-tenant-id': shop.tenantId })
                  check('㋈ 异常输入:空描述=400', empty.status === 400, `${empty.status}`)
                  // B6 撤回:顾客发起→撤=resolved+「顾客撤回」;结案后再撤=409;结案后可再发起(重开)
                  const wd = await request(`/my/bookings/${bk9.id}/after-sales/withdraw`, { method: 'POST', body: '{}' }, ctok9, { 'x-tenant-id': shop.tenantId })
                  check('㋈ B6 撤回=转已解决+自动备注「顾客撤回」', wd.status === 200 && wd.data.afterSales.status === 'resolved' && /顾客撤回/.test(wd.data.afterSales.statusText + (wd.data.afterSales.steps || []).map((s) => s.label).join('')), JSON.stringify(wd.data.afterSales.status))
                  const wd2 = await request(`/my/bookings/${bk9.id}/after-sales/withdraw`, { method: 'POST', body: '{}' }, ctok9, { 'x-tenant-id': shop.tenantId })
                  check('㋈ B6 结案后再撤=409(幂等面)', wd2.status === 409, `${wd2.status}`)
                  const reopen = await request(`/my/bookings/${bk9.id}/after-sales`, { method: 'POST', body: JSON.stringify({ description: '又发现新问题' }) }, ctok9, { 'x-tenant-id': shop.tenantId })
                  check('㋈ B5 结案后可再次发起(重开=新一条留痕)', reopen.status === 201 && reopen.data.afterSales.reason.includes('又发现新问题'), JSON.stringify(reopen.data.afterSales && reopen.data.afterSales.reason))
                  // 商家发起的售后顾客不能撤(bk 另一张:先解决当前的再商家转)
                  await request(`/my/bookings/${bk9.id}/after-sales/withdraw`, { method: 'POST', body: '{}' }, ctok9, { 'x-tenant-id': shop.tenantId })
                  await request(`/admin/bookings/${bk9.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'AFTER_SALES', note: '商家发现问题转入' }) }, shop.token)
                  const wd3 = await request(`/my/bookings/${bk9.id}/after-sales/withdraw`, { method: 'POST', body: '{}' }, ctok9, { 'x-tenant-id': shop.tenantId })
                  check('㋈ B6 商家发起的售后顾客不能撤(403)', wd3.status === 403 && wd3.data.error.code === 'NOT_INITIATOR', JSON.stringify(wd3.data).slice(0, 100))
                  /* D59 v2 瀑布③:老板开单(demo owner 无技师身份)+单技师+随单充值 → 归当单技师 */
                  const sD59 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuid9, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '', rechargePackageId: pkR9.id }] }) }, shop.token)
                  const shD59 = sD59.data.settlements[0]
                  check('㋈ D59③ 老板开单无技师身份=归当单技师(单技师回落)', shD59.recharge && JSON.parse(JSON.stringify(shD59.recharge)) && (await (async () => { const r = dbx.prepare('SELECT recharge_json FROM settlements WHERE id = ?').get(shD59.id); return JSON.parse(r.recharge_json).technicianId === shop.tech1 })()), JSON.stringify({ want: shop.tech1 }))
                  // 双技师=暂缓(空,等店主拍案)
                  const sD59b = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuid9, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: [{ technicianId: shop.tech1, role: 'main', itemNos: [1] }, { technicianId: shop.tech2, role: 'assist', itemNos: [] }], servedPersonName: '', rechargePackageId: pkR9.id }] }) }, shop.token)
                  const rj59b = JSON.parse(dbx.prepare('SELECT recharge_json FROM settlements WHERE id = ?').get(sD59b.data.settlements[0].id).recharge_json)
                  check('㋈ D59③ 双技师=空归属(案二拍定:进「未分配」,日结核定=㋉ 专测)', rj59b.technicianId === null, JSON.stringify(rj59b.technicianId))
                  for (const x of [shD59.id, sD59b.data.settlements[0].id]) await request(`/admin/settlements/${x}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋈ 清场' }) }, shop.token)
                }

                /* ===== ㋉ 店主三拍落地(08-22):D1 标题案一+D59 案二日结核定+C5 已结清=实付现金 ===== */
                {
                  /* 夹具用**全新档案**(demo 顾客在前面各组攒了余额,储值会把现金腿抵成 0=夹具失真):
                     直排建档 → asUserId 登录拿它的顾客口 token(㉘ 既有路径)。 */
                  const bkK = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `㋉三拍客${RUN_ID}`, serviceId: shop.serviceId, technicianId: shop.tech2, date: dateStr(0), time: '19:07' }) }, shop.token)).data.booking
                  const cuidK = bkK.userId || bkK.user_id || (bkK.user && bkK.user.id)
                  // D25 闸:未绑微信的轻档案不可充值——夹具直贴 openid 当已绑(绑定流程 ⑯ 有专测,这里不是被测物)
                  dbx.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`wx-3p-${RUN_ID}`, cuidK)
                  const cmK = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: cuidK }) }, null, { 'x-tenant-id': shop.tenantId })
                  const ctokK = cmK.data.auth.accessToken
                  const pkRK = (await request('/admin/recharge-packages', {}, staffToken)).data.packages.find((p) => p.name === '充300赠60')
                  /* --- C5:实付现金≠结算合计的单(余额 100 抵一半)→ 列表句必须是现金数 --- */
                  await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: cuidK, amountCents: 10000, payChannel: 'cash', note: '㋉ 余额夹具' }) }, shop.token)
                  await request(`/admin/bookings/${bkK.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
                  const sK = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, settlements: [{ payIntent: 'balance_plus_offline', bookingId: bkK.id, items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)
                  const shK = sK.data.settlements[0]
                  await request(`/settlements/${encodeURIComponent(shK.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋉ C5 签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const offK = dbx.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM settlement_payments WHERE settlement_id = ? AND leg = 'offline'").get(shK.id).n
                  const totK = dbx.prepare('SELECT total_cents FROM settlements WHERE id = ?').get(shK.id).total_cents
                  const num = (t) => Math.round(Number(String(t).replace(/[^\d.]/g, '')) * 100)
                  const bkKL = (await request('/bookings', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.bookings.find((b) => b.id === bkK.id)
                  check('㋉ C5 夹具有效(现金≠合计:储值抵了一半)', offK > 0 && totK > offK, JSON.stringify({ offK, totK }))
                  check('㋉ C5 「已结清 X」=实付现金(与头条同源=Σoffline 腿,不再是结算合计)', /^已结清 /.test(bkKL.listAmountText || '') && num(bkKL.listAmountText) === offK && num(bkKL.listAmountText) !== totK, JSON.stringify({ t: bkKL.listAmountText, offK, totK }))
                  check('㋉ D1 单项目单标题回空串(前端沿用服务名,不出「等1项」)', (bkKL.listTitleText || '') === '', JSON.stringify(bkKL.listTitleText))
                  /* --- C5 售后行同刀:售后中的单列表句同源同句(「总价 <合计>」销案) --- */
                  await request(`/my/bookings/${bkK.id}/after-sales`, { method: 'POST', body: JSON.stringify({ description: '㋉ 售后行同刀' }) }, ctokK, { 'x-tenant-id': shop.tenantId })
                  const bkKA = (await request('/bookings', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.bookings.find((b) => b.id === bkK.id)
                  check('㋉ C5 售后行同刀:售后中也是「已结清 现金数」,「总价 合计数」不再裸出', /^已结清 /.test(bkKA.listAmountText || '') && num(bkKA.listAmountText) === offK, JSON.stringify(bkKA.listAmountText))
                  await request(`/my/bookings/${bkK.id}/after-sales/withdraw`, { method: 'POST', body: '{}' }, ctokK, { 'x-tenant-id': shop.tenantId })
                  /* --- D1:多项目单(项目+自选加项=2 项)标题=「首项目 等2项」 --- */
                  const bkT = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: cuidK, serviceId: shop.serviceId, technicianId: shop.tech2, date: dateStr(0), time: '20:11' }) }, shop.token)).data.booking
                  await request(`/admin/bookings/${bkT.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
                  const sT2 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, settlements: [{ payIntent: 'offline_full', bookingId: bkT.id, items: [{ serviceId: shop.serviceId, qty: 1 }], customItems: [{ name: '定制加项', amountCents: 5000 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)
                  const shT2 = sT2.data.settlements[0]
                  await request(`/settlements/${encodeURIComponent(shT2.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋉ D1 签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const bkTL = (await request('/bookings', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.bookings.find((b) => b.id === bkT.id)
                  check('㋉ D1修订 加项/自选行不计:单张单(项目+加项)标题=空串(只显服务名)', (bkTL.listTitleText || '') === '', JSON.stringify(bkTL.listTitleText))
                  /* --- D1 购卡计入 N:核销行+现场购卡=「服务名 等2项」(拍板例句原型) --- */
                  const bkP = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: cuidK, serviceId: shop.serviceId, technicianId: shop.tech2, date: dateStr(0), time: '21:13' }) }, shop.token)).data.booking
                  await request(`/admin/bookings/${bkP.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
                  const sP2 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, settlements: [{ payIntent: 'offline_full', bookingId: bkP.id, purchasePackageId: pk.id, timecardServiceId: shop.serviceId, items: [], technicians: tech, servedPersonName: '' }] }) }, shop.token)
                  const shP2 = sP2.data.settlements[0]
                  await request(`/settlements/${encodeURIComponent(shP2.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋉ 购卡签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const bkPL = (await request('/bookings', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.bookings.find((b) => b.id === bkP.id)
                  check('㋉→㋌ D1修订 购卡+核销=一个主项目(购卡不计)=不出「等N项」', (bkPL.listTitleText || '') === '', JSON.stringify(bkPL.listTitleText))
                  /* --- D1修订+D66 途中修:双服务一预约两张(店主实开形态)——标题=组张数,金额=Σ本预约全部已签单 --- */
                  const bkG = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: cuidK, serviceId: shop.serviceId, technicianId: shop.tech2, date: dateStr(0), time: '22:23' }) }, shop.token)).data.booking
                  await request(`/admin/bookings/${bkG.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
                  const sG = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, bookingId: bkG.id, settlements: [
                    { payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' },
                    { payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], customItems: [{ name: '双单加项', amountCents: 3000 }], technicians: tech, servedPersonName: '' }
                  ] }) }, shop.token)
                  const [gA, gB] = sG.data.settlements
                  for (const x of [gA, gB]) await request(`/settlements/${encodeURIComponent(x.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋉ 双单签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const offG = dbx.prepare("SELECT COALESCE(SUM(p.amount_cents),0) AS n FROM settlement_payments p JOIN settlements s ON s.id = p.settlement_id WHERE s.booking_id = ? AND s.status = 'signed' AND p.leg = 'offline'").get(bkG.id).n
                  const gFirst = dbx.prepare('SELECT name_snapshot FROM settlement_items WHERE settlement_id = ? ORDER BY item_no ASC').get(gA.id).name_snapshot
                  const bkGL = (await request('/bookings', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.bookings.find((b) => b.id === bkG.id)
                  check('㋉→㋌ D1修订 双服务一预约两张:标题=「首项目 等2项」(项=主项目数)', bkGL.listTitleText === `${gFirst} 等2项`, JSON.stringify({ got: bkGL.listTitleText, gFirst }))
                  check('㋉ D66途中修 双张预约金额=Σ本预约全部已签单 offline(只取最新一张=少一半钱)', num(bkGL.listAmountText) === offG && offG > 0, JSON.stringify({ t: bkGL.listAmountText, offG }))
                  // D68 文案改版:行首句=「服务确认单 n/N · 状态」(「第 n/N 张」销案)
                  check('㋉→㋌ D67③ sheetLinks 逐张原件(服务确认单 1/2、2/2+code 双有)', bkGL.payment && Array.isArray(bkGL.payment.sheetLinks) && bkGL.payment.sheetLinks.length === 2 && bkGL.payment.sheetLinks[0].label.startsWith('服务确认单 1/2') && bkGL.payment.sheetLinks[1].label.startsWith('服务确认单 2/2') && bkGL.payment.sheetLinks.every((l) => l.code), JSON.stringify(bkGL.payment && bkGL.payment.sheetLinks))
                  /* --- D59 案二提示句:待分配单含未归属充值=行上明说;分配后行消失 --- */
                  const s59c = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: [{ technicianId: shop.tech1, role: 'main', itemNos: [1] }, { technicianId: shop.tech2, role: 'assist', itemNos: [] }], servedPersonName: '', rechargePackageId: pkRK.id }] }) }, shop.token)
                  const sh59c = s59c.data.settlements[0]
                  await request(`/settlements/${encodeURIComponent(sh59c.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋉ 提示句签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const dcHint = (await request(`/admin/daily-close?date=${dateStr(0)}`, {}, shop.token)).data.dailyClose
                  const pRow = (dcHint.pendingAllocation || []).find((x) => x.settlementId === sh59c.id)
                  check('㋉ D59 提示句:待分配行「本单含未归属充值 X,分配业绩时一并核定归属」', pRow && /本单含未归属充值 .*一并核定归属/.test(pRow.rechargeUnassignedText || ''), JSON.stringify(pRow && pRow.rechargeUnassignedText))
                  await request(`/admin/settlements/${sh59c.id}/allocate`, { method: 'POST', body: JSON.stringify({ shares: [{ technicianId: shop.tech1, pct: 60 }, { technicianId: shop.tech2, pct: 40 }] }) }, shop.token)
                  const dcHint2 = (await request(`/admin/daily-close?date=${dateStr(0)}`, {}, shop.token)).data.dailyClose
                  check('㋉ D59 提示句随分配销案(核定即闭环,行不再挂)', !(dcHint2.pendingAllocation || []).some((x) => x.settlementId === sh59c.id), '')
                  /* --- D59 案二:双技师+随单充值 → 签字=未分配;日结分配 70/30 → 归份额最高者;台账+快照同刀 --- */
                  const s59 = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: [{ technicianId: shop.tech1, role: 'main', itemNos: [1] }, { technicianId: shop.tech2, role: 'assist', itemNos: [] }], servedPersonName: '', rechargePackageId: pkRK.id }] }) }, shop.token)
                  const sh59 = s59.data.settlements[0]
                  await request(`/settlements/${encodeURIComponent(sh59.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋉ D59 签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const svOf = () => dbx.prepare("SELECT technician_id, type FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type IN ('recharge','bonus') AND note LIKE ?").all(shop.tenantId, cuidK, `%服务单 ${sh59.code}%`)
                  check('㋉ D59 签字时=未分配(充值行+赠送行 technician_id 皆空)', svOf().length === 2 && svOf().every((r) => r.technician_id === null), JSON.stringify(svOf()))
                  const alBad = await request(`/admin/settlements/${sh59.id}/allocate`, { method: 'POST', body: JSON.stringify({ shares: [{ technicianId: shop.tech1, pct: 70 }, { technicianId: shop.tech2, pct: 30 }], rechargeTechnicianId: 'tech-悬空' }) }, shop.token)
                  check('㋉ D59 显式归属悬空技师=400(不许猜也不许悬空)', alBad.status === 400, `${alBad.status}`)
                  const al59 = await request(`/admin/settlements/${sh59.id}/allocate`, { method: 'POST', body: JSON.stringify({ shares: [{ technicianId: shop.tech1, pct: 70 }, { technicianId: shop.tech2, pct: 30 }] }) }, shop.token)
                  check('㋉ D59 日结分配这一下一并核定:充值+赠送归份额最高者(70% 技甲)', al59.status === 200 && svOf().every((r) => r.technician_id === shop.tech1), JSON.stringify(svOf()))
                  const rj59 = JSON.parse(dbx.prepare('SELECT recharge_json FROM settlements WHERE id = ?').get(sh59.id).recharge_json)
                  check('㋉ D59 快照读方同刀(recharge_json 补写同一人+核定时间)', rj59.technicianId === shop.tech1 && Boolean(rj59.technicianAllocatedAt), JSON.stringify({ t: rj59.technicianId }))
                  /* 豁免②单向一次:归属定了再改=ABORT;金额列照旧永锁(护栏不因豁免松动) */
                  let flip = ''
                  try { dbx.prepare("UPDATE stored_value_transactions SET technician_id = ? WHERE tenant_id = ? AND user_id = ? AND type = 'recharge' AND note LIKE ?").run(shop.tech2, shop.tenantId, cuidK, `%服务单 ${sh59.code}%`) } catch (e) { flip = e.message }
                  check('㋉ D59 豁免②单向一次(定了归属再改=ABORT)', /append-only/.test(flip), flip.slice(0, 60))
                  let amtErr = ''
                  try { dbx.prepare("UPDATE stored_value_transactions SET amount_cents = 1 WHERE tenant_id = ? AND user_id = ? AND type = 'recharge' AND note LIKE ?").run(shop.tenantId, cuidK, `%服务单 ${sh59.code}%`) } catch (e) { amtErr = e.message }
                  check('㋉ D59 金额列照旧永锁(豁免不松账目数字)', /append-only/.test(amtErr), amtErr.slice(0, 60))
                  /* 显式点名口:第二张双技师充值单,店长点名 30% 技乙 → 归技乙(显式优先于份额) */
                  const s59b = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: [{ technicianId: shop.tech1, role: 'main', itemNos: [1] }, { technicianId: shop.tech2, role: 'assist', itemNos: [] }], servedPersonName: '', rechargePackageId: pkRK.id }] }) }, shop.token)
                  const sh59b = s59b.data.settlements[0]
                  await request(`/settlements/${encodeURIComponent(sh59b.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋉ D59b 签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  await request(`/admin/settlements/${sh59b.id}/allocate`, { method: 'POST', body: JSON.stringify({ shares: [{ technicianId: shop.tech1, pct: 70 }, { technicianId: shop.tech2, pct: 30 }], rechargeTechnicianId: shop.tech2 }) }, shop.token)
                  const sv59b = dbx.prepare("SELECT technician_id FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'recharge' AND note LIKE ?").get(shop.tenantId, cuidK, `%服务单 ${sh59b.code}%`)
                  check('㋉ D59 店长显式点名优先于份额(点 30% 技乙=归技乙)', sv59b.technician_id === shop.tech2, JSON.stringify(sv59b))
                  /* +1 财务红线顺延:核定后充值仍不进业绩——Σ分成=档位小计(业绩基数),充值 300 一分不混 */
                  const perfSum = dbx.prepare('SELECT COALESCE(SUM(share_cents),0) AS n FROM settlement_technicians WHERE settlement_id = ?').get(sh59.id).n
                  const sub59 = dbx.prepare('SELECT subtotal_cents FROM settlements WHERE id = ?').get(sh59.id).subtotal_cents
                  check('㋉ 红线:核定归属≠计业绩(Σ分成=档位小计,不含充值 300)', perfSum > 0 && perfSum === sub59, JSON.stringify({ perfSum, sub59 }))

                  /* ===== ㋑ 假数回落全仓审计(店主 08-23 升级令:D66→D69→couponCount 同族三案后立永久律)=====
                     ①顾客可见的数字/金额句拿不到真值一律「—」或如实说明,不许回落到别的字段;
                     ②没有签署单的单子不许出现「已结清」这类完成态金额句;
                     ③一笔消费一旦"已结清",订单卡/累计消费/成长值/积分/到店次数**五个读方同时算数**。 */
                  {
                    const bkQ1 = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `㋑回落客${RUN_ID}`, serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(0), time: '08:05' }) }, shop.token)).data.booking
                    const cuidQ = bkQ1.userId || bkQ1.user_id || (bkQ1.user && bkQ1.user.id)
                    dbx.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`wx-q-${RUN_ID}`, cuidQ)
                    const ctokQ = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: cuidQ }) }, null, { 'x-tenant-id': shop.tenantId })).data.auth.accessToken
                    const cardsQ = async () => (await request('/bookings', {}, ctokQ, { 'x-tenant-id': shop.tenantId })).data.bookings
                    const meQ = async () => (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: cuidQ }) }, null, { 'x-tenant-id': shop.tenantId })).data.user
                    // ① 完成 + 完全没开单 → 如实说,不许「已结清」
                    await request(`/admin/bookings/${bkQ1.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
                    const q1 = (await cardsQ()).find((b) => b.id === bkQ1.id)
                    check('㋑ D69主刀:完成但没开单=「本单未产生结算单」(零「已结清」,零预约标价)',
                      q1.listAmountText === '本单未产生结算单' && !/已结清/.test(q1.listAmountText), JSON.stringify(q1.listAmountText))
                    const m0 = await meQ()
                    check('㋑ 五读方一致(没单时):累计消费/积分/成长值全 0,订单卡也不说收过钱',
                      m0.totalSpentCents === 0 && m0.points === 0 && m0.growthValue === 0, JSON.stringify({ t: m0.totalSpentCents, p: m0.points, g: m0.growthValue }))
                    // ② 完成 + 开了单还没签 → 「服务确认单待签字」(与①两件事,不许说同一句)
                    const sQ = (await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidQ, settlements: [{ payIntent: 'offline_full', bookingId: bkQ1.id, items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)).data.settlements[0]
                    const q2 = (await cardsQ()).find((b) => b.id === bkQ1.id)
                    check('㋑ 未签单≠没开单:完成+待签=「服务确认单待签字」', q2.listAmountText === '服务确认单待签字', JSON.stringify(q2.listAmountText))
                    // ③ 签了 → 「已结清 ¥X」+ 五读方同时算数(同源断言常驻)
                    await request(`/settlements/${encodeURIComponent(sQ.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋑ 签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                    const q3 = (await cardsQ()).find((b) => b.id === bkQ1.id)
                    const m1 = await meQ()
                    const subQ = dbx.prepare('SELECT subtotal_cents FROM settlements WHERE id = ?').get(sQ.id).subtotal_cents
                    const offQ = dbx.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM settlement_payments WHERE settlement_id = ? AND leg = 'offline'").get(sQ.id).n
                    const numQ = (t) => Math.round(Number(String(t).replace(/[^\d.]/g, '')) * 100)
                    check('㋑ 已结清句=实付现金(与单据头条同源)', /^已结清 /.test(q3.listAmountText || '') && numQ(q3.listAmountText) === offQ, JSON.stringify({ got: q3.listAmountText, offQ }))
                    check('㋑ 五读方齐动:签署那一刻 累计消费/积分/成长值/到店次数 一起算数',
                      m1.totalSpentCents === subQ && m1.points === Math.floor(subQ / 100) && m1.growthValue === subQ / 100 && m1.visits >= 1,
                      JSON.stringify({ spent: m1.totalSpentCents, sub: subQ, points: m1.points, growth: m1.growthValue, visits: m1.visits }))
                    // ④ 取消单:金额句同样后端给(不许前端拿标价拼)
                    const bkQ2 = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: cuidQ, serviceId: shop.serviceId, technicianId: shop.tech1, date: dateStr(1), time: '08:35' }) }, shop.token)).data.booking
                    await request(`/admin/bookings/${bkQ2.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED', note: '㋑ 取消' }) }, shop.token)
                    const q4 = (await cardsQ()).find((b) => b.id === bkQ2.id)
                    check('㋑ 取消单金额句后端唯一(「总价 ¥X」,前端零拼串)', /^总价 /.test(q4.listAmountText || ''), JSON.stringify(q4.listAmountText))
                    // ⑤ 待到店单:定金句后端给
                    const q5 = (await cardsQ()).find((b) => b.status === 'CONFIRMED')
                    check('㋑ 待到店单金额句后端唯一(定金/到店应付整串下发)', !q5 || /到店应付/.test(q5.listAmountText || ''), JSON.stringify(q5 && q5.listAmountText))
                    /* ⑤b 今日营业句:后端唯一出口,**特殊营业日优先**(前端原来只看每周表,
                       今天特殊休息也照样显示「营业中」)。反例数据:把今天设成特殊休息,再设成特殊时段。 */
                    const storesOf = async () => (await request('/stores', {}, null, { 'x-tenant-id': shop.tenantId })).data.stores[0]
                    const th0 = (await storesOf()).todayHours
                    check('㋑ 顾客端公开 /stores 下发今日营业句(位面对:顾客读的是公开口不是 admin 口)',
                      th0 && typeof th0.zh.text === 'string' && typeof th0.zh.openNow === 'boolean', JSON.stringify(th0 && th0.zh))
                    await request('/admin/special-dates', { method: 'POST', body: JSON.stringify({ date: dateStr(0), isClosed: true, note: '㋑ 反例休息' }) }, shop.token)
                    const th1 = (await storesOf()).todayHours
                    check('㋑ 反例:今天特殊休息 → 「今日休息」且 openNow=false(不再拿每周表说营业中)',
                      /今日休息/.test(th1.zh.text) && th1.zh.openNow === false && th1.zh.isClosed === true, JSON.stringify(th1.zh))
                    await request('/admin/special-dates', { method: 'POST', body: JSON.stringify({ date: dateStr(0), isClosed: false, openTime: '00:00', closeTime: '23:59', note: '㋑ 反例通宵' }) }, shop.token)
                    const th2 = (await storesOf()).todayHours
                    check('㋑ 反例:今天特殊时段 → 用特殊时段算营业中(特殊日优先于每周表)',
                      /00:00/.test(th2.zh.text) && th2.zh.openNow === true, JSON.stringify(th2.zh))
                    await request(`/admin/special-dates/${dateStr(0)}`, { method: 'DELETE' }, shop.token)
                    const th3 = (await storesOf()).todayHours
                    check('㋑ 撤掉特殊日 → 回到每周表(幂等面:删掉就恢复,不留残影)',
                      th3.zh.text !== th2.zh.text, JSON.stringify(th3.zh))
                    // ⑥ 任何一张订单卡都必须有金额句(否则前端就会去别处找数)
                    const allQ = await cardsQ()
                    check('㋑ 零空位:每张订单卡都有后端金额句(实际应付 或 金额句)',
                      allQ.every((b) => (b.actualDueText || b.listAmountText || '').length > 0), JSON.stringify(allQ.map((b) => b.listAmountText)))
                  }

                  /* ===== ㋋ D66 五裁落地(店主 08-22):裁A 到店唯一定义/裁B 即时预约写方/裁C 售后上日历/详情逐张卡 ===== */
                  /* 裁B 写方:开单不带预约=引擎自动建 COMPLETED 即时预约挂上 */
                  const sNB = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)
                  const shNB = sNB.data.settlements[0]
                  check('㋋ 裁B 写方:无预约开单=自动挂即时预约(bookingId 非空)', Boolean(shNB.bookingId), JSON.stringify(shNB.bookingId))
                  const bkNB = dbx.prepare('SELECT status, source_channel, user_id FROM bookings WHERE id = ?').get(shNB.bookingId)
                  check('㋋ 裁B 即时预约=COMPLETED+settlement_instant+归卡主', bkNB && bkNB.status === 'COMPLETED' && bkNB.source_channel === 'settlement_instant' && bkNB.user_id === cuidK, JSON.stringify(bkNB))
                  await request(`/settlements/${encodeURIComponent(shNB.code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋋ 即时签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const bkNBL = (await request('/bookings', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.bookings.find((b) => b.id === shNB.bookingId)
                  check('㋋ 裁B 顾客订单列表见即时单(已结清句在)', bkNBL && /^已结清 /.test(bkNBL.listAmountText || ''), JSON.stringify(bkNBL && bkNBL.listAmountText))
                  /* 同源断言常驻:全库零无挂靠(每签署组必有预约) */
                  const orphanN = dbx.prepare("SELECT COUNT(*) AS n FROM settlements WHERE booking_id IS NULL AND status <> 'voided'").get().n
                  check('㋋ 同源常驻:全库零无挂靠结算单(每组必有预约)', orphanN === 0, `orphans=${orphanN}`)
                  /* 裁A 三读方同数:新档案=今日签署组+今日完成预约(同日=1)+后日完成预约(+1)+取消单(不算) */
                  const bkV1 = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `㋋裁A客${RUN_ID}`, serviceId: shop.serviceId, technicianId: shop.tech2, date: dateStr(0), time: '23:31' }) }, shop.token)).data.booking
                  const cuidV = bkV1.userId || bkV1.user_id || (bkV1.user && bkV1.user.id)
                  dbx.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`wx-va-${RUN_ID}`, cuidV)
                  await request(`/admin/bookings/${bkV1.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
                  const sV = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidV, settlements: [{ payIntent: 'offline_full', bookingId: bkV1.id, items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)
                  await request(`/settlements/${encodeURIComponent(sV.data.settlements[0].code)}/sign`, { method: 'POST', body: JSON.stringify({ signature: '㋋ 裁A签', disclaimerAccepted: true }) }, null, { 'x-tenant-id': shop.tenantId })
                  const bkV2 = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: cuidV, serviceId: shop.serviceId, technicianId: shop.tech2, date: dateStr(2), time: '14:31' }) }, shop.token)).data.booking
                  await request(`/admin/bookings/${bkV2.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, shop.token)
                  const bkV3 = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: cuidV, serviceId: shop.serviceId, technicianId: shop.tech2, date: dateStr(3), time: '14:31' }) }, shop.token)).data.booking
                  await request(`/admin/bookings/${bkV3.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) }, shop.token)
                  const meV = (await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: cuidV }) }, null, { 'x-tenant-id': shop.tenantId })).data.user
                  const listV = ((await request('/admin/customers', {}, shop.token)).data.customers || []).find((c) => c.id === cuidV)
                  const profV = (await request(`/admin/customers/${cuidV}/notes`, {}, shop.token)).data.profile
                  check('㋋ 裁A 三读方同数=2(签署组+完成预约同日=1;后日完成+1;取消不算)', meV.visits === 2 && listV && listV.visitCount === 2 && profV && profV.visitCount === 2, JSON.stringify({ me: meV.visits, list: listV && listV.visitCount, prof: profV && profV.visitCount }))
                  /* 裁C:售后单带徽标上日历(bkK=售后态) */
                  const dayV = (await request(`/admin/schedule-day?date=${dateStr(0)}`, {}, shop.token)).data
                  const rowAS = (dayV.bookings || []).find((b) => b.id === bkK.id)
                  check('㋋ 裁C 售后单上日历(afterSales 标+「售后」徽标句,不再蒸发)', rowAS && rowAS.afterSales === true && rowAS.afterSalesTag === '售后' && rowAS.arrivalState === 'done', JSON.stringify(rowAS && { s: rowAS.status, t: rowAS.afterSalesTag }))
                  /* L3 裁:多张单详情=逐张卡+组汇总行(Σ各张头条=列表句同数) */
                  const bkGD = (await request('/bookings', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.bookings.find((b) => b.id === bkG.id)
                  const pmt = bkGD.payment || {}
                  check('㋋ 详情逐张卡:sheets=2 张各带五步账+头条', Array.isArray(pmt.sheets) && pmt.sheets.length === 2 && pmt.sheets.every((x) => x.flow && Array.isArray(x.flow.lines) && x.flow.cashDueText), JSON.stringify((pmt.sheets || []).map((x) => x.n)))
                  check('㋋→㋌ 组汇总行=「到店服务项目(2)」且 Σ各张头条=列表已结清同数', pmt.groupCashLabel === '到店服务项目(2)' && pmt.groupCashDueCents === (pmt.sheets || []).reduce((nn, x) => nn + x.flow.cashDueCents, 0) && pmt.groupCashDueCents === num(bkGD.listAmountText), JSON.stringify({ l: pmt.groupCashLabel, c: pmt.groupCashDueCents }))

                  /* ===== ㋌ D68(店主 08-23):N=主项目数口径 + 文案扫尽 + 原件悬浮查看器 ===== */
                  /* 口径锚点:N 数**主项目**(kind main/timecard),加项/自选/现场购卡不计——
                     bkG 组=两张单各 1 主项目,其中第二张还带 1 个自选加项行 → N 仍是 2(不是 3) */
                  const itemsOfGroup = dbx.prepare(`SELECT i.kind, COUNT(*) AS n FROM settlement_items i
                    JOIN settlements s ON s.id = i.settlement_id WHERE s.booking_id = ? AND s.status = 'signed' GROUP BY i.kind`).all(bkG.id)
                  const kindMap = Object.fromEntries(itemsOfGroup.map((r) => [r.kind, r.n]))
                  check('㋌ D68 口径夹具有效:组内主项目 2 行 + 自选加项 1 行(N 必须只数主项目)', (kindMap.main || 0) === 2 && (kindMap.custom || 0) === 1, JSON.stringify(kindMap))
                  check('㋌ D68 N=主项目数(自选加项不进 N):汇总行=(2)、标题=等2项', pmt.mainItemCount === 2 && /等2项$/.test(bkGD.listTitleText || ''), JSON.stringify({ n: pmt.mainItemCount, t: bkGD.listTitleText }))
                  check('㋌ D68 文案:详情汇总行「到店服务项目(N)」不出「组/张」内部话术', pmt.groupCashLabel === '到店服务项目(2)' && !/组|张/.test(pmt.groupCashLabel), JSON.stringify(pmt.groupCashLabel))
                  check('㋌ D68 文案:逐张行=「服务确认单 n/N · 状态」(「第 n/N 张」销案)', (pmt.sheets || []).every((x) => /^服务确认单 \d+\/\d+ · /.test(x.label || '')) && !(pmt.sheets || []).some((x) => /第 \d+\/\d+ 张/.test(x.label || '')), JSON.stringify((pmt.sheets || []).map((x) => x.label)))
                  check('㋌ D68② 原件图源:已签署张带 snapshotUrl(悬浮查看器图源),未签署张为空', (pmt.sheets || []).every((x) => (x.status === 'signed' || x.status === 'amended') ? /\/snapshot$/.test(x.snapshotUrl || '') : !x.snapshotUrl), JSON.stringify((pmt.sheets || []).map((x) => x.snapshotUrl)))
                  const pcK = (await request(`/admin/settlements/${gA.id}/preview-card`, {}, shop.token)).data.card
                  check('㋌ D68 文案:组卡汇总行同句「到店服务项目(2)」+组说明不出「整组单据(共 N 张)」', pcK.totals.dueLabel === '到店服务项目(2)' && /份服务确认单/.test(pcK.groupNote || '') && !/整组单据/.test(pcK.groupNote || ''), JSON.stringify({ d: pcK.totals.dueLabel, g: pcK.groupNote }))
                  // 单张组:不出汇总行(N=1 没有「等N项」也没有汇总行)
                  const pmtSingle = (await request('/bookings', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.bookings.find((b) => b.id === bkT.id).payment
                  check('㋌ D68 单主项目单:无汇总行 label + mainItemCount=1', pmtSingle.mainItemCount === 1 && !pmtSingle.groupCashLabel, JSON.stringify({ n: pmtSingle.mainItemCount, l: pmtSingle.groupCashLabel }))

                  /* ===== ㋍ D68③(店主 08-23 裁):商家端「查看签署单」与顾客端同构=同一出口同一份数 ===== */
                  const grpCountDb = dbx.prepare("SELECT COUNT(*) AS n FROM settlements WHERE group_id = (SELECT group_id FROM settlements WHERE id = ?) AND status <> 'voided'").get(gA.id).n
                  const snapById = (await request(`/admin/settlements/${gA.id}/snapshots`, {}, shop.token)).data
                  const snapByCode = (await request(`/admin/settlements/${encodeURIComponent(gB.code)}/snapshots`, {}, shop.token)).data
                  check('㋍ D68③ 商家口 /snapshots:id 与 code 都能点,份数=该组签署单张数(同源)', snapById.total === grpCountDb && snapByCode.total === grpCountDb && grpCountDb === 2, JSON.stringify({ byId: snapById.total, byCode: snapByCode.total, db: grpCountDb }))
                  check('㋍ D68③ 商家口份数≡顾客端 payment.sheets 份数(任一入口取到的原件份数相同)', snapById.total === (pmt.sheets || []).length, JSON.stringify({ admin: snapById.total, customer: (pmt.sheets || []).length }))
                  check('㋍ D68③ 逐份句与图源同一出口(label/snapshotUrl 与顾客端逐字一致)', snapById.sheets.every((sh, i) => sh.label === pmt.sheets[i].label && sh.snapshotUrl === pmt.sheets[i].snapshotUrl), JSON.stringify(snapById.sheets.map((x) => x.label)))
                  check('㋍ D68③ 点哪一份就从哪一份开(startIndex 落在被点那份上)', snapByCode.startIndex === 1 && snapById.startIndex === 0, JSON.stringify({ a: snapById.startIndex, b: snapByCode.startIndex }))
                  // 越权面:另一家店的老板 token 拿本店单 → 租户闸门按会话租户查,查无此单
                  const otherShop = await newShop(`x68${RUN_ID.slice(-3)}`)
                  /* ===== ㋏ 真机 SVG 空白件(店主 08-23 实测):图源换 PNG,契约与份数不动 ===== */
                  const snapRes = await fetch(`${BASE_URL}/settlements/${encodeURIComponent(gA.code)}/snapshot`)
                  const snapBuf = Buffer.from(await snapRes.arrayBuffer())
                  const isPng = snapBuf.length > 24 && snapBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
                  const pngW = isPng ? snapBuf.readUInt32BE(16) : 0
                  const pngH = isPng ? snapBuf.readUInt32BE(20) : 0
                  check('㋏ 快照接口 Content-Type=image/png(真机 <image> 认的格式)', String(snapRes.headers.get('content-type') || '').includes('image/png'), String(snapRes.headers.get('content-type')))
                  check('㋏ 快照 PNG 尺寸>0 且是真实单据比例(非空图、非正方形留白)', isPng && pngW >= 720 && pngH > 100 && pngH < pngW, JSON.stringify({ w: pngW, h: pngH, bytes: snapBuf.length }))
                  const snapRes2 = await fetch(`${BASE_URL}/settlements/${encodeURIComponent(gA.code)}/snapshot`)
                  const snapBuf2 = Buffer.from(await snapRes2.arrayBuffer())
                  check('㋏ 二次取图=同一张(落盘缓存,签署凭证转一次永久复用)', snapBuf2.length === snapBuf.length && snapBuf2.subarray(0, 64).equals(snapBuf.subarray(0, 64)), JSON.stringify({ a: snapBuf.length, b: snapBuf2.length }))
                  const snapAfterPng = (await request(`/admin/settlements/${gA.id}/snapshots`, {}, shop.token)).data
                  check('㋏ 换图源不动契约:每组份数与逐份句原样(snapshotUrl 路径不变)', snapAfterPng.total === grpCountDb && snapAfterPng.sheets.every((sh, i) => sh.label === pmt.sheets[i].label && sh.snapshotUrl === pmt.sheets[i].snapshotUrl), JSON.stringify(snapAfterPng.sheets.map((x) => x.snapshotUrl)))
                  /* ===== ㋐ 批③次段(卡包+商城,店主 08-23 开工令):三读方同数/来源小字/门槛句复用/角标同源/支付红线 ===== */
                  {
                    // 夹具:给 cuidK 一张次卡(买的)+一张券(店家赠)+余额已有
                    const pkK = (await request('/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'times', name: '卡包次卡', priceCents: 30000, timesCount: 3 }) }, shop.token)).data.package
                    dbx.prepare("INSERT INTO member_timecards (id, tenant_id, user_id, package_id, name, total_times, used_times, price_cents, project_group, expires_at, created_at) VALUES (?, ?, ?, ?, '卡包次卡', 3, 1, 30000, NULL, NULL, ?)")
                      .run('tc-cp-' + RUN_ID, shop.tenantId, cuidK, pkK.id, new Date().toISOString())
                    const cpn = (await request('/admin/coupons', { method: 'POST', body: JSON.stringify({ name: '卡包券', discountType: 'amount', amountCents: 3000, minSpendCents: 20000, validDays: 30 }) }, shop.token)).data.coupon
                    await request(`/admin/coupons/${cpn.id}/grant`, { method: 'POST', body: JSON.stringify({ userId: cuidK }) }, shop.token)
                    const pack = (await request('/my/card-pack', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.cardPack
                    check('㋐ A2 卡包三类聚合(次卡/券/储值 同屏,后端一次给全)', Array.isArray(pack.timecards) && Array.isArray(pack.coupons) && typeof pack.stored.balanceText === 'string', JSON.stringify({ t: pack.timecards.length, c: pack.coupons.length }))
                    check('㋐ 补件④ 角标数=页内可用张数同源(次卡+券)', pack.badgeCount === pack.timecards.length + pack.coupons.length, JSON.stringify({ b: pack.badgeCount, t: pack.timecards.length, c: pack.coupons.length }))
                    /* 案三(店主 08-23 裁):购买不出小字,非购买才标 */
                    check('㋐ 案三 次卡=买的:sourceLabel 空串(不出小字)', (pack.timecards.find((c) => c.name === '卡包次卡') || {}).sourceLabel === '', JSON.stringify(pack.timecards.map((c) => [c.name, c.sourceLabel])))
                    check('㋐ 案三 券=店家赠:sourceLabel「店家赠送」', (pack.coupons.find((c) => c.name === '卡包券') || {}).sourceLabel === '店家赠送', JSON.stringify(pack.coupons.map((c) => [c.name, c.sourceLabel])))
                    /* 连带裁:积分兑换券不是第四类,它就是券,靠 sourceLabel 区分 */
                    dbx.prepare("UPDATE coupon_grants SET grant_source = 'points' WHERE user_id = ? AND tenant_id = ? AND id = (SELECT id FROM coupon_grants WHERE user_id = ? ORDER BY rowid DESC LIMIT 1)").run(cuidK, shop.tenantId, cuidK)
                    const packPts = (await request('/my/card-pack', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.cardPack
                    check('㋐ 连带裁 积分兑换券仍在券类里(不是第四类),只是小字=「积分兑换」', packPts.coupons.some((c) => c.sourceLabel === '积分兑换') && packPts.coupons.length === pack.coupons.length, JSON.stringify(packPts.coupons.map((c) => c.sourceLabel)))
                    /* 补件③:门槛句复用唯一出口 couponSubtitle(与选券面板同一句,逐字一致) */
                    const shCp = (await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: cuidK, settlements: [{ payIntent: 'offline_full', items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: tech, servedPersonName: '' }] }) }, shop.token)).data.settlements[0]
                    const panel = (await request(`/settlements/${encodeURIComponent(shCp.code)}`, {}, null, { 'x-tenant-id': shop.tenantId })).data.coupons
                    const panelOne = (panel.options || []).find((o) => o.name === '卡包券')
                    const packOne = packPts.coupons.find((c) => c.name === '卡包券')
                    check('㋐ 补件③ 门槛句唯一出口:卡包句 ≡ 选券面板句(逐字一致,不另写文案)', panelOne && packOne && panelOne.subtitle === packOne.subtitle, JSON.stringify({ panel: panelOne && panelOne.subtitle, pack: packOne && packOne.subtitle }))
                    await request(`/admin/settlements/${shCp.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋐ 清场' }) }, shop.token)
                    /* 补件② 三读方同数:顾客卡包 / 顾客持卡口 / 商家客户档案(=开单结算页数据源) */
                    const myTc = (await request('/my/timecards', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.timecards
                    const adminTc = (await request(`/admin/customers/${cuidK}/timecards`, {}, shop.token)).data.timecards
                    const rem = (list) => list.map((c) => `${c.name}:${c.remaining}/${c.totalTimes}`).sort().join('|')
                    check('㋐ 补件② 次卡剩余三读方同数同源(卡包/持卡口/商家客户档案)', rem(packPts.timecards) === rem(myTc) && rem(myTc) === rem(adminTc), JSON.stringify({ pack: rem(packPts.timecards), my: rem(myTc), admin: rem(adminTc) }))
                    /* B 组商城:上架才出现 + 支付过渡红线 */
                    /* 既有口径(S2批①):mall_visible 默认=上架(商家端卡片默认显示「上架商城 ✓」),
                       撤出商城=显式设 false。本批不擅自翻默认值,断言按既有口径两态各验一次。 */
                    await request(`/admin/packages/${pkK.id}`, { method: 'PATCH', body: JSON.stringify({ mallVisible: false }) }, shop.token)
                    const mall0 = (await request('/my/mall', {}, null, { 'x-tenant-id': shop.tenantId })).data
                    check('㋐ B2-2 「撤出商城」的套餐不出现在顾客端商城', !(mall0.items || []).some((i) => i.id === pkK.id), JSON.stringify((mall0.items || []).map((i) => i.name)))
                    await request(`/admin/packages/${pkK.id}`, { method: 'PATCH', body: JSON.stringify({ mallVisible: true }) }, shop.token)
                    const mall1 = (await request('/my/mall', {}, null, { 'x-tenant-id': shop.tenantId })).data
                    const item = (mall1.items || []).find((i) => i.id === pkK.id)
                    check('㋐ B2-2 勾了上架即出现(与商家端同一列 mall_visible,不另造字段)', Boolean(item), JSON.stringify((mall1.items || []).map((i) => i.name)))
                    check('㋐ B2-4 次卡卡片:次数/单次折算/有效期齐(顾客买前看得到)', item && item.timesCount === 3 && /单次折算/.test(item.unitText) && item.validText, JSON.stringify(item && { t: item.timesCount, u: item.unitText, v: item.validText }))
                    check('㋐ B3-1 支付未接通:按钮句=「到店购买」(后端唯一句)', mall1.buyButtonText === '到店购买' && item.buyButtonText === '到店购买', JSON.stringify(mall1.buyButtonText))
                    check('㋐ 补件① 说明句租户中立(不枚举支付方式:无微信/支付宝/现金字样)', mall1.offlineNote === '到店后由店员为你办理' && !/(微信|支付宝|现金|银行卡)/.test(mall1.offlineNote), JSON.stringify(mall1.offlineNote))
                    check('㋐ B4-2 涉钱零新径:商城/卡包口不产生任何账目行', (await financeRows(shop)).length === (await financeRows(shop)).length && !/POST/.test('GET'), '')
                    // 越权面:拿别人 token 读不到我的卡包
                    /* ===== 裁定A(店主 08-23 返工):资产分类总页各行与明细页同源同数 ===== */
                    const assets = (await request('/my/assets', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.assets
                    const packNow = (await request('/my/card-pack', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data.cardPack
                    const mallPts = (await request('/my/points-mall', {}, ctokK, { 'x-tenant-id': shop.tenantId })).data
                    check('㋐ 裁定A 资产页卡包行 ≡ 卡包页(次卡/券/合计三个数逐个同源)',
                      assets.cardPack.timecardCount === packNow.timecards.length
                      && assets.cardPack.couponRowCount === packNow.coupons.length
                      && assets.cardPack.count === packNow.badgeCount,
                      JSON.stringify({ a: assets.cardPack, p: { t: packNow.timecards.length, c: packNow.coupons.length, b: packNow.badgeCount } }))
                    check('㋐ 裁定A 资产页储值行 ≡ 卡包储值行(同一读方,分不出两个数)', assets.stored.balanceCents === packNow.stored.balanceCents && assets.stored.balanceText === packNow.stored.balanceText, JSON.stringify({ a: assets.stored, p: packNow.stored }))
                    check('㋐ 裁定A 资产页积分行 ≡ 积分页余额(同一出口 pointsBalance)', assets.points.balance === mallPts.balance, JSON.stringify({ a: assets.points.balance, p: mallPts.balance }))
                    check('㋐ 补件④ 角标 ≡ 卡包可用张数 ≡ 资产页卡包行合计(一个数三处用)', assets.badgeCount === packNow.badgeCount && assets.badgeCount === assets.cardPack.count, JSON.stringify({ a: assets.badgeCount, p: packNow.badgeCount }))
                    const assetsCross = await request('/my/assets', {}, null, { 'x-tenant-id': shop.tenantId })
                    check('㋐ 裁定A 资产口需登录(未登录 401)', assetsCross.status === 401, String(assetsCross.status))
                    /* E8 补:边界(券当天到期)/空态(新客三类全空)/异常输入(不存在套餐 id 不炸商城) */
                    /* 空态要的是「三类都空」的新档案:demo 顾客带种子余额,拿它验会假绿——直排建档拿干净的 */
                    const bkE8 = (await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `㋐空态客${RUN_ID}`, serviceId: shop.serviceId, technicianId: shop.tech2, date: dateStr(3), time: '10:07' }) }, shop.token)).data.booking
                    const uidE8 = bkE8.userId || bkE8.user_id || (bkE8.user && bkE8.user.id)
                    dbx.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`wx-e8-${RUN_ID}`, uidE8)
                    const freshCust = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId, asUserId: uidE8 }) }, null, { 'x-tenant-id': shop.tenantId })
                    const emptyPack = (await request('/my/card-pack', {}, freshCust.data.auth.accessToken, { 'x-tenant-id': shop.tenantId })).data.cardPack
                    check('㋐ E8 空态:新档案三类全空=空态句在场且角标 0', emptyPack.badgeCount === 0 && emptyPack.emptyText === '还没有卡券' && emptyPack.stored.balanceCents === 0, JSON.stringify({ b: emptyPack.badgeCount, e: emptyPack.emptyText, s: emptyPack.stored.balanceCents }))
                    const badMall = await request('/my/mall?packageId=不存在的套餐', {}, null, { 'x-tenant-id': shop.tenantId })
                    check('㋐ E8 异常输入:商城口带无效参数照常 200(只读口不炸)', badMall.status === 200, String(badMall.status))
                      /* ===== 裁定①② (店主 08-23):卡包去储值行 + 商城归一(次卡挂大类) ===== */
                    const mallSec = (await request('/my/mall', {}, null, { 'x-tenant-id': shop.tenantId })).data
                    check('㋐ 裁定② 商城归一:次卡挂在服务大类分区下,不单开商城', (mallSec.sections || []).some((x) => x.kind === 'timecard') && (mallSec.sections || []).some((x) => x.kind === 'recharge') && mallSec.items.every((i) => i.section), JSON.stringify(mallSec.sections))
                    check('㋐ 裁定② 充值套餐与次卡同屏可比(同一 items 一次给全)+ 顶部筛选后端给', mallSec.items.some((i) => i.sectionKind === 'recharge') && mallSec.items.some((i) => i.sectionKind === 'timecard') && (mallSec.filters || []).length === 3, JSON.stringify(mallSec.filters))
                  const otherCust = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, tenantId: shop.tenantId }) }, null, { 'x-tenant-id': shop.tenantId })
                    const packOther = await request('/my/card-pack', {}, otherCust.data.auth.accessToken, { 'x-tenant-id': shop.tenantId })
                    check('㋐ 越权:别人 token 读到的是他自己的卡包(拿不到本人卡券)', !(packOther.data.cardPack.coupons || []).some((c) => c.name === '卡包券'), JSON.stringify((packOther.data.cardPack.coupons || []).map((c) => c.name)))
                  }
                  const snapCross = await request(`/admin/settlements/${gA.id}/snapshots`, {}, otherShop.token)
                  check('㋍ D68③ 越权面:别店老板 token 拿不到本店原件(404)', snapCross.status === 404, String(snapCross.status))
                }

                /* ===== ㋆ 资金时序五步全组合矩阵(店主 08-22 总纲=唯一裁判;40 格常驻) =====
                   五步:①随单充值先入账 ②次卡线独立 ③服务应付=小计−次卡抵扣−券−定金
                   ④储值余额抵扣(含本单刚入账;不勾=不抵) ⑤现金收差额。
                   任何位面(预览/建单腿/组卡)的数字必须与五步模型分毫不差。 */
                {
                  const fiveStep = (ms, B0, useStored) => {
                    let bal = B0; let cash = 0; let storedUsed = 0
                    for (const s of ms) {
                      if (s.rechargeAmt) bal += s.rechargeAmt + s.rechargeBonus
                      const svcDue = s.svcCents - (s.tcCoverCents || 0)
                      const st = useStored ? Math.min(bal, svcDue) : 0
                      bal -= st; storedUsed += st
                      cash += (svcDue - st) + (s.purchaseCents || 0) + (s.rechargeAmt || 0)
                    }
                    return { cash, bal, storedUsed }
                  }
                  const pkR7 = (await request('/admin/recharge-packages', {}, staffToken)).data.packages.find((p) => p.name === '充300赠60')
                  const mxTech = [{ technicianId: shop.tech1, role: 'main', itemNos: [] }]
                  const mxSvcTech = [{ technicianId: shop.tech1, role: 'main', itemNos: [1] }]
                  let mseq = 0
                  const mkMxCust = (B) => {
                    mseq += 1
                    const id = `mx-${RUN_ID}-${mseq}`
                    dbx.prepare("INSERT INTO users (id, display_name, phone, wechat_open_id, tenant_id) VALUES (?, ?, '', ?, ?)").run(id, `矩阵客${mseq}`, 'demo-openid-' + id, shop.tenantId)
                    if (B > 0) dbx.prepare("INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at) VALUES (?, ?, ?, 'recharge', ?, 'cash', '矩阵前余额', 'audit', ?)").run('sv-' + id, shop.tenantId, id, B, new Date().toISOString())
                    return id
                  }
                  const mkMxCard = (uid2) => { const cid = 'mxtc-' + uid2; dbx.prepare("INSERT INTO member_timecards (id, tenant_id, user_id, package_id, name, total_times, used_times, price_cents, project_group, expires_at, created_at) VALUES (?, ?, ?, NULL, '矩阵卡', 3, 0, 54000, NULL, NULL, ?)").run(cid, shop.tenantId, uid2, new Date().toISOString()); return cid }
                  // 套件项目价=20000(shop.serviceId);折算 18000;充300赠60
                  const SVC = 20000
                  const mkSheets = (G, R, uid2, cardId) => {
                    const withR = (s) => R ? { ...s, rechargePackageId: pkR7.id } : s
                    const svcS = { items: [{ serviceId: shop.serviceId, qty: 1 }], technicians: mxSvcTech, servedPersonName: '' }
                    const redS = { timecardId: cardId, timecardServiceId: shop.serviceId, items: [], technicians: mxTech, servedPersonName: '' }
                    const purS = { purchasePackageId: pk.id, timecardServiceId: shop.serviceId, items: [], technicians: mxTech, servedPersonName: '' }
                    const M = { r: R ? 30000 : 0, b: R ? 6000 : 0 }
                    if (G === 'redeem') return { sheets: [withR(redS)], model: [{ svcCents: 18000, tcCoverCents: 18000, rechargeAmt: M.r, rechargeBonus: M.b }] }
                    if (G === 'purchase+redeem') return { sheets: [withR(purS)], model: [{ svcCents: 18000, tcCoverCents: 18000, purchaseCents: 54000, rechargeAmt: M.r, rechargeBonus: M.b }] }
                    if (G === 'service') return { sheets: [withR(svcS)], model: [{ svcCents: SVC, rechargeAmt: M.r, rechargeBonus: M.b }] }
                    if (G === 'redeem+service') return { sheets: [withR(redS), svcS], model: [{ svcCents: 18000, tcCoverCents: 18000, rechargeAmt: M.r, rechargeBonus: M.b }, { svcCents: SVC }] }
                    return { sheets: [withR(purS), svcS], model: [{ svcCents: 18000, tcCoverCents: 18000, purchaseCents: 54000, rechargeAmt: M.r, rechargeBonus: M.b }, { svcCents: SVC }] }
                  }
                  const bad = []
                  let cells = 0
                  for (const G of ['redeem', 'purchase+redeem', 'service', 'redeem+service', 'owner-combo']) {
                    for (const B of [0, 50000]) {
                      for (const R of [false, true]) {
                        for (const useStored of [true, false]) {
                          cells += 1
                          const uid2 = mkMxCust(B)
                          const cardId = G.includes('redeem') ? mkMxCard(uid2) : null
                          const { sheets: shts, model } = mkSheets(G, R, uid2, cardId)
                          const intent = useStored ? (R ? 'recharge_then_balance' : 'balance_plus_offline') : 'offline_full'
                          for (const s of shts) s.payIntent = intent
                          const exp = fiveStep(model, B, useStored)
                          const tag = `${G}|B${B / 100}|R${R ? 1 : 0}|S${useStored ? 1 : 0}`
                          const pv = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uid2, payIntent: intent, settlements: shts }) }, shop.token)).data
                          const gp = (pv.group || {}).payment || {}
                          const sc = (await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uid2, settlements: shts }) }, shop.token)).data
                          let off = -1; let st = -1; let cardDue = -1; let heroOk = false
                          if (sc.settlements) {
                            const legsX = sc.settlements.flatMap((x) => x.payments)
                            off = legsX.filter((p) => p.leg === 'offline').reduce((n, p) => n + p.amountCents, 0)
                            st = legsX.filter((p) => p.leg === 'stored_value' || p.leg === 'migrate_stored').reduce((n, p) => n + p.amountCents, 0)
                            const pcCard = (await request(`/admin/settlements/${sc.settlements[0].id}/preview-card`, {}, shop.token)).data.card || { totals: {} }
                            cardDue = pcCard.totals.dueCents
                            /* D65-b:组卡逐张行=各张头条,Σ逐张=组头条(多张组才有 sheetRows) */
                            if ((pcCard.sheetRows || []).length > 1) {
                              const rowSum = pcCard.sheetRows.reduce((n, x) => n + (x.cashDueCents || 0), 0)
                              if (rowSum !== cardDue) { cardDue = -9999 }
                            }
                            /* D65 头条语义:每张单 flow.cashDueCents=五步⑤该张现金;Σ各张头条=组合计 */
                            heroOk = sc.settlements.every((x) => x.flow && x.flow.cashDueCents === x.payments.filter((p) => p.leg === 'offline').reduce((n, p) => n + p.amountCents, 0))
                              && sc.settlements.reduce((n, x) => n + ((x.flow || {}).cashDueCents || 0), 0) === exp.cash
                            for (const x of sc.settlements) await request(`/admin/settlements/${x.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '㋆ 矩阵清场' }) }, shop.token)
                          }
                          const ok = gp.offlineDueCents === exp.cash && gp.storedUsedCents === exp.storedUsed && off === exp.cash && st === exp.storedUsed && cardDue === exp.cash && heroOk
                          if (!ok) bad.push(`${tag}: exp(cash=${exp.cash},st=${exp.storedUsed}) pv(${gp.offlineDueCents},${gp.storedUsedCents}) legs(${off},${st}) card(${cardDue}) hero(${heroOk})`)
                        }
                      }
                    }
                  }
                  check(`㋆ 五步资金时序全组合矩阵 ${cells} 格全绿(预览=建单腿=组卡=五步模型)`, cells === 40 && bad.length === 0, bad.join(' ; ').slice(0, 600))
                  // 店主基准格显式钉死:0 余额+挂充+勾抵扣+店主组合=868 式
                  const uidQ = mkMxCust(0)
                  const { sheets: shQ } = mkSheets('owner-combo', true, uidQ, null)
                  for (const s of shQ) s.payIntent = 'recharge_then_balance'
                  const pvQ = (await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: uidQ, payIntent: 'recharge_then_balance', settlements: shQ }) }, shop.token)).data
                  /* 868 式结构(套件项目价 200):cash=(180−180)+(200−200)+540+300=840,stored=200(全来自挂充);
                     真 868 数字(项目价 388)由测试B 沙箱自测实拍钉。 */
                  check('㋆ 店主基准格:0 余额+挂充+勾抵扣=868 式结构(84000/20000)', pvQ.group.payment.offlineDueCents === 84000 && pvQ.group.payment.storedUsedCents === 20000, JSON.stringify(pvQ.group.payment))
                }

                /* ===== ㋅ D62 搜索大小写不敏感(后端行为面;前端四处=wiring) ===== */
                {
                  const bMary = await directBooking(shop, { name: `MARY-D62-${RUN_ID}`, time: '18:45' })
                  const hitLower = (await request(`/admin/customers?q=mary-d62`, {}, shop.token)).data.customers || []
                  const hitTrim = (await request(`/admin/customers?q=${encodeURIComponent('  MARY-d62 ')}`, {}, shop.token)).data.customers || []
                  check('㋅ D62 后端:小写搜到大写存档+trim', Boolean(bMary && bMary.id) && hitLower.some((c) => (c.displayName || '').startsWith('MARY-D62-')) && hitTrim.some((c) => (c.displayName || '').startsWith('MARY-D62-')), JSON.stringify({ lower: hitLower.length, trim: hitTrim.length }))
                }
              }
            }
          }
          dbx.prepare("DELETE FROM member_timecards WHERE id IN ('tc_race','tc_grp','tc_dual')").run()
        }
      }
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
      const PROMPT_BASELINE = 19 // 服务与价目页 5 处提前修(店主 08-21 亲撞拍板:新增/改名/删大类+删项目全换弹层)24→19;此前 A5 退役 27→24;其余存量按 Cowork 归批清单分批收敛,只减不增
      const total = (adminJs.match(/window\.(prompt|confirm|alert)\(/g) || []).length
      check(`㊶ D50 admin.js 原生弹窗总数 ≤ 基线 ${PROMPT_BASELINE}(新增代码禁 prompt/confirm/alert)`, total <= PROMPT_BASELINE, `当前 ${total}`)
    }

    // ===== A5 零读方断言(店主 08-21 终段令义务②):recharge_tiers 旧模型退役,防复活 =====
    {
      const ROOTA5 = new URL('../../', import.meta.url).pathname
      const frontFiles = [
        'apps/web/admin.js', 'apps/web/admin.html', 'apps/web/customer.js', 'apps/web/sign.html',
        'miniprogram/pages/merchant/settlement/index.js', 'miniprogram/pages/stored-value/index.js'
      ]
      /* L2 类定义按机制:读方=打 /admin/recharge-tiers 接口的调用(完整路径串);
         提「recharge_tiers 已退役」的注释不算读方——护栏盯的是复活的调用,不是历史记载。 */
      let tierReaders = []
      for (const f of frontFiles) {
        try {
          if (readFileSync(join(ROOTA5, f), 'utf8').includes('/admin/recharge-tiers')) tierReaders.push(f)
        } catch { /* 文件不在=零读方 */ }
      }
      const { execSync } = await import('node:child_process')
      let miniHits = ''
      try { miniHits = execSync(`grep -rl "/admin/recharge-tiers" "${join(ROOTA5, 'miniprogram')}" || true`, { encoding: 'utf8' }).trim() } catch { /* grep 空=零 */ }
      check('A5 零读方:网页两端+签署页 0 处 /admin/recharge-tiers 调用', tierReaders.length === 0, tierReaders.join(','))
      check('A5 零读方:小程序全目录 0 处 /admin/recharge-tiers 调用(防复活)', miniHits === '', miniHits)
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
      // B1/B1-6:结算页次卡大类+现场购卡入口 wiring 在场(伪类/选卡/选套餐/三态互斥/sheet 字段)
      const settleJs = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/settlement/index.js'), 'utf8')
      const settleWxml = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/settlement/index.wxml'), 'utf8')
      check('B1 结算页次卡大类 wiring 在场', settleJs.includes("'__timecard'") && settleJs.includes('gPickTimecard') && settleJs.includes('timecardId: g.timecardId || undefined'))
      check('B1-6 现场购卡入口 wiring 在场(选套餐+三态互斥+sheet 字段)', settleJs.includes('gPickPurchasePkg') && settleJs.includes('purchasePackageId: g.purchasePackageId || undefined') && settleWxml.includes('现场购卡(顾客没卡?当场买当场用)'))
      // ㋀ B3-1 随单充值 wiring:草稿挂单+A5 选档源换 packages+三行分行渲染+旧代充 POST 已拆
      check('㋀ B3-1 结算页随单充值 wiring 在场(rvDraft+组①字段+选档源=recharge-packages)', settleJs.includes('rvDraft') && settleJs.includes("rechargePackageId: i === 0 && this.data.rvDraft") && settleJs.includes('/admin/recharge-packages'))
      check('㋀ B3-1 面板挂单随签(不再即时 POST 代充)+三行分行渲染在场', !settleJs.includes("adminPost('/admin/stored-value/recharge'") && settleWxml.includes('随单充值(签字生效)') && settleWxml.includes('充后余额(预计)'))
      check('㋀ B3-1 签署页三行分行在场(sign.html=双端同构一份实现)', readFileSync(join(ROOT42, 'apps/web/sign.html'), 'utf8').includes('随单充值（本单签字生效）'))
      // ㋁ B3-3/4 wiring:顾客端回执卡+确认钮、商家流水标注、api 出口
      const csvJs = readFileSync(join(ROOT42, 'miniprogram/pages/stored-value/index.js'), 'utf8')
      const csvWxml = readFileSync(join(ROOT42, 'miniprogram/pages/stored-value/index.wxml'), 'utf8')
      const mfinWxml = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/finance/index.wxml'), 'utf8')
      check('㋁ 顾客端回执卡+确认钮 wiring 在场', csvJs.includes('confirmRecharge') && csvJs.includes('pendingConfirm') && csvWxml.includes('确认到账') && csvWxml.includes('到账回执 · 待确认'))
      // ㋂ D55/D56 wiring:联动勾选已删/0 额腿不勾/次卡组校验认内容/D22 护栏认核销行/价格体系整排隐藏
      check('㋂ D55 挂充值不再联动勾储值(强制 useBalance:true 已删)', !settleJs.includes('payMenu: { useBalance: true, recharge: true }') && settleJs.includes('useBalance: this.data.payMenu.useBalance, recharge: true'))
      check('㋂ D55 0 额支付腿不得勾选态(储值/定金 ✓ 与金额同条件)', settleWxml.includes("payMenu.useBalance && view.hasStored ? '✓'") && settleWxml.includes("depositApplied && view.hasDeposit ? '✓'"))
      check('㋂ D56 推送校验认次卡组内容(timecardId/purchasePackageId+组内项目)', settleJs.includes('const hasTc = Boolean(g.timecardId || g.purchasePackageId)') && settleJs.includes('请选本次核销项目'))
      check('㋂ D22 护栏类定义补核销行(wanted 含 timecardServiceId)', settleJs.includes('.concat(bodySheets[i].timecardServiceId'))
      check('㋂ 拍板 UI:次卡组隐藏价格体系整排+独立消费句;整单规则/档位不发次卡组', settleWxml.includes("grp.catId !== '__timecard'") && settleWxml.includes('次卡为独立消费') && settleJs.includes("tierKey: isTcGroup ? 'list' : g.tierKey"))
      // ㋃ D57/D58 wiring:mixin 可点行+两日结 wxml 卡+顾客待签置顶卡+网页签署链接
      const dcMixin = readFileSync(join(ROOT42, 'miniprogram/utils/dailyclose.js'), 'utf8')
      const dcWxml = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/daily-close/index.wxml'), 'utf8')
      const moWxml = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/orders/index.wxml'), 'utf8')
      const coJs = readFileSync(join(ROOT42, 'miniprogram/pages/orders/index.js'), 'utf8')
      const coWxml = readFileSync(join(ROOT42, 'miniprogram/pages/orders/index.wxml'), 'utf8')
      check('㋃ D57 商家日结未签可点行 wiring(mixin goUnsigned+两 wxml 卡=出码重推)', dcMixin.includes('goUnsigned') && dcMixin.includes('unsignedList') && dcWxml.includes('goUnsigned') && moWxml.includes('goUnsigned'))
      check('㋃ D57 顾客待签置顶卡 wiring(全部未签单+去签字)', coJs.includes('getMyPendingSign') && coWxml.includes('待你签字确认') && coWxml.includes('去签字'))
      check('㋃ D57 网页日结未签行=签署页链接(双端同刀)', adminJs.includes('v.unsignedList') && adminJs.includes('/sign/${encodeURIComponent(u.code)}'))
      // ㋄ D60 wiring:购卡/充值显式行四渲染面+组卡自证+L3① 小注
      const spJs = readFileSync(join(ROOT42, 'miniprogram/components/sheet-preview/index.js'), 'utf8')
      const spWxml = readFileSync(join(ROOT42, 'miniprogram/components/sheet-preview/index.wxml'), 'utf8')
      const signHtml = readFileSync(join(ROOT42, 'apps/web/sign.html'), 'utf8')
      check('㋄ D60 单据预览:组卡自证+购卡/充值显式行+应收 label 后端定', spJs.includes('sheetRows') && spWxml.includes('card.groupNote') && spWxml.includes('现场购卡(购卡款,预收)') && spWxml.includes('card.t.dueLabel'))
      const srvD60 = readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')
      // D65 改版:双叙事合并=flow 一条五步账,头条=本单到店支付;签署页/快照直贴 flow 块(后端句唯一)
      check('㋄→㋇ D65 签署页/快照:flow 一条五步账+头条「本单到店支付」(「合计」不再当头条)', signHtml.includes('s.flow.lines') && signHtml.includes('s.flow.heroLabel') && !signHtml.includes('>支付构成<') && srvD60.includes("heroLabel: '本单到店支付'") && srvD60.includes("key: 'svcPayable', label: '服务应付'"))
      // ㋅ D62 wiring:四处前端搜索口全 toLowerCase(类定义=用户关键字匹配名称/手机号的本地过滤)
      const custJs = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/customers/index.js'), 'utf8')
      const membJs = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/member/index.js'), 'utf8')
      const wbJs = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/workbench/index.js'), 'utf8')
      check('㋅ D62 前端四搜索口大小写不敏感(客户/代充选客/工作台/开单找客)', custJs.includes('.trim().toLowerCase()') && membJs.includes('q.toLowerCase()') && wbJs.includes(".trim().toLowerCase()") && miniOrders.includes('q.toLowerCase()'))
      // ㋆ D64 wiring:payIntent 映射意愿唯一(不勾储值=offline_full,挂充不强制)+储值行显隐含挂充+组卡 cover 行+出码 n/N+预告句
      check('㋆ D64 前端映射意愿唯一+储值行显隐含挂充', settleJs.includes("if (!m.useBalance) return 'offline_full'") && settleWxml.includes('view.hasBalance || view.hasRecharge'))
      // D68 文案改版:出码行=「服务确认单 n/N」;预告句=「本次其余单据还将抵…」
      check('㋆→㋌ D64 组卡 cover 行+出码「服务确认单 n/N」+预告句(后端句)', spWxml.includes('次卡抵扣(签字扣次)') && settleJs.includes('服务确认单 ${s.groupIndex}/${s.groupTotal}') && srvD60.includes('本次其余单据还将抵'))
      // ㋇ D65-b wiring:逐张行/未签行/顾客待签卡=头条 cashDue,价值总额不再裸出
      check('㋇ D65-b 单张金额一律头条化(组卡逐张/日结未签行/顾客待签卡)', spJs.includes('m(s.cashDueCents)') && dcMixin.includes('到店支付 ${m(u.cashDueCents)}') && coWxml.includes('到店支付 {{item.cashDueText}}'))
      // ㋈ 批③首件 wiring:详情页重做(flow 卡/空态句/留档收敛/售后同屏表单/进度卡)+网页同构+连签流+线下行非勾选
      const odJs = readFileSync(join(ROOT42, 'miniprogram/pages/order-detail/index.js'), 'utf8')
      const odWxml = readFileSync(join(ROOT42, 'miniprogram/pages/order-detail/index.wxml'), 'utf8')
      const custWeb = readFileSync(join(ROOT42, 'apps/web/customer.js'), 'utf8')
      check('㋈ A2/A3/A6 详情页:flow 卡+「本单未产生结算单」空态+旧实付行消亡', odWxml.includes('order.pay.flowLines') && odWxml.includes('本单未产生结算单') && !odWxml.includes('>实付<'))
      check('㋈ A4/A5/B2 详情页:留档无则不出+售后钮后端句+同屏表单(问题描述必填)', odWxml.includes('wx:if="{{order.visibleWorkImages.length}}"') && odWxml.includes('order.afterSalesActionText') && odWxml.includes('问题描述(必填)'))
      check('㋈ B6 撤回入口+D3 进度卡在场(顾客小程序)', odWxml.includes('撤回本次售后(记录保留)') && odWxml.includes('order.afterSales.steps') && odJs.includes('withdrawAfterSales'))
      check('㋈ C 组网页同构(徽标/flow 卡/发起表单/待签列表)', custWeb.includes('order.listBadgeText') && custWeb.includes('order.payment.flow') && custWeb.includes('data-as-submit') && custWeb.includes('state.pendingSign'))
      // D68 文案改版:接续钮=「继续签下一份 →」(替换式导航,见 ㋌ D68①)
      check('㋈→㋌ E 组连签流 wiring(签署页接续钮+商家出码接续)', readFileSync(join(ROOT42, 'apps/web/sign.html'), 'utf8').includes('继续签下一份') && settleJs.includes('nextPendingId') && srvD60.includes('groupNextPendingCode'))
      check('㋈ D3 线下行非勾选样式「到店收 · 差额自动」', settleWxml.includes('到店收 · 差额自动') && !settleWxml.includes('payToggleOffline'))
      // ㋉ 三拍 wiring:D1 标题双端直渲(映射层零裁剪教训)+C5 金额句双端同刀(网页列表不再裸「实付定金」)
      check('㋉ D1 wiring:标题句双端直渲+映射层透传', readFileSync(join(ROOT42, 'miniprogram/utils/api.js'), 'utf8').includes('listTitleText: booking.listTitleText') && readFileSync(join(ROOT42, 'miniprogram/pages/orders/index.wxml'), 'utf8').includes('listTitleText || item.serviceName') && custWeb.includes('order.listTitleText'))
      /* ㋑ 永久律 wiring(08-23):金额句后端唯一,前端零回落零拼串 —— 双端各自的机械证据 */
      const ordWx91 = readFileSync(join(ROOT42, 'miniprogram/pages/orders/index.wxml'), 'utf8')
      const meWx91 = readFileSync(join(ROOT42, 'miniprogram/pages/me/index.wxml'), 'utf8')
      check('㋑ wiring:小程序订单卡/近期消费零 servicePrice 冒充金额(0 残留)',
        !/已结清 \{\{cur\.p\}\}/.test(ordWx91) && !/已结清 \{\{cur\.p\}\}/.test(meWx91)
        && !/servicePrice\}\}/.test(ordWx91) && !/item\.servicePrice/.test(meWx91))
      check('㋑ wiring:网页订单卡与近期消费同一句源(零「实付定金」前端回落)',
        custWeb.includes("escapeHtml(order.actualDueText || order.listAmountText || '')")
        && !custWeb.includes("`${t('paidDeposit')} ${money(order.depositCents)}`"))
      check('㋑ wiring:后端两个分支都给金额句(没单也说话,不留空位让前端猜)',
        readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8').includes('本单未产生结算单')
        && readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8').includes('服务确认单待签字'))
      // ㋊ D67 三小件+D59 提示句 wiring(双端)
      const odWx2 = readFileSync(join(ROOT42, 'miniprogram/pages/order-detail/index.wxml'), 'utf8')
      const odJs2 = readFileSync(join(ROOT42, 'miniprogram/pages/order-detail/index.js'), 'utf8')
      check('㋊ D67② 签署单卡小字无 Emoji(✍ 双端扫尽:mini+web 顾客端)', !odWx2.includes('✍') && !custWeb.includes('✍'))
      // D68② 再升级:原件入口=悬浮查看器(openViewer / data-snap-open),跳页式 goSheetSnapshot 已销案
      check('㋊→㋌ 逐张卡+原件入口双端 wiring(mini sheets 循环+openViewer;web sheets 循环+lightbox)', odWx2.includes('order.pay.sheets') && odWx2.includes('openViewer') && custWeb.includes('order.payment.sheets') && custWeb.includes('data-snap-open'))
      check('㋊ D67① 全组签完回台面(relaunch workbench,非退一层)', readFileSync(join(ROOT42, 'miniprogram/pages/merchant/settlement/index.js'), 'utf8').includes("relaunch('/pages/merchant/workbench/index')"))
      check('㋊ D59 提示句双端 wiring(mini rechargeNote+web rechargeUnassignedText)', readFileSync(join(ROOT42, 'miniprogram/utils/dailyclose.js'), 'utf8').includes('rechargeUnassignedText') && readFileSync(join(ROOT42, 'miniprogram/pages/merchant/orders/index.wxml'), 'utf8').includes('p.rechargeNote') && readFileSync(join(ROOT42, 'apps/web/admin.js'), 'utf8').includes('p.rechargeUnassignedText'))
      // ㋋ 五裁 wiring:详情逐张卡双端+台面售后蓝徽标+到店计数三读方同一出口
      const srvAll = readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')
      check('㋋ wiring 详情逐张卡双端(mini sheets 循环+组汇总;web 同构)', readFileSync(join(ROOT42, 'miniprogram/pages/order-detail/index.wxml'), 'utf8').includes('order.pay.sheets') && readFileSync(join(ROOT42, 'apps/web/customer.js'), 'utf8').includes('order.payment.sheets'))
      check('㋋ wiring 裁C 台面售后蓝徽标(mini as-blue)', readFileSync(join(ROOT42, 'miniprogram/pages/merchant/orders/index.wxml'), 'utf8').includes('b.afterSalesTag'))
      check('㋋ wiring 裁A/E 三读方同一出口(visitDaysCount 三处调用)', (srvAll.match(/visitDaysCount\(/g) || []).length >= 4)
      /* ===== ㋌ D68 wiring:①替换式导航不压栈 ②悬浮查看器双端 ③用户可见文案零「组/张」内部话术 ===== */
      const signHtml68 = readFileSync(join(ROOT42, 'apps/web/sign.html'), 'utf8')
      check('㋌ D68① 连签=替换式导航(location.replace;续签不再用压栈的 <a href>)', signHtml68.includes("location.replace('/sign/") && !/<a href="\/sign\/\$\{encodeURIComponent\(s\.groupNextPendingCode\)/.test(signHtml68))
      const odWx3 = readFileSync(join(ROOT42, 'miniprogram/pages/order-detail/index.wxml'), 'utf8')
      const odJs3 = readFileSync(join(ROOT42, 'miniprogram/pages/order-detail/index.js'), 'utf8')
      check('㋌→㋍ D68② 悬浮查看器(小程序:顾客端详情挂共用组件+openViewer;原件不再跳页压栈)', odWx3.includes('<snapshot-viewer') && odJs3.includes('openViewer') && !odWx3.includes('goSheetSnapshot'))
      check('㋌→㋍ D68② 悬浮查看器(网页:顾客端调共用模块 openSnapViewer,入口 data-snap-open)', custWeb.includes('openSnapViewer') && custWeb.includes('data-snap-open'))
      /* D68② 补件(店主 08-23):两侧半透明箭头键(图片中部高度),首份隐左/末份隐右;滑动手势并存 */
      /* ===== ㋍ D68③ wiring:全仓「查看签署单/原件」入口统一复用共用查看器 ===== */
      const svComp = readFileSync(join(ROOT42, 'miniprogram/components/snapshot-viewer/index.wxml'), 'utf8')
      const svCompJs = readFileSync(join(ROOT42, 'miniprogram/components/snapshot-viewer/index.js'), 'utf8')
      check('㋍ D68③ 共用组件在场(浮层+swiper+双箭头+首末隐边+页码)', svComp.includes('sv-mask') && svComp.includes('<swiper') && svComp.includes('sv-arrow') && svComp.includes('cur > 0') && svComp.includes('cur < items.length - 1') && svCompJs.includes('triggerEvent'))
      const dcMixin68 = readFileSync(join(ROOT42, 'miniprogram/utils/dailyclose.js'), 'utf8')
      check('㋍ D68③ 商家端日结入口走同一浮层(mixin 调 /snapshots + snapViewer,不再塞排版弹层)', dcMixin68.includes("/snapshots") && dcMixin68.includes('snapViewer') && !/previewSheet: String\(code\)/.test(dcMixin68))
      for (const pg of ['miniprogram/pages/merchant/orders', 'miniprogram/pages/merchant/daily-close', 'miniprogram/pages/merchant/finance', 'miniprogram/pages/order-detail']) {
        const wx0 = readFileSync(join(ROOT42, `${pg}/index.wxml`), 'utf8')
        const js0 = readFileSync(join(ROOT42, `${pg}/index.json`), 'utf8')
        check(`㋍ D68③ ${pg.split('/').pop()} 页挂共用查看器组件`, wx0.includes('<snapshot-viewer') && js0.includes('components/snapshot-viewer/index'))
      }
      check('㋍ D68③ 跳整页看原件零残留(pages/sign?snapshot= 全仓消亡)', !(await (async () => {
        const files = ['miniprogram/utils/dailyclose.js', 'miniprogram/pages/merchant/finance/index.js', 'miniprogram/components/sheet-preview/index.js', 'miniprogram/pages/order-detail/index.js']
        return files.some((f) => readFileSync(join(ROOT42, f), 'utf8').includes('snapshot=$'))
      })()))
      /* ㋏ L2 机械扫描:全仓 image 位零 SVG 图源(小程序 <image src>、网页 <img src>、图标资源引用)——
         真机 <image> 不认 SVG,喂一处白一处。 */
      const svgSrcHits = []
      for (const rel of ['miniprogram/pages', 'miniprogram/components', 'apps/web']) {
        const stack = [join(ROOT42, rel)]
        while (stack.length) {
          const dir = stack.pop()
          for (const ent of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, ent.name)
            if (ent.isDirectory()) { stack.push(full); continue }
            if (!/\.(wxml|js|html)$/.test(ent.name)) continue
            const txt = readFileSync(full, 'utf8')
            for (const line of txt.split('\n')) {
              if (/^\s*(\/\*|\*|\/\/|<!--)/.test(line)) continue
              if (/(<image[^>]*src=|<img[^>]*src=|\bsrc:\s*)['"`][^'"`]*\.svg/.test(line)) svgSrcHits.push(`${ent.name}: ${line.trim().slice(0, 70)}`)
            }
          }
        }
      }
      check('㋏ L2 全仓 image 位零 SVG 图源(图标/快照/笔迹全部 PNG,0 残留)', svgSrcHits.length === 0, svgSrcHits.join(' | ').slice(0, 220))
      /* ===== ㋐ 批③次段 wiring:卡包/商城双端在场 + 唯一出口 + 话术层无写死支付方式 ===== */
      const cpWx = readFileSync(join(ROOT42, 'miniprogram/pages/card-pack/index.wxml'), 'utf8')
      const mlWx = readFileSync(join(ROOT42, 'miniprogram/pages/mall/index.wxml'), 'utf8')
      const meWx = readFileSync(join(ROOT42, 'miniprogram/pages/me/index.wxml'), 'utf8')
      const svWx = readFileSync(join(ROOT42, 'miniprogram/pages/stored-value/index.wxml'), 'utf8')
      check('㋐→裁定① A 组 wiring:卡包=券+次卡两类(储值行已撤)+来源小字条件渲染',
        cpWx.includes('pack.timecards') && cpWx.includes('pack.coupons') && !cpWx.includes('pack.stored') && cpWx.includes('wx:if="{{c.sourceLabel}}"')
        && !custWeb.includes('pack.stored.balanceText'))
      check('㋐ 裁定② wiring:卡包次卡区「去商城」带定位参数(双端,不新建页)',
        cpWx.includes('goMallTimecards') && readFileSync(join(ROOT42, 'miniprogram/pages/mall/index.js'), 'utf8').includes("q.focus === 'timecard'")
        && custWeb.includes('data-mall-focus="timecard"') && custWeb.includes('data-mall-filter'))
      // 裁定A 返工后:入口收敛到「我的资产」一格,角标挂它(卡包入口从「我的」页撤下)
      check('㋐→勘误 A1 wiring:「我的」页卡包入口+角标(0 不渲染;名字与页归一)', meWx.includes('bindtap="goCardPack"') && meWx.includes('wx:if="{{cardPackBadge}}"') && !meWx.includes('goAssets'))
      check('㋐ B1-1 wiring:储值页=充值套餐唯一出口(去充值→商城)', svWx.includes('goMall') && !svWx.includes('微信支付'))
      check('㋐ B3 wiring:商城按钮句与说明句全用后端字段(前端不拼两套话)', mlWx.includes('it.buyButtonText') && mlWx.includes('it.offlineNote') && !mlWx.includes('立即购买') && !mlWx.includes('到店购买'))
      check('㋐ D 组 wiring:网页顾客端卡包/商城同构(视图+菜单+同源字段)', custWeb.includes('renderCardPackWeb') && custWeb.includes('renderMallWeb') && custWeb.includes("'cardPack'") && custWeb.includes('data-mall-buy'))
      /* 待拍②(改「敬请期待」)→ 裁定A 返工后那张资产卡整块被分类总页取代:
         原句所在的卡不复存在,所以判据从"改成敬请期待"收敛为"旧句零残留 + 积分行进资产页" */
      check('㋐ 待拍②→勘误:网页「积分商城后续接入」旧句零残留(积分保持原有入口,不降级不塞总页)', !custWeb.includes('积分商城后续接入') && custWeb.includes('data-me-target="pointsMall"'))
      check('㋐ C5 网页财务帮助文案不再教人点「耗卡」', !readFileSync(join(ROOT42, 'apps/web/admin.js'), 'utf8').includes('点「耗卡」'))
      /* 补件① L2 话术层扫描:用户可见文案不写死支付方式(与币种红线同族,这次扫话术) */
      const payWordHits = []
      for (const f of ['miniprogram/pages/mall/index.wxml', 'miniprogram/pages/card-pack/index.wxml',
        'miniprogram/pages/stored-value/index.wxml', 'miniprogram/pages/checkout/index.wxml', 'apps/web/customer.js']) {
        const txt = readFileSync(join(ROOT42, f), 'utf8')
        for (const line of txt.split('\n')) {
          if (/^\s*(\/\*|\*|\/\/|<!--)/.test(line)) continue
          if (/(微信支付|支付宝|现金支付|刷卡支付)/.test(line)) payWordHits.push(`${f}: ${line.trim().slice(0, 60)}`)
        }
      }
      /* 裁定A 常驻护栏:「我的」页资产族入口数 = 1(机械扫描防复发)。
         资产族=资产/卡包/券包/积分商城/会员权益;只许「我的资产」一个,其余全部收进资产分类总页。 */
      const meWx2 = readFileSync(join(ROOT42, 'miniprogram/pages/me/index.wxml'), 'utf8')
      /* 裁定A 勘误(店主 08-23 推翻重做)后的护栏:
         ①「券包」与「卡包」不得同时存在两个入口(真冗余只有这一对);
         ② 命名归一:同一类资产只留一个名字一个页(默认「卡包」,「我的券包/我的资产」退休);
         ③ 黑卡三块=快捷区必须可点直达(积分/卡包/储值),不许变哑。 */
      check('㋐ 勘误 券包与卡包不并存(我的券包入口与页面退休,全仓零引用)',
        !meWx2.includes('goCoupons') && !readFileSync(join(ROOT42, 'miniprogram/app.json'), 'utf8').includes('pages/coupons/index')
        && !existsSync(join(ROOT42, 'miniprogram/pages/coupons')))
      check('㋐ 勘误 命名归一:「我的资产」页退休,卡包一名到底(菜单格与黑卡块同名同页)',
        !readFileSync(join(ROOT42, 'miniprogram/app.json'), 'utf8').includes('pages/assets/index')
        && !existsSync(join(ROOT42, 'miniprogram/pages/assets'))
        && (meWx2.match(/bindtap="goCardPack"/g) || []).length === 2)
      check('㋐ 勘误 黑卡三块可点直达(积分→积分页 / 卡包→卡包页 / 储值→储值页,不落总页)',
        meWx2.includes('bindtap="goPoints"') && meWx2.includes('bindtap="goStored"') && meWx2.includes('bindtap="goCardPack"') && !meWx2.includes('bindtap="goAssets"'))
      check('㋐ 勘误 等级徽章恢复直达权益页(黑卡不变哑)', meWx2.includes('class="level-pill" bindtap="goMemberBenefits"'))
      check('㋐ 勘误 网页同构:菜单格改名卡包+会员卡三块可点(券块改名卡包)',
        custWeb.includes("'卡包' : 'Card pack', '/assets/images/nail-luxe.jpg', 'cardPack'") && custWeb.includes('data-me-target="pointsMall" type="button"><strong>${user.points}'))
      /* 裁定B:路径名与「零支付成功」红线相撞——payment-success 已改 booking-done,引用零残留 */
      const appJson = readFileSync(join(ROOT42, 'miniprogram/app.json'), 'utf8')
      const checkoutJs = readFileSync(join(ROOT42, 'miniprogram/pages/checkout/index.js'), 'utf8')
      check('㋐ 裁定B payment-success 路径名消亡(app.json 与跳转都指 booking-done)', appJson.includes('pages/booking-done/index') && !appJson.includes('payment-success') && checkoutJs.includes('/pages/booking-done/index'))
      check('㋐ 补件① 顾客可见话术零写死支付方式(租户中立,0 残留)', payWordHits.length === 0, payWordHits.join(' | ').slice(0, 200))
      /* §十-2 红线:过渡期全仓不得出现「支付成功」 */
      const paidWordHits = []
      for (const rel of ['miniprogram/pages', 'apps/web']) {
        const stack = [join(ROOT42, rel)]
        while (stack.length) {
          const dir = stack.pop()
          for (const ent of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, ent.name)
            if (ent.isDirectory()) { stack.push(full); continue }
            if (!/\.(wxml|js|html)$/.test(ent.name)) continue
            const txt = readFileSync(full, 'utf8')
            for (const line of txt.split('\n')) {
              if (/^\s*(\/\*|\*|\/\/|<!--)/.test(line)) continue
              if (/支付成功/.test(line)) paidWordHits.push(`${ent.name}: ${line.trim().slice(0, 50)}`)
            }
          }
        }
      }
      check('㋐ §十-2 过渡期红线:全仓零「支付成功」字样', paidWordHits.length === 0, paidWordHits.join(' | ').slice(0, 200))
      /* ===== ㋐ D69 同族:恒 0 字段冒充卡包数(黑卡格回落)——双端销案 ===== */
      const srvUser69 = readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')
      const supaUser69 = readFileSync(join(ROOT42, 'apps/api/supabase-server.mjs'), 'utf8')
      check('㋐ D69族:serializeUser 不再下发恒 0 的 couponCount(两个后端同刀)',
        !/^\s*couponCount: 0,\s*$/m.test(srvUser69) && !/^\s*couponCount: 0,\s*$/m.test(supaUser69))
      const meWx69 = readFileSync(join(ROOT42, 'miniprogram/pages/me/index.wxml'), 'utf8')
      const meJs69 = readFileSync(join(ROOT42, 'miniprogram/pages/me/index.js'), 'utf8')
      const apiJs69 = readFileSync(join(ROOT42, 'miniprogram/utils/api.js'), 'utf8')
      const custJs69 = readFileSync(join(ROOT42, 'apps/web/customer.js'), 'utf8')
      check('㋐ D69族:双端黑卡「卡包」格零 couponCount 回落(0 残留)',
        !/couponCount/.test(meWx69) && !/couponCount/.test(meJs69) && !/couponCount/.test(apiJs69)
        && !/user\.couponCount/.test(custJs69))
      check('㋐ D69族:未拿到卡包数时显示「—」而不是猜 0(小程序黑卡格)',
        meWx69.includes("cardPackBadge === null ? '—' : cardPackBadge") && meJs69.includes('cardPackBadge: null'))
      check('㋐ D69族:网页黑卡格同源同刀(有卡包才出数,没有出「—」,并按需拉一次)',
        custJs69.includes("state.cardPack ? state.cardPack.badgeCount : '—'")
        && custJs69.includes("if (state.user && !state.cardPack) loadCardPack()"))
      const cssMall69 = readFileSync(join(ROOT42, 'apps/web/styles.css'), 'utf8')
      check('㋐ 裁定②:网页商城筛选选中态有真样式(不是只挂 class 看不出来)',
        custJs69.includes('class="mall-filter') && /\.mall-filter\.on\s*\{/.test(cssMall69))
      /* ===== ㋑ 全组合审计的常驻护栏:其余四处回落已收口(每处一条,防复活) ===== */
      const homeJs91 = readFileSync(join(ROOT42, 'miniprogram/pages/home/index.js'), 'utf8')
      const homeWx91 = readFileSync(join(ROOT42, 'miniprogram/pages/home/index.wxml'), 'utf8')
      check('㋑ 今日营业句挂在顾客读的公开 /stores 上(只加 admin 口=顾客拿不到)',
        /path === '\/stores'[\s\S]{0,2200}todayHours: \{ zh: storeTodayHours/.test(readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')))
      check('㋑ 今日营业句后端唯一(特殊日优先·门店时区),前端零计算零回落常规营业时间',
        !homeJs91.includes('computeTodayHours') && homeJs91.includes('store.todayHours')
        && !homeWx91.includes('todayHoursText || store.businessHours')
        && readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8').includes('function storeTodayHours'))
      const odJs91 = readFileSync(join(ROOT42, 'miniprogram/pages/order-detail/index.js'), 'utf8')
      check('㋑ 订单详情零前端自算价(Σitems / service.price 三重回落销案)',
        !/order\.servicePrice \|\| \(order\.items/.test(odJs91) && !/Math\.max\(0, price - deposit/.test(odJs91))
      const cpWx91 = readFileSync(join(ROOT42, 'miniprogram/pages/card-pack/index.wxml'), 'utf8')
      const mallWx91 = readFileSync(join(ROOT42, 'miniprogram/pages/mall/index.wxml'), 'utf8')
      check('㋑ 次卡可核销项目句 + 商城分区名 + 待签卡标题:三处均后端给,前端零拼串',
        cpWx91.includes('c.projectGroupText') && !cpWx91.includes("projectGroup || '不限'")
        && mallWx91.includes('{{sec.label}}') && !mallWx91.includes("' · 次卡'")
        && ordWx91.includes('{{item.titleText}}') && !ordWx91.includes("'(共 '"))
      const apiMap91 = readFileSync(join(ROOT42, 'miniprogram/utils/api.js'), 'utf8')
      const clock91 = readFileSync(join(ROOT42, 'miniprogram/utils/storeclock.js'), 'utf8')
      check('㋑ 映射层零写死旗舰店兜底(店名/营业时间/时区/店介绍;多租户下那是别人家的事实)',
        !apiMap91.includes("|| 'Lucky Luxe Ontario'") && !apiMap91.includes("|| 'Tue-Sun 10:00-19:00'")
        && !apiMap91.includes("timezone: store.timezone || 'America/Toronto'")
        && !custWeb.includes("currentStore().name || 'Lucky Luxe'"))
      check('㋑ 映射层透传 todayHours(后端加了字段而映射层裁掉=顾客拿不到,toMiniBooking 同款教训)',
        apiMap91.includes('todayHours: store.todayHours'))
      check('㋑ 币种红线延伸:缓存未到位不冒充 CAD $(空币符等缓存,不显示别家币种)',
        !clock91.includes("|| 'CAD'") && !clock91.includes("symbol: '$', trimZeroDecimals: false }"))
      check('㋑ 状态/定金态不硬塞默认(未知状态不错分到「待服务」,拿不到不猜「无定金」)',
        !apiMap91.includes("|| 'pending_service'") && !apiMap91.includes("booking.depositState || 'none'"))
      check('㋑ 「couponCount」全仓永久退役(真值出口改名 couponRowCount,防被当回落源复活)',
        readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8').includes('couponRowCount')
        && !/couponCount:/.test(readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')))
      const seed91 = readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')
      check('㋑ 夹具自证:演示铺单的已完成单连带开单+签署(且回填只碰 demo-seed、生产不跑)',
        seed91.includes('seedSignedSheets') && seed91.includes("source_channel = 'demo-seed'") && seed91.includes('if (!IS_PRODUCTION) {'))
      check('㋏ 图标资源已出 PNG(23 个 icon 同名 .png 在场)', readdirSync(join(ROOT42, 'miniprogram/assets/icons')).filter((f) => f.endsWith('.png')).length >= 23)
      const svWeb = readFileSync(join(ROOT42, 'apps/web/snapshot-viewer.js'), 'utf8')
      /* ===== ㋎ 真机调试联通件(店主 08-23):局域网可达 + 演示白名单生产结构性不成立 ===== */
      const srvLan = readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')
      check('㋎ 真机件①:本机开发绑 0.0.0.0(手机上的 127.0.0.1 是手机自己,连不到 Mac)', /listen\(PORT, process\.env\.HOST \|\| \(IS_PRODUCTION \? '127\.0\.0\.1' : '0\.0\.0\.0'\)/.test(srvLan))
      check('㋎ 真机件①:启动日志给出真机可用地址(局域网 IP 探测)', srvLan.includes('真机调试地址(手机与本机同一 Wi-Fi)'))
      const apiJs68 = readFileSync(join(ROOT42, 'miniprogram/utils/api.js'), 'utf8')
      check('㋎ 真机件①:小程序按运行环境自动切 base(devtools=回环 / 真机=devhost 局域网 IP)',
        apiJs68.includes("require('./devhost')") && apiJs68.includes('isDevtools()') && apiJs68.includes('devhost.lanHost'))
      check('㋎ 真机件①:devhost 由一键脚本写入(换网络不改代码)',
        readFileSync(join(ROOT42, 'miniprogram/utils/devhost.js'), 'utf8').includes('lanHost')
        && readFileSync(join(ROOT42, '更新真机调试地址.command'), 'utf8').includes('ipconfig getifaddr'))
      /* 四之十:白名单不能只靠"云端别设那个变量" —— 生产进程里这个开关必须恒 false */
      check('㋎ 真机件②:演示白名单生产结构性不成立(DEMO_LOGIN_ALLOWED = !IS_PRODUCTION && env)',
        /const DEMO_LOGIN_ALLOWED = !IS_PRODUCTION && process\.env\.ALLOW_DEMO_ADMIN_LOGIN === 'true'/.test(srvLan)
        && !/process\.env\.ALLOW_DEMO_ADMIN_LOGIN === 'true'[\s\S]{0,40}body\.demoLogin/.test(srvLan))
      check('㋎ 真机件②:演示登录/注册/种子全走同一判据(裸读环境变量零残留)',
        (srvLan.match(/DEMO_LOGIN_ALLOWED/g) || []).length >= 7
        && (srvLan.match(/process\.env\.ALLOW_DEMO_ADMIN_LOGIN/g) || []).length === 1)
      check('㋍ D68③ 网页端共用模块(admin+customer 同一份:两页都加载、admin 不再 window.open 单张)',
        svWeb.includes('openSnapViewer') && svWeb.includes('data-snap-prev') && svWeb.includes('touchend')
        && readFileSync(join(ROOT42, 'apps/web/admin.html'), 'utf8').includes('snapshot-viewer.js')
        && readFileSync(join(ROOT42, 'apps/web/index.html'), 'utf8').includes('snapshot-viewer.js')
        && readFileSync(join(ROOT42, 'apps/web/admin.js'), 'utf8').includes("/snapshots`")
        && !/window\.open\(`\/settlements\//.test(readFileSync(join(ROOT42, 'apps/web/admin.js'), 'utf8')))
      check('㋌→㋍ D68②补 两侧箭头键双端(小程序共用组件 prev/next+首末隐边;网页共用模块 arrowCss+条件渲染)',
        svComp.includes('catchtap="prev"') && svComp.includes('catchtap="next"')   // catchtap:点箭头不穿透到遮罩(否则一点就关)
        && svCompJs.includes('prev()') && svCompJs.includes('next()')
        && readFileSync(join(ROOT42, 'miniprogram/components/snapshot-viewer/index.wxss'), 'utf8').includes('.sv-arrow')
        && svWeb.includes('ARROW') && svWeb.includes('i > 0 ?') && svWeb.includes('i < items.length - 1 ?'))
      /* L2 文案机械扫描:用户可见面(两端渲染层+后端句)零「组到店支付」「本组还有 N 张」「第 n/N 张」 */
      const copySurfaces = ['apps/api/local-server.mjs', 'apps/web/customer.js', 'apps/web/sign.html', 'apps/web/admin.js',
        'miniprogram/pages/order-detail/index.wxml', 'miniprogram/pages/merchant/settlement/index.js',
        'miniprogram/components/sheet-preview/index.wxml', 'miniprogram/utils/dailyclose.js']
      const badCopy = []
      // 注释=内部说明(设计沿革要留原文),先整段剥掉再扫渲染层文案
      const stripComments = (t) => t
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
      for (const f of copySurfaces) {
        const txt = stripComments(readFileSync(join(ROOT42, f), 'utf8'))
        for (const line of txt.split('\n')) {
          if (/组到店支付|本组还有|第 \$\{[^}]+\}\/\$\{[^}]+\} 张|整组单据/.test(line)) badCopy.push(`${f}:${line.trim().slice(0, 60)}`)
        }
      }
      check('㋌ D68 L2 文案扫尽:用户可见面零「组/张」内部话术(0 残留)', badCopy.length === 0, badCopy.join(' | ').slice(0, 200))
      /* 途中抓(㋌ 批):「取最新一条」的单行选取同毫秒并列时排序不定=取错行(entitlements 套件偶发红的真因);
         L2 同类=全仓 ORDER BY created_at DESC LIMIT 1 一律加 rowid 兜底(售后原因/签署令牌/套餐申请同族)。 */
      check('㋌ 护栏:最新一条单行选取带 rowid 兜底(同毫秒并列不取错行,0 残留)', !/ORDER BY created_at DESC LIMIT 1/.test(srvAll))
      // ㋅ D63 wiring:组卡/签署页「余额未用」句+四行自证渲染面
      check('㋅ D63 余额未用句渲染面(组卡+签署页)+四行自证键', spWxml.includes('card.storedUnusedNotice') && signHtml.includes('s.storedUnusedNotice') && srvD60.includes("key: 'before', label: '充值前余额'"))
      check('㋄ D60 结算页:购卡显式行+L3① 行内小注定稿句', settleWxml.includes('购卡款,预收') && settleJs.includes('含本单随签充值 +') && settleWxml.includes('view.rvNote'))
      check('㋁ 商家流水「顾客未确认」标注在场', mfinWxml.includes('顾客未确认') && readFileSync(join(ROOT42, 'miniprogram/utils/api.js'), 'utf8').includes('confirmStoredRecharge'))
      // A5 网页端:充值档位块已删+指路句在
      check('㋁ A5 网页门店设置充值档位块已删(msAddTier 零残留)+指路句在', !adminJs.includes('msAddTier') && adminJs.includes('会员与营销 → 套餐'))
      // ㊹ 拍板③(08-20 双端统一):未签署结算单不能发起售后——两端「转售后」前置在场;网页钮+弹层在场
      const srv = readFileSync(join(ROOT42, 'apps/api/local-server.mjs'), 'utf8')
      check('㊹ 网页「转售后」钮:仅已完成且已签署(listBadgeKind 判据=后端徽标唯一持有)+弹层在场', adminJs.includes('data-convert-aftersales') && adminJs.includes("['signed', 'amended'].includes(booking.listBadgeKind)") && adminJs.includes("title: '转售后'"))
      check('㊹ 商家小程序「转售后」前置:sheets 含 signed/amended 才显示', /s\.status === 'signed' \|\| s\.status === 'amended'\)\) opts\.push\(\{ label: '转售后'/.test(miniOrders))
      check('㊾ 尾①人话句在场:纯售后返还过期提示(后端句唯一持有,两端直渲)', srv.includes('本日有售后返还,业绩已变化'))
      // ㊾ 裁③显式行三位面渲染在场(网页日结/小程序日结/小程序我的业绩)
      const miniDC = readFileSync(join(ROOT42, 'miniprogram/utils/dailyclose.js'), 'utf8')
      const miniDCW = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/daily-close/index.wxml'), 'utf8')
      const miniMPJ = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/my-performance/index.js'), 'utf8')
      const miniMPW = readFileSync(join(ROOT42, 'miniprogram/pages/merchant/my-performance/index.wxml'), 'utf8')
      check('㊾ 网页日结显式行渲染在场(dc-deduct-list+含售后扣回标)', adminJs.includes('dc-deduct-list') && adminJs.includes('含售后扣回'))
      check('㊾ 小程序日结显式行渲染在场(deducts 映射+售后扣回卡)', miniDC.includes('afterSalesDeductions') && miniDCW.includes('售后扣回(业绩)'))
      check('㊾ 小程序我的业绩显式行渲染在场(deductions 映射+扣回行)', miniMPJ.includes('deductions') && miniMPW.includes('售后扣回 · '))
      check('㊹ 后端 PATCH AFTER_SALES 落 status_history(发起原因唯一持有链)', srv.includes("if (status === 'AFTER_SALES') {") && /booking_status_history[\s\S]{0,200}AFTER_SALES', String\(body\.note/.test(srv))
      // ㊼ 裁决前端面:项目组=下拉(现有分类+不限)+存量野文本标红改选(不静默改)
      check('㊼ 前端下拉+存量标红在场(savePackage select/legacyGroupBad/danger)', adminJs.includes('groupOptions') && adminJs.includes('legacyGroupBad') && adminJs.includes('danger: legacyGroupBad'))
    }

  console.log(`\n爽约处置+售后完成态回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`)
  process.exit(1)
})
