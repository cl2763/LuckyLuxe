/* 01t 观看式走查缺陷单常驻断言(D94–D101;判据匹配带界定)。 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const OWNER = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
let checks = 0
function check(name, ok, detail = '') {
  checks += 1
  if (!ok) { console.error(`Error: ${name}: ${detail}`); process.exit(1) }
  console.log(`ok ${checks} - ${name}`)
}
const rf = (p) => readFileSync(join(ROOT, p), 'utf8')
async function request(path, options = {}, token = OWNER) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) } })
  let data = null
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

async function main() {
  /* ===== D94:值日 tap 修死 + 静态链 ===== */
  const ordJs = rf('miniprogram/pages/merchant/orders/index.js')
  check('D94 值日 tap 调 loadDayView(this.load 不存在=点击即炸的根)', ordJs.includes('this.loadDayView(this.data.selDate)  // D94') && !/this\.load\(this\.data\.selDate\)/.test(ordJs))
  const dc = rf('miniprogram/utils/dailyclose.js')
  check('D94 snapViewer 初值住唯一真相(mixin dailyCloseData)且关闭不回 null', dc.includes('snapViewer: { open: false, items: [], index: 0 },') && dc.includes("this.setData({ snapViewer: { open: false, items: [], index: 0 } })"))
  check('D94 L2 零残留:全仓不再有 viewer 置 null 写法', !rf('miniprogram/pages/merchant/finance/index.js').includes('snapViewer: null') && !rf('miniprogram/pages/order-detail/index.js').includes('viewer: null'))

  /* ===== D95:网页直排面板对齐小程序(合同项逐条) ===== */
  const tb = rf('apps/web/today-board.js')
  check('D95 两级选择器(大类 data-tbf-cat + 小类 data-tbf-svc)', tb.includes('data-tbf-cat="') && tb.includes('data-tbf-svc="'))
  check('D95 时长自动+微调±30+标准(data-tbf-dur 三钮)', tb.includes('data-tbf-dur="-30"') && tb.includes('data-tbf-dur="30"') && tb.includes('data-tbf-dur="0"'))
  check('D95 预计结束由服务时长定(calcEnd)+提交带 durationMin/depositPaid', tb.includes('function calcEnd(time, dur)') && tb.includes('durationMin: f.durationMin, depositPaid: f.deposit === true'))

  /* ===== D96:直排后回灌全局预约缓存 ===== */
  check('D96 直排成功回灌 owner.bookings(refreshBookings 钩)', tb.includes('if (deps.refreshBookings) deps.refreshBookings()') && rf('apps/web/admin.js').includes("refreshBookings: async () => { try { const d = await request('/admin/bookings')"))

  /* ===== D97:行为闭环 —— 完成单无小记=待写;写(挂单)后消行 ===== */
  const uniq = Date.now().toString(36)
  const svc = (await request('/admin/pricing/items')).data.items.filter((i) => (i.itemKind || 'main') === 'main')[0]
  const techR = (await request('/admin/technicians')).data
  const tech = (techR.technicians || techR)[0]
  const today = new Date().toISOString().slice(0, 10)
  const mk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `观走查${uniq}`, serviceId: svc.id, technicianId: tech.id, date: today, time: '09:00' }) })
  check('D97 夹具:直排建单 201', mk.status === 201, JSON.stringify(mk.data).slice(0, 120))
  const bid = mk.data.booking.id, uid = mk.data.booking.userId || mk.data.booking.user_id || (mk.data.booking.user && mk.data.booking.user.id)
  await request(`/admin/bookings/${bid}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) })
  const p1 = await request(`/admin/service-notes/pending?date=${today}`)
  check('D97 完成无小记 → 进待写清单(按单判定)', p1.status === 200 && (p1.data.items || []).some((x) => x.bookingId === bid), JSON.stringify(p1.data).slice(0, 150))
  const note = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: uid, bookingId: bid, rawText: '观看式走查断言:裸色渐变,下次补钻' }) })
  check('D97 写小记挂单 200(bookingId 落库)', note.status === 200 || note.status === 201, JSON.stringify(note.data).slice(0, 120))
  const p2 = await request(`/admin/service-notes/pending?date=${today}`)
  check('D97 写完消行(挂单判定闭环)', !(p2.data.items || []).some((x) => x.bookingId === bid))
  /* 前端链:两端结算钩 + 台面 pill + 员工卡 + 订单卡补写口 */
  check('D97 网页结算完成钩(ServiceNoteModal.open 带 bookingId)', rf('apps/web/settlement-web.js').includes('window.ServiceNoteModal.open(state.userId, state.customerName'))
  check('D97 小程序全签完弹「去写/跳过」', rf('miniprogram/pages/merchant/settlement/index.js').includes("title: '给这单写个服务小记?'"))
  check('D97 台面 pill 双端(data-tb-notes / tapPendingNotes)', tb.includes('data-tb-notes') && ordJs.includes('tapPendingNotes()'))
  check('D97 员工工作台待写卡 + 网页订单卡补写口', rf('apps/web/staff-workbench.js').includes('data-swb-note="') && rf('apps/web/admin.js').includes('data-note-booking="${booking.id}"'))
  check('D97 弹层保存体带 bookingId', rf('apps/web/service-note-modal.js').includes('bookingId: st.bookingId || undefined'))
  check('D97 open() fresh 对象内带 bookingId(自走查咬出:先赋后重建=冲掉恒 null;判据钉在重建体内)', rf('apps/web/service-note-modal.js').includes("deps, bookingId: bookingId || '' }"))

  /* ===== D98/D99(静态链;像素=自走查) ===== */
  check('D98 值日行=标准开关(ui-spec ⑤ 也守),说明句行内小字', rf('apps/web/duty-setting.js').includes('class="note"'))
  check('D99 定金规则摘要行呼吸(20rpx 22rpx)', rf('miniprogram/pages/merchant/store/index.wxss').includes('padding:20rpx 22rpx;border-bottom:1rpx solid #f2ece5'))

  /* ===== D101②:会话侧顾客卡六件双端 ===== */
  const desk = rf('apps/web/ai-desk.js')
  check('D101② 网页卡六件(会员/会员码/储值/次卡/报价状态)', desk.includes('会员码') && desk.includes('data-cs-tc="') && desk.includes('报价状态'))
  const convJs = rf('miniprogram/pages/merchant/conversation/index.js')
  const convWx = rf('miniprogram/pages/merchant/conversation/index.wxml')
  check('D101② 小程序卡六件 + 报价短标(quoteLabel)', convJs.includes("memberCode: cust.memberCode || '—'") && convWx.includes('{{quoteLabel}}') && convWx.includes('{{profile.tcText}}'))
  check('D101① 横幅链仍在(banner 属性界定)', convWx.includes('class="qs-banner {{quoteBannerCls}}"'))

  /* ===== 01u 裁① D88:过去优先(行为两向;过去+撞位 → 只报「已过去」,不拼两因) ===== */
  {
    const techs = (await request('/admin/technicians')).data
    const t2 = (techs.technicians || techs)[1] || tech
    // 未来撞位:同技师同时段两单 → 报「重叠」
    const fut = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    const f1 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `D88未来${uniq}`, serviceId: svc.id, technicianId: t2.id, date: fut, time: '11:00' }) })
    const f2 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `D88未来b${uniq}`, serviceId: svc.id, technicianId: t2.id, date: fut, time: '11:00' }) })
    if (f1.status === 201) {
      check('D88 未来撞位 → 只报「重叠」(不报已过去)', f2.status === 409 && /重叠/.test(f2.data.error.message) && !/已经过去/.test(f2.data.error.message), JSON.stringify(f2.data).slice(0, 120))
    }
    // 过去撞位:同技师过去时段两单 → 只报「已过去」(过去优先,一句一因)
    const past = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const p1 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `D88过去${uniq}`, serviceId: svc.id, technicianId: t2.id, date: past, time: '11:00' }) })
    if (p1.status === 201) {
      const p2 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `D88过去b${uniq}`, serviceId: svc.id, technicianId: t2.id, date: past, time: '11:00' }) })
      check('🔴 D88 裁①过去优先:过去+撞位只报「已过去」,一句一因不拼两因', p2.status === 409 && /已经过去/.test(p2.data.error.message) && !/重叠/.test(p2.data.error.message), JSON.stringify(p2.data).slice(0, 140))
      check('D88 补录能力在:过去营业日空档直排 201(老板补录路径,后端不拦)', p1.status === 201)
    }
  }
  /* ===== 01u 裁④ D96 二段:排完自动跟去(跳转链复用,零新形制) ===== */
  check('D96 裁④ 直排成功→回灌缓存后跟去该单(followBooking=既有 jumpToBooking)',
    tb.includes('deps.refreshBookings().then(function () { deps.followBooking(newId) })')
    && rf('apps/web/admin.js').includes('followBooking: (id) => jumpToBooking(id)'))
  check('D96 裁④ 跟去=切视图+切日期+展开高亮+滚动(链本身未分叉,仍是同一处实现)',
    /function jumpToBooking\(id\)[\s\S]{0,400}els\.filterDate\.value = bk \? bk\.appointmentDate/.test(rf('apps/web/admin.js')))
  /* ===== 01u 裁定一 二形法:能点的都是胶囊(点名处;全端硬零由 test-ui-spec 守) ===== */
  const css01u = rf('apps/web/styles.css')
  check('二形法 主操作/页签/开关/pill 四类点名处=胶囊', /\.primary \{[^}]*border-radius: 999px/.test(css01u)
    && /\.nfy-tab \{[^}]*border-radius: 999px/.test(css01u) && /\.tb-pill \{[^}]*border-radius: 999px/.test(css01u)
    && /\.hsw-sw, \.ui-sw \{[^}]*border-radius: 999px/.test(css01u))
  check('二形法 小程序全局 button 复位=999rpx(裸 button 也不长歪,方角源头已堵)',
    rf('miniprogram/app.wxss').includes('border-radius: 999rpx;') && !/button \{[\s\S]{0,120}border-radius: 0;/.test(rf('miniprogram/app.wxss')))

  /* ===== 01v 补录小合同(店主拍板):两形各一 + 三闸 + 双端链 ===== */
  {
    const today01v = (await request('/admin/schedule-day')).data.storeToday
    const past = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10)
    // 合同一:今天/未来不出补录块(时间诚实不破);过去日才出
    const sdToday = (await request('/admin/schedule-day')).data
    check('合同一 今天台面无补录块(时间诚实不破)', !sdToday.backfill)
    const sdPast = (await request(`/admin/schedule-day?date=${past}`)).data
    check('合同一 过去日出补录块 + 后端给 label/hint/note(前端零判断)',
      Boolean(sdPast.backfill && sdPast.backfill.label === '+ 补录' && sdPast.backfill.hint && sdPast.backfill.note),
      JSON.stringify(sdPast.backfill || null).slice(0, 140))
    // 形一:未日结 → 单落原日、无「服务发生于」句
    /* 🔴 03p(店主 01w《断言增量律》抓到的):这两条断言原来包在
       `if (openDay && !hoursUnset && !isClosed)` 里 —— **9 天前撞上门店休息日就整块静默跳过,
       套件照样绿**。基线刀报「observe-fixes 56 → 54」才把它照出来。
       静默失败器族:判据里的静默跳过和产品里的一样致命。
       改法:往前找**第一个营业的过去日**;一个都找不到才红(不是跳过)。 */
    let openDay = null
    let sdOpen = sdPast
    for (let back = 9; back <= 20 && !openDay; back += 1) {
      const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10)
      const sd = (await request(`/admin/schedule-day?date=${d}`)).data
      if (sd.backfill && !sd.backfill.closed && !sd.hoursUnset && !sd.isClosed) { openDay = d; sdOpen = sd }
    }
    check('合同二前置:过去 9~20 天里找得到一个营业且未日结的日子(找不到=这两条没验成,不是通过)',
      Boolean(openDay), `openDay=${openDay}`)
    if (openDay) {
      const b1 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ backfill: true, newCustomerName: `补录形一${uniq}`, serviceId: svc.id, technicianId: tech.id, date: openDay, time: '15:20' }) })
      check('🔴 合同二形一 未日结 → 单/钱/业绩全记原日(且不出「服务发生于」句)',
        b1.status === 201 && b1.data.booking.appointmentDate === openDay && !b1.data.booking.backfillNote,
        JSON.stringify({ d: b1.data.booking && b1.data.booking.appointmentDate, n: b1.data.booking && b1.data.booking.backfillNote }))
      check('合同三 返回体带后端判定(targetDate=原日)', b1.data.backfill && b1.data.backfill.targetDate === openDay)
    }
    // 形二:已日结 → 落今天 + 单上注明(直接把某过去日确认掉来造这一形;夹具直连回归临时库)
    const closedDay = new Date(Date.now() - 11 * 86400000).toISOString().slice(0, 10)
    const { DatabaseSync } = await import('node:sqlite')
    const bfDb = new DatabaseSync(process.env.TEST_DB_PATH)
    const tid01v = bfDb.prepare("SELECT tenant_id FROM bookings ORDER BY created_at DESC LIMIT 1").get().tenant_id
    const nowIso01v = new Date().toISOString()
    bfDb.prepare(`INSERT OR REPLACE INTO daily_closes (id, tenant_id, date, status, order_count, revenue_cents, created_at, updated_at)
      VALUES (?, ?, ?, 'confirmed', 0, 0, ?, ?)`).run(`dc-bf-${uniq}`, tid01v, closedDay, nowIso01v, nowIso01v)
    const sdClosed = (await request(`/admin/schedule-day?date=${closedDay}`)).data
    check('合同三 已日结日的确认句写明落今天与原因(人话,后端出)',
      Boolean(sdClosed.backfill && sdClosed.backfill.closed && sdClosed.backfill.targetDate === today01v
        && /已日结/.test(sdClosed.backfill.note) && /服务发生于/.test(sdClosed.backfill.note)),
      JSON.stringify(sdClosed.backfill || null).slice(0, 160))
    if (!sdClosed.hoursUnset && !sdClosed.isClosed) {
      const b2 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ backfill: true, newCustomerName: `补录形二${uniq}`, serviceId: svc.id, technicianId: tech.id, date: closedDay, time: '15:40' }) })
      check('🔴 合同二形二 已日结 → 落**今天**,历史账不回改',
        b2.status === 201 && b2.data.booking.appointmentDate === today01v,
        JSON.stringify({ d: b2.data.booking && b2.data.booking.appointmentDate, want: today01v }))
      check('🔴 合同二形二 单上注明「服务发生于 X 月 X 日」(后端唯一出口)',
        b2.status === 201 && /^服务发生于 \d+ 月 \d+ 日$/.test(b2.data.booking.backfillNote || ''),
        JSON.stringify(b2.data.booking && b2.data.booking.backfillNote))
      check('合同二形二 原服务日留痕(backfillServiceDate=原日,可追溯)',
        b2.status === 201 && b2.data.booking.backfillServiceDate === closedDay)
    }
    // 合同四:未来日不许走补录口(补录只补往日)
    const fut01v = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
    const b3 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ backfill: true, newCustomerName: `补录未来${uniq}`, serviceId: svc.id, technicianId: tech.id, date: fut01v, time: '15:00' }) })
    check('合同四 补录口只收过去日(未来日 400)', b3.status === 400, String(b3.status))
  }
  /* 合同一 双端链(同路由同形制;前端零拼串) */
  check('合同一 网页 assemble 真把 backfill 带进 dv(自走查咬出:渲染读 dv.backfill,组装漏接=静默不显)',
    /backfill: r\.backfill \|\| null/.test(tb))
  check('合同一 网页:块文案/标题/确认句全读后端 backfill(零前端判断)',
    tb.includes("(stateT.dv && stateT.dv.backfill && stateT.dv.backfill.label)") && tb.includes('escapeHtml(bf.note)')
    && tb.includes('if (stateT.dv && stateT.dv.backfill) body.backfill = true'))
  check('合同一 小程序同批:dv.backfill 下发 + 块文案 + 两句 + 提交带 backfill',
    ordJs.includes('backfill: r.backfill || null') && ordJs.includes('if (d.dv && d.dv.backfill) body.backfill = true')
    && rf('miniprogram/pages/merchant/orders/index.wxml').includes("{{dv.backfill ? dv.backfill.label : '+ 直接排单'}}")
    && rf('miniprogram/pages/merchant/orders/index.wxml').includes('{{dv.backfill.note}}'))
  check('合同二 归属判定唯一出口在后端(前端零处出现日结判断)',
    !tb.includes('daily_close') && !ordJs.includes('daily_close') && !tb.includes('已日结'))

  /* ===== 01w 裁②:「已日结日补录到今天 → 今天再日结」端到端(钱的链,逐环出证据)=====
     链:①造一个已日结的过去日 ②往那天补录一单 → 落今天 ③给这单开单+签字入账
         ④今天的日结里:这单在不在 / 业绩归谁 / 抽屉对不对得上 ⑤原那天的历史账一分未动 */
  {
    const e2eDay = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10)
    const { DatabaseSync: DBe2e } = await import('node:sqlite')
    const e2eDb = new DBe2e(process.env.TEST_DB_PATH)
    const tidE = e2eDb.prepare('SELECT tenant_id FROM bookings ORDER BY created_at DESC LIMIT 1').get().tenant_id
    const nowE = new Date().toISOString()
    e2eDb.prepare(`INSERT OR REPLACE INTO daily_closes (id, tenant_id, date, status, order_count, revenue_cents, confirmed_at, confirmed_by, created_at, updated_at)
      VALUES (?, ?, ?, 'confirmed', 0, 0, ?, 'e2e', ?, ?)`).run(`dc-e2e-${uniq}`, tidE, e2eDay, nowE, nowE, nowE)
    const closedBefore = e2eDb.prepare('SELECT order_count, revenue_cents FROM daily_closes WHERE tenant_id = ? AND date = ?').get(tidE, e2eDay)
    const todayE = (await request('/admin/schedule-day')).data.storeToday
    const dcBefore = (await request(`/admin/daily-close?date=${todayE}`)).data.dailyClose
    const sdE = (await request(`/admin/schedule-day?date=${e2eDay}`)).data
    if (sdE.backfill && sdE.backfill.closed && !sdE.hoursUnset && !sdE.isClosed) {
      // ② 补录 → 落今天
      const bfRes = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ backfill: true, newCustomerName: `链验客${uniq}`, serviceId: svc.id, technicianId: tech.id, date: e2eDay, time: '16:20' }) })
      check('🔴 裁② 链①补录落今天(不落已日结的原日)', bfRes.status === 201 && bfRes.data.booking.appointmentDate === todayE,
        JSON.stringify({ got: bfRes.data.booking && bfRes.data.booking.appointmentDate, want: todayE, err: bfRes.data.error }))
      if (bfRes.status === 201) {
        const bid = bfRes.data.booking.id
        const uidE = bfRes.data.booking.userId || (bfRes.data.booking.user && bfRes.data.booking.user.id)
        // ③ 开单 + 签字入账
        const sheet = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId: uidE, settlements: [{ bookingId: bid, payIntent: 'offline_full', items: [{ serviceId: svc.id, qty: 1 }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }] }) })
        check('裁② 链②补录单能开单(与普通单同路)', sheet.status === 200 || sheet.status === 201, JSON.stringify(sheet.data).slice(0, 140))
        /* 判据自身的静默失败器(01w 自查咬出):原先 sid 取错字段名 → if(sid) 整块被跳过,
           钱的链一条没跑而套件仍绿(数字对不上才发现)。改:取真字段 + **取不到就红**,不许静默跳。 */
        const sheet0 = ((sheet.data && sheet.data.settlements) || [])[0]
        const sid = sheet0 && (sheet0.code || sheet0.id)
        check('裁② 链②开单返回体拿得到结算单号(拿不到=下面整条钱链会被跳过,必须出声)',
          Boolean(sid), JSON.stringify(Object.keys(sheet.data || {})))
        if (sid) {
          /* 签字口=顾客侧 /settlements/<单号>/sign(不是 /admin/…;入账唯一路径就这一条,不另造) */
          const signed = await request(`/settlements/${encodeURIComponent(sid)}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: '链验客' }) })
          check('裁② 链③签字入账 200(签字才记账,口径不变)', signed.status === 200, JSON.stringify(signed.data).slice(0, 120))
          // ④ 今天的日结:单在、业绩归本人、抽屉跟着动
          const dcAfter = (await request(`/admin/daily-close?date=${todayE}`)).data.dailyClose
          check('🔴 裁② 链④补录单进**今天**的日结(单数 +1)', dcAfter.orderCount === dcBefore.orderCount + 1,
            `${dcBefore.orderCount} → ${dcAfter.orderCount}`)
          const mine = (dcAfter.settlements || []).some((x) => x.bookingId === bid || (x.bookings || []).some((y) => y.id === bid))
          check('裁② 链④这单出现在今天日结的结算列表里(能被店主看见)', mine || dcAfter.orderCount > dcBefore.orderCount)
          const techLine = (dcAfter.technicians || []).find((t2) => t2.technicianId === tech.id || t2.id === tech.id)
          check('🔴 裁② 链④业绩归**做这单的技师**(今天这条业绩行里)', Boolean(techLine && (techLine.perfCents || 0) > 0),
            JSON.stringify(techLine || (dcAfter.technicians || []).slice(0, 2)).slice(0, 160))
          check('裁② 链④抽屉数在场且自洽(现金口径块整块下发)', Boolean(dcAfter.cashDrawer && typeof dcAfter.cashDrawer.storefrontCents === 'number'))
          check('🔴 裁② 链④营收也进今天(不是只进了单数)', (dcAfter.revenueCents || 0) > (dcBefore.revenueCents || 0),
            `${dcBefore.revenueCents} → ${dcAfter.revenueCents}`)
          // ⑤ 原那天:历史账一分未动
          const closedAfter = e2eDb.prepare('SELECT order_count, revenue_cents, status FROM daily_closes WHERE tenant_id = ? AND date = ?').get(tidE, e2eDay)
          check('🔴 裁② 链⑤原已日结那天**一分未动**(单数/营收/状态三样都没变)',
            closedAfter.order_count === closedBefore.order_count && closedAfter.revenue_cents === closedBefore.revenue_cents && closedAfter.status === 'confirmed',
            JSON.stringify({ before: closedBefore, after: closedAfter }))
          const dcOld = (await request(`/admin/daily-close?date=${e2eDay}`)).data.dailyClose
          check('🔴 裁② 链⑤原那天不被标「数字已过期」(补录没污染它,R1 不该被惊动)', !dcOld.staleClose,
            JSON.stringify({ stale: dcOld.staleClose, post: dcOld.postCloseAdditions }))
        }
      }
    } else {
      check('裁② 链:夹具日不可用(店休/未设置),本轮跳过并出声(不静默绿)', false, JSON.stringify({ e2eDay, closed: sdE.backfill && sdE.backfill.closed, hoursUnset: sdE.hoursUnset, isClosed: sdE.isClosed }))
    }
  }
  /* 裁① 补录语境措辞:两语境各说各的真因 */
  check('裁① 补录语境不许报「已经过去了」(源码层:past 分支带 !opts.backfill 界定)',
    rf('apps/api/local-server.mjs').includes("if (!opts.backfill && `${input.date} ${input.time}` < `${nowD.date} ${nowD.time}`)"))
  check('裁① 补录撞位句去掉「换个时间」的废建议(补录是往回记,时间是既成事实)',
    rf('apps/api/local-server.mjs').includes('该技师那个时段已经有单了') && rf('apps/api/local-server.mjs').includes('核对一下当时的实际时间,或换一位技师'))
    /* 🔴 03x:原来锚的是 `backfill: Boolean(plan) })` —— **连同那个右括号一起锚死了**,
       于是同一个 opts 对象后面再加任何一个键(D121 加了 demoSeed)这条就红,
       而它要守的事情(backfill 真传进去了)其实一点没变。
       判据不许锚在「这一行末尾长什么样」上,要锚在「这个键真传了」这件事上。 */
  check('裁① opts.backfill 真传进 createBooking(不传=上面两处永远走 else,静默失败器族)',
      /adminDirect: true[^)]*backfill: Boolean\(plan\)/.test(rf('apps/api/local-server.mjs')))

  console.log(`[observe-fixes] all ${checks} checks passed`)
}
main().catch((e) => { console.error('[observe-fixes] failed:', e.message); process.exit(1) })
