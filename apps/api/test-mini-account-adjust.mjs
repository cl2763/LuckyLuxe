/* 二.1 · 账户调整+退卡上小程序(店主 08-27 裁「账户调整=双端」,欠最久的一笔;双端同批律)。

   合同:客户档案 → 账户调整,四 tab 与网页同源;退卡的全部硬拦、拆账、黄条走**同一后端出口**,
   前端不许再写一套;权限同网页(店员看不见,接口层 requireRefundRight 兜底)。

   ⚠️ standalone:CI_SUITES="mini-account-adjust" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { readFileSync } from 'node:fs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
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
/* 🔴 剥注释再扫(突变自检当场抓到的):第一版判据被**头部注释里的字面量**喂饱 ——
   把 guardOwner 那行摘掉,注释里那句「页面 guardOwner」照样让 includes 绿。判据看行为面的文本,
   必须先把注释剥掉(㋓ 那条与 image-placeholder ②b 都是同一刀)。 */
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const mini = (p) => stripJs(readFileSync(new URL(`../../miniprogram/${p}`, import.meta.url), 'utf8'))

/* ===== ⓪ 页面完整性(店主 2026-08-30 退回件:账户调整页白屏 wxml not found)=====
   「无开发者工具」不是借口:四件套存在性 + app.json 注册是**纯文件断言**。
   双向白名单:①app.json 每个注册页,wxml/js/json 三件必须都在(wxss 可选但本仓惯例四件全);
   ②每个 pages 目录下的 index.js 都必须在 app.json 里 —— 新建页漏注册、注册了没建文件,双向都当场红。 */
{
  const { readdirSync, existsSync } = await import('node:fs')
  const root = new URL('../../miniprogram/', import.meta.url)
  const appJson = JSON.parse(readFileSync(new URL('app.json', root), 'utf8'))
  const registered = appJson.pages.concat(...(appJson.subPackages || []).map((sp) => (sp.pages || []).map((pg) => `${sp.root}/${pg}`)))
  const missing = []
  for (const pg of registered) {
    for (const ext of ['wxml', 'js', 'json']) {
      if (!existsSync(new URL(`${pg}.${ext}`, root))) missing.push(`${pg}.${ext}`)
    }
  }
  check(`⓪ app.json ${registered.length} 个注册页,每页 wxml/js/json 三件都在(缺一件=白屏 __route__ 那个病)`,
    missing.length === 0, missing.join(' | '))
  const walkPages = (dir, out = []) => {
    for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (e.isDirectory()) walkPages(`${dir}${e.name}/`, out)
      else if (e.name === 'index.js') out.push(`${dir}index`)
    }
    return out
  }
  const onDisk = walkPages('pages/')
  const unregistered = onDisk.filter((pg) => !registered.includes(pg))
  check(`⓪ 反向:磁盘上 ${onDisk.length} 个页面目录全部在 app.json 里(建了页忘注册=入口点了白屏)`,
    unregistered.length === 0, unregistered.join(' | '))
  check('⓪ app.json 以换行收尾(json.dump 会吃掉它 —— 本次退回件里的真 diff)',
    readFileSync(new URL('app.json', root), 'utf8').endsWith('\n'))
}

/* ===== ① 源码层:小程序调的每一条口都是网页那一套(同一后端出口,零第二实现) ===== */
const aa = mini('pages/merchant/account-adjust/index.js')
check('① 四个参考数与黄条:同一条 facts 口(/admin/account-adjust/facts)', (aa.match(/account-adjust\/facts/g) || []).length >= 2)
check('① 退储值:同一条 /admin/stored-value/refund(带幂等 requestId)', aa.includes("'/admin/stored-value/refund'") && aa.includes('requestId'))
check('① 退次卡:同一条 /admin/timecards/:id/refund', aa.includes('/admin/timecards/') && aa.includes('/refund`'))
/* 08-30c 入口总收敛翻面:指路已死,四 tab 全内嵌 —— 调的仍是各自既有唯一写口(路由零增零改) */
check('🔴 ① 入口总收敛:充值/赠送内嵌(POST /admin/stored-value/recharge)且指路句已死(零 goElsewhere/navigateTo member)',
  aa.includes("'/admin/stored-value/recharge'") && !aa.includes('goElsewhere') && !aa.includes('merchant/member/index'))
check('🔴 ① 入口总收敛:冲销内嵌(既有唯一冲销口 /admin/finance/transactions/:id/reverse)且不跳财务页',
  aa.includes('/admin/finance/transactions/') && aa.includes('/reverse') && !aa.includes('finance-txns/index'))
const memberJs = mini('pages/merchant/member/index.js')
const memberWxml = mini('pages/merchant/member/index.wxml')
check('🔴 ① 死口删除:会员页「给会员加储值」表单已删(零 doRecharge/rvPicked;wxml 零充值表单)',
  !memberJs.includes('doRecharge') && !memberJs.includes('rvPicked') && !memberWxml.includes('给会员加储值'))
check('① 页面 guardOwner(店员连入口页都进不来)+ D90:「先去解锁」弹跳已拆(账调不挂财务门;剥注释后零 lock-status 预闸)',
  aa.includes('guardOwner') && !aa.includes('请先在财务页解锁') && !aa.includes('finance/lock-status'))
/* 网页侧同批同刀(双端同批律):web 三处死口删净 + 弹层内嵌同两条写口 */
const webAdmin = stripJs(readFileSync(new URL('../web/admin.js', import.meta.url), 'utf8'))
const webAa = stripJs(readFileSync(new URL('../web/account-adjust.js', import.meta.url), 'utf8'))
check('🔴 ① 网页死口删除:给TA充值按钮 + 会员页充值表单 + prefill 流全净(零残留)',
  !webAdmin.includes('data-customer-recharge') && !webAdmin.includes('renderSvOpsCard') && !webAdmin.includes('data-msv-recharge') && !webAdmin.includes('prefillUserId'))
check('🔴 ① 网页弹层内嵌:充值(stored-value/recharge)+ 冲销(finance/transactions/:id/reverse)且 goto 指路已死',
  webAa.includes("'/admin/stored-value/recharge'") && webAa.includes('/reverse`') && !webAa.includes('data-aa-goto'))
const custWxml = mini('pages/merchant/customer/index.wxml')
check('① 入口挂在客户档案页(customer 页本身 guardOwner)', custWxml.includes('accountAdjust') && custWxml.includes('账户调整'))
/* 店主 08-30 点名:一套按钮规格 —— 客户档案四个动作(写小记/画像/账户调整/发券)全部 hbtn 同形制 */
check('① 按钮同形制:账户调整与发券都是 hbtn(与写服务小记同规格),linkbtn 不再用于这两个动作',
  /class="hbtn"[^>]*bindtap="accountAdjust"/.test(custWxml) && /hbtn[^>]*bindtap="sendCoupon"/.test(custWxml)
  && !/linkbtn[^>]*bindtap="(accountAdjust|sendCoupon)"/.test(custWxml))
const aaWxml = mini('pages/merchant/account-adjust/index.wxml')
check('① 四 tab 与网页同序同名(充值/赠送/退卡/冲销);句子字段全部来自 facts(splitText/hint/incomeImpactText)',
  ['充值', '赠送', '退卡', '冲销'].every((t) => aaWxml.includes(t))
  && ['facts.splitText', 'facts.hint', 'facts.incomeImpactText'].every((f) => aaWxml.includes(f)))
check('① 黄条句后端给(bonusWarning),前端不自己算赠送', aa.includes('r.bonusWarning') && !aa.includes('bonusCents -'))

/* ===== ② 行为层:同一后端出口的四条硬拦在这个调用面上照样立着 ===== */
const tid = `maa-${RUN}`
if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `小程序退卡店${RUN}`, plan: 'chain' }) })).status !== 201) throw new Error('建店失败')
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const imp = (await request(`/platform/tenants/${tid}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `退卡客${RUN}`, phone: `137${RUN.slice(-8)}` }] }) })).data
const userId = imp.users[0].userId
/* 🔴 J-60 第一款(夜13 §五 降账 5 处)· 这五处原来是**直连库贴微信绑定**:
   `db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?')` ——
   真顾客不是这么绑上的。她拿**自己的手机号**从 `/auth/wechat/mini-login` 进来,
   服务端那条**严格认人四条**(本店 + 号完全一致 + 没绑过微信 + 唯一一条)把轻档案认领并绑上。
   贴出来的那个绑**没走过这条路**,于是认人那一段在这一套里从来没被跑到过。
   这五条导入行本来就带手机号,所以五处一次全换。 */
const { bindWechatViaFrontDoor } = await import('./customer-login-fixture.mjs')
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH') })())
await bindWechatViaFrontDoor({ base: BASE_URL, tenantId: tid, userId, phone: `137${RUN.slice(-8)}`, tag: `maa-${RUN}` })
check('② 前置:顾客建好并绑定', (await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId, amountCents: 100000, bonusCents: 10000, payChannel: 'cash', note: '夹具:充1000送100' }) }, PLATFORM, H)).status === 201)

const facts1 = (await request(`/admin/account-adjust/facts?userId=${userId}`, {}, PLATFORM, H)).data.facts
check('② facts 四数一句都在(小程序渲染的就是这一份)', facts1.paidText && facts1.balanceText && facts1.hint && facts1.incomeImpactText, JSON.stringify(facts1).slice(0, 120))
const warn = (await request(`/admin/account-adjust/facts?userId=${userId}&amountCents=105000`, {}, PLATFORM, H)).data
check('② 黄条:退 1050 越过实付可退 → 后端给「你正在退出赠送部分」那句', /赠送|让利/.test(String(warn.bonusWarning || '')), String(warn.bonusWarning))
check('② 硬拦:退超余额 → 后端拒(前端拦只算体验)', (await request('/admin/stored-value/refund', {
  method: 'POST', body: JSON.stringify({ userId, amountCents: 999999, payChannel: 'cash', reason: '试超退', requestId: `x-${RUN}` })
}, PLATFORM, H)).status >= 400)
check('② 硬拦:原因必填后端拦', (await request('/admin/stored-value/refund', {
  method: 'POST', body: JSON.stringify({ userId, amountCents: 1000, payChannel: 'cash', reason: '  ', requestId: `y-${RUN}` })
}, PLATFORM, H)).status >= 400)
const rf = await request('/admin/stored-value/refund', {
  method: 'POST', body: JSON.stringify({ userId, amountCents: 15000, payChannel: 'cash', reason: `小程序调用面验证${RUN}`, requestId: `z-${RUN}` })
}, PLATFORM, H)
check('② 合法退款成功(反向守),拆账两腿后端给(先冲赠送后冲实付的两腿字段在)',
  (rf.status === 200 || rf.status === 201) && rf.data.refundedCents === 15000 && 'paidPartCents' in rf.data && 'bonusPartCents' in rf.data,
  JSON.stringify(rf.data).slice(0, 140))
const rf2 = await request('/admin/stored-value/refund', {
  method: 'POST', body: JSON.stringify({ userId, amountCents: 15000, payChannel: 'cash', reason: `重放${RUN}`, requestId: `z-${RUN}` })
}, PLATFORM, H)
check('② 幂等:同 requestId 重放不再扣一笔', (rf2.status === 200 || rf2.status === 201) && (rf2.data.duplicate === true || rf2.data.balanceAfterCents === rf.data.balanceAfterCents), JSON.stringify(rf2.data).slice(0, 120))

/* ===== ③ 权限:店员打这些口一律 403(接口层是最终闸) ===== */
// 员工账号从技师建(staff-accounts 的口要 technicianId —— 与 admin-accounts 套件同法)
const techMk = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `店员${RUN}`, isActive: true }) }, PLATFORM, H)).data.technician
const staffMk = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techMk.id }) }, PLATFORM, H)
const staffPw = staffMk.data?.initialPassword || staffMk.data?.account?.initialPassword
const staffUser = staffMk.data?.username || staffMk.data?.account?.username
const staffLg = staffPw ? (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ username: staffUser, password: staffPw, tenantId: tid }) }, null)).data : null
if (staffLg?.auth) {
  const st = staffLg.auth.accessToken
  check('③ 店员打 facts → 403', (await request(`/admin/account-adjust/facts?userId=${userId}`, {}, st)).status === 403)
  check('③ 店员打退款 → 403', (await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId, amountCents: 100, payChannel: 'cash', reason: 'x' }) }, st)).status === 403)
} else {
  check('③ 店员账号建失败时如实红(不许跳过越权断言)', false, JSON.stringify(staffMk.data).slice(0, 120))
}

/* ===== ④ 裁定2(店主 08-30d 准开口):储值行冲销 · 合同五条逐条验 ===== */
{
  const today = (await request('/admin/store-clock', {}, PLATFORM, H)).data.today
  const imp2 = (await request(`/platform/tenants/${tid}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `冲销客${RUN}`, phone: `136${RUN.slice(-8)}` }] }) })).data
  const u2 = imp2.users[0].userId
  await bindWechatViaFrontDoor({ base: BASE_URL, tenantId: tid, userId: u2, phone: `136${RUN.slice(-8)}`, tag: `rev-${RUN}` })
  check('④ 夹具:错记一笔 充500赠50(现金)', (await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: u2, amountCents: 50000, bonusCents: 5000, payChannel: 'cash' }) }, PLATFORM, H)).status === 201)
  const f0 = (await request(`/admin/account-adjust/facts?userId=${u2}`, {}, PLATFORM, H)).data.facts
  check('④ 冲销前四数:实付 500 / 赠送 50 / 余额 550', f0.paidCents === 50000 && f0.bonusCents === 5000 && f0.balanceCents === 55000, JSON.stringify(f0).slice(0, 100))
  const d0 = (await request(`/admin/daily-close?date=${today}`, {}, PLATFORM, H)).data.dailyClose.cashDrawer
  const tx0 = (await request(`/admin/stored-value/txns?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.txns.filter((t) => t.userId === u2)
  const rcRow = tx0.find((t) => t.type === 'recharge')
  check('④ 读口扩形:流水带 userId/赠送行/reversed 标', rcRow && rcRow.reversed === false && tx0.some((t) => t.type === 'bonus'), JSON.stringify(tx0).slice(0, 160))

  /* 合同①:赠送行/退款行不许直接冲 —— 两口不许混 */
  const bnRow = tx0.find((t) => t.type === 'bonus')
  const tryBonus = await request(`/admin/stored-value/txns/${bnRow.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: 'CI 夹具:冲销口径回归' }) }, PLATFORM, H)
  check('④ 合同①:对赠送行点冲销 → 400 指回充值行(赠随充一起冲)', tryBonus.status === 400 && /充值行/.test(tryBonus.data?.error?.message || ''))

  /* 合同③:一刀双行 + 全联动 */
  const rev = await request(`/admin/stored-value/txns/${rcRow.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: 'CI 夹具:冲销口径回归' }) }, PLATFORM, H)
  check('🔴 ④ 冲销成功:一刀双行(充值反向 + 赠送反向,同一事务)', rev.status === 201 && rev.data.reversedAmountCents === 50000 && rev.data.reversedBonusCents === 5000, JSON.stringify(rev.data).slice(0, 140))
  const f1 = (await request(`/admin/account-adjust/facts?userId=${u2}`, {}, PLATFORM, H)).data.facts
  check('🔴 ④ 判据⑤ 四参考数联动:实付 0 / 赠送 0 / 余额 0(负债−)', f1.paidCents === 0 && f1.bonusCents === 0 && f1.balanceCents === 0, JSON.stringify({ p: f1.paidCents, b: f1.bonusCents, bal: f1.balanceCents }))
  const d1 = (await request(`/admin/daily-close?date=${today}`, {}, PLATFORM, H)).data.dailyClose.cashDrawer
  check('🔴 ④ 判据⑤ 抽屉联动:当日现金较冲销前 −500(充值现金腿被红字抵平),损益仍恒 0',
    d0.rechargeCashCents - d1.rechargeCashCents === 50000 && d1.incomeImpactCents === 0,
    JSON.stringify({ before: d0.rechargeCashCents, after: d1.rechargeCashCents }))
  /* 裁定B(08-30f 动作落点律):冲销负行单列 + 行内点名冲销单与原充值日期(负数不许无解释地出现) */
  const revRow = (d1.rows || []).find((r2) => r2.label === '储值冲销红字(非当日经营收支)')
  check('🔴 ④ 裁定B 负行点名注:抽屉算式里冲销红字单列一行,note 点名冲销单 id 与原充值日期',
    revRow && revRow.negative === true && revRow.amountCents === 55000
    && new RegExp(`冲销单 ${rev.data.reversal.id}(原充值 \\d{4}-\\d{2}-\\d{2})`.replace(/[()]/g, '\\$&')).test(revRow.note || '')
    || (revRow && /冲销单 sv_.+原充值 \d{4}-\d{2}-\d{2}/.test(revRow.note || '') && revRow.negative),
    JSON.stringify(revRow || d1.rows).slice(0, 200))
  const tx1 = (await request(`/admin/stored-value/txns?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.txns.filter((t) => t.userId === u2)
  check('④ 合同③:原两行标「已冲销」保留 + 两条红字反向行在(冲充值带原渠道/冲赠送 marketing)',
    tx1.find((t) => t.id === rcRow.id).reversed === true && tx1.find((t) => t.id === bnRow.id).reversed === true
    && tx1.filter((t) => t.type === 'reversal').length === 2
    && tx1.some((t) => t.type === 'reversal' && t.amountCents === -50000)
    && tx1.some((t) => t.type === 'reversal' && t.amountCents === -5000),
    JSON.stringify(tx1.map((t) => [t.type, t.amountCents, t.reversed])).slice(0, 180))
  check('④ 幂等:再冲同一笔 → 400 ALREADY_REVERSED', (await request(`/admin/stored-value/txns/${rcRow.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: 'CI 夹具:冲销口径回归' }) }, PLATFORM, H)).data?.error?.code === 'ALREADY_REVERSED')

  /* 裁定A(08-30f):前置闸=双水位证明 —— 实付余额≥该笔实付 且 赠送余额≥该笔赠送 */
  const imp3 = (await request(`/platform/tenants/${tid}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `动过钱客${RUN}`, phone: `135${RUN.slice(-8)}` }] }) })).data
  const u3 = imp3.users[0].userId
  await bindWechatViaFrontDoor({ base: BASE_URL, tenantId: tid, userId: u3, phone: `135${RUN.slice(-8)}`, tag: `rev3-${RUN}` })
  await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: u3, amountCents: 30000, payChannel: 'cash' }) }, PLATFORM, H)
  const tx3 = (await request(`/admin/stored-value/txns?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.txns.find((t) => t.userId === u3 && t.type === 'recharge')
  await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: u3, amountCents: 1000, payChannel: 'cash', reason: '动一分钱', requestId: `rv3-${RUN}` }) }, PLATFORM, H)
  const gate = await request(`/admin/stored-value/txns/${tx3.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: 'CI 夹具:验业务闸(不是验事由闸)' }) }, PLATFORM, H)
  check('🔴 ④ 裁定A 水位不足即拒(退 10 后实付水位 290 < 该笔 300)→ 新句「余额已不足以证明…」',
    gate.status === 400 && gate.data?.error?.message === '余额已不足以证明这笔未消费,请走退卡。', JSON.stringify(gate.data).slice(0, 120))

  /* 裁定A 放宽生效证明:旧保守闸会拒(之后动过钱),双水位闸放行(两侧仍各自足额) */
  const imp4 = (await request(`/platform/tenants/${tid}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `放宽客${RUN}`, phone: `134${RUN.slice(-8)}` }] }) })).data
  const u4 = imp4.users[0].userId
  await bindWechatViaFrontDoor({ base: BASE_URL, tenantId: tid, userId: u4, phone: `134${RUN.slice(-8)}`, tag: `rev4-${RUN}` })
  await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: u4, amountCents: 10000, bonusCents: 5000, payChannel: 'cash' }) }, PLATFORM, H)
  const tx4 = (await request(`/admin/stored-value/txns?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.txns.find((t) => t.userId === u4 && t.type === 'recharge')
  await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: u4, amountCents: 20000, payChannel: 'cash' }) }, PLATFORM, H)
  await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: u4, amountCents: 3000, payChannel: 'cash', reason: '之后动过钱但水位足', requestId: `rv4-${RUN}` }) }, PLATFORM, H)
  const relax = await request(`/admin/stored-value/txns/${tx4.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: 'CI 夹具:验业务闸(不是验事由闸)' }) }, PLATFORM, H)
  check('🔴 ④ 裁定A 放宽生效:之后动过钱但两侧水位仍足 → 201(旧保守闸会拒的形)',
    relax.status === 201 && relax.data.reversedAmountCents === 10000 && relax.data.reversedBonusCents === 5000, JSON.stringify(relax.data).slice(0, 120))

  /* 裁定A 判据刀②的常驻形:构造「总余额足、赠送侧不足」——只验总余额的闸会放行=打负(变异刀①打这里) */
  const imp5 = (await request(`/platform/tenants/${tid}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `侧亏客${RUN}`, phone: `133${RUN.slice(-8)}` }] }) })).data
  const u5 = imp5.users[0].userId
  await bindWechatViaFrontDoor({ base: BASE_URL, tenantId: tid, userId: u5, phone: `133${RUN.slice(-8)}`, tag: `rev5-${RUN}` })
  await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: u5, amountCents: 10000, bonusCents: 10000, payChannel: 'cash' }) }, PLATFORM, H)
  const tx5 = (await request(`/admin/stored-value/txns?month=${today.slice(0, 7)}`, {}, PLATFORM, H)).data.txns.find((t) => t.userId === u5 && t.type === 'recharge')
  await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId: u5, amountCents: 50000, payChannel: 'cash' }) }, PLATFORM, H)
  /* 直插一条吃掉赠送水位的退款行(bonus_part=60):总余额仍富余,赠送侧 40 < 该笔赠送 100 */
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bonus_part_cents)
    VALUES (?, ?, ?, 'refund', -6000, 'cash', '夹具:吃赠送水位', 'suite', ?, 6000)`).run(`svfix-${RUN}`, tid, u5, new Date().toISOString())
  const sideGate = await request(`/admin/stored-value/txns/${tx5.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: 'CI 夹具:验业务闸(不是验事由闸)' }) }, PLATFORM, H)
  check('🔴 ④ 裁定A 侧水位:总余额足(540)但赠送侧 40<100 → 拒(冲了赠送侧就打负)',
    sideGate.status === 400 && /余额已不足以证明/.test(sideGate.data?.error?.message || ''), JSON.stringify(sideGate.data).slice(0, 120))

  /* 权限:无 token → 401/403(requireRefundRight 同门) */
  check('④ 越权:未登录打冲销口 → 拒', (await request(`/admin/stored-value/txns/${rcRow.id}/reverse`, { method: 'POST' }, null, H)).status >= 401)
}

console.log(`\n✅ test-mini-account-adjust 通过 ${checks} 项`)
