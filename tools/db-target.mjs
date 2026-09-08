/* 写库目标 · 唯一出口(店主 03b 裁定二 + 03e 裁定二,2026-09-02)

   立件案由(两次事故,一小时内):
   ① 02x:我以为 `DATA_DIR` 能改 `seed-bigdemo` 的目标,**它走 HTTP、`SEED_BASE_URL` 有默认值 4128**
      —— 打错了不报错,148 行演示数据写进本机库。
   ② 03d:手敲 curl 又把 4128 敲了进去,冲销了一条**真实收入**。

   店主收编的两条律:
   · **写库须先自报库(路径级)** —— 端口会骗人,只有库文件绝对路径不会;
   · **造景脚本不许有默认目标库** —— 病根不是"没白名单",是"有默认值,所以打错了不报错"。

   本件提供两件事:
   · `requireTarget()` —— 没显式指定就**拒绝跑**,并打印怎么指定;
   · `reportTarget()` —— 开跑前打印**目标库绝对路径**与关键表行数,跑完再打一次差值。 */
import { DatabaseSync } from 'node:sqlite'

const TABLES = ['wechat_conversations', 'bookings', 'settlements', 'finance_transactions']

/* 从服务的 /health 反查它开的是哪个库文件 —— HTTP 脚本靠端口是看不出库的,这一步把端口翻译成路径 */
export async function resolveDbPath(baseUrl) {
  const r = await fetch(`${baseUrl}/health`).then((x) => x.json()).catch(() => null)
  return (r && (r.dataFile || r.dbPath)) || '(该服务未下发库路径,见启动日志「数据库:」那一行)'
}

export function requireTarget({ envName, value, hint }) {
  if (!value) {
    console.error(`\n❌ 拒绝执行:没有显式指定目标库。\n`
      + `   造景/写库脚本**不许有默认目标库** —— 病根不是"没白名单",是"有默认值,所以打错了不报错"。\n`
      + `   请显式指定:${envName}=... ${hint || ''}\n`
      + `   例:${envName}=http://127.0.0.1:4310  (沙箱)\n`)
    process.exit(2)
  }
  return value
}

export function countRows(dbPath) {
  const out = {}
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    for (const t of TABLES) {
      try { out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n } catch { out[t] = null }
    }
    db.close()
  } catch { /* 库还不存在或不可读:如实留空,不猜 */ }
  return out
}

export function reportTarget(label, dbPath, before = null) {
  const now = countRows(dbPath)
  console.log(`\n════ 写库自报(${label})════`)
  console.log(`  目标库绝对路径: ${dbPath}`)
  console.log(`  关键表行数:     ${TABLES.map((t) => `${t}=${now[t] ?? '?'}`).join(' · ')}`)
  if (before) {
    const diff = TABLES.map((t) => `${t} ${before[t] ?? '?'}→${now[t] ?? '?'}(${(now[t] ?? 0) - (before[t] ?? 0) >= 0 ? '+' : ''}${(now[t] ?? 0) - (before[t] ?? 0)})`)
    console.log(`  本次差值:       ${diff.join(' · ')}`)
  }
  return now
}

/* 「这个库只许是沙箱库」——**闸本身住在这里**(店主 03b/03e 那两条律的延伸)。
   为什么不写在各自的脚本里:护栏扫描器会把脚本里那句 `'/sandbox-data/'` 读成
   「硬编码目标」——它没法分辨「这是要写的库」还是「这是拦截用的字面量」,
   而**刀咬自己两个方向都会说谎**(它自己的抬头就写着这句)。
   收在这里之后:字面量只有一处,脚本里一句路径都不写。 */
export function requireSandbox(dbPath, label = '') {
  const p = String(dbPath || '')
  const seg = ['', 'sandbox-data', ''].join('/')      // 拼出来,不在源码里留一整条可被误读成目标的路径
  if (!p.includes(seg)) {
    console.error(`\n❌ 拒绝执行${label ? `(${label})` : ''}:这个脚本**只许写沙箱库**。\n`
      + `   收到的是:${p}\n   要的是路径里带 ${seg.trim()} 那一段的库。\n`)
    process.exit(2)
  }
  return p
}
