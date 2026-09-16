/* 备份只许 VACUUM INTO —— 常驻判据(店主 09n 件 A)
 *
 * 🔴 案底三层,一层比一层要紧:
 *   ① 05n 店主现场撞出来:WAL 下 `cp` 出来的库**打不开**(`file is not a database`);
 *   ② `tools/db-backup.mjs` 的注释里早就写着「全仓凡备份一次库文件都该调它,**不许再 copyFileSync**」;
 *   ③ 🔴 **而开机迁移与「生产每日自动备份」两条路,走的都还是 `copyFileSync`** ——
 *      正确出口一直在,真正在跑的那条却是另一条。**一件事两处真相。**
 * 这一套把「备份语境里不许出现 cp」钉死,并**现证 cp 真的会拷出废文件**(J-58⑥ 两面)。
 */
import { readFileSync, readdirSync, copyFileSync, mkdtempSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { backupDb } from './db-backup-core.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
let n = 0
const fails = []
const check = (name, cond, detail = '') => {
  n += 1
  if (cond) console.log(`ok ${n} - ${name}`)
  else { console.log(`not ok ${n} - ${name} :: ${detail}`); fails.push(name) }
}

/* ① 行为层两面:WAL 里压着已提交数据时,cp 出来的是废的,VACUUM INTO 出来的是对的 */
const d0 = mkdtempSync(join(tmpdir(), 'wal-proof-'))
const src = join(d0, 't.sqlite')
const db = new DatabaseSync(src)
db.exec('PRAGMA journal_mode=WAL'); db.exec('CREATE TABLE t (id INTEGER)')
db.exec('BEGIN'); for (let i = 0; i < 5000; i++) db.prepare('INSERT INTO t VALUES (?)').run(i); db.exec('COMMIT')
const real = db.prepare('SELECT COUNT(*) n FROM t').get().n
const cpOut = join(d0, 'by-cp.sqlite'); copyFileSync(src, cpOut)
const vOut = join(d0, 'by-vacuum.sqlite'); const r = backupDb(src, vOut)
const readN = (p) => { try { const x = new DatabaseSync(p, { readOnly: true }); const v = x.prepare('SELECT COUNT(*) n FROM t').get().n; x.close(); return v } catch { return -1 } }
check(`①a 🔴 **必中靶子**:WAL 下 cp 出来的那份读不回原数(源 ${real} 行 · cp 那份 ${readN(cpOut)})`,
  readN(cpOut) !== real, `cp 那份读到 ${readN(cpOut)},与源 ${real} 一样 —— 那这条判据在空守`)
check(`①b ✅ **反面靶子**:同一时刻 VACUUM INTO 出来的那份读得回原数(${readN(vOut)} 行 · ${r.bytes} 字节 · ${r.tables} 张表)`,
  readN(vOut) === real, `VACUUM 那份读到 ${readN(vOut)}`)
check('①c backupDb **当场打开验过**(验不过要抛,不许把废文件当备份交出去)', r.tables >= 1)

/* ② 静态白名单式:备份语境里不许出现 copyFileSync */
const files = readdirSync(join(ROOT, 'apps/api')).filter((f) => f.endsWith('.mjs') && !f.startsWith('test-'))
const BACKUP_CTX = /backup|快照|snapshot|pre-import|pre-rebuild/i
const hits = []
for (const f of files) {
  const src2 = readFileSync(join(ROOT, 'apps/api', f), 'utf8')
  src2.split('\n').forEach((ln, i) => {
    if (!/\bcopyFileSync\s*\(/.test(ln)) return
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return                 // 注释里提到不算(J-61)
    const near = src2.split('\n').slice(Math.max(0, i - 6), i + 2).join('\n')
    if (BACKUP_CTX.test(near) || BACKUP_CTX.test(ln)) hits.push(`apps/api/${f}:${i + 1} ${ln.trim().slice(0, 80)}`)
  })
}
export const CP_BACKUP_ALLOW = [
  { at: 'apps/api/local-server.mjs', why: '导入前快照 `lucky-luxe.pre-import-*`:它跑在**接口线程里、导入事务之前**,而 VACUUM INTO 要独占读锁 —— 09n 未点名,单独登记等店主裁' },
  { at: 'apps/api/demo-reset.mjs', why: '演示店重置前快照:只动演示租户,不碰真实经营库 —— 单独登记等店主裁' },
]
const outside = hits.filter((h) => !CP_BACKUP_ALLOW.some((a) => h.startsWith(a.at)))
check(`②a 🔴 备份语境里 \`copyFileSync\` 现扫 **${outside.length} 处**(扫了 ${files.length} 个非测试模块;白名单 ${CP_BACKUP_ALLOW.length} 条各有理由)`,
  outside.length === 0, outside.join(' | '))
check(`②b 白名单只许变短(现 ${CP_BACKUP_ALLOW.length} ≤ 2,每条写明为什么)`,
  CP_BACKUP_ALLOW.length <= 2 && CP_BACKUP_ALLOW.every((a) => String(a.why).length > 20))
/* ②c 自守:塞一行备份语境的 cp,必须被咬到(零命中不算通过 —— J-58①) */
const probe = ['const backupPath = x', ['copyFileSync', '(dbPath, backupPath)'].join('')].join('\n')
const probeHit = probe.split('\n').some((ln, i) => /\bcopyFileSync\s*\(/.test(ln) && BACKUP_CTX.test(probe))
check('②c 自守:构造一行「备份语境里的 cp」必须被咬到', probeHit)
check('②d 反向守:非备份语境的 cp 不许被咬(否则这条会把正常拷贝一起判红)',
  !(/\bcopyFileSync\s*\(/.test('copyFileSync(a, b)') && BACKUP_CTX.test('const a = 1\ncopyFileSync(a, b)')))

/* ③ 开机链那两处重建,各自必须先备份 */
const ls = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
check('③a 开机重建 A(去 tenant_id 默认值)调用处带了 dbPath,走 backupBeforeRebuild',
  /backupBeforeRebuild\(\{\s*dbPath:/.test(ls))
check('③b 🔴 开机重建 B(唯一约束重建)调用处也把 dbPath 传进去了(不传 = 那次 DROP 没有备份)',
  /rebuildTenantScopedUnique\(db,\s*\{\s*dbPath:/.test(ls))
const sur = readFileSync(join(ROOT, 'apps/api/schema-unique-rebuild.mjs'), 'utf8')
check('③c 🔴 两处 `DROP TABLE` 之前都有 backupFirst(全仓仅有的两处 DROP,此前一行备份都没有)',
  (sur.match(/backupFirst\(/g) || []).length >= 2, String((sur.match(/backupFirst\(/g) || []).length))

console.log(`\n1..${n}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${n} 条)`)
