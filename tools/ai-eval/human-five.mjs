/* ⑤ 像人五通 —— **整段对话原文**留档给店主打分(图 §五)
 *
 * 这不是自动判分的东西:「像不像人」没有机械判据,店主读了才算数。
 * 所以这把跑机只干两件事:①把五通对话完整跑一遍 ②把**每一句原文**原样落盘。
 * 顺手带三条能机械看的(不发 7 项表 / 单条 ≤120 字 / 同一句不在一通里重复),
 * 但**它们过不过都不代表"像人"** —— 那一栏留白等店主写。
 *
 * 用法:HF_BASE=<沙箱地址> HF_OUT=<路径.md> node tools/ai-eval/human-five.mjs(两个都必须显式给)
 */
import { writeFileSync } from 'node:fs'
import { requireTarget } from '../db-target.mjs'
import { evalOutPath } from './archive.mjs'   // J-30:默认落档案目录

/* 🔴 造景/评测脚本**不许有默认目标**(店主立;写库脚本护栏扫的就是这个)。
   我头一版把沙箱地址写成了默认值 —— `test-db-target-guard` 当场点名
   「tools/ai-eval/human-five.mjs:12[硬编码目标]」。没写就报错,不许猜。 */
const BASE = requireTarget({
  envName: 'HF_BASE=<沙箱服务地址>',
  value: process.env.HF_BASE,
  hint: '(评测只打沙箱,例:HF_BASE=http://127.0.0.1:4310)',
})
/* 🔴 J-30(05p 补三):默认就落档案目录,`HF_OUT` 只许覆盖不许留空。
   这一把本来就没有 /tmp 分支(它是 requireTarget),但「必须显式给」在赶时间时
   照样会被人随手指到别处 —— 给个**正确的默认**比逼人每次打一遍稳。 */
const OUT = evalOutPath({ batch: process.env.HF_BATCH || '像人多通', name: '原文', ext: 'md', override: process.env.HF_OUT })
const RUN = Date.now().toString(36)

/* 五通:照真顾客会说的样子写,不写成测试用例 */
const TALKS = [
  { tid: 'lucky-luxe', name: '一、第一次来,有点紧张',
    turns: ['你好呀,想问问美甲', '我第一次来,有点紧张', '会不会很疼呀', '大概要多久', '好的谢谢你啦'] },
  { tid: 'lucky-luxe', name: '二、预算不多,想要推荐',
    turns: ['想弄个低调点的', '预算不多,能推荐吗', '那个最便宜的是哪种', '会不会很快就掉', '我再想想'] },
  { tid: 'jics-store', name: '三、边聊边把时间定下来',
    turns: ['我想预约', '做美甲', '明天', '下午三点', '好的,就这个时间'] },
  { tid: 'lucky-luxe', name: '四、说着说着改主意',
    turns: ['我想约周六做美甲', '等等 我再想想', '还是改成美睫吧', '那周日行吗', '算了不约了'] },
  /* 🔴 v4(店主 05q §四):通五改成**三句分开发、间隔 1 秒** —— 真顾客不是一句话问三个问题,
     是连着发三句。D151 的合并窗要的就是这种输入;并成一条之后 AI 该把三问一起答。 */
  { tid: 'jics-store', name: '五、连着发三句(v4 改:间隔 1 秒,验合并窗)',
    turns: [['几点关门', '顺便问下定金', '还有停车'], '哦哦 那定金能退吗', '会员有折扣吗', '谢谢'] },
  /* 🔴 v3 新增第六通(05p:三店走查并行)。**前五通一个字不改**,店主才好跟 v2 并排读;
     北京店这一通专看两样:金额是不是 ¥、时间是不是北京时间。 */
  /* v4:通六北京店**现在有新客券了**(段 7b 建的),所以这一通同时看 D152 ——
     有券的店问价时该不该提券、提得对不对,由店主读。 */
  { tid: 'luvia-bj', name: '六、北京店:问价问时间(v4:店里有新客券)',
    turns: ['你们那儿最便宜的美甲多少钱', '有优惠吗', '做一次大概要多久', '明天下午三点有位吗', '好的谢谢你啦'] },
]

const say = async (tid, uid, message) => {
  const r = await fetch(`${BASE}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token',
      'x-admin-tenant-id': tid, 'x-tenant-id': tid },
    body: JSON.stringify({ externalUserId: uid, message }),
  })
  const d = await r.json().catch(() => null)
  return (d?.reply?.data?.answerZh) || ''
}

const FORM = [/几点|什么时间/, /哪天|日期/, /美甲还是美睫|项目类型/, /技师|指定/, /卸甲|延长/]
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const now = new Date()
const ranOn = `${now.toISOString().slice(0, 10)}(${WD[now.getDay()]})`
const lines = [`# ⑤ 像人${TALKS.length}通 —— 整段对话原文(店主打分用)`, '',
  `> **跑于**:${ranOn} · 每通都是**全新会话**(J-31:会话 id 带这一跑的随机段 \`${RUN}\`,不接上一跑的对话)`,
  '> 「明天能不能约」这类答案跟**跑的那天**和**夹具店当天休不休息**有关 —— 读的时候把日期一起看。', '',
  '> 机器不判「像不像人」—— 这一页是**原文**,请您读完在每通末尾打分。',
  '> 顺带列了三条能机械看的(不发 7 项表 / 单条 ≤120 字 / 同一句不重复),',
  '> **它们全过也不等于像人**,只是排掉明显不像的。', '']

let flags = []
for (const talk of TALKS) {
  const uid = `hf-${RUN}-${TALKS.indexOf(talk)}`
  lines.push(`## ${talk.name}(${talk.tid})`, '')
  const said = []
  for (const t of talk.turns) {
    if (Array.isArray(t)) {
      /* 连发几句:每句间隔 1 秒(< 合并窗),窗关时**只出一条回复** ——
         早到的那几次回 `reply: null`,这里取最后那条真回复。 */
      const flying = []
      for (let i = 0; i < t.length; i += 1) {
        flying.push(say(talk.tid, uid, t[i]))
        if (i < t.length - 1) await new Promise((r) => setTimeout(r, 1000))
      }
      const outs = (await Promise.all(flying)).filter(Boolean)
      const a = outs[outs.length - 1] || ''
      said.push(a)
      lines.push(`**顾客**(连着发 ${t.length} 句,间隔 1 秒):${t.join(' / ')}`, '',
        `**AI**(合并窗合成一条后作答):${a || '(没有回复)'}`, '')
      continue
    }
    const a = await say(talk.tid, uid, t)
    said.push(a)
    lines.push(`**顾客**:${t}`, '', `**AI**:${a || '(没有回复)'}`, '')
  }
  const formy = said.filter((x) => FORM.filter((re) => re.test(x)).length >= 3)
  const longs = said.filter((x) => x.length > 120)
  const dup = said.length !== new Set(said.map((x) => x.trim())).size
  const note = [
    formy.length ? `⚠️ 有 ${formy.length} 句像 7 项表` : '✅ 没发 7 项表',
    longs.length ? `⚠️ 有 ${longs.length} 句超过 120 字` : '✅ 每句都 ≤120 字',
    dup ? '⚠️ 同一通里出现了重复句' : '✅ 没有重复句',
  ]
  flags.push({ talk: talk.name, formy: formy.length, longs: longs.length, dup })
  lines.push(`机械三看:${note.join(' · ')}`, '', '**店主打分(1–5)**:⬜　　**一句话评语**:', '', '---', '')
}

lines.push('## 机械三看汇总(不代表像人)', '')
lines.push('| 通 | 7 项表 | 超 120 字 | 重复句 |', '|---|---|---|---|')
for (const f of flags) {
  lines.push(`| ${f.talk} | ${f.formy ? `⚠️ ${f.formy}` : '✅ 0'} | ${f.longs ? `⚠️ ${f.longs}` : '✅ 0'} | ${f.dup ? '⚠️ 有' : '✅ 无'} |`)
}
writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log(JSON.stringify({ 五通: TALKS.length, 出口: OUT,
  有7项表的通数: flags.filter((f) => f.formy).length,
  有超长句的通数: flags.filter((f) => f.longs).length,
  有重复句的通数: flags.filter((f) => f.dup).length }, null, 0))
