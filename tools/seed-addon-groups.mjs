/* 裁决④(2026-08-09):加项组名由商家自填,结算表单按它分组。
   这个脚本给两店按设计图屏 1 把组名填好:延长类 / 补甲类(单指计价)/ 卸甲类;
   其余加项留空 → 结算表单里自动归「其他加项」。

   幂等:已经填过组名的项目跳过;只走正规 API(PATCH /admin/pricing/items/:id)。
   用法:node tools/seed-addon-groups.mjs */
import { readFileSync } from 'node:fs'

const BASE = process.env.SEED_BASE_URL || 'http://127.0.0.1:4128'
if (!/127\.0\.0\.1|localhost/.test(BASE)) throw new Error('这个脚本只给本机沙盘用,不要指向生产。')
const envLine = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  .split('\n').find((l) => l.startsWith('OWNER_DEMO_TOKEN='))
const TOKEN = envLine.slice('OWNER_DEMO_TOKEN='.length).trim().replace(/^["']|["']$/g, '')

async function api(tenantId, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tenantId, ...(options.headers || {}) }
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}

/* 按项目名归组(只用来一次性铺演示数据;运行时分组读的是商家填的 addonGroup 字段)。
   卸睫要和卸甲分开 —— 「本店制作免卸睫毛」是美睫的项目,塞进「卸甲类」是错的。
   交付给店主的默认数据必须是对的,不能指望他自己去改。 */
const SEEDED_GROUPS = ['延长类', '补甲类', '卸甲类', '卸睫类']
function groupOf(name) {
  if (/睫/.test(name) && /卸/.test(name)) return '卸睫类'
  if (/卸/.test(name)) return '卸甲类'
  if (/补甲|矫正/.test(name)) return '补甲类'
  if (/甲片|甲膜|水晶|延长/.test(name)) return '延长类'
  return ''
}

for (const tenantId of ['lucky-luxe', 'jics-nail']) {
  console.log(`\n== ${tenantId} ==`)
  const items = (await api(tenantId, '/admin/pricing/items')).items.filter((i) => i.itemKind === 'addon')
  let touched = 0
  for (const it of items) {
    const g = groupOf(it.nameZh || '')
    if (!g) continue
    // 店主自己改过组名的(组名不在本脚本铺的那几个里)一律不动 —— 他的设置优先
    if (it.addonGroup && !SEEDED_GROUPS.includes(it.addonGroup)) continue
    if (it.addonGroup === g) continue
    await api(tenantId, `/admin/pricing/items/${it.id}`, { method: 'PATCH', body: JSON.stringify({ addonGroup: g }) })
    console.log(`  ${it.nameZh} → ${g}${it.addonGroup ? `(原「${it.addonGroup}」纠正)` : ''}`)
    touched += 1
  }
  const after = (await api(tenantId, '/admin/pricing/items')).items.filter((i) => i.itemKind === 'addon')
  const byGroup = {}
  for (const i of after) { const k = i.addonGroup || '其他加项'; byGroup[k] = (byGroup[k] || 0) + 1 }
  console.log(`  本轮填了 ${touched} 个;当前分组:${Object.entries(byGroup).map(([k, v]) => `${k} ${v}`).join(' · ') || '(无加项)'}`)
}
console.log('\n完成。结算开单页的加项目录现在按这些组名分组,没填的归「其他加项」。')
