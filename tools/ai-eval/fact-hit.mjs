/* 事实命中率(Cowork 05g §二:「评测集里事实类句子(营业时间/定金/地址组)三跑取中位报事实命中率」)

   **命中 = 答了,而且没被事实闸拦下。**
   被拦下不算「答错」也不算「答对」——它是**没放出去**,对顾客而言就是没得到答案。
   所以这个数量的是「**顾客问一句事实,拿到可信答案的比例**」。 */
import { writeFileSync } from 'node:fs'
import { requireTarget } from '../db-target.mjs'
import { ALL_200 } from '../../apps/api/ai-eval-set.mjs'

const BASE = requireTarget({
  envName: 'FACT_BASE=<沙箱服务地址>', value: process.env.FACT_BASE,
  hint: '(只打沙箱,例:FACT_BASE=http://127.0.0.1:4310)',
})
const TAG = process.env.FACT_TAG || 'r1'
const FACTY = /营业|几点|周日|周一|休息|定金|地址|在哪|停车|电话|hours|open|close|deposit|address|where/i
const SET = ALL_200.filter(([say, want]) => FACTY.test(say) && want !== 'out')
const SHOPS = ['lucky-luxe', 'jics-store']

const rows = []
let i = 0
for (const [say, want, lang] of SET) {
  const tid = SHOPS[i % SHOPS.length]
  const r = await fetch(`${BASE}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token',
      'x-admin-tenant-id': tid, 'x-tenant-id': tid },
    body: JSON.stringify({ externalUserId: `fact-${TAG}-${i}`, message: say, lang: lang === 'en' ? 'en' : 'zh' }),
  })
  let d = null
  try { d = await r.json() } catch { d = null }
  const da = d?.reply?.data || {}
  rows.push({ say, want, tid, gate: da.gate || null, tier: da.tier || null,
    blocked: da.gate === 'fact_gate',
    answered: Boolean(d?.reply) && da.gate !== 'fact_gate' && !da.handoffRequired,
    text: String(da.answerZh || da.answerEn || '').slice(0, 160) })
  i += 1
}
const hit = rows.filter((r) => r.answered).length
const blocked = rows.filter((r) => r.blocked).length
writeFileSync(process.env.FACT_OUT || `/tmp/fact-${TAG}.json`, JSON.stringify({ rows }, null, 2))
console.log(JSON.stringify({ 事实句: rows.length, 命中: hit, 被事实闸拦下: blocked,
  命中率: `${(hit / rows.length * 100).toFixed(1)}%` }))
