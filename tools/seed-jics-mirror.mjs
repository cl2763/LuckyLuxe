/* 沙箱 `jics-store` 造成小婕店的镜像(店主 05n §二;造景红线)
 *
 * 🔴 为什么必须造:沙箱里 `jics-store` 的地址、币种与旗舰店**一字不差**
 * (都是「多伦多 Veterans Place 136 号」/ CAD)。于是「A 店地址不许出现在 B 店」
 * 这类隔离判据在它身上**永远绿** —— 不是防线在,是刀砍空。
 * 两店事实相同的时候,「两店各跑」什么也证明不了。
 *
 * 只改 `jics-store` 一个租户的**门面事实**;金额一分不动(补二 §二.1「不换算」),
 * 币种只是标签(D140 已收口:钱数由 `stores.currency` 决定怎么显示)。
 *
 * 用法:JM_DB=<沙箱库绝对路径> node tools/seed-jics-mirror.mjs [--write]
 * 不带 --write 只预演(打印将要改什么),带了才落库。
 */
import { DatabaseSync } from 'node:sqlite'
import { requireTarget } from './db-target.mjs'

const DB = requireTarget({
  envName: 'JM_DB=<沙箱库绝对路径>',
  value: process.env.JM_DB,
  hint: '(只许沙箱 apps/api/sandbox-data/lucky-luxe.sqlite;本机库与生产一律不许)',
})
const WRITE = process.argv.includes('--write')
const TID = 'jics-store'

/* 小婕店的门面:与旗舰店**无一字重合**(这正是判据要验的) */
const FACTS = {
  address: '北京市朝阳区望京SOHO T2 座 1508',
  currency: 'CNY',
  brandName: "Jie's Nail 小婕",
  assistantName: '小婕预约助手',
}

const db = new DatabaseSync(DB)
const before = {
  store: db.prepare('SELECT currency, address FROM stores WHERE tenant_id = ?').get(TID),
  kb: Object.fromEntries(db.prepare('SELECT key, value FROM tenant_kb_facts WHERE tenant_id = ?').all(TID).map((r) => [r.key, r.value])),
}
console.log('库:', DB)
console.log('改前:', JSON.stringify(before, null, 0))

if (!WRITE) {
  console.log('预演模式(没写)。要落库加 --write')
  process.exit(0)
}

const now = new Date().toISOString()
db.exec('BEGIN IMMEDIATE')
try {
  /* `stores` 没有 updated_at 列(现查:id/name/address/phone/timezone/currency/is_active/tenant_id/name_en)——
     照库里真有的列写,不按记忆写。 */
  db.prepare('UPDATE stores SET currency = ?, address = ? WHERE tenant_id = ?')
    .run(FACTS.currency, FACTS.address, TID)
  /* 知识库那几条:有就更新、没有就补(D141 未收口前手工与 stores 对齐) */
  const put = (key, value) => {
    const has = db.prepare('SELECT 1 FROM tenant_kb_facts WHERE tenant_id = ? AND key = ?').get(TID, key)
    if (has) db.prepare('UPDATE tenant_kb_facts SET value = ?, updated_at = ? WHERE tenant_id = ? AND key = ?').run(value, now, TID, key)
    /* tenant_kb_facts 列是 tenant_id/key/value/updated_by/updated_at,没有 created_at */
    else db.prepare('INSERT INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)').run(TID, key, value, '05n-mirror', now)
  }
  put('storeAddress', FACTS.address)
  put('currency', FACTS.currency)      // 废弃键(D140 读口已断),对齐只为免得看着打架
  put('brandName', FACTS.brandName)
  put('assistantName', FACTS.assistantName)
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}

const after = {
  store: db.prepare('SELECT currency, address FROM stores WHERE tenant_id = ?').get(TID),
  kb: Object.fromEntries(db.prepare('SELECT key, value FROM tenant_kb_facts WHERE tenant_id = ?').all(TID).map((r) => [r.key, r.value])),
}
console.log('改后:', JSON.stringify(after, null, 0))

/* 造景的意义就在「两店不再相同」—— 当场自证,不留给下一步猜 */
const flag = db.prepare("SELECT value FROM tenant_kb_facts WHERE tenant_id='lucky-luxe' AND key='storeAddress'").get()?.value || ''
const mine = after.kb.storeAddress || ''
const overlap = [...new Set(mine)].filter((ch) => flag.includes(ch) && /[一-鿿 A-Za-z0-9]/.test(ch))
console.log(JSON.stringify({
  两店地址是否相同: flag === mine,
  旗舰店地址: flag,
  小婕镜像地址: mine,
  重合字符数: overlap.length,
}, null, 0))
db.close()
