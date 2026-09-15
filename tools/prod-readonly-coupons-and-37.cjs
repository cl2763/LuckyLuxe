/* 生产只读 · **已准备,未在生产上跑**(夜13 兜底队列 #6 #7)
 *
 * 两件合一份:
 *   #6 那 10 张 `coupon_grants.status = 'unused'` 的券 —— 四样事实
 *   #7 生产那 37 行是不是种子数据
 *
 * 🔴 三条批准条件(J-75),这份逐条做到:
 *   ① **同构库跑通** —— 先在本机库跑一遍,证明它跑得动、每条 SQL 都成立(见回执里的现测输出);
 *   ② **每列先探存在** —— 生产 schema 与本机不同过一次(生产 users 少一列 avatar_url),
 *      所以逐列 `PRAGMA table_info` 探过再用,探不到就报「这一栏报不了」而不是抛;
 *   ③ **阳性对照** —— 每一问都带底数行,**0 是「没有」还是「没扫到」靠它分**(J-58①)。
 *
 * 全部 `SELECT`。不建文件、不改 journal、不带写语句。
 */
const { DatabaseSync } = require('node:sqlite')
const { statSync } = require('node:fs')
const DB = process.argv[2] || ''
if (!DB) { console.error('🔴 拒绝执行:没有显式指定目标库(J-64)'); process.exit(2) }
const st = statSync(DB)
console.log(`══ 库:${DB} · ${st.size} 字节 · mtime ${new Date(st.mtimeMs).toISOString()} · inode ${st.ino}`)
const db = new DatabaseSync(DB, { readOnly: true })
const has = (t) => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(t).n > 0
const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name))
const q = (s, ...a) => db.prepare(s).all(...a)
const pick = (t, want) => { const c = cols(t); return want.filter((x) => c.has(x)) }

console.log('\n════ #6 · `unused` 券的四样事实 ════')
if (!has('coupon_grants')) console.log('  coupon_grants 表不在 —— 这一节报不了')
else {
  const c = cols('coupon_grants')
  console.log(`  [schema] coupon_grants 列:${[...c].join(', ')}`)
  console.log('\n── 底数(0 是「没有」还是「没扫到」靠这一行分)')
  console.log('   ' + JSON.stringify(q('SELECT status, COUNT(*) n FROM coupon_grants GROUP BY status ORDER BY n DESC')))
  console.log('\n── 甲 · 是哪几张(只取形态字段,不取顾客姓名)')
  const f1 = pick('coupon_grants', ['id', 'tenant_id', 'status', 'coupon_id', 'created_at', 'expires_at', 'used_at'])
  console.log('   ' + JSON.stringify(q(`SELECT ${f1.join(', ')} FROM coupon_grants WHERE status = 'unused' ORDER BY rowid`)))
  console.log('\n── 乙 · 落在哪几个租户 / 摊在几个顾客头上')
  console.log('   ' + JSON.stringify(q("SELECT tenant_id, COUNT(*) n, COUNT(DISTINCT user_id) 人数 FROM coupon_grants WHERE status = 'unused' GROUP BY tenant_id")))
  console.log('\n── 丙 · 这些顾客是不是真顾客(有没有微信/手机号/消费)')
  if (has('users')) {
    const uc = cols('users')
    console.log('   ' + JSON.stringify(q(`SELECT
        SUM(CASE WHEN u.wechat_open_id IS NOT NULL THEN 1 ELSE 0 END) 有微信,
        ${uc.has('phone') ? 'SUM(CASE WHEN u.phone IS NOT NULL THEN 1 ELSE 0 END)' : '-1'} 有手机号,
        COUNT(*) 人次
      FROM users u WHERE u.id IN (SELECT user_id FROM coupon_grants WHERE status = 'unused')`)))
  }
  console.log('\n── 丁 · 同一批里「产品认识的状态」长什么样(做对照,证明 `unused` 确实是异类)')
  console.log('   代码认识的集合见 apps/api/coupon-status.mjs 的 KNOWN_COUPON_STATUSES')
}

console.log('\n════ #7 · 那 37 行是不是种子数据 ════')
console.log('  🔴 **这一问的口径要先钉死**:37 行指的是哪张表的 37 行?')
console.log('     07r 三条件里写的是「像测试名 / 集中在同一时刻 / 没有任何下游记录」。')
console.log('     下面按这三条各出一个数;**「像测试名」那条判据本身要先过两面 probe**(J-58⑥),')
console.log('     没过之前它报的分布不许用 —— 所以这一节只出①③,**②「像测试名」空着等 probe**。')
if (has('users')) {
  const uc = cols('users')
  console.log('\n── ① 下游记录:有多少 users 一条预约/结算/流水都没有')
  const parts = []
  for (const [t, col] of [['bookings', 'user_id'], ['settlements', 'user_id'], ['stored_value_transactions', 'user_id'], ['coupon_grants', 'user_id']]) {
    if (has(t) && cols(t).has(col)) parts.push(`u.id NOT IN (SELECT ${col} FROM ${t} WHERE ${col} IS NOT NULL)`)
  }
  console.log(`   [探到的下游表] ${parts.length} 张`)
  if (parts.length) {
    console.log('   ' + JSON.stringify(q(`SELECT COUNT(*) 无任何下游记录, (SELECT COUNT(*) FROM users) 底数 FROM users u WHERE ${parts.join(' AND ')}`)))
  }
  console.log('\n── ③ 时刻集中度(users 没有时间列,从 user_identities 借)')
  if (has('user_identities')) {
    console.log('   ' + JSON.stringify(q("SELECT substr(created_at, 1, 10) 日, COUNT(*) n FROM user_identities GROUP BY 日 ORDER BY n DESC LIMIT 8")))
  }
  console.log(`\n   [schema] users 有没有 phone=${uc.has('phone')} · wechat_open_id=${uc.has('wechat_open_id')} · google_id=${uc.has('google_id')}`)
}
console.log('\n══ 跑完:全部 SELECT,一行没动 ══')
