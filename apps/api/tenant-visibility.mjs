/* 门店可见性(D76,店主 2026-08-25)。

   根因:`tenants.kind` 一列同时管两件事 ——
     ① 账本受不受只追加律保护(D72/D75 那一族)
     ② 顾客选店页出不出现
   于是生产进退两难:想把演示样板店从选店页拿下来就得改 kind,而它们有收入、
   D75 第一道锁拦死(拦得对);不改就一直对每个真顾客公开挂着。

   拆开之后:`listed` 只回答**「顾客可去的门店」**这一件事,与账本律无关 ——
   改它不触发任何账本触发器,也不动 kind。
   演示店默认不在这个集合里(不是"被过滤掉的门店",是本来就不属于)。 */
export function ensureListedColumn(db) {
  try {
    db.exec('ALTER TABLE tenants ADD COLUMN listed INTEGER NOT NULL DEFAULT 1')
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
  }
  // kind='demo' 的默认不上架。只碰这一列,不碰 kind、不碰任何账本表。
  db.exec("UPDATE tenants SET listed = 0 WHERE kind = 'demo' AND listed = 1")
}
