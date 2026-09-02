/* 演示数据标记 · 唯一出口(D121,店主 03b 裁定三入册 / 03t §二第 1 条实做,2026-09-03)

   ══ 病 ══
   `bookings` / `settlements` 上**没有演示标记**,演示数据与真实数据在同一张表里**认不出来**。
   02x 误跑演示夹具那次我能定位到 13 条预约 / 4 张结算,靠的是 `created_at` 时间戳 ——
   **那是运气,不是设计**:换个场景(误跑发生在几天前才发现)这条线就断了。

   ══ 为什么不复用 `source_channel` ══
   它回答的是「**从哪个渠道来**」(owner_direct / miniapp / wechat_miniprogram),
   而「是不是演示」是**正交**的另一个问题 —— 一条 `owner_direct` 的单既可能是真单也可能是造景造的
   (02x 那 13 条写的就是 `owner_direct`)。
   归族「**一个字段只许回答一个问题**」:硬塞进去,以后两个问题都答不准。所以单开一列。

   ══ 标记怎么盖 ══
   造景脚本**多数走 HTTP 正门**(13 个里 9 个),这是对的 —— 它证明链路真通。
   所以标记由**后端在正门上盖**,不指望每个脚本自己写库:
   请求带 `x-demo-seed: <批次名>` → 这一批写出来的行都盖上这个批次名。

   **fail-closed 朝真实数据那一侧**:没有这个头 = `NULL` = 真实数据。
   宁可把演示数据当真的(顶多多算一点),不许把真数据当演示的(那会被清掉)。

   ══ 即时单那条路(现测才发现的一条漏)══
   造景**最常走的不是建单口**,而是 `/admin/settlements` **即时开单** ——
   它在单据内部自建一条预约(`source_channel='settlement_instant'`)。
   现测:第一版只在两个建单口盖章,造景跑完 `bookings` 带标记 **0 条**;
   补上即时单那条之后,同一批造景 **97 预约 / 97 结算全部盖上**。
   所以这一处必须单独盖章 —— 漏了它,结算单的继承就继承到一个没标记的预约上,整批照样认不出来。
   (`createSettlementGroup` 拿不到 `req`,所以路由把批次名放进 `body.__demoSeed` 传下去。)

   ══ 排在哪(首跑栽过的一处)══
   `ensureDemoMarkColumns(db)` **必须排在两张表都建完之后**。
   第一版我把它放在 16390,而 `settlements` 的 `CREATE TABLE` 在 17364 ——
   **全新库上「先 ALTER 后建表」等于没建**,回归当场报 `no such column: demo_seed`。
   老库靠 ALTER 跟上、新库靠建表之后再 ALTER,**两条路都得通**(公约⑧)。

   ══ 验收判据(挂账原文写死的)══
   「**凡造景写入的行必须可被一条查询整批认出来**」——
   不是"加了个列"就算完:`SELECT … WHERE demo_seed IS NOT NULL` 要能整批捞出来。 */

/* 批次名的形态:字母数字连字符,长度 ≤ 40。不合规当没给(fail-closed 朝真实那侧)。 */
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

/* 从请求头取批次名。返回 null = 这是真实数据。 */
export function demoSeedTag(req) {
  const raw = String(req?.headers?.['x-demo-seed'] || '').trim()
  return TAG.test(raw) ? raw : null
}

/* 建表后补列 —— **必须走 try/catch ALTER TABLE ADD COLUMN**(公约⑧):
   只写进 CREATE TABLE 等于只对全新库生效,老库(含生产)不会跟上,
   而 `test-schema-consistency` 会把「空库新建 schema」与「老库跑完迁移后的 schema」逐表逐列 diff。 */
export const DEMO_MARK_TABLES = ['bookings', 'settlements']

export function ensureDemoMarkColumns(db) {
  const added = []
  for (const t of DEMO_MARK_TABLES) {
    try {
      db.exec(`ALTER TABLE ${t} ADD COLUMN demo_seed TEXT`)
      added.push(t)
    } catch { /* 已有这一列:正常,不是错误 */ }
  }
  return added
}

/* 一条查询整批认出来 —— 判据要用的就是这一句,产品与判据共用同一句,不许各写一份 */
export const DEMO_ROWS_SQL = (table) => `SELECT * FROM ${table} WHERE demo_seed IS NOT NULL`

export function countDemoRows(db, table) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE demo_seed IS NOT NULL`).get().n } catch { return -1 }
}
