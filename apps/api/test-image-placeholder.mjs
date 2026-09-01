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
  /* 剥 wxml 注释(02f 自查第 4 处判据毛病):我写在注释里的示例 `<image src>` 被当成真标签扫进来了 ——
     注释里的样例代码不是产品面。与 JS 侧剥注释同刀。 */
  const src = readFileSync(join(ROOT, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  for (const m of src.matchAll(/<image\b[^>]*>/g)) {
    sites.push({ end: 'mini', file: f, tag: m[0], ctx: src.slice(Math.max(0, m.index - 320), m.index) })
  }
}
/* C 类白名单:界面资产。**每项一行理由**;条目数上棘轮,只许减不许增,要增先报 Cowork。 */
const UI_ASSET_ALLOW = {
  'apps/web/admin.html|youji-logo': '平台 Logo —— 产品外观,不是商家内容',
  'apps/web/index.html|youji-logo': '同上(顾客端顶栏品牌位)',
  'apps/web/platform.html|youji-logo': '同上(平台后台)',
  /* 02h:旧理由「该页不连租户数据」已作废 —— 这页现在连了(loadShare 拿 bookingId 打 /bookings/:id),
     写死的示例图也已拔除。现在这一行是**空壳** <img id="shareMainImage" alt="">,src 由真数据填,
     没有作品图时整个图区 hidden(见 renderImages 空态分支)。理由随码复核律:理由已按现码重写。 */
  'apps/web/share.html|id="shareMainImage"': '分享页主图**空壳一行**:无 src 属性,由 renderImages 按数据填;无作品图时图区整块 hidden + 空态节点说话',
  'apps/web/customer.js|c-message': '「我的」页消息入口图标',
  'miniprogram/components/merchant-tabbar/index.wxml|tab-': '商家端底部 tab 图标 —— **5 枚**一组(02g 复核:理由与实际赦免行一一对上)',
  'miniprogram/pages/admin-login/index.wxml|brand-logo': '登录页品牌 Logo',
  'miniprogram/pages/entry/index.wxml|entry-bg': '入口页背景图 —— 产品外观',
  'miniprogram/pages/home/index.wxml|youji-logo': '顶栏品牌位',
  'miniprogram/pages/me/index.wxml|c-': '「我的」页入口图标 —— **5 行**一组(c-gift / c-message / c-ticket / c-store / c-crown);02g 复核:理由与实际赦免的 5 行一一对上',
  'miniprogram/pages/merchant-login/index.wxml|eye': '密码显隐图标',
  'miniprogram/components/img-placeholder/index.wxml|{{src}}': '占位组件自己那一行 —— 它就是出口本身',
  'apps/web/img-placeholder.js|<img': '网页占位出口自己那 2 行 —— 它就是出口本身(02g 复核:2 行都是出口)',
  'apps/web/sign.html|signature': '服务确认单上的**签字笔迹** —— 有单必有笔迹,不是商家上传的内容图',
  'apps/web/snapshot-viewer.js|items[i].url': '快照查看器:进得来就一定有快照(调用方已判空)',
  'miniprogram/pages/merchant/work-detail/index.wxml|src="{{curImg}}"': '作品详情**主图**一行:没作品图进不到这一页(调用方已判空)。needle 已锚到 src 本身 —— 02g 咬出:原写裸 curImg,缩略图那行 class 里的 curImg===item 也含这个子串,一条为主图写的理由把缩略图顺手赦免了(而它没守卫),子串匹配族第二次重犯;缩略图已补字段级守卫,不再靠白名单蹭。',
  'miniprogram/pages/merchant/manage/index.wxml|/assets/icons/': '管理页功能入口图标',
  'apps/web/customer.js|${imgCls}': '「我的」页入口卡线条图标 —— 模板里只有**这一行** <img>(imgCls 由调用方传 c-gift、c-ticket、c-store);02g 复核:赦免范围与理由一一对上'
}
const UI_CAP = 20
const isPlaceholderExit = (t) => /img-placeholder|ImgPlaceholder/.test(t)
/* B 类:这一处只在「数据真的有」的时候才渲染 —— 三态里的第三态(不该有图=整块不出现)。
   判据:标签自己带 wx:for/wx:if,或者它就长在一个 `.map(` / `wx:for` / 三元守卫里面。 */
/* 🔴 退回一(店主 02f):B 类原来判的是「外层数组空不空」—— 数组有三条、每条图字段都空,
   照样渲三个**空白框**,踩中占位律后半句「也不许什么都不显示」。两把刀都放行过它。
   收窄到**字段级**:这个 <image> 自己带 wx:if,或它的 src 表达式本身就在三元/&& 守卫里;
   外层有个 wx:for **不算数**。 */
const srcExpr = (t) => (/src=["']\{\{([^}]+)\}\}/.exec(t) || [])[1] || ''
const isConditional = (s) => {
  if (/wx:if|wx:elif/.test(s.tag)) return true          // 标签自己带字段级守卫
  const e = srcExpr(s.tag) || (/src=["'`]?\$\{([^}]+)\}/.exec(s.tag) || [])[1] || ''
  if (Boolean(e) && /\?|&&|\|\|/.test(e)) return true   // src 表达式自己就是守卫式
  /* 02h 补一维:守卫也可能包在**标签外层**(`${image ? \`<img …>\` : ''}`)——
     这是网页模板串里最常见的字段级写法,只看 src= 会漏判。取标签前 60 字符看有没有
     「<字段> ? `」这种紧贴的三元开头,且该字段就是 src 用的那个。 */
  const before = (s.ctx || '').slice(-140)   // 02h:窗口 60→140,`.map((image, index) => image ? \`<img…` 这种超窗了
  const v = (/\$\{([A-Za-z_$][\w.$]*)\}/.exec(s.tag) || [])[1]
  if (!v) return false
  const esc = v.replace(/[.$]/g, '\\$&')
  /* 两种字段级写法都认:①模板串里 `${image ? \`<img…` ②map 回调里 `=> image ? \`<img…` */
  return new RegExp(`(\\$\\{|=>)\\s*${esc}\\s*\\?\\s*\`\\s*$`).test(before)
}
/* 网页侧自查清单(店主 02f 令「网页侧同刀自查一遍」):`<img src="${…}">` 直出、未过
   ImgPlaceholder.tag、src 表达式也没有字段级守卫的位置。**这是挂账不是豁免** ——
   逐处现证字段级要在下一段做完;这里先钉住**条数只减不增**,新长出来的立刻红。 */
/* 02g 裁定二:挂账必须分顾客端/老板端 —— **顾客端第一现场律**:空白框长在顾客手机上,
   和长在老板后台不是一回事。现答分布(02g 现测):顾客端 14 处 / 老板端·平台 19 处。
   顾客端那 14 处**不挂账**,下一段第一批压到 0;这里先钉住它只减不增,并写明期限。 */
const WEB_CUSTOMER_FILES = ['apps/web/customer.js', 'apps/web/index.html', 'apps/web/share.js', 'apps/web/share.html', 'apps/web/sign.html', 'apps/web/sign.js']
/* 🔴 02h 退回(同族第二次:注释写对了下一行没照做,上次在渲染代码、这次在判据代码):
   我把 check 名字写成「不挂账」,条件却是 `<= 14` —— **那就是挂账,只是改了个名字**,
   套件在顾客端带着 14 处空白框风险时照样全绿。判据的名字是它的对外声明,声明与行为必须一字对得上。
   现改硬零。 */
const WEB_ADMIN_TODO = 19      // 老板端/平台:走棘轮慢慢清
/* 🔴 02g 裁定一:needle 不许拿裸标识符去 includes 整个标签 —— 它会赦免"理由没提到的兄弟行"。
   规矩:凡 needle 里带 `src=` 的,必须**整段锚定**;其余(类名/文件名式 needle)保持子串但
   由下面那条自守断言逼着逐条与实际赦免行对上。 */
const whitelisted = (s) => Object.keys(UI_ASSET_ALLOW).some((k) => {
  const [file, needle] = k.split('|')
  if (s.file !== file) return false
  return s.tag.includes(needle)
})
/* 自守(白名单理由随码复核律·02g 加句):**理由必须与它实际豁免的行一一对上;
   赦免了理由没提到的行,等于这条理由是假的。** 判据:每条 needle 实际命中的标签数 ≤ 1,
   命中多行的必须把 needle 锚到 src 才放行。 */
/* 「声明了复数」只认**量词**(N 行/枚/张/个/处、两行、复数),不认理由文字里的斜杠或顿号 ——
   02g 自查:`c-gift / c-ticket / c-store` 是同一行模板渲三张图,斜杠是在列图标名不是列标签行,
   被当成复数声明就会反向误红。判据要数的是**标签行数**,不是文字里的分隔符。 */
const DECLARED = /\d+\s*(行|枚|张|个|处)|两行|复数/
const multiHit = Object.keys(UI_ASSET_ALLOW).map((k) => {
  const [file, needle] = k.split('|')
  const hits = sites.filter((s) => s.file === file && s.tag.includes(needle))
  return { k, n: hits.length, anchored: needle.includes('src='), declaredMulti: DECLARED.test(UI_ASSET_ALLOW[k]) }
})
/* 分两种(02g 复核结论):
   · **真·多行豁免** —— 理由本身就写着复数(「tab 图标」5 枚 / 「c-gift / c-message / …」/「出口自己那两行」),
     它说的就是这一组,一一对得上,放行;
   · **误伤** —— 理由说的是某一行,却顺手赦免了兄弟行(work-detail 的 curImg 就是),红。
   判据据此分辨:命中多行 且 理由里没声明是复数 且 needle 没锚 src= → 红。 */
const multiBad = multiHit.filter((x) => x.n > 1 && !x.anchored && !x.declaredMulti)
check('② 白名单自守:needle 只赦免理由说的那些行(命中多行而理由没声明复数=这条理由是假的)',
  multiBad.length === 0, multiBad.map((x) => `${x.k} 命中 ${x.n} 行`).join(' | '))
check('② 白名单自守②:声明了复数的条目,命中数必须 ≥2(声明与事实反向也算假理由)',
  multiHit.filter((x) => x.declaredMulti && x.n < 2).length === 0,
  multiHit.filter((x) => x.declaredMulti && x.n < 2).map((x) => `${x.k} 只命中 ${x.n}`).join(' | '))
const rawBad = sites.filter((s) => {
  if (isPlaceholderExit(s.tag) || whitelisted(s)) return false
  if (isConditional(s)) return false             // B 类(02f 收窄):**字段级**守卫才算
  return true
})
const webTodo = rawBad.filter((s) => s.end === 'web')
const bad = rawBad.filter((s) => s.end !== 'web')
  .map((s) => `${s.file} ${s.tag.replace(/\s+/g, ' ').slice(0, 70)}`)
check(`② 白名单式(小程序硬零):全仓 ${sites.length} 个图片位逐个落进三类,B 类须**字段级**守卫`,
  bad.length === 0, bad.join(' | '))
const custTodo = webTodo.filter((s) => WEB_CUSTOMER_FILES.includes(s.file))
const adminTodo = webTodo.filter((s) => !WEB_CUSTOMER_FILES.includes(s.file))
check('② 网页**顾客端**未过占位出口的 <img> = 0(顾客端第一现场律:硬零,不挂账)',
  custTodo.length === 0, `${custTodo.length} 处:${custTodo.map((s) => `${s.file} ${s.tag.replace(/\s+/g, ' ').slice(0, 46)}`).join(' | ')}`)
check(`② 网页老板端/平台**挂账棘轮** ≤ ${WEB_ADMIN_TODO}(名实相符:这条就是挂账,只减不增)`,
  adminTodo.length <= WEB_ADMIN_TODO, `${adminTodo.length} 处:${[...new Set(adminTodo.map((s) => s.file))].slice(0, 3).join(', ')}`)
check(`② 白名单防线②:界面资产条目数上棘轮 ≤ ${UI_CAP}(只许减不许增)`,
  Object.keys(UI_ASSET_ALLOW).length <= UI_CAP, String(Object.keys(UI_ASSET_ALLOW).length))
check('② 反向守:这条扫描真读到了图片位(不是路径写错扫了个空)', sites.length >= 50, String(sites.length))

/* ===== ②c 数据层同刀(店主 02e 裁定三)=====
   为什么加这一刀:②那把刀的被测集合是**图片标签位**(<img>/<image>),而八处假图回落
   一个标签都不是 —— 它们是 **JS 数据层的默认值 / || 回落**,在数据流进 <img> **之前**
   就把 /assets/... 塞进字段;等它到达标签位,src 已经是一条"看起来正常的路径",②切不到。
   最刺眼的是本文件 ① 条自己就断言 isOwnUpload('/assets/images/nail-addon.jpg')===false ——
   **同一把刀明明知道那是假图,而它上面 12 行正被当默认值赋出去。**
   本刀:全仓前端 .js/.wxs 里每一处 /assets/images/ 字面量,逐个落进三类,落不进=红。
     A 出口/映射表自己(image-placeholder / api.js 的 .png→.jpg 归一表)
     B 明标 fixture/demo 分支(同函数里有 demo/fixture 字样,且不走真实 bookingId 路径)
     C 界面资产 —— **与 UI_ASSET_ALLOW 共用同一张表同一个棘轮**(不另开表,两张表会各自长胖) */
const DATA_A_FILES = ['apps/api/image-placeholder.mjs', 'miniprogram/utils/api.js']
const dataSites = []
/* 剥注释但**保留行数**(不然报出来的行号对不上真文件,店主照着找会找错地方) */
const stripCmt = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  .replace(/^(\s*)\/\/.*$/gm, '$1')
  /* 行尾 // 注释也要剥 —— 02e 自查咬出:一句「// mock 清除:…」把 B 类豁免误触发,
     三处真回落被放过。判据里的注释残留 = 判据自己的静默失败器。 */
  .replace(/([^:'"\`])\/\/[^\n]*/g, '$1')
for (const f of [...walk('apps/web', /\.js$/), ...walk('miniprogram', /\.(js|wxs)$/)]) {
  const raw = readFileSync(join(ROOT, f), 'utf8')
  const src = stripCmt(raw)
  const lines = src.split('\n')
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/['"`](\/assets\/images\/[^'"`]+)['"`]/g)) {
      dataSites.push({ file: f, line: i + 1, lit: m[1],
        ctx: lines.slice(Math.max(0, i - 6), i + 2).join(' '),
        /* 近窗(4 行):B 类只看**紧贴**的那几行 —— 02e 自查咬出:6 行窗把兄弟 if 分支里的
           bookingId 也吃进来,把明标的 demo 夹具误判成"走真实路径"。 */
        near: lines.slice(Math.max(0, i - 4), i + 1).join(' ') })
    }
  })
}
/* A 类:归一映射表自己 —— 表里两侧都是平台资产路径,它就是那张表,不是内容图回落。
   判据认「文件 + 处在 localImageMap 字面量对象内」,不靠上下文碰运气。 */
const mapRanges = {}
for (const f of DATA_A_FILES) {
  try {
    const t = readFileSync(join(ROOT, f), 'utf8')
    const m = /const\s+localImageMap\s*=\s*\{/.exec(t)
    if (m) {
      const start = t.slice(0, m.index).split('\n').length
      const end = start + t.slice(m.index).slice(0, t.slice(m.index).indexOf('}') + 1).split('\n').length
      mapRanges[f] = [start, end]
    }
  } catch { /* 文件不在就没有这张表 */ }
}
const isMapTable = (s) => mapRanges[s.file] && s.line >= mapRanges[s.file][0] && s.line <= mapRanges[s.file][1]
/* B 类收紧(02e 裁定三原文:"同一函数里有 demo/fixture 字样,且不走真实 bookingId 路径"):
   只认**标识符**(变量名/函数名/属性名)含 demo|fixture|mock|seed,不认散落的词与注释残留。 */
const isDemoFixture = (s) => /\b[A-Za-z_$]*(demo|fixture|mock|seed)[A-Za-z_$]*\s*[=:(]/i.test(s.near)
  && !/bookingId/.test(s.near)
const isUiAsset = (s) => Object.keys(UI_ASSET_ALLOW).some((k) => {
  const [file, needle] = k.split('|')
  return s.file === file && s.lit.includes(needle)
})
const dataBad = dataSites.filter((s) => !isMapTable(s) && !isDemoFixture(s) && !isUiAsset(s))
  .map((s) => `${s.file}:${s.line} ${s.lit}`)
check(`②c 数据层同刀:全仓 JS 里 ${dataSites.length} 处 /assets/images/ 字面量逐个落进三类(映射表 / 明标 demo / 界面资产白名单)`,
  dataBad.length === 0, dataBad.join(' | '))
check('②c 反向守:这条扫描真读到了字面量(不是正则写错扫了个空)', dataSites.length >= 15, String(dataSites.length))

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

/* ===== 判据自述须与判据行为一致律(店主 02h 立)=====
   判据的名称是它的对外声明。声明「硬零/零/不挂账/不许」而条件写成 `<= N`,
   等于判据自己是个说谎的空态 —— 本文件那条顾客端 check 就是这么绿着的。
   自守:扫本文件自身源码,凡 check 名称里出现绝对词的,其条件必须是 === 0 / .length === 0。
   这条能一次咬住这一族,包括以后新写的。 */
{
  const selfSrc = readFileSync(new URL(import.meta.url).pathname, 'utf8')
  /* 绝对词表(02h 自查收窄):「不许减/只许减不许增」是**棘轮**的说法,它名实相符(≤ 就对),
     不能算绝对词;真正的绝对词是宣称"一个都没有"的那些。收窄后这条自守才只咬说谎的。 */
  const ABS = /硬零|不挂账|零残留|一律 0|= 0(?![0-9])|全部落进|逐个必须/
  const liars = []
  for (const m of selfSrc.matchAll(/check\(([`'"])([\s\S]*?)\1\s*,\s*([^,]+),/g)) {
    const name = m[2]
    const cond = m[3]
    if (!ABS.test(name)) continue
    if (/===\s*0|length === 0|!\w+\.length/.test(cond)) continue
    if (/<=|>=|<|>/.test(cond)) liars.push(`${name.slice(0, 40)} → ${cond.trim().slice(0, 40)}`)
  }
  check('🔴 判据自述须与判据行为一致(名字里说「硬零/不挂账/不许」的,条件必须 === 0)',
    liars.length === 0, liars.join(' | '))
}

console.log(`\n✅ test-image-placeholder 通过 ${checks} 项(扫了 ${sites.length} 个图片位)`)
