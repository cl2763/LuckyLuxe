/* ③ **预约到底率**基线(Cowork 05h §三:「想约 → drafted 不经人工」的比例)

   这是店主「80%」锚的那个数,所以口径要先说死:

   · **想约** = 顾客一开口就是预约意图(要约、有没有位子、约某天某时),不是问价、不是闲聊;
   · **到底** = 这通对话最后**建出了 `booking_drafts` 一行**;
   · **不经人工** = 全程 `conversation.status` 没进过 `needs_human` / `human_active`。

   三者同时成立才算「到底一单」。分母是想约的通数,不是轮数 ——
   顾客要的是「我想约,最后约上了没有」,不是「AI 答了几句」。

   🔴 **不许有默认目标**:这个跑机会真的建预约草稿,是造景脚本。 */
import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { requireTarget } from '../db-target.mjs'

const BASE = requireTarget({
  envName: 'BR_BASE=<沙箱服务地址>', value: process.env.BR_BASE,
  hint: '(只打沙箱,例:BR_BASE=http://127.0.0.1:4310)',
})
const DB = requireTarget({
  envName: 'BR_DB=<库文件绝对路径>', value: process.env.BR_DB,
  hint: '(与 BR_BASE 是同一个库)',
})
const TAG = process.env.BR_TAG || 'base'
const SHOPS = ['lucky-luxe', 'jics-store']

/* 12 个「想约」开场 —— 照顾客真会说的样子写,不写成收集表的填空 */
const WANTS = [
  ['明天下午三点有空吗?', '我想做美甲', '就明天三点吧'],
  ['我想约周六做美甲', '单色胶就行', '下午两点可以吗'],
  ['帮我约个时间做美睫', '自然款', '后天上午十点'],
  ['这周还有位子吗?', '想做美甲', '周五下午都行'],
  ['能约明天吗', '美睫', '下午四点'],
  ['想约个时间', '做指甲', '明天晚上六点'],
]

const send = async (tid, uid, message) => {
  const r = await fetch(`${BASE}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token',
      'x-admin-tenant-id': tid, 'x-tenant-id': tid },
    body: JSON.stringify({ externalUserId: uid, message }),
  })
  try { return await r.json() } catch { return null }
}

const db = new DatabaseSync(DB, { readOnly: true })
const draftsFor = (convId) =>
  db.prepare('SELECT COUNT(*) AS n FROM booking_drafts WHERE conversation_id = ?').get(convId).n

const rows = []
let i = 0
for (const turns of WANTS) {
  for (const tid of SHOPS) {
    const uid = `br-${TAG}-${i}`
    let convId = null
    let touchedHuman = false
    let sawForm = false
    for (const t of turns) {
      const d = await send(tid, uid, t)
      convId = d?.conversationId || convId
      const st = d?.conversation?.status
      if (st === 'needs_human' || st === 'human_active') touchedHuman = true
      const say = String(d?.reply?.data?.answerZh || '')
      /* 7 项表的形状:一次抛出 6 个以上编号项 —— ③ 要消灭的正是它 */
      if ((say.match(/^\s*\d\.\s/gm) || []).length >= 6) sawForm = true
    }
    const drafts = convId ? draftsFor(convId) : 0
    rows.push({ tid, uid, convId, turns, drafts, touchedHuman, sawForm,
      done: drafts > 0 && !touchedHuman })
    i += 1
  }
}
const done = rows.filter((r) => r.done).length
writeFileSync(process.env.BR_OUT || `/tmp/booking-rate-${TAG}.json`, JSON.stringify({ rows }, null, 2))
console.log(JSON.stringify({
  想约通数: rows.length,
  到底: done,
  预约到底率: `${(done / rows.length * 100).toFixed(1)}%`,
  建出草稿的: rows.filter((r) => r.drafts > 0).length,
  中途进人工的: rows.filter((r) => r.touchedHuman).length,
  被丢7项表的: rows.filter((r) => r.sawForm).length,
}))
