// 清理冒烟残留会话(仅限白名单 id,店主 2026-08-04 授权)
//
// 用法(在生产容器内 / 或本机指定 DB 路径):
//   node --experimental-sqlite apps/api/tools/purge-smoke-conversations.mjs            # 只打印,不删(默认 dry-run)
//   node --experimental-sqlite apps/api/tools/purge-smoke-conversations.mjs --apply    # 真正删除
//   DB_FILE=/path/to.sqlite node --experimental-sqlite ... --apply                     # 指定库
//
// 安全设计:
//   1) 只删下面 TARGET_IDS 白名单里的 id,精确 `IN (?,?,?)` 匹配,绝不模糊匹配、绝不按前缀删;
//   2) 默认 dry-run,必须显式 --apply 才写库;
//   3) 删除前后各打印一次全表行数与命中行,便于核对;
//   4) 关联表逐个按同一批 id 清理孤儿行;表不存在或无该列时跳过并说明。

import { DatabaseSync } from 'node:sqlite'

const TARGET_IDS = ['wecom:不存在', 'wecom:smoke-b2', 'wecom:smoke-probe']
const RELATED_TABLES = [
  'ai_conversation_states',
  'ai_learning_examples',
  'ai_response_feedback',
  'booking_drafts',
  'quote_requests',
  'reminder_tasks',
]

const DB_FILE = process.env.DB_FILE || '/app/apps/api/local-data/lucky-luxe.sqlite'
const APPLY = process.argv.includes('--apply')
const ph = TARGET_IDS.map(() => '?').join(',')

const db = new DatabaseSync(DB_FILE)
const count = (t, where = '', args = []) => {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${t}${where}`).get(...args).n
  } catch (e) {
    return `<${e.message.slice(0, 60)}>`
  }
}

console.log(`库: ${DB_FILE}`)
console.log(`模式: ${APPLY ? '★ APPLY(真实删除)' : 'dry-run(只打印)'}`)
console.log(`白名单 id(仅这 ${TARGET_IDS.length} 个): ${TARGET_IDS.join(' , ')}`)

console.log('\n=== 删除前 ===')
console.log(`wechat_conversations 全表行数: ${count('wechat_conversations')}`)
const hits = db
  .prepare(`SELECT id, status, created_at FROM wechat_conversations WHERE id IN (${ph})`)
  .all(...TARGET_IDS)
console.log(`命中待删: ${hits.length} 行`)
hits.forEach((r) => console.log(`  ✓ ${r.id} | ${r.status} | ${r.created_at}`))
TARGET_IDS.filter((id) => !hits.some((h) => h.id === id)).forEach((id) =>
  console.log(`  – ${id}(库中不存在,跳过)`)
)
console.log('关联表命中:')
for (const t of RELATED_TABLES) {
  console.log(`  ${t}: ${count(t, ` WHERE conversation_id IN (${ph})`, TARGET_IDS)} / 全表 ${count(t)}`)
}

if (!APPLY) {
  console.log('\n(dry-run 结束,未做任何写入。确认无误后加 --apply 执行。)')
  db.close()
  process.exit(0)
}

console.log('\n=== 执行删除 ===')
db.exec('BEGIN IMMEDIATE')
try {
  for (const t of RELATED_TABLES) {
    try {
      const r = db.prepare(`DELETE FROM ${t} WHERE conversation_id IN (${ph})`).run(...TARGET_IDS)
      if (r.changes) console.log(`  ${t}: 删除 ${r.changes} 行`)
    } catch (e) {
      console.log(`  ${t}: 跳过(${e.message.slice(0, 60)})`)
    }
  }
  const main = db.prepare(`DELETE FROM wechat_conversations WHERE id IN (${ph})`).run(...TARGET_IDS)
  console.log(`  wechat_conversations: 删除 ${main.changes} 行`)
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  console.error('删除失败,已回滚:', e.message)
  db.close()
  process.exit(1)
}

console.log('\n=== 删除后 ===')
console.log(`wechat_conversations 全表行数: ${count('wechat_conversations')}`)
console.log(
  `白名单残留(应为 0): ${count('wechat_conversations', ` WHERE id IN (${ph})`, TARGET_IDS)}`
)
for (const t of RELATED_TABLES) {
  console.log(`  ${t} 残留: ${count(t, ` WHERE conversation_id IN (${ph})`, TARGET_IDS)}`)
}
db.close()
console.log('\n完成。')
