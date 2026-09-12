/* 段 7 落地的三件 · 常驻判据

   ① **D151 入站合并窗**:顾客连发几句 → 只出一条回复,几句按原文顺序并成一条记进流水;
      隔得够久 → 各答各的。窗长由 `/health` 自报,判据不猜。
   ② **待裁 #4 并句**:AI 未开通那句话要同时做到「承诺兑得了」+「指条能自己走通的路」。
   ③ **D152 折扣事实**:库里真有券才许说券,没有就明写「只说原价、不许提券」。
      这一条守的是**注入给模型的那句事实**(零编造红线的源头),
      「模型有没有照着说」由六通打分看 —— 那是人的判断,不是断言能定的事。

   还有一格 `guestIdUnsigned`:夜9 段1 起是**现测**(J-52)—— 这个进程还接不接受非服务端签发的顾客身份。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget, isTestTarget } from './test-guard.mjs'
import { discountFacts } from './discount-facts.mjs'
import { mergeWindowSeconds } from './merge-window.mjs'
import { aiOffText } from './entitlement-gate.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || requireOwnerToken()
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
/* 🔴 口径改过一次(店主 05r 补五 §三):8 秒是我 05q 写的,店主自己推翻了 ——
   「单句顾客也等 8 秒太久」。现在:默认 **4** 秒、可配 **2–10**、**12 秒封顶**。
   判据跟着翻,不是删掉:守的东西从「8 秒」变成「4 秒 + 封顶在」。 */
const mwSrc = readFileSync(join(ROOT, 'apps/api/merge-window.mjs'), 'utf8')
check('①c 窗长默认 4 秒、可配 2–10(店主 05r 补五 §三 改的口径)',
  /const DEFAULT_S = 4/.test(mwSrc) && /const MIN_S = 2/.test(mwSrc) && /const MAX_S = 10/.test(mwSrc))
check('①c2 🔴 封顶 12 秒在:刷新型的窗没有封顶会被一直打字的顾客拖到无限长',
  /const CAP_S = 12/.test(mwSrc) && /leftToCap/.test(mwSrc) && /Math\.min\(ms, leftToCap\)/.test(mwSrc))
check('①c3 🔴 `/health` 报的是**实际生效**的窗长(被 MERGE_WINDOW_MS 覆盖时也得说实话)',
  /MERGE_WINDOW_MS[\s\S]{0,200}?Math\.round\(forcedMs \/ 1000\)/.test(mwSrc))
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
  /* 可写:D160 那一组要自己造三条 FAQ 再删掉(这台实例的库是本刀自己起的临时库) */
  const db = new DatabaseSync(join(DATA_DIR, 'lucky-luxe.sqlite'))
  const health = await fetch(`${OWN}/health`).then((r) => r.json())
  check('④a `/health` 自报三个数:窗长(实际生效的)、封顶、这会儿开着几个窗',
    Number(health.mergeWindowSeconds) === Math.round(WIN_MS / 1000)
    && Number(health.mergeWindowCapSeconds) > 0 && typeof health.mergeWindowsOpen === 'number',
    JSON.stringify({ 窗: health.mergeWindowSeconds, 封顶: health.mergeWindowCapSeconds, 开着: health.mergeWindowsOpen }))
  /* 🔴 夜9 段1(J-52):这一格从**写死的 true** 改成了**现测** ——
     它等于「这个进程还接不接受非服务端签发的顾客身份」= `DEMO_LOGIN_ALLOWED`。
     所以断言也跟着改:**不再锚那个常量**,而是锚两件事 ——
       ①它是个 boolean(**不许是 null**:null 的意思是「这一格没量到」);
       ②它跟这个进程的实际状态对得上 —— 回归跑在 `ALLOW_DEMO_ADMIN_LOGIN=true` 的非生产进程里,
         所以这里应当是 `true`;真生产进程里它会是 `false`(夜9 现测过,见回执)。
     锚常量的判据在事实改变时只会拦着人改对,不会告诉人哪里错了。 */
  check('④b `/health` 的 `guestIdUnsigned` 是**量出来的 boolean**(不是写死的常量,也不许是 null)',
    typeof health.guestIdUnsigned === 'boolean', String(health.guestIdUnsigned))
  check('④b2 它跟这个进程的实际状态对得上:回归进程开着演示登录 → 这一格应当是 true',
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

  /* 🔴 D160(店主 05s §四):**合并了就得答全**。
     05q 原文写着「三问都答」,而这套刀从来没验过它 —— v4 通五三句合并只答了停车,
     判据照样绿。那是废判据(只验了「并成一条」,没验「答全」)。这里补上。
     病因现查:FAQ 直答那条路拿**整段**去匹配,命中最后一句就 return,前两句一个字没答。

     夹具**自己造三条 FAQ**(带本跑随机段,跑完删干净):
     不这么做的话,答不答得全要看这家店的知识库碰巧收了几条 ——
     那样判据验的是**夹具的运气**,不是这次修的那个机制(判据律)。 */
  const kbRun = `d160-${Date.now().toString(36)}`
  /* 🔴 列名从 **schema** 取,不从「随便一行」取 —— 表是空的时候 `SELECT * LIMIT 1`
     回的是 undefined,列名成了空数组,夹具一条都建不上而判据只会说「0 条」。现测栽过一次。 */
  const kbCols = db.prepare("SELECT name FROM pragma_table_info('tenant_kb_entries')").all().map((r) => r.name)
  const kbSeed = [
    ['几点关门', '关门,打烊,几点关', `本店 ${kbRun} 每天 20:00 关门。`],
    ['定金要多少', '定金,押金', `本店 ${kbRun} 定金 50 元。`],
    ['好停车吗', '停车,车位', `本店 ${kbRun} 楼下有停车场。`],
  ]
  const kbIds = []
  if (kbCols.length) {
    const now = new Date().toISOString()
    for (const [q, kw, a] of kbSeed) {
      const id = `kb-${kbRun}-${kbIds.length}`
      kbIds.push(id)
      const row = { id, tenant_id: tenant, question: q, keywords: kw, answer_zh: a, answer_en: a,
        enabled: 1, updated_by: 'test', created_at: now, updated_at: now }
      db.prepare(`INSERT INTO tenant_kb_entries (${kbCols.map((c) => `"${c}"`).join(',')}) VALUES (${kbCols.map(() => '?').join(',')})`)
        .run(...kbCols.map((c) => (row[c] === undefined ? null : row[c])))
    }
  }
  check('④g0 造景自证:三条 FAQ 真的建上了(建不上,下面验的是别的东西)', kbIds.length === 3, `${kbIds.length} 条`)

  const uidC = `mw-c-${Date.now().toString(36)}`
  const three = []
  three.push(ask(uidC, '你们几点关门')); await sleep(300)
  three.push(ask(uidC, '定金要多少')); await sleep(300)
  three.push(ask(uidC, '你们那儿好停车吗'))
  const gotC = (await Promise.all(three)).filter((r) => r && r.reply)
  const answerC = String(gotC[0]?.reply?.data?.answerZh || '')
  check('④g 造景自证:三句确实并成了一条(不然下面验的是单句)', gotC.length === 1, `出了 ${gotC.length} 条`)
  /* 机械判三个话题各命中一次 —— 店主给的判法。锚的是**本跑造的那三条**的内容,
     不锚「营业时间」这类通用词(通用词可能被别的句子蹭中,那就成了假绿)。 */
  const missed = [['关门', /关门/], ['定金', /定金/], ['停车', /停车/]]
    .filter(([, re]) => !re.test(answerC)).map(([t]) => t)
  check('④h 🔴 D160:三句合并 → 回复里**每句各有一段对应答案**(关门 / 定金 / 停车各命中一次)',
    missed.length === 0, JSON.stringify({ 漏了: missed, 回复: answerC.slice(0, 140) }))
  /* 收尾:自己造的 FAQ 自己删(夹具不收尾 = 判据非幂等,J 族有案底) */
  for (const id of kbIds) db.prepare('DELETE FROM tenant_kb_entries WHERE id = ?').run(id)
  check('④h2 收尾:造的三条 FAQ 已删干净',
    db.prepare(`SELECT COUNT(*) AS n FROM tenant_kb_entries WHERE id LIKE 'kb-${kbRun}-%'`).get().n === 0)

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

check('①g 小程序那一行说的是「正在看你的消息…」(窗的意思是**我在等你说完**,不是「我已经在打字」)',
  /正在看你的消息/.test(readFileSync(join(ROOT, 'miniprogram/pages/ai-chat/index.wxml'), 'utf8'))
  && !/正在输入/.test(readFileSync(join(ROOT, 'miniprogram/pages/ai-chat/index.wxml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')))

/* ═══ ⑥ D152 端到端那一半(段 7b):**没折扣就不许提折扣**,而且是闸上拦不是嘴上说 ═══
   上一批只做了「喂给模型的那句事实」—— 那是「请你别说」,不是「说了会被拦下来」。
   模型照样说得出「券后 ¥348」,顾客真会照这个价来付钱(零编造红线)。
   所以这一批把它搬到**事实闸**上:店里没有任何可用券时,回复里出现那几个字就按编事实拦。 */
const { verifyReplyFacts, passFactGate } = await import('./ai-fact-gate.mjs')
const noCoupon = { money: new Set(), pct: new Set(), noDiscount: true }
const hasCoupon = { money: new Set(), pct: new Set(), noDiscount: false }
check('⑥ 🔴 没券的店说「券后」→ 判为编事实(以前只在提示词里劝,劝不住)',
  verifyReplyFacts('原价 ¥398,券后 ¥348 哦', noCoupon).ok === false)
check('⑥b 🔴 反向守:**有券**的店说同一句话**不许**被拦(拦了就是把能说的也堵了)',
  verifyReplyFacts('原价 ¥398,券后 ¥348 哦', hasCoupon).offenders.filter((o) => o.kind === '编折扣').length === 0)
check('⑥c 没券的店只说原价 → 放行(证明拦的是「提了折扣」,不是「提了钱」)',
  verifyReplyFacts('这一款原价就是这个数,到店再看具体做什么', noCoupon).ok === true)
check('⑥d 拦下之后换的是那句「我帮您问一下」+ 转人工(与事实闸同一档,不另造一句)',
  (() => {
    const r = passFactGate({ data: { answerZh: '券后 ¥348', answerEn: '' } }, noCoupon)
    return Boolean(r.blocked) && r.reply.data.handoffRequired === true && r.reply.data.gate === 'fact_gate'
  })())
check('⑥e 闸真的接上了这条(`hasAnyDiscount` 现取,不是写死 false)',
  /hasAnyDiscount: \(tid\) => hasAnyDiscountOf\(db, tid/.test(readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8'))
  && /slots\.noDiscount = hasAnyDiscount\(tid\) === false/.test(readFileSync(join(ROOT, 'apps/api/ai-fact-gate.mjs'), 'utf8')))
/* ⑥f 数字对账:注入的那句事实里的数额,**逐字**来自库里那一行(现取,判据里零字面量) */
check('⑥f 数字对账:事实句里的券名与数额逐字来自库里那一行(判据自己不写任何数)',
  (() => {
    const row = { name: '造景券', discount_type: 'amount', amount_cents: 12345, percent_off: 0,
      min_spend_cents: 0, total_qty: 0, issued_qty: 0 }
    const fake = { prepare: () => ({ all: () => [row] }) }
    const f = discountFacts(fake, 't', (c) => `¥${(c / 100).toFixed(2)}`)
    return f.hasAny && f.note.includes(row.name) && f.note.includes('¥123.45')
  })())

/* ═══ ⑤ 封顶(店主 05r 补五 §三)——**再起一台**,窗 1 秒 / 封顶 3 秒 ═══
   为什么要单独一台:封顶是「窗一直被刷新时的上限」,得让窗短、封顶更短,才跑得完。
   造病同法:同一台参数、封顶置 0(= 不封顶),同样连发 → 只出一条 → 红。 */
async function capRun(capMs, label) {
  const port = Number(process.env.MW_CAP_PORT || 4183) + (capMs > 0 ? 0 : 1)
  const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.'))
  const kid = spawn(process.execPath, ['local-server.mjs'], {
    cwd: join(ROOT, 'apps/api'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, TEST_DB_PATH: join(dir, 'lucky-luxe.sqlite'),
      MERGE_WINDOW_MS: '1000', MERGE_WINDOW_CAP_MS: String(capMs), ALLOW_DEMO_ADMIN_LOGIN: 'true' },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  let ok = false
  for (let i = 0; i < 60 && !ok; i += 1) { ok = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false); if (!ok) await sleep(500) }
  if (!ok) { kid.kill(); rmSync(dir, { recursive: true, force: true }); return null }
  await fetch(`${base}/admin/demo/full-seed`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
  const d2 = new DatabaseSync(join(dir, 'lucky-luxe.sqlite'), { readOnly: true })
  const tid = d2.prepare(`SELECT t.id FROM tenants t JOIN stores s ON s.tenant_id = t.id AND s.is_active = 1 ORDER BY t.id LIMIT 1`).get()?.id
  d2.close()
  const uid = `mw-cap-${label}-${Date.now().toString(36)}`
  /* 连发 5 句,每隔 800ms(< 1 秒窗,所以每句都在刷新窗)。
     总跨度 ~3.2 秒 > 3 秒封顶 → 封顶那一刻先答手上的,后面的算下一窗 → **两条**。 */
  const flying = []
  for (let i = 0; i < 5; i += 1) {
    flying.push(fetch(`${base}/ai/customer-service`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ message: `第${i + 1}句想问问美甲`, lang: 'zh', clientId: uid }),
    }).then((r) => r.json()).catch(() => null))
    if (i < 4) await sleep(800)
  }
  const out = await Promise.all(flying)
  kid.kill(); rmSync(dir, { recursive: true, force: true })
  return out.filter((r) => r && r.reply).length
}
const capped = await capRun(3000, 'on')
check('⑤ 🔴 封顶:5 句每隔 0.8 秒(一直在刷新窗)→ 12 秒封顶那一刻切开 → **不止一条**',
  capped !== null && capped >= 2, `出了 ${capped} 条`)
const uncapped = await capRun(0, 'off')
check('⑤b 造病 · 反向守:把封顶去掉(CAP=0)→ 同样连发**只出一条** —— 证明上面那条是封顶挣来的',
  uncapped === 1, `出了 ${uncapped} 条`)

console.log(`\n[段 7] D151 合并窗 · 待裁#4 并句 · D152 折扣事实 · guestIdUnsigned 占位`)
if (fails.length) { console.error(`\n❌ test-merge-window ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-merge-window 通过 ${n} 项`)
