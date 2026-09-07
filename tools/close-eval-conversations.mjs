#!/usr/bin/env node
/* J-33 · 跑机收尾:把评测跑机留下的会话关掉(店主 05r §一 末裁)

   案由:店主在新首页上看见「客服待人工 **660**」。现查 4310 沙箱库,
   `lucky-luxe` 的 `needs_human` 656 + `human_active` 4 —— **全是历次评测跑机留下的会话**。
   跑机每跑一轮就开十几通、说完就走,状态停在 needs_human,于是首页的「待处理」
   一路涨到 660。**那不是店里真有 660 个人在等,是我的跑机没收摊。**

   ══ 只关「跑机自己开的」,不按店清 ══
   评测会话的 `external_user_id` 一律带跑机前缀(`br-` / `hf-` / `ta-` / `d145-` …),
   会话 id 形如 `wecom:<tenant>:<uid>`。**只认这些前缀**;
   真顾客的会话一个都不许碰 —— 这是「按 J-31 的执行随机段认领,不许按店清」那句话的落法。

   ══ 只改 status,别的一个字段不动 ══
   写前 `tools/db-backup.mjs`,写后 `receipt-db-proof.sh`(快照 + 逐行指纹两把都绿才许说「未动」)。
   ⚠️ 逐行指纹会把这次改动如实报成「旧行消失 N 行」—— **那是对的**,这次就是要改行;
   回执里写清「改的是哪 N 行、为什么」,而不是把判据调松。

   用法:CEC_DB=<库绝对路径> [CEC_APPLY=1] node tools/close-eval-conversations.mjs
   不带 `CEC_APPLY=1` 只试跑报数,不写库。 */
import { DatabaseSync } from 'node:sqlite'
import { requireTarget } from './db-target.mjs'

const DB = requireTarget({
  envName: 'CEC_DB=<库文件绝对路径>', value: process.env.CEC_DB,
  hint: '(评测跑机打的是哪个库就清哪个;通常是沙箱库。**不许指本机库**)',
})
const APPLY = process.env.CEC_APPLY === '1'

/* 跑机前缀白名单 —— 加一把新跑机就往这里加一条,不许写成「除了真顾客都算」 */
/* 试跑一次又扫出两族(`matrix-` 是 66 项矩阵套件、`sim-` 是模拟器套件)——
   **白名单就该这么长出来**:先试跑、看「不是跑机开的」那一栏里还剩谁,一族一族收。
   `demo-chat-` 故意留着:那是演示种子铺的,店主演示时要看得见,不是跑机垃圾。 */
const RUNNER_PREFIXES = ['br-', 'hf-', 'ta-', 'd145-', 'd147-', 'd148-', 'dp-', 'warmup-', 'fact-', 'edge-', 'gate-',
  'matrix-', 'sim-', 'sim027-', 'guard-', 'silent-', 'after-sales-', 'ent-', 'kb-', 'quote-', 'flow-', 'wm-', 'ai-', 'test-', 'tenant-', 'closed-', 'bi3-', 'fga-', 'fgb-']

/* 🔴 前缀白名单追到第三轮还在冒新族(`profile-link-` / `hold-human-` / `iso-b-` …)——
   **这说明「靠列举前缀」本来就是黑名单思维的变体**(判据三:数「我列的都对」永远漏没列的)。
   所以给沙箱一条**反过来的**口径:`CEC_MODE=keep-list` 时,
   **除了保留名单里的,其余全关**,并把关掉的逐个前缀报出来给人看。
   为什么只给沙箱:那个库里**没有真顾客**(店主 05r 明写「4128 不动 —— 那里的 1 条是小婕店真会话」);
   在有真顾客的库上永远只许用前缀白名单那一路。 */
const MODE = process.env.CEC_MODE === 'keep-list' ? 'keep-list' : 'prefix'
const KEEP_PREFIXES = ['demo-chat-']   // 演示种子铺的,店主演示时要看得见

const db = new DatabaseSync(DB, { readOnly: !APPLY })
const like = MODE === 'keep-list'
  ? `NOT (${KEEP_PREFIXES.map(() => 'external_user_id LIKE ?').join(' OR ')})`
  : RUNNER_PREFIXES.map(() => 'external_user_id LIKE ?').join(' OR ')
const args = (MODE === 'keep-list' ? KEEP_PREFIXES : RUNNER_PREFIXES).map((p) => `${p}%`)

const before = db.prepare(`SELECT tenant_id, status, COUNT(*) AS n FROM wechat_conversations
  WHERE status IN ('needs_human','human_active') GROUP BY tenant_id, status ORDER BY n DESC`).all()
const mine = db.prepare(`SELECT tenant_id, COUNT(*) AS n FROM wechat_conversations
  WHERE status IN ('needs_human','human_active') AND (${like}) GROUP BY tenant_id ORDER BY n DESC`).all(...args)
const notMine = db.prepare(`SELECT tenant_id, external_user_id FROM wechat_conversations
  WHERE status IN ('needs_human','human_active') AND NOT (${like}) LIMIT 10`).all(...args)

console.log(`库: ${DB}`)
console.log(`\n改前 · 所有待人工/接管中:`)
for (const r of before) console.log(`  ${String(r.tenant_id).padEnd(16)} ${r.status.padEnd(14)} ${r.n}`)
console.log(`\n口径:${MODE === 'keep-list' ? '除保留名单外全关(仅限没有真顾客的沙箱库)' : '只关前缀白名单里的'}`)
console.log(`\n其中**这次要关的**:`)
for (const r of mine) console.log(`  ${String(r.tenant_id).padEnd(16)} ${r.n}`)
console.log(`\n**这次不碰的**(列出来给人看):${notMine.length ? '' : '(无)'}`)
for (const r of notMine) console.log(`  ${r.tenant_id} · ${r.external_user_id}`)

if (!APPLY) {
  console.log(`\n试跑而已,没写库。要真关:CEC_APPLY=1`)
  process.exit(0)
}
const res = db.prepare(`UPDATE wechat_conversations SET status = 'closed'
  WHERE status IN ('needs_human','human_active') AND (${like})`).run(...args)
const after = db.prepare(`SELECT COUNT(*) AS n FROM wechat_conversations WHERE status IN ('needs_human','human_active')`).get().n
console.log(`\n✅ 已关 ${res.changes} 通;库里还剩待人工/接管中 ${after} 通(那些不是跑机开的)`)
db.close()
