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

/* 🔴 判据要能证伪你要证的那件事:
   上面 6 组各 3 句,**没有一句是「确认」** —— 而图 §二 写死了「顾客确认(intent=confirm)→ drafted」,
   不确认就不许建草稿。所以这 3 句怎么跑,「建出草稿」都只能是 0:
   那个 0 是**脚本够不到**,不是产品做不到,两者从数字上分不出来。
   加一句确认(`BR_CONFIRM=1`)才谈得上量「到底率」;不加时与 05h 基线逐句一致,可直接对比。 */
const CONFIRM_TURN = process.env.BR_CONFIRM === '1' ? ['好的,就这个时间'] : []

/* 🔴 新尺(店主 05n 裁「③ 尺子改不改 → 改,但两列并排」):
   老尺第 4 句固定说「好的,就这个时间」—— 可机器常常先给出三个替代时段,
   这句话**没说要哪个**,于是机器只能再问一遍,到底率被尺子本身压住了。
   真人这时会说「那就 X 点」。新尺:**回复里有替代时段就挑第一个**,没有才照老尺说。
   两把尺的数都要报,不许只报新尺(老尺是与历史比的唯一锚)。 */
const pickSlot = (reply) => {
  const m = String(reply || '').match(/([01]?\d|2[0-3]):([0-5]\d)/)
  return m ? `那就 ${m[0]}` : '好的,就这个时间'
}
const RULER = process.env.BR_RULER === 'new' ? 'new' : 'old'

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
    let lastSay = ''
    for (const t0 of [...turns, ...CONFIRM_TURN]) {
      /* 新尺只改**最后那句确认**的说法,前面几句一字不动 */
      const t = (RULER === 'new' && CONFIRM_TURN.length && t0 === CONFIRM_TURN[0]) ? pickSlot(lastSay) : t0
      const d = await send(tid, uid, t)
      convId = d?.conversationId || convId
      const st = d?.conversation?.status
      if (st === 'needs_human' || st === 'human_active') touchedHuman = true
      const say = String(d?.reply?.data?.answerZh || '')
      lastSay = say
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
  尺子: RULER === 'new' ? '新尺(挑第一个替代时段)' : '老尺(固定说"好的,就这个时间")',
  想约通数: rows.length,
  到底: done,
  预约到底率: `${(done / rows.length * 100).toFixed(1)}%`,
  建出草稿的: rows.filter((r) => r.drafts > 0).length,
  中途进人工的: rows.filter((r) => r.touchedHuman).length,
  被丢7项表的: rows.filter((r) => r.sawForm).length,
}))
