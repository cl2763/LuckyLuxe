/* 店名与身份(店主 02v 改名批从 local-server 搬出;公约①新功能一律新模块 + 棘轮只许降不许升)。
   搬出来的三件都属「本店叫什么」这一个领域:① 一次性改名迁移 ② 新客欢迎语措辞(店名拿不到时的空态说法)
   ③ **商家看见的是哪个名字**(D156)。 */

/* 🔴 店名改「LUVIA 半径」一次性迁移(店主 02v 定案)。三条约束缺一不可:
   ① **三行都带 tenant_id / id 限定** —— 不许改成全局默认值(店主红线三:小婕店一个字不许变);
   ② **只在现值仍是旧名时才改** —— 无条件 UPDATE 会把店主日后自助改的名字在下次重启时抹回去
      (与 perf_base_cents「派生字段两个写入者」同一个坑);
   ③ 历史签署快照/已日结账里的旧名**不碰**(红线四:新单出新名,旧单留旧名)。 */
export function runStoreRenameMigration(db) {
  try { db.exec('ALTER TABLE stores ADD COLUMN name_en TEXT') } catch (e) { if (!String(e.message).includes('duplicate column')) throw e }
  const T = 'lucky-luxe'
  db.prepare('UPDATE tenants SET name = ? WHERE id = ? AND name = ?').run('LUVIA 半径', T, 'Lucky Luxe')
  db.prepare('UPDATE stores SET name = ?, name_en = COALESCE(name_en, ?) WHERE tenant_id = ? AND name = ?')
    .run('LUVIA 半径', 'LUVIA', T, 'Lucky Luxe Ontario')
  db.prepare("UPDATE tenant_kb_facts SET value = ? WHERE tenant_id = ? AND key = 'brandName' AND value = ?")
    .run('LUVIA 半径', T, 'Lucky Luxe')
  db.prepare("UPDATE tenant_kb_facts SET value = ? WHERE tenant_id = ? AND key = 'assistantName' AND value = ?")
    .run('LUVIA 预约助手', T, 'Lucky Luxe 预约助手')
  db.prepare('UPDATE tenants SET name = ? WHERE id = ? AND name = ?').run('LUVIA 半径(演示)', 'demo-lucky-luxe', 'Lucky Luxe(演示)')
  db.prepare('UPDATE stores SET name = ? WHERE tenant_id = ? AND name = ?').run('LUVIA 半径(演示)', 'demo-lucky-luxe', 'Lucky Luxe(演示)')
  /* 02w:镜像店的英文名补上(**条件更新** —— 只在为空时补,不覆盖商家已改过的值;店主 02w 收编的那条律) */
  db.prepare("UPDATE stores SET name_en = ? WHERE tenant_id = ? AND (name_en IS NULL OR name_en = '')").run('LUVIA (Demo)', 'demo-lucky-luxe')
}

/* 新客欢迎语措辞。**店名拿不到就退成不带店名的说法**,绝不贴任何写死的名字
   (2026-08-07 那次:写死店名,别家店的新客一进来就被欢迎到旗舰店去了)。 */
export function welcomeText({ brand = '', lang = 'zh' } = {}) {
  const greetZh = brand ? `您好欢迎来到 ${brand}，` : '您好，'
  const greetEn = brand ? `Hello, welcome to ${brand}.` : 'Hello.'
  return lang === 'en'
    ? `${greetEn} I am your booking assistant. You can ask me about nail/lash services, pricing rules, available times, deposits, and aftercare. For complex nail styles, you can also send a reference photo and I will help organize the details first.`
    : `${greetZh}我是您的预约助手。您可以咨询美甲/美睫服务、价格规则、预约时间、定金和护理说明；如果是复杂美甲款式，也可以先发参考图，我会先帮您整理需求。`
}

/** 商家侧身份:**商家看见的名字 = 当前门店名**(D156,店主 2026-09-08 裁)。

    两个名字不是一回事,而且**会分叉**:
    · `storeName` = `stores.name` —— 商家在门店设置改店名(`PUT /admin/store-info`)改的就是它;
    · `tenantName` = `tenants.name` —— 商户名,建店时写下,**之后没人再动**。
    所以商家侧任何地方显示 `tenantName`,显示的都是**改名之前那个旧名字**
    (网页顶栏与小程序商家端两处以前正是如此)。12t补起平台展示也用 storeName；tenantName 仅保留为入驻记录，不再作为显示店名。

    取不到就给空串,由渲染侧出「—」——**不许回落到商户名或人名**(零回落红线)。
    `storeId` 一并给出:D84 强制设置旗标也认这家店,免得同一个「当前门店」在两处各查一次。 */
export function merchantIdentity(db, tenantId) {
  const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId)
  const store = db.prepare('SELECT id, name FROM stores WHERE tenant_id = ? AND is_active = 1 LIMIT 1').get(tenantId)
  return { tenantName: tenant?.name || '', storeName: store?.name || '', storeId: store?.id || '' }
}
