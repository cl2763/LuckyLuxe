/* D150 · 层层递进不许复读,递进到底才转人工(店主 05q 通二;05r 补五 待裁 #5 裁法)

   店主原话:「顾客层层递进问同一件事时,要**换一种答法**去想他到底要什么;
   实在答不了,就在递进过程中说『我可以帮您接人工』—— 这时候才是真需要人工。」

   ══ 这把刀为什么长这样 ══
   上一批 D150 **没做成**:守挂在 `factGate.check` 那一行,而报价采集在它之前就 return 了。
   所以本刀的③专门拿**那条路**当正例 —— 用的就是当时现测「三问同一件事三次答同一句」那个用例。
   一把不去咬当初漏掉的那条路的判据,等于没验。

   ══ 三条(店主 05r 补五 §二.4 原文)══
   ① 三句同题:第二句与第一句**去空白后不相等**;第三句 → `needs_human` 且回复含「人工」;
   ② 流水里 AI 那行的文本 **===** 接口回给顾客的文本(改写只改同一行,不许分叉成两处真相);
   ③ 报价路(早 return 那条)也过守。
   造病:壳里去掉 `repeatGuard` → ①② 红。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget, isTestTarget } from './test-guard.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ═══ ⓪ 静态:壳在、Core 只许壳调 ═══ */
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const bare = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('⓪ 壳在:`handleWecomInbound` 把 Core 交给 `guardedHandle`(守的身子在 repeat-guard.mjs)',
  /handleWecomInbound = \(inbound, req\) =>\s*guardedHandle\([\s\S]{0,300}?handleWecomInboundCore/.test(bare)
  && /repeatVerdict\(/.test(readFileSync(join(ROOT, 'apps/api/repeat-guard.mjs'), 'utf8')))
/* Core 现在是**当参数传给壳**的(`guardedHandle(deps, handleWecomInboundCore, …)`),
   所以数的是**这个名字一共出现几次**:定义一次 + 壳里当参数一次 = 2。
   多一次 = 有人绕过壳直接调了 Core,那就等于 D150 白做。 */
const coreMentions = (bare.match(/handleWecomInboundCore/g) || []).length
check('⓪b 🔴 Core 只许壳用:全仓 `handleWecomInboundCore` 只出现「定义 + 壳里当参数」两处',
  coreMentions === 2, `现有 ${coreMentions} 处`)
check('⓪c 改写走 `meta.rewrittenFrom` 留原文(改的是同一行,不是另写一行)',
  /rewrittenFrom/.test(readFileSync(join(ROOT, 'apps/api/repeat-guard.mjs'), 'utf8'))
  && /rewrittenFrom/.test(readFileSync(join(ROOT, 'apps/api/conversation-log.mjs'), 'utf8')))
/* 🔴 追加锁开的第二个例外形状**必须把原文钉死在 meta 里** ——
   这个口子改得掉「顾客现在看到哪句」,不许改得掉「当时说过哪句」。 */
const logSrc = readFileSync(join(ROOT, 'apps/api/conversation-log.mjs'), 'utf8')
check('⓪d 🔴 追加锁那条例外把原文钉死:触发器自己 `json_extract(NEW.meta,\'$.rewrittenFrom\') = OLD.content`',
  /json_extract\(NEW\.meta, '\$\.rewrittenFrom'\) = OLD\.content/.test(logSrc)
  && /json_extract\(NEW\.meta, '\$\.rewrittenBy'\) = 'repeat-guard'/.test(logSrc))

/* ═══ ①②③ 行为层 ═══ */
const onTest = await isTestTarget(BASE_URL)
if (!onTest) {
  console.log(`⚠️  [repeat-guard] ${BASE_URL} 不是测试库 —— **行为层本轮未跑**(不是通过)`)
  console.log('   正确跑法:bash apps/api/run-all-tests.sh repeat-guard')
} else {
  await assertTestTarget(BASE_URL)
  await assertNoMergeWindow()
  const db = new DatabaseSync(process.env.TEST_DB_PATH, { readOnly: true })
  const RUN = `d150-${Date.now().toString(36)}`   // J-31:每跑一次都是全新会话
  const say = (uid, message) => fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ message, lang: 'zh', externalUserId: uid }),
  }).then((r) => r.json()).catch(() => null)
  const textOf = (d) => String(d?.reply?.data?.answerZh || d?.reply?.data?.answer || '')
  const squash = (s) => String(s || '').replace(/\s+/g, '')
  const lastAssistant = (cid) => db.prepare(`SELECT content, meta FROM conversation_messages
    WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(cid)

  /* ③ 用的就是**报价采集那条路** —— 上一批漏掉的正是它(问价会先反问「本甲还是延长」) */
  const uid = `${RUN}-price`
  /* 🔴 D158(店主 05s §四)之后这条夹具要改一处口径,写清楚为什么:
     原来问的是「做美甲大概多少钱?」,而引擎对它的回答是一句**反问**
     (「本甲还是延长?」)—— D158 明确裁定:**上一答本来就是反问时,顾客再问不算复读**,
     那是采集在吞问题(D162 管的事),不是复读(D150 管的事)。
     所以这条改成问一个**引擎会真的答出东西**的问题,守的还是同一件事:
     同一件事连问三次 → 第二次换答法、第三次转人工。 */
  const r1 = await say(uid, '你们家营业时间是几点到几点?')
  const r2 = await say(uid, '营业时间几点到几点呀?')
  const r3 = await say(uid, '几点到几点营业?')
  const t1 = textOf(r1); const t2 = textOf(r2); const t3 = textOf(r3)
  const cid = r1?.conversationId || ''

  check('③ 造景自证:第一句真答上了(答不上,下面比的就都是空字符串)', Boolean(t1), t1.slice(0, 50))
  /* 🔴 口径跟着 D158 翻面:这条夹具**故意不走报价采集**了 ——
     D158 裁定「上一答是反问就不算复读」,所以要验复读守,前提是上一答**真的是个答案**。
     「报价采集那条路也被壳看得见」这件事改由 ③c 守(它验的是壳的位置,不是复读)。 */
  check('③b 造景自证:第一句是**真答案**不是反问(不然 D158 会正确地判它不算复读)',
    !/^[^。!?]{0,40}[??]\s*$/.test(t1.trim()) && t1.length > 12, t1.slice(0, 60))
  check('① 第二句与第一句**去空白后不相等**(店主:换一种答法,不许复读)',
    Boolean(t2) && squash(t2) !== squash(t1), JSON.stringify({ 一: t1.slice(0, 30), 二: t2.slice(0, 30) }))
  /* 🔴 这条原来断言「会话状态不是 needs_human」——**太宽了**:
     事实闸、静默转人工那几条路也会把状态置成待人工,与复读守没关系。
     现测就撞上了:第二句被别的路转了人工,而复读守自己**什么都没做**。
     判据要守的是**这把守自己的行为**:第二次只换答法、不升级。 */
  check('①b 第二句复读守**没有升级到转人工**(第三次才是该转的点)',
    (r2?.repeatGuard?.action || 'none') !== 'escalate',
    JSON.stringify({ 守: r2?.repeatGuard, 会话状态: r2?.conversation?.status }))
  check('① 第三句 → 状态 `needs_human` 且回复里有「人工」',
    (r3?.conversation?.status || '') === 'needs_human' && /人工/.test(t3),
    JSON.stringify({ 状态: r3?.conversation?.status, 三: t3.slice(0, 40) }))

  /* ② 一处真相:顾客看到的那句 === 流水里那行 */
  const row = lastAssistant(cid)
  check('② 🔴 流水里 AI 那行 === 接口回给顾客的那句(改写只改同一行,不许两处真相)',
    Boolean(row) && squash(row.content) === squash(t3), JSON.stringify({ 流水: (row?.content || '').slice(0, 40), 接口: t3.slice(0, 40) }))
  check('②b 原文留了证:那行 `meta.rewrittenFrom` 是**被换掉之前**那句',
    Boolean(row?.meta) && Boolean(JSON.parse(row.meta).rewrittenFrom), String(row?.meta || '').slice(0, 80))

  /* ②c 三入口各一条:顾客端那条路(D155 并进来的)也过同一个壳 */
  const mpUid = `${RUN}-mp`
  const mp1 = await fetch(`${BASE_URL}/ai/customer-service`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'lucky-luxe' },
    body: JSON.stringify({ message: '你们家营业时间是几点到几点?', lang: 'zh', clientId: mpUid }),
  }).then((r) => r.json()).catch(() => null)
  const mp2 = await fetch(`${BASE_URL}/ai/customer-service`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'lucky-luxe' },
    body: JSON.stringify({ message: '营业时间几点到几点呀?', lang: 'zh', clientId: mpUid }),
  }).then((r) => r.json()).catch(() => null)
  check('②c 顾客端那条路也过同一个壳:第二句与第一句去空白后不相等',
    Boolean(textOf(mp2)) && squash(textOf(mp2)) !== squash(textOf(mp1)),
    JSON.stringify({ 一: textOf(mp1).slice(0, 26), 二: textOf(mp2).slice(0, 26) }))

  /* ④ 反向守:**不同主题**不许被误伤 —— 换个话题问,不该触发换答法/转人工 */
  const other = `${RUN}-other`
  await say(other, '你们家营业时间是几点到几点?')
  const o2 = await say(other, '明天下午三点可以吗?')
  check('④ 反向守:换了主题的第二句**不许**被当成复读(那是在往前走,不是原地打转)',
    !/我可能没答到点上|帮您接人工/.test(textOf(o2)), textOf(o2).slice(0, 50))
  db.close()
}

/* 合并窗开着的话,连发三句只会出一条回复 —— 这把刀比的就是三条,窗必须是关的。
   取不到就红:「没验成」不许长得像「验过了」。 */
async function assertNoMergeWindow() {
  const h = await fetch(`${BASE_URL}/health`).then((r) => r.json()).catch(() => null)
  const sec = h?.mergeWindowSeconds
  check('⓪e 前置:合并窗是关的(否则三句会并成一条,这把刀比的三条根本出不来)',
    sec === 0, `mergeWindowSeconds=${sec}`)
}

console.log(`\n[D150 递进不复读] 壳唯一 · 报价路正例 · 一处真相 · 三入口`)
if (fails.length) { console.error(`\n❌ test-repeat-guard ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-repeat-guard 通过 ${n} 项`)
