// 平台手动 AI 覆盖；不改套餐/试用授权。当前值在 tenant_settings，每次修改留追加运维日志。
const KEY = 'ai_manual_override'
export function readAiManualOverride(db, tenantId) {
  const row = db.prepare('SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?').get(tenantId, KEY)
  if (!row) return null
  const value = JSON.parse(row.value)
  if (typeof value.enabled !== 'boolean') throw new Error('AI 手动覆盖记录损坏')
  if (value.expiresAt && !Number.isFinite(new Date(value.expiresAt).getTime())) throw new Error('AI 手动覆盖到期时间损坏')
  const expired = Boolean(value.expiresAt && new Date(value.expiresAt).getTime() <= Date.now())
  return { ...value, enabled: value.enabled && !expired, expired, source: 'manual' }
}
export function writeAiManualOverride({ db, tenantId, body, operator, apiError, writeLog }) {
  if (typeof body.enabled !== 'boolean') throw apiError(400, 'BAD_REQUEST', 'AI 开关必须是布尔值。')
  const reason = String(body.reason || '').trim()
  if (!reason) throw apiError(400, 'BAD_REQUEST', '请填写修改 AI 开关的原因。')
  const expiresAt = body.enabled && body.expiresAt ? new Date(body.expiresAt) : null
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw apiError(400, 'BAD_REQUEST', '到期时间须晚于现在。')
  const value = { enabled: body.enabled, expiresAt: expiresAt?.toISOString() || null, operator, reason: reason.slice(0, 300), updatedAt: new Date().toISOString() }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('INSERT INTO tenant_settings (tenant_id,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
      .run(tenantId, KEY, JSON.stringify(value), value.updatedAt)
    writeLog(tenantId, 'ai_manual_override', `${value.enabled ? '开启' : '关闭'} AI；到期：${value.expiresAt || '长期'}；原因：${value.reason}`, operator)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return value
}
