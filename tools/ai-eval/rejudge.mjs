/* 拿修好的刀,把**已经跑出来的 80 条回复**重判一遍 —— 不用再打 80 次模型。
   注:这里重判的是「判据」,不是「行为」;行为数据是那一次真跑出来的,没动过。 */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { requireTarget } from '../db-target.mjs'
import { makeLines } from './run-edge-80.mjs'

const db = new DatabaseSync(requireTarget({
  envName: 'GATE_DB=<库文件绝对路径>',
  value: process.env.GATE_DB,
  /* 🔴 造景/评测脚本不许有默认目标库(店主立):没写就报错,不许猜。
     这里虽然是 readOnly,护栏照样要接 —— 「读的是哪个库」同样要自报,
     而且今天只读不等于明天不写。 */
  hint: '(评测只打沙箱 apps/api/sandbox-data/lucky-luxe.sqlite)',
}), { readOnly: true })
const staffNames = [
  ...db.prepare("SELECT DISTINCT name FROM technicians WHERE name IS NOT NULL AND length(name) >= 2").all().map((r) => r.name),
  ...db.prepare("SELECT DISTINCT display_name FROM admin_accounts WHERE display_name IS NOT NULL AND length(display_name) >= 2").all().map((r) => r.display_name),
].filter((n, i, a) => a.indexOf(n) === i)
const listPrices = new Set([
  ...db.prepare('SELECT price_cents c FROM services WHERE price_cents > 0').all(),
  ...db.prepare('SELECT price_cents c FROM member_timecards WHERE price_cents > 0').all(),
  ...db.prepare('SELECT price_cents c FROM membership_packages WHERE price_cents > 0').all(),
  ...db.prepare('SELECT bonus_cents c FROM membership_packages WHERE bonus_cents > 0').all(),
  ...db.prepare('SELECT amount_cents c FROM recharge_tiers WHERE amount_cents > 0').all(),
].map((r) => Math.round(r.c / 100)))
const LINES = makeLines(staffNames, listPrices)

const { rows } = JSON.parse(readFileSync(process.env.GATE_EDGE_OUT, 'utf8'))
const breaches = []
for (const r of rows) {
  for (const [line, knife] of Object.entries(LINES)) {
    const why = knife(r.say, r.text, r.handoff)
    if (why) breaches.push({ line, group: r.group, say: r.say, why, text: r.text.slice(0, 160) })
  }
}
const byGroup = {}
for (const r of rows) byGroup[r.group] = (byGroup[r.group] || 0) + 1
console.log(JSON.stringify({
  总数: rows.length, 分组: byGroup,
  静默: rows.filter((r) => r.silent).length,
  转人工: rows.filter((r) => r.handoff).length,
  安全四线破口: breaches.length, 破口: breaches,
}, null, 2))
