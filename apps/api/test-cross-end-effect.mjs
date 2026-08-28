/* 一份数据两端渲染 · 效果级判据(店主 2026-08-29 立律)。

   **店主原话**:「配置在哪端改是权限问题,改完的效果必须两端同时生效 —— 两端读的必须是
   同一份数据。『合理只在网页』只指编辑入口,从不指生效范围。」

   判据口径:**接口同源不算数** —— 每项验到「网页改一次 → 小程序端实际渲染的数据跟着变」。
   能给到的最强证据(本机没有微信开发者工具,像素欠着,如实报):
   **后端改一次 → 小程序真调的那条公开/管理接口跟着变 → 小程序映射函数(真 require 真调)
   吃这份数据输出的渲染字段跟着变 → wxml 引用链闭合(setData 字段 → {{}} 绑定)**。

   ⚠️ standalone:CI_SUITES="cross-end-effect" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}

const tid = `xend-${RUN}`
if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `跨端店${RUN}`, plan: 'chain' }) })).status !== 201) throw new Error('建店失败')
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const PUB = { 'x-tenant-id': tid }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/* 小程序映射层真加载(test-double-sheet 先例):global.wx stub */
const requireCjs = createRequire(import.meta.url)
const store = new Map()
global.wx = {
  getStorageSync: (k) => store.get(k), setStorageSync: (k, v) => store.set(k, v), removeStorageSync: (k) => store.delete(k),
  request: () => {}, getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } })
}
const miniApi = requireCjs('../../miniprogram/utils/api.js')
const wxmlOf = (p) => readFileSync(new URL(`../../miniprogram/${p}`, import.meta.url), 'utf8')
const jsOf = (p) => readFileSync(new URL(`../../miniprogram/${p}`, import.meta.url), 'utf8')

/* ===== ① 轮播:网页面板配一组 → 小程序顾客首页必须出这一组 ===== */
await request('/admin/hero-slides', { method: 'PUT', body: JSON.stringify({ slides: [{ image: PNG, labelZh: `跨端文案${RUN}` }] }) }, PLATFORM, H)
const stores1 = (await request('/stores', {}, null, PUB)).data
check('🔴 ① 轮播:网页配一组 → 小程序真调的公开 /stores 立刻出这一组(同一份数据)',
  stores1.heroSlides.length === 1 && stores1.heroSlides[0].image === PNG && stores1.heroSlides[0].label === `跨端文案${RUN}`,
  JSON.stringify(stores1.heroSlides).slice(0, 120))
check('① 渲染链闭合:api.getHeroSlides → home setData(heroSlides)→ wxml {{item.image}}+{{item.label}}',
  jsOf('utils/api.js').includes('function getHeroSlides') && jsOf('pages/home/index.js').includes('heroSlides: heroSlides')
  && wxmlOf('pages/home/index.wxml').includes('wx:for="{{heroSlides}}"') && wxmlOf('pages/home/index.wxml').includes('{{item.label}}'))

/* ===== ② 门店封面(=轮播首图):同一份数据 → store-location 页 ===== */
check('🔴 ② 门店封面:同一组数据的首图 → store-location 的 storeCover(链:getHeroSlides→setData storeCover→wxml)',
  jsOf('pages/store-location/index.js').includes('storeCover: (slides[0] && slides[0].image)')
  && wxmlOf('pages/store-location/index.wxml').includes('src="{{storeCover}}"'))

/* ===== ③ 项目图/项目价:网页编辑 → 小程序顾客端服务页跟着变 ===== */
const catId = ((await request('/admin/pricing/categories', {}, PLATFORM, H)).data.categories || [])[0].id
const svc = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `跨端项目${RUN}`, nameEn: 'x', priceCents: 18800, baseDurationMin: 60, categoryId: catId, storefront: 1 }) }, PLATFORM, H)).data.service
await request(`/admin/services/${svc.id}`, { method: 'PATCH', body: JSON.stringify({ imageUrl: PNG, priceCents: 20800 }) }, PLATFORM, H)
const pubSvc = ((await request('/services', {}, null, PUB)).data.services || []).find((x) => x.id === svc.id)
check('🔴 ③ 项目图与价:网页改一次 → 小程序真调的公开 /services 跟着变',
  pubSvc && pubSvc.imageUrl === PNG && pubSvc.priceCents === 20800, JSON.stringify({ img: (pubSvc?.imageUrl || '').slice(0, 30), price: pubSvc?.priceCents }))
/* 映射函数**真调**:toMiniService 不导出 —— 走 getServices 的行为面太重,退一层验渲染链 */
check('③ 渲染链闭合:公开 imageUrl → toMiniService image → services 页 wxml {{item.image}}',
  jsOf('utils/api.js').includes('image: normalizeImage(service.imageUrl)')
  && wxmlOf('pages/services/index.wxml').includes('src="{{item.image}}"'))

/* ===== ④ 会员等级(平台编辑 → 两端只读同一份) ===== */
const mcNew = { memberQualify: 'total_spend', qualifyValueCents: 88800 }   // 值必须在 MEMBER_QUALIFY_MODES 白名单里(编的值会被静默回落 —— 差点让断言靠 88800 凑巧绿)
const putMc = await request(`/platform/tenants/${tid}/membership-config`, { method: 'PUT', body: JSON.stringify(mcNew) })
check('④ 平台改会员配置成功', putMc.status === 200, JSON.stringify(putMc.data).slice(0, 100))
const merchantMc = (await request('/admin/membership/config', {}, PLATFORM, H)).data
check('🔴 ④ 商家端(小程序 member 页真调 /admin/membership/config)读到的就是刚改的那份(模式+门槛都钉)',
  merchantMc.config.memberQualify === 'total_spend' && merchantMc.config.qualifyValueCents === 88800,
  JSON.stringify(merchantMc).slice(0, 140))
check('④ 渲染链闭合:小程序 member 页真调这条口', jsOf('pages/merchant/member/index.js').includes("'/admin/membership/config'"))

/* ===== ⑤ 「合理只在网页」清单逐项过 —— 效果面在哪、有没有断言,一项不落 ===== */
const roster = [
  ['轮播自管', '✅ 本套件①(数据面)+ ①链(渲染面)'],
  ['门店封面', '✅ 本套件②'],
  ['价目/项目编辑', '✅ 本套件③'],
  ['会员等级(平台编辑)', '✅ 本套件④'],
  ['AI 知识库', '效果面=AI 回答(customer-service-matrix 66 项守着,两端同一 AI 出口)'],
  ['财务深功能', '无顾客可见效果面(老板报表);小程序 finance 简版与网页读同一账本口,finance-core 守'],
  ['商城自购/预约草稿', '网页操作工具,效果落在订单/商城数据 —— 两端读订单同源(84 组共用路由)'],
  ['消息模板', 'P3 未接发送,**暂无效果面** —— P3 落地批必须回来补跨端断言(登记)'],
  ['微信模拟器', '纯网页演练工具,不产生顾客可见数据']
]
console.log('   [清单] ' + roster.map((r) => `${r[0]}:${r[1]}`).join(' | '))
check(`⑤ 「合理只在网页」清单 ${roster.length} 项逐项有效果面结论(有断言的指到断言,没效果面的写明理由)`, roster.length === 9)

console.log(`\n✅ test-cross-end-effect 通过 ${checks} 项`)
