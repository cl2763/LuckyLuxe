/* 12 场景跑机 —— 只打沙箱 4310(自报库路径见回执)。
   每轮记:输入原文 / 回复原文 / quote state + 会话 status + intent/handoffRequired/nextAction / 三字段。
   到模型层的轮次(reply 有 provider 且非 mock,或 source 为空)重复 3 次报 n/3。 */
import { MATRIX } from './matrix.mjs'
import { writeFileSync } from 'node:fs'
import { requireTarget } from '../../db-target.mjs'
import { DatabaseSync } from 'node:sqlite'

/* 🔴 **不许有默认目标**(店主立:造景脚本不许有默认目标库)。
   这个跑机会**建预约、建报价单、改会话状态** —— 是不折不扣的造景脚本。
   原来默认打 `127.0.0.1:4310`,看着安全,可默认值的病根不是「打错了」,
   是「**打错了不报错**」:哪天谁把 4310 指到别的库,这里一声不吭照写。
   用**全仓同一个** `requireTarget`,不另写一套 —— 自己写一套的话,
   护栏扫描器认不出来(它扫的就是这个名字),而且两份实现迟早漂。 */
const BASE = requireTarget({
  envName: 'AI12_BASE=<沙箱服务地址>',
  value: process.env.AI12_BASE,
  hint: '(只打沙箱,例:AI12_BASE=http://127.0.0.1:4310)',
})
const DBP = process.env.AI12_DB
const FLAG = process.env.AI12_FLAGSHIP || 'lucky-luxe'
const MIRROR = process.env.AI12_MIRROR || 'jics-store'
const RUN = process.env.AI12_RUN || Date.now().toString(36)
const TOKEN = 'owner-demo-token'

const hdr = (tid) => ({ 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tid, 'x-tenant-id': tid })
/* 🔴 造景必须校验返回码(店主的静默失败器族):04d 现测栽了一跤 ——
   知识库的口是 `/admin/kb/facts`,我写成了 `/admin/tenant-kb/facts`,404 了跑机一声不吭,
   于是 A4 看起来「模型不用知识库」,其实库里压根没有那两条。**造景不校验 = 景没造上也不知道。** */
const mustOk = (label, r) => { if (r.status < 200 || r.status >= 300) throw new Error(`造景失败 ${label}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`); return r }
const api = async (tid, p, o = {}) => {
  const r = await fetch(BASE + p, { headers: hdr(tid), ...o })
  let d = null
  try { d = await r.json() } catch { d = null }
  return { status: r.status, data: d }
}
const health = async () => (await (await fetch(`${BASE}/health`)).json())

const convOf = async (tid, uid) => {
  const r = await api(tid, '/admin/wechat/conversations')
  return (r.data?.conversations || []).find((c) => c.externalUserId === uid) || null
}
const send = async (tid, uid, message, lang) => {
  const r = await api(tid, '/admin/wechat/mock-chat-message', { method: 'POST', body: JSON.stringify({ externalUserId: uid, message, lang }) })
  return r
}

const snap = (r, conv, lang = 'zh') => ({
  status: r.status,
  source: r.data?.reply?.source ?? (r.data?.reply ? '(空=模型直出)' : '(无回复)'),
  provider: r.data?.reply?.provider ?? null,
  /* 05f:换门后每轮要记 `tier` —— 图 v1.2 的 3a/3b 是**行为分类的锚点**,
     只记 source/provider 看不出「这句是礼貌拒绝还是转人工」。 */
  tier: r.data?.reply?.data?.tier ?? null,
  gate: r.data?.reply?.data?.gate ?? null,
  intent: r.data?.reply?.data?.intent ?? null,
  handoffRequired: r.data?.reply?.data?.handoffRequired ?? null,
  nextAction: r.data?.reply?.data?.nextAction ?? null,
  /* 🔴 04d 现测栽的一跤:原来只取 answerZh,于是英文场景看起来「模型用中文答」——
     其实模型两栏都出了。**取字段取错 ≠ 产品有病**,归因要落到跑机自己身上。 */
  answerZh: r.data?.reply?.data?.answerZh || null,
  answerEn: r.data?.reply?.data?.answerEn || null,
  answer: (lang === 'en' ? r.data?.reply?.data?.answerEn : r.data?.reply?.data?.answerZh)
    || r.data?.reply?.data?.answerZh || r.data?.reply?.data?.answerEn || null,
  waitingForHuman: Boolean(r.data?.waitingForHuman),
  silentHandoff: Boolean(r.data?.silentHandoff),
  convStatus: conv?.status ?? '(无会话)',
  quoteState: conv?.quoteState?.state ?? null,
})
const isModelTurn = (s) => s.source === '(空=模型直出)' || (s.provider && s.provider !== 'mock')

/* ── 铺景(造景律:谁出走查单谁先把景造好)──
   沙箱这两家店**本来就有技师与项目**(旗舰 9/8、镜像 1/2),所以只补幂等的两样:
   营业时间与知识库条目。**不再加技师/项目**,否则每跑一次就多一批,夹具自己变脏。 */
async function seed(tid, tag) {
  mustOk('营业时间', await api(tid, '/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: Array.from({ length: 7 }, (_, d) => ({ weekday: d, openTime: '10:00', closeTime: '19:00', isClosed: d === 1 })) }) }))
  mustOk('KB 基本条目', await api(tid, '/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: {
    storeAddress: '多伦多 Veterans Place 136 号', depositAmount: '50', currency: 'CAD' } }) }))
}
await seed(FLAG, '旗舰')
await seed(MIRROR, '镜像')

const results = []
const before = await health()
const ONLY = (process.env.AI12_ONLY || '').split(',').filter(Boolean)
for (const sc of MATRIX) {
  if (ONLY.length && !ONLY.includes(sc.id)) continue
  const tid = sc.shop === 'flagship' ? FLAG : MIRROR
  const uid = `ai12-${RUN}-${sc.id}`
  if (sc.fixture === 'kb2') {
    /* 🔴 造景律又栽一次:这个口吃的是 `{ facts: {…} }`,我原来传 `{key,value}` —— **景根本没造上**,
       于是 A4 看起来「模型不用知识库」,其实知识库里压根没有那两条。 */
    /* 🔴 第三跤:`/admin/kb/facts` 的 `allowed` 只有 5 个键
       (brandName/assistantName/storeAddress/depositAmount/currency),**别的键静默丢弃还回 200** ——
       从响应上分不出「存了」和「没存」。自由知识条目要走 `/admin/kb/entries`。 */
    for (const e of [
      { question: '你们那儿好停车吗?', keywords: '停车 车位 车库 parking', answerZh: '门口有 6 个免费车位;地下车库在 B2 层,凭小票免费停 2 小时。' },
      { question: '可以带小孩来吗?', keywords: '小孩 儿童 宝宝 kids', answerZh: '可以带小孩,店里有儿童座椅和绘本。' },
    ]) mustOk(`KB 条目「${e.question}」`, await api(tid, '/admin/kb/entries', { method: 'POST', body: JSON.stringify(e) }))
  }
  const turns = []
  for (const t of sc.turns) {
    if (t.staffQuote) {
      const qs = await api(tid, '/admin/quote-requests')
      const q = (qs.data?.quoteRequests || []).find((x) => String(x.conversationId || '').endsWith(`:${uid}`))
      const resp = q ? await api(tid, `/admin/quote-requests/${q.id}/respond`, { method: 'POST', body: JSON.stringify({ staffMessage: t.staffQuote, priceCents: 19800 }) }) : { status: 0, data: null }
      turns.push({ 动作: `技师报价「${t.staffQuote}」`, want: t.want, status: resp.status,
        source: resp.data?.aiReply?.source ?? '(无)', provider: resp.data?.aiReply?.provider ?? null,
        answer: resp.data?.aiReply?.data?.answerZh ?? resp.data?.reply?.data?.answerZh ?? null })
      continue
    }
    if (t.ageQuote) {
      if (DBP) {
        const w = new DatabaseSync(DBP)
        const iso = new Date(Date.now() - t.ageQuote * 3600 * 1000).toISOString()
        w.prepare(`UPDATE quote_requests SET quoted_at = ?, expires_at = ?, updated_at = ?
          WHERE conversation_id LIKE ?`).run(iso, iso, iso, `%:${uid}`)
        w.close()
      }
      turns.push({ 动作: `造态:把报价推早 ${t.ageQuote} 小时`, want: t.want, status: '-' })
      continue
    }
    if (t.takeOver || t.releaseToAi) {
      const conv = await convOf(tid, uid)
      const r = await api(tid, `/admin/wechat/conversations/${encodeURIComponent(conv?.id || 'x')}/${t.takeOver ? 'take-over' : 'release-to-ai'}`, { method: 'POST', body: '{}' })
      turns.push({ 动作: t.takeOver ? '人工接管' : '归还 AI', want: t.want, status: r.status, convStatus: (await convOf(tid, uid))?.status })
      continue
    }
    const r = await send(tid, uid, t.say, sc.lang)
    const s = snap(r, await convOf(tid, uid), sc.lang)
    const rec = { 输入: t.say, want: t.want, note: t.note || '', assert: t.assert || '', ...s }
    /* 到模型层的轮次跑 3 次(另起两个干净会话,避免污染主线) */
    if (isModelTurn(s)) {
      const runs = [s]
      for (let i = 2; i <= 3; i += 1) {
        const u2 = `${uid}-r${i}`
        for (const prev of sc.turns) { if (prev === t) break; if (prev.say) await send(tid, u2, prev.say, sc.lang) }
        const r2 = await send(tid, u2, t.say, sc.lang)
        runs.push(snap(r2, await convOf(tid, u2), sc.lang))
      }
      rec.重复 = `${runs.filter((x) => isModelTurn(x)).length}/3 到模型层`
      rec.三次回复 = runs.map((x) => (x.answer || '').slice(0, 60))
    }
    turns.push(rec)
  }
  results.push({ ...sc, tenant: tid, uid, turns })
  console.error(`  ✔ ${sc.id}(${tid})${sc.turns.length} 轮`)
}
const after = await health()
writeFileSync(process.env.AI12_OUT || '/tmp/ai12.json', JSON.stringify({ run: RUN, base: BASE, usageBefore: before.aiUsage, usageAfter: after.aiUsage, results }, null, 2))
console.error(`\n  token:${JSON.stringify(after.aiUsage)}`)
