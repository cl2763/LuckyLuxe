import { evalOutPath, runStamp } from './archive.mjs'   // J-30:明细落仓
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

/* 行为档判定 —— **锚显式标记,不锚文案标点**(三档各自落 `reply.data.tier`)。
   图 v1.2 把第 3 档拆成 3a/3b,所以档位也跟着分:
   · 答      有回复、不转人工、不是 3a(正常业务回答)
   · 反问    tier=2(`gate: ask_back`)
   · 转人工  handoffRequired=true(含 3b、售后闸、安全四线闸)
   · 礼貌拒绝 tier=3a —— **范围外的正确答案**,09-04 那版把它算成「误答」是错的
   · 静默    没有回复(旧关键词门才会有) */
const classify = (res) => {
  const rep = res.d?.reply
  if (!rep) return '静默'
  const da = rep.data || {}
  if (da.tier === '3a') return '礼貌拒绝'
  if (da.handoffRequired) return '转人工'
  if (da.tier === '2' || da.gate === 'ask_back') return '反问'
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
    tier: res.d?.reply?.data?.tier || null,
    intent: res.d?.reply?.data?.intent || null,
    handoff: Boolean(res.d?.reply?.data?.handoffRequired),
    text: String(res.d?.reply?.data?.answerZh || res.d?.reply?.data?.answerEn || '').slice(0, 240),
  })
  i += 1
  if (i % 40 === 0) console.error(`   …${i}/200`)
}
const OUT = evalOutPath({ batch: TAG, name: '逐句明细', ext: 'jsonl', override: process.env.GATE_DETAIL })   // J-30
writeFileSync(OUT, [JSON.stringify({ __stamp: runStamp() }), ...detail.map((d) => JSON.stringify(d))].join('\n'))
console.log(JSON.stringify(out))
