/* 🔴 D137 落值触发器 + NULL 报数(店主 04g §一 裁,2026-09-03 落)
   —— 从 `local-server.mjs` 搬出(《棘轮律》+ 公约②:动了这个域就把它带走)。

   ══ 病 ══
   七条 `_tenant_fill` 触发器的兜底是 `COALESCE(…, 'lucky-luxe')`:**父表找不到就静默算旗舰店的**;
   开机还有一段「NULL 的一律归旗舰店」。与 D126(列默认值)/ D130(身份表)/ D131(31 张表)
   **是同一个根子换了身衣服** —— 有默认值,打错了不报错。
   而 04f-2 新立的「可空租户列必须有落值触发器」只问**有没有**、没问**兜的是什么**,把它当合规放过了。

   ══ 修法 ══
   解得出就填;解不出 → `RAISE(ABORT, 'TENANT_UNRESOLVED')`,**整行不落**;
   开机回填改成**只报数不改值**,数摆在 `/health.tenantNullRows` 上由人处置。
   ⚠️ 触发器这一层在**外键关掉时也守得住** —— 迁移正是 `PRAGMA foreign_keys=OFF` 跑的。 */
export function installTenantFillTriggers(db) {
  /* 🔴 D137(店主 04g §一):这里原来是**每次开机把 NULL 的一律改成旗舰店** ——
     「保证零 NULL」听着像纪律,实际是 D126/D130/D131 同一个根子换了身衣服:
     **有默认值,打错了不报错**。父表被删/指错的那一行,下次开机就悄悄算成旗舰店的。
     改成**只报数不改值**:有 NULL 就大声说出来 + 计数进 `/health.tenantNullRows`,由人处置。 */
  const TENANT_FILL_TABLES = ['payments', 'booking_slots', 'booking_status_history',
    'technician_schedules', 'business_hours', 'store_special_dates', 'booking_drafts']
  const tenantNullRows = {}
  for (const t of TENANT_FILL_TABLES) {
    try {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id IS NULL`).get().n
      if (n) tenantNullRows[t] = n
    } catch { /* 表还没建出来 */ }
  }
  if (Object.keys(tenantNullRows).length) {
    console.warn('[D137] 有行的 tenant_id 是 NULL,**不自动归旗舰店**,请人工处置:'
      + Object.entries(tenantNullRows).map(([t, n]) => `${t}=${n}`).join(' · '))
  }
  // 新写入自动带租户:AFTER INSERT 从父表回填(每次启动重建,保证与代码同版本)
  db.exec(`
    DROP TRIGGER IF EXISTS payments_tenant_fill;
    DROP TRIGGER IF EXISTS booking_slots_tenant_fill;
    DROP TRIGGER IF EXISTS booking_status_history_tenant_fill;
    DROP TRIGGER IF EXISTS technician_schedules_tenant_fill;
    DROP TRIGGER IF EXISTS business_hours_tenant_fill;
    DROP TRIGGER IF EXISTS store_special_dates_tenant_fill;
    DROP TRIGGER IF EXISTS booking_drafts_tenant_fill;

    CREATE TRIGGER payments_tenant_fill AFTER INSERT ON payments WHEN NEW.tenant_id IS NULL
    BEGIN
      SELECT CASE WHEN (SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id) IS NULL
        THEN RAISE(ABORT, 'TENANT_UNRESOLVED: payments 解不出所属门店,拒绝落行') END;
      UPDATE payments SET tenant_id = (SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id) WHERE rowid = NEW.rowid;
    END;

    CREATE TRIGGER booking_slots_tenant_fill AFTER INSERT ON booking_slots WHEN NEW.tenant_id IS NULL
    BEGIN
      SELECT CASE WHEN (SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id) IS NULL
        THEN RAISE(ABORT, 'TENANT_UNRESOLVED: booking_slots 解不出所属门店,拒绝落行') END;
      UPDATE booking_slots SET tenant_id = (SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id) WHERE rowid = NEW.rowid;
    END;

    CREATE TRIGGER booking_status_history_tenant_fill AFTER INSERT ON booking_status_history WHEN NEW.tenant_id IS NULL
    BEGIN
      SELECT CASE WHEN (SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id) IS NULL
        THEN RAISE(ABORT, 'TENANT_UNRESOLVED: booking_status_history 解不出所属门店,拒绝落行') END;
      UPDATE booking_status_history SET tenant_id = (SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id) WHERE rowid = NEW.rowid;
    END;

    CREATE TRIGGER technician_schedules_tenant_fill AFTER INSERT ON technician_schedules WHEN NEW.tenant_id IS NULL
    BEGIN
      SELECT CASE WHEN (SELECT t.tenant_id FROM technicians t WHERE t.id = NEW.technician_id) IS NULL
        THEN RAISE(ABORT, 'TENANT_UNRESOLVED: technician_schedules 解不出所属门店,拒绝落行') END;
      UPDATE technician_schedules SET tenant_id = (SELECT t.tenant_id FROM technicians t WHERE t.id = NEW.technician_id) WHERE technician_id = NEW.technician_id AND date = NEW.date;
    END;

    CREATE TRIGGER business_hours_tenant_fill AFTER INSERT ON business_hours WHEN NEW.tenant_id IS NULL
    BEGIN
      SELECT CASE WHEN (SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id) IS NULL
        THEN RAISE(ABORT, 'TENANT_UNRESOLVED: business_hours 解不出所属门店,拒绝落行') END;
      UPDATE business_hours SET tenant_id = (SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id) WHERE store_id = NEW.store_id AND weekday = NEW.weekday;
    END;

    CREATE TRIGGER store_special_dates_tenant_fill AFTER INSERT ON store_special_dates WHEN NEW.tenant_id IS NULL
    BEGIN
      SELECT CASE WHEN (SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id) IS NULL
        THEN RAISE(ABORT, 'TENANT_UNRESOLVED: store_special_dates 解不出所属门店,拒绝落行') END;
      UPDATE store_special_dates SET tenant_id = (SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id) WHERE store_id = NEW.store_id AND date = NEW.date;
    END;

    CREATE TRIGGER booking_drafts_tenant_fill AFTER INSERT ON booking_drafts WHEN NEW.tenant_id IS NULL
    BEGIN
      SELECT CASE WHEN (SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id) IS NULL
        THEN RAISE(ABORT, 'TENANT_UNRESOLVED: booking_drafts 解不出所属门店,拒绝落行') END;
      UPDATE booking_drafts SET tenant_id = (SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id) WHERE rowid = NEW.rowid;
    END;
  `)
  return tenantNullRows
}
