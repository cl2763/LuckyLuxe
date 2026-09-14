#!/usr/bin/env node
/* 生产库只读五问 · **第三版**(店主 07r 批准 + 五处补丁,2026-09-14)
 *
 * 🔴 只读:全部 `SELECT`,零写语句(append 也是写)。库一律 `{ readOnly: true }` 打开 ——
 *    **引擎层挡住**,不靠自觉。零 CREATE TEMP / 零 ATTACH / 零 PRAGMA 写入 / 零文件落地。
 *
 * 用法:node tools/prod-readonly-five.mjs <库文件绝对路径>
 *
 * 🔴 **内建停下来条件(店主 07r §一⑤)**:先跑问 0b(状态取值分布)。
 *    若 `settlements` 里除 `signed` 外还有别的看起来像「已完成」的值,
 *    或 `coupon_grants` 里除 `active` 外还有别的看起来像「还能用」的值 —— **停下来报,不硬跑问 5**。
 *    理由:**一个写死的状态值配上一张没看过的状态表,就是又一次「按字面比,漂亮地报 0」。**
 */
import { DatabaseSync } from 'node:sqlite'
import { requireTarget } from './db-target.mjs'

/* 🔴 护栏:目标库**必须显式给,不许有默认值**(`db-target-guard ①c/①d` 当场咬住了,咬得对)。
   有人会想「这是只读的,要什么护栏」—— 但那条律治的病根不是「会不会写坏」,
   是**「有默认值,所以打错了不报错」**:只读打错库,报出来的数照样是错库的数,
   而它会被当成生产的答案写进回执。**读错库和写错库,前者更难发现。** */
const DB = requireTarget({ envName: '第 1 个参数 <库文件绝对路径>', value: process.argv[2],
  hint: '(生产 /app/apps/api/local-data/lucky-luxe.sqlite · 本机 apps/api/local-data/…)' })
const db = new DatabaseSync(DB, { readOnly: true })          // 🔴 引擎层只读
const run = (sql) => db.prepare(sql).all()
const show = (title, rows) => {
  console.log(`\n【${title}】`)
  if (!rows.length) { console.log('  (零行)'); return }
  for (const r of rows) console.log('  ' + JSON.stringify(r))
}

/* 手机号归一:去空格 - ( ) + —— 补丁②③ 用到 */
const DIG = (col) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(${col}),' ',''),'-',''),'(',''),')',''),'+','')`

/* ══ 第 0 条 · 指纹(J-38:这一跑对的是哪份数据、什么时候)══ */
const Q0 = `SELECT datetime('now') AS 读数时刻,
       (SELECT COUNT(*) FROM users)    AS users总行,
       (SELECT COUNT(*) FROM bookings) AS bookings总行`

/* ══ 问 0b · 三张表的状态取值分布(补丁⑤,带停下来条件)══ */
const Q0B = `SELECT 'settlements' AS 表, status, COUNT(*) AS 条数 FROM settlements GROUP BY status
  UNION ALL
  SELECT 'coupon_grants', status, COUNT(*) FROM coupon_grants GROUP BY status
  ORDER BY 表, 条数 DESC`

/* ══ 问 1 · 同号多条 —— 三档,每档给「号码数 + 涉及顾客数」(补丁①②)══ */
const Q1 = `WITH n AS (
    SELECT tenant_id, TRIM(phone) AS lit, ${DIG('phone')} AS dig
    FROM users WHERE phone IS NOT NULL AND TRIM(phone) <> '')
  SELECT t.tenant_id, t.有号档案数,
    (SELECT COUNT(*)      FROM (SELECT lit, COUNT(*) c FROM n WHERE n.tenant_id = t.tenant_id GROUP BY lit HAVING c > 1))                                   AS 档1字面_号码数,
    (SELECT COALESCE(SUM(c),0) FROM (SELECT lit, COUNT(*) c FROM n WHERE n.tenant_id = t.tenant_id GROUP BY lit HAVING c > 1))                              AS 档1字面_涉及顾客数,
    (SELECT COUNT(*)      FROM (SELECT dig, COUNT(*) c FROM n WHERE n.tenant_id = t.tenant_id AND dig <> '' GROUP BY dig HAVING c > 1))                     AS 档2去符号_号码数,
    (SELECT COALESCE(SUM(c),0) FROM (SELECT dig, COUNT(*) c FROM n WHERE n.tenant_id = t.tenant_id AND dig <> '' GROUP BY dig HAVING c > 1))                AS 档2去符号_涉及顾客数,
    (SELECT COUNT(*)      FROM (SELECT SUBSTR(dig,-10) t10, COUNT(*) c FROM n WHERE n.tenant_id = t.tenant_id AND dig <> '' GROUP BY t10 HAVING c > 1))     AS 档3后十位_号码数,
    (SELECT COALESCE(SUM(c),0) FROM (SELECT SUBSTR(dig,-10) t10, COUNT(*) c FROM n WHERE n.tenant_id = t.tenant_id AND dig <> '' GROUP BY t10 HAVING c > 1)) AS 档3后十位_涉及顾客数,
    (SELECT COUNT(*) FROM n WHERE n.tenant_id = t.tenant_id AND n.dig = '')                                                                                 AS dig为空的档案数
  FROM (SELECT tenant_id, COUNT(*) AS 有号档案数 FROM n GROUP BY tenant_id) t
  ORDER BY 档3后十位_涉及顾客数 DESC, t.tenant_id`

/* ══ 问 2 · 没有手机号(补丁①:NULL 归到「非导入或未知」)══ */
const Q2 = `SELECT tenant_id,
    COUNT(*) AS 顾客总数,
    SUM(CASE WHEN phone IS NULL OR TRIM(phone) = '' THEN 1 ELSE 0 END) AS 没有手机号,
    SUM(CASE WHEN (phone IS NULL OR TRIM(phone) = '') AND is_migrated = 1 THEN 1 ELSE 0 END) AS 没号_导入,
    SUM(CASE WHEN (phone IS NULL OR TRIM(phone) = '') AND (is_migrated IS NULL OR is_migrated <> 1) THEN 1 ELSE 0 END) AS 没号_非导入或未知,
    SUM(CASE WHEN is_migrated IS NULL THEN 1 ELSE 0 END) AS is_migrated为空的行数,
    SUM(CASE WHEN wechat_open_id IS NOT NULL AND wechat_open_id <> '' THEN 1 ELSE 0 END) AS 已绑微信
  FROM users GROUP BY tenant_id ORDER BY 没有手机号 DESC`

const Q3A = `SELECT tenant_id, COUNT(*) AS 预约总数 FROM bookings GROUP BY tenant_id ORDER BY 预约总数 DESC`
const Q3B = `SELECT tenant_id, status, COUNT(*) AS 条数 FROM bookings GROUP BY tenant_id, status ORDER BY tenant_id, 条数 DESC`

/* ══ 问 4 · 有余额的人(补丁③:同号多条给档1 + 档3 两列;补丁⑥ 余额为负单列)══ */
const Q4 = `WITH b AS (
    SELECT u.id, u.tenant_id, TRIM(u.phone) AS lit, ${DIG('u.phone')} AS dig,
      (SELECT COALESCE(SUM(s.amount_cents),0) FROM stored_value_transactions s
        WHERE s.user_id = u.id AND s.tenant_id = u.tenant_id) AS bal
    FROM users u)
  SELECT b.tenant_id,
    SUM(CASE WHEN b.bal > 0 THEN 1 ELSE 0 END) AS 有余额的顾客数,
    SUM(CASE WHEN b.bal > 0 THEN b.bal ELSE 0 END) AS 余额合计分,
    SUM(CASE WHEN b.bal > 0 AND (b.lit IS NULL OR b.lit = '') THEN 1 ELSE 0 END) AS 有余额_没手机号,
    SUM(CASE WHEN b.bal > 0 AND b.lit <> '' AND (SELECT COUNT(*) FROM b b2
          WHERE b2.tenant_id = b.tenant_id AND b2.lit = b.lit) > 1 THEN 1 ELSE 0 END) AS 有余额_同号多条_档1字面,
    SUM(CASE WHEN b.bal > 0 AND b.dig <> '' AND (SELECT COUNT(*) FROM b b2
          WHERE b2.tenant_id = b.tenant_id AND b2.dig <> '' AND SUBSTR(b2.dig,-10) = SUBSTR(b.dig,-10)) > 1 THEN 1 ELSE 0 END) AS 有余额_同号多条_档3后十位,
    SUM(CASE WHEN b.bal < 0 THEN 1 ELSE 0 END) AS 余额为负的顾客数,
    SUM(CASE WHEN b.bal < 0 THEN b.bal ELSE 0 END) AS 负余额合计分
  FROM b GROUP BY b.tenant_id ORDER BY 有余额的顾客数 DESC`

/* ══ 问 5 · 有卡包 / 有积分的人 ══
   补丁④:`CAST(... AS INTEGER) / 100` —— 不依赖「列碰巧是 INTEGER」
   补丁③:同号多条给档1 + 档3 两列 */
const Q5 = `WITH c AS (
    SELECT u.id, u.tenant_id, TRIM(u.phone) AS lit, ${DIG('u.phone')} AS dig,
      (SELECT COUNT(*) FROM coupon_grants g
        WHERE g.user_id = u.id AND g.tenant_id = u.tenant_id AND g.status = 'active') AS 券数,
      (SELECT COALESCE(SUM(CAST(st.subtotal_cents AS INTEGER) / 100),0) FROM settlements st
        WHERE st.user_id = u.id AND st.tenant_id = u.tenant_id AND st.status = 'signed')
      + (SELECT COALESCE(SUM(p.amount),0) FROM points_transactions p
        WHERE p.user_id = u.id AND p.tenant_id = u.tenant_id) AS 积分
    FROM users u)
  SELECT c.tenant_id,
    SUM(CASE WHEN c.券数 > 0 THEN 1 ELSE 0 END) AS 有卡包的顾客数,
    SUM(CASE WHEN c.券数 > 0 AND (c.lit IS NULL OR c.lit = '') THEN 1 ELSE 0 END) AS 卡包_没手机号,
    SUM(CASE WHEN c.券数 > 0 AND c.lit <> '' AND (SELECT COUNT(*) FROM c c2
          WHERE c2.tenant_id = c.tenant_id AND c2.lit = c.lit) > 1 THEN 1 ELSE 0 END) AS 卡包_同号多条_档1字面,
    SUM(CASE WHEN c.券数 > 0 AND c.dig <> '' AND (SELECT COUNT(*) FROM c c2
          WHERE c2.tenant_id = c.tenant_id AND c2.dig <> '' AND SUBSTR(c2.dig,-10) = SUBSTR(c.dig,-10)) > 1 THEN 1 ELSE 0 END) AS 卡包_同号多条_档3后十位,
    SUM(CASE WHEN c.积分 > 0 THEN 1 ELSE 0 END) AS 有积分的顾客数,
    SUM(CASE WHEN c.积分 > 0 AND (c.lit IS NULL OR c.lit = '') THEN 1 ELSE 0 END) AS 积分_没手机号,
    SUM(CASE WHEN c.积分 > 0 AND c.lit <> '' AND (SELECT COUNT(*) FROM c c2
          WHERE c2.tenant_id = c.tenant_id AND c2.lit = c.lit) > 1 THEN 1 ELSE 0 END) AS 积分_同号多条_档1字面,
    SUM(CASE WHEN c.积分 > 0 AND c.dig <> '' AND (SELECT COUNT(*) FROM c c2
          WHERE c2.tenant_id = c.tenant_id AND c2.dig <> '' AND SUBSTR(c2.dig,-10) = SUBSTR(c.dig,-10)) > 1 THEN 1 ELSE 0 END) AS 积分_同号多条_档3后十位
  FROM c GROUP BY c.tenant_id ORDER BY 有积分的顾客数 DESC`

console.log(`库:${DB}`)
console.log('打开方式:new DatabaseSync(path, { readOnly: true }) —— 引擎层只读')
show('0 指纹(J-38)', run(Q0))

/* ── 问 0b 先跑,带停下来条件 ── */
const st = run(Q0B)
show('0b 状态取值分布(补丁⑤)', st)
const SETTLE_LIKE_DONE = /^(settled|closed|completed|done|finished|paid)$/i
const GRANT_LIKE_USABLE = /^(valid|usable|issued|granted|unused|pending)$/i
const sus = st.filter((r) => (r['表'] === 'settlements' && r.status !== 'signed' && SETTLE_LIKE_DONE.test(String(r.status || '')))
  || (r['表'] === 'coupon_grants' && r.status !== 'active' && GRANT_LIKE_USABLE.test(String(r.status || ''))))
if (sus.length) {
  console.log('\n🔴 **撞上内建停下来条件(店主 07r §一⑤)** —— 状态表里有别的看起来像「已完成 / 还能用」的值:')
  for (const r of sus) console.log(`   ${r['表']}.status = '${r.status}' × ${r.条数}`)
  console.log('   **问 5 没跑** —— 一个写死的状态值配上一张没看过的状态表,就是又一次「按字面比,漂亮地报 0」。')
  console.log('   等店主裁口径再跑。')
}

show('1 同号多条 · 三档(号码数 + 涉及顾客数)', run(Q1))
show('2 没有手机号', run(Q2))
show('3a 预约总数', run(Q3A))
show('3b 预约按状态', run(Q3B))
show('4 有余额的人(同号多条给档1+档3)', run(Q4))
if (!sus.length) show('5 有卡包 / 有积分的人(同号多条给档1+档3)', run(Q5))
else console.log('\n【5 有卡包 / 有积分的人】⛔ **按停下来条件未跑**(见上)')

db.close()
console.log(`\n跑了 ${sus.length ? 7 : 8} 条语句,**全部 SELECT,零写语句**。`)
