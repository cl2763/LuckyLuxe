/* 生产库只读五问 · **管道版**(夜12 段E,2026-09-14)
 *
 * 为什么是这一份:容器上**没有 sqlite3**,但 `node --experimental-sqlite` 现成 ——
 * 用 `new DatabaseSync(path, { readOnly: true })` 是**同一个引擎层只读标志**,
 * 而且**不需要往生产上装任何东西、不落任何文件**(经 `node -` 从 stdin 读进去执行)。
 *
 * 🔴 三个条件(夜12 段E,少一个不跑):
 *   ①只读标志**显式传**,不靠默认;
 *   ②目标库**显式给**,不许有默认值(J-64);
 *   ③跑之前先打印**打开的是哪个文件的绝对路径 + 大小 + mtime**,对不上就停。
 *
 * 🔴 J-64:**读也要认库。** 报数必须同时报「读的是哪个库」的绝对路径 + 指纹。
 *    读错库不留痕迹,只留一个错的答案 —— 而那个答案长得跟对的一模一样。
 */
const { DatabaseSync } = require('node:sqlite')
const { statSync } = require('node:fs')

const DB = process.argv[2] || process.env.FIVE_DB || ''
if (!DB) { console.error('🔴 拒绝执行:没有显式指定目标库(J-64:目标库必须显式给,不许有默认值)'); process.exit(2) }
const st = statSync(DB)
console.log('════ 库指纹(J-64:报数必须带库标识)════')
console.log(`  绝对路径:${DB}`)
console.log(`  大小:${st.size}  mtime:${st.mtime.toISOString()}`)

const db = new DatabaseSync(DB, { readOnly: true })   // ① 引擎层只读,显式传
const run = (sql) => db.prepare(sql).all()
const show = (t, rows) => { console.log(`\n【${t}】`); if (!rows.length) return console.log('  (零行)'); for (const r of rows) console.log('  ' + JSON.stringify(r)) }
const DIG = (c) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(${c}),' ',''),'-',''),'(',''),')',''),'+','')`

show('0 指纹(J-38)', run(`SELECT datetime('now') AS 读数时刻, (SELECT COUNT(*) FROM users) AS users总行, (SELECT COUNT(*) FROM bookings) AS bookings总行`))

const st0b = run(`SELECT 'settlements' AS 表, status, COUNT(*) AS 条数 FROM settlements GROUP BY status
  UNION ALL SELECT 'coupon_grants', status, COUNT(*) FROM coupon_grants GROUP BY status ORDER BY 表, 条数 DESC`)
show('0b 状态取值分布(补丁⑤)', st0b)
const DONE = /^(settled|closed|completed|done|finished|paid)$/i
const USABLE = /^(valid|usable|issued|granted|unused|pending)$/i
const sus = st0b.filter((r) => (r['表'] === 'settlements' && r.status !== 'signed' && DONE.test(String(r.status || '')))
  || (r['表'] === 'coupon_grants' && r.status !== 'active' && USABLE.test(String(r.status || ''))))
if (sus.length) {
  console.log('\n🔴 **撞上内建停下来条件** —— 状态表里有别的看起来像「已完成 / 还能用」的值:')
  for (const r of sus) console.log(`   ${r['表']}.status = '${r.status}' × ${r.条数}`)
  console.log('   **问 5 不跑**(写死的状态值 + 没看过的状态表 = 又一次「按字面比,漂亮地报 0」)')
}

show('1 同号多条 · 三档(号码数 + 涉及顾客数)', run(`WITH n AS (
    SELECT tenant_id, TRIM(phone) AS lit, ${DIG('phone')} AS dig FROM users WHERE phone IS NOT NULL AND TRIM(phone) <> '')
  SELECT t.tenant_id, t.有号档案数,
    (SELECT COUNT(*) FROM (SELECT lit, COUNT(*) c FROM n WHERE n.tenant_id=t.tenant_id GROUP BY lit HAVING c>1)) AS 档1字面_号码数,
    (SELECT COALESCE(SUM(c),0) FROM (SELECT lit, COUNT(*) c FROM n WHERE n.tenant_id=t.tenant_id GROUP BY lit HAVING c>1)) AS 档1字面_涉及顾客数,
    (SELECT COUNT(*) FROM (SELECT dig, COUNT(*) c FROM n WHERE n.tenant_id=t.tenant_id AND dig<>'' GROUP BY dig HAVING c>1)) AS 档2去符号_号码数,
    (SELECT COALESCE(SUM(c),0) FROM (SELECT dig, COUNT(*) c FROM n WHERE n.tenant_id=t.tenant_id AND dig<>'' GROUP BY dig HAVING c>1)) AS 档2去符号_涉及顾客数,
    (SELECT COUNT(*) FROM (SELECT SUBSTR(dig,-10) t10, COUNT(*) c FROM n WHERE n.tenant_id=t.tenant_id AND dig<>'' GROUP BY t10 HAVING c>1)) AS 档3后十位_号码数,
    (SELECT COALESCE(SUM(c),0) FROM (SELECT SUBSTR(dig,-10) t10, COUNT(*) c FROM n WHERE n.tenant_id=t.tenant_id AND dig<>'' GROUP BY t10 HAVING c>1)) AS 档3后十位_涉及顾客数,
    (SELECT COUNT(*) FROM n WHERE n.tenant_id=t.tenant_id AND n.dig='') AS dig为空的档案数
  FROM (SELECT tenant_id, COUNT(*) AS 有号档案数 FROM n GROUP BY tenant_id) t ORDER BY 档3后十位_涉及顾客数 DESC, t.tenant_id`))

show('2 没有手机号', run(`SELECT tenant_id, COUNT(*) AS 顾客总数,
    SUM(CASE WHEN phone IS NULL OR TRIM(phone)='' THEN 1 ELSE 0 END) AS 没有手机号,
    SUM(CASE WHEN (phone IS NULL OR TRIM(phone)='') AND is_migrated=1 THEN 1 ELSE 0 END) AS 没号_导入,
    SUM(CASE WHEN (phone IS NULL OR TRIM(phone)='') AND (is_migrated IS NULL OR is_migrated<>1) THEN 1 ELSE 0 END) AS 没号_非导入或未知,
    SUM(CASE WHEN is_migrated IS NULL THEN 1 ELSE 0 END) AS is_migrated为空的行数,
    SUM(CASE WHEN wechat_open_id IS NOT NULL AND wechat_open_id<>'' THEN 1 ELSE 0 END) AS 已绑微信
  FROM users GROUP BY tenant_id ORDER BY 没有手机号 DESC`))

show('3a 预约总数', run(`SELECT tenant_id, COUNT(*) AS 预约总数 FROM bookings GROUP BY tenant_id ORDER BY 预约总数 DESC`))
show('3b 预约按状态', run(`SELECT tenant_id, status, COUNT(*) AS 条数 FROM bookings GROUP BY tenant_id, status ORDER BY tenant_id, 条数 DESC`))

show('4 有余额的人(同号多条给档1+档3)', run(`WITH b AS (
    SELECT u.id, u.tenant_id, TRIM(u.phone) AS lit, ${DIG('u.phone')} AS dig,
      (SELECT COALESCE(SUM(s.amount_cents),0) FROM stored_value_transactions s WHERE s.user_id=u.id AND s.tenant_id=u.tenant_id) AS bal
    FROM users u)
  SELECT b.tenant_id,
    SUM(CASE WHEN b.bal>0 THEN 1 ELSE 0 END) AS 有余额的顾客数,
    SUM(CASE WHEN b.bal>0 THEN b.bal ELSE 0 END) AS 余额合计分,
    SUM(CASE WHEN b.bal>0 AND (b.lit IS NULL OR b.lit='') THEN 1 ELSE 0 END) AS 有余额_没手机号,
    SUM(CASE WHEN b.bal>0 AND b.lit<>'' AND (SELECT COUNT(*) FROM b b2 WHERE b2.tenant_id=b.tenant_id AND b2.lit=b.lit)>1 THEN 1 ELSE 0 END) AS 有余额_同号多条_档1字面,
    SUM(CASE WHEN b.bal>0 AND b.dig<>'' AND (SELECT COUNT(*) FROM b b2 WHERE b2.tenant_id=b.tenant_id AND b2.dig<>'' AND SUBSTR(b2.dig,-10)=SUBSTR(b.dig,-10))>1 THEN 1 ELSE 0 END) AS 有余额_同号多条_档3后十位,
    SUM(CASE WHEN b.bal<0 THEN 1 ELSE 0 END) AS 余额为负的顾客数,
    SUM(CASE WHEN b.bal<0 THEN b.bal ELSE 0 END) AS 负余额合计分
  FROM b GROUP BY b.tenant_id ORDER BY 有余额的顾客数 DESC`))

if (!sus.length) {
  show('5 有卡包 / 有积分的人(同号多条给档1+档3)', run(`WITH c AS (
      SELECT u.id, u.tenant_id, TRIM(u.phone) AS lit, ${DIG('u.phone')} AS dig,
        (SELECT COUNT(*) FROM coupon_grants g WHERE g.user_id=u.id AND g.tenant_id=u.tenant_id AND g.status='active') AS 券数,
        (SELECT COALESCE(SUM(CAST(st.subtotal_cents AS INTEGER)/100),0) FROM settlements st WHERE st.user_id=u.id AND st.tenant_id=u.tenant_id AND st.status='signed')
        + (SELECT COALESCE(SUM(p.amount),0) FROM points_transactions p WHERE p.user_id=u.id AND p.tenant_id=u.tenant_id) AS 积分
      FROM users u)
    SELECT c.tenant_id,
      SUM(CASE WHEN c.券数>0 THEN 1 ELSE 0 END) AS 有卡包的顾客数,
      SUM(CASE WHEN c.券数>0 AND (c.lit IS NULL OR c.lit='') THEN 1 ELSE 0 END) AS 卡包_没手机号,
      SUM(CASE WHEN c.券数>0 AND c.lit<>'' AND (SELECT COUNT(*) FROM c c2 WHERE c2.tenant_id=c.tenant_id AND c2.lit=c.lit)>1 THEN 1 ELSE 0 END) AS 卡包_同号多条_档1字面,
      SUM(CASE WHEN c.券数>0 AND c.dig<>'' AND (SELECT COUNT(*) FROM c c2 WHERE c2.tenant_id=c.tenant_id AND c2.dig<>'' AND SUBSTR(c2.dig,-10)=SUBSTR(c.dig,-10))>1 THEN 1 ELSE 0 END) AS 卡包_同号多条_档3后十位,
      SUM(CASE WHEN c.积分>0 THEN 1 ELSE 0 END) AS 有积分的顾客数,
      SUM(CASE WHEN c.积分>0 AND (c.lit IS NULL OR c.lit='') THEN 1 ELSE 0 END) AS 积分_没手机号,
      SUM(CASE WHEN c.积分>0 AND c.lit<>'' AND (SELECT COUNT(*) FROM c c2 WHERE c2.tenant_id=c.tenant_id AND c2.lit=c.lit)>1 THEN 1 ELSE 0 END) AS 积分_同号多条_档1字面,
      SUM(CASE WHEN c.积分>0 AND c.dig<>'' AND (SELECT COUNT(*) FROM c c2 WHERE c2.tenant_id=c.tenant_id AND c2.dig<>'' AND SUBSTR(c2.dig,-10)=SUBSTR(c.dig,-10))>1 THEN 1 ELSE 0 END) AS 积分_同号多条_档3后十位
    FROM c GROUP BY c.tenant_id ORDER BY 有积分的顾客数 DESC`))
} else console.log('\n【5 有卡包 / 有积分的人】⛔ **按停下来条件未跑**')

db.close()
console.log(`\n════ 跑完:${sus.length ? 7 : 8} 条语句,**全部 SELECT,零写语句,零文件落地** ════`)
