/* D148 · 对顾客说日期要说人话(店主 05p 补二 裁,五通 v3 读出来的)

   案底(v3 原文,顾客看到的原句):
   · 「好的,改成美甲了、**2026-09-12** 可以。大概几点方便?」
   · 「**2026-09-07** 门店休息哦,换一天好吗?」
   真人不会对顾客念 `2026-09-12`。她说「**这周六(9月12日)**」。
   `YYYY-MM-DD` 是**程序内部的格式**,跟 `nail` / `lash` 是一回事 ——
   同一条律:**显示给人看的,永远不显示程序用的形状**(D129 族)。

   ══ 出句形状 ══
   今天/明天/后天 → 「明天(9月7日,周一)」;
   本周内 → 「这周六(9月12日)」;
   再远 → 「9月20日(周日)」。
   括号里的月日**始终带着** —— 顾客要拿它对自己的日历,只说「这周六」会歧义。

   ══ 时区 ══
   「今天」是谁的今天,只能由**门店时区**说了算(CLAUDE.md 头一条)。
   所以基准日 `todayISO` 必须由调用方给,这里**不许 `new Date()` 推日期**。 */

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/* 只做纯算术:两个 YYYY-MM-DD 之间差几天。用 UTC 正午避开夏令时那一小时。 */
function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T12:00:00Z`)
  const b = Date.parse(`${toISO}T12:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

export function weekdayOf(iso) {
  const t = Date.parse(`${iso}T12:00:00Z`)
  if (Number.isNaN(t)) return ''
  return WD[new Date(t).getUTCDay()] || ''
}

/* `2026-09-12` → 「这周六(9月12日)」。认不出来的原样退回(不许瞎编一个日期)。 */
export function humanDate(iso, todayISO = '', lang = 'zh') {
  const d = String(iso || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const [, m, day] = d.match(/^\d{4}-(\d{2})-(\d{2})$/)
  const md = lang === 'en' ? `${Number(m)}/${Number(day)}` : `${Number(m)}月${Number(day)}日`
  const wd = weekdayOf(d)
  const wdEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.parse(`${d}T12:00:00Z`)).getUTCDay()]
  const diff = todayISO ? daysBetween(todayISO, d) : null
  if (diff === null) return lang === 'en' ? `${md} (${wdEn})` : `${md}(${wd})`
  const near = lang === 'en'
    ? { 0: 'today', 1: 'tomorrow', 2: 'the day after tomorrow' }[diff]
    : { 0: '今天', 1: '明天', 2: '后天' }[diff]
  if (near) return lang === 'en' ? `${near} (${md})` : `${near}(${md},${wd})`
  /* 本周内(3~6 天后)按「这周X」说;更远就报月日 */
  if (diff > 2 && diff <= 6) return lang === 'en' ? `this ${wdEn} (${md})` : `这${wd}(${md})`
  return lang === 'en' ? `${md} (${wdEn})` : `${md}(${wd})`
}

/* 把一句话里所有 `YYYY-MM-DD` 换成人话。
   为什么做成「整句替换」而不是让每个出句自己拼:出句散在两条采集路十几处,
   逐处改一遍必漏(而且下次新加一句又漏)。**收在一个出口**,判据也只需盯这一个。 */
export function humanizeDates(text = '', todayISO = '', lang = 'zh') {
  return String(text || '').replace(/\d{4}-\d{2}-\d{2}/g, (m) => humanDate(m, todayISO, lang))
}
