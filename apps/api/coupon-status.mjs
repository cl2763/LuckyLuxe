/* 券的状态:**产品认识哪几个**(夜12 段B,2026-09-14)
 *
 * ══ 案由 ══
 * 07r 的停下来条件第一次跑就咬到真东西:`coupon_grants.status` 里有 **`unused`**,
 * 而 **`unused` 在产品代码里一处都没有** —— 全仓唯一出现的地方是那条停线正则本身。
 * 更要紧的是 **`/my/coupons` 不筛状态、原样下发** ⇒
 * **顾客手机上看得见一张后端不认识的券。点了会怎样?没人知道,因为没有代码处理它。**
 *
 * 生产现测(2026-09-14,库 /app/apps/api/local-data/lucky-luxe.sqlite):
 *   `unused` **10 张** · `used` 5 · `active` 4 · `expired` 1
 *   —— **不认识的那种比认识的「还能用」那种还多。**
 *
 * 归族:J-62 家族的又一种 —— **界面显示了一个后端不认识的东西**。
 *
 * ══ 治法 ══
 * **下发前按白名单筛**:只下发产品认识的状态。
 * 不认识的**不许原样透出** —— 它既不能让顾客当成能用的券,也不能装作不存在地混在列表里。
 * 这里选择**不下发**(而不是降级显示):顾客看不到,总比看到一张点了没人知道会怎样的券好。
 * **同时在服务端日志里点名**,这样它不会因为「看不见」而被忘掉。
 */

/** 产品真正处理过的四个状态 —— 每一个都在 `local-server.mjs` 里有读或写 */
export const KNOWN_COUPON_STATUSES = Object.freeze({
  active: '还能用(发出去还没核销、没过期)',
  used: '已核销',
  expired: '已过期(到期扫描会把 active 改成它)',
  revoked: '已作废(商家撤回)',
})

export function isKnownCouponStatus(s) {
  return Object.prototype.hasOwnProperty.call(KNOWN_COUPON_STATUSES, String(s || ''))
}

/**
 * 下发给顾客前的白名单筛。
 * @returns {{ rows: any[], dropped: Array<{id: string, status: string}> }}
 */
export function filterCouponsForCustomer(rows) {
  const kept = []
  const dropped = []
  for (const r of rows || []) {
    if (isKnownCouponStatus(r.status)) kept.push(r)
    else dropped.push({ id: r.id, status: r.status })
  }
  if (dropped.length) {
    /* 不静默:看不见 ≠ 不存在。点名到服务端日志,免得它因为「顾客看不到」而被忘掉。 */
    console.warn(`[coupon-status] 下发时挡掉 ${dropped.length} 张**产品不认识的状态**:`
      + dropped.map((d) => `${d.id}=${d.status}`).join(' / ')
      + ' —— 认识的只有:' + Object.keys(KNOWN_COUPON_STATUSES).join(' / '))
  }
  return { rows: kept, dropped }
}
