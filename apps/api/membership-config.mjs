/* 会员制度域(2026-08-25 从 local-server.mjs 搬出,公约②)。

   本批(N-5 退卡口)往这儿加了一项配置:**退卡/余额清零后还算不算会员**。
   店主裁定:**每家店不一样,不锁定** —— 今天的判据是「有过充值记录」,
   退完卡那条记录还在,系统会认为他仍是会员。有的店觉得对(充过钱就是老客),
   有的店觉得不对(钱都退了还享会员价?)。这不是技术问题,是经营选择,
   所以它进配置、进入驻 SOP,不写死在代码里。 */
export function createMembershipConfig({ db, iso, currentTenantId, storedValueBalanceDetail }) {
  const MEMBER_QUALIFY_MODES = ['any_recharge', 'balance_gt_0', 'total_spend', 'manual']
  const DEFAULT_MEMBERSHIP_CONFIG = {
    tiersEnabled: false,
    memberQualify: 'any_recharge',
    qualifyValueCents: 0,
    expireDays: null,
    /* 🔴 N-5 连带条(店主 08-25 裁:**不锁定**,每家店不一样):
       退卡 / 余额清零后是否保留会员资格。
       今天的判据是「有过充值记录」——退完卡那条记录还在,系统会认为他仍是会员。
       有的店觉得对(人家充过钱,是老客),有的店觉得不对(钱都退了还享会员价?)。
       **这不是技术问题,是每家店的经营选择**,所以进配置、进入驻 SOP,不写死在代码里。
       keep = 保留(充过就永远是会员) / drop = 取消(余额归零即失去会员) */
    keepMemberAfterRefund: 'keep',
    tiers: []
  }
  const KEEP_MEMBER_MODES = ['keep', 'drop']

  function getMembershipConfig(tenantId = currentTenantId()) {
    const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'membership_config'").get(tenantId)
    let stored = {}
    if (row) {
      try { stored = JSON.parse(row.value || '{}') } catch { stored = {} }
    }
    const merged = { ...DEFAULT_MEMBERSHIP_CONFIG, ...stored }
    if (!MEMBER_QUALIFY_MODES.includes(merged.memberQualify)) merged.memberQualify = 'any_recharge'
    merged.tiersEnabled = Boolean(merged.tiersEnabled)
    merged.qualifyValueCents = Math.max(0, Math.round(Number(merged.qualifyValueCents) || 0))
    merged.expireDays = merged.expireDays === null || merged.expireDays === undefined || merged.expireDays === ''
      ? null
      : Math.max(0, Math.round(Number(merged.expireDays) || 0)) || null
    merged.tiers = Array.isArray(merged.tiers) ? merged.tiers : []
    if (!KEEP_MEMBER_MODES.includes(merged.keepMemberAfterRefund)) merged.keepMemberAfterRefund = 'keep'
    // 店主 2026-08-12 追加:不分级店「成为会员」权益文案=商家自定义(memberPerks,字符串数组);
    // 写了才展示,没写=顾客端只显示资格说明。配置界面归 S9,先把字段通道打通。
    merged.memberPerks = Array.isArray(merged.memberPerks) ? merged.memberPerks.map((x) => String(x).slice(0, 60)).slice(0, 10) : []
    // 等级未开启时不下发等级字段,避免前端/AI 误以为门店有等级体系
    if (!merged.tiersEnabled) delete merged.tiers
    return merged
  }

  function setMembershipConfig(tenantId, input = {}) {
    const current = getMembershipConfig(tenantId)
    const next = {
      tiersEnabled: input.tiersEnabled === undefined ? Boolean(current.tiersEnabled) : Boolean(input.tiersEnabled),
      memberQualify: MEMBER_QUALIFY_MODES.includes(input.memberQualify) ? input.memberQualify : current.memberQualify,
      qualifyValueCents: input.qualifyValueCents === undefined
        ? current.qualifyValueCents
        : Math.max(0, Math.round(Number(input.qualifyValueCents) || 0)),
      expireDays: input.expireDays === undefined
        ? (current.expireDays ?? null)
        : (input.expireDays === null || input.expireDays === '' ? null : Math.max(0, Math.round(Number(input.expireDays) || 0)) || null),
      keepMemberAfterRefund: KEEP_MEMBER_MODES.includes(input.keepMemberAfterRefund)
        ? input.keepMemberAfterRefund : (current.keepMemberAfterRefund || 'keep'),
      tiers: Array.isArray(input.tiers) ? input.tiers.slice(0, 20) : (current.tiers || []),
      memberPerks: Array.isArray(input.memberPerks) ? input.memberPerks.map((x) => String(x).slice(0, 60)).slice(0, 10) : (current.memberPerks || [])
    }
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'membership_config', ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(tenantId, JSON.stringify(next), iso(new Date()))
    return getMembershipConfig(tenantId)
  }

  function customerTotalSpendCents(userId, tenantId = currentTenantId(), sinceIso = null) {
    const booked = sinceIso
      ? db.prepare("SELECT COALESCE(SUM(final_due_cents), 0) AS spent FROM bookings WHERE tenant_id = ? AND user_id = ? AND status = 'COMPLETED' AND appointment_start >= ?").get(tenantId, userId, sinceIso)
      : db.prepare("SELECT COALESCE(SUM(final_due_cents), 0) AS spent FROM bookings WHERE tenant_id = ? AND user_id = ? AND status = 'COMPLETED'").get(tenantId, userId)
    const legacy = sinceIso ? 0 : (db.prepare('SELECT legacy_total_spend_cents AS c FROM users WHERE id = ?').get(userId)?.c || 0)
    return (booked?.spent || 0) + legacy
  }

  function isMemberOf(userId, tenantId = currentTenantId()) {
    if (!userId) return false
    const config = getMembershipConfig(tenantId)
    const sinceIso = config.expireDays ? iso(new Date(Date.now() - config.expireDays * 86400000)) : null
    /* 🔴 N-5:退卡后还算不算会员 —— 按本店配置,不写死。
       drop = 余额归零即失去会员(钱都退了不再享会员价);keep = 充过就永远是会员。
       只在 any_recharge 这一档需要分叉:另外三档(余额>0 / 累计消费 / 手动标)本来就自带答案。 */
    if (config.memberQualify === 'any_recharge' && config.keepMemberAfterRefund === 'drop'
      && storedValueBalanceDetail(userId, tenantId).totalCents <= 0) return false
    if (config.memberQualify === 'balance_gt_0') return storedValueBalanceDetail(userId, tenantId).totalCents > 0
    if (config.memberQualify === 'total_spend') {
      return customerTotalSpendCents(userId, tenantId, sinceIso) >= config.qualifyValueCents
    }
    if (config.memberQualify === 'manual') {
      const row = db.prepare('SELECT tags_json FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId)
      let tags = []
      try { tags = JSON.parse(row?.tags_json || '[]') } catch { tags = [] }
      return tags.some((tag) => /会员|member/i.test(String(tag)))
    }
    // any_recharge:充过值就是会员。迁移期初(migrate_opening)本质是老店的充值,同样算数。
    const sql = sinceIso
      ? "SELECT 1 AS hit FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type IN ('recharge', 'migrate_opening') AND created_at >= ? LIMIT 1"
      : "SELECT 1 AS hit FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type IN ('recharge', 'migrate_opening') LIMIT 1"
    const row = sinceIso ? db.prepare(sql).get(tenantId, userId, sinceIso) : db.prepare(sql).get(tenantId, userId)
    return Boolean(row)
  }

  return { MEMBER_QUALIFY_MODES, DEFAULT_MEMBERSHIP_CONFIG, KEEP_MEMBER_MODES, getMembershipConfig, setMembershipConfig, customerTotalSpendCents, isMemberOf }
}
