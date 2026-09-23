/* 套餐到期日口径(D217 / 12l补)—— 从 local-server.mjs 搬出来的唯一出口
 *
 * 立这个文件的由来:店主让「凡是读到期日的地方全部数一遍,每一处都得认『空 = 永久』,
 * 漏一处视为没交」。普查扫出 70 处,其中两类缺陷:
 *   🔴 **改没了**:续费基准写成 `Math.max(Date.now(), t.plan_expires_at ? … : 0)` ——
 *      NULL 被当 0,于是从今天重新起算,**永久被悄悄取消**。
 *   🔴 **看不见**:界面三处 `t.planExpiresAt ? (…) : ''` —— 永久店那格什么都不显示。
 *   两个缺陷叠在一起才致命:改没了,而且看不出来。
 *
 * 所以「是不是永久」「能不能续费」「怎么写永久」三件收进这里一个口,别处只许调。
 */

export const PERPETUAL = null          // 数据层:plan_expires_at IS NULL 就是永久

/** 这家店是不是永久 */
export const isPerpetual = (tenant) => tenant != null && tenant.plan_expires_at == null

/** 剩余天数 —— 永久返回 null(不是 0,也不是负数) */
export function daysLeftOf(tenant, now = Date.now()) {
  if (isPerpetual(tenant)) return null
  const t = new Date(tenant.plan_expires_at).getTime()
  return Number.isFinite(t) ? Math.ceil((t - now) / 86400000) : null
}

/** 界面文案唯一出口 —— 永久一律「长期」,不许别处再拼一次 */
export function expiryLabel(tenant, now = Date.now()) {
  if (isPerpetual(tenant)) return { kind: 'perpetual', text: '长期', tone: 'ok' }
  const d = daysLeftOf(tenant, now)
  if (d == null) return { kind: 'unknown', text: '—', tone: 'muted' }
  if (d <= 0) return { kind: 'expired', text: `已到期 ${-d} 天`, tone: 'off' }
  if (d <= 7) return { kind: 'expiring', text: `剩 ${d} 天`, tone: 'warn' }
  return { kind: 'active', text: String(tenant.plan_expires_at).slice(0, 10), tone: 'muted' }
}

/** 🔴 续费/顺延前必须过这道闸:永久店拒绝 */
export function assertRenewable(tenant, apiError) {
  if (isPerpetual(tenant)) {
    throw apiError(409, 'TENANT_IS_PERPETUAL', `「${tenant.name}」是永久店,先取消永久再续费。`)
  }
}

/** 🔴 写入口唯一解析:只有 perpetual === true 才写 NULL。
 *  空串 / 0 / false / undefined 一律不许写 NULL —— 「清空日期框」不等于「设永久」。
 *  返回 { sql, arg } 或 null(表示这次没要改到期日)。 */
export function parseExpiryWrite(body, apiError, toIso) {
  if (body.perpetual !== undefined) {
    if (body.perpetual !== true) throw apiError(400, 'BAD_REQUEST', '要设永久请明确勾选(perpetual 只接受 true)。')
    return { sql: 'plan_expires_at = NULL', arg: undefined }
  }
  if (body.planExpiresAt === undefined) return null
  const v = String(body.planExpiresAt ?? '').trim()
  if (!v) throw apiError(400, 'BAD_REQUEST', '要设永久请明确勾选(perpetual: true);到期日不许留空。')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw apiError(400, 'BAD_REQUEST', '到期日格式应为 YYYY-MM-DD。')
  return { sql: 'plan_expires_at = ?', arg: toIso ? toIso(v) : v }
}

/** 建店首期 → 到期日(D215)。
 *  🔴 白名单必须含 'forever',否则选「永久」会**静默回落成年付** —— 不报错、悄悄给另一个结果。
 *  永久 ⇒ 返回 null(= plan_expires_at IS NULL),与本文件其余出口同口径。 */
export const INITIAL_TERMS = ['trial30', 'month', 'year', 'forever']
/** 解析首期。🔴 **没传** 才默认年付;**传了但不认识**必须报错 ——
 *  原来写的是 `INITIAL_TERMS.includes(term) ? term : 'year'`,
 *  前端传个拼错的值会**悄悄当成年付**,建出来不是你选的那个(店主 09-24 指出)。
 *  「没传」和「传错」是两件事,不许用同一个默认值盖过去。 */
export function parseInitialTerm(term, apiError) {
  if (term === undefined || term === null || term === '') return 'year'   // 没传 ⇒ 默认年付
  const t = String(term)
  if (!INITIAL_TERMS.includes(t)) {
    throw apiError(400, 'BAD_INITIAL_TERM', `首期只能是 ${INITIAL_TERMS.join(' / ')},收到的是「${t.slice(0, 20)}」。`)
  }
  return t
}
export function expiryFromTerm(term, iso, now = new Date()) {
  const t = term
  if (!INITIAL_TERMS.includes(t)) throw new Error(`expiryFromTerm 收到未校验的值「${t}」—— 先过 parseInitialTerm`)
  if (t === 'forever') return null
  const d = new Date(now)
  if (t === 'trial30') d.setDate(d.getDate() + 30)
  else if (t === 'month') d.setMonth(d.getMonth() + 1)
  else d.setFullYear(d.getFullYear() + 1)
  return iso(d)
}
