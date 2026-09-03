/* 🔴 D132 会话归店(店主 04c §二 口径 + 判据 1–5,2026-09-03 落)

   ══ 病(修前,04b 现测)══
   `wechat_conversations.id` 是全局主键 `wecom:<externalUserId>`,14 处 `WHERE id = ?` 一处不带租户。
   非默认租户的顾客走完两轮报价后,**旗舰店用同一个 externalUserId 进线一句就拿回了那家店的整份 transcript**
   (含对方品牌名),自己的消息还被追加进了别人家的会话。

   ══ 口径(店主 04c §二 裁)══
   会话 = (租户, 渠道, 外部用户);唯一索引;新 id 形态 `wecom:<租户>:<外部用户>`;存量 id 不改。
   企微租户来源改成 `open_kfid → 租户` 映射,**映射不到 = 拒收**(200 回企微 + `wecom_unrouted` 留痕,
   不建会话、不落默认租户)。

   ⚠️ standalone:CI_SUITES="conversation-tenant" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)

let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
async function request(path, options = {}, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${PLATFORM}`, ...extra, ...(options.headers || {}) },
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}

const A = `cta-${RUN}`
const B = `ctb-${RUN}`
const HA = { 'x-admin-tenant-id': A, 'x-tenant-id': A }
const HB = { 'x-admin-tenant-id': B, 'x-tenant-id': B }
for (const [tid, name] of [[A, 'A店'], [B, 'B店']]) {
  const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `${name}${RUN}`, plan: 'chain' }) })
  if (made.status !== 201) throw new Error(`建店失败 ${tid}: ${JSON.stringify(made.data)}`)
}
/* 两家店**同一个外部用户 id** —— 这正是 04b 探针那条病的形状 */
const UID = `shared-${RUN}`
const chat = (H, message) => request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: UID, message }) }, H)

await chat(HA, 'A店消息一:想做美甲')
await chat(HA, 'A店消息二:再问一句')
await chat(HB, 'B店消息一:我在另一家店')

const DBP = process.env.TEST_DB_PATH || ''
if (!DBP) {
  check('前置:拿得到 TEST_DB_PATH —— 取不到就红,不许静默跳过(断言增量律)', false, '未设')
} else {
  const db = new DatabaseSync(DBP, { readOnly: true })
  const rows = db.prepare('SELECT * FROM wechat_conversations WHERE external_user_id = ? ORDER BY tenant_id').all(UID)
  check('① 🔴 两店同号 → **两行会话**,不是一行 —— '
    + '修前 id 是全局主键 `wecom:<uid>`,第二家店的消息会被追加进第一家店那一行',
  rows.length === 2 && new Set(rows.map((r) => r.tenant_id)).size === 2,
  JSON.stringify(rows.map((r) => ({ id: r.id, tenant: r.tenant_id }))))

  const rowA = rows.find((r) => r.tenant_id === A)
  const rowB = rows.find((r) => r.tenant_id === B)
  const txt = (r) => JSON.stringify(JSON.parse(r?.transcript_json || '[]').map((m) => m.content || ''))
  check('①b 🔴 各自的 transcript **只有自己的** —— A 店那行不许出现 B 店说的话,反之亦然',
    !!rowA && !!rowB && txt(rowA).includes('A店消息一') && !txt(rowA).includes('B店消息一')
    && txt(rowB).includes('B店消息一') && !txt(rowB).includes('A店消息一'),
  `A=${txt(rowA).slice(0, 120)} | B=${txt(rowB).slice(0, 120)}`)

  check('①c 新会话 id 带租户(形态 `wecom:<租户>:<外部用户>`)—— 存量老形态 `wecom:<uid>` 不改,靠三元组照样找得到',
    rows.every((r) => r.id === `wecom:${r.tenant_id}:${UID}`), JSON.stringify(rows.map((r) => r.id)))

  /* ① 收尾:A 再进线一句,B 那行**逐字节不变** */
  const beforeB = JSON.stringify(rowB)
  db.close()
  await chat(HA, 'A店消息三:又来一句')
  const db2 = new DatabaseSync(DBP, { readOnly: true })
  const afterB = JSON.stringify(db2.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(rowB?.id))
  check('①d 🔴 A 店再进线一句,**B 店那行逐字节不变** —— 这就是 04b 那条病的反面',
    beforeB === afterB, `前 ${beforeB.slice(0, 100)}\n后 ${afterB.slice(0, 100)}`)

  /* ② 读闸:拿 B 的 conversationId 在 A 的上下文里读 */
  const beforeB2 = JSON.stringify(db2.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(rowB?.id))
  db2.close()
  /* 用「接管会话」这条真写口探:它按 conversationId 改 status,是**写**,最能证明闸有没有用 */
  const crossRead = await request(`/admin/wechat/conversations/${encodeURIComponent(rowB?.id || 'x')}/take-over`, { method: 'POST', body: '{}' }, HA)
  const db3 = new DatabaseSync(DBP, { readOnly: true })
  const afterB2 = JSON.stringify(db3.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(rowB?.id))
  db3.close()
  check('② 🔴 读写闸:拿 B 的 conversationId 从 **A 的租户上下文**接管会话 → 拒(4xx),且 B 那行不动',
    crossRead.status >= 400 && beforeB2 === afterB2,
    `${crossRead.status} ${JSON.stringify(crossRead.data).slice(0, 120)}`)

  const ownRead = await request(`/admin/wechat/conversations/${encodeURIComponent(rowB?.id || 'x')}/take-over`, { method: 'POST', body: '{}' }, HB)
  check('②b 反向守:同一个 id 在**自己**的租户上下文里**操作得了**(否则"谁都操作不了"也能让 ② 绿)',
    ownRead.status === 200, `${ownRead.status} ${JSON.stringify(ownRead.data).slice(0, 120)}`)
}

/* ③ kfid 路由:A 的 kfid → 落 A;未映射 kfid → wecom_unrouted +1 且会话表 +0 */
const KA = `kf-${RUN}-a`
const setA = await request(`/platform/tenants/${A}/wecom-kfid`, { method: 'PUT', body: JSON.stringify({ openKfid: KA }) })
check('③ 前置:平台端把 A 店的 open_kfid 映射设上了(webhook 靠它定租户)',
  setA.status === 200 && setA.data?.openKfid === KA, JSON.stringify(setA.data))
const dupe = await request(`/platform/tenants/${B}/wecom-kfid`, { method: 'PUT', body: JSON.stringify({ openKfid: KA }) })
check('③b 🔴 同一个 kfid **不许绑两家店**(绑重了就等于没分店)→ 409',
  dupe.status === 409, `${dupe.status} ${JSON.stringify(dupe.data).slice(0, 120)}`)

/* ③c 🔴 kfid 路由真打 webhook:A 的 kfid → 落 A;B 的 kfid → 落 B;未映射 → 拒收留痕、会话表 +0。
   企微服务器不会发 `x-tenant-id`,所以这条路只能靠 kfid —— 这就是口径③ 的全部理由。 */
const KB = `kf-${RUN}-b`
await request(`/platform/tenants/${B}/wecom-kfid`, { method: 'PUT', body: JSON.stringify({ openKfid: KB }) })
const hook = (kfid, ext) => fetch(`${BASE_URL}/wechat/customer-service/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'text/xml' },
  body: `<xml><OpenKfId>${kfid}</OpenKfId><ToUserName>x</ToUserName><FromUserName>${ext}</FromUserName><MsgType>text</MsgType><Content>你好</Content></xml>`,
}).then((r) => r.status)
if (DBP) {
  const d0 = new DatabaseSync(DBP, { readOnly: true })
  const convBefore = d0.prepare('SELECT COUNT(*) AS n FROM wechat_conversations').get().n
  let unroutedBefore = 0
  try { unroutedBefore = d0.prepare('SELECT COUNT(*) AS n FROM wecom_unrouted').get().n } catch { unroutedBefore = -1 }
  d0.close()
  const sa = await hook(KA, `hookA-${RUN}`)
  const sb = await hook(KB, `hookB-${RUN}`)
  const su = await hook(`kf-${RUN}-none`, `hookX-${RUN}`)
  const d1 = new DatabaseSync(DBP, { readOnly: true })
  const rowA2 = d1.prepare('SELECT tenant_id FROM wechat_conversations WHERE external_user_id = ?').get(`hookA-${RUN}`)
  const rowB2 = d1.prepare('SELECT tenant_id FROM wechat_conversations WHERE external_user_id = ?').get(`hookB-${RUN}`)
  const rowX = d1.prepare('SELECT tenant_id FROM wechat_conversations WHERE external_user_id = ?').get(`hookX-${RUN}`)
  const convAfter = d1.prepare('SELECT COUNT(*) AS n FROM wechat_conversations').get().n
  const unroutedAfter = d1.prepare('SELECT COUNT(*) AS n FROM wecom_unrouted').get().n
  d1.close()
  check('③c 🔴 kfid 路由:A 的 kfid → 落 A 店,B 的 kfid → 落 B 店 —— '
    + '企微不会发 `x-tenant-id`,一个企业只有一条回调 URL,能分店的只有 open_kfid',
  sa === 200 && sb === 200 && rowA2?.tenant_id === A && rowB2?.tenant_id === B,
  JSON.stringify({ sa, sb, a: rowA2?.tenant_id, b: rowB2?.tenant_id }))
  check('③d 🔴 未映射的 kfid → **拒收**:200 回企微(不让它重试)+ `wecom_unrouted` +1,'
    + '**会话表 +0、不落默认租户** —— 「拿不到就回落默认」正是 D128/D130/D131 同一根子',
  su === 200 && !rowX && unroutedAfter === unroutedBefore + 1 && convAfter === convBefore + 2,
  JSON.stringify({ su, 有会话: !!rowX, unrouted: `${unroutedBefore}→${unroutedAfter}`, conv: `${convBefore}→${convAfter}` }))
}

/* ══ ⑤ 🔴 D132 口径④ fail-closed(店主 04d §一 裁)══
   顾客侧公开路由缺失/无效门店标识 → 400 TENANT_REQUIRED,**不再回落旗舰店**。
   04c 那轮是 report-only:整轮回归实测「没带 16 次 / 无效 0 次」,而两个真实顾客端一直带头
   (小程序 `utils/api.js` / 网页 `customer.js`)—— 16 次全是夹具。数看完才放的闸。 */
const plainGet = (p, h = {}) => fetch(`${BASE_URL}${p}`, { headers: h }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
const noHdr = await plainGet('/stores')
const badHdr = await plainGet('/stores', { 'x-tenant-id': `no-such-shop-${RUN}` })
const okHdr = await plainGet('/stores', { 'x-tenant-id': A })
check('⑤ 🔴 顾客侧**没带**门店标识 → 400 TENANT_REQUIRED(不回落旗舰店)—— '
  + '「拿不到就回落默认」与 D128/D130/D131 同一根子:有默认值,打错了不报错',
noHdr.status === 400 && noHdr.data?.error?.code === 'TENANT_REQUIRED', JSON.stringify(noHdr).slice(0, 140))
check('⑤b 🔴 顾客侧**带了无效**门店标识 → 400(不是悄悄换成旗舰店)',
  badHdr.status === 400 && badHdr.data?.error?.code === 'TENANT_REQUIRED', JSON.stringify(badHdr).slice(0, 140))
check('⑤c 反向守:带对了就 200 —— 一把「谁来都 400」的闸跟关了门一样,证明不了它在分辨',
  okHdr.status === 200, `${okHdr.status}`)

/* ④ 静态:全仓顾客侧读会话必须带租户;唯一出口在 wecom-routing.mjs */
const { readFileSync } = await import('node:fs')
const { execFileSync } = await import('node:child_process')
const { join } = await import('node:path')
const { fileURLToPath } = await import('node:url')
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const bare = (x) => x.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*\/\/.*$/gm, '')
const files = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((f) => /^apps\/api\/.*\.mjs$/.test(f) && !/\/(test-|run-)/.test(f))
/* 白名单式:每一处 `FROM wechat_conversations ... WHERE id = ?` 必须同句带 tenant_id;
   例外逐条写理由(理由要能解释「为什么这一处**故意**不带租户」)。 */
const ALLOW = {
  'apps/api/reminder-tasks.mjs': '`tenantForSideEffect` 就是要**读出会话真正属于谁**再跟上下文比对 —— '
    + '它带上租户就永远比不出不一致,等于把自己这条判据废掉',
}
const naked = []
for (const f of files) {
  const src = bare(readFileSync(join(ROOT, f), 'utf8'))
  for (const m of src.matchAll(/FROM\s+wechat_conversations[^;`'"]*?WHERE\s+id\s*=\s*\?([^)]*)\)/gi)) {
    if (/tenant_id/.test(m[0])) continue
    if (ALLOW[f]) continue
    naked.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
  }
}
check(`④ 🔴 白名单式:全仓 ${files.length} 个后端源文件里,`
  + '`FROM wechat_conversations … WHERE id = ?` **每一处都必须同句带 tenant_id** —— '
  + `例外 ${Object.keys(ALLOW).length} 条,逐条写了理由`,
naked.length === 0, naked.join(' | '))

check('④b 🔴 零命中先证刀能咬:不带租户的那种写法必须被咬中,带了的不许被咬中',
  /FROM\s+wechat_conversations[^;`'"]*?WHERE\s+id\s*=\s*\?([^)]*)\)/i.test("db.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(cid)")
  && !/tenant_id/.test("db.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(cid)")
  && /tenant_id/.test("db.prepare('SELECT * FROM wechat_conversations WHERE id = ? AND tenant_id = ?').get(cid, tid)"), '')

console.log(`\n[会话归店] 两店同号 ${UID}:两行会话 / 各自 transcript / 新 id 带租户 / 旁店逐字节不变 / 读闸 / kfid 路由 / 静态白名单`)
if (fails.length) { console.error(`\n❌ test-conversation-tenant ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-conversation-tenant 通过 ${checks} 项`)
