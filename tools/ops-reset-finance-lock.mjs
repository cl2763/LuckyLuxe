/* 平台侧清除某商家的财务密码(「忘记密码找平台」的标准路径)。
   设计成在**生产容器内**跑:平台钥匙从容器的环境变量读,不经过本机、不落盘、不打印。

   用法(容器内):node tools/ops-reset-finance-lock.mjs <tenantId> [原因]
   只读预览:  node tools/ops-reset-finance-lock.mjs <tenantId> --dry-run

   跑完会打印重置前后的状态与那一行操作日志,便于回传核对。 */
const [, , tenantIdArg, ...rest] = process.argv
const DRY = rest.includes('--dry-run')
const reason = rest.filter((a) => a !== '--dry-run').join(' ') || '店主忘记财务密码,平台侧重置'
const tenantId = String(tenantIdArg || '').trim()
if (!tenantId) {
  console.error('用法: node tools/ops-reset-finance-lock.mjs <tenantId> [原因] [--dry-run]')
  process.exit(1)
}
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN
if (!TOKEN) {
  console.error('容器里没有 OWNER_TOKEN,拒绝继续(不要把钥匙写进命令行)')
  process.exit(1)
}
const BASE = process.env.OPS_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`

async function call(path, options = {}, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...extraHeaders, ...(options.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 200) } }
  return { status: res.status, data }
}

const readState = () => call('/admin/finance/lock-settings', {}, { 'x-admin-tenant-id': tenantId })

async function main() {
  const before = await readState()
  if (before.status !== 200) {
    console.error(`读不到 ${tenantId} 的状态(${before.status}):`, JSON.stringify(before.data).slice(0, 200))
    process.exit(1)
  }
  console.log(`重置前 ${tenantId}: 门禁=${before.data.enabled ? '开' : '关'} 有密码=${before.data.configured ? '是' : '否'}`)
  if (DRY) { console.log('--dry-run:只读,没有改动任何东西'); return }

  const done = await call(`/platform/tenants/${encodeURIComponent(tenantId)}/finance-lock/reset`, {
    method: 'POST', body: JSON.stringify({ reason })
  })
  if (done.status !== 200) {
    console.error(`重置失败(${done.status}):`, JSON.stringify(done.data).slice(0, 300))
    process.exit(1)
  }
  const after = await readState()
  console.log(`重置后 ${tenantId}: 门禁=${after.data.enabled ? '开' : '关'} 有密码=${after.data.configured ? '是' : '否'}`)
  console.log(`原来有密码吗:${done.data.hadPassword ? '有(已清空)' : '没有(本次为空操作)'}`)

  const logs = await call('/platform/ops-log')
  const line = (logs.data.logs || []).find((l) => l.tenant_id === tenantId && l.action === 'finance_lock_reset')
  console.log('操作日志:', line ? `${line.created_at} · ${line.operator} · ${line.detail}` : '(没读到,请检查 /platform/ops-log)')

  const ok = after.data.enabled === false && after.data.configured === false
  console.log(ok ? '\n✓ 已清空财务密码并关闭门禁,商家侧现在显示「未启用(默认)」' : '\n✗ 状态与预期不符,请人工复核')
  process.exit(ok ? 0 : 1)
}

main().catch((error) => { console.error(error.message); process.exit(1) })
