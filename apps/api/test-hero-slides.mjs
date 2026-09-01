/* D78 · 顾客首页轮播按租户出数据(店主 2026-08-28 立案 → 批次二第①件)。

   病根:三张轮播原来是**前端写死的数组、两端各写一份**,零租户输入 ——
   小婕的店、两家演示店的顾客,首页看到的全是 Lucky Luxe 本店的照片。

   店主给的判据(原样落在这套件里):
     · **负向**:造一个没配轮播的租户 → 顾客端不许出现任何 Lucky Luxe 的图;
     · **正向**:配了的租户 → 出自己的图;
     · **从数据入口一路验到像素** —— 这里能验到「服务端真发出来的那份前端资源」那一层
       (运行时取证律 · 前端条:断言跑在店主实际会加载到的资源上,不是源文件)。
       浏览器像素级那一步没有设计图(L3),挂 ⬜ 报 Cowork。

   判据写法一律**白名单式**:不列举"我知道的那几处写死",而是反过来数 ——
   全仓每一个前端文件都必须落进"不写死轮播图源"这条里,新来的自动红。

   ⚠️ standalone:CI_SUITES="hero-slides" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { otherTenantNames, findForeignNames } from './other-tenant-names.mjs'

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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/* ===== 夹具:两家店。A 家配轮播,B 家一张不配(负向那家) ===== */
const tidA = `hero-a-${RUN}`
const tidB = `hero-b-${RUN}`
for (const [id, name] of [[tidA, `轮播店甲${RUN}`], [tidB, `轮播店乙${RUN}`]]) {
  const made = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name, plan: 'chain' }) })
  if (made.status !== 201) throw new Error(`建店失败 ${id}: ${JSON.stringify(made.data)}`)
}
const HA = { 'x-admin-tenant-id': tidA, 'x-tenant-id': tidA }
const HB = { 'x-admin-tenant-id': tidB, 'x-tenant-id': tidB }

/* ===== ① 空态 = 零回落(店主判据的负向那一半) ===== */
const emptyB = await request('/stores', {}, null, { 'x-tenant-id': tidB })
check('① 没配轮播的店:公开 /stores 回空数组(不是"给三张默认图")',
  emptyB.status === 200 && Array.isArray(emptyB.data.heroSlides) && emptyB.data.heroSlides.length === 0,
  JSON.stringify(emptyB.data.heroSlides))
/* 🔴 02v 裁定五:名字里那句「Lucky Luxe 的图源」是锚在店名上的说法;判据本身判的是**图源文件名**
   (那个不随改名变),所以行为没问题,但名字要跟着事实走(判据自述须与行为一致)。
   另加一条:整份响应里也不许出现**别家店名**(现取,不锚具体名字)。 */
check('① 负向红线:没配轮播的店,顾客端整份响应里不含任何**别家的图源**',
  !/hero-carousel-(interior|nail|lash)\.jpg/.test(JSON.stringify(emptyB.data)),
  JSON.stringify(emptyB.data).slice(0, 200))
const foreignB = otherTenantNames(process.env.TEST_DB_PATH, tidB)
const leakedB = findForeignNames(emptyB.data, foreignB)
check(`①b 负向红线:整份响应里不含别家店名(现取 ${foreignB.length} 个逐个查)`,
  leakedB.length === 0, leakedB.map((x) => x.name).join(' | '))
check('①c 反向守:别家店名集合非空(取空即红)', foreignB.length > 0, String(foreignB.length))

/* ===== ② 正向:配了就出自己的图,且只出自己的 ===== */
const put = await request('/admin/hero-slides', {
  method: 'PUT',
  body: JSON.stringify({ slides: [
    { image: PNG, labelZh: `甲店门头${RUN}`, labelEn: `Storefront ${RUN}` },
    { image: '/assets/images/hero-carousel-nail.jpg', labelZh: '停用的那张', isActive: false }
  ] })
}, PLATFORM, HA)
check('② 保存成功,排序按提交顺序落库', put.status === 200 && put.data.slides.length === 2
  && put.data.slides[0].sortOrder === 0 && put.data.slides[1].sortOrder === 1, JSON.stringify(put.data).slice(0, 160))

const pubA = await request('/stores', {}, null, { 'x-tenant-id': tidA })
check('② 正向:配了的店出**自己的**图(停用那张不出,启用的 1 张出)',
  pubA.data.heroSlides.length === 1 && pubA.data.heroSlides[0].image === PNG,
  JSON.stringify(pubA.data.heroSlides).slice(0, 160))
check('② 文案随图下发(中英各一份,前端切语言不用再取一次)',
  pubA.data.heroSlides[0].labelZh === `甲店门头${RUN}` && pubA.data.heroSlides[0].labelEn === `Storefront ${RUN}`,
  JSON.stringify(pubA.data.heroSlides[0]))
const pubAEn = await request('/stores?lang=en', {}, null, { 'x-tenant-id': tidA })
check('② label 跟语言走(lang=en 时给英文)', pubAEn.data.heroSlides[0].label === `Storefront ${RUN}`,
  JSON.stringify(pubAEn.data.heroSlides[0]))

/* ===== ③ 租户隔离:甲店配的图不许漏到乙店(D78 的病正是"看到别人家的") ===== */
const stillEmptyB = await request('/stores', {}, null, { 'x-tenant-id': tidB })
check('③ 甲店配完之后,乙店顾客端仍然是空的(零串味)',
  stillEmptyB.data.heroSlides.length === 0, JSON.stringify(stillEmptyB.data.heroSlides))
check('③ 乙店商家后台读到的也是空(读口同样按租户)',
  (await request('/admin/hero-slides', {}, PLATFORM, HB)).data.slides.length === 0)

/* ===== ④ 门禁:读写两道闸分别验(《读写两道闸律》) ===== */
check('④ 写口:未登录 PUT → 401', (await request('/admin/hero-slides', { method: 'PUT', body: JSON.stringify({ slides: [] }) }, null, HA)).status === 401)
check('④ 读口:未登录 GET → 401', (await request('/admin/hero-slides', {}, null, HA)).status === 401)

/* ===== ⑤ 后端最终闸(前端拦只算体验)===== */
const gates = [
  ['超过 6 张', { slides: Array.from({ length: 7 }, () => ({ image: PNG })) }],
  ['空图片', { slides: [{ image: '' }] }],
  ['非法地址(javascript:)', { slides: [{ image: 'javascript:alert(1)' }] }],
  ['文案超长(41 字)', { slides: [{ image: PNG, labelZh: '文'.repeat(41) }] }],
  ['不是数组', { slides: { image: PNG } }]
]
for (const [label, body] of gates) {
  const r = await request('/admin/hero-slides', { method: 'PUT', body: JSON.stringify(body) }, PLATFORM, HA)
  check(`⑤ 后端闸「${label}」→ 4xx(${r.status})`, r.status >= 400 && r.status < 500, JSON.stringify(r.data).slice(0, 120))
}
check('⑤ 反向守:合法的一张仍然存得进去(否则"全拒"也能让上面五条绿)',
  (await request('/admin/hero-slides', { method: 'PUT', body: JSON.stringify({ slides: [{ image: PNG, labelZh: '正常' }] }) }, PLATFORM, HA)).status === 200)
check('⑤ 被拒的那几次一张都没写进去(事务:要么整批换,要么一张不动)',
  (await request('/stores', {}, null, { 'x-tenant-id': tidA })).data.heroSlides.length === 1)
check('⑤ 清空合法:提交空数组 → 顾客端退回"不出轮播"',
  (await request('/admin/hero-slides', { method: 'PUT', body: JSON.stringify({ slides: [] }) }, PLATFORM, HA)).status === 200
  && (await request('/stores', {}, null, { 'x-tenant-id': tidA })).data.heroSlides.length === 0)

/* ===== ⑥ 白名单式:全仓前端**没有一处**再写死轮播图源 ===== */
const walk = (rel, re) => {
  const out = []
  const stack = [join(ROOT, rel)]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'assets') stack.push(abs) } else if (re.test(e.name)) out.push(abs)
    }
  }
  return out
}
const frontFiles = ['miniprogram', 'apps/web'].flatMap((d) => walk(d, /\.(js|wxml|html)$/))
/* 白名单:允许出现 `hero-carousel-*.jpg` 字样的文件,每一项写一行理由。
   🔴 三道防线(店主 08-28):①每项写理由 ②条目数上棘轮只许减 ③白名单每项必须仍然真的命中。 */
const HARDCODE_ALLOW = {}   // 空 = 一处都不许有;新增一处必须先报 Cowork 并写明理由
const ALLOW_CAP = 0
const hits = frontFiles.filter((f) => /hero-carousel-[a-z]+\.jpg/.test(readFileSync(f, 'utf8')))
  .map((f) => f.slice(ROOT.length + 1))
  .filter((f) => !(f in HARDCODE_ALLOW))
check(`⑥ 白名单式:全仓 ${frontFiles.length} 个前端文件,写死轮播图源的**零处**(原病=两端各写一份三张图)`,
  hits.length === 0, hits.join(' | '))
check(`⑥ 白名单防线②:豁免条目数上棘轮 ≤ ${ALLOW_CAP}`, Object.keys(HARDCODE_ALLOW).length <= ALLOW_CAP)
check('⑥ 反向守:这条扫描真读到了文件(不是路径写错扫了个空)', frontFiles.length >= 100, String(frontFiles.length))

/* ===== ⑦ 运行时取证:验**服务端真发出来的**那份前端资源,不是源文件 ===== */
const servedCustomer = await fetch(`${BASE_URL}/web/customer.js`).then((r) => r.text())
check('⑦ 网页顾客端(服务端实发的 customer.js):轮播来自 state.heroSlides,零写死',
  servedCustomer.includes('state.heroSlides') && !/hero-carousel-[a-z]+\.jpg/.test(servedCustomer),
  servedCustomer.length ? '' : '资源取不到')
const servedHtml = await fetch(`${BASE_URL}/web/admin.html`).then((r) => r.text())
check('⑦ 商家后台(服务端实发的 admin.html):自管面板挂在门店设置里,且 store-content.js 带指纹发出',
  servedHtml.includes('id="heroSlidesBody"') && /store-content\.js\?v=[0-9a-f]{6,}/.test(servedHtml),
  (servedHtml.match(/store-content\.js\?v=[^"]*/) || ['(没挂上)'])[0])
const servedStoreContent = await fetch(`${BASE_URL}/web/store-content.js`).then((r) => r.text())
check('⑦ 自管面板真读那条唯一出口(/admin/hero-slides 的读与写各一处)',
  servedStoreContent.includes("request('/admin/hero-slides')") && servedStoreContent.includes("'/admin/hero-slides', { method: 'PUT'"))

console.log(`\n✅ test-hero-slides 通过 ${checks} 项`)
