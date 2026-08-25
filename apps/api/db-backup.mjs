/* 库快照(唯一出口)—— 谁要"动数据前先备份",都调这里;日备也走这里。

   立这个模块的原因:备份逻辑本来写在 demo-reset.mjs 里(演示店重置前的那份),
   现在生产铺设也要"备份或中止"。**抄一遍 = 两份迟早各自长歪**(店主 08-25 反复点的那条),
   所以抽成一处:文件名规则、撞名退让、空间预检、保留策略、失败即抛,全在这里。

   约定:失败一律 **抛错**,不返回"没备份成功"这种要靠调用方记得判的东西 ——
   备份不成就必须中止,这条不能靠自觉。

   🔴 店主 2026-08-25 定的保留策略(建议 A + ⓓⓔ):
     ⓐ 按需快照只留最近 5 份(日备另算,30 天滚动不变);
     ⓑ 落盘前空间预检:可用 < max(3×库, 500MB) → **拒绝并中止**。
        「备份或中止」的完整含义是"眼看会把卷写满就不该写",不是"写失败了才停" ——
        卷被备份塞满的后果不是备份失败,是 App 自己写不进去(预约/账本全停),那是生产事故;
     ⓒ 剩余/总容量随返回值上交,调用方写进 platform_ops_log;
     ⓓ 清理按**格式**分类,不按 tag:凡不符合日备格式的快照一律归"按需"这一类 ——
        照 tag 写清理规则,换个 tag 就又漏一遍;
     ⓔ 预检**通过时也报**剩余/总量,不能只在拒绝时说话 —— 否则没人知道离红线还有多远。 */
import { copyFileSync, mkdirSync, existsSync, statSync, statfsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export const DAILY_RE = /^lucky-luxe-\d{4}-\d{2}-\d{2}\.sqlite$/   // 日备:lucky-luxe-YYYY-MM-DD.sqlite
export const SNAPSHOT_RE = /^lucky-luxe-.*\.sqlite$/               // 本模块产出的一切快照
export const KEEP_ON_DEMAND = 5
const MIN_FREE_BYTES = 500 * 1024 * 1024

/** 卷的剩余/总容量(拿不到就返回 null —— 只让预检退让,不让它假装知道) */
export function diskSpace(dir) {
  try {
    const s = statfsSync(dir)
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }
  } catch { return null }
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`

/** ⓓ 按需快照 = 本模块产出的快照里**不是日备格式**的那些(按格式分类,不认 tag) */
export function onDemandSnapshots(backupDir) {
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter((f) => SNAPSHOT_RE.test(f) && !DAILY_RE.test(f))
    .map((f) => ({ file: f, path: join(backupDir, f), mtime: statSync(join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)                              // 新的在前
}

/** ⓐ 只留最近 keep 份按需快照;返回删掉的文件名(调用方写进日志) */
export function pruneOnDemand(backupDir, keep = KEEP_ON_DEMAND) {
  const removed = []
  for (const old of onDemandSnapshots(backupDir).slice(keep)) {
    try { unlinkSync(old.path); removed.push(old.file) } catch { /* 删不掉不算备份失败,记不上就算了 */ }
  }
  return removed
}

export function snapshotDb({ dbPath, backupDir, tag = '备份前', stamp, keep = KEEP_ON_DEMAND, daily = false, minFreeBytes = MIN_FREE_BYTES }) {
  if (!dbPath || !existsSync(dbPath)) throw new Error(`找不到要备份的库:${dbPath}`)
  mkdirSync(backupDir, { recursive: true })
  const dbBytes = statSync(dbPath).size

  // ⓑ 空间预检:先算"写得下吗",写不下就**在写之前**停
  const space = diskSpace(backupDir)
  const needBytes = Math.max(dbBytes * 3, minFreeBytes)   // minFreeBytes 可注入:测试要真验"预检拦得住、且拦下时一个字节没写"
  if (space && space.freeBytes < needBytes) {
    throw new Error(`空间不够,已中止(没写):可用 ${mb(space.freeBytes)} / 总 ${mb(space.totalBytes)},`
      + `本次至少要留 ${mb(needBytes)}(库 ${mb(dbBytes)} 的 3 倍与 500MB 取大)。`
      + '把卷写满的后果不是备份失败,是 App 自己写不进去 —— 先清旧快照再来。')
  }

  const at = stamp || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  let path = daily ? join(backupDir, `lucky-luxe-${at}.sqlite`) : join(backupDir, `lucky-luxe-${at}-${tag}.sqlite`)
  if (!daily) {
    // 同一秒连着跑会撞名 —— 自动加序号,撞满 20 次才认输(裸栈退出对人最不友好)
    for (let n = 2; existsSync(path) && n <= 20; n += 1) path = join(backupDir, `lucky-luxe-${at}-${n}-${tag}.sqlite`)
    if (existsSync(path)) throw new Error(`备份文件名连撞 20 次(同一秒跑了太多遍):${path}`)
  }
  copyFileSync(dbPath, path)
  const size = statSync(path).size
  if (!size) throw new Error(`备份出来是个空文件,已中止:${path}`)

  const pruned = daily ? [] : pruneOnDemand(backupDir, keep)        // ⓐ 只清按需那一类,日备归日备
  const after = diskSpace(backupDir)
  // ⓔ 通过时也说话:离红线还有多远,每次都报
  const spaceText = after ? `可用 ${mb(after.freeBytes)} / 总 ${mb(after.totalBytes)}` : '可用空间:探不到'
  return { path, size, pruned, freeBytes: after?.freeBytes ?? null, totalBytes: after?.totalBytes ?? null, spaceText }
}

/* 生产每日自动备份:日备一天一份、30 天滚动 —— **也走这个出口**。
   以前它自己 copyFileSync + 自己写清理正则,于是"清理规则只认日备格式"这条
   就没人管得着按需快照(店主 08-25 抓的那个口子)。现在两类快照同一处管。 */
export function dailyBackup({ dbPath, backupDir, dateStr, days = 30, now = Date.now() }) {
  mkdirSync(backupDir, { recursive: true })
  const dest = join(backupDir, `lucky-luxe-${dateStr}.sqlite`)
  const made = existsSync(dest) ? null : snapshotDb({ dbPath, backupDir, stamp: dateStr, daily: true })
  const keepAfter = now - days * 86400000
  const removed = []
  for (const file of readdirSync(backupDir)) {
    const m = file.match(/^lucky-luxe-(\d{4}-\d{2}-\d{2})\.sqlite$/)
    if (m && new Date(`${m[1]}T12:00:00`).getTime() < keepAfter) {
      try { unlinkSync(join(backupDir, file)); removed.push(file) } catch { /* 删不掉下轮再说 */ }
    }
  }
  return { made, removed, space: diskSpace(backupDir) }
}
