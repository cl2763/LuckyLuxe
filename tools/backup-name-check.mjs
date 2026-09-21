/* 🔴 备份文件名必须说真话(11a §〇.2 立)—— **唯一出口**
 *
 * ══ 案底 ══
 * Cowork 在令的文件名里按「店主要睡了所以算明天」写日期(她记的第 39 笔),
 * 我照着它命名备份,**一路写错两天**:`…_20260922T0000Z` 实际拍于 `2026-09-20T19:32:34Z`。
 * 🔴 **一个会被用来挑还原目标的名字,不许是推出来的。**(J-108 三元组里「哪一刻」落到文件名上)
 *
 * 规矩:文件名里的时间戳 = 它的生成时刻(UTC),容差 60 秒。
 * 名字里只给到分钟(HHMM)也算数,但**那一分钟必须是对的**。
 */
export const TOLERANCE_SEC = 60

/** 从文件名里抠时间戳。6 位 HHMMSS / 4 位 HHMM / 只有日期 —— 三种都认。
 *  🔴 第一版只认 6 位,把 `T0600Z` 读成了 `000000`,凭空造出几个假差值。 */
export function nameTimestamp(name) {
  let m = /(20\d{6})[T_-](\d{6})(?!\d)/.exec(name)
  if (m) return { ms: Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[2].slice(0, 2), +m[2].slice(2, 4), +m[2].slice(4, 6)), kind: 'HHMMSS' }
  m = /(20\d{6})[T_-](\d{4})(?!\d)/.exec(name)
  if (m) return { ms: Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[2].slice(0, 2), +m[2].slice(2, 4), 0), kind: 'HHMM' }
  m = /(20\d{6})/.exec(name)
  if (m) return { ms: Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8)), kind: 'DATE' }
  return null
}

/** 名字说的是不是真话。`kind==='HHMM'` 时容差放到 60 秒 + 分钟粒度;`DATE` 只比日期。 */
export function nameTellsTruth(name, mtimeMs) {
  const t = nameTimestamp(name)
  if (!t) return { ok: false, reason: '名字里没有时间戳 —— 挑还原目标时无法自证', delta: null }
  const delta = Math.round((mtimeMs - t.ms) / 1000)
  const slack = t.kind === 'HHMMSS' ? TOLERANCE_SEC : t.kind === 'HHMM' ? TOLERANCE_SEC + 59 : 24 * 3600 - 1
  if (Math.abs(delta) <= slack) return { ok: true, delta, kind: t.kind }
  const local = Math.abs(delta + 8 * 3600) <= slack || Math.abs(delta + 4 * 3600) <= slack
  return { ok: false, delta, kind: t.kind,
    reason: local ? `差 ${delta}s —— 看着像用**本地时间**命名的(要 UTC)` : `差 ${delta}s —— 名字在说谎` }
}

/* 🔴 具名历史豁免:这几份名字已经被台账与回执引用过,**改名会让那些引用指向不存在的文件**
   —— 那是另一种说谎。所以名字留着,真相写在 `handoff/backups文件名真伪对照_2026-09-21.md`。
   **这张表只许变短。** 今后新产生的备份一律不许进来。 */
export const LEGACY_LYING_NAMES = Object.freeze([
  '生产库_10g推前_20260921T0600Z.sqlite',
  '生产库_夜16三批推前_20260922T0130Z.sqlite',
  '生产库_夜16推前_20260922T0000Z.sqlite',
  '生产库_夜16续推前_20260922T0300Z.sqlite',
  '生产库_推main后_20260920T081500Z.sqlite',
  '沙箱库_段7b建券前_20260908-124951.sqlite',   // 按本地时间(CST)命名,不是写错日期
])
