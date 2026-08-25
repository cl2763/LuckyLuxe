/* 门店列表域(店主 2026-08-25 定的【门店列表三个一】)。

   口径写死在这里,以后谁想加过滤/加排序都得到这一处来改:
     · **一个数据源** —— 全部公开门店。**不许**加任何"只显示某些店"的过滤。
       (2026-08-16 店主翻案过一次:曾经按会员关系裁过列表,顾客找不到新店。)
     · **一个排序器** —— sortShops()。以后加"距离近的优先"是往这个函数加一个维度,
       不是重开一条路。
     · **一处标记** —— markJoined()。会员标只有这一个来源。

   为什么放后端:两端(网页顾客端 / 小程序 shop-select)读同一条 /shops,
   排序与标记做在这里,两端天然一致,不需要各写一份(四之九)。 */

export function createStoreDirectory({ db }) {
  /* 这个身份在哪几家店有会员档案。
     判据走 user_identities(身份↔用户 的唯一映射),同时兼容只贴了 wechat_open_id 的老档案。
     ⚠️ 只回「有没有档案」这一件事,不回任何跨店的余额/消费数字 ——
     跨店资产必须各店各读(串号红线)。 */
  function joinedTenantIds(userId) {
    if (!userId) return new Set()
    const rows = db.prepare(`
      SELECT DISTINCT u.tenant_id AS tid FROM users u
      WHERE u.id = ?
      UNION
      SELECT DISTINCT u2.tenant_id AS tid FROM users u2
      JOIN user_identities i2 ON i2.user_id = u2.id
      WHERE (i2.provider, i2.provider_user_id) IN (
        SELECT i.provider, i.provider_user_id FROM user_identities i WHERE i.user_id = ?
      )
      UNION
      SELECT DISTINCT u3.tenant_id AS tid FROM users u3
      WHERE u3.wechat_open_id IS NOT NULL AND u3.wechat_open_id <> ''
        AND u3.wechat_open_id = (SELECT wechat_open_id FROM users WHERE id = ?)
    `).all(userId, userId, userId)
    return new Set(rows.map((r) => r.tid))
  }

  /* 一处标记:已入会的店打 joined=true。前端只渲染这个字段,不自己判断。 */
  function markJoined(shops, joinedSet) {
    return shops.map((s) => ({ ...s, joined: joinedSet.has(s.tenantId) }))
  }

  /* 一个排序器:已入会的置顶,组内保持数据源原有顺序(稳定排序)。
     以后要加"距离近的优先",在这里加一个维度,不许在别处再排一次。 */
  function sortShops(shops) {
    return shops
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (Number(Boolean(b.s.joined)) - Number(Boolean(a.s.joined))) || (a.i - b.i))
      .map((x) => x.s)
  }

  /* 出口:标记 + 排序一起做。**不做过滤** —— 传进来几家,出去还是几家。 */
  function decorate(shops, userId) {
    const joined = joinedTenantIds(userId)
    return sortShops(markJoined(shops, joined))
  }

  return { joinedTenantIds, markJoined, sortShops, decorate }
}
