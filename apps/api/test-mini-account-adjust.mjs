/* 二.1 · 账户调整+退卡上小程序(店主 08-27 裁「账户调整=双端」,欠最久的一笔;双端同批律)。

   合同:客户档案 → 账户调整,四 tab 与网页同源;退卡的全部硬拦、拆账、黄条走**同一后端出口**,
   前端不许再写一套;权限同网页(店员看不见,接口层 requireRefundRight 兜底)。

   ⚠️ standalone:CI_SUITES="mini-account-adjust" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { readFileSync } from 'node:fs'

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
check('① 充值/赠送/冲销=指路不造第二写口(与网页同策略)', aa.includes('goElsewhere') && !aa.includes("stored-value/recharge'"))
check('① 页面 guardOwner(店员连入口页都进不来)+ 财务门禁先例(lock-status + getFinanceKey)',
  aa.includes('guardOwner') && aa.includes('finance/lock-status') && aa.includes('getFinanceKey'))
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
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH') })())
db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`maa-${RUN}`, userId)
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

console.log(`\n✅ test-mini-account-adjust 通过 ${checks} 项`)
