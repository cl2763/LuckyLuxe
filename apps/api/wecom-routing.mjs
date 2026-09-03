/* 会话归店(D132,店主 04c §二 裁定口径,2026-09-03)

   ══ 病 ══
   `wechat_conversations.id` 是 **TEXT PRIMARY KEY**,值 `wecom:<externalUserId>` —— **不带租户**。
   14 处 `WHERE id = ?` 的读写没有一处带 `tenant_id`。现测:非默认租户的顾客走完两轮报价后,
   旗舰店用**同一个 externalUserId** 进线一句,就拿回了那家店的**整份 transcript**(含对方品牌名),
   而且自己的消息被追加进了别人家的会话。

   ══ 更根上的一层(店主 04c 读码补的)══
   企微 webhook 用 `resolveTenant(req, query)` 取租户 —— 即 `x-tenant-id` 头或 `?tenantId=`,
   **企微服务器不会发这个头**;一个企业只有一条回调 URL,按 URL 参数分店走不通。
   真正能分店的是 **`open_kfid`**(每家店一个客服账号),它早就进了 `inbound.openKfid` 与
   `wechat_conversations.open_kfid` 列,**但没有 open_kfid → 租户 的映射,也没人拿它定租户**。
   「拿不到就回落默认」正是 D128/D130/D131 同一根子:**有默认值,打错了不报错**。

   ══ 口径(店主 04c §二 裁,六条)══
   ① 会话 = (租户, 渠道, 外部用户);加唯一索引;**新 id 形态 `wecom:<tenant>:<uid>`**;存量 id 不改,只补索引;
   ② 进线按 (租户, provider, external_user_id) **找**,不按 id 拼;唯一出口一个函数;
   ③ 企微租户来源 = `open_kfid → 租户` 映射(存 `tenant_settings`,key `wecom_open_kfid`);
      **映射不到 = 拒收**:200 回企微避免重试,内部记 `wecom_unrouted` 一行,**不建会话、不落默认租户**;
   ④ 顾客侧不许回落默认租户(本批先 report-only 报数);
   ⑤ 演示种子会话 id 改新形态;
   ⑥ 不改存量 id、不跨店合并、不共享记录。 */

/* 开机结构:唯一索引 + 未路由留痕表。
   ⚠️ 索引建不上(存量有跨租户重名)时**不许静默跳过**(静默失败器族)——
   返回冲突数由调用方大声打出来,并由刀守住。 */
export function ensureWecomRoutingSchema(db) {
  const conflicts = db.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT tenant_id, provider, external_user_id FROM wechat_conversations
    GROUP BY 1, 2, 3 HAVING COUNT(*) > 1)`).get().n
  let indexed = false
  if (conflicts === 0) {
    try {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_tenant_provider_ext ON wechat_conversations(tenant_id, provider, external_user_id)')
      indexed = true
    } catch { indexed = false }
  }
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS wecom_unrouted (
      id TEXT PRIMARY KEY, open_kfid TEXT, external_user_id TEXT, note TEXT, created_at TEXT NOT NULL)`)
  } catch { /* 表在就跳过 */ }
  return { conflicts, indexed }
}

export function createWecomRouting({ db, currentTenantId, iso, randomId }) {
  /* ══ 口径 ②:**唯一出口** —— 进线时按 (租户, provider, 外部用户) 找,找不到才按新形态建 ══
     存量行的 id 是老形态 `wecom:<uid>`,按这三元组照样找得到,所以**不用改存量 id**。 */
  function resolveConversationId({ externalUserId = '', provider = 'wecom_customer_service', tenantId = null } = {}) {
    const tid = tenantId || currentTenantId()
    const uid = externalUserId || 'mock-guest'
    const hit = db.prepare('SELECT id FROM wechat_conversations WHERE tenant_id = ? AND provider = ? AND external_user_id = ?')
      .get(tid, provider, uid)
    if (hit) return hit.id
    return `wecom:${tid}:${uid}`
  }

  /* 读的唯一出口:**永远带租户**。拿别店的 conversationId 来读,返回 undefined。 */
  function conversationRow(conversationId, columns = '*', tenantId = null) {
    if (!conversationId) return undefined
    return db.prepare(`SELECT ${columns} FROM wechat_conversations WHERE id = ? AND tenant_id = ?`)
      .get(conversationId, tenantId || currentTenantId())
  }

  /* ══ 口径 ③:open_kfid → 租户 ══ */
  function tenantForOpenKfid(openKfid = '') {
    if (!openKfid) return null
    const row = db.prepare("SELECT tenant_id FROM tenant_settings WHERE key = 'wecom_open_kfid' AND value = ?").get(String(openKfid))
    return row?.tenant_id || null
  }
  function setOpenKfidMapping(tenantId, openKfid) {
    const now = iso(new Date())
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'wecom_open_kfid', ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(tenantId, String(openKfid || ''), now)
  }
  /* 映射不到:留痕一行,**不建会话、不落默认租户** */
  function recordUnrouted({ openKfid = '', externalUserId = '', note = '' } = {}) {
    try {
      db.prepare('INSERT INTO wecom_unrouted (id, open_kfid, external_user_id, note, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomId('unrouted'), String(openKfid), String(externalUserId), String(note), iso(new Date()))
    } catch { /* 留痕失败不能反过来打断回调 */ }
  }

  return { resolveConversationId, conversationRow, tenantForOpenKfid, setOpenKfidMapping, recordUnrouted }
}
