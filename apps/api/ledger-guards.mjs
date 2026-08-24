/* 账本禁删/禁改律(D72,店主 2026-08-24 裁)——**十二条触发器的唯一出口**。

   立这个模块的原因(店主机核出来的):原来七条禁删律里,**四条没有任何豁免、三条把豁免写死成
   `tenant_id NOT LIKE 'demo-%'`**。于是清理测试租户的脚本一下刀就被 ABORT 整包回滚 ——
   而 dry-run 永远发现不了,因为它根本不下 DELETE。

   两条硬规矩(店主原话):
   ① **不许「先 DROP 触发器、删完再建回来」** —— 关法再开法,中途崩一次账本锁就悄悄没了。
   ② **豁免判据从「名字」改成「数据」**:tenants.kind ∈ real | demo | test,
      只有 `kind='real'` 才受禁删/禁改律。**靠名字立的法,就是 80 个空壳能攒起来的原因。**

   唯一出口:豁免谓词只在 `guardedTenant()` 写一次,十二条触发器全部引用它,
   不许谁再抄一遍 `demo-%`(常驻断言 ㋛② 扫这件事)。 */

/* 受律保护的租户判据。**fail-closed**:tenants 里查不到这个 id(脏数据/建店半路失败)
   一律按 real 算 —— 宁可拦住一次合法清理,不许放过一次真账本的删除。 */
export function guardedTenant(col = 'OLD.tenant_id') {
  return `COALESCE((SELECT kind FROM tenants WHERE id = ${col}), 'real') = 'real'`
}

/* 十二条:七条禁删 + 五条禁改。extra = 该表自己的额外条件(比如储值的两个单向豁免),
   与 guardedTenant() 是 AND 关系 —— 豁免判据统一,业务细则各表自己带。 */
export function ledgerTriggers() {
  const G = guardedTenant()
  return [
    // ——— 禁删七条 ———
    ['finance_txn_no_delete', `CREATE TRIGGER finance_txn_no_delete BEFORE DELETE ON finance_transactions
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'finance ledger is append-only'); END`],
    ['stored_value_no_delete', `CREATE TRIGGER stored_value_no_delete BEFORE DELETE ON stored_value_transactions
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'stored value ledger is append-only'); END`],
    ['points_ledger_no_delete', `CREATE TRIGGER points_ledger_no_delete BEFORE DELETE ON points_transactions
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'points ledger is append-only'); END`],
    ['deposit_receipts_no_delete', `CREATE TRIGGER deposit_receipts_no_delete BEFORE DELETE ON deposit_receipts
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'deposit receipt is append-only; write a revoke row instead of deleting'); END`],
    ['coupon_grant_logs_no_delete', `CREATE TRIGGER coupon_grant_logs_no_delete BEFORE DELETE ON coupon_grant_logs
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'coupon grant log is append-only'); END`],
    ['coupon_grants_no_delete', `CREATE TRIGGER coupon_grants_no_delete BEFORE DELETE ON coupon_grants
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'coupon grant is append-only; revoke instead of delete'); END`],
    ['identity_merge_no_delete', `CREATE TRIGGER identity_merge_no_delete BEFORE DELETE ON identity_merge_queue
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'identity merge record is append-only'); END`],

    // ——— 禁改五条 ———
    ['finance_txn_no_update', `CREATE TRIGGER finance_txn_no_update BEFORE UPDATE ON finance_transactions
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'finance ledger is append-only'); END`],
    ['points_ledger_no_update', `CREATE TRIGGER points_ledger_no_update BEFORE UPDATE ON points_transactions
      WHEN ${G} BEGIN SELECT RAISE(ABORT, 'points ledger is append-only'); END`],
    ['deposit_receipts_amount_locked', `CREATE TRIGGER deposit_receipts_amount_locked BEFORE UPDATE ON deposit_receipts
      WHEN ${G} AND (NEW.amount_cents <> OLD.amount_cents OR NEW.kind <> OLD.kind OR NEW.booking_id <> OLD.booking_id)
      BEGIN SELECT RAISE(ABORT, 'deposit receipt amount/kind/booking is immutable; write a revoke row instead'); END`],
    /* 储值:金额/类型/时间等账目数字列永锁;仅有的两个单向豁免(空→值一次)——
       ① B3-4 顾客回执确认 customer_confirmed_at;② D59 案二日结核定 technician_id。
       这两条是**业务细则**,跟着表走;豁免判据仍统一用 guardedTenant()。 */
    ['stored_value_no_update', `CREATE TRIGGER stored_value_no_update BEFORE UPDATE ON stored_value_transactions
      WHEN ${G}
        AND NOT (
          NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id AND NEW.user_id = OLD.user_id
          AND NEW.type = OLD.type AND NEW.amount_cents = OLD.amount_cents
          AND NEW.pay_channel = OLD.pay_channel AND COALESCE(NEW.note, '') = COALESCE(OLD.note, '')
          AND COALESCE(NEW.created_by, '') = COALESCE(OLD.created_by, '')
          AND NEW.created_at = OLD.created_at
          AND COALESCE(NEW.bucket, '') = COALESCE(OLD.bucket, '')
          AND (
            (COALESCE(NEW.technician_id, '') = COALESCE(OLD.technician_id, '')
              AND OLD.customer_confirmed_at IS NULL AND NEW.customer_confirmed_at IS NOT NULL)
            OR
            (COALESCE(OLD.technician_id, '') = '' AND COALESCE(NEW.technician_id, '') <> ''
              AND COALESCE(NEW.customer_confirmed_at, '') = COALESCE(OLD.customer_confirmed_at, ''))
          )
        )
      BEGIN SELECT RAISE(ABORT, 'stored value ledger is append-only'); END`],
    /* 已签署结算单不可改:这条判据是**单据状态**不是租户,所以不带 guardedTenant()
       (演示/测试租户的已签单同样不许偷改,不然演示数据也会自相矛盾)。 */
    ['settlements_signed_no_update', `CREATE TRIGGER settlements_signed_no_update BEFORE UPDATE ON settlements
      WHEN OLD.status = 'signed' AND NEW.status = 'signed'
        AND (OLD.total_cents <> NEW.total_cents OR OLD.subtotal_cents <> NEW.subtotal_cents
          OR OLD.list_total_cents <> NEW.list_total_cents OR OLD.signature_data IS NOT NEW.signature_data
          OR (OLD.snapshot_at IS NOT NULL AND (OLD.snapshot_url IS NOT NEW.snapshot_url OR OLD.snapshot_inline IS NOT NEW.snapshot_inline)))
      BEGIN SELECT RAISE(ABORT, 'signed settlement is immutable; use settlement_amendments'); END`]
  ]
}

export const LEDGER_TRIGGER_NAMES = ledgerTriggers().map(([name]) => name)

/* 建/重建全部账本触发器。
   ⚠️ 这里**确实**会 DROP 再 CREATE —— 但这是**启动时的一次性装配**(老库升级到新判据),
   不是店主禁止的那种「为了删数据临时关掉法、删完再打开」。两者的区别:
   前者跑完 db.exec 这一句法就在,后者中间有一段"法不在"的窗口给业务代码用。 */
export function installLedgerGuards(db) {
  const sql = ledgerTriggers()
    .map(([name, ddl]) => `DROP TRIGGER IF EXISTS ${name};\n${ddl};`)
    .join('\n')
  db.exec(sql)
}

/* 🔴 D73(店主 2026-08-24 裁,D72 的复发登记):**判据搬了家,判据的输入没搬。**

   D72 把触发器的判据从「租户名字像不像 demo-」改成 tenants.kind ——
   可 kind 本身当时还是**按名字算**的,而且挂在**每次启动**跑。生产上会真出两件事:
     ① 以后开的演示店都叫 demo-* → 建店那刻 kind='demo' → 它的账本从此不受禁删禁改律,
        而演示店恰恰是准商户唯一能亲眼看到的那家;
     ② 真商户的租户 id 万一撞上 p12/r3s/dbl/nsas/authx/diag 这些头 → 启动时被**静默改成 test**,
        真账本失去保护,还直接落进清理脚本的目标集。

   修法四条(店主定):
     ① 回填改**一次性迁移**,不许挂启动路径(跑过就记账,不再每次启动扫);
     ② 建店的 demo 归属改**平台后台显式勾选**,不看 id 前缀;
     ③ **生产 scope 禁止启动期改 kind**(生产上这个函数直接不干活);
     ④ 补一条会红的断言(㋜)。

   这份前缀表只在**那一次迁移**里用过(存量 80 个空壳是按套件前缀建的,店主逐行核过),
   之后永久退役 —— 留在这里是为了让迁移可复核,不是给运行期用的。 */
const LEGACY_TEST_PREFIX = ['nsas', 'dbl', 'p2dc', 'p2sc', 'p2sal', 'p2ft', 'p12', 'p25', 'r3s', 'r2s', 'authx', 'diag', 'p0hy', 'p2fl']
const LEGACY_DEMO_IDS = ['demo-ai', 'demo-basic', 'hoptest-demo2']
const KIND_BACKFILL_KEY = 'tenant_kind_backfill_v1'

/* 一次性迁移:跑过一次就在 tenant_settings 里记一笔,以后启动不再扫。
   生产(scope='live' 且 IS_PRODUCTION)一律不跑 —— 生产库里的归属只能由平台后台显式设置。 */
export function backfillTenantKindOnce(db, { isProduction = false, markDone } = {}) {
  if (isProduction) return { skipped: 'production', demo: 0, test: 0 }
  const done = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = '__system__' AND key = ?").get(KIND_BACKFILL_KEY)
  if (done) return { skipped: 'already-done', demo: 0, test: 0 }
  const rows = db.prepare("SELECT id, kind FROM tenants WHERE COALESCE(kind, 'real') = 'real'").all()
  let demo = 0
  let test = 0
  for (const r of rows) {
    const head = String(r.id).split('-')[0]
    if (LEGACY_DEMO_IDS.includes(r.id) || String(r.id).startsWith('demo-')) {
      db.prepare("UPDATE tenants SET kind = 'demo' WHERE id = ?").run(r.id); demo += 1
    } else if (LEGACY_TEST_PREFIX.includes(head) || r.id === 'tenant-iso-b') {
      db.prepare("UPDATE tenants SET kind = 'test' WHERE id = ?").run(r.id); test += 1
    }
  }
  if (typeof markDone === 'function') markDone(KIND_BACKFILL_KEY)
  return { skipped: '', demo, test }
}

export const TENANT_KIND_BACKFILL_KEY = KIND_BACKFILL_KEY
