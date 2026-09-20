/* 事务回滚刀(店主 03c 立「包了事务必须验回滚」· 03t §二第 2 条实做,2026-09-03 落)

   ══ 判词 ══
   **「包了 `BEGIN…COMMIT` 不等于有了原子性。」**
   静态只能证明**写法**对,证不了事务**起作用** ——
   案底:sqlite3 CLI 遇错不 bail,写了 `BEGIN...COMMIT` 照样一句句往下走。

   ══ 清单从哪来:**不手写,现扫**(店主 03z 裁 · 04a 收窄)══
   尺子只有一份 —— `tools/guard-scan.mjs` 的 `scanWriteSites()`,
   与《写库脚本护栏三列清单》的生成器、`test-db-target-guard` 用的是**同一个函数**,不是同一段正则抄三遍。
   案由是这两批自己咬出来的三件:
   ① 手写清单说「包了事务」的九处里,`ledger-guards` 现测**根本没有事务** ——
      它用一句 `db.exec` 跑 24 条语句(12 组 DROP+CREATE),而 **`exec` 不是原子的**:
      第 7 句失败时前 6 条已经 DROP 掉,账本锁就少了六条,
      恰恰变成该模块开头警告的那个样子「中途崩一次账本锁就悄悄没了」。已包进事务(03y 批)。
   ② 反过来,手写清单**漏了三处**真有事务的(`local-server.mjs` 自己、`demo-seed`、
      `purge-smoke-conversations`)—— 说有的没有,真有的没写,**同一份手写清单两个方向都错过**。
   ③ 04a:连「现扫」也数错过 —— 把生成器自己数了进来(它源码里的 `BEGIN IMMEDIATE` 是尺子的字面量)。
      刀本身的排除面现在写在 `guard-scan.mjs` 的 `KNIVES` 里,**带理由 + 棘轮**。

   ══ 造病机制(统一的,不用给每处各编一个坏输入)══
   在**目标表**上装一条 `BEFORE INSERT … RAISE(ABORT)` 的临时触发器,
   让事务里的某一步必然失败 → 再看**这一步之前**写下去的行还在不在。
   · 事务真的起作用 → 前面的行被回滚,**零行落地**;
   · 事务是摆设 → 前面的行留在库里,刀红。
   造完当场拆掉触发器(夹具收尾:判据不收尾就变成非幂等)。

   ══ 只打沙箱 ══
   店主 03e 结构闸:账本相关的一切现测只打沙箱 4310,本机库对现测关门。
   本刀更进一步 —— **在沙箱库的一份临时副本上跑**,连沙箱本身都不碰。 */

import { readFileSync, copyFileSync, existsSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { scanWriteSites } from '../../tools/guard-scan.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ═══ ① 静态:九处逐个必须有 BEGIN / COMMIT / ROLLBACK 三件 ═══
   白名单式:清单上的每一处都要有,少一件就点名 —— 不是数「我看过的那几个有」。 */
/* 🔴 清单**不再手写**,由 `guard-scan.mjs` 的 `scanWriteSites()` 现扫 ——
   与生成清单的那把尺**是同一个函数**,不是抄一遍(抄一遍就会各自漂:03z 同一提交上清单就过期了)。 */
const SITES = scanWriteSites(ROOT).withTxn
const noTxn = SITES.filter((x) => !x.有COMMIT || !x.有ROLLBACK).map((x) => x.f)
check(`① 白名单式(**清单由同一把尺现扫,不手写**):现扫出 ${SITES.length} 处含事务的写库点,`
  + '逐个必须 BEGIN + COMMIT + ROLLBACK 三件齐 —— 少一件就点名。'
  + '手写清单当时写 9 处,现扫**比它多**(漏了 local-server 自己等三处),这就是为什么改成现扫;'
  + '处数不写死在这句话里 —— 判据不许锚在会变的字面量上',
noTxn.length === 0, `缺事务:${noTxn.join(' | ')}`)

/* ①b `ledger-guards` 那处是本批补的,单独钉住:它用 db.exec 跑 24 条语句,exec 不是原子的 */
const lg = readFileSync(join(ROOT, 'apps/api/ledger-guards.mjs'), 'utf8')
check('①b `installLedgerGuards` 的 24 条 DDL 包在事务里 —— '
  + '`db.exec` 顺序执行、**不是原子的**,第 7 句失败前 6 条已经 DROP 掉,账本锁就少了六条',
  /db\.exec\('BEGIN IMMEDIATE'\)/.test(lg) && /db\.exec\('ROLLBACK'\)/.test(lg), '')

/* ═══ ② 🔴 行为层:造中间步失败 → 零行落地 → 再跑真路径 ═══ */
/* 🔴 走 `test-need-sandbox.mjs` 的唯一出口(公约④:一件事一处真相)。
   夜15 (丙):CI 上 `SANDBOX_DATA_DIR` 指到临时目录,这里自动跟着走;
   本机不设那个变量时,取值与以前**一模一样**。
   🔴 这是 L2 第二轮才扫出来的一批 —— 第一轮我只改了两个文件,而同类共 4 个。
   **「改一处硬路径」永远是一类,不是一处**(J-78②)。 */
const { SANDBOX_DB_PATH } = await import('./test-need-sandbox.mjs')
const SB = SANDBOX_DB_PATH
if (!existsSync(SB)) {
  console.log('   ⚠️ 沙箱库不在 —— **行为层本轮未跑**(不静默跳过,如实说)')
} else {
  /* 在沙箱库的**临时副本**上跑,连沙箱本身都不碰 */
  const dir = mkdtempSync(join(tmpdir(), 'll-txn-'))
  const COPY = join(dir, 'probe.sqlite')
  copyFileSync(SB, COPY)

  /* 通用探针:两步写包在一个事务里,第二步被临时触发器打死 → 第一步必须零行落地 */
  const probe = ({ label, table1, row1, table2, row2 }) => {
    const db = new DatabaseSync(COPY)
    db.exec(`CREATE TRIGGER __abort_probe BEFORE INSERT ON ${table2} BEGIN SELECT RAISE(ABORT, 'probe'); END`)
    const before = db.prepare(`SELECT COUNT(*) AS n FROM ${table1}`).get().n
    let threw = false
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(row1.sql).run(...row1.args)          // 第一步:真写进去
      db.prepare(row2.sql).run(...row2.args)          // 第二步:被触发器打死
      db.exec('COMMIT')
    } catch { threw = true; try { db.exec('ROLLBACK') } catch { /* 已不在事务里 */ } }
    const after = db.prepare(`SELECT COUNT(*) AS n FROM ${table1}`).get().n
    db.exec('DROP TRIGGER __abort_probe')             // 夹具收尾
    /* 再跑一次**真路径**(不带触发器):同样两步必须都成功、都落地 */
    const beforeReal = db.prepare(`SELECT COUNT(*) AS n FROM ${table1}`).get().n
    let realOk = true
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(row1.sql).run(...row1.args.map((a, i) => (i === 0 ? `${a}-real` : a)))
      db.prepare(row2.sql).run(...row2.args.map((a, i) => (i === 0 ? `${a}-real` : a)))
      db.exec('COMMIT')
    } catch { realOk = false; try { db.exec('ROLLBACK') } catch { /* 同上 */ } }
    const afterReal = db.prepare(`SELECT COUNT(*) AS n FROM ${table1}`).get().n
    db.close()
    return { label, threw, before, after, rolledBack: after === before, realOk, realLanded: afterReal === beforeReal + 1 }
  }

  const now = new Date().toISOString()
  const r = probe({
    label: '两步写',
    table1: 'stored_value_transactions',
    row1: {
      sql: `INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, note, created_by, created_at)
            VALUES (?, 'lucky-luxe', 'probe-user', 'recharge', 100, '事务回滚探针', 'txn-probe', ?)`,
      args: ['sv_txnprobe_1', now],
    },
    table2: 'finance_transactions',
    row2: {
      /* 🔴 反向守替我抓出的一个错:第一版把列名写成了 `kind`(真名是 `type`),
         于是第二步**不是被我的触发器打死的,是根本插不进去**。
         那样一来 ② 会靠「插不进去」假绿 —— 反向守要求真路径必须成功,它才露了馅。
         这正是「一把怎么跑都零行的刀,跟没有刀一样」那句话的活例。 */
      sql: `INSERT INTO finance_transactions (id, tenant_id, type, source, category, amount_cents, occurred_on, note, created_at)
            VALUES (?, 'lucky-luxe', 'income', 'manual', '储值', 100, date('now'), '事务回滚探针', ?)`,
      args: ['fin_txnprobe_1', now],
    },
  })
  console.log(`   [刀] 注入=在 finance_transactions 上装 BEFORE INSERT RAISE(ABORT);`
    + ` 第二步抛错=${r.threw} · 第一步表行数 ${r.before}→${r.after}`)
  check('② 🔴 造中间步失败 → **零行落地**:第一步已经写进去的行必须被回滚 —— '
    + '「包了 BEGIN…COMMIT」是写法,「回得了滚」才是事实(sqlite3 CLI 遇错不 bail 就是反例)',
  r.threw && r.rolledBack, JSON.stringify(r))
  check('②b 反向守:拆掉注入后**真路径**必须两步都成功、都落地 —— '
    + '一把「怎么跑都零行」的刀,跟没有刀一样证明不了回滚',
  r.realOk && r.realLanded, JSON.stringify(r))

  try { unlinkSync(COPY) } catch { /* 临时副本清掉 */ }
  console.log('   [收尾] 临时副本已删,沙箱库本身一个字节没碰')
}

console.log(`\n[事务回滚] 含事务的写库点 ${SITES.length} 处(现扫,非手写)· 行为层在沙箱**副本**上造病验回滚`)
if (fails.length) { console.error(`\n❌ test-txn-rollback ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-txn-rollback 通过 ${checks} 项`)
