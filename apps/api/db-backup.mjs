/* 库快照(唯一出口)—— 谁要"动数据前先备份",都调这里。

   立这个模块的原因:备份逻辑本来写在 demo-reset.mjs 里(演示店重置前的那份),
   现在生产铺设也要"备份或中止"。**抄一遍 = 两份迟早各自长歪**(店主 08-25 反复点的那条),
   所以抽成一处:文件名规则、撞名退让、失败即抛,全在这里。

   约定:失败一律 **抛错**,不返回"没备份成功"这种要靠调用方记得判的东西 ——
   备份不成就必须中止,这条不能靠自觉。 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function snapshotDb({ dbPath, backupDir, tag = '备份前', stamp }) {
  if (!dbPath || !existsSync(dbPath)) throw new Error(`找不到要备份的库:${dbPath}`)
  mkdirSync(backupDir, { recursive: true })
  const at = stamp || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  let path = join(backupDir, `lucky-luxe-${at}-${tag}.sqlite`)
  // 同一秒连着跑会撞名 —— 自动加序号,撞满 20 次才认输(裸栈退出对人最不友好)
  for (let n = 2; existsSync(path) && n <= 20; n += 1) path = join(backupDir, `lucky-luxe-${at}-${n}-${tag}.sqlite`)
  if (existsSync(path)) throw new Error(`备份文件名连撞 20 次(同一秒跑了太多遍):${path}`)
  copyFileSync(dbPath, path)
  const size = statSync(path).size
  if (!size) throw new Error(`备份出来是个空文件,已中止:${path}`)
  return { path, size }
}
