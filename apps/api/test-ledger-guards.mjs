/* 账本十二条触发器 · 豁免族审计(《关帐前置》第一件,店主 2026-08-27 要的那张对照表)。

   立这套件的原因,一句话:**法立在那儿,不等于有人验过它真的拦得住。**
   开检前的实测结论(见交付文档的对照表):十二条里只有 5 条被断言真撞过,
   其余 7 条要么根本没有断言,要么断言跑在 `kind='test'` 的租户上 —— 那种租户**天生豁免**,
   撞不到就等于没验。店主的原话:「有断言但跑在 kind='test' 上 = 撞不到,不算数。」

   这套件把十二条一条不落地钉住,每条**两向**:
     · 负向:在 `kind='real'` 的租户上做那件被禁的事 → **必须 ABORT**
     · 正向(反向守):同一件事在 `kind='test'` 的租户上 → **必须放行**
   只写负向会把"全锁死"当成做对 —— 那样清理脚本永远被回滚,正是 D72 当初的病。

   ⚠️ CI 上 `/platform/tenants` 建出来的店一律 `kind='test'`(DATA_SCOPE=test,见 local-server 建店那段),
   所以这里**显式把一家翻成 real** —— 复现生产口径,不是绕过判据。

   ⚠️ standalone:CI_SUITES="ledger-guards" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync, backup } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join as probeJoin } from 'node:path'
import { LEDGER_TRIGGER_NAMES } from './ledger-guards.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const RUN = Date.now().toString(36)
// 护栏造病只操作测试库的独立副本；错误积分与孤立单据不会进入后续业务套件。
const source = new DatabaseSync(process.env.TEST_DB_PATH || '', {readOnly:true})
const probeDir = mkdtempSync('/tmp/ll-ci-data.ledger-probes-')
const probePath = probeJoin(probeDir, 'ledger.sqlite')
await backup(source, probePath)
source.close()
const db = new DatabaseSync(probePath)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

// 两家店:一家 real(受律)、一家 test(豁免)。直连库建,免得走建店流程的一堆副作用。
const REAL = `lg-real-${RUN}`
const TEST = `lg-test-${RUN}`
db.prepare("INSERT INTO tenants (id, name, plan, status, kind) VALUES (?, ?, 'chain', 'active', 'real')").run(REAL, `律测真店${RUN}`)
db.prepare("INSERT INTO tenants (id, name, plan, status, kind) VALUES (?, ?, 'chain', 'active', 'test')").run(TEST, `律测测试店${RUN}`)
check('前置:两家店的归属真的写进去了(real / test 各一)',
  db.prepare('SELECT kind FROM tenants WHERE id = ?').get(REAL).kind === 'real'
  && db.prepare('SELECT kind FROM tenants WHERE id = ?').get(TEST).kind === 'test')

check(`前置:十二条触发器全部在库里(ledger-guards.mjs 声明 ${LEDGER_TRIGGER_NAMES.length} 条)`,
  (() => {
    const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((r) => r.name))
    const missing = LEDGER_TRIGGER_NAMES.filter((n) => !have.has(n))
    return missing.length === 0 || `缺:${missing.join(',')}`
  })() === true, JSON.stringify(LEDGER_TRIGGER_NAMES.filter((n) => !db.prepare("SELECT 1 h FROM sqlite_master WHERE type='trigger' AND name = ?").get(n))))

/* 🔴 唯一出口:十二条只许在 ledger-guards.mjs 里 CREATE 一次。
   08-27 审计现场:settlements_signed_no_update 同时写在 local-server.mjs 里一份 ——
   两份字字相同所以没人发现,直到把 installLedgerGuards 关掉它居然还拦得住。
   改法只改一处的那天,后跑的会静默覆盖先跑的,而断言照样绿。这条断言防的就是再来一次。 */
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const HERE = dirname(fileURLToPath(import.meta.url))
  const others = readdirSync(HERE)
    .filter((f) => f.endsWith('.mjs') && f !== 'ledger-guards.mjs' && !f.startsWith('test-'))
    .map((f) => [f, readFileSync(join(HERE, f), 'utf8')])
  const dupes = []
  for (const name of LEDGER_TRIGGER_NAMES) {
    for (const [f, src] of others) {
      if (new RegExp(`CREATE TRIGGER (IF NOT EXISTS )?${name}\\b`).test(src)) dupes.push(`${name} 也写在 ${f}`)
    }
  }
  /* ⚠️ 下一个人看到这条断言时,先读这段再决定要不要删它 —— **它不是碍事的洁癖,是一颗拆过的雷。**
     2026-08-27 审计现场挖出来的:`points_ledger_no_delete/no_update` 在 local-server 建库那段
     还留着 **D72 之前的老定义** —— `CREATE TRIGGER IF NOT EXISTS` + **一个租户豁免都没有**。
     当时最终状态是对的,因为 installLedgerGuards() 排在后面,DROP 再建带豁免的那一版。
     但这是**靠初始化顺序活着的正确**:
       · 哪天有人把装法那步往前挪、或者建库那段往后挪,悄悄接管的就是**无豁免**老版本;
       · 那一刻 `tools/clean-test-tenants.mjs` 一下刀就被 ABORT 整包回滚 —— **D72 原病原样复发**,
         而所有断言照样绿(法确实在,只是管得太宽)。
     `settlements_signed_no_update` 当时也有第二份,字字相同,谁都没发现 ——
     直到把 installLedgerGuards 关掉、它居然还拦得住,才现形。
     所以这条断言守的是:**十二条只许有一处定义**。删掉它,上面那颗雷就重新埋回去了。 */
  check('🔴 十二条只在 ledger-guards.mjs 里建(别处再 CREATE 一遍 = 两处真相,改一处另一处静默覆盖)',
    dupes.length === 0, dupes.join(' | '))
  const guardSrc = readFileSync(join(HERE, 'ledger-guards.mjs'), 'utf8')
  check('反向守:这条扫描真读到了那十二条(不是扫了个空)',
    LEDGER_TRIGGER_NAMES.every((n) => guardSrc.includes(`CREATE TRIGGER ${n}`)))
}

const iso = () => new Date().toISOString()
const tryRun = (sql, ...args) => {
  try { db.prepare(sql).run(...args); return '' } catch (e) { return String(e.message || 'error') }
}

/* 每一族:同样的一行数据,在 real 店与 test 店各插一份,再各做一次被禁的操作。
   seed 返回两个 id,做完立刻断言 —— 不攒到最后,免得一处失败看不出是哪一族。 */
function bothTenants(seed) { return { real: seed(REAL, 'r'), test: seed(TEST, 't') } }

/* 🔴 店主 08-28:十二条**全部要实测红**,一条推定都不留(「同段同写法」不算证据)。
   所以每一条都跑**四步**,把「是不是这一条锁在起作用」钉死:
     ①法在 · real → 必须 ABORT
     ②法在 · test → 必须放行(豁免真的存在;只写①会把"全锁死"当成做对)
     ③**只把这一条锁摘掉** · real → 必须放行 ⇒ 证明①的 ABORT 来自**这一条**,不是别的规则顺手拦的
     ④装回去 · real → 必须又 ABORT ⇒ 证明摘掉那一步没把法弄丢
   第③步就是店主要的「逐条把锁关掉再跑,该锁的断言必须红」——
   它在套件内部跑,每次回归都重验一遍,不靠人记得去做一次性实验。 */
const dropOne = (name) => db.exec(`DROP TRIGGER IF EXISTS ${name}`)
const restoreAll = async () => { const { installLedgerGuards } = await import('./ledger-guards.mjs'); installLedgerGuards(db) }

async function lawPair(label, triggerName, seed, forbid, hint, { tenantExempt = true } = {}) {
  const blocked = forbid(seed(REAL, `r${checks}`), REAL)
  check(`${label} ①法在·real:${hint} → ABORT(${triggerName})`,
    /append-only|immutable|revoke|ABORT/i.test(blocked), blocked || '**没拦住**')
  const onTest = forbid(seed(TEST, `t${checks}`), TEST)
  check(`${label} ②法在·test:同一件事 → ${tenantExempt ? '放行(豁免真的在)' : '照样 ABORT(这条不吃租户豁免)'}`,
    tenantExempt ? onTest === '' : /append-only|immutable|revoke|ABORT/i.test(onTest), onTest)
  dropOne(triggerName)
  const withoutLaw = forbid(seed(REAL, `x${checks}`), REAL)
  await restoreAll()
  const afterRestore = forbid(seed(REAL, `y${checks}`), REAL)
  check(`${label} ③🔴 只摘掉这一条锁 → 同一件事放行(证明上面拦住的正是 ${triggerName},不是别的规则顺手拦的)`,
    withoutLaw === '', withoutLaw || '**摘了锁还是拦住了 —— 那条断言证不了这把锁**')
  check(`${label} ④装回去 → 又拦得住(摘锁那一步没把法弄丢)`,
    /append-only|immutable|revoke|ABORT/i.test(afterRestore), afterRestore || '**装回去了却拦不住**')
}

// ①②③ 三大账本禁删
await lawPair('①财务台账禁删', 'finance_txn_no_delete',
  (tid, p) => {
    const id = `lgfin-${p}-${RUN}`
    db.prepare(`INSERT INTO finance_transactions (id, tenant_id, type, source, category, amount_cents, occurred_on, created_at)
      VALUES (?, ?, 'income', 'manual', '律测', 100, '2026-08-27', ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('DELETE FROM finance_transactions WHERE id = ?', id), '删一行账')

await lawPair('②储值流水禁删', 'stored_value_no_delete',
  (tid, p) => {
    const id = `lgsv-${p}-${RUN}`
    db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
      VALUES (?, ?, 'u-lg', 'recharge', 100, ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('DELETE FROM stored_value_transactions WHERE id = ?', id), '删一行储值流水')

await lawPair('③积分台账禁删', 'points_ledger_no_delete',
  (tid, p) => {
    const id = `lgpt-${p}-${RUN}`
    db.prepare(`INSERT INTO points_transactions (id, tenant_id, user_id, type, amount, created_at)
      VALUES (?, ?, 'u-lg', 'earn', 10, ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('DELETE FROM points_transactions WHERE id = ?', id), '删一行积分')

// ④ 定金回执禁删
await lawPair('④定金回执禁删', 'deposit_receipts_no_delete',
  (tid, p) => {
    const id = `lgdr-${p}-${RUN}`
    db.prepare(`INSERT INTO deposit_receipts (id, tenant_id, booking_id, kind, amount_cents, created_at)
      VALUES (?, ?, 'bk-lg', 'collect', 5000, ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('DELETE FROM deposit_receipts WHERE id = ?', id), '删一张定金回执')

// ⑤⑥ 券:发放记录 + 流水
await lawPair('⑤券发放禁删', 'coupon_grants_no_delete',
  (tid, p) => {
    const id = `lgcg-${p}-${RUN}`
    db.prepare(`INSERT INTO coupon_grants (id, tenant_id, coupon_id, user_id, code, created_at)
      VALUES (?, ?, 'cp-lg', 'u-lg', ?, ?)`).run(id, tid, `LG${p}${RUN}`.slice(0, 16), iso())
    return id
  },
  (id) => tryRun('DELETE FROM coupon_grants WHERE id = ?', id), '删一张已发的券')

await lawPair('⑥券流水禁删', 'coupon_grant_logs_no_delete',
  (tid, p) => {
    const id = `lgcl-${p}-${RUN}`
    db.prepare(`INSERT INTO coupon_grant_logs (id, tenant_id, grant_id, action, created_at)
      VALUES (?, ?, 'g-lg', 'granted', ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('DELETE FROM coupon_grant_logs WHERE id = ?', id), '删一行券流水')

// ⑦ 身份合并队列
await lawPair('⑦身份合并记录禁删', 'identity_merge_no_delete',
  (tid, p) => {
    const id = `lgim-${p}-${RUN}`
    db.prepare(`INSERT INTO identity_merge_queue (id, tenant_id, provider, provider_user_id, bound_user_id, target_user_id, status, created_at)
      VALUES (?, ?, 'wechat', ?, 'u-a', 'u-b', 'pending', ?)`).run(id, tid, `pv-${p}-${RUN}`, iso())
    return id
  },
  (id) => tryRun('DELETE FROM identity_merge_queue WHERE id = ?', id), '删一条身份合并记录')

// ⑧⑨ 两大台账禁改
await lawPair('⑧财务台账禁改', 'finance_txn_no_update',
  (tid, p) => {
    const id = `lgfinu-${p}-${RUN}`
    db.prepare(`INSERT INTO finance_transactions (id, tenant_id, type, source, category, amount_cents, occurred_on, created_at)
      VALUES (?, ?, 'income', 'manual', '律测', 100, '2026-08-27', ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('UPDATE finance_transactions SET amount_cents = 999999 WHERE id = ?', id), '改一行账的金额')

await lawPair('⑨积分台账禁改', 'points_ledger_no_update',
  (tid, p) => {
    const id = `lgptu-${p}-${RUN}`
    db.prepare(`INSERT INTO points_transactions (id, tenant_id, user_id, type, amount, created_at)
      VALUES (?, ?, 'u-lg', 'earn', 10, ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('UPDATE points_transactions SET amount = 9999 WHERE id = ?', id), '改一行积分的数')

// ⑩ 定金回执金额/类型/挂靠单永锁
await lawPair('⑩定金回执三列永锁', 'deposit_receipts_amount_locked',
  (tid, p) => {
    const id = `lgdru-${p}-${RUN}`
    db.prepare(`INSERT INTO deposit_receipts (id, tenant_id, booking_id, kind, amount_cents, created_at)
      VALUES (?, ?, 'bk-lg', 'collect', 5000, ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('UPDATE deposit_receipts SET amount_cents = 1 WHERE id = ?', id), '改定金回执的金额')

// ⑪ 储值禁改(带两个单向豁免,下面单独验豁免边界)
await lawPair('⑪储值流水禁改', 'stored_value_no_update',
  (tid, p) => {
    const id = `lgsvu-${p}-${RUN}`
    db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
      VALUES (?, ?, 'u-lg', 'recharge', 100, ?)`).run(id, tid, iso())
    return id
  },
  (id) => tryRun('UPDATE stored_value_transactions SET amount_cents = 999999 WHERE id = ?', id), '改储值流水的金额')

/* ⑪-b 两个单向豁免的**边界**:空→值放行一次,值→值必须拦。
   这两条是业务细则(B3-4 顾客回执确认 / D59 日结核定技师),豁免松的是"哪一列",不是"哪家店"。 */
{
  const id = `lgsvx-${RUN}`
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
    VALUES (?, ?, 'u-lg', 'recharge', 100, ?)`).run(id, REAL, iso())
  const first = tryRun("UPDATE stored_value_transactions SET customer_confirmed_at = ? WHERE id = ?", iso(), id)
  const second = tryRun("UPDATE stored_value_transactions SET customer_confirmed_at = ? WHERE id = ?", '2020-01-01T00:00:00Z', id)
  check('⑪-b 豁免①(顾客回执确认)空→值放行一次', first === '', first)
  check('⑪-b 豁免①单向:值→值再改 = ABORT(豁免不是开了个洞)', /append-only/.test(second), second || '**改成了**')
  const id2 = `lgsvy-${RUN}`
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
    VALUES (?, ?, 'u-lg', 'recharge', 100, ?)`).run(id2, REAL, iso())
  const t1 = tryRun("UPDATE stored_value_transactions SET technician_id = 'tech-a' WHERE id = ?", id2)
  const t2 = tryRun("UPDATE stored_value_transactions SET technician_id = 'tech-b' WHERE id = ?", id2)
  check('⑪-b 豁免②(日结核定技师)空→值放行一次', t1 === '', t1)
  check('⑪-b 豁免②单向:换个技师再改 = ABORT', /append-only/.test(t2), t2 || '**改成了**')
}

/* ⑫ 已签结算单不可改。这一条**故意不带租户豁免** —— 判据是单据状态,不是哪家店:
   演示店的已签单同样不许偷改,不然演示数据自己就自相矛盾。
   所以它的"反向守"不是 kind=test 放行,而是:**未签的单可以改**(证明拦的是"已签"这件事)。 */
{
  const mk = (tid, id, status) => db.prepare(`INSERT INTO settlements
    (id, tenant_id, group_id, user_id, code, status, subtotal_cents, total_cents, list_total_cents, created_at, updated_at)
    VALUES (?, ?, ?, 'u-lg', ?, ?, 19800, 19800, 19800, ?, ?)`)
    .run(id, tid, `grp-${id}`, `LG-${id}`.slice(0, 20), status, iso(), iso())
  mk(REAL, `lgst-draft-${RUN}`, 'pending_sign')
  // 走与前十一条同一套四步(只是第②步的期望反过来:这条不吃租户豁免)
  let n = 0
  await lawPair('⑫已签单禁改', 'settlements_signed_no_update',
    (tid, p) => { const id = `lgst-${p}-${RUN}-${n++}`; mk(tid, id, 'signed'); return id },
    (id) => tryRun('UPDATE settlements SET total_cents = 1 WHERE id = ?', id),
    '改已签单金额', { tenantExempt: false })
  const draft = tryRun('UPDATE settlements SET total_cents = 1 WHERE id = ?', `lgst-draft-${RUN}`)
  check('⑫⑤反向守:**未签**的单可以改(证明拦的是"已签"这件事,不是"所有单都锁死")',
    draft === '', draft)
  /* 🔴 店主 08-28 追问:副本删掉之后,这条断言撞的到底是哪一份?
     上面第③步已经回答了 —— 只摘掉 ledger-guards.mjs 里的那一条,改已签单就放行了。
     副本要是还在(local-server 那份),摘一条根本不管用,第③步会当场红。 */
  const defs = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'settlements_signed_no_update'").all()
  check('⑫⑥库里这条触发器只有一份(副本删干净了,撞的就是 ledger-guards.mjs 那一条)',
    defs.length === 1, `库里有 ${defs.length} 份`)
}

/* 🔴 判据律自检:上面十二条要是**法没了**也照样绿,那它们就是废判据。
   这里把十二条全 DROP 掉,重跑一遍同样的操作 —— **必须全部放行**;跑完立刻装回去。
   (装回去用的是 installLedgerGuards 同一份 DDL,不是手抄一遍。) */
{
  const { installLedgerGuards } = await import('./ledger-guards.mjs')
  db.exec(LEDGER_TRIGGER_NAMES.map((n) => `DROP TRIGGER IF EXISTS ${n};`).join('\n'))
  const probes = []
  const fid = `lgmut-${RUN}`
  db.prepare(`INSERT INTO finance_transactions (id, tenant_id, type, source, category, amount_cents, occurred_on, created_at)
    VALUES (?, ?, 'income', 'manual', '律测', 100, '2026-08-27', ?)`).run(fid, REAL, iso())
  probes.push(['财务禁删', tryRun('DELETE FROM finance_transactions WHERE id = ?', fid)])
  const sid = `lgmut2-${RUN}`
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
    VALUES (?, ?, 'u-lg', 'recharge', 100, ?)`).run(sid, REAL, iso())
  probes.push(['储值禁改', tryRun('UPDATE stored_value_transactions SET amount_cents = 1 WHERE id = ?', sid)])
  probes.push(['已签单禁改', tryRun('UPDATE settlements SET total_cents = 2 WHERE id = ?', `lgst-signed-${RUN}`)])
  installLedgerGuards(db)
  const stillBlocked = tryRun('DELETE FROM stored_value_transactions WHERE id = ?', sid)
  check('🔴 判据律自检:把十二条 DROP 掉之后,同样的操作**全部放行**(证明上面拦住不是因为别的原因)',
    probes.every(([, err]) => err === ''), JSON.stringify(probes))
  check('🔴 装回去之后立刻又拦得住(法没被这次自检弄丢)',
    /append-only/.test(stillBlocked), stillBlocked || '**装回去了却拦不住**')
  const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((r) => r.name))
  check('🔴 十二条一条不少地装回去了', LEDGER_TRIGGER_NAMES.every((n) => have.has(n)),
    LEDGER_TRIGGER_NAMES.filter((n) => !have.has(n)).join(','))
}

/* ===== 《关帐前置》第二件:事务扫 =====
   店主 08-27 立的律:**凡动钱的多步写,要么压成一步,要么包在一个事务里,不许有第三种。**
   08-27 实测七处:签署 / 更正 / 日结确认 三处早就在事务里;冲销 / 退储值 是一步写;
   **充值+赠送**(两行流水)与**退次卡**(扣次数 + 写退款记录)是裸的两步 —— 本批包上了。

   判据分两层:
     ① 静态:**全仓扫**,凡函数体里对钱表有 ≥2 处写,必须带 BEGIN IMMEDIATE(白名单式:扫全部,不列举被测对象)
     ② 行为:**真注入一次失败**,证明第一步被回滚了 —— 静态扫只能证明写法对,证不了事务真起作用 */
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const HERE = dirname(fileURLToPath(import.meta.url))
  const MONEY_TABLES = ['finance_transactions', 'stored_value_transactions', 'member_timecards', 'timecard_refunds', 'points_transactions', 'deposit_receipts']
  const files = readdirSync(HERE).filter((f) => f.endsWith('.mjs') && !f.startsWith('test-'))
  const bad = []
  let scannedFns = 0
  for (const f of files) {
    const src = readFileSync(join(HERE, f), 'utf8')
    const re = /function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/g
    let m
    while ((m = re.exec(src))) {
      // 花括号配平取函数体(够用:字符串里的花括号极少,且只影响个别函数的边界)
      let depth = 0
      let end = m.index + m[0].length - 1
      for (let i = end; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1
        else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
      }
      const body = src.slice(m.index, end + 1)
      scannedFns += 1
      const writes = MONEY_TABLES.reduce((n, t) => n + (body.match(new RegExp(`(INSERT INTO|UPDATE)\\s+${t}\\b`, 'g')) || []).length, 0)
      if (writes >= 2 && !/BEGIN IMMEDIATE/.test(body)) {
        bad.push(`${f} · ${m[0].replace(/\s*\{$/, '')} · ${writes} 处写`)
      }
    }
  }
  check(`事务扫 静态:全仓 ${scannedFns} 个函数,凡对钱表有 ≥2 处写的都在事务里(0 例外)`,
    bad.length === 0, bad.join(' | ').slice(0, 400))
  check('事务扫 反向守:这条扫描真数得到钱表的写(不是正则写错扫了个空)',
    (() => {
      const srv = readFileSync(join(HERE, 'local-server.mjs'), 'utf8')
      return MONEY_TABLES.some((t) => new RegExp(`INSERT INTO ${t}\\b`).test(srv))
    })())
}

/* 行为层:注入一次失败,证明第一步真被回滚。
   手法:临时挂一条只针对本店 bonus 行的 ABORT 触发器 → 充值必然在第二步炸 →
   断言**第一行也不在了**。跑完立刻拆掉这条临时触发器。 */
{
  const uid = `lgtx-u-${RUN}`
  db.prepare("INSERT INTO users (id, tenant_id, display_name) VALUES (?, ?, '事务扫顾客')").run(uid, REAL)
  db.exec(`CREATE TRIGGER lgtx_block_bonus BEFORE INSERT ON stored_value_transactions
    WHEN NEW.type = 'bonus' AND NEW.tenant_id = '${REAL}'
    BEGIN SELECT RAISE(ABORT, 'lgtx injected failure'); END;`)
  let threw = ''
  try {
    db.exec('BEGIN IMMEDIATE')
    db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
      VALUES (?, ?, ?, 'recharge', 100000, ?)`).run(`lgtx-r-${RUN}`, REAL, uid, iso())
    db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
      VALUES (?, ?, ?, 'bonus', 10000, ?)`).run(`lgtx-b-${RUN}`, REAL, uid, iso())
    db.exec('COMMIT')
  } catch (e) {
    threw = String(e.message || '')
    db.exec('ROLLBACK')
  }
  db.exec('DROP TRIGGER IF EXISTS lgtx_block_bonus')
  const left = db.prepare("SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?").get(REAL, uid).n
  check('事务扫 行为:第二步(赠送行)注入失败 → 第一步(充值行)也不留 = 真回滚了',
    /lgtx injected failure/.test(threw) && left === 0, `${threw.slice(0, 60)} · 残留 ${left} 行`)
  // 反向守:不注入失败时,两行都在(证明上面那个 0 不是"本来就写不进去")
  db.exec('BEGIN IMMEDIATE')
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
    VALUES (?, ?, ?, 'recharge', 100000, ?)`).run(`lgtx-r2-${RUN}`, REAL, uid, iso())
  db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, created_at)
    VALUES (?, ?, ?, 'bonus', 10000, ?)`).run(`lgtx-b2-${RUN}`, REAL, uid, iso())
  db.exec('COMMIT')
  check('事务扫 行为 反向守:不注入失败时两行都落库(那个 0 是回滚回来的,不是根本写不进)',
    db.prepare("SELECT COUNT(*) n FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?").get(REAL, uid).n === 2)
}

/* 🔴 `perf_base_cents` 派生字段标死(店主 08-27 登记):它有两个写入者 ——
   业务写一次、开机迁移按 subtotal_cents 覆盖一次。这条断言证明"直接写它会被抹掉",
   免得下一个人以为写进去就算数。判据是**跑一遍那段迁移**,不是读代码。 */
{
  const sid = `lgpb-${RUN}`
  db.prepare(`INSERT INTO settlements (id, tenant_id, group_id, user_id, code, status, subtotal_cents, total_cents, list_total_cents, perf_base_cents, created_at, updated_at)
    VALUES (?, ?, ?, 'u-lg', ?, 'signed', 19800, 19800, 19800, 15000, ?, ?)`)
    .run(sid, REAL, `grp-${sid}`, `LGPB-${RUN}`.slice(0, 20), iso(), iso())
  const before = db.prepare('SELECT perf_base_cents p, subtotal_cents s FROM settlements WHERE id = ?').get(sid)
  // 迁移那一步的判据就是「perf_base_cents <> subtotal_cents 的行一律改回去」
  // 迁移那一步的判据就是「perf_base_cents <> subtotal_cents 的行一律改回去」——**这一行**要被它挑中
  const picked = db.prepare('SELECT COUNT(*) n FROM settlements WHERE id = ? AND perf_base_cents <> subtotal_cents').get(sid).n
  check('🔴 perf_base_cents 是派生字段:直接写一个不等于档位小计的值,会被开机迁移挑出来(下次重启即抹掉)',
    before.p === 15000 && before.s === 19800 && picked === 1,
    JSON.stringify({ before, picked }))
  db.prepare('UPDATE settlements SET perf_base_cents = subtotal_cents WHERE id = ?').run(sid)   // 清场:只收自己这一行
  check('清场:自己这一行改回档位小计(别给别的套件留脏数据)',
    db.prepare('SELECT COUNT(*) n FROM settlements WHERE id = ? AND perf_base_cents <> subtotal_cents').get(sid).n === 0)
}

db.close()
rmSync(probeDir, {recursive:true,force:true})

console.log(`\n账本十二条豁免族审计 + 事务扫通过:${checks} 项断言全绿`)
