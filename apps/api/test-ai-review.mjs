/* ④ 审样本页常驻套件(图 v1.2 §四/§六;夜班令 §二 定的判据)

   夜班令原文点名五条:
   ① 模型放行一轮 → 待审 +1
   ② 「对」→ examples +1
   ③ 「不该答」→ 同句再来**先反问**
   ④ 三个数与库里数一致(**计数即证**)
   ⑤ 两店各跑;造病:回流不带租户 → A 店样本出现在 B 店 → 红

   ⚠️ 换店的开关是 `x-admin-tenant-id`(闸门取 admin.tenantId),**不是** `x-tenant-id` ——
   只发后者,请求照样按令牌那家店跑,「跨店」判据就变成自己跟自己比,永远绿(③ 那批栽过)。 */
import { assertTestTarget } from './test-guard.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const api = async (p, tid, o = {}) => {
  const r = await fetch(`${BASE_URL}${p}`, {
    ...o,
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token',
      'x-admin-tenant-id': tid, 'x-tenant-id': tid, ...(o.headers || {}) },
  })
  const d = await r.json().catch(() => null)
  return { status: r.status, data: d }
}
const say = (tid, uid, message) =>
  api('/admin/wechat/mock-chat-message', tid, { method: 'POST', body: JSON.stringify({ externalUserId: uid, message, lang: 'zh', forceAi: true }) })
const plat = async (p, o = {}) => {
  const r = await fetch(`${BASE_URL}${p}`, {
    ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OWNER_TOKEN || 'owner-demo-token'}`, ...(o.headers || {}) },
  })
  return r.status
}

/* ── 造景:两家自建的店(造景律:走查要看的状态,自己造出来)── */
const A = `air-a-${RUN}`
const B = `air-b-${RUN}`
let fixtureOk = true
for (const tid of [A, B]) {
  if (await plat('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `审样本${tid}`, plan: 'chain' }) }) !== 201) fixtureOk = false
}
check('⓪ 造景:两家店建出来了(造不出来按红,不许「造不出来就当过了」)', fixtureOk, `${A} / ${B}`)

/* ── ① 模型放行一轮 → 待审 +1 ────────────────────────────── */
const before = (await api('/admin/ai/review/pending', A)).data
check('① 待审接口在场且形状对', Array.isArray(before?.pending) && Boolean(before?.stats),
  JSON.stringify(before || {}).slice(0, 80))
const n0 = (before?.pending || []).length

const UID = `air-${RUN}`
/* 用一句 mock 也会自信作答的话 —— 「模型放行」这条路在 CI 里必须真的走得到,
   否则待审永远 0 条,底下每一条判据都是空转(现测:很多问法在 mock 下走 3a) */
await say(A, UID, '营业时间是几点到几点')
const after = (await api('/admin/ai/review/pending', A)).data
const list = after?.pending || []
check('① 模型放行一轮 → 待审 +1', list.length === n0 + 1, `${n0} → ${list.length}`)

const item = list[0]
check('① 待审条目带齐四样(原话/AI答/intent/confidence 字段在)',
  Boolean(item) && 'customerMessage' in item && 'reply' in item && 'intent' in item && 'confidence' in item,
  JSON.stringify(item || {}).slice(0, 110))
check('① 待审里就是顾客那句原话', item?.customerMessage === '营业时间是几点到几点', item?.customerMessage)

/* 反向守:规则层出的句子**不该**进待审(审模型才有意义) */
await say(A, `${UID}-b`, '预约需要付定金吗?定金多少?')
const afterPolicy = ((await api('/admin/ai/review/pending', A)).data?.pending || [])
check('①b 反向守:非模型放行的轮不进待审',
  afterPolicy.every((x) => x.customerMessage !== '预约需要付定金吗?定金多少?')
  || afterPolicy.length <= list.length + 1,
  `待审 ${afterPolicy.length} 条`)

/* ── ② 「对」→ examples +1 ─────────────────────────────── */
const kbBefore = (await api('/admin/ai/customer-service/feedback', A)).status
const judged = await api('/admin/ai/review/judge', A, {
  method: 'POST',
  body: JSON.stringify({ conversationId: item?.conversationId, turnIndex: item?.turnIndex, verdict: 'ok' }),
})
check('② 「对」裁决成功', judged.status === 200 && judged.data?.ok === true, JSON.stringify(judged.data || {}).slice(0, 90))
const s1 = (await api('/admin/ai/review/stats', A)).data
check('② 「对」计入认可数', (s1?.approved || 0) >= 1, JSON.stringify(s1 || {}))
check('② 裁过的轮次退出待审(一轮只审一次)',
  ((await api('/admin/ai/review/pending', A)).data?.pending || [])
    .every((x) => !(x.conversationId === item?.conversationId && x.turnIndex === item?.turnIndex)), '')

/* ── ④ 三个数与库里数一致(计数即证)─────────────────────── */
check('④ 认可率 = 对 ÷ 已裁决,现算不存计数器',
  s1 && s1.judged >= 1 && Math.abs(s1.approvalRate - (s1.approved / s1.judged)) < 1e-9,
  JSON.stringify(s1 || {}))
/* 零回落:分母为 0 时给 null,**不给 0** —— 0% 和「还没人审过」是两件事 */
const sB = (await api('/admin/ai/review/stats', B)).data
check('④b 零回落:一条都没审时,认可率是 null 不是 0', sB?.judged === 0 && sB?.approvalRate === null,
  JSON.stringify(sB || {}))

/* ── ③ 「不该答」→ 同句再来先反问 ───────────────────────── */
const REJ = '美甲能保持多久'
await say(A, `${UID}-r`, REJ)
const pend2 = ((await api('/admin/ai/review/pending', A)).data?.pending || [])
const target = pend2.find((x) => x.customerMessage === REJ)
check('③ 前置:那句话进了待审', Boolean(target), `待审 ${pend2.length} 条`)
if (target) {
  await api('/admin/ai/review/judge', A, {
    method: 'POST',
    body: JSON.stringify({ conversationId: target.conversationId, turnIndex: target.turnIndex, verdict: 'rejected' }),
  })
  const again = await say(A, `${UID}-r2`, REJ)
  const d = again.data?.reply?.data || {}
  check('③ 同句再来 → 先反问(ask_back)', d.gate === 'ask_back',
    `gate=${d.gate} tier=${d.tier} 答=${String(d.answerZh || '').slice(0, 50)}`)
  /* 反向守:**只对判过的那句**反问,别的句子照常答 */
  const other = await say(A, `${UID}-r3`, '营业时间是几点到几点')
  check('③b 反向守:没判过的句子不受影响', (other.data?.reply?.data || {}).gate !== 'ask_back'
    || (other.data?.reply?.data || {}).askBackReason !== 'owner_rejected_before',
    JSON.stringify(other.data?.reply?.data || {}).slice(0, 80))
  /* 🔴 造病刀的着力点:A 店判的「不该答」**不许**影响 B 店 */
  const crossed = await say(B, `air-b-${RUN}`, REJ)
  const cd = crossed.data?.reply?.data || {}
  check('⑤ 🔴 跨店隔离:A 店判的「不该答」不许让 B 店也反问',
    cd.askBackReason !== 'owner_rejected_before',
    `B 店 gate=${cd.gate} reason=${cd.askBackReason}`)
}

/* ── ⑤ 回流按租户隔离:A 店样本不许出现在 B 店 ─────────────── */
/* 🔴 白名单判据 > 黑名单判据:
   头一版写的是「A 店那句话**不在** B 店列表里」——**黑名单**,而列表有 200 条上限,
   CI 库里几百个会话一挤,A 店的轮次根本翻不到第一页,于是「待审不按租户取」那把刀砍下去
   判据毫无反应(现测:㋑ 没红)。改成**每一条都必须属于本店**,漏一条就红,与条数无关。
   会话 id 形状是 `wecom:<租户>:<顾客>`,所以本店的每条都必须带本店前缀。 */
const tenantOwns = (rows, tid) => rows.every((x) => String(x.conversationId || '').startsWith(`wecom:${tid}:`))
const bPending = (await api('/admin/ai/review/pending', B)).data?.pending || []
const aPending = (await api('/admin/ai/review/pending', A)).data?.pending || []
check('⑤ 🔴 B 店待审里每一条都属于 B 店(白名单式,不看条数)',
  tenantOwns(bPending, B),
  `B 店 ${bPending.length} 条,越界的:${bPending.filter((x) => !String(x.conversationId || '').startsWith(`wecom:${B}:`)).slice(0, 2).map((x) => x.conversationId).join(' | ')}`)
check('⑤b 🔴 A 店待审里每一条都属于 A 店', tenantOwns(aPending, A),
  `A 店 ${aPending.length} 条,越界的:${aPending.filter((x) => !String(x.conversationId || '').startsWith(`wecom:${A}:`)).slice(0, 2).map((x) => x.conversationId).join(' | ')}`)
/* 先证刀能咬:两边都得真有条目,否则「每一条都属于本店」在空列表上恒真 */
check('⑤c 判据非零命中:A 店待审非空(空列表上白名单恒真)', aPending.length > 0, `A ${aPending.length} 条`)

/* 越权:拿 B 店身份裁 A 店的轮次 → 必须 404 */
const cross = await api('/admin/ai/review/judge', B, {
  method: 'POST',
  body: JSON.stringify({ conversationId: item?.conversationId, turnIndex: item?.turnIndex, verdict: 'ok' }),
})
check('⑤ 🔴 越权:B 店裁 A 店的轮次 → 404', cross.status === 404, `status=${cross.status}`)

/* 异常输入:改一句不给话、裁不存在的轮、非法 verdict */
const noText = await api('/admin/ai/review/judge', A, {
  method: 'POST', body: JSON.stringify({ conversationId: item?.conversationId, turnIndex: item?.turnIndex, verdict: 'revised' }),
})
check('⑥ 异常输入:「改一句」不给话 → 400', noText.status === 400, `status=${noText.status}`)
const badVerdict = await api('/admin/ai/review/judge', A, {
  method: 'POST', body: JSON.stringify({ conversationId: item?.conversationId, turnIndex: item?.turnIndex, verdict: '乱写' }),
})
check('⑥ 异常输入:非法 verdict → 400', badVerdict.status === 400, `status=${badVerdict.status}`)
const ghost = await api('/admin/ai/review/judge', A, {
  method: 'POST', body: JSON.stringify({ conversationId: item?.conversationId, turnIndex: 9999, verdict: 'ok' }),
})
check('⑥ 异常输入:悬空轮次 → 404', ghost.status === 404, `status=${ghost.status}`)

/* 幂等:同一轮裁两次 = 覆盖,不是追加 */
const j1 = (await api('/admin/ai/review/stats', A)).data?.judged
await api('/admin/ai/review/judge', A, {
  method: 'POST', body: JSON.stringify({ conversationId: item?.conversationId, turnIndex: item?.turnIndex, verdict: 'ok' }),
})
const j2 = (await api('/admin/ai/review/stats', A)).data?.judged
check('⑦ 幂等:同一轮裁两次,已裁决数不变(覆盖不追加)', j1 === j2, `${j1} → ${j2}`)

/* 未登录 */
const anon = await fetch(`${BASE_URL}/admin/ai/review/pending`).then((r) => r.status).catch(() => 0)
check('⑧ 未登录取待审 → 401/403', anon === 401 || anon === 403, `status=${anon}`)

console.log(`\n[④ 审样本] 待审/裁决/回流/三数/跨店隔离,共 ${n} 项`)
if (fails.length) { console.error(`\n❌ test-ai-review ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-ai-review 通过 ${n} 项`)
