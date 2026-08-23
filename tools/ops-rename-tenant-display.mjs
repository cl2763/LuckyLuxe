/* 商户显示名修正(店主 2026-08-23 收口件②)。
   背景:选店页出现两个同名「小婕的店(沙箱)」(jics-sandbox / jics-store),顾客无法分辨该点哪个。
   本脚本**只改显示名**(tenants.name 与该租户门店的 stores.name),不动任何业务数据
   —— 订单、金额、账本、归属一个字节都不碰。

   用法:
     node tools/ops-rename-tenant-display.mjs <tenantId> "<新显示名>" [--db <sqlite 路径>] [--store-name "<门店显示名>"]
   例:
     node tools/ops-rename-tenant-display.mjs jics-sandbox "小婕的店(演示)"
   不带 --db 时用 apps/api/local-data/lucky-luxe.sqlite(本机);生产请在服务器上指定 DATA_DIR 下的库。 */
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const argv = process.argv.slice(2)
const tenantId = argv[0]
const newName = argv[1]
const dbFlag = argv.indexOf('--db')
const storeFlag = argv.indexOf('--store-name')
const here = dirname(fileURLToPath(import.meta.url))
const dbPath = dbFlag > -1 ? argv[dbFlag + 1] : join(here, '..', 'apps/api/local-data/lucky-luxe.sqlite')
const storeName = storeFlag > -1 ? argv[storeFlag + 1] : newName

if (!tenantId || !newName) {
  console.error('用法: node tools/ops-rename-tenant-display.mjs <tenantId> "<新显示名>" [--db <路径>] [--store-name "<门店名>"]')
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
const cur = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId)
if (!cur) { console.error(`租户不存在:${tenantId}(库:${dbPath})`); process.exit(1) }

const stores = db.prepare('SELECT id, name FROM stores WHERE tenant_id = ?').all(tenantId)
console.log(`库:${dbPath}`)
console.log(`租户显示名:「${cur.name}」→「${newName}」`)
for (const s of stores) console.log(`门店显示名:「${s.name}」→「${storeName}」(${s.id})`)

db.prepare('UPDATE tenants SET name = ? WHERE id = ?').run(newName, tenantId)
db.prepare('UPDATE stores SET name = ? WHERE tenant_id = ?').run(storeName, tenantId)

const after = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId)
console.log(`✅ 已改名(只动显示名):${after.name}`)
console.log('提醒:顾客端选店页与首页店名随下一次请求即刻生效,无需重启。')
