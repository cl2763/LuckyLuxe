import { evalOutPath, runStamp } from './archive.mjs'   // J-30:明细落仓
/* 事实句**放行率** + 定金数字**独立对账**(Cowork 05h §二 裁)

   ⚠️ **这把尺子原来叫「事实命中率」,那个名字是错的。**
   它量的是「答了、而且没被事实闸拦下」—— 也就是**放行率**,不是「数字对不对」。
   对不对是**闸**判的,而尺子和闸**读的是同一份事实槽** —— 等于自己给自己打分。
   所以:①改名叫放行率;②再加一栏**独立对账** —— 走一条**跟闸不同的读路径**
   (公开的 `GET /store/deposit-policy`),把回复里的钱数逐句比回去。
   一条路径说「放行了」,另一条路径说「数字确实对得上」,两个数才有意义。 */
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

/* ── 独立对账:定金类回答里的钱数,拿**公开口**的政策原文比回去 ──
   `GET /store/deposit-policy` 与事实闸不共用读路径,所以它说「对得上」才算数。 */
const recon = { 应对账: 0, 对上: 0, 对不上: [] }
for (const tid of SHOPS) {
  const r = await fetch(`${BASE}/store/deposit-policy`, { headers: { 'x-tenant-id': tid } })
  let pol = null
  try { pol = await r.json() } catch { pol = null }
  const text = JSON.stringify(pol || {})
  const allowed = new Set([...text.matchAll(/(\d{1,5})/g)].map((m) => Number(m[1])))
  for (const row of rows.filter((x) => x.tid === tid && x.answered && /定金|deposit/i.test(x.say))) {
    recon.应对账 += 1
    const nums = [...row.text.matchAll(/(?:CAD|USD|¥|\$)\s?(\d{1,5})/g)].map((m) => Number(m[1]))
    const bad = nums.filter((n) => !allowed.has(n))
    if (bad.length) recon.对不上.push({ say: row.say, tid, bad, text: row.text.slice(0, 90) })
    else recon.对上 += 1
  }
}
const OUT = evalOutPath({ batch: TAG, name: '事实命中', override: process.env.FACT_OUT })   // J-30:不许写 /tmp
writeFileSync(OUT, JSON.stringify({ ...runStamp(), rows, recon }, null, 2))
console.log(JSON.stringify({
  事实句: rows.length, 放行: hit, 被事实闸拦下: blocked,
  事实句放行率: `${(hit / rows.length * 100).toFixed(1)}%`,
  定金数字对账: `${recon.对上}/${recon.应对账}`,
  对不上的: recon.对不上,
}))
