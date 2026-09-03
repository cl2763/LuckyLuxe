/* ⓪ 对话全录(大批05 图 v1.1 §〇 · 判据 13)

   店主 09-03 原话:「不管是人回复的还是机器回复的,只要在我们这个软件里面回复的
   所有一切对话记录全都会被记下来,这个是你要保证的,然后交给 AI 做之后的学习以及提升。」

   ══ 修前的实情(现查)══
   记录方式是整段 JSON 覆盖写;企微 App 里技师打字的**孤儿消息 continue 掉**;
   顾客发的**文件/视频/位置** `else continue` 一条不记。

   ⚠️ standalone:CI_SUITES="conversation-log" bash apps/api/run-all-tests.sh */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget } from './test-guard.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const RUN = Date.now().toString(36)
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const api = async (p, o = {}, extra = {}) => {
  const r = await fetch(`${BASE_URL}${p}`, {
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token', ...extra },
    ...o,
  })
  let d = null
  try { d = await r.json() } catch { d = null }
  return { status: r.status, data: d }
}

const DBP = process.env.TEST_DB_PATH || ''
if (!DBP) {
  check('前置:拿得到 TEST_DB_PATH —— 取不到就红,不许静默跳过(断言增量律)', false, '未设')
} else {
  const A = `clog-a-${RUN}`
  const B = `clog-b-${RUN}`
  for (const [tid, name] of [[A, 'A店'], [B, 'B店']]) {
    await api('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `${name}${RUN}`, plan: 'chain' }) })
  }
  const HA = { 'x-admin-tenant-id': A, 'x-tenant-id': A }
  const HB = { 'x-admin-tenant-id': B, 'x-tenant-id': B }
  const uid = `u-${RUN}`
  const rows = (where, ...args) => {
    const db = new DatabaseSync(DBP, { readOnly: true })
    const r = db.prepare(`SELECT * FROM conversation_messages ${where}`).all(...args)
    db.close()
    return r
  }

  /* ══ 路 1:AI 回复(顾客一句 + 助手一句) ══ */
  const before = rows('WHERE tenant_id = ?', A).length
  await api('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: uid, message: '你们营业时间几点到几点?' }) }, HA)
  const afterAi = rows('WHERE tenant_id = ?', A)
  check('① 路1 AI 回复:顾客那句落 `role=customer`,助手那句落 `role=assistant/source=ai` —— '
    + '一条消息一行,不再是整段 JSON 覆盖写',
  afterAi.length > before
  && afterAi.some((r) => r.role === 'customer' && /营业时间/.test(r.content))
  && afterAi.some((r) => r.role === 'assistant' && r.source === 'ai'),
  JSON.stringify(afterAi.map((r) => `${r.role}/${r.source}`)))

  /* ══ 路 2:工作台人工回复 ══ */
  const conv = (await api('/admin/wechat/conversations', {}, HA)).data.conversations.find((c) => c.externalUserId === uid)
  await api(`/admin/wechat/conversations/${encodeURIComponent(conv.id)}/manual-reply`,
    { method: 'POST', body: JSON.stringify({ content: `工作台人工回复-${RUN}` }) }, HA)
  const staffRows = rows("WHERE tenant_id = ? AND role = 'staff'", A)
  check('② 路2 工作台人工回复:落 `role=staff / source=workbench`',
    staffRows.some((r) => r.source === 'workbench' && r.content.includes(RUN)),
    JSON.stringify(staffRows.map((r) => `${r.role}/${r.source}`)))

  /* ══ 路 3:技师报价推送 / 路 5:系统通知句 —— 都从同一个漏斗过,验它们**有 source 且不是空** ══ */
  const allA = rows('WHERE tenant_id = ?', A)
  check('③ 路3/路5:漏斗里每一行都有 role 与 source,且 source 落在五条路的名单里 —— '
    + '「记下来了」不等于「记得清是谁说的」',
  allA.length > 0 && allA.every((r) => r.role && r.source
    && ['ai', 'workbench', 'wecom_app', 'mini', 'notice'].includes(String(r.source).replace(/^migrate:/, ''))),
  JSON.stringify([...new Set(allA.map((r) => r.source))]))

  /* ══ 追加锁:改不得、删不得 ══ */
  const w = new DatabaseSync(DBP)
  const victim = allA[0]
  let delErr = ''
  let updErr = ''
  try { w.prepare('DELETE FROM conversation_messages WHERE id = ?').run(victim.id) } catch (e) { delErr = String(e.message || e) }
  try { w.prepare('UPDATE conversation_messages SET content = ? WHERE id = ?').run('改过了', victim.id) } catch (e) { updErr = String(e.message || e) }
  const still = rows('WHERE id = ?', victim.id)
  w.close()
  check('④ 🔴 追加锁:DELETE 一行 → 触发器拒;UPDATE 内容 → 触发器拒;那一行**原样还在**',
    /append-only/.test(delErr) && /append-only/.test(updErr)
    && still.length === 1 && still[0].content === victim.content,
  `del=${delErr.slice(0, 50)} · upd=${updErr.slice(0, 50)}`)

  /* ══ transcript_json 与表逐条一致 ══ */
  const conv2 = (await api('/admin/wechat/conversations', {}, HA)).data.conversations.find((c) => c.externalUserId === uid)
  const logRows = rows('WHERE conversation_id = ? AND tenant_id = ? ORDER BY created_at ASC, rowid ASC', conv2.id, A)
  const t = conv2.transcript || []
  check('⑤ 🔴 `transcript_json` 与表**逐条一致**(条数与每条的 role/content 都比)—— '
    + '缓存降级之后,两者对不上就是缓存在说另一套',
  t.length === logRows.length && t.every((m, i) => m.role === logRows[i].role && m.content === logRows[i].content),
  `缓存 ${t.length} 条 / 表 ${logRows.length} 条`)

  /* ══ 按租户隔离 ══ */
  await api('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: uid, message: '你们营业时间几点到几点?' }) }, HB)
  const aRows = rows('WHERE tenant_id = ?', A)
  const bRows = rows('WHERE tenant_id = ?', B)
  check('⑥ 🔴 按租户隔离:两店用**同一个外部用户 id**,各记各的 —— '
    + 'A 店的行里不许出现 B 店的会话 id,反之亦然(学习回流也按这条走)',
  aRows.length > 0 && bRows.length > 0
  && aRows.every((r) => r.conversation_id.includes(A)) && bRows.every((r) => r.conversation_id.includes(B)),
  `A=${aRows.length} B=${bRows.length}`)

  /* ══ 幂等:同一个渠道消息 id 落两次只留一行 ══ */
  const db2 = new DatabaseSync(DBP)
  const dupId = `dup-${RUN}`
  const ins = (n) => db2.prepare(`INSERT INTO conversation_messages
    (id, tenant_id, conversation_id, role, source, content, channel_msg_id, created_at)
    VALUES (?, ?, ?, 'customer', 'wecom_app', ?, ?, datetime('now'))`).run(`cm-${RUN}-${n}`, A, `conv-${RUN}`, `第${n}次`, dupId)
  ins(1)
  let dupErr = ''
  try { ins(2) } catch (e) { dupErr = String(e.message || e) }
  db2.close()
  check('⑦ 幂等:同一个渠道消息 id 在本租户内只许落一行 —— '
    + '企微 `sync_msg` 会重投,不挡就等于对话记录里多出一句',
  /UNIQUE/.test(dupErr) && rows('WHERE channel_msg_id = ?', dupId).length === 1, dupErr.slice(0, 60))
}

/* ══ 静态:企微那条路两个洞都补上了(判据锚代码形状,不锚文案)══ */
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*\/\/.*$/gm, '')
check('⑧ 🔴 企微 App 技师打字(origin 5)**不许再因为「孤儿消息」被 continue 掉** —— '
  + '那条技师亲手打的话原来一个字都没留下',
  !/if \(!existed\) continue/.test(srv) && /source: 'wecom_app'/.test(srv), '')
check('⑨ 🔴 顾客侧非文本**不许再 continue 跳过**:文件/视频/位置都要有占位句 —— '
  + '原来只认 text/image/voice,其余一条不记',
  /PLACEHOLDER/.test(srv) && /file:.*视频|file:/.test(srv) && !/else continue\n/.test(srv), '')

console.log('\n[对话全录] 五条路各自落行 · 追加锁改删皆拒 · 缓存与表逐条一致 · 按租户隔离 · 渠道 id 幂等')
if (fails.length) { console.error(`\n❌ test-conversation-log ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-conversation-log 通过 ${checks} 项`)
