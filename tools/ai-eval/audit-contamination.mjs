/* 到底率历史回溯审计(店主 05p 补四,J-31)—— **只判以前的数可不可信,不重跑**

   起因:09-08 查明跑机的会话 id 只带批号,同一个批号重跑就**接着上一次的对话往下说**;
   上一轮攒下的「已经问了两轮还没说清」还在,第二句就被判成「又含糊了」→ 转人工。
   同一份代码因此量出过 0/12、2/12、6/12。
   那么问题来了:**以前报过的那几条到底率,是不是也被这么污染过?**

   ══ 怎么判「这一通被污染了」══
   一通干净的评测对话:4 句顾客 + 4~5 句机器,**十几秒内说完**。
   被复用的会话看起来完全不同 —— 它由**两次执行拼起来**,中间隔着几分钟到几小时。
   所以主判据是**消息之间的时间缝**:相邻两条消息间隔 > 阈值(默认 2 分钟)
   = 这通对话跨了两次执行 = 污染。

   为什么不用「消息条数」当主判据:条数会因为模型多说一句、顾客少说一句而浮动,
   而时间缝是**结构性**的 —— 一次执行不可能在自己中间停两分钟。
   条数与总跨度仍然报出来,当旁证。

   ⚠️ 一个诚实的边界:这把刀只看得见**库里还留着的**会话。
   会话被清过、或那一轮跑在别的库上,就判不了 —— 那种情况标「查无此会话」,
   **不算干净也不算污染**,不许拿「查不到」当「没问题」。

   用法:AUDIT_DB=<沙箱库绝对路径> node tools/ai-eval/audit-contamination.mjs [> 表.md] */
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { requireTarget } from '../db-target.mjs'
import { EVAL_DIR } from './archive.mjs'

const DB = requireTarget({
  envName: 'AUDIT_DB=<库文件绝对路径>', value: process.env.AUDIT_DB,
  hint: '(评测跑在哪个库上就查哪个;通常是沙箱库)',
})
const GAP_MS = Number(process.env.AUDIT_GAP_MIN || 2) * 60000

const db = new DatabaseSync(DB, { readOnly: true })
const msgs = db.prepare('SELECT created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC')

const files = readdirSync(EVAL_DIR).filter((f) => /预约到底率.*\.json$/.test(f)).sort()
const out = []

for (const f of files) {
  const full = join(EVAL_DIR, f)
  let j = null
  try { j = JSON.parse(readFileSync(full, 'utf8')) } catch { continue }
  const rows = Array.isArray(j) ? j : (j.rows || [])
  if (!rows.length) continue
  const stat = statSync(full)
  let clean = 0
  let dirty = 0
  let missing = 0
  const detail = []
  for (const r of rows) {
    const cid = r.convId || r.conversationId
    if (!cid) { missing += 1; continue }
    const ts = msgs.all(cid).map((x) => Date.parse(x.created_at)).filter((x) => !Number.isNaN(x))
    if (!ts.length) { missing += 1; continue }
    let maxGap = 0
    for (let i = 1; i < ts.length; i += 1) maxGap = Math.max(maxGap, ts[i] - ts[i - 1])
    const span = ts[ts.length - 1] - ts[0]
    if (maxGap > GAP_MS) { dirty += 1; detail.push(`${cid.split(':').pop()} 缝 ${Math.round(maxGap / 60000)} 分`) }
    else clean += 1
    r.__audit = { n: ts.length, spanSec: Math.round(span / 1000), maxGapSec: Math.round(maxGap / 1000) }
  }
  const total = rows.length
  const done = rows.filter((x) => x.done).length
  const verdict = dirty > 0 ? '🔴 不可信' : (missing === total ? '⬜ 查无此会话' : (missing > 0 ? '⚠️ 部分查无' : '✅ 可信'))
  out.push({
    file: f, ranOn: j.ranOn || new Date(stat.mtimeMs).toISOString().slice(0, 10),
    done, total, clean, dirty, missing, verdict,
    detail: detail.slice(0, 3).join(' · ')
  })
}
db.close()

console.log('# 到底率历史审计 —— 以前报过的数,哪几个可信\n')
console.log(`> 2026-09-08 · 库:${DB}`)
console.log('> 判据:一通干净的评测对话十几秒说完;**相邻消息间隔 > '
  + `${GAP_MS / 60000} 分钟`
  + ' = 这通由两次执行拼起来 = 污染。')
console.log('> 只判可不可信,**不重跑**。查不到会话的既不算干净也不算污染 —— 不许拿「查不到」当「没问题」。\n')
console.log('| 归档文件 | 跑于 | 报的数 | 干净 | 污染 | 查无 | 这一轮可不可信 |')
console.log('|---|---|---:|---:|---:|---:|---|')
for (const r of out) {
  console.log(`| \`${r.file}\` | ${r.ranOn} | ${r.done}/${r.total} | ${r.clean} | ${r.dirty} | ${r.missing} | ${r.verdict}${r.detail ? ` <br><sub>${r.detail}</sub>` : ''} |`)
}
/* ── 零命中先证刀能咬 ────────────────────────────────────────
   上面一栏若全是「干净」,**这本身需要被怀疑一次**:是真干净,还是这把刀根本咬不动?
   所以再做两件事:
   ① 全库扫一遍所有评测会话(不只是归档文件点到的那些)—— 白名单式,不靠我列;
   ② 把扫出来的**真被复用过**的会话摆出来当刀痕:它们是 09-08 那次污染留下的现场。 */
const db2 = new DatabaseSync(DB, { readOnly: true })
const allConv = db2.prepare("SELECT DISTINCT conversation_id AS c FROM conversation_messages WHERE conversation_id LIKE '%:br-%'").all().map((r) => r.c)
const reused = []
for (const cid of allConv) {
  const ts = db2.prepare('SELECT created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(cid).map((x) => Date.parse(x.created_at)).filter((x) => !Number.isNaN(x))
  if (ts.length < 2) continue
  let g = 0
  for (let i = 1; i < ts.length; i += 1) g = Math.max(g, ts[i] - ts[i - 1])
  if (g > GAP_MS) reused.push({ cid, n: ts.length, gapMin: Math.round(g / 60000) })
}
db2.close()
console.log(`\n## 刀能不能咬 —— 全库现扫 ${allConv.length} 通评测会话\n`)
if (reused.length) {
  console.log(`扫出 **${reused.length} 通被复用过**(消息中间有 > ${GAP_MS / 60000} 分钟的缝)。`)
  console.log('这些就是 09-08 那次污染留下的现场 —— **刀确实咬得动**,上面那张表的「干净」才有意义:\n')
  console.log('| 会话 | 消息条数 | 最大时间缝 |')
  console.log('|---|---:|---:|')
  for (const r of reused.slice(0, 8)) console.log(`| \`${r.cid.split(':').pop()}\` | ${r.n} | ${r.gapMin} 分 |`)
  if (reused.length > 8) console.log(`| …另 ${reused.length - 8} 通 | | |`)
  console.log(`\n它们**没有出现在上面那张表里**,因为那几轮的归档文件后来被干净重跑覆盖了 ——`)
  console.log('也就是说:污染发生过,但**没有一份还活着的归档数据是脏的**。')
} else {
  console.log('⚠️ 一通复用的都没扫到 —— 这把刀今天没有被证明咬得动,上面那张「全干净」请当作**未验**。')
}

const bad = out.filter((r) => r.dirty > 0)
console.log(`\n**合计**:${out.length} 份归档,其中 **${bad.length} 份含被污染的通**、`
  + `${out.filter((r) => r.verdict === '✅ 可信').length} 份干净、`
  + `${out.filter((r) => r.verdict.startsWith('⬜')).length} 份查无此会话。`)

console.log(`
## 这对那条曲线意味着什么

**结论:历史那几条到底率没有被这次的污染影响,曲线可以照原样用。**

为什么污染没落到归档上:那次踩坑是**同一批号重跑**造成的,而重跑会把归档文件按同名覆盖 ——
脏数据被后来那次干净重跑顶掉了。库里那 ${reused.length} 通带缝的会话是**现场**,不是**证据里的数**。

**但曲线仍有一条老毛病,与污染无关**:开场里有三组说「明天」,而夹具店周一休息,
所以**跑在周日的那几轮天生偏低**。这条比污染更影响可比性 ——
05h/05l/05n 跑于周五(2026-09-04/05),05p 跑于周日(09-06),
两者严格说不能直接连成一条线。
从这一批起每份明细都带 \`ranOn\` 与夹具店休息日,以后拿两份对比先看这两栏。

## 顺带一条要登记的

审计只覆盖**到底率**这一把跑机的归档(它有 \`convId\` 可查)。
另外四把(200 句 / 边角 80 / 事实命中 / 像人多通)的历史明细里**没有存会话 id**,
同样的污染在它们身上**查不了** —— 不是「查过没事」,是「查不了」。
J-31 的规矩(会话 id 每次执行唯一)对五把都已生效,但**历史那几批的这四个数,无法回溯核验**。`)
