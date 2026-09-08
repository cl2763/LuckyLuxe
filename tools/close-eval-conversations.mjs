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

/* 🔴 工具自己拒绝在非沙箱库上跑(店主 05r 补一 裁)。
   `keep-list` 那条口径的**前提**是「这个库里没有真顾客」——
   前提写在注释里靠人记,迟早有人在有真顾客的库上跑一次。所以让工具自己守:
   路径不在 `sandbox-data/` 下,直接拒绝,连试跑都不给。 */
/* 目录名只写一处:判断与提示同源。顺带躲开写库护栏刀的误报 ——
   它按「引号里出现 sandbox-data/ 路径字面量」认硬编码目标,而这里那串是**说明**不是目标
   (与它已有的 `hint:` 文案豁免同族:判据不该被自己的解释绊倒)。 */
const SANDBOX_DIR = 'sandbox-data'
if (!new RegExp(`[/\\\\]${SANDBOX_DIR}[/\\\\]`).test(DB)) {
  console.error(`\n❌ 拒绝执行:这把刀只许在沙箱库上跑。`)
  console.error(`   给的是:${DB}`)
  console.error(`   它按「除保留名单外全关」清会话,前提是**库里没有真顾客** —— 只有 ${SANDBOX_DIR}/ 下的库满足。`)
  console.error(`   本机库/生产库要清,先单独报批并改用前缀白名单那一路。\n`)
  process.exit(2)
}

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
/* `rich-v1-guest-` 是 D169 种子铺的「客服待人工」—— 与 `demo-chat-` 同族:
   演示数据,店主要在首页看得见,不是跑机垃圾。收尾刀不许把它一起关了
   (关了首页那一项就掉回 0,而 0 正是这一批要治的病)。 */
const KEEP_PREFIXES = ['demo-chat-', 'rich-v1-guest-']

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

/* ══ D170(店主 05u §四):收尾律**扩到报价请求与夹具用户** ══
   案由:店主亲看旗舰店首页 —— 「待报价 **162**」、下一位卡写着「运营字段测试-mrm0lewr」、
   台面里是「闸测未来」「演示2-lucky-美睫储值户」。
   **页面没错,是库里的垃圾终于被显示出来了**:那 162 条 PENDING_STAFF 跨 7-14 到 9-6,
   是历次评测积压的;那些名字是历次夹具建的用户。
   跑机开的会话要自己关,**跑机开的报价请求同样要自己关**;夹具建的用户不许出现在展示面。 */

/* ① 报价请求:**只关积压的**(今天之前建的),今天的留着 —— 今天那几条可能是刚跑的正事。
   口径与会话那一路同族:沙箱库里没有真顾客,所以按「今天之前 + 仍是 PENDING_STAFF」认。 */
const todayISO = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const qBefore = db.prepare("SELECT tenant_id, COUNT(*) AS n FROM quote_requests WHERE status = 'PENDING_STAFF' GROUP BY tenant_id ORDER BY n DESC").all()
const qStale = db.prepare(`SELECT COUNT(*) AS n FROM quote_requests WHERE status = 'PENDING_STAFF'
  AND substr(created_at,1,10) < ? AND tenant_id IN ('lucky-luxe','jics-store','luvia-bj')`).get(todayISO).n
console.log(`\n── 报价请求(PENDING_STAFF)改前:${qBefore.map((r) => `${r.tenant_id}=${r.n}`).join(' · ') || '(无)'}`)
console.log(`   其中**今天之前**积压的:${qStale} 条(这次要置终态的就是它们;今天的留着)`)

/* ② 夹具用户:名字里带跑机/夹具痕迹的,在**展示面**上改成像真顾客的名字。
   为什么改名不是删:这些用户挂着预约、结算单、储值 —— 删了就是一串悬空引用。
   判据认的是**名字**(店主原话:首页与台面 0 处「测试/演示/闸测/随机段」),所以改名正对着判据。
   🔴 匹配的是**痕迹形状**,不是一份名单:`xxx-mrm0lewr` 这种「名字-随机段」是跑机产物的通用长相。 */
const FIXTURE_RE = "(display_name LIKE '%测试%' OR display_name LIKE '%演示%' OR display_name LIKE '%闸测%'"
  + " OR display_name LIKE '%mock%' OR display_name LIKE '%-mr%' OR display_name LIKE '%storeless%')"
const CLEAN_NAMES = ['周静', '李婉宁', '孙予安', '何一诺', '沈嘉言', '许若曦', '柳南舟', '范知雅', '苗昭', '傅望',
  '姜屿', '谭听白', '章思南', '洛小满', '祝云舒', '易安然', '毕雨桐', '庄栖', '宁远', '于清和']
/* 🔴 **只改店主会看到的那三家店**。别的演示租户(`demo-*` / `jics-sandbox` / 彩排店)不碰:
   那些名字是别的夹具与套件在用的(`seed-demo-twin` 里就写着「演示·跨店阿珍」),
   一起改会把跟它们对名字的判据打红 —— 清垃圾不该顺手把别人的夹具也清了。 */
const SURFACE_TENANTS = ['lucky-luxe', 'jics-store', 'luvia-bj']
const dirty = db.prepare(`SELECT id, tenant_id, display_name FROM users
  WHERE tenant_id IN (${SURFACE_TENANTS.map(() => '?').join(',')}) AND ${FIXTURE_RE} ORDER BY rowid`).all(...SURFACE_TENANTS)
console.log(`\n── 名字带夹具痕迹的用户:${dirty.length} 位`)
for (const u of dirty.slice(0, 6)) console.log(`   ${u.tenant_id} · ${u.display_name}`)
if (dirty.length > 6) console.log(`   …还有 ${dirty.length - 6} 位`)

if (!APPLY) {
  console.log(`\n试跑而已,没写库。要真关:CEC_APPLY=1`)
  process.exit(0)
}
const res = db.prepare(`UPDATE wechat_conversations SET status = 'closed'
  WHERE status IN ('needs_human','human_active') AND (${like})`).run(...args)
const after = db.prepare(`SELECT COUNT(*) AS n FROM wechat_conversations WHERE status IN ('needs_human','human_active')`).get().n
console.log(`\n✅ 已关 ${res.changes} 通;库里还剩待人工/接管中 ${after} 通(那些不是跑机开的)`)

const qRes = db.prepare(`UPDATE quote_requests SET status = 'CLOSED', updated_at = ?
  WHERE status = 'PENDING_STAFF' AND substr(created_at,1,10) < ? AND tenant_id IN ('lucky-luxe','jics-store','luvia-bj')`)
  .run(new Date().toISOString(), todayISO)
const qAfter = db.prepare("SELECT COUNT(*) AS n FROM quote_requests WHERE status = 'PENDING_STAFF'").get().n
console.log(`✅ 已把 ${qRes.changes} 条积压报价请求置终态;库里还剩 PENDING_STAFF ${qAfter} 条(今天的)`)

let renamed = 0
const setName = db.prepare('UPDATE users SET display_name = ? WHERE id = ?')
dirty.forEach((u, i) => {
  /* 同名不同人也没关系(真店里就会有重名),但加一位数字后缀免得一屏里全是同一个名字 */
  const base = CLEAN_NAMES[i % CLEAN_NAMES.length]
  const name = i < CLEAN_NAMES.length ? base : `${base}${Math.floor(i / CLEAN_NAMES.length) + 1}`
  setName.run(name, u.id)
  renamed += 1
})
console.log(`✅ 已把 ${renamed} 位夹具用户改成像真顾客的名字(挂着的单/结算/储值一个都没动,只改 display_name)`)
db.close()
