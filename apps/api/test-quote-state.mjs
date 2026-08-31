/* 已报价状态机回归(店主 31p 开工令;方案判据草案五条+两刀)
   ①切会话形 ②过期翻态 ③改价防线 409/留痕 ④横幅句后端出+两端渲染链 ⑤设置口闸
   ⚠️ standalone:CI_SUITES="quote-state" bash apps/api/run-all-tests.sh */
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
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH') })())

/* ===== 夹具:临时店 + 一条 mock 会话 + 一张报价单 ===== */
const tid = `qs-${RUN}`
check('夹具:建店 201', (await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `报价态店${RUN}`, plan: 'chain' }) })).status === 201)
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const extUser = `qs-cust-${RUN}`
const chat = await request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: extUser, message: '你好,想做手部美甲,大概多少钱?' }) }, PLATFORM, H)
check('夹具:mock 进线 201', chat.status === 201, String(chat.status))
const convId = chat.data?.conversation?.id || (await request('/admin/wechat/conversations', {}, PLATFORM, H)).data.conversations?.[0]?.id
check('夹具:会话在', Boolean(convId), convId)
// 报价单:直连库造最小行(挂该会话;quote_requests 由进线常建 —— 有就用)
let qr = db.prepare('SELECT id FROM quote_requests WHERE conversation_id = ? AND tenant_id = ?').get(convId, tid)
if (!qr) {
  const qid = `qr-${RUN}`
  db.prepare(`INSERT INTO quote_requests (id, tenant_id, conversation_id, service_type, status, customer_message, created_at, updated_at)
    VALUES (?, ?, ?, 'nail', 'PENDING_STAFF', '想做手部美甲', ?, ?)`).run(qid, tid, convId, new Date().toISOString(), new Date().toISOString())
  qr = { id: qid }
}

/* ===== ⑤ 设置口:默认 + 闸 ===== */
{
  const st = (await request('/admin/quote-settings', {}, PLATFORM, H)).data
  check('⑤ 默认 6h/48h(31p 核答照准)', st.gapHours === 6 && st.validHours === 48, JSON.stringify(st))
  check('⑤ 后端闸:豁口 100h → 400', (await request('/admin/quote-settings', { method: 'PUT', body: JSON.stringify({ gapHours: 100 }) }, PLATFORM, H)).status === 400)
  check('⑤ 后端闸:有效期 400h → 400', (await request('/admin/quote-settings', { method: 'PUT', body: JSON.stringify({ validHours: 400 }) }, PLATFORM, H)).status === 400)
}

/* ===== A 态:mark-quoted → 本次会话已报价(横幅句后端出) ===== */
{
  const mk = await request(`/admin/quote-requests/${qr.id}/mark-quoted`, { method: 'POST', body: JSON.stringify({ priceCents: 128800, note: '首报' }) }, PLATFORM, H)
  check('🔴 A 态夹具:mark-quoted 200 且带 expiresAt(=now+48h)', mk.status === 200 && Boolean(mk.data.expiresAt), JSON.stringify(mk.data).slice(0, 140))
  const conv = (await request('/admin/wechat/conversations', {}, PLATFORM, H)).data.conversations.find((c) => c.id === convId)
  check('🔴 A 态:quoteState=quoted,横幅句后端出(含价与有效期字样)',
    conv.quoteState?.state === 'quoted' && /本次会话已报价/.test(conv.quoteState.banner) && /有效期至/.test(conv.quoteState.banner),
    JSON.stringify(conv.quoteState))
}

/* ===== ③ 改价防线:同会话不同价 → 409 人话句;confirmOverride → 200 + 留痕 ===== */
{
  const qid2 = `qr2-${RUN}`
  db.prepare(`INSERT INTO quote_requests (id, tenant_id, conversation_id, service_type, status, customer_message, created_at, updated_at)
    VALUES (?, ?, ?, 'nail', 'PENDING_STAFF', '同会话第二单', ?, ?)`).run(qid2, tid, convId, new Date().toISOString(), new Date().toISOString())
  const clash = await request(`/admin/quote-requests/${qid2}/mark-quoted`, { method: 'POST', body: JSON.stringify({ priceCents: 98800 }) }, PLATFORM, H)
  check('🔴 ③ 改价防线:同会话有效价不同、未确认 → 409 QUOTE_OVERRIDE_NEEDED',
    clash.status === 409 && clash.data.error?.code === 'QUOTE_OVERRIDE_NEEDED', JSON.stringify(clash.data).slice(0, 160))
  check('③ 人话句(31p 追加,后端出):「已由〈技师〉报价 ¥X,确认要按新价 ¥Y 重报吗?」',
    /已由 .+ 报价 .+,确认要按新价 .+ 重报吗?/.test(clash.data.error?.message || ''), clash.data.error?.message)
  const forced = await request(`/admin/quote-requests/${qid2}/mark-quoted`, { method: 'POST', body: JSON.stringify({ priceCents: 98800, confirmOverride: true }) }, PLATFORM, H)
  check('③ confirmOverride → 200', forced.status === 200, String(forced.status))
  const trail = db.prepare('SELECT * FROM quote_price_changes WHERE tenant_id = ? AND conversation_id = ?').all(tid, convId)
  check('🔴 ③ 改价留痕:quote_price_changes 恰 1 行,old 1288 → new 988',
    trail.length === 1 && trail[0].old_cents === 128800 && trail[0].new_cents === 98800, JSON.stringify(trail))
}

/* ===== ② 过期翻态(直写库把 expires_at 拨到过去 —— 读时判,不等真时钟) ===== */
{
  db.prepare('UPDATE quote_requests SET expires_at = ? WHERE conversation_id = ? AND tenant_id = ?')
    .run(new Date(Date.now() - 3600000).toISOString(), convId, tid)
  const conv = (await request('/admin/wechat/conversations', {}, PLATFORM, H)).data.conversations.find((c) => c.id === convId)
  check('🔴 ② 过期翻态:quoteState=expired,横幅「已过期…需重新确认」',
    conv.quoteState?.state === 'expired' && /已过期/.test(conv.quoteState.banner) && /需重新确认/.test(conv.quoteState.banner),
    JSON.stringify(conv.quoteState))
}

/* ===== ① 切会话形:把 transcript 拨老 7 小时 → 新消息=新会话 → 历史报价参考 ===== */
{
  const row = db.prepare('SELECT transcript_json FROM wechat_conversations WHERE id = ?').get(convId)
  const t = JSON.parse(row.transcript_json).map((m) => ({ ...m, at: new Date(new Date(m.at).getTime() - 7 * 3600000).toISOString() }))
  db.prepare('UPDATE wechat_conversations SET transcript_json = ? WHERE id = ?').run(JSON.stringify(t), convId)
  db.prepare('UPDATE quote_requests SET quoted_at = ?, session_key = ? WHERE conversation_id = ? AND tenant_id = ? AND quoted_at IS NOT NULL')
    .run(new Date(Date.now() - 7 * 3600000).toISOString(), new Date(Date.now() - 7 * 3600000).toISOString(), convId, tid)
  const chat2 = await request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: extUser, message: '在吗,还想问问价格' }) }, PLATFORM, H)
  check('① 夹具:7 小时后再进线 201', chat2.status === 201)
  const conv = (await request('/admin/wechat/conversations', {}, PLATFORM, H)).data.conversations.find((c) => c.id === convId)
  check('🔴 ① 切会话:超 6h 豁口 → 新会话,旧价翻「历史报价参考」句(N 天/尚未报价字样)',
    conv.quoteState?.state === 'reference' && /历史报价参考/.test(conv.quoteState.banner) && /本次尚未报价/.test(conv.quoteState.banner),
    JSON.stringify(conv.quoteState))
}

/* ===== ④ 两端渲染链(机械;判据匹配带界定) ===== */
{
  const webDesk = readFileSync(new URL('../web/ai-desk.js', import.meta.url), 'utf8')
  const miniConvJs = readFileSync(new URL('../../miniprogram/pages/merchant/conversation/index.js', import.meta.url), 'utf8')
  const miniConvWxml = readFileSync(new URL('../../miniprogram/pages/merchant/conversation/index.wxml', import.meta.url), 'utf8')
  check('🔴 ④ 两端横幅渲染链:web qs-banner + mini quoteBanner 绑定都在,且句子零前端拼串(前端零「本次会话已报价」字面)',
    webDesk.includes('conversation.quoteState') && webDesk.includes('class="qs-banner ')
    && miniConvJs.includes('c.quoteState && c.quoteState.banner') && miniConvWxml.includes('{{quoteBanner}}')
    && !webDesk.includes('本次会话已报价') && !miniConvJs.includes('本次会话已报价'))
}

console.log(`✅ test-quote-state 通过 ${checks} 项`)
