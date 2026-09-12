/* 已报价状态机回归(店主 31p 开工令;方案判据草案五条+两刀)
   ①切会话形 ②过期翻态 ③改价防线 409/留痕 ④横幅句后端出+两端渲染链 ⑤设置口闸
   ⚠️ standalone:CI_SUITES="quote-state" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { readFileSync } from 'node:fs'

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
const { DatabaseSync } = await import('node:sqlite')
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
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

/* ===== 31q AI 改口(裁定2 单收口;条件:B 态才注入 + 新句单独断言 + matrix 66 原样全绿) ===== */
{
  // 造 B 态:同会话再钉一笔已过期报价(会话已在①切段成新会话 —— 先把报价拉回本会话再拨过期)
  const convRow = db.prepare('SELECT transcript_json FROM wechat_conversations WHERE id = ?').get(convId)
  const times = JSON.parse(convRow.transcript_json).map((m) => new Date(m.at).getTime()).filter(Boolean)
  let sessStart = times[0]
  for (let i = 1; i < times.length; i += 1) { if (times[i] - times[i - 1] > 6 * 3600000) sessStart = times[i] }
  const sk = new Date(sessStart).toISOString()
  db.prepare('UPDATE quote_requests SET session_key = ?, quoted_at = ?, expires_at = ? WHERE conversation_id = ? AND tenant_id = ? AND staff_price_cents IS NOT NULL')
    .run(sk, new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() - 60000).toISOString(), convId, tid)
  const st = (await request('/admin/wechat/conversations', {}, PLATFORM, H)).data.conversations.find((c) => c.id === convId)
  check('改口夹具:会话回到 B 态(已过期)', st.quoteState?.state === 'expired', JSON.stringify(st.quoteState).slice(0, 100))
  const rep = await request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: extUser, message: '那就按上次说的价格约吧' }) }, PLATFORM, H)
  const aiText = rep.data?.reply?.data?.answerZh || rep.data?.conversation?.lastAssistantMessage || ''
  const trans = JSON.parse(db.prepare('SELECT transcript_json FROM wechat_conversations WHERE id = ?').get(convId).transcript_json)
  const lastAssistant = [...trans].reverse().find((m) => m.role === 'assistant')
  check('🔴 31q 改口注入:B 态进线,助手回复以「上次报价已过期,我帮您重新确认。」开头(transcript 现测)',
    Boolean(lastAssistant) && lastAssistant.content.startsWith('上次报价已过期,我帮您重新确认。'), (lastAssistant?.content || '').slice(0, 80))
  // 反向守:非 B 态会话零注入
  const ext2 = `qs-clean-${RUN}`
  await request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: ext2, message: '你们几点开门?' }) }, PLATFORM, H)
  const conv2 = (await request('/admin/wechat/conversations', {}, PLATFORM, H)).data.conversations.find((c) => c.externalUserId === ext2)
  const trans2 = JSON.parse(db.prepare('SELECT transcript_json FROM wechat_conversations WHERE id = ?').get(conv2.id).transcript_json)
  const la2 = [...trans2].reverse().find((m) => m.role === 'assistant')
  check('31q 反向守:无过期报价的会话,回复零改口句', !la2 || !la2.content.includes('上次报价已过期'), (la2?.content || '').slice(0, 60))
  /* 机械(裁定2 可证性,落地勘正版):transcript 助手写入漏斗全仓恰两条函数;
     漏斗外零 `role: 'assistant'` 的 transcript push(新写法自动红)—— 「漏一个分支」从不可证变可证 */
  /* 🔴 04c:扫描面**跟着文件走** —— D132 把会话读写域搬去了 `wecom-conversation.mjs`,
     只读 local-server 的话 `appendWecomConversationMessage` 从扫描面上消失、判据静默变绿。
     这正是 03o「路由搬进新模块,扫描器照样绿」的同一课。 */
  /* 05k:`recordWecomConversation` 搬去了 `wecom-record.mjs`,扫描面照这条注释跟着走。 */
  const SRC_FILES = ['./local-server.mjs', './wecom-conversation.mjs', './wecom-record.mjs']
  const srv = SRC_FILES.map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
    .join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const pushSites = [...srv.matchAll(/transcript\.push\(\{\s*role: 'assistant'/g)].length
  check('31q 机械①:裸 transcript.push(assistant) 恰 3 处、全在 recordWecomConversation 漏斗内且逐条带注入',
    pushSites === 3 && (srv.match(/injectRepriceIfExpired\(conversationId,/g) || []).length >= 4, String(pushSites))
  const appendFn = srv.slice(srv.indexOf('function appendWecomConversationMessage'), srv.indexOf('function appendWecomConversationMessage') + 900)
  check('31q 机械②:appendWecomConversationMessage 漏斗内有注入(assistant 才注)',
    appendFn.includes("message.role === 'assistant'") && appendFn.includes('injectRepriceIfExpired('))
}

console.log(`✅ test-quote-state 通过 ${checks} 项`)
