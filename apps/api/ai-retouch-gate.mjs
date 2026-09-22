/* AI 修图入口三态(店主 11m §三 批,2026-09-22)
 *
 * ══ 三态是什么 ══
 *   `off`  —— 这家店看不到这个入口,**整张卡不渲染**(不是灰着,是不存在)
 *   `soon` —— 淡态卡 + 标签「敬请期待」,点击只 toast,**不跳页**
 *   `on`   —— 真入口。**流程还没做出来,所以现在谁也拨不到 on**
 *
 * 🔴 为什么 `on` 现在要 409:
 *    流程(选图 / 预设 / 对比三步)等 12a 两轮评测结果,本批只做壳。
 *    **壳上如果能拨到 on,商家点进去就是一个空页面 —— 那是假入口。**
 *    「不可用即不呈现,呈现即说明」(D108 那条律):做不到就别让人拨到那一档。
 *    等流程落地,把 `ON_READY` 翻成 true,这道 409 自动让路。
 *
 * ══ 默认值 ══
 *    🔴 **新租户建出来就是 `off`** —— 默认最严(fail-closed)。
 *    没有这一行的租户读出来也是 `off`,不是「没配置所以放行」。 */

export const AI_RETOUCH_STATES = ['off', 'soon', 'on']
export const AI_RETOUCH_DEFAULT = 'off'
/* 🔴 流程上线那天改这一个常量,别去改判据、别去改前端分支 —— 一处真相 */
export const ON_READY = false
/* ⚠️ 名字里不带 `KEY`:J-53 的密钥扫描按名字认「密钥类常量回落到固定字面量」,
   叫 SETTING_KEY 会被它当成一把密钥点名。这不是密钥,是 `tenant_settings` 里的那一行的 key 名。
   改名比往白名单里加一条便宜 —— 白名单每多一条,下一个人就多一处要自己判断的地方。 */
export const SETTING_NAME = 'ai_retouch'

export function createAiRetouchGate({ db, apiError, currentTenantId }) {
  function get(tenantId = currentTenantId()) {
    const row = db.prepare('SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?')
      .get(tenantId, SETTING_NAME)
    const v = String(row?.value || '').trim()
    /* 值不在三态里(没配 / 被人改坏)一律当 off —— 默认最严,不是「读不出来就放行」 */
    return AI_RETOUCH_STATES.includes(v) ? v : AI_RETOUCH_DEFAULT
  }

  function set(tenantId, state) {
    const v = String(state || '').trim()
    if (!AI_RETOUCH_STATES.includes(v)) {
      throw apiError(400, 'BAD_REQUEST', `AI 修图入口只有三态:${AI_RETOUCH_STATES.join(' / ')}。`)
    }
    if (v === 'on' && !ON_READY) {
      throw apiError(409, 'AI_RETOUCH_NOT_READY',
        '流程未上线:选图/预设/对比三步还没做出来,现在拨到 on 会让商家点进一个空页面。先用 soon。')
    }
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(tenantId, SETTING_NAME, v, now)
    return v
  }

  /* 下发给两端的那一份 —— 文案也在这里出,前端零拼串(顾客/商家可见句唯一出口那条律) */
  function card(tenantId = currentTenantId()) {
    const state = get(tenantId)
    if (state === 'off') return null
    return {
      state,
      label: 'AI 修图',
      // soon 态的每一个字都从后端来:改文案不用发版两端
      badge: state === 'soon' ? '敬请期待' : '',
      hint: state === 'soon' ? '正在验证画质,开放后通知你' : '',
      tappable: state === 'on',
    }
  }

  return { get, set, card, AI_RETOUCH_STATES, AI_RETOUCH_DEFAULT, ON_READY }
}
