/* 去掉 `tenant_id` 列默认值 —— **核心唯一出口**(D126/D131 族,店主 04f §一.2)

   ══ 为什么要去 ══
   「有默认值,打错了不报错」—— D127 跨租户单、D128 users 漏写、D130 身份表串味、D131 那 9 处,
   同一根子。刀现在守着「不许再有人忘写」,但**列定义还在**:刀的扫描面之外(动态 SQL、
   将来新写的模块)照样能静默塞进旗舰店。去掉之后漏写当场 `NOT NULL constraint failed`。

   ══ 怎么去(SQLite 没有 DROP DEFAULT)══
   只能重建表:新表建 → 复制 → 删旧 → 改名 → 重建索引,全程**一个事务**。
   🔴 彩排第一跑撞出来的坑:`DROP TABLE bookings` 会报
   `error in trigger payments_tenant_fill: no such table: main.bookings` ——
   **别的表上的触发器引用了正在被重建的表**。所以不是「只摘这张表的触发器」,
   得**把全库触发器先摘下来,重建完再原样装回去**(账本那 12 条也在内)。

   ══ 两个调用方,同一个出口 ══
   · 开机迁移(`local-server.mjs`)—— 老库跟着部署自动去掉,新库建表语句里本来就没有;
   · `tools/drop-tenant-default.mjs` —— 彩排、应急手跑,带 requireTarget / dry-run / 备份 / 四栏对照。 */

export function tenantDefaultTargets(db) {
  return db.prepare(`SELECT m.name AS t, p.dflt_value AS dv FROM sqlite_master m
    JOIN pragma_table_info(m.name) p
    WHERE m.type = 'table' AND p.name = 'tenant_id' AND p.dflt_value IS NOT NULL ORDER BY 1`).all()
}

/* 四栏快照:行 / 列 / 索引 / 触发器 —— 重建表最容易丢的就是后两栏 */
export function snapshot4(db, names) {
  const one = (sql, ...a) => db.prepare(sql).get(...a)
  return Object.fromEntries(names.map((t) => [t, {
    rows: one(`SELECT COUNT(*) AS n FROM "${t}"`).n,
    cols: one('SELECT COUNT(*) AS n FROM pragma_table_info(?)', t).n,
    idx: one("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name = ?", t).n,
    trg: one("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name = ?", t).n,
  }]))
}

/* 🔴 重建型迁移**必先备份**(店主 04g §二 立刀)
   案由:04f-2 的开机迁移把 31 张表重建了,**没有留下任何备份文件** ——
   本机库最近一份备份是当天下午的 `pre-d130`,而重建发生在晚上八点五十。
   事务回滚只保得住「迁移失败」,**保不住「迁移成功但迁错了」**。
   所以凡 DROP/CREATE 重建表的迁移,**开机路径也要先复制库文件**;
   没有要处置的表时不备份(空操作不留垃圾)。 */
/* 🔴 09n 件 A:这里原来是 `copyFileSync(dbPath, to)` —— **cp,而库是 WAL**。
   它跑在开机重建之前,是那次重建**唯一的安全网**,而这张网拷出来的可能是半个库。
   更难看的是:`tools/db-backup.mjs` 的注释里早就写着「**全仓凡备份一次库文件都该调它,
   不许再 copyFileSync**」—— **正确出口一直在,而开机链走的是另一条。**
   (一件事两处真相,又一案。)
   现在转指唯一实现 `./db-backup-core.mjs`(`VACUUM INTO` + 当场打开验一次)。 */
export { backupBeforeRebuild } from './db-backup-core.mjs'


/* 只摘 `tenant_id` 那一列的 DEFAULT,别的列的默认值一个不碰 */
export const stripTenantDefault = (sql) => sql.replace(
  /(\btenant_id\b\s+[A-Za-z]+(?:\s+NOT\s+NULL)?)\s+DEFAULT\s+('[^']*'|"[^"]*"|[^\s,)]+)/i,
  (m, keep) => keep)

/* 🔴 04g:`finance_targets.tenant_id` 原来是**可空**列且没有落值触发器。
   店主 04g 裁:**不补触发器,改成 NOT NULL** —— 补触发器就是再造一个「打错了不报错」。
   现测三库 NULL 行 0、两处 INSERT 都显式写,所以直接收紧,走同一个重建出口。 */
export function tenantNullableTargets(db) {
  return db.prepare(`SELECT m.name AS t FROM sqlite_master m JOIN pragma_table_info(m.name) p
    WHERE m.type='table' AND m.name = 'finance_targets' AND p.name='tenant_id' AND p."notnull" = 0`).all()
}

/* 重建本体 —— **调用方负责开事务**(多步写)。`failAt` 仅供造病验回滚。
   返回 { done, triggers }。 */
export function dropTenantDefaults(db, { failAt = 0 } = {}) {
  const all = (sql, ...a) => db.prepare(sql).all(...a)
  const one = (sql, ...a) => db.prepare(sql).get(...a)
  /* 两件事同一个出口:去默认值 + 把 finance_targets 的可空租户列收紧成 NOT NULL */
  const tighten = new Set(tenantNullableTargets(db).map((r) => r.t))
  const names = [...new Set([...tenantDefaultTargets(db).map((r) => r.t), ...tighten])]
  if (!names.length) return { done: 0, triggers: 0 }
  /* 🔴 09n 件 C-5(店主问:「触发器 9 条原样装回 —— 装回之后逐条比过名字了吗?」)
   * 老实答:**原来只数了条数,没比名字。** 而**条数对不等于名字对** ——
   * 重建那一段里任何一处把触发器 SQL 改了名(或漏装一条、多装一条),条数照样能对上。
   * 归族:「数量凑巧对上」那一类假绿。
   * 现在:摘之前记下**名字集合**,装回之后逐名比;对不上**直接抛** ——
   * 这一段包在 `BEGIN IMMEDIATE` 里,抛出去就整批回滚,老库原样保留。 */
  const allTriggers = all("SELECT sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL").map((r) => r.sql)
  const beforeNames = all("SELECT name FROM sqlite_master WHERE type='trigger'").map((r) => r.name).sort()
  for (const n of beforeNames) db.exec(`DROP TRIGGER IF EXISTS "${n}"`)
  let done = 0
  for (const t of names) {
    done += 1
    if (failAt && done === failAt) throw new Error(`造病:在第 ${done} 张表(${t})处故意抛错`)
    const createSql = one("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?", t).sql
    let stripped = stripTenantDefault(createSql)
    if (tighten.has(t)) {
      /* 收紧成 NOT NULL:只动 `tenant_id` 那一列,且必须真的改到,改不到就整批回滚 */
      const tightened = stripped.replace(/(\btenant_id\b\s+[A-Za-z]+)(?!\s+NOT\s+NULL)/i, '$1 NOT NULL')
      if (tightened === stripped) throw new Error(`${t}:没能把 tenant_id 收紧成 NOT NULL,拒绝继续`)
      stripped = tightened
    } else if (stripped === createSql) {
      throw new Error(`${t}:没能从建表语句里摘掉 DEFAULT,拒绝继续(宁可整批回滚,不留半张)`)
    }
    const cols = all('SELECT name FROM pragma_table_info(?)', t).map((c) => `"${c.name}"`).join(', ')
    const idxSql = all("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL", t).map((r) => r.sql)
    const tmp = `${t}__dropdef_tmp`
    db.exec(stripped.replace(new RegExp(`(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)(?:"${t}"|${t})`, 'i'), `$1"${tmp}"`))
    db.exec(`INSERT INTO "${tmp}" (${cols}) SELECT ${cols} FROM "${t}"`)
    db.exec(`DROP TABLE "${t}"`)
    db.exec(`ALTER TABLE "${tmp}" RENAME TO "${t}"`)
    for (const sql of idxSql) db.exec(sql)
  }
  for (const sql of allTriggers) db.exec(sql)
  /* 🔴 逐名比,不比条数 */
  const afterNames = all("SELECT name FROM sqlite_master WHERE type='trigger'").map((r) => r.name).sort()
  const missing = beforeNames.filter((n) => !afterNames.includes(n))
  const extra = afterNames.filter((n) => !beforeNames.includes(n))
  if (missing.length || extra.length) {
    throw new Error(`触发器装回之后逐名对不上,拒绝提交(整批回滚):少了 [${missing.join(', ')}] · 多了 [${extra.join(', ')}]`)
  }
  return { done, triggers: allTriggers.length, triggerNamesMatched: beforeNames.length }
}
