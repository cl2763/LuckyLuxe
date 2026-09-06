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
import { evalOutPath, runStamp } from './archive.mjs'   // J-30:明细落仓 + 记跑机上下文

const BASE = requireTarget({
  envName: 'BR_BASE=<沙箱服务地址>', value: process.env.BR_BASE,
  hint: '(只打沙箱,例:BR_BASE=http://127.0.0.1:4310)',
})
const DB = requireTarget({
  envName: 'BR_DB=<库文件绝对路径>', value: process.env.BR_DB,
  hint: '(与 BR_BASE 是同一个库)',
})
const TAG = process.env.BR_TAG || 'base'
/* 🔴 三店并行(05o §一⑥)。但**默认仍是历史那两家** —— 到底率是要跟 05h/05l/05n 逐次比的数,
   分母一变(12→18)前后就不可比了。第三店单独跑一趟、单独报,不混进那条历史曲线。
   用法:BR_SHOPS=luvia-bj node tools/ai-eval/booking-rate.mjs */
const SHOPS = String(process.env.BR_SHOPS || 'lucky-luxe,jics-store').split(',').map((x) => x.trim()).filter(Boolean)

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
/* 本次执行的唯一后缀:同一个 TAG 重跑也不会撞上上一次的会话(理由见下面 uid 那处) */
const RUN_ID = Date.now().toString(36)

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
    /* 🔴 每次执行必须换一批**全新的会话** —— 09-08 现测查明的测量事故:
       `uid` 只带 TAG,同一个 TAG 重跑就**接着上一次的会话往下说**,
       上一轮攒下的 `intakePromptCount` 还在,于是第二句就被判成「又含糊了一次」→ 转人工。
       今天同一份代码量出过 0/12、2/12、6/12 三个数,差别全在这儿:
       用过的 TAG 重跑 = 污染;换新 TAG = 干净。
       **一把量不准的尺,比没有尺更坏** —— 它会让人以为代码退化了。 */
    const uid = `br-${TAG}-${RUN_ID}-${i}`
    let convId = null
    let touchedHuman = false
    let sawForm = false
    let lastSay = ''
    let swappedDay = false
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
      /* 🔴 新尺再加一条(05p 现测发现的**尺子病**):12 组开场里有 3 组说的是「明天」,
         而两家夹具店都是**周一休息** —— 于是**每逢周日跑这把尺,那 3 组必然到不了底**,
         机器答的是完全正确的「门店休息哦,换一天好吗?」。
         也就是说:老尺这条历史曲线**本身随星期几上下跳**,05h/05l/05n 那几个数之间
         严格说不可比(它们跑在不同的星期几)。
         真顾客碰上店休会换一天,所以新尺补一句「那周六呢」再往下走;
         **老尺一个字不动** —— 它是与历史对齐的唯一锚,尺子改了就断了。 */
      if (RULER === 'new' && /休息|不营业|没开门/.test(say) && !swappedDay) {
        swappedDay = true
        const d2 = await send(tid, uid, '那周六呢')
        lastSay = String(d2?.reply?.data?.answerZh || '')
        const st2 = d2?.conversation?.status
        if (st2 === 'needs_human' || st2 === 'human_active') touchedHuman = true
      }
    }
    const drafts = convId ? draftsFor(convId) : 0
    rows.push({ tid, uid, convId, turns, drafts, touchedHuman, sawForm,
      done: drafts > 0 && !touchedHuman })
    i += 1
  }
}
const done = rows.filter((r) => r.done).length
/* 🔴 J-30(店主 05p 补三,同一件事第二次):**明细一律落档案目录,不许写 /tmp**。
   05l 已经裁过一回,05p 的三跑又只留在 /tmp —— 回执上写着 6/6/7,明细一份都没入仓,没法核。
   顶部记 `ranOn`(日期+星期几)与夹具店休息日:到底率被星期几左右过一次,
   以后每份自带这个上下文,谁拿两份不同星期几的数对比,一眼看得出不该比。 */
/* 🔴 文件名必须把**测的是哪几家店**带上 —— 09-08 现测踩到:
   北京店那三轮用了同样的 `_新尺_第N轮_` 名字,**把两店那三轮直接覆盖掉了**,
   打开一看「新尺第 1 轮」里躺的是北京店的 6 通。
   归档件的名字要能自证它是什么,不能靠跑的人记得当时传了什么环境变量。 */
const DEFAULT_SHOPS = ['lucky-luxe', 'jics-store']
const scope = (SHOPS.length === DEFAULT_SHOPS.length && SHOPS.every((x, k) => x === DEFAULT_SHOPS[k]))
  ? '' : SHOPS.join('+')
const OUT = evalOutPath({ batch: process.env.BR_BATCH || TAG, name: '预约到底率',
  ruler: [scope, RULER === 'new' ? '新尺' : '老尺'].filter(Boolean).join('_'),
  round: Number(process.env.BR_ROUND || 0), override: process.env.BR_OUT })
writeFileSync(OUT, JSON.stringify({
  ...runStamp({ db, shops: SHOPS }),
  尺子: RULER, 店: SHOPS, 到底: rows.filter((r) => r.done).length, 想约通数: rows.length,
  rows,
}, null, 2))
console.log(JSON.stringify({
  出口: OUT,
  尺子: RULER === 'new' ? '新尺(挑第一个替代时段)' : '老尺(固定说"好的,就这个时间")',
  想约通数: rows.length,
  到底: done,
  预约到底率: `${(done / rows.length * 100).toFixed(1)}%`,
  建出草稿的: rows.filter((r) => r.drafts > 0).length,
  中途进人工的: rows.filter((r) => r.touchedHuman).length,
  被丢7项表的: rows.filter((r) => r.sawForm).length,
}))
