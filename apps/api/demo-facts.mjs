/* 演示店事实口(店主 2026-08-25「乙线开锁 · 生产例外七条」配套)。

   为什么有这个模块:铺演示数据的脚本以前**直连 sqlite** 读几个事实(已签署单数 / 次卡 / 券)
   并直写 users.wechat_open_id —— 本机能这么干,生产拿不到库文件,那条路在生产上等于断的。
   于是把这几件事收成**一条服务端出口**:本机与生产走同一份代码,不再有"本机一套、生产一套"。

   🔒 两道锁,互不依赖(D75 同款):
     ① 真店黑名单(PROTECTED_REAL_TENANTS)命中即拒 —— 就算 kind 判据哪天出问题,这条照样拦死;
     ② kind 必须是 demo(isDemoTenant,与 demo-reset 同一份判据,不抄)。
   读事实与写 openid **都**过这两道锁:真店连"读演示事实"这个口子也不给开。 */
export function createDemoFacts({ db, apiError, isDemoTenant, protectedRealTenants }) {
  function assertDemo(tenantId) {
    if (protectedRealTenants.includes(tenantId)) {
      throw apiError(403, 'PROTECTED_REAL_TENANT', `${tenantId} 是真店,演示口不对它开放。`)
    }
    const t = db.prepare('SELECT id, name, kind FROM tenants WHERE id = ?').get(tenantId)
    if (!t) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    if (!isDemoTenant(t)) {
      throw apiError(403, 'NOT_DEMO_TENANT', `${tenantId} 的归属是 kind=${t.kind || 'real'},不是演示店 —— 演示事实口只对演示店开放。`)
    }
    return t
  }

  /* 铺设脚本要的三个事实(逐项幂等靠它判「缺不缺」) */
  function facts(tenantId, userId) {
    assertDemo(tenantId)
    if (!userId) return { userId: null, wechatOpenId: '', signedSheets: 0, timecards: [], activeCoupons: 0, couponGrants: 0, comboSheets: 0, recharges: 0 }
    return {
      userId,
      wechatOpenId: (db.prepare('SELECT wechat_open_id AS w FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId) || {}).w || '',
      signedSheets: db.prepare("SELECT COUNT(*) n FROM settlements WHERE user_id = ? AND tenant_id = ? AND status = 'signed'").get(userId, tenantId).n,
      timecards: db.prepare('SELECT id, total_times AS totalTimes, used_times AS usedTimes FROM member_timecards WHERE user_id = ? AND tenant_id = ? ORDER BY rowid ASC').all(userId, tenantId),
      activeCoupons: db.prepare("SELECT COUNT(*) n FROM coupon_grants WHERE user_id = ? AND tenant_id = ? AND status = 'active'").get(userId, tenantId).n,
      /* 发过几张券(含已核销):铺设"发几张"要按这个数判幂等 —— 只看 active 的话,
         组合支付单用掉一张,下次重跑就又发一张,越跑越多(幂等破在这种地方)。 */
      couponGrants: db.prepare('SELECT COUNT(*) n FROM coupon_grants WHERE user_id = ? AND tenant_id = ?').get(userId, tenantId).n,
      /* 充过几次值:铺设判"要不要充"得按这个,不能按"余额是不是 0" ——
         组合支付单会把余额花光,按余额判的话每次重跑都再充一笔(幂等破在这儿)。 */
      recharges: db.prepare("SELECT COUNT(*) n FROM stored_value_transactions WHERE user_id = ? AND tenant_id = ? AND type = 'recharge'").get(userId, tenantId).n,
      /* 组合支付单:一张单里同时用了券 + 次卡(储值腿在 payments 里,这两样在单头上) */
      comboSheets: db.prepare("SELECT COUNT(*) n FROM settlements WHERE user_id = ? AND tenant_id = ? AND status = 'signed' AND coupon_grant_id IS NOT NULL AND timecard_id IS NOT NULL").get(userId, tenantId).n
    }
  }

  /* 演示顾客贴微信身份:真实路径是顾客扫签署码授权,演示铺设没有真人扫码。
     只写 wechat_open_id 一个字段,金额/账本一分不碰。 */
  function bindOpenId(tenantId, userId, openId) {
    assertDemo(tenantId)
    if (!userId || !openId) throw apiError(400, 'BAD_REQUEST', 'userId 与 openId 必填。')
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId)
    if (!u) throw apiError(404, 'NOT_FOUND', '该演示店下没有这位顾客。')
    db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ? AND tenant_id = ?').run(openId, userId, tenantId)
    return { bound: true, userId, openId }
  }

  return { facts, bindOpenId }
}
