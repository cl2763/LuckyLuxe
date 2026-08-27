/* 消息模板域(从 local-server.mjs 搬出,2026-08-28 D78 批「边改边拆」)。

   为什么这一刀:本批要给 local-server 加轮播图的口,而《棘轮律》说这两个巨型文件**只许降不许升**。
   公约②「边改边拆」——动哪个领域就顺手把一个领域搬出来,不专门开重构批。
   挑中它的原因:场景枚举 / 中文标签 / 预置文案 / 序列化 / 首次预置,**五件事只被那一条路由用**,
   与其它域零耦合,整块搬走风险最低。**只搬不改行为**:内容逐字原样,依赖以入参注入。

   ⚠️ 场景枚举是被 test-message-templates 当作**被测集合现取**的(判据翻面后不再手写清单),
   所以这里加一个场景,套件会自动把它纳入并要求它有预置模板。 */
export function createMessageTemplates({ db, iso, randomId }) {
  const MESSAGE_TEMPLATE_SCENES = ['pre_sale', 'in_service', 'post_sale', 'booking_confirmed_invite', 'arrival_reminder', 'coupon_expiry']
  const MESSAGE_TEMPLATE_SCENE_LABELS = {
    pre_sale: '售前',
    in_service: '售中',
    post_sale: '售后',
    booking_confirmed_invite: '预约成功邀请函',
    arrival_reminder: '到店提醒',
    coupon_expiry: '优惠券到期'
  }
  // 每店预置一套通用文案(商家可改)。变量在发送时替换,发送引擎归 P3,本批只建模+配置。
  const DEFAULT_MESSAGE_TEMPLATES = [
    { scene: 'pre_sale', title: '售前咨询开场', content: '你好呀{customerName}~ 这里是{storeName}。想做什么款式呢?可以发参考图给我,我帮你看看时长和价格~', variables: ['{customerName}', '{storeName}'] },
    { scene: 'in_service', title: '服务中关怀', content: '{customerName},今天的款式做到一半啦,有哪里不舒服或者想调整的随时说哦~', variables: ['{customerName}'] },
    { scene: 'post_sale', title: '服务后回访', content: '{customerName}今天辛苦啦!新做的款式记得 24 小时内少沾水。有任何问题随时找我~', variables: ['{customerName}'] },
    { scene: 'booking_confirmed_invite', title: '预约成功邀请函', content: '{customerName}你好,你在{storeName}的预约已确认:\n时间 {bookingTime}\n地址 {storeAddress}\n期待见到你~', variables: ['{customerName}', '{storeName}', '{bookingTime}', '{storeAddress}'] },
    { scene: 'arrival_reminder', title: '到店提醒', content: '{customerName}你好,提醒一下你在{storeName}的预约是 {bookingTime},路上注意安全~', variables: ['{customerName}', '{storeName}', '{bookingTime}'] },
    { scene: 'coupon_expiry', title: '优惠券到期提醒', content: '{customerName}你好,你有一张优惠券即将到期({couponExpiry}),记得来用哦~', variables: ['{customerName}', '{couponExpiry}'] }
  ]

  function serializeMessageTemplate(row) {
    let variables = []
    try { variables = JSON.parse(row.variables_json || '[]') } catch { variables = [] }
    return {
      id: row.id,
      scene: row.scene,
      sceneLabel: MESSAGE_TEMPLATE_SCENE_LABELS[row.scene] || row.scene,
      title: row.title,
      content: row.content || '',
      contentEn: row.content_en || '',
      variables,
      isActive: Boolean(row.is_active),
      sort: row.sort,
      updatedAt: row.updated_at
    }
  }

  // 懒预置:某租户第一次读模板列表时铺一套默认文案(只铺一次,商家改过/删过都不会被覆盖)
  function ensureDefaultMessageTemplates(tenantId) {
    const seeded = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'message_templates_seeded'").get(tenantId)
    if (seeded) return
    const now = iso(new Date())
    const stmt = db.prepare(`INSERT INTO message_templates (id, tenant_id, scene, title, content, content_en, variables_json, is_active, sort, updated_at)
      VALUES (?, ?, ?, ?, ?, '', ?, 1, ?, ?)`)
    DEFAULT_MESSAGE_TEMPLATES.forEach((tpl, index) => {
      stmt.run(randomId('tpl'), tenantId, tpl.scene, tpl.title, tpl.content, JSON.stringify(tpl.variables), index, now)
    })
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'message_templates_seeded', ?, ?)
      ON CONFLICT(tenant_id, key) DO NOTHING`).run(tenantId, JSON.stringify({ at: now }), now)
  }

  return {
    MESSAGE_TEMPLATE_SCENES,
    MESSAGE_TEMPLATE_SCENE_LABELS,
    serializeMessageTemplate,
    ensureDefaultMessageTemplates
  }
}
