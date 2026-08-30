/* 营业时间闸(《营业时间强制设置图 v1.0》,D84 强制首登勾选 · 2026-08-30)。

   唯一判定(图首行):「未设置态」= 该店营业时间配置中**没有任何一天**有营业时段
   (business_hours 无行,或七天全 is_closed)。两端(小程序+网页)读同一份数据,
   旗标由 /admin/auth/me 随会话下发 —— 不另开接口。

   合同三(零回落):所有读口只认真实配置,未设置一律走 hoursUnset 分支;
   「未设置≈10:00-20:00」类回落逻辑全库处死(A3 判据在 test-hours-gate 白名单机械扫)。 */

/** 未设置态判定的唯一出口。storeId 空(店都没有)也算未设置。 */
export function hoursUnsetOfStore(db, storeId) {
  if (!storeId) return true
  return !db.prepare('SELECT 1 FROM business_hours WHERE store_id = ? AND is_closed = 0 LIMIT 1').get(storeId)
}

/** A2 后端终闸:这次保存落库后的**合并态**必须至少一天营业。
    只看提交的 entries 不够 —— 部分提交(只带 3 天)时,留在库里的行也算数。 */
export function hoursSavable(entries, existingRows) {
  const merged = new Map()
  for (const r of existingRows || []) merged.set(Number(r.weekday), !r.is_closed)
  for (const e of entries || []) merged.set(Number(e.weekday), !e.isClosed)
  for (const open of merged.values()) if (open) return true
  return false
}

/** 图屏①/屏② 的后端句(两端同句,前端零拼串) */
export const HOURS_GATE_TEXT = {
  ownerTitle: '设置营业时间',
  ownerHint: '开始使用前,先告诉客人你什么时候营业',
  saveDisabledNote: '至少选择一天营业',
  timePlaceholder: '选择时间',
  saveButton: '保存并开始使用',
  staffTitle: '老板还没设置营业时间',
  staffHint: '设置完成后这里会出现今天的排单'
}
