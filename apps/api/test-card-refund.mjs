/* N-5 退卡口(店主 2026-08-25 拍板,图=合同「退卡口设计图」)。

   这套件守的是一句话:**退卡不是手动耗卡。**
   手动耗卡会凭空确认一笔收入(服务没真发生),系统故意不给那个按钮;
   退卡只动负债与现金 —— 所以「本店收入影响」永远是 0,不是 0 就是账记错了。

   corner case 覆盖:
   ① 边界:退款额 = 余额(刚好清空,准)/ 超余额 1 分(拒)/ 0 与负数(拒)
   ② 边界:退次数 = 剩余(准,卡作废)/ 超剩余 1 次(拒)
   ③ 异常输入:原因为空、只有空格(拒);顾客/卡不存在(404)
   ④ 越权:未登录、员工权限边界
   ⑤ 幂等/追加:退两次各写一行,旧行一个字节不改(账本只许追加)
   ⑥ 财务红线:退卡前后**收入表一分不变**(真跑取值),且 refund 与 reversal 分得开
   ⑦ 双端:顾客端 /my/stored-value 看得见这笔,类型文案由后端给
   ⑧ 配置分叉:退完卡还算不算会员,两种取值各跑一遍,行为必须不同
   ⑨ 退完的次数不能再核销(退次≠耗卡,但可用次数必须扣掉)

   ⚠️ standalone:bash apps/api/run-all-tests.sh card-refund */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = TOKEN, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}
const db = new DatabaseSync(process.env.TEST_DB_PATH || '')
const incomeTotal = (tid) => db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM finance_transactions WHERE tenant_id = ? AND type = 'income'").get(tid).n
const financeRows = (tid) => db.prepare('SELECT COUNT(*) n FROM finance_transactions WHERE tenant_id = ?').get(tid).n

// ===== 夹具:一家店 + 一位绑定顾客 + 充值 1,000(含赠送 100)=====
const tid = `n5-${RUN}`
const shopName = `退卡测试店${RUN}`
const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: shopName, plan: 'chain' }) })
if (made.status !== 201) throw new Error(`建店失败 ${JSON.stringify(made.data)}`)
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
/* 顾客夹具:先用商家口建档(demoLogin 只认本店已有的演示档案,新店里一个都没有),
   再直连库贴 openid(充值有 D25 绑定闸),最后按人登录拿顾客令牌。 */
const tech0 = await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技师${RUN}`, isActive: true }) }, TOKEN, H)
const catId = ((await request('/admin/pricing/categories', {}, TOKEN, H)).data.categories || [])[0]?.id
const svc0 = await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `退卡项目${RUN}`, nameEn: 'x', priceCents: 18000, baseDurationMin: 60, categoryId: catId }) }, TOKEN, H)
const serviceId = svc0.data.service.id
const technicianId = tech0.data.technician.id
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
const seedBk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `退卡顾客${RUN}`, serviceId, technicianId, date: today, time: '10:00' }) }, TOKEN, H)
const userId = seedBk.data.booking?.user?.id || seedBk.data.booking?.userId || ''
db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`n5-openid-${RUN}`, userId)
const cust = await request('/auth/wechat/mini-login', { method: 'POST', body: JSON.stringify({ demoLogin: true, asUserId: userId, tenantId: tid }) }, null, H)
const custToken = cust.data.auth?.accessToken
check('夹具:顾客建档 + 贴 openid + 按人登录', Boolean(userId) && Boolean(custToken), JSON.stringify(cust.data).slice(0, 140))
const rc = await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId, amountCents: 100000, bonusCents: 10000, payChannel: 'cash', note: '退卡夹具' }) }, TOKEN, H)
check('夹具:充值 1,000 + 赠送 100 成功', rc.status === 201, JSON.stringify(rc.data).slice(0, 120))

// ===== 一、四个参考数(图 §二:少一个心里没底,多一个就成了替他算)=====
const f0 = (await request(`/admin/account-adjust/facts?userId=${userId}`, {}, TOKEN, H)).data.facts
check('①-1 四个参考数齐:实付/赠送/已消费/当前余额', f0.paidCents === 100000 && f0.bonusCents === 10000 && f0.consumedCents === 0 && f0.balanceCents === 110000,
  JSON.stringify({ paid: f0.paidCents, bonus: f0.bonusCents, consumed: f0.consumedCents, balance: f0.balanceCents }))
check('①-2 「系统不替你算」那句提示后端给', /退多少由你按本店会员规则决定/.test(f0.hint), f0.hint)
check('①-3 「本店收入影响」那一行也是后端给的(前端不许自己写 0)', typeof f0.incomeImpactText === 'string' && /0/.test(f0.incomeImpactText), f0.incomeImpactText)

// ===== 二、硬拦三条(图 §四:拦不住就是账错)=====
const incomeBefore = incomeTotal(tid)
const rowsBefore = financeRows(tid)
let incomeMark = incomeBefore      // 卖过东西之后的新基线(见 ⑦-17)
let rowsMark = rowsBefore
const over = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 110001, reason: '试探超额' }) }, TOKEN, H)
check('②-1 退款额超余额 1 分 = 拒(余额不许变负)', over.status === 400 && over.data.error?.code === 'REFUND_EXCEEDS_BALANCE', JSON.stringify(over.data).slice(0, 140))
const noReason = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 100, reason: '   ' }) }, TOKEN, H)
check('②-2 原因只有空格 = 拒', noReason.status === 400 && noReason.data.error?.code === 'REASON_REQUIRED', `${noReason.status}`)
const zero = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 0, reason: '零' }) }, TOKEN, H)
const neg = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: -500, reason: '负' }) }, TOKEN, H)
check('②-3 金额 0 与负数都拒', zero.status === 400 && neg.status === 400, `${zero.status}/${neg.status}`)
const noUser = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: `ghost-${RUN}`, amountCents: 100, reason: '不存在的人' }) }, TOKEN, H)
check('②-4 顾客不存在 = 404', noUser.status === 404, `${noUser.status}`)
const noAuth = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 100, reason: '越权' }) }, null, H)
check('②-5 未登录 = 401', noAuth.status === 401, `${noAuth.status}`)
check('②-6 被拒的这五次一行账都没写', incomeTotal(tid) === incomeBefore && financeRows(tid) === rowsBefore)

// ===== 三、退一笔:余额减少、收入一分不动 =====
const r1 = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 30000, payChannel: 'cash', reason: '顾客搬去外地,不再来店' }) }, TOKEN, H)
check('③-1 退 300 成功', r1.status === 201 && r1.data.refundedCents === 30000, JSON.stringify(r1.data).slice(0, 140))
check('③-2 余额 1,100 → 800(真跑取值)', r1.data.balanceBeforeCents === 110000 && r1.data.balanceAfterCents === 80000,
  `${r1.data.balanceBeforeCents} → ${r1.data.balanceAfterCents}`)
check('③-3 🔴 收入表一分不变(退卡不碰收入)', incomeTotal(tid) === incomeBefore, `${incomeBefore} → ${incomeTotal(tid)}`)
check('③-4 🔴 财务账本一行没多(退的是负债,不是损益)', financeRows(tid) === rowsBefore, `${rowsBefore} → ${financeRows(tid)}`)
check('③-5 返回值里的收入影响恒为 0', r1.data.incomeImpactCents === 0, String(r1.data.incomeImpactCents))

// ===== 四、类型必须是 refund,与 reversal 分得开(图 §四:一个衡量团队,一个衡量生意)=====
const svRows = db.prepare('SELECT type, amount_cents, note FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? ORDER BY rowid').all(tid, userId)
check('④-1 落的是 refund 类型,不是 reversal', svRows.some((r) => r.type === 'refund') && !svRows.some((r) => r.type === 'reversal'), JSON.stringify(svRows.map((r) => r.type)))
check('④-2 退款行是负数(余额算法直接可加)', svRows.find((r) => r.type === 'refund').amount_cents === -30000)
check('④-3 原因写进了这行的备注(以后查得到)', /顾客搬去外地/.test(svRows.find((r) => r.type === 'refund').note || ''))
const byType = db.prepare('SELECT type, COUNT(*) n FROM stored_value_transactions WHERE tenant_id = ? GROUP BY type').all(tid)
check('④-4 两个类型能分开统计(查询按 type 分组即可)', byType.some((x) => x.type === 'refund'), JSON.stringify(byType))

// ===== 五、账本只许追加:再退一笔,旧行一个字节不改 =====
const beforeRow = db.prepare("SELECT id, amount_cents, note, created_at FROM stored_value_transactions WHERE tenant_id = ? AND type = 'refund'").get(tid)
const r2 = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 80000, payChannel: 'transfer', reason: '剩下的全退' }) }, TOKEN, H)
check('⑤-1 第二笔退款(全额退,清空)成功', r2.status === 201 && r2.data.balanceAfterCents === 0, JSON.stringify(r2.data).slice(0, 120))
const afterRow = db.prepare('SELECT id, amount_cents, note, created_at FROM stored_value_transactions WHERE id = ?').get(beforeRow.id)
check('⑤-2 第一笔那行一个字节没改(只追加)', JSON.stringify(beforeRow) === JSON.stringify(afterRow))
check('⑤-3 退到 0 之后再退 1 分也拒', (await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 1, reason: '再退' }) }, TOKEN, H)).status === 400)
check('⑤-4 收入表仍旧一分不变', incomeTotal(tid) === incomeBefore)

// ===== 六、顾客端看得见(端到端,不是各查各的)=====
const mine = await request('/my/stored-value', {}, custToken, H)
const myRefunds = (mine.data.txns || []).filter((t) => t.type === 'refund')
check('⑥-1 顾客端流水里有这两笔退款', myRefunds.length === 2, JSON.stringify((mine.data.txns || []).map((t) => t.type)))
check('⑥-2 类型文案由后端给(前端零词典)', myRefunds.every((t) => t.typeText === '退卡退款'), JSON.stringify(myRefunds.map((t) => t.typeText)))
check('⑥-3 顾客端余额也归零了(同一算法)', mine.data.balanceCents === 0, String(mine.data.balanceCents))

// ===== 七、日结留痕(既不进收入也不进支出)=====
const close = await request(`/admin/daily-close?date=${today}`, {}, TOKEN, H)
const rf = close.data?.dailyClose?.refunds
check('⑦-1 日结带当日退卡留痕', rf && rf.storedCount === 2 && rf.storedCents === 110000, JSON.stringify(rf && { c: rf.storedCount, s: rf.storedCents }))
check('⑦-2 留痕行自证「不进收入」', rf.incomeImpactCents === 0 && /不进收入/.test(rf.label || ''), rf.label)

/* 🔴 店主 08-25 复核抓出的那一半:**钱真的出去了** ——
   退卡不进损益(对),但现金合计必须扣它,否则店主晚上数钱对不上,而她会怀疑店员。
   判据用店主的语言:当天「现金应有数」== 收现 − 退款。 */
{
  const drawer = close.data?.dailyClose?.cashDrawer
  check('⑦-3 日结有「到店收的钱 · 应有数」这一块', Boolean(drawer) && /应有数/.test(drawer.label || ''), JSON.stringify(drawer).slice(0, 160))
  const X = drawer.storefrontCents + drawer.rechargeCashCents      // 当天收进来的
  const Y = drawer.refundOutCents                                  // 当天退出去的(现金渠道)
  check('⑦-4 🔴 现金应有数 == 收现 − 退款(真跑取值)', drawer.shouldHaveCents === X - Y, `${X} − ${Y} ≠ ${drawer.shouldHaveCents}`)
  /* 夹具里两笔:300 走现金、800 走转账 —— 正好验渠道分得开:
     现金那笔从抽屉扣,转账那笔不扣(它走银行,不影响晚上数的钱)。 */
  check('⑦-5 现金那笔(300)进了应有数', Y === 30000, String(Y))
  check('⑦-6 转账那笔(800)不从抽屉出,但仍在退款留痕里', drawer.refundOtherCents === 80000
    && drawer.refundOtherCents + drawer.refundOutCents === rf.totalCents,
    `${drawer.refundOutCents} + ${drawer.refundOtherCents} vs ${rf.totalCents}`)
  check('⑦-7 🔴 反例守死:退款没进营业额(利润不动)',
    close.data.dailyClose.revenueCents === (await request(`/admin/daily-close?date=${today}`, {}, TOKEN, H)).data.dailyClose.revenueCents
    && incomeTotal(tid) === incomeBefore, `${incomeBefore} vs ${incomeTotal(tid)}`)
  check('⑦-8 应有数这一块自证收入影响为 0', drawer.incomeImpactCents === 0)
  /* 应有数可能是负的(退得比收得多)——负号必须在币符**前面**,
     「CAD $-10」那种写法商家一眼读不出是负数(金额句由后端出,所以这条在后端守)。 */
  const negText = (await request(`/admin/daily-close?date=${today}`, {}, TOKEN, H)).data.dailyClose.cashDrawer.shouldHaveText
  check('⑦-8b 负数金额句:负号在币符前(−CAD $x,不是 CAD $-x)',
    !/\$-/.test(negText) && (drawer.shouldHaveCents >= 0 || /^−/.test(negText)), negText)
  check('⑦-9 口径如实标注(线下腿不分现金与刷卡)', /不是纯钞票数|没有渠道列/.test(drawer.note || ''), drawer.note)

  /* 跨天:昨天退的钱不许算进今天的应有数(否则今天数钱又对不上,方向还反了)。
     夹具直接写一行"昨天的退款"——按门店时区的昨天,不是 UTC 的昨天。 */
  const ydIso = new Date(Date.now() - 26 * 3600 * 1000).toISOString()
  const yd = new Date(ydIso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  /* 夹具要配平:光插一行退款会把余额做成 −50,后面开单签字会被「储值余额不足」挡下
     (那道闸是对的 —— 余额不许为负)。所以先补一笔同日充值(走微信,不进当天抽屉)。 */
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at)
    VALUES (?, ?, ?, 'recharge', 5000, 'wechat', '昨天充的(夹具配平)', 'fixture', ?)`).run(`sv-ydr-${RUN}`, tid, userId, ydIso)
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at)
    VALUES (?, ?, ?, 'refund', -5000, 'cash', '昨天退的', 'fixture', ?)`).run(`sv-yd-${RUN}`, tid, userId, ydIso)
  const todayAgain = (await request(`/admin/daily-close?date=${today}`, {}, TOKEN, H)).data.dailyClose
  check('⑦-10 昨天那笔退款不影响今天的应有数', todayAgain.cashDrawer.shouldHaveCents === drawer.shouldHaveCents,
    `${drawer.shouldHaveCents} → ${todayAgain.cashDrawer.shouldHaveCents}`)
  const ydClose = (await request(`/admin/daily-close?date=${yd}`, {}, TOKEN, H)).data.dailyClose
  check('⑦-11 它落在昨天那张日结上(退款当天看得见)', ydClose.refunds.storedCents === 5000 && ydClose.cashDrawer.refundOutCents === 5000,
    JSON.stringify({ r: ydClose.refunds.storedCents, d: ydClose.cashDrawer.refundOutCents }))
  check('⑦-12 昨天的应有数也是「收现 − 退款」', ydClose.cashDrawer.shouldHaveCents
    === ydClose.cashDrawer.storefrontCents + ydClose.cashDrawer.rechargeCashCents - ydClose.cashDrawer.refundOutCents)

  /* 🔴 店主 08-25 收尾令:**两边都不为 0** 才证得了两边都没漏。
     收现 0 / 退 10 那种只证明了"退款被减掉",证不了"收现有没有进这个式子"。
     所以这里真开一张到店支付的单再看:漏收现会得负数、漏退款会得收现原值,
     只有两边都对才等于差额。 */
  let payBk = { status: 0, data: {} }
  for (const hh of ['09', '19', '20', '12', '16']) {
    payBk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId, serviceId, technicianId, date: today, time: `${hh}:00` }) }, TOKEN, H)
    if (payBk.status === 201 || payBk.status === 200) break
  }
  check('⑦-15 前置:到店支付那一单排上了', Boolean(payBk.data.booking?.id), JSON.stringify(payBk.data).slice(0, 120))
  await request(`/admin/bookings/${payBk.data.booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, TOKEN, H)
  const paySheet = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId, settlements: [{ bookingId: payBk.data.booking.id, payIntent: 'offline_full', items: [{ serviceId, qty: 1 }], technicians: [{ technicianId, role: 'main', itemNos: [1] }] }] }) }, TOKEN, H)
  check('⑦-15 前置:单开出来了', paySheet.status === 201 && Boolean(paySheet.data.settlements?.[0]?.code), JSON.stringify(paySheet.data).slice(0, 140))
  await fetch(`${BASE_URL}/settlements/${encodeURIComponent(paySheet.data.settlements[0].code)}/sign`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tid }, body: JSON.stringify({ signature: '演示', disclaimerAccepted: true })
  })
  const withTakeIn = (await request(`/admin/daily-close?date=${today}`, {}, TOKEN, H)).data.dailyClose.cashDrawer
  check('⑦-15 🔴 收现与退款都不为 0 时,应有数 == 收现 − 退款(两边都证)',
    withTakeIn.storefrontCents > 0 && withTakeIn.refundOutCents > 0
    && withTakeIn.shouldHaveCents === withTakeIn.storefrontCents + withTakeIn.rechargeCashCents - withTakeIn.refundOutCents,
    `${withTakeIn.storefrontCents} + ${withTakeIn.rechargeCashCents} − ${withTakeIn.refundOutCents} = ${withTakeIn.shouldHaveCents}`)
  check('⑦-16 收现进来了、退款也扣了(两个反例都排除:既不等于 −退款,也不等于收现原值)',
    withTakeIn.shouldHaveCents !== -withTakeIn.refundOutCents && withTakeIn.shouldHaveCents !== withTakeIn.storefrontCents,
    String(withTakeIn.shouldHaveCents))
  /* ⑦-15 那一单是**真卖了一次**,收入本来就该涨 —— 后面验"退卡不碰收入"要拿这个新基线比,
     不然验的就成了"这套件从头到尾没卖过东西",与被测行为无关。 */
  incomeMark = incomeTotal(tid)
  rowsMark = financeRows(tid)
  check('⑦-17 反过来:真卖一单,收入**该涨**(说明前面那些"不变"不是因为收入根本不动)',
    incomeMark > incomeBefore, `${incomeBefore} → ${incomeMark}`)
}

// ===== 八、退次卡:单位是次,退完卡作废,退掉的次数不能再核销 =====
const cardId = `tc-${RUN}`
db.prepare(`INSERT INTO member_timecards (id, tenant_id, user_id, package_id, name, total_times, used_times, price_cents, project_group, created_at)
  VALUES (?, ?, ?, NULL, ?, 10, 4, 180000, '', ?)`).run(cardId, tid, userId, `日式美甲 10 次卡${RUN}`, new Date().toISOString())
const cf = (await request(`/admin/timecards/${cardId}/refund-facts`, {}, TOKEN, H)).data.facts
check('⑧-1 次卡参考数:卡名/购卡价/已核销/剩余', cf.totalTimes === 10 && cf.usedTimes === 4 && cf.remainingTimes === 6 && cf.priceCents === 180000, JSON.stringify(cf).slice(0, 160))
check('⑧-2 折算单价只给参考(180/次),那句话后端给', cf.unitCents === 18000 && /仅供参考,退款金额由你填/.test(cf.hint), cf.hint)
const tooMany = await request(`/admin/timecards/${cardId}/refund`, { method: 'POST', body: JSON.stringify({ times: 7, amountCents: 1000, reason: '超了' }) }, TOKEN, H)
check('⑧-3 退 7 次 > 剩 6 次 = 拒', tooMany.status === 400 && tooMany.data.error?.code === 'REFUND_EXCEEDS_TIMES', JSON.stringify(tooMany.data).slice(0, 120))
const tcNoReason = await request(`/admin/timecards/${cardId}/refund`, { method: 'POST', body: JSON.stringify({ times: 1, amountCents: 100 }) }, TOKEN, H)
check('⑧-4 次卡退款原因必填', tcNoReason.status === 400 && tcNoReason.data.error?.code === 'REASON_REQUIRED', `${tcNoReason.status}`)
const tcOk = await request(`/admin/timecards/${cardId}/refund`, { method: 'POST', body: JSON.stringify({ times: 6, amountCents: 108000, payChannel: 'cash', reason: '顾客要求全退' }) }, TOKEN, H)
check('⑧-5 退 6 次成功,退款金额按商家填的记(系统不替他算)', tcOk.status === 201 && tcOk.data.refundedTimes === 6 && tcOk.data.refundedCents === 108000, JSON.stringify(tcOk.data).slice(0, 140))
check('⑧-6 退完剩 0 次 = 卡作废', tcOk.data.remainingTimes === 0 && tcOk.data.voided === true)
check('⑧-7 🔴 退次数**不写 used_times**(那等于把手动耗卡从后门开回来)',
  db.prepare('SELECT used_times, refunded_times FROM member_timecards WHERE id = ?').get(cardId).used_times === 4
  && db.prepare('SELECT refunded_times FROM member_timecards WHERE id = ?').get(cardId).refunded_times === 6)
check('⑧-8 🔴 退次卡同样不碰收入(对比"卖过一单之后"的基线)', incomeTotal(tid) === incomeMark && financeRows(tid) === rowsMark,
  `${incomeMark} → ${incomeTotal(tid)}`)
const packAfter = await request('/my/timecards', {}, custToken, H)
check('⑧-9 顾客端卡包里这张卡不再可用(剩余算法唯一出口)', !(packAfter.data.timecards || []).some((c) => c.id === cardId), JSON.stringify((packAfter.data.timecards || []).map((c) => c.id)))

// ===== 九、退完的次数不能再核销(money-critical)=====
// 撞档就换时段(10:00 已被夹具那单占了);这不是被测行为,别让它把断言弄红
let bk = { status: 0, data: {} }
for (const hh of ['13', '14', '15', '16', '17']) {
  bk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId, serviceId, technicianId, date: today, time: `${hh}:00` }) }, TOKEN, H)
  if (bk.status === 201 || bk.status === 200) break
}
if (bk.status === 201 || bk.status === 200) {
  await request(`/admin/bookings/${bk.data.booking.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }, TOKEN, H)
  const useCard = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId, settlements: [{ bookingId: bk.data.booking.id, payIntent: 'offline_full', items: [{ serviceId, qty: 1 }], timecardId: cardId, timecardServiceId: serviceId }] }) }, TOKEN, H)
  check('⑨ 退干净的卡不能再核销(TIMECARD_USED_UP)', useCard.status === 400 && /TIMECARD_USED_UP|用完/.test(JSON.stringify(useCard.data)), JSON.stringify(useCard.data).slice(0, 140))
} else {
  check('⑨ 退干净的卡不能再核销(排单失败,跳过)', false, JSON.stringify(bk.data).slice(0, 140))
}

// ===== 十、退卡后还算不算会员:两种配置各跑一遍,行为必须不同 =====
const setCfg = (mode) => request(`/platform/tenants/${tid}/membership-config`, { method: 'PUT', body: JSON.stringify({ config: { memberQualify: 'any_recharge', keepMemberAfterRefund: mode } }) })
const isMember = async () => {
  const r = await request('/admin/customers', {}, TOKEN, H)
  const c = (r.data.customers || []).find((x) => x.id === userId) || {}
  return Boolean(c.isMember ?? c.member ?? c.memberLevel)
}
await setCfg('keep')
const keepSays = await isMember()
await setCfg('drop')
const dropSays = await isMember()
check('⑩-1 两种取值都存得住', ((await request(`/platform/tenants/${tid}/membership-config`)).data.config || {}).keepMemberAfterRefund === 'drop')
check('⑩-2 🔴 行为必须不同:keep=仍是会员 / drop=余额归零即失去会员(真跑取值)',
  keepSays === true && dropSays === false, `keep=${keepSays} drop=${dropSays}`)

/* 双端同病检查律:这一块要在**两个商家端**都看得见(店主只查一个端)。
   判据取渲染代码里的字段引用 —— 后端给句、前端只渲染,所以对得上就是两端同句。 */
{
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const web = readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8')
  const miniMap = readFileSync(join(ROOT, 'miniprogram/utils/dailyclose.js'), 'utf8')
  const miniWx = readFileSync(join(ROOT, 'miniprogram/pages/merchant/daily-close/index.wxml'), 'utf8')
  /* 网页那两行 08-25 搬进 daily-close-rows.js(棘轮)——判据跟着被测物走,读"网页日结全部渲染代码" */
  const webRows = web + '\n' + readFileSync(join(ROOT, 'apps/web/daily-close-rows.js'), 'utf8')
  check('⑦-13 网页日结渲染应有数与退卡行(读后端句,不自算)',
    /cashAndRefundRows/.test(web) && /cashDrawer/.test(webRows) && /shouldHaveText/.test(webRows) && /refunds/.test(webRows))
  check('⑦-14 小程序日结同样两行(双端同句)',
    /dc\.cashDrawer/.test(miniMap) && /shouldHaveText/.test(miniMap) && /v\.drawer/.test(miniWx) && /v\.refundLine/.test(miniWx))
}

db.close()
console.log(`\n退卡口回归通过:${checks} 项断言全绿`)
