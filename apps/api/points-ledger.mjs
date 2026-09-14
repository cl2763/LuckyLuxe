/* 积分域:**挣的从结算单推,花的从台账读**(夜12 段F 摘出,2026-09-14)
 *
 * ══ 这个域最要紧的一件事,写在最前面 ══
 * **积分不是存的,是算的。**
 *   · 「挣」的那部分**没有自己的账** —— 它是从**已签署的结算单**现推的(`floor(小计/100)`);
 *   · `points_transactions` 只记**兑换与调整**(负行 = 花掉,正行 = 冲正/钳位)。
 *
 * 好处:不会和结算单对不上账。
 * **代价:顾客问「我积分怎么少了」,后台答不出来** —— 因为变的是它背后那张单,不留痕。
 * 而且**任何影响结算单归属的事**(比如 D191 那种认错人)**会静默地改变她的积分**。
 * 这件已登记为上线后队列的一项(店主 07q §三),**这里只把它写在码上,免得下一个人不知道**。
 */
export function createPointsLedger({ db, apiError }) {
  /* ⚠️ LEFT JOIN:分组结算的「朋友单」没有 bookingId,内联会把它们漏出赚分行,
     累计获得就对不上累计消费(卡主口径:`st.user_id` 记的是买单人)。 */
  const pointsEarnRows = (userId, tenantId) => db.prepare(`SELECT st.id AS ref, st.signed_at AS at, st.subtotal_cents AS cents, sv.name_zh AS sname
    FROM settlements st LEFT JOIN bookings b ON b.id = st.booking_id
    LEFT JOIN services sv ON sv.id = b.service_id
    WHERE st.user_id = ? AND st.tenant_id = ? AND st.status = 'signed'`)
    .all(userId, tenantId)
    .map((r) => ({ refId: r.ref, at: r.at, points: Math.floor((r.cents || 0) / 100), title: `到店消费 · ${r.sname || '服务'}` }))

  const earnedPoints = (userId, tenantId) => pointsEarnRows(userId, tenantId).reduce((sum, r) => sum + r.points, 0)

  /* 已兑换(正数显示):台账负行绝对值合计;冲正/钳位调整是正行,不算「兑换」 */
  const redeemedPoints = (userId, tenantId) => db.prepare(
    'SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS s FROM points_transactions WHERE user_id = ? AND tenant_id = ?')
    .get(userId, tenantId).s || 0

  const pointsLedgerSum = (userId, tenantId) => db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS s FROM points_transactions WHERE user_id = ? AND tenant_id = ?').get(userId, tenantId).s

  const pointsBalance = (userId, tenantId) => {
    const earned = earnedPoints(userId, tenantId)
    const balance = earned + pointsLedgerSum(userId, tenantId)
    /* 硬守恒(店主三次补拍):余额 ≤ 累计获得(≡累计消费)。多出来=有人凭空造分,**拒绝出账**。 */
    if (balance > earned) throw apiError(500, 'POINTS_INVARIANT_VIOLATION', `积分守恒被破坏:余额 ${balance} > 累计获得 ${earned}(user=${userId})`)
    return balance
  }
  return { pointsEarnRows, earnedPoints, redeemedPoints, pointsLedgerSum, pointsBalance }
}
