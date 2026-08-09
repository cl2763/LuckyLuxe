/* 扫码签闭环回归(2026-08-09)——《扫码签闭环_UI设计图_2026-08-09.html》v2 四屏 + 规则⓪–⑧。

   核心口径:身份靠**两把确定性钥匙**,不靠手机号猜人 ——
     签署码 → 指向具体一张单(单挂哪份档案,建单时就定死);
     会员码 → 指向具体一份档案(未绑定轻档案的会员码 = 认领码)。

   店主点名的 corner case 全在这里:
     推送+扫码双端同时点签只成一次 / 未绑定顾客扫到别人单的码 / 会员码扫到已绑定档案 /
     轻档案无手机号走全链 / openid 冲突 / 一次性签署码过期与重发。 */
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)
const todayStr = () => new Date().toLocaleDateString('en-CA')

// serializeBooking 把顾客放在 booking.user 里(不是 userId)
const uidOf = (b) => (b && (b.userId || (b.user && b.user.id))) || ''

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `scan-${label}-${RUN}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `扫码店${label}${RUN}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Scan-${RUN}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  return { tenantId: id, token: again.data.auth.accessToken }
}

async function main() {
  const shop = await newShop('a')
  const other = await newShop('b')
  const cat = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail', name: '美甲' }) }, shop.token)).data.category
  const svc = (await request('/admin/pricing/items', {
    method: 'POST', body: JSON.stringify({ nameZh: '精品单色', type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 36800, memberPriceCents: 19800 })
  }, shop.token)).data.item
  const tech = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `小婕${RUN}` }) })).data.technician
  await request('/admin/deposit-config', {
    method: 'PUT', body: JSON.stringify({ config: { enabled: true, deductible: true, mode: 'fixed', fixedAmountCents: 10000 } })
  }, shop.token)

  /* ---- S1 现场排单:姓名+手机号建轻档案(规则①)---- */
  const phone = `1380013${RUN.slice(-4)}`
  const bk1 = await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: '王小雅', phone, serviceId: svc.id, technicianId: tech.id, date: todayStr(), time: '10:10', durationMin: 60, depositPaid: false })
  }, shop.token)
  check('S1 现场排单建轻档案(姓名+手机号)', bk1.status === 201 && Boolean(uidOf(bk1.data.booking)), JSON.stringify(bk1.data).slice(0, 160))
  const xiaoya = uidOf(bk1.data.booking)

  // S1-08 手机号命中已有档案 → 带出,不建重复档案
  const lookup = await request(`/admin/customers/lookup?phone=${encodeURIComponent(phone)}`, {}, shop.token)
  check('S1 手机号命中已有档案(带出,不新建)', lookup.data.hit && lookup.data.hit.id === xiaoya && lookup.data.via === 'phone',
    JSON.stringify(lookup.data).slice(0, 200))
  check('S1 带出的档案标着「未绑定」', lookup.data.hit.bound === false, String(lookup.data.hit.bound))
  /* 「绑定」只认**微信**。顾客导入会给档案写一条 provider='phone' 的身份行,
     那只是留了手机号 —— 曾把轻档案误判成已绑定,S2 徽标一直不出现(并排核验查出来的)。 */
  const impPhone = `1330013${RUN.slice(-4)}`
  const impUid = (await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: '导入客', phone: impPhone, balanceCents: 0 }] })
  })).data.users[0].userId
  const impHit = await request(`/admin/customers/lookup?userId=${encodeURIComponent(impUid)}`, {}, shop.token)
  check('S2 只留了手机号(provider=phone)**不算**已绑定,徽标照出',
    impHit.data.hit.bound === false && impHit.data.hit.badgeText === '新客 · 未绑定',
    JSON.stringify(impHit.data.hit).slice(0, 200))
  const memberCode = lookup.data.hit.memberCode
  check('S1 轻档案也有专属会员码(规则⑥ 认领码)', /^LL-[A-Z0-9]{8}$/.test(memberCode), memberCode)

  // S1-05 扫会员码 → 直接带出同一份档案
  const byMc = await request(`/admin/customers/lookup?memberCode=${encodeURIComponent(memberCode)}`, {}, shop.token)
  check('S1 扫会员码带出同一份档案', byMc.data.hit && byMc.data.hit.id === xiaoya && byMc.data.via === 'member_code', JSON.stringify(byMc.data).slice(0, 160))
  // 越权:别家店扫这个会员码带不出来
  const mcCross = await request(`/admin/customers/lookup?memberCode=${encodeURIComponent(memberCode)}`, {}, other.token)
  check('S1 越权:别家店拿这个会员码查不到(跨店隔离)', mcCross.data.hit === null, JSON.stringify(mcCross.data).slice(0, 140))

  // 空态:轻档案**不填手机号**也能建单,全链照走
  const bk0 = await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: '无号新客', serviceId: svc.id, technicianId: tech.id, date: todayStr(), time: '16:10', durationMin: 60, depositPaid: false })
  }, shop.token)
  check('S1 空态:不填手机号也能建单(身份不依赖手机号)', bk0.status === 201 && Boolean(uidOf(bk0.data.booking)), String(bk0.status))

  /* ---- S2 结算页新客徽标(规则③:只看绑定状态,文案后端下发)---- */
  const sheet1 = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: xiaoya,
      settlements: [{ bookingId: bk1.data.booking.id, tierKey: 'member', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  check('S2 未绑定 → 徽标文案由后端下发', sheet1.bindBadgeText === '新客 · 未绑定', JSON.stringify(sheet1.bindBadgeText))
  check('S2 提示行也是后端下发', sheet1.bindHintText.includes('扫码'), sheet1.bindHintText)
  check('S2 顾客行手机号脱敏', sheet1.customerPhoneMasked === `${phone.slice(0, 3)}****${phone.slice(-4)}`, sheet1.customerPhoneMasked)

  // S2 徽标也能按 userId 单独拿(小程序结算页就用这条,不为一个徽标再开接口)
  const byUid = await request(`/admin/customers/lookup?userId=${encodeURIComponent(xiaoya)}`, {}, shop.token)
  check('S2 按 userId 拿徽标状态', byUid.data.hit && byUid.data.via === 'user_id' && byUid.data.hit.badgeText === '新客 · 未绑定',
    JSON.stringify(byUid.data).slice(0, 200))
  check('S2 徽标接口也给脱敏手机号', byUid.data.hit.phoneMasked === `${phone.slice(0, 3)}****${phone.slice(-4)}`, byUid.data.hit.phoneMasked)
  const uidCross = await request(`/admin/customers/lookup?userId=${encodeURIComponent(xiaoya)}`, {}, other.token)
  check('S2 越权:别家店按 userId 也查不到', uidCross.data.hit === null, JSON.stringify(uidCross.data).slice(0, 140))

  /* ---- S3 二维码 + 状态行(规则④)---- */
  const qr = await request(`/admin/settlements/${sheet1.id}/sign-token`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('S3 推送签署出码', qr.status === 200 && qr.data.url.includes('/sign?t='), JSON.stringify(qr.data).slice(0, 160))
  check('S3 未绑定顾客:不显示「已推送到顾客小程序」', qr.data.pushedText === '', JSON.stringify(qr.data.pushedText))
  check('S3 状态行初始 = 等待顾客进入', qr.data.state === 'waiting' && qr.data.text.includes('等待'), JSON.stringify(qr.data.text))
  // 越权
  const qrAnon = await request(`/admin/settlements/${sheet1.id}/sign-token`, { method: 'POST', body: JSON.stringify({}) }, null)
  check('S3 越权:未登录取不到码 401', qrAnon.status === 401, String(qrAnon.status))
  const qrCross = await request(`/admin/settlements/${sheet1.id}/sign-token`, { method: 'POST', body: JSON.stringify({}) }, other.token)
  check('S3 越权:跨店取别家单的码 404', qrCross.status === 404, String(qrCross.status))

  // 顾客扫码进来 → 状态行跳「顾客核对中」
  const scanned = await request(`/settlements/by-token/${qr.data.token}`, {}, null)
  check('S3 扫码换到的就是这张单', scanned.data.code === sheet1.code, JSON.stringify(scanned.data.code))
  const st1 = await request(`/admin/settlements/${sheet1.id}/sign-state`, {}, shop.token)
  check('S3 状态行 → 顾客核对中', st1.data.state === 'viewing' && st1.data.text === '顾客核对中', JSON.stringify(st1.data))

  /* 边界值:一次性签署码**重发** —— 旧码立刻作废,永远只有一枚有效 */
  const qr2 = await request(`/admin/settlements/${sheet1.id}/sign-token`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('S3 可以重发签署码', qr2.data.token !== qr.data.token, JSON.stringify({ a: qr.data.token, b: qr2.data.token }))
  const oldTok = await request(`/settlements/by-token/${qr.data.token}`, {}, null)
  check('S3 边界:重发后旧码立刻失效(410)', oldTok.status === 410 && oldTok.data.error.code === 'SIGN_TOKEN_SUPERSEDED', JSON.stringify(oldTok.data).slice(0, 140))
  const badTok = await request('/settlements/by-token/sg-does-not-exist', {}, null)
  check('S3 异常输入:乱码签署码 404', badTok.status === 404, String(badTok.status))

  /* ---- S4 本人确认绑定(规则⑤)---- */
  const claim = await request(`/settlements/${sheet1.code}/claim`, { method: 'POST', body: JSON.stringify({}) }, null)
  check('S4 「是我本人」一次点击完成绑定', claim.status === 200 && claim.data.bound === true, JSON.stringify(claim.data).slice(0, 200))
  check('S4 沙盒演示旁路生效(没配微信密钥也能跑通)', claim.data.sandbox === true, String(claim.data.sandbox))
  check('S4 绑定同时给出专属会员码', claim.data.memberCode === memberCode, JSON.stringify({ a: claim.data.memberCode, b: memberCode }))
  check('S4 确认卡显示的是**这张单挂着的档案**的名字', claim.data.customerName === '王小雅', claim.data.customerName)
  // 幂等:再点一次不产生第二条身份
  const claimAgain = await request(`/settlements/${sheet1.code}/claim`, { method: 'POST', body: JSON.stringify({}) }, null)
  check('S4 幂等:重复绑定不报错也不重复绑', claimAgain.data.bound === true && claimAgain.data.alreadyBound === true, JSON.stringify(claimAgain.data).slice(0, 160))
  // 绑定后徽标消失(规则③)
  const after = await request(`/settlements/${sheet1.code}`, {}, null)
  check('S4 绑定后 S2 徽标消失', after.data.settlement.bindBadgeText === '' && after.data.settlement.customerBound === true,
    JSON.stringify({ b: after.data.settlement.bindBadgeText, c: after.data.settlement.customerBound }))
  const uidAfter = await request(`/admin/customers/lookup?userId=${encodeURIComponent(xiaoya)}`, {}, shop.token)
  check('S4 绑定后徽标接口也给空串(前端 wx:if 一挂就没了)', uidAfter.data.hit.badgeText === '' && uidAfter.data.hit.bound === true,
    JSON.stringify(uidAfter.data.hit).slice(0, 160))
  // 已绑定顾客再出码 → 顶部多一行「已推送到顾客小程序」(S3-06)
  const qrBound = await request(`/admin/settlements/${sheet1.id}/sign-token`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('S3 已绑定顾客:顶部多「✓ 已推送到顾客小程序」', qrBound.data.pushedText === '✓ 已推送到顾客小程序', qrBound.data.pushedText)

  /* S4-06 手机号一键授权 = **只校验**,不一致仅提示,不拦签字、不改档案 */
  const bk2 = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: '李小满', phone: `1390013${RUN.slice(-4)}`, serviceId: svc.id, technicianId: tech.id, date: todayStr(), time: '11:20', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const sheet2 = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: uidOf(bk2),
      settlements: [{ bookingId: bk2.id, tierKey: 'member', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  const mismatch = await request(`/settlements/${sheet2.code}/claim`, {
    method: 'POST', body: JSON.stringify({ phone: '13900000000' })
  }, null)
  check('S4 手机号不一致:照样绑定成功(不拦)', mismatch.data.bound === true, JSON.stringify(mismatch.data).slice(0, 160))
  check('S4 手机号不一致:只提示不改档案', mismatch.data.phoneCheck && mismatch.data.phoneCheck.matched === false && mismatch.data.phoneCheck.note.includes('不影响签字'),
    JSON.stringify(mismatch.data.phoneCheck))
  const filed = (await request(`/admin/customers/lookup?phone=${encodeURIComponent(`1390013${RUN.slice(-4)}`)}`, {}, shop.token)).data
  check('S4 档案上的手机号一个字没被改', filed.hit && filed.hit.id === uidOf(bk2), JSON.stringify(filed).slice(0, 160))

  /* corner case:未绑定顾客**扫到别人单的码** —— 确认卡显示的是那张单单主的名字,
     单→档案不受影响(规则⓪:身份由码决定,不由扫码的人决定) */
  const bk3 = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: '张三', phone: `1370013${RUN.slice(-4)}`, serviceId: svc.id, technicianId: tech.id, date: todayStr(), time: '12:30', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const sheet3 = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: uidOf(bk3),
      settlements: [{ bookingId: bk3.id, tierKey: 'member', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  const qr3 = await request(`/admin/settlements/${sheet3.id}/sign-token`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  const scan3 = await request(`/settlements/by-token/${qr3.data.token}`, {}, null)
  check('corner:扫到别人单的码 → 拿到的是**那张单**', scan3.data.code === sheet3.code, scan3.data.code)
  check('corner:确认卡显示的是该单单主的名字(张三),不是扫码人', scan3.data.settlement.cardOwnerName === '张三', scan3.data.settlement.cardOwnerName)

  /* corner case:openid 冲突 —— 该微信已绑本店另一档案 → 不覆盖、签字照走、进人工合并队列 */
  const conflictOpenId = `wx-conflict-${RUN}`
  await request(`/settlements/${sheet3.code}/claim`, { method: 'POST', body: JSON.stringify({ openid: conflictOpenId }) }, null)
  const bk4 = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: '李四', phone: `1360013${RUN.slice(-4)}`, serviceId: svc.id, technicianId: tech.id, date: todayStr(), time: '13:40', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const sheet4 = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: uidOf(bk4),
      settlements: [{ bookingId: bk4.id, tierKey: 'member', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  const conflict = await request(`/settlements/${sheet4.code}/claim`, { method: 'POST', body: JSON.stringify({ openid: conflictOpenId }) }, null)
  check('corner:openid 冲突 → 不绑不覆盖', conflict.data.bound === false && conflict.data.conflict === true, JSON.stringify(conflict.data).slice(0, 200))
  check('corner:openid 冲突 → 进人工合并队列', conflict.data.mergeQueued === true, String(conflict.data.mergeQueued))
  const queue = await request('/admin/identity-merge-queue', {}, shop.token)
  check('corner:合并队列里能查到这条', queue.data.queue.some((q) => q.settlementCode === sheet4.code && q.boundUserName === '张三' && q.targetUserName === '李四'),
    JSON.stringify(queue.data.queue).slice(0, 240))
  // 冲突不拦签字
  const signConflict = await request(`/settlements/${sheet4.code}/sign`, {
    method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '李四', strokes: [[{ x: 5, y: 50 }, { x: 40, y: 15 }]] })
  }, null)
  check('corner:openid 冲突不拦签字,照样签成', signConflict.status === 200, JSON.stringify(signConflict.data).slice(0, 140))

  /* corner case:会员码扫到**已绑定**档案 → 幂等,不重复绑也不报错(规则⑥)*/
  const mcClaim = await request(`/member-code/${encodeURIComponent(memberCode)}/claim`, { method: 'POST', body: JSON.stringify({}) }, null)
  check('corner:会员码扫已绑定档案 → 幂等成功', mcClaim.status === 200 && mcClaim.data.bound === true && mcClaim.data.alreadyBound === true,
    JSON.stringify(mcClaim.data).slice(0, 160))
  const mcBad = await request('/member-code/LL-00000000/claim', { method: 'POST', body: JSON.stringify({}) }, null)
  check('corner:异常输入 —— 乱会员码 404', mcBad.status === 404, String(mcBad.status))

  /* corner case(并发时序):推送 + 扫码**双端同时点签,只成一次**;
     另一端再点 = 已签只读(规则⑧ 先签为准) */
  const bk5 = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: '双门测试', phone: `1350013${RUN.slice(-4)}`, serviceId: svc.id, technicianId: tech.id, date: todayStr(), time: '14:50', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const sheet5 = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: uidOf(bk5),
      settlements: [{ bookingId: bk5.id, tierKey: 'member', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  const body5 = { disclaimerAccepted: true, signature: '双门', strokes: [[{ x: 5, y: 50 }, { x: 40, y: 15 }]] }
  const both = await Promise.all([
    request(`/settlements/${sheet5.code}/sign`, { method: 'POST', body: JSON.stringify(body5) }, null),
    request(`/settlements/${sheet5.code}/sign`, { method: 'POST', body: JSON.stringify(body5) }, null)
  ])
  const okCount = both.filter((r) => r.status === 200).length
  check('corner:双端同时点签,只成一次', okCount === 1, JSON.stringify(both.map((r) => r.status)))
  check('corner:另一端拿到「已签过」而不是 500', both.some((r) => r.status === 400 && r.data.error.code === 'ALREADY_SIGNED'),
    JSON.stringify(both.map((r) => r.data && r.data.error && r.data.error.code)))
  const readonly = await request(`/settlements/${sheet5.code}`, {}, null)
  check('corner:签完另一入口变已签只读', readonly.data.settlement.status === 'signed', readonly.data.settlement.status)
  const qrSigned = await request(`/admin/settlements/${sheet5.id}/sign-token`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('corner:已签的单不再出新码', qrSigned.status === 400 && qrSigned.data.error.code === 'ALREADY_SIGNED', String(qrSigned.status))

  /* 幂等:合并队列只追加,删不掉 */
  {
    const { DatabaseSync } = await import('node:sqlite')
    const dbPath = process.env.TEST_DB_PATH || `${process.env.DATA_DIR || './local-data'}/lucky-luxe.sqlite`
    const rawDb = new DatabaseSync(dbPath)
    let blocked = false
    try { rawDb.prepare('DELETE FROM identity_merge_queue WHERE tenant_id = ?').run(shop.tenantId) } catch { blocked = true }
    rawDb.close()
    check('合并队列数据库层禁删(只追加)', blocked)
  }

  /* 财务红线常驻:整条链跑完,定金守恒必须还是 ok */
  const cons = await request('/admin/finance/deposit-conservation', {}, shop.token)
  check('红线:跑完整条扫码签链路,定金守恒仍 ok', cons.data.ok === true, JSON.stringify(cons.data.broken).slice(0, 200))

  console.log(`\n扫码签闭环回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
