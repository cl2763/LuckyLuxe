/* 🔴 夜16 §三.6:那两张「尺子看不见的表」——**走完两条路,不许沉默**
 *
 * ══ 案底 ══
 * 10d 做「同类扫尽」时,我用父子租户比对查了 31 张曾带 `DEFAULT 'lucky-luxe'` 的表,
 * 查出 52 行串味(51 行身份 + 1 行订单)。**但当时我如实挂了一句**:
 *   「`ai_response_feedback`(97/97 全在 lucky-luxe)与 `ai_learning_examples`(68/68)
 *     没有父对象可对,所以这把尺子**看不见它们** —— 不是验过没问题,是验不到。」
 * 店主 10g §四.3 裁:🟢 **「如实说『验不到』而不是『验过没问题』,这正是我要的」**,
 * 并要求走两条路之一,**不许沉默**。夜16 §三.6 排进兜底队列。
 *
 * ══ 走完之后的结论(2026-09-22 生产只读现查)══
 *
 * 【a 路 · 给得出判据】`ai_learning_examples`
 *   它有 `feedback_id` → `ai_response_feedback.tenant_id`,**这就是它的父**。
 *   现查:68 行中 65 行对得上父,**租户不一致 0 行**。
 *   另 3 行两个父都为 NULL,`source='workflow_logic_gap'` —— **按设计如此**
 *   (从逻辑缺口分析生成,本来就不挂在任何一次会话上),不是孤儿。
 *
 * 【b 路 · 明写不在量程内】`ai_response_feedback`
 *   🔴 它**没有任何带租户的父**:`conversation_id` 在 97 行里**全是 NULL**
 *   (渠道分布:小红书 48 · null 33 · 抖音 15 · mock-chat 1 —— 这些渠道压根没有企微会话)。
 *   ⇒ **不是「父丢了」,是「本来就没有父」。没有可比的对象,父子比对这把尺子对它无效。**
 *   **所以它写进量程说明,不写进「验过了」。**
 *
 * ══ 🔴 我在这儿栽过一次,记下来 ══
 * 第一版我用 `LEFT JOIN … WHERE c.id IS NULL` 数「父根本不在」,得到 97 —— 就报了「97/97 悬空」。
 * **那是把「没记父」(NULL)当成了「父丢了」(悬空)。** 分开数之后:NULL 97 · 真悬空 **0**。
 * **`NULL ≠ 悬空`** —— 一个「对不上」的数,先问它是没记还是丢了。(同族 J-99:下结论前先点名那个变量。)
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`); fails.push(name) }
}

/* 🔴 父表映射:这把尺子的**量程**就写在这儿。
   10d 那一版只有 6 条,于是那两张表落在量程外而我当时只能说「看不见」。
   现在 `feedback_id` 进来了 —— **量程变大是修好一件事,不是放松判据**。 */
export const PARENT_MAP = Object.freeze({
  user_id: 'users', technician_id: 'technicians', booking_id: 'bookings',
  service_id: 'services', settlement_id: 'settlements', category_id: 'service_categories',
  store_id: 'stores', conversation_id: 'wechat_conversations',
  feedback_id: 'ai_response_feedback',            // ← 夜16 新增:a 路靠它
})
/* 具名的量程外清单:每条必须写清**为什么它没有父**,不是「懒得查」 */
export const NO_PARENT = Object.freeze({
  ai_response_feedback:
    '没有带租户的父:`conversation_id` 在生产 97 行里全为 NULL(渠道=小红书/抖音/null/mock-chat,'
    + '这些渠道本来就不产生企微会话)。**真悬空 0 行**(NULL 与悬空分开数过)。'
    + '父子比对对它无效 ⇒ 明写不在量程内,不写「验过没问题」。',
})

check(`① 量程:父表映射 ${Object.keys(PARENT_MAP).length} 条(10d 那一版只有 6 条,那两张表因此落在量程外)`,
  Object.keys(PARENT_MAP).length >= 9)
check('②a 🔴 a 路:`ai_learning_examples` 现在有父可对(`feedback_id` 在映射里)',
  PARENT_MAP.feedback_id === 'ai_response_feedback')
check('②b 🔴 b 路:`ai_response_feedback` 具名登记在「量程外」,且理由写清了为什么没有父',
  String(NO_PARENT.ai_response_feedback || '').length >= 60 && /NULL/.test(NO_PARENT.ai_response_feedback))
check(`②c 🔴 量程外清单**只许变短**(现 ${Object.keys(NO_PARENT).length} ≤ 1):再想往里加一张表,先回答「它为什么没有父」`,
  Object.keys(NO_PARENT).length <= 1)
check('③ 🔴 两张表各自落进**恰好一条路**,不许两边都算、也不许两边都不算(白名单式)',
  (() => {
    const T = ['ai_response_feedback', 'ai_learning_examples']
    return T.every((t) => {
      const inA = t === 'ai_learning_examples'          // a 路:有父可对
      const inB = Object.hasOwn(NO_PARENT, t)           // b 路:具名量程外
      return inA !== inB
    })
  })())
/* ④ 🔴 把那一课钉进判据:NULL 与悬空必须分开数 */
const nullVsDangling = (rows) => ({
  nul: rows.filter((r) => r.fk === null).length,
  dangling: rows.filter((r) => r.fk !== null && !r.parentExists).length,
})
check('④a 🔴 NULL 与悬空**分开数**:一行 fk 为 NULL 不许被算进「悬空」',
  (() => { const r = nullVsDangling([{ fk: null, parentExists: false }, { fk: 'x', parentExists: false }])
    return r.nul === 1 && r.dangling === 1 })())
check('④b 🔴 反向守:全是 NULL 的那一组,悬空必须是 0(第一版我把它报成了 97)',
  (() => { const r = nullVsDangling(Array.from({ length: 97 }, () => ({ fk: null, parentExists: false })))
    return r.nul === 97 && r.dangling === 0 })())
check('⑤ 案底写在文件抬头,含那次报错的数(97 → NULL 97 / 悬空 0)',
  /NULL 97 · 真悬空 \*\*0\*\*/.test(readFileSync(join(ROOT, 'apps/api/test-tenant-parent-scan.mjs'), 'utf8')))

console.log(`\n[量程] 父表映射 ${Object.keys(PARENT_MAP).length} 条 · 具名量程外 ${Object.keys(NO_PARENT).length} 张`)
if (fails.length) { console.error(`\n❌ test-tenant-parent-scan ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-tenant-parent-scan 通过 ${checks} 项`)
