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

/* 只摘 `tenant_id` 那一列的 DEFAULT,别的列的默认值一个不碰 */
export const stripTenantDefault = (sql) => sql.replace(
  /(\btenant_id\b\s+[A-Za-z]+(?:\s+NOT\s+NULL)?)\s+DEFAULT\s+('[^']*'|"[^"]*"|[^\s,)]+)/i,
  (m, keep) => keep)

/* 重建本体 —— **调用方负责开事务**(多步写)。`failAt` 仅供造病验回滚。
   返回 { done, triggers }。 */
export function dropTenantDefaults(db, { failAt = 0 } = {}) {
  const all = (sql, ...a) => db.prepare(sql).all(...a)
  const one = (sql, ...a) => db.prepare(sql).get(...a)
  const names = tenantDefaultTargets(db).map((r) => r.t)
  if (!names.length) return { done: 0, triggers: 0 }
  const allTriggers = all("SELECT sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL").map((r) => r.sql)
  for (const r of all("SELECT name FROM sqlite_master WHERE type='trigger'")) db.exec(`DROP TRIGGER IF EXISTS "${r.name}"`)
  let done = 0
  for (const t of names) {
    done += 1
    if (failAt && done === failAt) throw new Error(`造病:在第 ${done} 张表(${t})处故意抛错`)
    const createSql = one("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?", t).sql
    const stripped = stripTenantDefault(createSql)
    if (stripped === createSql) throw new Error(`${t}:没能从建表语句里摘掉 DEFAULT,拒绝继续(宁可整批回滚,不留半张)`)
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
  return { done, triggers: allTriggers.length }
}
