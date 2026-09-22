#!/usr/bin/env node
/* 🔴 此脚本永不对生产跑(J-114,店主 2026-09-22 立) —— 它会凭空造出人或钱。 */
/* 段 7b · 给一家店造一张**新客券**(只 INSERT,不改任何既有行)

   为什么要它:D152 要验的三段式(折扣 → 原价 → 折后价)得先有一张真券;
   六通 v4 的通六也要北京店有新客券。**券是从库里现取的**,没有券就不该出现「券后」——
   所以造景必须真造进库,不能在判据里假装有。

   规矩(店主 09-08 夜班令 5 §一.3):写 4128 既有行停;**建券是 INSERT,允许,先备份**。
   · 目标库必须显式给(`tools/db-target.mjs`,不许有默认目标);
   · 写前 `db-backup.mjs`,写前写后各自报一次行数;
   · **幂等按「发过没有」判**,不按「还剩几张」判(幂等判据律:剩余量会被正常业务消耗)。

   用法:SEED_DB=<库绝对路径> SEED_TENANT=luvia-bj node tools/seed-newcomer-coupon.mjs */
import { DatabaseSync } from 'node:sqlite'
import { requireTarget, reportTarget } from './db-target.mjs'

const DB = requireTarget({ envName: 'SEED_DB=<库文件绝对路径>', value: process.env.SEED_DB, hint: '(沙箱 apps/api/sandbox-data/…)' })
const TENANT = requireTarget({ envName: 'SEED_TENANT', value: process.env.SEED_TENANT, hint: '(例 luvia-bj)' })
const NAME = process.env.SEED_COUPON_NAME || '新客首单立减 50'

const before = reportTarget('建新客券 · 写前', DB)
const db = new DatabaseSync(DB)
const store = db.prepare('SELECT id FROM stores WHERE tenant_id = ? AND is_active = 1 LIMIT 1').get(TENANT)
if (!store) { console.error(`\n❌ ${TENANT} 没有在营门店 —— 不给不存在的店建券\n`); process.exit(2) }

/* 幂等:**这张券建过没有**(按名字),不看它还剩几张 */
const had = db.prepare('SELECT id FROM coupons WHERE tenant_id = ? AND name = ?').get(TENANT, NAME)
if (had) {
  console.log(`\n已经有这张券了(${NAME}),一个字不动 —— 幂等按「建过没有」判,不按「还剩几张」判。\n`)
} else {
  db.prepare(`INSERT INTO coupons (id, tenant_id, name, discount_type, amount_cents, percent_off,
      min_spend_cents, valid_days, total_qty, issued_qty, is_active, created_at)
    VALUES (?, ?, ?, 'amount', 5000, 0, 0, 30, 0, 0, 1, ?)`)
    .run(`cpn_newcomer_${TENANT}`, TENANT, NAME, new Date().toISOString())
  console.log(`\n✅ 已建:${TENANT} · 「${NAME}」立减 ¥50 · 不限量 · 30 天有效\n`)
}
db.close()
reportTarget('建新客券 · 写后', DB, before)
