/* 占位零回落 · 全局判据(店主 2026-08-28 六立律)。

   **她的原话就是规格**:「只要没有上传过的图片,在图片占位的地方都应该显示一个图片占位,
   或者就是那种有一个小相机的那种空白页面,让人感受到这里应该是有图片的,只是他没有上传而已。」

   三态:**有图** / **没配图 = 占位(空框+相机+一句话)** / **不该有图 = 整块不出现**。
   🔴 不许回落到别的租户的图,也不许什么都不显示。

   判据一律**白名单式**(不许靠列举被测对象):
     ① 被测集合 = **全仓每一个图片位现扫**(网页 `<img>` + 小程序 `<image>`),新加的自动纳入;
     ② 每一个都必须落进三类之一,落不进去=红:
        A 走占位出口(`ImgPlaceholder.tag` / `<img-placeholder>`)
        B 在 `wx:for` / `wx:if` 里,数据没有就整块不渲染
        C 界面资产(logo / tabbar / 图标 / 背景),**逐个写理由**进白名单,条目数上棘轮;
     ③ **两向实测**:没上传过图的租户 → 顾客端**整份响应与页面都不含任何别家店的图源**;
        上传过的 → 出自己的图。**从数据入口验到像素。**

   ⚠️ standalone:CI_SUITES="image-placeholder" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contentImage, isOwnUpload } from './image-placeholder.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

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
const walk = (rel, re, out = []) => {
  const dir = join(ROOT, rel)
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    const relPath = join(rel, e.name)
    if (e.isDirectory()) { if (!['node_modules', '.git', 'assets'].includes(e.name)) walk(relPath, re, out) } else if (re.test(e.name)) out.push(relPath)
  }
  return out
}

/* ===== ① 出口本身:什么叫「上传过」 ===== */
check('① 「上传过」的定义:商家上传的是 data:/https:,平台自带 /assets 一律等于没人传过',
  isOwnUpload('data:image/png;base64,x') && isOwnUpload('https://a/b.jpg')
  && !isOwnUpload('/assets/images/nail-addon.jpg') && !isOwnUpload('') && !isOwnUpload(null))
check('① 内容图唯一出口:平台自带资产与空值都回空串(前端只判空,零分支)',
  contentImage('/assets/images/nail-addon.jpg') === '' && contentImage('') === ''
  && contentImage('data:image/png;base64,x') === 'data:image/png;base64,x')

/* ===== ② 白名单式:全仓每一个图片位都要落进三类之一 ===== */
const sites = []
/* 连上下文一起取:B 类「有数据才渲染」是**上下文**决定的(外层 `.map(` 或 `wx:for` / `wx:if`),
   光看这一个标签判不出来 —— 判据自己也要看得见它要判的东西。 */
for (const f of walk('apps/web', /\.(js|html)$/)) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  for (const m of src.matchAll(/<img\b[^>]*>/g)) {
    sites.push({ end: 'web', file: f, tag: m[0], ctx: src.slice(Math.max(0, m.index - 260), m.index) })
  }
}
for (const f of walk('miniprogram', /\.wxml$/)) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  for (const m of src.matchAll(/<image\b[^>]*>/g)) {
    sites.push({ end: 'mini', file: f, tag: m[0], ctx: src.slice(Math.max(0, m.index - 320), m.index) })
  }
}
/* C 类白名单:界面资产。**每项一行理由**;条目数上棘轮,只许减不许增,要增先报 Cowork。 */
const UI_ASSET_ALLOW = {
  'apps/web/admin.html|youji-logo': '平台 Logo —— 产品外观,不是商家内容',
  'apps/web/index.html|youji-logo': '同上(顾客端顶栏品牌位)',
  'apps/web/platform.html|youji-logo': '同上(平台后台)',
  'apps/web/share.html|nail-french': '分享落地页的静态插画 —— 该页不连租户数据',
  'apps/web/customer.js|c-message': '「我的」页消息入口图标',
  'miniprogram/components/merchant-tabbar/index.wxml|tab-': '商家端底部 tab 图标',
  'miniprogram/pages/admin-login/index.wxml|brand-logo': '登录页品牌 Logo',
  'miniprogram/pages/entry/index.wxml|entry-bg': '入口页背景图 —— 产品外观',
  'miniprogram/pages/home/index.wxml|youji-logo': '顶栏品牌位',
  'miniprogram/pages/me/index.wxml|c-': '「我的」页入口图标(c-gift / c-message / c-ticket / c-store / c-crown)',
  'miniprogram/pages/merchant-login/index.wxml|eye': '密码显隐图标',
  'miniprogram/components/img-placeholder/index.wxml|{{src}}': '占位组件自己那一行 —— 它就是出口本身',
  'apps/web/img-placeholder.js|<img': '网页占位出口自己那两行 —— 它就是出口本身',
  'apps/web/sign.html|signature': '服务确认单上的**签字笔迹** —— 有单必有笔迹,不是商家上传的内容图',
  'apps/web/snapshot-viewer.js|items[i].url': '快照查看器:进得来就一定有快照(调用方已判空)',
  'miniprogram/pages/merchant/work-detail/index.wxml|curImg': '作品详情主图:没作品图进不到这一页(调用方已判空)',
  'miniprogram/pages/merchant/manage/index.wxml|/assets/icons/': '管理页功能入口图标',
  'apps/web/customer.js|${imgCls}': '「我的」页三个入口卡的**线条图标**(c-gift / c-ticket / c-store)—— 本批已把原来那两张店主本店实拍照换成店店中立的图标'
}
const UI_CAP = 20
const isPlaceholderExit = (t) => /img-placeholder|ImgPlaceholder/.test(t)
/* B 类:这一处只在「数据真的有」的时候才渲染 —— 三态里的第三态(不该有图=整块不出现)。
   判据:标签自己带 wx:for/wx:if,或者它就长在一个 `.map(` / `wx:for` / 三元守卫里面。 */
const isConditional = (s) => /wx:for|wx:if|wx:else/.test(s.tag)
  || /\.map\(|wx:for|wx:if|\?\s*`|&&\s*`/.test(s.ctx)
const whitelisted = (s) => Object.keys(UI_ASSET_ALLOW).some((k) => {
  const [file, needle] = k.split('|')
  return s.file === file && s.tag.includes(needle)
})
const bad = sites.filter((s) => {
  if (isPlaceholderExit(s.tag) || whitelisted(s)) return false
  if (isConditional(s)) return false             // B 类:数据没有就整块不渲染
  return true
}).map((s) => `${s.file} ${s.tag.replace(/\s+/g, ' ').slice(0, 70)}`)
check(`② 白名单式:全仓 ${sites.length} 个图片位(网页 ${sites.filter((s) => s.end === 'web').length} / 小程序 ${sites.filter((s) => s.end === 'mini').length})逐个落进三类(占位出口 / 有数据才渲染 / 界面资产白名单)`,
  bad.length === 0, bad.join(' | '))
check(`② 白名单防线②:界面资产条目数上棘轮 ≤ ${UI_CAP}(只许减不许增)`,
  Object.keys(UI_ASSET_ALLOW).length <= UI_CAP, String(Object.keys(UI_ASSET_ALLOW).length))
check('② 反向守:这条扫描真读到了图片位(不是路径写错扫了个空)', sites.length >= 50, String(sites.length))

/* ===== ②b 编造数据零残留:本批咬出的两处「没有真实数据就编一份」 =====
   admin 的 AI 图库(真实作品不足 3 组就拿 mock 凑齐)与顾客端作品墙(没作品就编三位技师)——
   两处用的都是**店主本店**的图。判据反着数:全仓前端不许再有这一族。 */
{
  const frontFiles = [...walk('apps/web', /\.js$/), ...walk('miniprogram', /\.js$/)]
  const fakeNames = ['Lina Zhou', 'Mia Chen', 'Ava Lin', 'mockGalleryGroups']
  /* **剥注释再扫**(与 ㋓ 那条同刀):这些名字大量出现在「D21/D17 当年修掉了什么」的注释里,
     那是案底不是活代码。判据要判的是**会渲染给人看的东西**。 */
  const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  /* 唯一豁免:微信模拟器 —— 它整页就叫「模拟器」,里面本来就是演示会话,不是冒充真数据。 */
  const FAKE_ALLOW = { 'apps/web/ai-desk.js': '微信客服**模拟器**的演示会话(页面自报是模拟器,不冒充真顾客)' }
  const hits = []
  for (const f of frontFiles) {
    if (f in FAKE_ALLOW) continue
    const src = stripJs(readFileSync(join(ROOT, f), 'utf8'))
    for (const n of fakeNames) if (src.includes(n)) hits.push(`${f}:${n}`)
  }
  check('②b 编造的技师/作品组零残留(拿不到真值不许编一份出来给顾客看)', hits.length === 0, hits.join(' | '))
  check('②b 反向守:这条扫描真读到了前端文件', frontFiles.length >= 40, String(frontFiles.length))
}

/* ===== ③ 写入层零回落:建项目不许再塞默认图 ===== */
const tid = `imgph-${RUN}`
if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `占位店${RUN}`, plan: 'chain' }) })).status !== 201) {
  throw new Error('建店失败')
}
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const catId = ((await request('/admin/pricing/categories', {}, PLATFORM, H)).data.categories || [])[0]?.id
const made = await request('/admin/services', {
  method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `没配图的项目${RUN}`, nameEn: 'x', priceCents: 20000, baseDurationMin: 60, categoryId: catId })
}, PLATFORM, H)
check('③ 建项目成功(不传 imageUrl)', made.status === 201 || made.status === 200, JSON.stringify(made.data).slice(0, 120))
check('🔴 ③ 写入层零回落:没传图的项目,`imageUrl` 是**空**,不是店主本店那张 nail-addon.jpg',
  (made.data.service?.imageUrl || '') === '', JSON.stringify(made.data.service?.imageUrl))

/* ===== ④ 🔴 店主判据 · 负向:没上传过图的店,顾客端一处都不许出现别家店的图源 ===== */
const pub = await request('/services', {}, null, { 'x-tenant-id': tid })
const stores = await request('/stores', {}, null, { 'x-tenant-id': tid })
const blob = JSON.stringify(pub.data) + JSON.stringify(stores.data)
check('🔴 ④ 负向:这家店没上传过任何图 → 顾客端整份响应**不含任何 /assets 图源**(不拿别家店的顶上)',
  !/\/assets\/images\//.test(blob), (blob.match(/\/assets\/images\/[\w.-]+/g) || []).slice(0, 4).join(', '))
check('④ 而且不是"空响应"混过去的(反向守:项目确实下发了)',
  (pub.data.services || []).some((s) => s.name.includes(RUN)), String((pub.data.services || []).length))

/* ===== ⑤ 正向:上传过的就出自己的图 ===== */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const sid = made.data.service.id
const patched = await request(`/admin/services/${sid}`, { method: 'PATCH', body: JSON.stringify({ imageUrl: PNG }) }, PLATFORM, H)
check('⑤ 正向:上传一张图之后,顾客端出的是**自己那张**',
  patched.status === 200
  && ((await request('/services', {}, null, { 'x-tenant-id': tid })).data.services || []).some((s) => s.imageUrl === PNG),
  JSON.stringify(patched.data?.service?.imageUrl || '').slice(0, 60))

/* ===== ⑥ 运行时取证:两端**服务端真发出来的**资源里,占位出口在场且没有写死的门店封面 ===== */
const servedCustomer = await fetch(`${BASE_URL}/web/customer.js`).then((r) => r.text())
check('⑥ 网页顾客端(实发资源):项目图/门店封面/头像都走占位出口',
  servedCustomer.includes('window.ImgPlaceholder.tag') && !/<img src="\/assets\/images\/store-cover\.jpg"/.test(servedCustomer))
const servedPh = await fetch(`${BASE_URL}/web/img-placeholder.js`).then((r) => r.text())
check('⑥ 占位出口本身发得出来,且画的是相机 + 一句话(店主要的那个样子)',
  servedPh.includes('img-placeholder') && servedPh.includes('还没有图片') && servedPh.includes('<svg'))
const servedIndex = await fetch(`${BASE_URL}/web/index.html`).then((r) => r.text())
check('⑥ 顾客端页面真加载了占位出口(带内容指纹)', /img-placeholder\.js\?v=[0-9a-f]{6,}/.test(servedIndex),
  (servedIndex.match(/img-placeholder\.js\?v=[^"]*/) || ['(没挂上)'])[0])

console.log(`\n✅ test-image-placeholder 通过 ${checks} 项(扫了 ${sites.length} 个图片位)`)
