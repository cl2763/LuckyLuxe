/* 旧口径演示档案退役(一次性迁移)——从 local-server.mjs 搬出,2026-08-25。

   店主 2026-08-12 拍板:旧口径时代的演示档案全部退役(**打标记不删** ——
   历史单据织在日结与收入历史里,账本只追加)。
   D73 同族(08-25 顺手件):原来这段挂在**每次启动**、按 `display_name LIKE '%演示%'` 重扫全表 ——
   靠名字认身份 + 挂启动路径,08-12 就误伤过一次刚建的演示2 阵容。现在改一次性 + 生产不跑。 */
export function retireLegacyDemoArchives({ db, iso, isProduction = false }) {
  /* 🔴 D73 同族(店主 08-25 顺手件):这段原来**每次启动**都按 `display_name LIKE '%演示%'` 重扫全表 ——
     与 D73 那条同病、低一级:靠名字认身份,而且挂在启动路径上(名字里带"演示"的真顾客会被误圈,
     08-12 就已经误伤过一次演示2 阵容)。照 D73 的办法改成**一次性迁移**:跑过记一笔,以后不再扫。
     生产同样不跑(生产库里的档案标记只能人工处置)。 */
  const DEMO_RETIRE_KEY = 'demo_retire_backfill_v1'
  const demoRetireDone = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = '__system__' AND key = ?").get(DEMO_RETIRE_KEY)
  if (!demoRetireDone && !isProduction) try {
    const RETIRE_TAG = '退役·旧口径演示档案'
    // 「名含演示」不得误伤换代后的新阵容(演示2- 前缀)——2026-08-12 当场抓获:
    // watch 重载重跑迁移,把刚建的 lucky 演示2 八户全打了退役标,demoLogin 又落回真实档案
    const targets = db.prepare(`SELECT id, tenant_id, tags_json FROM users
      WHERE tenant_id IN ('lucky-luxe', 'jics-nail')
        AND display_name NOT LIKE '演示2-%'
        AND (id LIKE 'demo-%' OR display_name LIKE '%演示%' OR display_name = '店主验签')`).all()
    // 解错标(幂等):此前被误圈的演示2 档案摘掉退役标
    const mislabeled = db.prepare(`SELECT id, tags_json FROM users
      WHERE display_name LIKE '演示2-%' AND tags_json LIKE '%退役·旧口径演示档案%'`).all()
    for (const u of mislabeled) {
      let tags = []
      try { tags = JSON.parse(u.tags_json || '[]') } catch { tags = [] }
      db.prepare('UPDATE users SET tags_json = ? WHERE id = ?').run(JSON.stringify(tags.filter((t) => t !== '退役·旧口径演示档案')), u.id)
      console.log(`[demo-retire] 解错标:${u.id}`)
    }
    for (const u of targets) {
      let tags = []
      try { tags = JSON.parse(u.tags_json || '[]') } catch { tags = [] }
      if (!tags.includes(RETIRE_TAG)) {
        tags.push(RETIRE_TAG)
        db.prepare('UPDATE users SET tags_json = ? WHERE id = ?').run(JSON.stringify(tags.slice(0, 12)), u.id)
        console.log(`[demo-retire] ${u.tenant_id}/${u.id} 已退役标记`)
      }
    }
    db.prepare("INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES ('__system__', ?, ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(DEMO_RETIRE_KEY, iso(new Date()), iso(new Date()))
  } catch (e) { console.error('演示退役标记失败(不阻塞启动):', e.message) }

  return true
}
