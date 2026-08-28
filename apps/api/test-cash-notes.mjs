/* D79 · 线下现金腿(日结手记)—— 店主 2026-08-28 排进批次二第②件。

   病:「今晚数钱按这个数」只算系统内的现金进出(到店支付 + 现金充值 − 现金退卡)。
   买材料付的现金、早上放的备用金、找零、金额更正后当场退的差额 —— 系统一个都不知道,
   于是那个数永远等不于抽屉。店主对不上账时不会怀疑"系统少算一腿",**她会怀疑店员**。

   店主给的判据(原样落在这里):
     · 手记一笔 −50 → 应有数**跟着减 50**;
     · **反向守**:不记时应有数**一分不动**(否则"这个数总在变"也能让它绿)。

   另加三族(都是从既有律推的,不是我临时想的):
     · 后端最终闸:备注必填 / 0 元 / 类型非法 / 超上限 —— 接口直调一律拦(前端拦只算体验);
     · 只追加不修改:冲销是**追加一条反向行**,原始那条还在,净额回到没记过的状态;
     · 手记**不进损益、不进营业额、不进业绩**(它是抽屉腿,不是收入)。

   ⚠️ standalone:CI_SUITES="cash-notes" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { CASH_NOTE_KIND_LABELS as KIND_LABELS } from './cash-notes.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}

const tid = `cash-${RUN}`
const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `现金腿店${RUN}`, plan: 'chain' }) })
if (made.status !== 201) throw new Error(`建店失败 ${JSON.stringify(made.data)}`)
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const today = (await request('/admin/store-clock', {}, PLATFORM, H)).data.today
const drawerOf = async (date = today) => (await request(`/admin/daily-close?date=${date}`, {}, PLATFORM, H)).data.dailyClose.cashDrawer
const closeOf = async (date = today) => (await request(`/admin/daily-close?date=${date}`, {}, PLATFORM, H)).data.dailyClose

/* ===== ① 反向守先做:一笔手记都没有时,基线是多少、算式长什么样 ===== */
const base = await drawerOf()
check('① 反向守基线:没有手记时,算式里没有「现金手记」这一行',
  !(base.rows || []).some((r) => String(r.label).includes('现金手记')), JSON.stringify(base.rows))
const baseCents = base.shouldHaveCents
const baseAgain = await drawerOf()
check('① 反向守:不记手记时,应有数一分不动(连读两次相同)',
  baseAgain.shouldHaveCents === baseCents, `${baseCents} → ${baseAgain.shouldHaveCents}`)

/* ===== ② 店主判据本体:手记一笔 −50 → 应有数跟着减 50 ===== */
const add1 = await request('/admin/cash-notes', {
  method: 'POST', body: JSON.stringify({ date: today, kind: 'count_diff', amountCents: -5000, note: `盘点少了${RUN}` })
}, PLATFORM, H)
check('② 记一笔 −50 成功', add1.status === 201 && add1.data.note.amountCents === -5000, JSON.stringify(add1.data).slice(0, 160))
const afterOut = await drawerOf()
check('② 🔴 店主判据:应有数**正好减了 50**(不是"变了一下")',
  afterOut.shouldHaveCents === baseCents - 5000, `基线 ${baseCents} → 现在 ${afterOut.shouldHaveCents}`)
check('② 算式里多出「现金手记(1 笔)」且是减号(数字要能自证来源)',
  (afterOut.rows || []).some((r) => r.label === '现金手记(1 笔)' && r.sign === '−' && r.amountCents === 5000),
  JSON.stringify(afterOut.rows))

/* ===== ③ 正的那一半:备用金放进抽屉 +200 ===== */
await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify({ date: today, kind: 'float', amountCents: 20000, note: `早上放备用金${RUN}` }) }, PLATFORM, H)
const afterIn = await drawerOf()
check('③ 再记 +200:应有数 = 基线 − 50 + 200(两笔一起算,不是只认最后一笔)',
  afterIn.shouldHaveCents === baseCents - 5000 + 20000, `${afterIn.shouldHaveCents}`)
check('③ 净额为正时算式行变加号', (afterIn.rows || []).some((r) => r.label === '现金手记(2 笔)' && r.sign === '+' && r.amountCents === 15000),
  JSON.stringify(afterIn.rows))

/* ===== ④ 手记不许碰收入 / 营业额 / 业绩 ===== */
const dc = await closeOf()
check('④ 手记不进损益:抽屉的收入影响仍恒为 0', dc.cashDrawer.incomeImpactCents === 0, String(dc.cashDrawer.incomeImpactCents))
check('④ 手记不进营业额(顶部三小格里的营业额没被它动过)',
  (dc.headline || []).find((h) => h.key === 'revenue')?.value === (dc.headline || []).find((h) => h.key === 'revenue')?.value
  && dc.revenueCents === 0, String(dc.revenueCents))
check('④ 手记不进业绩(本日技师业绩合计仍为 0)',
  (dc.technicians || []).reduce((n, t) => n + (t.perfCents || 0), 0) === 0,
  JSON.stringify((dc.technicians || []).map((t) => t.perfCents)))

/* ===== ⑤ 后端最终闸(前端拦只算体验)===== */
const gates = [
  ['备注空白', { date: today, kind: 'count_diff', amountCents: -100, note: '   ' }],
  ['金额 0', { date: today, kind: 'count_diff', amountCents: 0, note: 'x' }],
  ['类型非法', { date: today, kind: 'steal', amountCents: -100, note: 'x' }],
  ['已退役的类型(现金支出 → 请走「记一笔」)', { date: today, kind: 'expense', amountCents: -100, note: 'x' }],
  ['超上限', { date: today, kind: 'count_diff', amountCents: -100000001, note: 'x' }],
  ['日期格式不对', { date: '08/28', kind: 'count_diff', amountCents: -100, note: 'x' }],
  ['备注超长', { date: today, kind: 'count_diff', amountCents: -100, note: 'x'.repeat(121) }]
]
for (const [label, body] of gates) {
  const r = await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify(body) }, PLATFORM, H)
  check(`⑤ 后端闸「${label}」→ 4xx(${r.status})`, r.status >= 400 && r.status < 500, JSON.stringify(r.data).slice(0, 120))
}
const afterGates = await drawerOf()
check('⑤ 被拒的七次一分钱都没写进去(应有数与拒之前相同)',
  afterGates.shouldHaveCents === afterIn.shouldHaveCents, `${afterIn.shouldHaveCents} → ${afterGates.shouldHaveCents}`)

/* ===== ⑥ 只追加不修改:冲销 = 追加一条反向行 ===== */
const noteId = add1.data.note.id
const rev = await request(`/admin/cash-notes/${noteId}/reverse`, { method: 'POST', body: JSON.stringify({}) }, PLATFORM, H)
check('⑥ 冲销成功,且冲销行金额与原条相反', rev.status === 201 && rev.data.note.amountCents === 5000 && rev.data.note.isReversal === true,
  JSON.stringify(rev.data).slice(0, 160))
const afterRev = await drawerOf()
check('⑥ 冲销之后:应有数回到"没记过那 50"的状态(基线 + 200)',
  afterRev.shouldHaveCents === baseCents + 20000, String(afterRev.shouldHaveCents))
const list = (await request(`/admin/cash-notes?date=${today}`, {}, PLATFORM, H)).data.items
check('⑥ 原始那条**还在**(只追加不删除:3 条记录 = 2 笔 + 1 冲销)',
  list.length === 3 && list.some((x) => x.id === noteId), JSON.stringify(list.map((x) => [x.kind, x.amountCents])))
check('⑥ 同一条不许冲两次', (await request(`/admin/cash-notes/${noteId}/reverse`, { method: 'POST', body: JSON.stringify({}) }, PLATFORM, H)).status === 409)
check('⑥ 冲销行本身不许再冲', (await request(`/admin/cash-notes/${rev.data.note.id}/reverse`, { method: 'POST', body: JSON.stringify({}) }, PLATFORM, H)).status === 409)

/* ===== ⑦ 门禁:读写两道闸分别验 ===== */
check('⑦ 未登录 GET → 401', (await request(`/admin/cash-notes?date=${today}`, {}, null, H)).status === 401)
check('⑦ 未登录 POST → 401', (await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify({ date: today, kind: 'expense', amountCents: -1, note: 'x' }) }, null, H)).status === 401)

/* ===== ⑧ 租户隔离:甲店的手记不许算进乙店的抽屉 ===== */
const tidB = `cash-b-${RUN}`
await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tidB, name: `现金腿乙${RUN}`, plan: 'chain' }) })
const HB = { 'x-admin-tenant-id': tidB, 'x-tenant-id': tidB }
const bDrawer = (await request(`/admin/daily-close?date=${today}`, {}, PLATFORM, HB)).data.dailyClose.cashDrawer
check('⑧ 乙店抽屉里没有甲店的手记', !(bDrawer.rows || []).some((r) => String(r.label).includes('现金手记')), JSON.stringify(bDrawer.rows))
check('⑧ 乙店手记列表为空', (await request(`/admin/cash-notes?date=${today}`, {}, PLATFORM, HB)).data.items.length === 0)

/* ===== ⑨ 跨日:昨天的手记不许算进今天 ===== */
const yesterday = new Date(`${today}T12:00:00Z`)
yesterday.setUTCDate(yesterday.getUTCDate() - 1)
const yday = yesterday.toISOString().slice(0, 10)
await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify({ date: yday, kind: 'count_diff', amountCents: -9999, note: `昨天的${RUN}` }) }, PLATFORM, H)
const todayAfterY = await drawerOf()
check('⑨ 昨天记的手记不影响今天的应有数(日界要对)',
  todayAfterY.shouldHaveCents === afterRev.shouldHaveCents, `${afterRev.shouldHaveCents} → ${todayAfterY.shouldHaveCents}`)
const ydayDrawer = await drawerOf(yday)
check('⑨ 昨天那天自己看得到那一笔', (ydayDrawer.rows || []).some((r) => r.label === '现金手记(1 笔)' && r.amountCents === 9999),
  JSON.stringify(ydayDrawer.rows))

/* ===== 🔴 ⑨a 一个动作一个入口(店主 08-28 六裁;她问「记一笔和现金手记是不是重叠」——是,原来重叠)=====
   四条判据按她给的原文:
     ①记一笔(现金)→ 损益与抽屉**同时**动 ②记一笔(刷卡)→ 只动损益
     ③现金手记 → 只动抽屉 ④**反向守**:同一笔不许被两个口同时记进抽屉(抽屉只减一次)。 */
{
  const before = await drawerOf()
  const beforeClose = await closeOf()
  const pnl = (dc) => (dc.financeSummary ? dc.financeSummary.netCents : null)

  // ① 记一笔:买材料付现 60
  const cashEntry = await request('/admin/finance/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 'expense', category: '耗材', amount: 60, payChannel: 'cash', occurredOn: today })
  }, PLATFORM, H)
  check('⑨a① 记一笔(现金)成功', cashEntry.status === 201 || cashEntry.status === 200, JSON.stringify(cashEntry.data).slice(0, 120))
  const afterCash = await drawerOf()
  check('⑨a① 🔴 记一笔(现金)→ **抽屉跟着减 60**(以前它一分不动,所以商家只能再记一次手记)',
    afterCash.shouldHaveCents === before.shouldHaveCents - 6000,
    `${before.shouldHaveCents} → ${afterCash.shouldHaveCents}`)
  check('⑨a① 算式里多出「记一笔·现金收支」这一行(数字要能自证来源)',
    (afterCash.rows || []).some((r) => String(r.label).startsWith('记一笔·现金收支') && r.sign === '−' && r.amountCents === 6000),
    JSON.stringify(afterCash.rows))

  // ② 记一笔:刷卡 88 —— 只动损益,抽屉一分不动
  const cardEntry = await request('/admin/finance/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 'expense', category: '耗材', amount: 88, payChannel: 'card', occurredOn: today })
  }, PLATFORM, H)
  check('⑨a② 记一笔(刷卡)成功', cardEntry.status === 201 || cardEntry.status === 200)
  const afterCard = await drawerOf()
  check('⑨a② 🔴 记一笔(刷卡)→ **抽屉一分不动**(钱没经过抽屉)',
    afterCard.shouldHaveCents === afterCash.shouldHaveCents, `${afterCash.shouldHaveCents} → ${afterCard.shouldHaveCents}`)
  check('⑨a② 两笔都进了账本(损益那边确实收到了 60 + 88;否则"抽屉不动"可能是因为根本没记成)',
    ((await request(`/admin/finance/transactions?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.transactions || [])
      .filter((t) => t.category === '耗材').length === 2)

  // ③ 现金手记只动抽屉,不进损益
  const beforeNote = await drawerOf()
  const finBefore = (await request(`/admin/finance/transactions?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.summary.netCents
  await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify({ date: today, kind: 'float', amountCents: 30000, note: `备用金${RUN}` }) }, PLATFORM, H)
  const afterNote = await drawerOf()
  const finAfter = (await request(`/admin/finance/transactions?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.summary.netCents
  check('⑨a③ 现金手记 → 抽屉动了(+300)', afterNote.shouldHaveCents === beforeNote.shouldHaveCents + 30000,
    `${beforeNote.shouldHaveCents} → ${afterNote.shouldHaveCents}`)
  check('⑨a③ 现金手记 → **损益一分不动**(它既不是赚也不是花)', finAfter === finBefore, `${finBefore} → ${finAfter}`)

  // ④ 反向守:一笔现金支出只许被记进抽屉一次
  const legs = (afterNote.rows || []).filter((r) => /记一笔·现金收支|现金手记/.test(String(r.label)))
  check('⑨a④ 🔴 反向守:两条手工腿各自独立,同一笔 60 只出现在「记一笔·现金收支」那一行,没被手记再记一遍',
    legs.length === 2
    && legs.find((r) => String(r.label).startsWith('记一笔·现金收支')).amountCents === 6000
    && legs.find((r) => String(r.label).startsWith('现金手记')).amountCents !== 6000,
    JSON.stringify(legs))

  // ⑤ 花钱的口收窄:现金手记不许再记 expense,要把人指回「记一笔」
  const retired = await request('/admin/cash-notes', { method: 'POST', body: JSON.stringify({ date: today, kind: 'expense', amountCents: -100, note: '买东西' }) }, PLATFORM, H)
  check('⑨a⑤ 现金手记的「现金支出」已退役 → 400 KIND_RETIRED,并把人指回「记一笔」',
    retired.status === 400 && retired.data.error.code === 'KIND_RETIRED' && String(retired.data.error.message).includes('记一笔'),
    JSON.stringify(retired.data).slice(0, 160))
  check('⑨a⑤ 退役只挡**写口**:老账仍认得出来(标签表里还留着,不然历史记录会显示成一串英文)',
    Boolean(KIND_LABELS.expense) && Boolean(KIND_LABELS.change)
    && !(await request('/admin/cash-notes', {}, PLATFORM, H)).data.kinds.some((k) => k.kind === 'expense'),
    `标签在:${KIND_LABELS.expense} / 下拉里已没有它`)
  check('⑨a⑥ 分工那句话由后端出,两端同一句(不让商家猜)',
    String(afterNote.splitNote || '').includes('记一笔') && String(afterNote.splitNote).includes('现金手记'),
    String(afterNote.splitNote))
}

/* ===== 🔴 ⑨c 付款方式收窄(店主 08-29:「储值卡会在会员界面去动他的值,不会在记一笔这里记」)=====
   裁定:付款方式的唯一作用 = 判断动不动抽屉。「记一笔」只记不走订单流程的收支;
   顾客消费的钱走结算单签署,入账唯一路径 = 签署。判据按她给的四条 + 唯一出口。 */
{
  // ① 选项集合 = 白名单精确等值(现金/刷卡/转账/其他)—— 多一个、少一个、换顺序里混进新的,都红
  const cfg = (await request('/admin/finance/entry-config', {}, PLATFORM, H)).data
  const ids = (cfg.channels || []).map((c) => c.id).sort()
  check('⑨c① 选项集合 = 白名单(cash/card/transfer/unknown),多一个就红',
    JSON.stringify(ids) === JSON.stringify(['card', 'cash', 'transfer', 'unknown']), JSON.stringify(cfg.channels))
  check('⑨c① 分工那句话随选项一起下发(后端唯一出口,两端同一句)',
    String(cfg.note || '').includes('结算单') && String(cfg.note).includes('不在这儿记'), String(cfg.note))
  const viaGet = (await request(`/admin/finance/transactions?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.entryConfig
  check('⑨c① 网页搭车那份与小程序那份是同一份(同一个函数出的)',
    JSON.stringify(viaGet) === JSON.stringify(cfg), JSON.stringify(viaGet).slice(0, 120))

  // ② 写口:储值卡 → 拒,且话里说清为什么
  const sv = await request('/admin/finance/transactions', {
    method: 'POST', body: JSON.stringify({ type: 'expense', category: '耗材', amount: 10, payChannel: 'stored_value', occurredOn: today })
  }, PLATFORM, H)
  check('⑨c② 🔴 写口传储值卡 → 400 CHANNEL_RETIRED,话里指向结算单',
    sv.status === 400 && sv.data.error.code === 'CHANNEL_RETIRED' && String(sv.data.error.message).includes('结算单'),
    JSON.stringify(sv.data).slice(0, 160))
  const wc2 = await request('/admin/finance/transactions', {
    method: 'POST', body: JSON.stringify({ type: 'expense', category: '耗材', amount: 10, payChannel: 'wechat', occurredOn: today })
  }, PLATFORM, H)
  check('⑨c② 微信/支付宝(旧选项)→ 400 并指引「转账」', wc2.status === 400 && String(wc2.data.error.message).includes('转账'),
    JSON.stringify(wc2.data).slice(0, 120))
  check('⑨c② 编的值(steal)→ 400', (await request('/admin/finance/transactions', {
    method: 'POST', body: JSON.stringify({ type: 'expense', category: '耗材', amount: 10, payChannel: 'steal', occurredOn: today })
  }, PLATFORM, H)).status === 400)
  // 不传 = 归「其他」:落库 unknown、**不动抽屉**(保守边);拒的只是明确传了非法值的
  const beforeNoCh = (await drawerOf()).shouldHaveCents
  const noCh = await request('/admin/finance/transactions', {
    method: 'POST', body: JSON.stringify({ type: 'expense', category: '耗材', amount: 5, occurredOn: today })
  }, PLATFORM, H)
  check('⑨c② 不传付款方式 → 201 落「其他」,抽屉一分不动',
    noCh.status === 201 && noCh.data.transaction.payChannel === 'unknown'
    && (await drawerOf()).shouldHaveCents === beforeNoCh,
    JSON.stringify(noCh.data).slice(0, 120))

  // ③ 老账读得出:显示标签全集仍认得退役与旧值(读口留,写口拒)
  const { MANUAL_ENTRY_CHANNEL_LABELS } = await import('./cash-notes.mjs')
  check('⑨c③ 读口标签全集仍认得 stored_value / wechat / alipay(历史行不许显示成一串英文)',
    Boolean(MANUAL_ENTRY_CHANNEL_LABELS.stored_value && MANUAL_ENTRY_CHANNEL_LABELS.wechat && MANUAL_ENTRY_CHANNEL_LABELS.alipay))
  /* 扫描面跟着代码走(J3 教训):表单搬进了 finance-entry-form.js,标签表还在 admin.js —— 两个都扫 */
  const servedAdmin = await fetch(`${BASE_URL}/web/admin.js`).then((r) => r.text())
  const servedEntryForm = await fetch(`${BASE_URL}/web/finance-entry-form.js`).then((r) => r.text())
  check('⑨c③ 网页(实发资源):历史行标签表仍含 stored_value;下拉改读 entryConfig,不再用常量渲染',
    servedAdmin.includes("'stored_value', '储值卡(已退役)'") && servedEntryForm.includes('entryConfig || {}'))
  const servedAdminHtml = await fetch(`${BASE_URL}/web/admin.html`).then((r) => r.text())
  check('⑨c③ 表单模块真的在页面加载清单里(带内容指纹)', /finance-entry-form\.js\?v=[0-9a-f]{6,}/.test(servedAdminHtml),
    (servedAdminHtml.match(/finance-entry-form\.js\?v=[^"]*/) || ['(没挂上)'])[0])

  // ④ 只有现金动抽屉:刷卡/转账/其他各记一笔,应有数一分不动(现金那半在 ⑨a① 已实测)
  const beforeCh = (await drawerOf()).shouldHaveCents
  for (const ch of ['card', 'transfer', 'unknown']) {
    const r = await request('/admin/finance/transactions', {
      method: 'POST', body: JSON.stringify({ type: 'expense', category: '耗材', amount: 7, payChannel: ch, occurredOn: today })
    }, PLATFORM, H)
    check(`⑨c④ 记一笔(${ch})写入成功`, r.status === 201, JSON.stringify(r.data).slice(0, 100))
  }
  check('⑨c④ 🔴 反向守:刷卡/转账/其他三笔都不动抽屉(唯一动抽屉的是现金)',
    (await drawerOf()).shouldHaveCents === beforeCh, `${beforeCh} → ${(await drawerOf()).shouldHaveCents}`)

  // ⑤ 小程序(源码层):零写死选项,从 entry-config 取,失败不回落
  const { readFileSync } = await import('node:fs')
  const miniEntry = readFileSync(new URL('../../miniprogram/pages/merchant/finance-entry/index.js', import.meta.url), 'utf8')
  check('⑨c⑤ 小程序记一笔页:写死的 CHANNELS 数组已消亡,选项从 /admin/finance/entry-config 取',
    !/const CHANNELS = \[/.test(miniEntry) && miniEntry.includes('/admin/finance/entry-config'))
}

/* ===== ⑨b 与金额更正的接缝(08-27 店主登记的那一行:更正后的现金找补走这个口)=====
   判据两向:更正额还没记进手记 → 那句话要告诉她"实际应是多少";记进去了 → 必须改口,
   不许一边说"抽屉已经算进去了"一边又说"实际应是另一个数"(屏幕上不许有解释不了的数)。 */
{
  const amendDay = today
  const noteBefore = (await drawerOf(amendDay)).amendNote || ''
  check('⑨b 这一天没有金额更正,所以那句解释不该挂着(反向守)', noteBefore === '', noteBefore)
}

/* ===== ⑩ 运行时取证:两端**服务端真发出来的**那份代码,都读同一个后端出口 ===== */
const servedDcr = await fetch(`${BASE_URL}/web/daily-close-rows.js`).then((r) => r.text())
check('⑩ 网页日结(实发资源):手记入口在,且写口打的是 /admin/cash-notes',
  servedDcr.includes("request('/admin/cash-notes'") && servedDcr.includes('data-cash-note-reverse'))
check('⑩ 网页手记金额框不是 type=number(钱的输入框那条族规)',
  /id="dcNoteAmount"[^>]*type="text"/.test(servedDcr) && /id="dcNoteAmount"[^>]*inputmode="decimal"/.test(servedDcr),
  (servedDcr.match(/<input id="dcNoteAmount"[^>]*>/) || ['(没找到)'])[0])

console.log(`\n✅ test-cash-notes 通过 ${checks} 项`)
