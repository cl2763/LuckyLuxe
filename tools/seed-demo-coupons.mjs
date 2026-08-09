/* 本地演示数据:给两店的演示顾客各发一张「特批券」+ 一张「模板券」,
   供店主走通 选券 → 签字 → 核销 → 券账明细 这条链(2026-08-09 券批交付要求)。

   只走正规 API(/admin/coupons、/admin/coupon-grants/custom),
   所以发放人/原因/券流水的留痕与真实操作一模一样,不是直接写库造数据。
   幂等:同名券模板已存在就复用;同一位顾客已经有同名的 active 券就跳过。

   用法(默认本机 4128):
     node tools/seed-demo-coupons.mjs
   平台主钥匙从 apps/api/.env 的 OWNER_DEMO_TOKEN 读,不落盘、不打印。 */
import { readFileSync } from 'node:fs'

const BASE = process.env.SEED_BASE_URL || 'http://127.0.0.1:4128'
const envLine = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  .split('\n').find((l) => l.startsWith('OWNER_DEMO_TOKEN='))
if (!envLine) throw new Error('apps/api/.env 里没有 OWNER_DEMO_TOKEN')
const TOKEN = envLine.slice('OWNER_DEMO_TOKEN='.length).trim().replace(/^["']|["']$/g, '')

async function api(tenantId, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      'x-admin-tenant-id': tenantId,
      ...(options.headers || {})
    }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}

const STORES = ['lucky-luxe', 'jics-nail']
// 演示顾客按手机号找(两店的演示档案是同一批号码)
const DEMO_PHONES = ['13800000001', '13800000002']

for (const tenantId of STORES) {
  console.log(`\n== ${tenantId} ==`)
  // 1) 券模板:满 300 减 30(没有就建)
  const list = await api(tenantId, '/admin/coupons')
  let tpl = (list.coupons || []).find((c) => c.name === '满300减30')
  if (!tpl) {
    tpl = (await api(tenantId, '/admin/coupons', {
      method: 'POST',
      body: JSON.stringify({ name: '满300减30', amountCents: 3000, minSpendCents: 30000, validDays: 90 })
    })).coupon
    console.log('  建券模板:满300减30')
  } else {
    console.log('  券模板已存在:满300减30')
  }

  // 2) 找演示顾客
  const grants = (await api(tenantId, '/admin/coupon-grants')).grants || []
  for (const phone of DEMO_PHONES) {
    const hit = (await api(tenantId, `/admin/customers?q=${encodeURIComponent(phone)}`)).customers || []
    const customer = hit[0]
    if (!customer) { console.log(`  跳过:没找到手机号 ${phone} 的顾客`); continue }

    const has = (name) => grants.some((g) => g.userId === customer.id && g.name === name && g.status === 'active')
    // 券名不带币种符号 —— 旗舰店是 CAD,写死「¥50」会和金额列自相矛盾

    if (has('无门槛补偿券')) {
      console.log(`  ${customer.displayName}:特批券已有,跳过`)
    } else {
      await api(tenantId, '/admin/coupon-grants/custom', {
        method: 'POST',
        body: JSON.stringify({
          userId: customer.id, amountCents: 5000, minSpendCents: 0, validDays: 60,
          name: '无门槛补偿券', reason: '上次服务补偿(演示数据)'
        })
      })
      console.log(`  ${customer.displayName}:发了特批券 无门槛补偿券`)
    }

    if (has('满300减30')) {
      console.log(`  ${customer.displayName}:模板券已有,跳过`)
    } else {
      await api(tenantId, '/admin/coupon-grants/custom', {
        method: 'POST',
        body: JSON.stringify({ userId: customer.id, mode: 'template', couponId: tpl.id, validDays: 90, reason: '充值¥1000档赠送(演示数据)' })
      })
      console.log(`  ${customer.displayName}:发了模板券 满300减30`)
    }
  }
}

console.log('\n完成。到 会员套餐/券 → 自定义发放 看发放记录;结算开单时定金行下方就能选券。')
