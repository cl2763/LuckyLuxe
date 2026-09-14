/* `users` 表的后加列 —— 一处登记,一处施工(店主 07m §四① 落地时摘出,2026-09-14)
 *
 * 摘出来的理由(裁 #89:顶破棘轮的正确反应是摘出去):
 * 本批给 `users` 加了 `avatar_url`,而 `users` 的后加列原来散在 `local-server.mjs` 的**两处**
 * `for (const sql of [...])`(客户运营字段一组、迁移标记一组)。
 * 加一列要先找对是哪一组,**这正是「文件太大所以搜不全就改不全」那条**。
 *
 * ⚠️ 交付纪律⑧:列一律走 `try/catch ALTER TABLE ADD COLUMN`。
 * 只写进 `CREATE TABLE` 等于只对全新库生效,**老库(含生产库)不会跟上**;
 * `test-schema-consistency` 会把「空库新建 schema」与「老库跑完迁移后的 schema」逐表逐列 diff,
 * 忘写 ALTER 直接红。
 */

/** 客户运营字段:过敏史/偏好/生日营销,以及顾客自己设的头像 */
export const USER_OP_COLUMNS = [
  "ALTER TABLE users ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE users ADD COLUMN notes TEXT',
  'ALTER TABLE users ADD COLUMN birthday TEXT',
  /* 🔴 裁 #94(店主 07m §四①):顾客选了头像、看到「资料已保存」的绿勾,
     而它**只写进了那台手机的 `wx.setStorageSync`** —— 后端 `avatarUrl` 零出现、表里没有这一列。
     同一次保存里 `display_name` 是真存了的,所以这是 J-62 最坏的一种:**做了一半,回执给全了**。
     没传过就是空串 → 前端出占位(占位零回落律),**绝不拿别人的图顶**。 */
  'ALTER TABLE users ADD COLUMN avatar_url TEXT',
]

/* ⚠️ `users` 还有两列(`is_migrated` / `legacy_total_spend_cents`)住在
   `local-server.mjs` 里一个**混着 services / membership_packages 的大数组**中,本批**没搬** ——
   把它们从那个混合数组里择出来是另一件事,夹带着做容易切错。**登记在案,不是漏了。** */

/** 施工:重复列跳过,别的错照抛(静默失败器族:只吞「已经有了」这一种) */
export function addUserColumns(db, list) {
  for (const sql of list) {
    try { db.exec(sql) } catch (error) {
      if (!String(error.message || '').includes('duplicate column')) throw error
    }
  }
}
