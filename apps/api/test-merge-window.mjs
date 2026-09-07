/* 段 7 落地的三件 · 常驻判据

   ① **D151 入站合并窗**:顾客连发几句 → 只出一条回复,几句按原文顺序并成一条记进流水;
      隔得够久 → 各答各的。窗长由 `/health` 自报,判据不猜。
   ② **待裁 #4 并句**:AI 未开通那句话要同时做到「承诺兑得了」+「指条能自己走通的路」。
   ③ **D152 折扣事实**:库里真有券才许说券,没有就明写「只说原价、不许提券」。
      这一条守的是**注入给模型的那句事实**(零编造红线的源头),
      「模型有没有照着说」由六通打分看 —— 那是人的判断,不是断言能定的事。

   还有一格 `guestIdUnsigned`:上线批占位(访客身份串现在客户端生成,上生产前改服务端签发)。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget, isTestTarget } from './test-guard.mjs'
import { discountFacts } from './discount-facts.mjs'
import { mergeWindowSeconds } from './merge-window.mjs'
import { aiOffText } from './entitlement-gate.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ═══ 静态 ═══ */
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const bare = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('①a 合并窗装在 `handleWecomInbound` 入口(五个进线口一起吃到,小程序自然也吃到)',
  /async function handleWecomInbound[\s\S]{0,400}?await enterMergeWindow\(conversationId/.test(bare))
check('①b 早到的那几次「作废不发」——回 `reply: null`,不是回一句空话',
  /if \(win\.superseded\) return \{[^}]*reply: null/.test(bare))
check('①c 窗长默认 8 秒、可配、越界钳到 5–15(店主 05q 原文)',
  /const DEFAULT_S = 8/.test(readFileSync(join(ROOT, 'apps/api/merge-window.mjs'), 'utf8'))
  && mergeWindowSeconds() >= 5 && mergeWindowSeconds() <= 15, String(mergeWindowSeconds()))
check('①d 合并出来的那条是**几句原文按顺序连起来**,不摘要不改写(D153 引用不重写同族)',
  /win\.parts\.join\(' '\)/.test(readFileSync(join(ROOT, 'apps/api/merge-window.mjs'), 'utf8')))
const mpChat = readFileSync(join(ROOT, 'miniprogram/pages/ai-chat/index.js'), 'utf8')
check('①e 小程序拿到 `reply: null` 时**什么都不画**(画「我没太明白」= 把等你说完演成听不懂)',
  /if \(!r \|\| !r\.reply\) return/.test(mpChat))
check('①f 🔴 小程序不许拿 `sending` 挡住第二句 —— 挡住的话窗永远合不到东西',
  /if \(!text\) return/.test(mpChat) && !/this\.data\.sending\) return/.test(mpChat))

/* ①g 补四 §四 两处小的 */
const turnCls = readFileSync(join(ROOT, 'apps/api/turn-classify.mjs'), 'utf8')
check('①g 中文全角括号后不加空格(「…周二) 可以」那个多余的空格,按值的结尾决定加不加)',
  /const gap = \(v\) => \(\/\[A-Za-z0-9\]\$\/\.test/.test(turnCls) && /\$\{v\}\$\{gap\(v\)\}可以/.test(turnCls))
/* 欢迎语是**客户端写死**的页面壳,允许留在客户端(它不是答案);
   但里面不许出现本店做不到的承诺 —— 现在那句「需要人工的话我也会帮你转接」成立,
   因为出口真会转(D147/D155 之后消息真入库、真待人工)。 */
check('①h 小程序欢迎语里不许承诺本店做不到的事(现有那句「帮你转接」成立,因为出口真会转)',
  (() => {
    const hello = (mpChat.match(/this\.push\('a', '([^']*)'/) || [])[1] || ''
    if (!hello) return false
    const promises = ['转接', '人工']
    const canHandoff = /handoffRequired/.test(mpChat)   // 页面真的处理转人工
    return promises.some((p) => hello.includes(p)) ? canHandoff : true
  })())

/* ② 并句:两件事一句话里都要有 */
for (const [zh, phone, must] of [
  ['没电话时', '', ['转给同事', '预约']],
  ['有电话时', '416-555-0000', ['转给同事', '预约', '416-555-0000']],
]) {
  const text = aiOffText({ lang: 'zh', phone })
  check(`②a 并句 ${zh}:承诺兑得了 + 指路在(${must.join(' / ')})`,
    must.every((k) => text.includes(k)), text)
}
check('②b 没电话就一个字都不提电话(不许编一个电话出来)',
  !/致电|电话/.test(aiOffText({ lang: 'zh', phone: '' })), aiOffText({ lang: 'zh', phone: '' }))

/* ③ D152:折扣事实的两面 */
check('③a 有券:注入的事实里要有券名、也要有「先折扣→再原价→最后折后价」的顺序要求',
  (() => {
    const fake = { prepare: () => ({ all: () => [{ name: '新客券', discount_type: 'amount', amount_cents: 5000, percent_off: 0, min_spend_cents: 0, total_qty: 0, issued_qty: 0 }] }) }
    const f = discountFacts(fake, 't', (c) => `¥${c / 100}`)
    return f.hasAny && f.note.includes('新客券') && f.note.includes('原价') && f.note.includes('折后价')
  })())
check('③b 🔴 无券:明写「只说原价、不许提券」——零编造红线的源头就在这句',
  (() => {
    const fake = { prepare: () => ({ all: () => [] }) }
    const f = discountFacts(fake, 't', (c) => String(c))
    return !f.hasAny && f.note.includes('只说原价') && f.note.includes('不许')
  })())
check('③c 发完的券不算「可用折扣」(发完了还说有,就是假数)',
  (() => {
    const fake = { prepare: () => ({ all: () => [{ name: '发完了', discount_type: 'amount', amount_cents: 5000, percent_off: 0, min_spend_cents: 0, total_qty: 10, issued_qty: 10 }] }) }
    return discountFacts(fake, 't', (c) => String(c)).hasAny === false
  })())

/* ═══ 行为层:**自己起一台带窗的实例**(与 test-perf-base-migration 同法)═══

   为什么不用回归那台:窗一开,每一条 AI 进线都要等 8 秒 —— 整轮回归从 2 分钟变成跑不完
   (现测出来的,不是推理)。所以 `run-all-tests.sh` 里把窗关成 0,
   D151 的行为改由这一段**自带一台窗 = 1.5 秒的实例**来验。
   关掉那里**不等于没验**,验在这儿;这一段跑不成就明说,不冒充通过。 */
const { spawn } = await import('node:child_process')
const { mkdtempSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const PORT = Number(process.env.MW_PORT || 4179)
const WIN_MS = 1500
const DATA_DIR = mkdtempSync(join(tmpdir(), 'll-ci-data.'))
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: join(ROOT, 'apps/api'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR, TEST_DB_PATH: join(DATA_DIR, 'lucky-luxe.sqlite'), MERGE_WINDOW_MS: String(WIN_MS), ALLOW_DEMO_ADMIN_LOGIN: 'true' },
  stdio: 'ignore',
})
const OWN = `http://127.0.0.1:${PORT}`
let up = false
for (let i = 0; i < 60 && !up; i += 1) {
  up = await fetch(`${OWN}/health`).then((r) => r.ok).catch(() => false)
  if (!up) await sleep(500)
}
if (!up) {
  check('④ 自带实例起得来(起不来就是本轮没验到,不是通过)', false, `${OWN} 没起来`)
} else {
  await fetch(`${OWN}/admin/demo/full-seed`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
  const db = new DatabaseSync(join(DATA_DIR, 'lucky-luxe.sqlite'), { readOnly: true })
  const health = await fetch(`${OWN}/health`).then((r) => r.json())
  check('④a `/health` 自报窗长(判据与店主都不用猜「到底等了几秒」)',
    Number(health.mergeWindowSeconds) >= 5 && Number(health.mergeWindowSeconds) <= 15, String(health.mergeWindowSeconds))
  check('④b `/health` 有上线批那格 `guestIdUnsigned`(上线批那条判据看它变 false)',
    health.guestIdUnsigned === true, String(health.guestIdUnsigned))
  const tenant = db.prepare(`SELECT t.id FROM tenants t JOIN stores s ON s.tenant_id = t.id AND s.is_active = 1 ORDER BY t.id LIMIT 1`).get()?.id
  check('④c 造景自证:取得到一家店', Boolean(tenant), String(tenant))
  const ask = (uid, m) => fetch(`${OWN}/ai/customer-service`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tenant },
    body: JSON.stringify({ message: m, lang: 'zh', clientId: uid }),
  }).then((r) => r.json()).catch(() => null)

  const uidA = `mw-a-${Date.now().toString(36)}`
  const burst = []
  burst.push(ask(uidA, '我想做美甲')); await sleep(300)
  burst.push(ask(uidA, '明天下午有空位吗')); await sleep(300)
  burst.push(ask(uidA, '大概多少钱'))
  const got = await Promise.all(burst)
  check('④d 🔴 三句连发(间隔小于窗) → **只出一条回复**(早到的两次作废不发)',
    got.filter((r) => r && r.reply).length === 1, `出了 ${got.filter((r) => r && r.reply).length} 条`)
  const cidA = db.prepare('SELECT id FROM wechat_conversations WHERE tenant_id = ? AND external_user_id = ?').get(tenant, `mp-guest:${uidA}`)?.id
  const custA = db.prepare("SELECT content FROM conversation_messages WHERE conversation_id = ? AND role = 'customer' ORDER BY rowid").all(cidA || '').map((r) => r.content)
  check('④e 三句**按原文顺序并成一条**记进流水(不摘要、不去重、不改写)',
    custA.length === 1 && custA[0] === '我想做美甲 明天下午有空位吗 大概多少钱', JSON.stringify(custA))

  const uidB = `mw-b-${Date.now().toString(36)}`
  const r1 = await ask(uidB, '你们几点关门')
  await sleep(WIN_MS + 900)
  const r2 = await ask(uidB, '周末营业吗')
  check('④f 反向守:两句隔开超过一个窗 → **两条回复**(不是「永远只答一条」)',
    Boolean(r1 && r1.reply) && Boolean(r2 && r2.reply),
    JSON.stringify({ 第一条: Boolean(r1 && r1.reply), 第二条: Boolean(r2 && r2.reply) }))
  db.close()
}
child.kill()
rmSync(DATA_DIR, { recursive: true, force: true })   // 夹具收尾:临时库跑完就删

console.log(`\n[段 7] D151 合并窗 · 待裁#4 并句 · D152 折扣事实 · guestIdUnsigned 占位`)
if (fails.length) { console.error(`\n❌ test-merge-window ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-merge-window 通过 ${n} 项`)
