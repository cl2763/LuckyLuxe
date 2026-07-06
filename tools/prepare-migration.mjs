// 迁移前清理:在数据库【副本】上删除模拟器测试产物、剥离学习样本里的 base64 图片,然后 VACUUM 压缩。
// 用法: node tools/prepare-migration.mjs <源sqlite> <输出sqlite>
// 保留: 订单/客户/财务账本/排班/账号/知识库/AI纠偏反馈(ai_response_feedback)/学习样本文本
// 删除: 测试会话(wechat_conversations)/AI会话状态/报价单/预约草稿/提醒任务 —— 真实微信尚未接入,这些 100% 是测试数据
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, statSync } from 'node:fs'

const [src, out] = process.argv.slice(2)
if (!src || !out) { console.error('用法: node tools/prepare-migration.mjs <源sqlite> <输出sqlite>'); process.exit(1) }

copyFileSync(src, out)
const db = new DatabaseSync(out)

const report = []
const count = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c } catch { return 'N/A' } }

// 1. 清空测试产物表(账本类表绝不触碰)
const purgeTables = ['wechat_conversations', 'ai_conversation_states', 'quote_requests', 'booking_drafts', 'reminder_tasks']
for (const t of purgeTables) {
  const before = count(t)
  try { db.exec(`DELETE FROM "${t}"`) } catch (e) { report.push(`${t}: 删除失败 ${e.message}`); continue }
  report.push(`${t}: 清空 ${before} 行`)
}

// 2. ai_learning_examples: 保留文本训练对,剥离 context_json 里的 base64 图片
try {
  const rows = db.prepare('SELECT id, context_json FROM ai_learning_examples').all()
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip).filter((v) => v !== '[图片已剥离]' || true)
    if (value && typeof value === 'object') { for (const k of Object.keys(value)) value[k] = strip(value[k]); return value }
    if (typeof value === 'string' && value.startsWith('data:image')) return '[图片已剥离]'
    return value
  }
  const upd = db.prepare('UPDATE ai_learning_examples SET context_json = ? WHERE id = ?')
  let stripped = 0
  for (const row of rows) {
    try {
      const ctx = JSON.parse(row.context_json || '{}')
      upd.run(JSON.stringify(strip(ctx)), row.id)
      stripped += 1
    } catch { /* 非JSON跳过 */ }
  }
  report.push(`ai_learning_examples: 保留 ${rows.length} 行,剥离图片 ${stripped} 行`)
} catch (e) { report.push(`ai_learning_examples: 处理失败 ${e.message}`) }

// 3. 核心业务数据完整性快照(迁移后云端应完全一致)
const keep = {}
for (const t of ['bookings', 'users', 'finance_transactions', 'stored_value_transactions', 'admin_accounts', 'technicians', 'services', 'tenant_kb_entries', 'ai_response_feedback', 'technician_schedules', 'store_special_dates']) {
  keep[t] = count(t)
}

db.exec('VACUUM')
db.close()

console.log('== 清理报告 ==')
for (const line of report) console.log(' -', line)
console.log('== 保留数据快照(迁移后请在云端核对这些数字) ==')
console.log(JSON.stringify(keep, null, 2))
console.log(`== 体积: ${(statSync(src).size / 1048576).toFixed(1)}MB → ${(statSync(out).size / 1048576).toFixed(1)}MB ==`)
