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
  "ownerTitle": "设置营业时间",
  "ownerHint": "开始使用前，先告诉客人你什么时候营业",
  "saveDisabledNote": "至少选择一天营业",
  "timePlaceholder": "选择时间",
  "saveButton": "保存并开始使用",
  "staffTitle": "老板还没设置营业时间",
  "staffHint": "设置完成后这里会出现今天的排单",
  "settingsSave": "保存营业时间",
  "saving": "保存中…",
  "closed": "休息",
  "batchTitle": "统一设置营业时间",
  "batchStart": "统一开始时间",
  "batchEnd": "统一结束时间",
  "batchScope": "应用范围",
  "scopeAll": "全周 7 天（含休息日）",
  "scopeOpen": "仅当前营业日",
  "applyAll": "应用到全周",
  "applyOpen": "应用到营业日",
  "hintAll": "会开启周一至周日营业并覆盖时间；休息日可在下方关闭。",
  "hintOpen": "只覆盖已开启营业的日期；休息日保持关闭。",
  "hintDraft": "应用只改草稿，保存后才生效。",
  "untouched": "还没有应用统一时间",
  "applied": "已应用到 {count} 天，尚未保存",
  "undo": "撤销",
  "undone": "已恢复到本次批量应用前（含撤销其后的逐日编辑）",
  "missing": "请先填写统一的开始和结束时间",
  "order": "开始时间必须早于结束时间",
  "noTargets": "当前没有营业日，请先开启一天或选择全周",
  "failed": "保存失败，草稿已保留，请重试",
  "incomplete": "{day}还没选时间",
  "invalid": "{day}的开始时间要早于结束时间",
  "dayNames": [
    "周日",
    "周一",
    "周二",
    "周三",
    "周四",
    "周五",
    "周六"
  ],
  "en": {
    "ownerTitle": "Set business hours",
    "ownerHint": "Let customers know when your store is open.",
    "saveDisabledNote": "Select at least one open day",
    "timePlaceholder": "Choose time",
    "saveButton": "Save and get started",
    "staffTitle": "Business hours are not set yet",
    "staffHint": "Your schedule will appear after the owner sets business hours.",
    "settingsSave": "Save business hours",
    "saving": "Saving…",
    "closed": "Closed",
    "batchTitle": "Set hours together",
    "batchStart": "Shared opening time",
    "batchEnd": "Shared closing time",
    "batchScope": "Apply to",
    "scopeAll": "All 7 days (including closed days)",
    "scopeOpen": "Currently open days only",
    "applyAll": "Apply to week",
    "applyOpen": "Apply to open days",
    "hintAll": "Opens all seven days and replaces their hours. Turn off closed days below.",
    "hintOpen": "Replaces hours for open days only. Closed days stay closed.",
    "hintDraft": "Changes stay in this draft until you save.",
    "untouched": "Shared hours have not been applied",
    "applied": "Applied to {count} days. Not saved yet.",
    "undo": "Undo",
    "undone": "Restored the draft before the last apply, including later daily edits.",
    "missing": "Enter both opening and closing times first.",
    "order": "Opening time must be earlier than closing time.",
    "noTargets": "No open days. Open a day or select all seven days.",
    "failed": "Save failed. Your draft is preserved; please retry.",
    "incomplete": "Choose both times for {day}.",
    "invalid": "Opening time must be earlier than closing time for {day}.",
    "dayNames": [
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat"
    ]
  }
}
