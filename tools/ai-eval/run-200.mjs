/* 门的评测跑机(图 §五)—— 四个数并排:答 / 反问 / 转人工 / 静默
   **每句一通干净会话**:一轮没命中就整通哑掉(D133),共用会话会把后面的全吞掉,
   量出来的就不是门的能力,是 D133 的影子。 */
import { writeFileSync } from 'node:fs'
import { ALL_200 } from '../../apps/api/ai-eval-set.mjs'
const BASE = process.env.GATE_BASE || 'http://127.0.0.1:4310'
const TAG = process.env.GATE_TAG || 'kw'
const SHOPS = (process.env.GATE_SHOPS || 'lucky-luxe,jics-store').split(',')
const send = async (tid, uid, message, lang) => {
  const r = await fetch(`${BASE}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token', 'x-admin-tenant-id': tid, 'x-tenant-id': tid },
    body: JSON.stringify({ externalUserId: uid, message, lang }),
  })
  let d = null
  try { d = await r.json() } catch { d = null }
  return { status: r.status, d }
}

/* 四档判定 —— **锚显式标记,不锚文案标点**。
   跑机第一版按「以问号结尾且不长」认「反问」:那是在猜文案长相。
   三档现在各自落了 reply.data.gate(ask_back / out_of_scope),事实就在字段上。
   按标点猜的后果:模型正常答一句「您是想做美甲还是美睫呢?」会被记成反问,
   而第 2 档的兜底句一样以问号结尾 —— 两件事记成一件,四个数里就有一个是假的。 */
const classify = (res) => {
  const rep = res.d?.reply
  if (!rep) return '静默'
  const g = rep.data?.gate
  if (g === 'ask_back') return '反问'
  if (g === 'out_of_scope') return '转人工'
  if (rep.data?.handoffRequired) return '转人工'
  return '答'
}

const out = { A: {}, B: {}, C: {} }
const detail = []
const bucketOf = (i) => (i < 80 ? 'A' : i < 160 ? 'B' : 'C')
let i = 0
for (const [say, want, lang] of ALL_200) {
  const tid = SHOPS[i % SHOPS.length]
  const res = await send(tid, `gate-${TAG}-${i}`, say, lang === 'en' ? 'en' : 'zh')
  const k = classify(res)
  const b = bucketOf(i)
  out[b][k] = (out[b][k] || 0) + 1
  detail.push({
    i, b, k, tid, say, want, lang: lang || 'zh',
    gate: res.d?.reply?.data?.gate || null,
    intent: res.d?.reply?.data?.intent || null,
    handoff: Boolean(res.d?.reply?.data?.handoffRequired),
    text: String(res.d?.reply?.data?.answerZh || res.d?.reply?.data?.answerEn || '').slice(0, 240),
  })
  i += 1
  if (i % 40 === 0) console.error(`   …${i}/200`)
}
writeFileSync(process.env.GATE_DETAIL || `/tmp/gate-detail-${TAG}.jsonl`, detail.map((d) => JSON.stringify(d)).join('\n'))
console.log(JSON.stringify(out))
