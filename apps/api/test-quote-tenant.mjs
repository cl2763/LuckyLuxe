/* 🔴 D131 红线两处的**行为判据**(店主 04b §二 第 2 条,2026-09-03 落)

   ══ 为什么静态刀不够 ══
   `test-tenant-explicit` 只能证明「源码里每处 INSERT 都写了 tenant_id」;
   它证不了「**非默认租户下这条路真的能走通**」。而病的形状恰恰是:
   在默认租户下一切正常(靠列默认值 `lucky-luxe` 凑对),换个租户才断。
   店主 04b 原话:**「只在默认租户下跑,又正好测不出它。」**

   ══ 病(修前)══
   `createQuoteRequest` / `scheduleReminderTask` 的 INSERT 不带 tenant_id → 落列默认;
   而状态机按租户读(`quote-state.mjs:86/124`)、报价台按租户列(`getAdminQuoteRequests`):
   · 非默认租户的顾客提一次报价 → 单落在旗舰店名下 → **自己的状态机永远找不到自己刚建的单**;
   · 旗舰店的报价台 → **列得出别店顾客的报价**(跨租户泄露)。

   ══ 判据形状 ══
   全程在**新建的非默认租户**里走完整条路(两轮进线 → 技师报价 → 第三轮进线),
   四处落点逐个验;再加两条反向守(本店列得出 / 租户来源不一致必须抛错)。

   ⚠️ standalone:CI_SUITES="quote-tenant" bash apps/api/run-all-tests.sh */
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

const tid = `qt-${RUN}`
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `报价租户店${RUN}`, plan: 'chain' }) })
check(`前置:建了一家**非默认租户** \`${tid}\`(默认租户会把「靠默认值凑对」的病全遮住)`,
  made.status === 201, JSON.stringify(made.data).slice(0, 160))

const uid = `qtc-${RUN}`
const chat = (message) => request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: uid, message }) }, H)

/* 两轮进线走完报价采集(第一轮出模板,第二轮填完才建单) */
await chat('想做渐变猫眼加两颗小钻,大概多少钱?')
const turn2 = await chat('1. 项目类型:美甲\n2. 想做日期和时间:明天下午三点\n3. 是否需要卸甲:需要\n'
  + '4. 是否需要延长:不需要\n5. 是否有断甲需要修补:没有\n6. 是否有参考图:无图\n7. 其他备注:无')
check('前置:两轮进线走完报价采集(第二轮才建单)', turn2.status === 201, String(turn2.status))

const DBP = process.env.TEST_DB_PATH || ''
if (!DBP) {
  check('前置:拿得到 TEST_DB_PATH 才能验库里的落点 —— 取不到就红,不许静默跳过(断言增量律)', false, '未设')
} else {
  const db = new DatabaseSync(DBP, { readOnly: true })
  /* D132 起会话 id 带租户(`wecom:<租户>:<外部用户>`)—— 不拼 id,按会话表的外部用户 id 反查 */
  const quote = db.prepare(`SELECT q.* FROM quote_requests q JOIN wechat_conversations c ON c.id = q.conversation_id
    WHERE c.external_user_id = ? ORDER BY q.created_at DESC LIMIT 1`).get(uid)
  check('① 🔴 报价单落在**本店**,不是旗舰店 —— '
    + '修前这条 INSERT 不带 tenant_id,落列默认 `lucky-luxe`',
  !!quote && quote.tenant_id === tid, JSON.stringify({ 有单: !!quote, tenant: quote?.tenant_id, 应为: tid }))

  const rt = quote ? db.prepare('SELECT * FROM reminder_tasks WHERE quote_request_id = ?').all(quote.id) : []
  check('② 🔴 同一动作产生的**提醒任务**也落本店 —— '
    + '调度器逐租户扫,挂错店就永远轮不到它',
  rt.length > 0 && rt.every((r) => r.tenant_id === tid), JSON.stringify(rt.map((r) => ({ type: r.type, tenant: r.tenant_id }))))
  db.close()

  /* 技师报价 → 第三轮进线:状态机必须**在本租户里找得到自己刚建的单** */
  const qid = quote?.id
  if (qid) {
    const marked = await request(`/admin/quote-requests/${qid}/mark-quoted`, { method: 'POST', body: JSON.stringify({ priceCents: 19800 }) }, H)
    const turn3 = await chat('好的谢谢')
    const st = turn3.data?.conversation?.quoteState || {}
    check('③ 🔴 状态机在本租户里**找得到自己刚建的单**(quoteState = quoted)—— '
      + '`quote-state.mjs` 按 `conversation_id + tenant_id` 查;单落错店时这里永远是 none,'
      + '**状态机在非默认租户下就是断的**',
    marked.status === 200 && st.state === 'quoted' && st.quoteRequestId === qid,
    JSON.stringify({ mark: marked.status, state: st.state, id: st.quoteRequestId }))

    const boss = await request('/admin/quote-requests')
    const bossIds = (boss.data?.quoteRequests || []).map((q) => q.id)
    check('④ 🔴 旗舰店报价台**列不出**别店的报价单(跨租户泄露)',
      !bossIds.includes(qid), `旗舰店列出 ${bossIds.length} 条,含本单=${bossIds.includes(qid)}`)

    const mine = await request('/admin/quote-requests', {}, H)
    const mineIds = (mine.data?.quoteRequests || []).map((q) => q.id)
    check('④b 反向守:**本店**报价台列得出它 —— '
      + '一把「谁都列不出」的尺子证明不了隔离(全拒也能让 ④ 绿)',
    mineIds.includes(qid), `本店列出 ${mineIds.length} 条`)
  } else {
    check('③ 前置:没建出报价单,后面三条无从谈起(不静默跳过,如实红)', false, '')
    check('④ 同上', false, '')
    check('④b 同上', false, '')
  }
}

/* ⑤ 一个字段只回答一个问题:租户来源不一致必须**抛错**,不许"取到哪个算哪个" */
const uid2 = `qtx-${RUN}`
await request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: uid2, message: '你好' }) }, H)
if (DBP) {
  const w = new DatabaseSync(DBP)
  w.prepare('UPDATE wechat_conversations SET tenant_id = ? WHERE external_user_id = ?').run('lucky-luxe', uid2)
  w.close()
}
const mism = await request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: uid2, message: '想做美甲多少钱?' }) }, H)
const mism2 = mism.status === 201
  ? await request('/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: uid2, message: '1. 项目类型:美甲\n2. 想做日期和时间:明天下午三点\n3. 是否需要卸甲:需要\n4. 是否需要延长:不需要\n5. 是否有断甲需要修补:没有\n6. 是否有参考图:无图\n7. 其他备注:无' }) }, H)
  : mism
check('⑤ 🔴 租户来源不一致 → **抛错**(TENANT_MISMATCH),不许"取到哪个算哪个" —— '
  + '会话说 A 店、请求上下文说 B 店时,报价单该记谁?一个字段只回答一个问题',
  mism2.status >= 500 && String(JSON.stringify(mism2.data)).includes('TENANT_MISMATCH'),
  `${mism2.status} ${JSON.stringify(mism2.data).slice(0, 160)}`)

console.log(`\n[报价租户] 全程在非默认租户 ${tid} 里走:两轮进线 → 技师报价 → 第三轮进线;四处落点 + 两条反向守`)
if (fails.length) { console.error(`\n❌ test-quote-tenant ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-quote-tenant 通过 ${checks} 项`)
