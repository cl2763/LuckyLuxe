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
  /* 🔴 03y 现测补:`db.exec` 里 24 条语句(12 组 DROP+CREATE)**不是原子的** ——
     它们顺序执行,第 7 句失败时前 6 条已经 DROP 掉了,**账本锁就少了六条**。
     上面那句「跑完 db.exec 这一句法就在」只在不失败时成立;
     一旦中途失败,恰恰变成本模块开头警告的那个样子:「中途崩一次账本锁就悄悄没了」。
     SQLite 的 DDL 是可以进事务的,包上就是全有或全无。
     归族「动钱多步写律」的同一条理由:**多步写要么压成一步,要么包在一个事务里,没有第三种。** */
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(sql)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 已经不在事务里:忽略 */ }
    throw error
  }
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
/* 🔴 D204 销号(店主 09t §三 批:**销号 = 删码,不是关开关**,裁#107 同一精神)
 *
 * 这里原来有 `backfillTenantKindOnce` + 那张 `LEGACY_TEST_PREFIX` 前缀表。**整段删掉。**
 *
 * **它当初是为了修什么**(09t §三 要求写清,否则将来有人发现少了一步会重新写一个一模一样的):
 *   D72 给 `tenants` 加了 `kind` 列(real / demo / test)。**加列那一刻,存量 80 多家店全是 `real`** ——
 *   其中大部分是历次回归套件建出来的空壳店(id 按套件名起头:`nsas-` `p12-` `authx-` …)
 *   与两家早期演示店(`demo-ai` / `demo-basic`)。这条迁移就是**给那一批存量补上正确的 kind**,
 *   靠的是「id 前缀」——**因为当时除了 id 没有别的线索可用**。
 *
 * **为什么现在不需要了**:
 *   ① 存量已经补完 —— 本机库现测标记 `tenant_kind_backfill_v1` 已在,跑过了;
 *   ② **生产库根本不需要它** —— 09t 现查那 6 家店,`kind` 本来就是建店时显式设的;
 *   ③ **新建的店不走它** —— D73 之后建店 kind 由平台后台 `isDemo` 显式勾选决定(`local-server.mjs` 那一行),
 *      沙箱与回归临时库每次新建,也都走同一条显式路径;
 *   ④ **判法本身违反 D73**(演示店走显式勾选,不再看 id 前缀)。
 *
 * 🔴 **一句必须留在案底里的话**(09t §五 要求原样进台账):
 *   **`jics-nail`(小婕真店)与 `jics-store`(沙箱镜像)的 head 都是 `jics`。
 *     今天 `jics` 不在那张前缀表里所以不会撞 —— 但那是运气,不是设计。
 *     明天有人往前缀表里加一个 `jics` 就撞了。**
 *   这正是「按 id 前缀认身份」这类判法该被删掉、而不是被小心使用的理由。
 *
 * **删之前量过的杀伤力**(09t §五 批准的只读盘点,生产库现测):
 *   若今天让它跑,6 家店里 **2 家会被改判**(`demo-ai` / `demo-basic`,real → demo),
 *   **两家真店 `lucky-luxe` 与 `jics-nail` 不变**。三栏闭合 2 + 2 + 2 = 6 ✅ */
