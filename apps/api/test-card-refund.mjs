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
  /* 夹具也要带两个分量 —— 它模拟的是一笔真退款;不带就等于夹具自己绕过了拆账,
     全表恒等式那条会当场把它抓出来(08-26 实测抓到过,改在这儿而不是给夹具开例外)。 */
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, paid_part_cents, bonus_part_cents)
    VALUES (?, ?, ?, 'refund', -5000, 'cash', '昨天退的', 'fixture', ?, 5000, 0)`).run(`sv-yd-${RUN}`, tid, userId, ydIso)
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

/* 🔴 店主 08-27 追加:上面那条 ⑨ 要先排得上单才跑得起来,排不上就红在"排单"上,不是红在核销上。
   她要的是**直接打核销接口**这一刀(第 8 步下半不用等小程序):
   开单不带 bookingId(裁B:引擎自动建即时预约),核销口是同一个 `createSettlementGroup`,
   所以这条走的正是小程序那条路,只是绕开了排班。
   ⑨-c 是**反向守**:光有"一律拒"也能让 ⑨/⑨-b 全绿 —— 必须证明没退干净的卡照样核销得动,
   而且剩余次数真的从 4 掉到 3。 */
{
  const mk = (used, total, price) => {
    const id = `tc-${RUN}-${Math.random().toString(36).slice(2, 8)}`
    db.prepare(`INSERT INTO member_timecards (id, tenant_id, user_id, package_id, name, total_times, used_times, price_cents, project_group, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?, '', ?)`).run(id, tid, userId, `直打核销卡${RUN}`, total, used, price, new Date().toISOString())
    return id
  }
  const deadCard = mk(2, 10, 200000)
  const rDead = await request(`/admin/timecards/${deadCard}/refund`, { method: 'POST', body: JSON.stringify({ times: 8, amountCents: 160000, payChannel: 'cash', reason: '全退' }) }, TOKEN, H)
  const direct = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId, settlements: [{ payIntent: 'offline_full', items: [{ serviceId, qty: 1 }], timecardId: deadCard, timecardServiceId: serviceId }] }) }, TOKEN, H)
  check('⑨-b 🔴 直接打核销接口 + 一张退干净的次卡 = 拒(不经排班,走的是小程序同一条口)',
    (rDead.status === 201 || rDead.status === 200) && direct.status === 400 && /TIMECARD_USED_UP/.test(JSON.stringify(direct.data)),
    `退卡 ${rDead.status} · 核销 ${direct.status} ${JSON.stringify(direct.data).slice(0, 100)}`)
  check('⑨-b2 退干净的卡在"可核销卡"列表里也不出现(选卡那一层就没得选)',
    !((await request(`/admin/customers/${userId}/timecards`, {}, TOKEN, H)).data.timecards || []).some((c) => c.id === deadCard && (c.remainingTimes ?? 1) > 0))
  const liveCard = mk(2, 10, 200000)
  await request(`/admin/timecards/${liveCard}/refund`, { method: 'POST', body: JSON.stringify({ times: 4, amountCents: 80000, payChannel: 'cash', reason: '退一半' }) }, TOKEN, H)
  const beforeUsed = db.prepare('SELECT used_times FROM member_timecards WHERE id = ?').get(liveCard).used_times
  const okUse = await request('/admin/settlements', { method: 'POST', body: JSON.stringify({ userId, settlements: [{ payIntent: 'offline_full', items: [{ serviceId, qty: 1 }], timecardId: liveCard, timecardServiceId: serviceId, technicians: [{ technicianId, role: 'main', itemNos: [1] }] }] }) }, TOKEN, H)
  /* 扣卡在**签字那一刻**才发生(规则⑥:手动耗卡已废,只随签字入账),
     所以反向守要签完再数 —— 只看"开单成功"证不到"次数真的少了一次"。 */
  const liveCode = okUse.data?.settlements?.[0]?.code
  if (liveCode) {
    await fetch(`${BASE_URL}/settlements/${encodeURIComponent(liveCode)}/sign`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tid }, body: JSON.stringify({ signature: '演示', disclaimerAccepted: true })
    })
  }
  const afterUsed = db.prepare('SELECT used_times FROM member_timecards WHERE id = ?').get(liveCard).used_times
  check('⑨-c 反向守:退了一半的卡照样核销得动,签完剩余真的少一次(不是"一律拒"混过去的绿)',
    (okUse.status === 201 || okUse.status === 200) && afterUsed === beforeUsed + 1,
    `${okUse.status} · used ${beforeUsed}→${afterUsed} · code ${liveCode || '无'}`)
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
  /* v1.2 ②:小程序也改成收据式(抬头句 + 大数 + 算式 + 脚注),判据跟着被测物走 —— 
     原来那条断的是旧的「两行 pill」写法,重画之后必然假红。 */
  check('⑦-14 小程序日结同样是收据式(双端同句,句子都来自后端)',
    /dc\.cashDrawer/.test(miniMap) && /shouldHaveText/.test(miniMap) && /footnote/.test(miniMap)
    && /v\.drawer\.title/.test(miniWx) && /v\.drawer\.rows/.test(miniWx) && /v\.headline/.test(miniWx))
}

/* ═══ 图 v1.1(店主 2026-08-26 补三条)+ 十条常驻硬拦 ═══ */

// ── ① 赠送金:屏上画界限 + 拆两个分量入账(先冲赠送、后冲实付)
{
  const bId = `n5b-${RUN}`
  await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: bId, name: `赠送拆账店${RUN}`, plan: 'chain' }) })
  /* 🔴 复发护栏(08-26 沙箱真点撞出来的那一课):测试库建的租户 kind='test',
     **账本只追加那十二条触发器对它豁免** —— 于是"先 INSERT 再 UPDATE"这种写法在套件里绿、
     在真店上被打回(stored value ledger is append-only)。
     这家店的 kind 拨成 'real',让触发器真的压在头上,以后再有人写 UPDATE 就当场红。 */
  db.prepare("UPDATE tenants SET kind = 'real' WHERE id = ?").run(bId)
  const BH = { 'x-admin-tenant-id': bId, 'x-tenant-id': bId }
  const bTech = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `技师${RUN}`, isActive: true }) }, TOKEN, BH)).data.technician.id
  const bCat = ((await request('/admin/pricing/categories', {}, TOKEN, BH)).data.categories || [])[0]?.id
  const bSvc = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `项目${RUN}`, nameEn: 'x', priceCents: 18000, baseDurationMin: 60, categoryId: bCat }) }, TOKEN, BH)).data.service.id
  const bBk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `赠送顾客${RUN}`, serviceId: bSvc, technicianId: bTech, date: today, time: '10:00' }) }, TOKEN, BH)
  const bUser = bBk.data.booking.user.id
  db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`n5b-openid-${RUN}`, bUser)
  // 充 1000 送 100(图 v1.1 举的就是这个例子)
  await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 100000, bonusCents: 10000, payChannel: 'cash' }) }, TOKEN, BH)

  const bf = (await request(`/admin/account-adjust/facts?userId=${bUser}`, {}, TOKEN, BH)).data.facts
  check('v1.1①-1 屏上那行:其中 顾客实付可退 X · 本店赠送 Y(后端出句)',
    /其中 顾客实付可退 .* · 本店赠送 /.test(bf.splitText || '') && bf.paidRefundableCents === 100000 && bf.bonusRemainingCents === 10000,
    JSON.stringify({ t: bf.splitText, p: bf.paidRefundableCents, b: bf.bonusRemainingCents }))
  const noWarn = (await request(`/admin/account-adjust/facts?userId=${bUser}&amountCents=100000`, {}, TOKEN, BH)).data.bonusWarning
  const warn = (await request(`/admin/account-adjust/facts?userId=${bUser}&amountCents=110000`, {}, TOKEN, BH)).data.bonusWarning
  check('v1.1①-2 没越过实付可退 → 不出黄条', !noWarn, String(noWarn))
  check('v1.1①-3 越过了 → 出黄条且点名金额(只提醒,不拦)',
    /你正在退出赠送部分/.test(warn) && /本店让利,退出去是真金/.test(warn), warn)

  // 退 150:先冲赠送(100)、后冲实付(50)——图 v1.1 的原样例子
  const r150 = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 15000, payChannel: 'cash', reason: '拆账验证' }) }, TOKEN, BH)
  /* 🔴 v1.2(店主 08-27 走查第 6 步当场撞出):方向是**先冲实付、后冲赠送**。
     v1.1 反了,她看到的是「实付可退 $950 · 本店赠送 $0」——赠送凭空没了。 */
  check('v1.2①-4 🔴 拆账:退 150 → paid_part 150 / bonus_part 0(先冲实付后冲赠送)',
    r150.status === 201 && r150.data.paidPartCents === 15000 && r150.data.bonusPartCents === 0,
    JSON.stringify({ p: r150.data.paidPartCents, b: r150.data.bonusPartCents }))
  check('v1.1①-5 🔴 恒等式 paid_part + bonus_part ≡ 退款金额',
    r150.data.bonusPartCents + r150.data.paidPartCents === r150.data.refundedCents,
    `${r150.data.bonusPartCents} + ${r150.data.paidPartCents} vs ${r150.data.refundedCents}`)
  const row150 = db.prepare("SELECT paid_part_cents p, bonus_part_cents b, amount_cents a FROM stored_value_transactions WHERE tenant_id = ? AND type = 'refund'").get(bId)
  check('v1.1①-6 两个分量真落进库里,且与流水金额恒等', row150.p + row150.b === Math.abs(row150.a), JSON.stringify(row150))
  check('v1.1①-6b 🔴 这一切是在**真店口径**(kind=real,账本触发器压着)下写成的 —— 一次 INSERT 写全,没有事后 UPDATE',
    db.prepare('SELECT kind FROM tenants WHERE id = ?').get(bId).kind === 'real' && r150.status === 201,
    db.prepare('SELECT kind FROM tenants WHERE id = ?').get(bId).kind)
  const bf2 = (await request(`/admin/account-adjust/facts?userId=${bUser}`, {}, TOKEN, BH)).data.facts
  /* 🔴 v1.2:退 150 之后,屏上该是「实付可退 850 · 本店赠送 100」——
     赠送**一分没动**(店主走查那一屏看到的 950/0 就是方向反了的样子)。 */
  check('v1.2①-7 退 150 之后:实付可退 850 · 本店赠送 100(赠送一分没动)',
    bf2.paidRefundableCents === 85000 && bf2.bonusRemainingCents === 10000,
    `实付可退 ${bf2.paidRefundableCents} · 赠送 ${bf2.bonusRemainingCents} · 屏上句:${bf2.splitText}`)

  // ── ⑥ 幂等:按请求单号判,不按「余额还剩多少」判
  const rid = `req-${RUN}`
  const first = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 5000, payChannel: 'cash', reason: '幂等验证', requestId: rid }) }, TOKEN, BH)
  const again = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 5000, payChannel: 'cash', reason: '幂等验证', requestId: rid }) }, TOKEN, BH)
  const cnt = db.prepare("SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id = ? AND type = 'refund' AND request_id = ?").get(bId, rid).n
  check('⑥ 幂等:同一请求单号重复提交只写一笔(不是靠"余额已经是 0"判)',
    first.status === 201 && again.data.duplicate === true && cnt === 1, JSON.stringify({ f: first.status, dup: again.data.duplicate, cnt }))

  // ── ⑦ 金额:负数 / 0 / 非数字 / 超两位小数
  const bad = {}
  for (const [k, body] of Object.entries({
    负数: { amountCents: -100 }, 零: { amountCents: 0 },
    非数字: { amountCents: 'abc' }, 超两位小数: { amount: 12.345 }
  })) {
    const r = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, reason: '异常输入', ...body }) }, TOKEN, BH)
    bad[k] = r.status
  }
  check('⑦ 金额 负数/0/非数字/超两位小数 一律拒', Object.values(bad).every((x) => x === 400), JSON.stringify(bad))

  // ── ⑧ 跨店隔离:拿 A 店的顾客 id 去 B 店退
  const cross = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 100, reason: '跨店试探' }) }, TOKEN, BH)
  const crossBack = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 100, reason: '跨店试探' }) }, TOKEN, H)
  check('⑧ 跨店隔离:A 店顾客在 B 店退不了,反向也退不了(各 404)',
    cross.status === 404 && crossBack.status === 404, `${cross.status}/${crossBack.status}`)

  // ── v1.1 ②:两向都守 —— 现金退减、转账退不减
  const beforeDrawer = (await request(`/admin/daily-close?date=${today}`, {}, TOKEN, BH)).data.dailyClose.cashDrawer
  await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 1000, payChannel: 'transfer', reason: '转账退' }) }, TOKEN, BH)
  const afterTransfer = (await request(`/admin/daily-close?date=${today}`, {}, TOKEN, BH)).data.dailyClose.cashDrawer
  check('v1.1②-1 🔴 转账退:日结现金一分不动(方向反了就是抽屉又对不上)',
    afterTransfer.refundOutCents === beforeDrawer.refundOutCents && afterTransfer.shouldHaveCents === beforeDrawer.shouldHaveCents,
    `${beforeDrawer.shouldHaveCents} → ${afterTransfer.shouldHaveCents}`)
  await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 1000, payChannel: 'cash', reason: '现金退' }) }, TOKEN, BH)
  const afterCash = (await request(`/admin/daily-close?date=${today}`, {}, TOKEN, BH)).data.dailyClose.cashDrawer
  check('v1.1②-2 🔴 现金退:日结现金**减**同一笔金额',
    afterCash.refundOutCents === afterTransfer.refundOutCents + 1000
    && afterCash.shouldHaveCents === afterTransfer.shouldHaveCents - 1000,
    `${afterTransfer.shouldHaveCents} → ${afterCash.shouldHaveCents}`)
  check('v1.1②-3 转账那笔仍在留痕里(负债照减、留痕照留,只是不出抽屉)',
    afterCash.refundOtherCents > 0, String(afterCash.refundOtherCents))

  // ── v1.1 ③:权限 —— 财务门 + 仅老板
  await request(`/admin/finance/password`, { method: 'POST', body: JSON.stringify({ password: 'Fin-2026-n5' }) }, TOKEN, BH).catch(() => ({}))
  db.prepare('UPDATE tenants SET finance_lock_enabled = 1 WHERE id = ?').run(bId)
  const locked = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 100, reason: '锁着退' }) }, TOKEN, BH)
  check('v1.1③-1 🔴 财务门开着、没带钥匙 → 403 FINANCE_LOCKED(走已有那道门)',
    locked.status === 403 && /FINANCE_LOCKED/.test(JSON.stringify(locked.data)), JSON.stringify(locked.data).slice(0, 120))
  const key = (await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: TOKEN }) }, TOKEN, BH)).data.financeKey
  const unlocked = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 100, reason: '带钥匙退' }) }, TOKEN, { ...BH, 'x-finance-key': key })
  check('v1.1③-2 带上财务钥匙就能退(门是同一道,不是新造的)', unlocked.status === 201, JSON.stringify(unlocked.data).slice(0, 120))
  db.prepare('UPDATE tenants SET finance_lock_enabled = 0 WHERE id = ?').run(bId)

  const { readFileSync: rf2 } = await import('node:fs')
  const { join: j2, dirname: d2 } = await import('node:path')
  const { fileURLToPath: f2 } = await import('node:url')
  const ROOT2 = j2(d2(f2(import.meta.url)), '../..')
  const adminSrc = rf2(j2(ROOT2, 'apps/web/admin.js'), 'utf8')
  /* 接口层也得拦死 —— 前端不渲染是体验,后端 403 才是闸(员工绕过界面直接打接口的场合)。 */
  const acct = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: bTech }) }, TOKEN, BH)
  if (acct.status === 201) {
    const login = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.data.username, password: acct.data.initialPassword }) }, null, BH)
    const staffToken = login.data.auth?.accessToken
    const staffTry = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: bUser, amountCents: 100, reason: '员工试探' }) }, staffToken, BH)
    const staffFacts = await request(`/admin/account-adjust/facts?userId=${bUser}`, {}, staffToken, BH)
    check('v1.1③-3 🔴 员工账号打退卡接口 = 403(界面不渲染是体验,这里才是闸)',
      staffTry.status === 403 && staffFacts.status === 403, `${staffTry.status}/${staffFacts.status}`)
  } else {
    check('v1.1③-3 🔴 员工账号打退卡接口 = 403', false, `建员工号失败 ${JSON.stringify(acct.data).slice(0, 120)}`)
  }
  check('v1.1③-4 员工端**连按钮都不渲染**(不是点了报错)',
    /owner\.role === 'owner' \? `<button class="ghost slim" data-account-adjust/.test(adminSrc), '入口没有按角色渲染')
}

/* 🔴 缓存失效(店主 2026-08-27 第三轮:两次"功能没生效"其实都是浏览器在跑旧 JS)。
   立的律是**运行时取证律·前端条**:断言要跑在"店主实际会加载到的那份资源"上。
   所以这里判的不是源文件,是 /admin 这一页**真发出来的 HTML**:
     ① 资源 URL 必须带内容指纹;② 改一个字节 → URL 与页面版本串都必须变。 */
{
  const { readFileSync: rfp, writeFileSync: wfp } = await import('node:fs')
  const { join: jp, dirname: dp } = await import('node:path')
  const { fileURLToPath: fp } = await import('node:url')
  const ROOTF = jp(dp(fp(import.meta.url)), '../..')
  const probeFile = jp(ROOTF, 'apps/web/money-input.js')
  const grab = async () => {
    const html = await (await fetch(`${BASE_URL}/admin`)).text()
    return {
      asset: (html.match(/\/web\/money-input\.js\?v=([a-f0-9]+)/) || [])[1] || '',
      build: (html.match(/LL_BUILD="([a-f0-9]+)"/) || [])[1] || ''
    }
  }
  const before = await grab()
  check('缓存①-1 前端资源 URL 带内容指纹(不是手写版本号)', /^[a-f0-9]{10}$/.test(before.asset), before.asset)
  check('缓存①-2 页面版本串由服务端按内容算(window.LL_BUILD 在)', /^[a-f0-9]{8}$/.test(before.build), before.build)
  const original = rfp(probeFile, 'utf8')
  try {
    wfp(probeFile, `${original}\n// 指纹断言临时改一行\n`)
    const after = await grab()
    check('缓存①-3 🔴 内容变一个字节 → 资源 URL 必须不同(旧缓存不可能命中)',
      after.asset && after.asset !== before.asset, `${before.asset} → ${after.asset}`)
    check('缓存①-4 🔴 内容变一个字节 → 页面上的版本串也必须不同(店主看得出自己在哪一版)',
      after.build && after.build !== before.build, `${before.build} → ${after.build}`)
  } finally {
    wfp(probeFile, original)
  }
  const restored = await grab()
  check('缓存①-5 改回去之后指纹回到原值(它只跟内容走,不跟时间走)',
    restored.asset === before.asset && restored.build === before.build, `${restored.asset} vs ${before.asset}`)
}

/* ═══ v1.2(店主 2026-08-27 走查回执四件)═══ */

// ② 日结应有数:算式三项之和 ≡ 大数;转账那笔**不进算式**
{
  const dc = (await request(`/admin/daily-close?date=${today}`, {}, TOKEN, H)).data.dailyClose
  const d = dc.cashDrawer
  check('v1.2②-1 卡片三件套齐:抬头句 / 大数 / 算式行(全部后端给)',
    d.title === '今晚数钱按这个数' && Boolean(d.shouldHaveText) && Array.isArray(d.rows) && d.rows.length === 3,
    JSON.stringify({ t: d.title, rows: (d.rows || []).map((r) => r.label) }))
  const sum = d.rows.reduce((n, r) => n + (r.sign === '−' ? -r.amountCents : r.amountCents), 0)
  check('v1.2②-2 🔴 算式三项之和 ≡ 大数', sum === d.shouldHaveCents, `${sum} vs ${d.shouldHaveCents}`)
  check('v1.2②-3 🔴 转账那笔不在算式里(它没经过抽屉,只在脚注)',
    d.refundOtherCents > 0 && !d.rows.some((r) => r.amountCents === d.refundOtherCents) && /转账/.test(d.footnote || ''),
    `other=${d.refundOtherCents} footnote=${d.footnote}`)
  check('v1.2②-4 三小格:退卡单独一格,不混进营业额',
    Array.isArray(dc.headline) && dc.headline.length === 3 && /退卡合计/.test(dc.headline[2].label)
    && dc.headline[1].label === '营业额', JSON.stringify((dc.headline || []).map((h) => h.label)))
}

// ③ 钱的输入框:全仓不许再有 type=number(那对箭头就是从它来的);敲的过程中不重画
{
  const { readFileSync: rf3 } = await import('node:fs')
  const { join: j4, dirname: d4 } = await import('node:path')
  const { fileURLToPath: f4 } = await import('node:url')
  const ROOT3 = j4(d4(f4(import.meta.url)), '../..')
  /* 🔴 扫描面第四案(2026-08-29):这里原来手写三个文件名 —— 注释都写着「判据跟着被测物走」,
     写法却还是靠列举。08-29 finAmount 搬进 finance-entry-form.js,当场又漏(J3 同族:退卡路由搬家、
     snapshot 扫 4 个文件、门店信息三件)。同刀改:**扫描面 = admin.html 真正加载的那组 /web/*.js**
     + admin.js 本体,搬进哪个模块都跑不出这张网;附文件数下限,缩水立刻红。 */
  const adminHtmlSrc = rf3(j4(ROOT3, 'apps/web/admin.html'), 'utf8')
  const webFiles = ['apps/web/admin.js',
    ...[...adminHtmlSrc.matchAll(/<script src="\/web\/([\w.-]+\.js)/g)].map((m) => `apps/web/${m[1]}`)]
  if (webFiles.length < 10) throw new Error(`扫描面缩水:admin.html 只挂了 ${webFiles.length} 个脚本`)
  const web = webFiles.map((f) => rf3(j4(ROOT3, f), 'utf8')).join('\n')
  const moneyIds = ['aaAmount', 'aaCardAmount', 'finAmount', 'finRuleAmount', 'mSvAmount', 'mSvBonus', 'cpnGrantAmount', 'dcNewTotal',
    'kbFactDeposit', 'goalMonth', 'goalYear', 'finTargetMonth', 'finTargetYear', 'spBase', 'spHandwork', 'spOtRate']
  const stillNumber = moneyIds.filter((id) => new RegExp(`id="${id}"[^>]*type="number"`).test(web))
  check(`v1.2③-1 🔴 ${moneyIds.length} 个钱的输入框都不再是 type=number(去掉那对上下箭头)`,
    stillNumber.length === 0, stillNumber.join(' | '))
  /* 🔴 判据律现场:上面那条只验**我列出来的**那几个 —— 它叫"所有"却证不了"所有",
     漏掉的字段在缺陷存在时照样绿(08-27 全仓一数:定金/月目标/年目标/底薪/手工费/加班费率/阶梯起止
     共 10 个钱的框还挂着 spinner,而那条断言当时是绿的)。
     改成**反过来数**:把网页端所有 type=number 的框抠出来,逐个必须落在下面这份
     「不是钱」的白名单里(百分比 / 每月几号 / 排序 / 时长)。以后谁再拿 type=number 加一个钱的框,
     它不在白名单里 → 立刻红。这条才配叫"所有"。 */
  const NON_MONEY = ['goalRate', 'finTargetRate', 'spFlatPct', 'spFirstPct', 'spRenewPct', 'finRuleDay']
  const numberInputs = [...web.matchAll(/<input([^>]*type="number"[^>]*)>/g)].map((m) => m[1])
  const suspects = numberInputs.filter((attrs) => {
    const id = (/id="([^"]+)"/.exec(attrs) || [])[1] || ''
    const isPct = /data-f="pct"|max="100"|placeholder="%"/.test(attrs)
    const isSort = /class="pricing-sort"/.test(attrs)
    return !NON_MONEY.includes(id) && !isPct && !isSort
  })
  check(`v1.2③-1b 🔴 反过来数:全网页端 ${numberInputs.length} 个 type=number 全是"不是钱"的(百分比/几号/排序)`,
    suspects.length === 0 && numberInputs.length >= 5, suspects.join(' | ').slice(0, 300))
  const noInputmode = moneyIds.filter((id) => !new RegExp(`id="${id}"[^>]*inputmode="decimal"`).test(web)
    && !new RegExp(`MoneyInput\\.field\\(\\{ id: '${id}'`).test(web))
  check('v1.2③-2 都带 inputmode="decimal"(手机上照样弹数字键盘)', noInputmode.length === 0, noInputmode.join(' | '))
  const panel = rf3(j4(ROOT3, 'apps/web/account-adjust.js'), 'utf8')
  check('v1.2③-3 🔴 敲的过程中不重画:input 事件里只 patch 那几行,没有 mount()',
    /if \(e\.target\.id === 'aaAmount'\)[\s\S]{0,400}?patchCalc\(\)/.test(panel)
    && !/e\.target\.id === 'aaAmount'[\s\S]{0,200}?mount\(\)/.test(panel))
  const mi = rf3(j4(ROOT3, 'apps/web/money-input.js'), 'utf8')
  check('v1.2③-4 归一只在 blur 做(敲的时候不补零、不重排)',
    /addEventListener\('blur'/.test(mi) && /normalize/.test(mi))
  /* 🔴 08-27 实测教训:改输入框那一刀把 handleClick **连带删掉了**,而 return 里还引着它 ——
     模块整个初始化失败、window.AccountAdjust 是 undefined、点按钮毫无反应,
     **而所有代码行断言照样绿**。所以补这一条:把两个前端模块真装一遍,看导出齐不齐。 */
  const loadWebModule = (file, expect) => {
    const src = rf3(j4(ROOT3, file), 'utf8')
    const win = { document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ classList: { add() {} } }) } }
    try {
      new Function('window', 'document', src)(win, win.document)
    } catch (e) { return `装不起来:${e.message}` }
    const got = Object.keys(win[expect.name] || {})
    return expect.keys.every((k) => got.includes(k)) ? '' : `导出缺:${expect.keys.filter((k) => !got.includes(k)).join(',')}`
  }
  const modFail = [
    loadWebModule('apps/web/account-adjust.js', { name: 'AccountAdjust', keys: ['open', 'close', 'handleClick'] }),
    loadWebModule('apps/web/money-input.js', { name: 'MoneyInput', keys: ['field', 'normalize', 'centsOf'] }),
    loadWebModule('apps/web/my-customers.js', { name: 'MyCustomers', keys: ['render', 'open'] }),
    loadWebModule('apps/web/daily-close-rows.js', { name: 'DailyCloseRows', keys: ['cashAndRefundRows', 'correctionForm', 'targetCellText'] })
  ].filter(Boolean)
  check('v1.2③-5 🔴 四个前端模块真装得起来、导出齐(点不动那种病,代码行断言看不出来)',
    modFail.length === 0, modFail.join(' | '))
  check('v1.2③-6 侧栏那几个 els 引用真存在(`els.x?.` 拿不到元素时会静默什么也不做)',
    /sidebarMembership: document\.querySelector/.test(web) && /sidebarMyCustomers: document\.querySelector/.test(web))
}

// ④ 店员端:会员套餐/券不出现;我的客人只读且只列自己的客人
{
  const acct2 = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId }) }, TOKEN, H)
  if (acct2.status === 201) {
    const lg = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct2.data.username, password: acct2.data.initialPassword }) }, null, H)
    const stf = lg.data.auth?.accessToken
    const pkgs = await request('/admin/packages', {}, stf, H)
    check('v1.2④-1 会员套餐/券对员工仍是 403(菜单也不再渲染它)', pkgs.status === 403, String(pkgs.status))
    check('v1.2④-2 🔴 报错话是中文(产品其余都是中文,不该只有报错蹦英文)',
      /[一-龥]/.test(pkgs.data?.error?.message || ''), pkgs.data?.error?.message)
    const mine = await request('/admin/my-customers', {}, stf, H)
    check('v1.2④-3 员工有「我的客人」且是只读', mine.status === 200 && mine.data.readOnly === true, String(mine.status))
    /* 判据要挑**真不是他的**那个人:本店那位顾客恰恰是他服务的(所以 200 才对)。
       挑一个他从没服务过的:现建一位、只由别的技师服务。 */
    const otherTech = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `别的技师${RUN}`, isActive: true }) }, TOKEN, H)).data.technician.id
    let otherUser = ''
    for (const hh of ['08', '18', '20', '21']) {
      const bk2 = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `别人的客人${RUN}`, serviceId, technicianId: otherTech, date: today, time: `${hh}:00` }) }, TOKEN, H)
      if (bk2.data?.booking?.user?.id) { otherUser = bk2.data.booking.user.id; break }
    }
    const mineOne = await request(`/admin/my-customers/${userId}`, {}, stf, H)
    check('v1.2④-4a 自己服务过的客人:看得到(只读)', mineOne.status === 200 && mineOne.data.readOnly === true, String(mineOne.status))
    const others = await request(`/admin/my-customers/${otherUser}`, {}, stf, H)
    check('v1.2④-4b 🔴 别人的客人 = 404(那个人对他不该存在)', others.status === 404, `${others.status} · ${otherUser}`)
    const web2 = (await import('node:fs')).readFileSync((await import('node:path')).join((await import('node:path')).dirname((await import('node:url')).fileURLToPath(import.meta.url)), '../../apps/web/admin.js'), 'utf8')
    check('v1.2④-5 菜单按角色渲染:会员套餐/券对员工隐藏、我的客人只给员工',
      /sidebarMembership\?\.classList\.toggle\('hidden', !isOwnerRole\(\)\)/.test(web2)
      && /sidebarMyCustomers\?\.classList\.toggle\('hidden', isOwnerRole\(\)\)/.test(web2))
    check('v1.2④-6 「我的客人」页零金额编辑口(不出现账户调整/充值按钮)',
      /renderMyCustomers/.test(web2) && !/renderMyCustomers[\s\S]{0,1500}?data-account-adjust/.test(web2)
      && !/renderMyCustomers[\s\S]{0,1500}?data-customer-recharge/.test(web2))

    /* 🔴 店主 08-27 追加:「我的客人」要**点得开** —— 技师看基本信息/到店记录/服务历史/偏好,
       能写服务小记与备注;碰不到余额·充值·赠送·退卡·冲销·会员等级。
       她给的判据是**两向**的,两向都得有,单向那半条会自己骗自己:
         负向 = 钱的按钮数 0;正向 = 写小记接口 200。
       负向单独立着会被"整页什么都没有"蒙混过去(那也是 0),所以每条负向都配一个反向守:
       按钮总数 ≥ 2、服务历史 ≥ 1 —— 先证明"这页真有东西",再说"里头没有钱"。 */
    const det = await request(`/admin/my-customers/${userId}`, {}, stf, H)
    check('④-7 点开一位客人:真有料(服务历史 + 可写小记)',
      det.status === 200 && (det.data.bookings || []).length >= 1 && det.data.canWriteNote === true,
      `${det.status} · 历史 ${(det.data.bookings || []).length} 条`)
    /* 🔴 08-27 实拍抓到的两处(截图在交付文档里):服务历史那行直接渲染了裸 `COMPLETED`,
       小记时间戳是裸 ISO 的 UTC 时刻(多伦多下午 4 点显示成 08:59)。
       两处都是"前端拿字段自己拼"的老毛病 —— 收成后端出句:状态走全仓唯一出口 bookingStatusText,
       时间走门店时区。判据不看代码看**下发的值**:状态必须是中文、时间必须是门店当天。 */
    check('④-7c 🔴 状态词是中文、由后端出句(不许把 COMPLETED 直接甩给店员看)',
      (det.data.bookings || []).every((b) => /^[一-龥]+$/.test(String(b.statusText || ''))
        && !/[A-Z_]{3,}/.test(String(b.statusText || ''))),
      JSON.stringify((det.data.bookings || []).map((b) => b.statusText)))
    const storeToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
    check('④-7d 🔴 时间按门店时区出句(裸 ISO 会把多伦多的下午显示成 UTC 的晚上)',
      (det.data.bookings || []).every((b) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(b.atText || '')))
      && (det.data.bookings || []).some((b) => String(b.atText || '').startsWith(storeToday)),
      JSON.stringify((det.data.bookings || []).map((b) => b.atText)))
    check('④-7b 服务历史带项目名(技师要看的是"上次给她做了什么")',
      (det.data.bookings || []).some((b) => String(b.serviceName || '').length > 0),
      JSON.stringify((det.data.bookings || []).map((b) => b.serviceName)).slice(0, 120))
    /* 负向:**按键名**扫,不扫文本 —— 那句「余额、充值、退卡这些是老板的口」本身就带这些字,
       扫全文会把说明句当成缺陷(08-23 判据律:判据要能证伪你要证的那件事,不是碰字就红)。 */
    const keysOf = (v, acc = []) => {
      if (Array.isArray(v)) v.forEach((x) => keysOf(x, acc))
      else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { acc.push(k); keysOf(v[k], acc) })
      return acc
    }
    const allKeys = keysOf(det.data)
    const moneyKeys = allKeys.filter((k) => /balance|bonus|amount|cents|price|refund|recharge|level|discount|paid|stored/i.test(k))
    check('④-8 🔴 详情接口一个金额字段都不下发(负向;反向守=真下发了 ' + allKeys.length + ' 个字段)',
      moneyKeys.length === 0 && allKeys.length >= 8, `钱字段:${moneyKeys.join(',') || '无'}`)
    /* 正向:写一条小记要 201,而且**从「我的客人」这一页读得回来**(只写不显=白写)。
       🔴 写口是**现成的** POST /admin/service-notes(员工/老板均可写,带 AI 结构化)——
       我第一版另开了 /admin/my-customers/:id/notes 并新建了一张同名表,`CREATE TABLE IF NOT EXISTS`
       悄悄没建成,接口直接 500(no such column: kind)。公约④「动手前先搜复用」的现场教训,
       所以这里连断言一起接回现有那条口:并排两个写口本身就是缺陷。 */
    const wrote = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId, rawText: `偏爱裸色,卸甲要轻${RUN}` }) }, stf, H)
    const det2 = await request(`/admin/my-customers/${userId}`, {}, stf, H)
    check('④-9 正向:写小记接口 200(201 Created)且在「我的客人」里读得回来',
      wrote.status === 201 && (det2.data.notes || []).some((n) => String(n.body || '').includes(RUN)
        && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(n.createdText || ''))),
      `${wrote.status} · 小记 ${(det2.data.notes || []).length} 条`)
    check('④-9b 写口只有一个(不许并排再开第二个小记接口)',
      (await request(`/admin/my-customers/${userId}/notes`, { method: 'POST', body: JSON.stringify({ body: 'x' }) }, stf, H)).status === 404)
    const emptyNote = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId, rawText: '   ' }) }, stf, H)
    check('④-9c 空小记写不进去(异常输入)', emptyNote.status === 400, String(emptyNote.status))
    const othersNote = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: otherUser, rawText: '越权写' }) }, stf, H)
    check('④-10 🔴 别人的客人写不了小记(越权=404;读口早就限死了,写口 08-27 才补上同一刀)',
      othersNote.status === 404, String(othersNote.status))
    const ownerNote = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: otherUser, rawText: '老板写谁都行' }) }, TOKEN, H)
    check('④-10b 反向守:老板写谁都行(证明上一条 404 是"越权"挡的,不是这条口本身坏了)',
      ownerNote.status === 201, String(ownerNote.status))
    /* 前端那一半:数**按钮**,不数字符。反向守=按钮总数 ≥ 2(证明这条正则真数得到东西)。 */
    const mcSrc = (await import('node:fs')).readFileSync((await import('node:path')).join((await import('node:path')).dirname((await import('node:url')).fileURLToPath(import.meta.url)), '../../apps/web/my-customers.js'), 'utf8')
    const btns = [...mcSrc.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0])
    const moneyBtns = btns.filter((b) => /余额|充值|赠送|退卡|冲销|会员等级|account-adjust|recharge|refund|reversal/.test(b))
    check('④-11 🔴 「我的客人」页钱的按钮数 = 0(负向;反向守=页上共 ' + btns.length + ' 个按钮)',
      moneyBtns.length === 0 && btns.length >= 2, moneyBtns.join(' | ').slice(0, 160))
    check('④-11b 正向:页上真有写小记的口(不是靠"整页空着"混过负向)',
      /data-my-note=/.test(mcSrc) && /#myNoteBody/.test(mcSrc) && /data-my-customer=/.test(mcSrc)
      && /\/admin\/service-notes/.test(mcSrc))
  } else {
    check('v1.2④ 员工号建不出来', false, JSON.stringify(acct2.data).slice(0, 120))
  }
}

/* 🔴 店主 08-27 指出:走查里看到的那次黄条是**退化用例** —— 那个号当时实付可退已经是 0、
   余额全是赠送,黄条上的数恰好等于退款额,**它算得对不对根本没被验到**。
   这里补一刀**切两边**的:实付可退 850 + 赠送 100,一次退 950。
   正确答案:paid_part 850 / bonus_part 100 / 黄条数 100(不是 950,也不是 0)。 */
{
  // 撞档就换时段(别的夹具占了);这不是被测行为,别让它把断言弄红
  let mixBk = { status: 0, data: {} }
  for (const hh of ['19', '07', '22', '23', '12']) {
    mixBk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `混合拆客${RUN}`, serviceId, technicianId, date: today, time: `${hh}:00` }) }, TOKEN, H)
    if (mixBk.data?.booking?.user?.id) break
  }
  const mixUser = mixBk.data?.booking?.user?.id
  if (mixUser) {
    db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`n5-mix-${RUN}`, mixUser)
    await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: mixUser, amountCents: 85000, bonusCents: 10000, payChannel: 'cash', note: '混合拆夹具' }) }, TOKEN, H)
    const mf = (await request(`/admin/account-adjust/facts?userId=${mixUser}`, {}, TOKEN, H)).data.facts
    check('混合拆-0 前置:实付可退 850 · 赠送 100 · 余额 950(两边都不为 0 才切得出刀口)',
      mf.paidRefundableCents === 85000 && mf.bonusRemainingCents === 10000 && mf.balanceCents === 95000,
      JSON.stringify({ p: mf.paidRefundableCents, b: mf.bonusRemainingCents, bal: mf.balanceCents }))
    const warn = (await request(`/admin/account-adjust/facts?userId=${mixUser}&amountCents=95000`, {}, TOKEN, H)).data.bonusWarning
    check('混合拆-1 🔴 黄条上的数 = 100(越过实付可退的那一截),不是 950 也不是 0',
      /100/.test(String(warn)) && !/950/.test(String(warn)) && String(warn).includes('赠送'), String(warn))
    const mixR = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: mixUser, amountCents: 95000, payChannel: 'cash', reason: '混合拆:一次退干净' }) }, TOKEN, H)
    const mixRow = db.prepare("SELECT paid_part_cents p, bonus_part_cents b, amount_cents a FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'refund' ORDER BY created_at DESC LIMIT 1").get(tid, mixUser)
    check('混合拆-2 🔴 拆账切两边:paid_part 850 / bonus_part 100(先冲实付、后冲赠送)',
      mixR.status === 201 && mixRow && mixRow.p === 85000 && mixRow.b === 10000,
      JSON.stringify({ status: mixR.status, row: mixRow }))
    check('混合拆-3 恒等式在这一刀上照样成立:paid + bonus ≡ 退款额',
      mixRow && mixRow.p + mixRow.b === Math.abs(mixRow.a), JSON.stringify(mixRow))
    /* 反向守:只退 500(没越过实付可退)时**不许出黄条** ——
       否则"总是出黄条"也能让上面那条绿。 */
    const noWarn = (await request(`/admin/account-adjust/facts?userId=${userId}&amountCents=100`, {}, TOKEN, H)).data.bonusWarning
    check('混合拆-4 🔴 反向守:没越过实付可退时不出黄条(不是"总是出")', !noWarn, String(noWarn))
  } else {
    check('混合拆 前置:排单失败', false, JSON.stringify(mixBk.data).slice(0, 140))
  }
}

/* 🔴 恒等式要**扫全表**,不能只验刚写的那一行(店主 08-26 第 10 步点的正是这个:
   "绿的才是问题 —— 说明只扫新行")。范围=本套件建的两家店的**所有** refund 行:
   它们全是当前代码写的,所以每一行都必须带分量且恒等;缺一行就说明有别的写路绕过了拆账。 */
{
  const sweep = db.prepare("SELECT id, tenant_id, amount_cents a, paid_part_cents p, bonus_part_cents b FROM stored_value_transactions WHERE type = 'refund' AND tenant_id IN (?, ?)").all(tid, `n5b-${RUN}`)
  const noParts = sweep.filter((r) => r.p === null || r.b === null)
  const broken = sweep.filter((r) => r.p !== null && r.b !== null && r.p + r.b !== Math.abs(r.a))
  check('恒等式扫全表-1 本批所有退款行都带两个分量(没有"绕过拆账"的写路)',
    sweep.length > 0 && noParts.length === 0, `${sweep.length} 行,缺分量 ${noParts.length} 行:${noParts.map((r) => r.id).join(',')}`)
  check('恒等式扫全表-2 🔴 每一行 paid_part + bonus_part ≡ 退款金额',
    broken.length === 0, broken.map((r) => `${r.id}:${r.p}+${r.b}≠${Math.abs(r.a)}`).join(' | '))
}

/* 🔴 顾客侧演示登录必须只在沙箱生效(店主 08-26 走查前追问「随便填密码」这条旁路)。
   查明:商家侧 2026-08-07 已把 demo 白名单锁进 DEMO_LOGIN_ALLOWED,**顾客侧漏了同一刀** ——
   知道邮箱就能拿 `demo-customer:<email>` 当成那个人,连密码都不用,而且**生产上这条路开着**。
   判据不能只读代码:**真起一个 NODE_ENV=production 的实例**,而且故意把 ALLOW_DEMO_ADMIN_LOGIN
   也打开 —— 证明这条路在生产口径下**拿环境变量也打不开**。 */
{
  const { spawn } = await import('node:child_process')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join: j3, dirname: d3 } = await import('node:path')
  const { fileURLToPath: f3 } = await import('node:url')
  const here = d3(f3(import.meta.url))
  const dir = mkdtempSync(j3(tmpdir(), 'll-prodgate-'))
  const port = 4406
  const child = spawn(process.execPath, ['local-server.mjs'], {
    cwd: here, stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production', ALLOW_DEMO_ADMIN_LOGIN: 'true', DATA_DIR: dir, PORT: String(port), TEST_DB_PATH: '' }
  })
  const wait = async () => {
    for (let i = 0; i < 60; i += 1) {
      try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return true } catch { /* 还没起来 */ }
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }
  const up = await wait()
  try {
    check('生产闸-0 生产模式实例起得来(判据要真调用,不是读代码)', up)
    const loginRes = await fetch(`http://127.0.0.1:${port}/auth/email/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'probe@example.com', password: 'x' })
    })
    const loginBody = await loginRes.json().catch(() => ({}))
    check('生产闸-1 🔴 生产口径下邮箱登录 = 403 DEMO_LOGIN_DISABLED(且 ALLOW_DEMO_ADMIN_LOGIN=true 也打不开)',
      loginRes.status === 403 && loginBody?.error?.code === 'DEMO_LOGIN_DISABLED', `${loginRes.status} ${JSON.stringify(loginBody).slice(0, 120)}`)
    const forged = await fetch(`http://127.0.0.1:${port}/my/stored-value`, { headers: { authorization: 'Bearer demo-customer:probe%40example.com' } })
    check('生产闸-2 🔴 伪造 demo-customer 令牌在生产口径下 = 401(顾客侧与商家侧同一把闸)', forged.status === 401, String(forged.status))
    const localStill = await request('/auth/email/login', { method: 'POST', body: JSON.stringify({ email: `walk-probe-${RUN}@n5.local`, password: 'x' }) }, null)
    check('生产闸-3 反例:沙箱/本地照旧可用(别把走查台也锁死了)', localStill.status === 200, String(localStill.status))
  } finally {
    child.kill()
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清不掉不影响断言 */ }
  }
}

db.close()
console.log(`\n退卡口回归通过:${checks} 项断言全绿`)
