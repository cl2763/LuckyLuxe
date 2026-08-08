/* 核对财务密码门禁在生产上的实际状态(店主 2026-08-08 口径)。
   ① 默认关闭,全商户一律;③ Jie'Nail 必须是关闭;④ 旗舰店保持现状(开着)。
   只读,不改任何配置。用平台主钥匙调,钥匙从环境变量读,不落盘不打印。

   用法:OWNER_TOKEN=... node tools/verify-finance-lock.mjs [baseUrl] */
const BASE = process.argv[2] || 'https://www.luckyluxeatelier.com'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN
if (!TOKEN) {
  console.error('缺少 OWNER_TOKEN 环境变量(不要写进文件,临时 export 即可)')
  process.exit(1)
}

async function get(path, tenantId) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(tenantId ? { 'x-admin-tenant-id': tenantId } : {})
    }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 160) } }
  return { status: res.status, data }
}

const EXPECTED = {
  'lucky-luxe': true,   // 旗舰店:现状是开着的,不动
  'jics-nail': false    // Jie'Nail:必须关闭(她不需要,哪天要用她自己开)
}
/* 迁移只把「本实例的 DEFAULT_TENANT_ID」置为开,其余一律关。
   本机跑回归时 tenant-isolation 会起一个 DEFAULT_TENANT_ID=tenant-iso-b 的实例,
   那个库里 tenant-iso-b 就成了它自己的「旗舰店」→ 本机看到它是开的属正常残留,
   生产只有一个实例、DEFAULT_TENANT_ID=lucky-luxe,不会有这种情况。 */
const LOCAL_TEST_TENANTS = /^(tenant-iso-b|p\d|p0hy|demo-)/

async function main() {
  const billing = await get('/platform/billing')
  if (billing.status !== 200) {
    console.error(`拿不到商户列表(${billing.status}):`, JSON.stringify(billing.data).slice(0, 200))
    process.exit(1)
  }
  const tenants = billing.data.tenants || []
  let bad = 0
  console.log(`商户数:${tenants.length}\n`)
  for (const t of tenants) {
    const r = await get('/admin/finance/lock-settings', t.id)
    if (r.status !== 200) { console.log(`?  ${t.id.padEnd(16)} 读不到(${r.status})`); bad += 1; continue }
    const enabled = Boolean(r.data.enabled)
    const want = Object.prototype.hasOwnProperty.call(EXPECTED, t.id) ? EXPECTED[t.id] : false
    if (enabled !== want && LOCAL_TEST_TENANTS.test(t.id)) {
      console.log(`~  ${t.id.padEnd(16)} 门禁=${enabled ? '开' : '关'}(本机回归残留,忽略)`)
      continue
    }
    const ok = enabled === want
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'}  ${t.id.padEnd(16)} 门禁=${enabled ? '开' : '关'} 期望=${want ? '开' : '关'}  ${t.name || ''}`)
  }
  console.log(bad ? `\n✗ 有 ${bad} 家与口径不符` : '\n✓ 全部符合口径:默认关闭,仅旗舰店保持开启')
  process.exit(bad ? 1 : 0)
}

main().catch((error) => { console.error(error.message); process.exit(1) })
