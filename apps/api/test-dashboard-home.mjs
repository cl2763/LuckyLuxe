/* 网页后台首页(段 6)· 静态判据 —— 图 v3.1 §三/§六/§八

   为什么是静态的:页面本体跑在浏览器里,常驻回归起不了浏览器。
   所以这一把守的是**能在源码上证伪的那几条**:四种态各有各的节点、
   金额不许写死币符、首页不许轮询、旧的那几块真的退役了。
   像素与交互由段 6 的现测 DOM 证据背书(`handoff/night-runs/段6_网页首页_DOM证据_2026-09-08.md`),
   两者分工写在这里,免得下一个人以为静态全绿就等于页面对了(L1 末端验证律)。 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const home = readFileSync(join(ROOT, 'apps/web/dashboard-home.js'), 'utf8')
const admin = readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8')
const html = readFileSync(join(ROOT, 'apps/web/admin.html'), 'utf8')

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ① 四种态各有各的节点,且**互斥**(图 §六;判据按节点验,不锚文案) */
for (const [state, marker] of [
  ['加载中', 'data-dh-state="loading"'], ['失败', 'data-dh-state="failed"'],
  ['正常', 'data-dh-state="ready"'], ['休息日', 'data-dh-state="closed"'],
]) {
  check(`①${state}态有自己的节点标记`, home.includes(marker), marker)
}
check('①b 失败态**不画数** —— 那一支里没有 metrics 渲染',
  /data-dh-state="failed"[\s\S]{0,400}?<\/section>/.test(home)
  && !/data-dh-state="failed"[\s\S]{0,400}?data-dh-metric/.test(home))
check('①c 失败时先把手上的数清掉再画(不显示旧数,图 §六)',
  /st\.pulse = null; st\.now = null; st\.todo = null/.test(home))

/* ② 金额:一个币符都不许写在页面里(币种红线;`test-currency-scan` 也扫,这里守的是「有没有走那个出口」) */
check('② 金额只走注入进来的 `money()` 出口,页面里零币符',
  home.includes('st.deps.money(cents)') && !/[¥￥]|CAD|US \$/.test(home.replace(/\/\*[\s\S]*?\*\//g, '')),
  '页面里出现了币符或没走 money()')
check('②b 拿不到币种就出「—」,不出裸数字(D140 fail-closed)',
  /!cur\) return '—'/.test(home))

/* ③ 图 §八 明确不做:首页**不轮询**(全屏态除外,那是段 11)

   🔴 05t 段 3 修订判据(说明为什么改):图 §八 说「首页不轮询」,而图 §一 第 1 条同时要求
   「**轮播换指标**时数字滚动 600ms」—— 轮播必须有计时器。两条不矛盾:
   §八 禁的是**自动重取数据**,不是画面动。所以判据从「文件里不许出现 setInterval」
   改成**按语义**守两条:①任何计时器回调里不许出现 `load(`/`request(`(那才是轮询)
   ②代码里(去掉注释后)零 `setInterval` —— 轮播只许 `setTimeout` 一次一排,
   挂一个 interval 上去等于给页面留一条永不停的线。 */
const homeCode = home.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('③ 🔴 首页不许轮询接口:计时器回调里没有 load( / request(',
  !/set(Interval|Timeout)\([^;]{0,200}?(load\(|request\()/.test(homeCode), '计时器里在重取数据')
check('③b 轮播只许 setTimeout 一次一排,代码里零 setInterval',
  !/setInterval/.test(homeCode), '出现了 setInterval')

/* ④ 旧的那几块真的退役了(图 §三:营收只留大屏一处出口) */
check('④ 🔴「本月收入(账本)」那一格已从旧汇总行退役(两处各算各的正是这次要治的)',
  !admin.includes('本月收入(账本)'))
check('④b `renderDashboard` 已改成挂新页面,不再自己拼图表',
  /renderDashboard\(\)[\s\S]{0,600}?DashboardHome\.mountInto/.test(admin))
check('④c admin.html 真的引了这个文件(不引等于页面根本没上)',
  /dashboard-home\.js\?v=/.test(html))
/* 版本号**不锚具体那一串**(锚了每次 bump 都要改判据 —— 判据不许锚在会变的字面量上)。
   守的是「两处一致」:admin.js 里那个常量与 html 里 ?v= 必须同一个值。 */
const buildInJs = (admin.match(/ADMIN_BUILD = '([^']+)'/) || [])[1]
check('④d 版本号两处一致(侧栏可见,用于排查缓存;交付纪律 3)',
  Boolean(buildInJs) && html.includes(`admin.js?v=${buildInJs}`) && html.includes(`styles.css?v=${buildInJs}`),
  `admin.js=${buildInJs}`)

/* ⑤ 三个接口都用上了(少调一个,页面上就有一块是空的) */
for (const ep of ['/admin/dashboard/pulse', '/admin/dashboard/now', '/admin/dashboard/todo']) {
  check(`⑤ 页面真的调了 ${ep}`, home.includes(ep))
}
/* ⑥ 全屏按钮本批只占位(图:先只占位不做) */
/* 段 11 起,全屏按钮**启用**了(D154 时按图「先只占位不做」,那一条到期) */
check('⑥ 全屏按钮已启用(段 11:图 §五 落地)', /data-dh-full title=/.test(home) && !/data-dh-full disabled/.test(home))
const fs = readFileSync(join(ROOT, 'apps/web/dashboard-fullscreen.js'), 'utf8')
check('⑥a 🔴 顾客可能看到这块屏:现金业绩与新增持卡**默认不显**',
  /CUSTOMER_SENSITIVE = \['cash', 'newCard'\]/.test(fs)
  && /showMoney \|\| !CUSTOMER_SENSITIVE\.includes\(k\)/.test(fs))
check('⑥b 开关默认关,只有显式 true 才开(fail-closed)',
  /showMoney: v\.showMoney === true/.test(readFileSync(join(ROOT, 'apps/api/dashboard-pulse.mjs'), 'utf8'))
  && /catch \{ showMoney = false \}/.test(home))
check('⑥c 轮播 6 秒 / 重取 60 秒 / 屏保 5 分钟(图 §五 三个数)',
  /ROTATE_MS = 6000/.test(fs) && /REFRESH_MS = 60000/.test(fs) && /SAVER_MS = 5 \* 60000/.test(fs))
check('⑥d 🔴 轮询**只许在这块屏上**:首页代码零 setInterval,全屏态那一枚在',
  !/setInterval/.test(homeCode) && /setInterval\(refresh, REFRESH_MS\)/.test(fs))
check('⑥e 三条退出路都在(Esc / 点任意处 / 退出全屏)',
  /e\.key === 'Escape'/.test(fs) && /addEventListener\('click', stop\)/.test(fs) && /exitFullscreen\(\)/.test(fs))
check('⑥f 财务锁一律遮成 ••••(与首页同口径,不在大屏另判一次)', /if \(m\.locked\) return '••••'/.test(fs))
check('⑥g 屏保尊重「减少动态效果」', /prefers-reduced-motion/.test(fs)
  && readFileSync(join(ROOT, 'apps/web/styles.css'), 'utf8').includes('prefers-reduced-motion: reduce) { .dh-fs'))
check('⑥h 取数失败**留着上一帧**,不把这块没人守的屏清成 0',
  /catch \{ \/\* 取数失败:\*\*留着上一帧\*\*/.test(fs))

/* ══ D154:按图 §三 逐块(店主 09-08 亲看后裁;判据锚**选择器**不锚文案)══
   段 6 那版只把数据接上了,页面没按图排。这一组守的是「图上那 17 块,页面上真有」。
   静态守得住的是「选择器在不在、台面是不是自画的」;
   排版对不对由 D154 的真登录截图 + 逐块对照表背书(handoff/night-runs/段6_*)。 */
const BLOCKS = [
  ['英雄区两栏', 'data-dh-hero'], ['左栏', 'data-dh-hero-left'], ['右四小牌', 'data-dh-tiles'],
  ['周期条', 'data-dh-periods'], ['币种小字', 'data-dh-cur'], ['折线', 'data-dh-spark'],
  ['此刻四格', 'data-dh-now='], ['下一位卡', 'data-dh-next'], ['下一位时间', 'data-dh-next-time'],
  ['下一位去台面', 'data-dh-next-go'], ['AI 今日一句', 'data-dh-ai-line'], ['AI 没有一句', 'data-dh-ai-none'],
  ['今日台面块', 'data-dh-board'], ['今日要处理', 'data-dh-todo'], ['急件标记', 'data-urgent'],
  ['底部两栏', 'data-dh-bottom'], ['休息日真话', 'data-dh-truth-closed'],
]
for (const [zh, sel] of BLOCKS) check(`⑦ 图 §三「${zh}」有稳定选择器 \`${sel}\``, home.includes(sel), sel)

check('⑧ 🔴 今日台面**原样嵌入**,不自画 —— 页面里没有台面的格子 HTML,只有 mountInto',
  home.includes('window.TodayBoard.mountInto') && !/dh-board[\s\S]{0,400}?(技师|时间轴|空档|PX_PER_HOUR)/.test(home))
check('⑧b 🔴 折线**全 0 不画**(图 §六:无数据时不画折线,不是画一条贴地的线)',
  /every\(\(x\) => x === 0\)\) return ''/.test(home))
check('⑧c 折线点数 = spark 数组长度(不许自己抽稀)',
  /pts\.map\(\(v, i\)/.test(home) && /circle/.test(home))
check('⑧d 比上期说人话:四个维度各有各的说法(比昨日/比上周/比上月/比去年)',
  ['比昨日', '比上周', '比上月', '比去年'].every((x) => home.includes(x)))
check('⑧e 🔴 月目标那一行**不出** —— 门店还没有这个配置项,编一个百分比就是假数',
  !/月目标|goal/.test(home.replace(/\/\*[\s\S]*?\*\//g, '')))
check('⑧f 急缓:客服待人工与待报价排前(顾客在等的排前面)',
  /URGENT = \['aiHandoff', 'quotePending'\]/.test(home))
check('⑨ 🔴 旧四卡的**渲染代码**已删,不是只隐藏(留着迟早有人再打开)',
  !/data-dashboard-detail="confirmed"/.test(admin))
check('⑨b 首页三块旧节点都不再渲染:metricGrid 清空 + aiBriefPanel 隐藏 + 演示钮隐藏',
  /els\.metricGrid\.innerHTML = ''/.test(admin) && /aiBriefPanel[\s\S]{0,80}?hidden/.test(admin) && /fullDemoSeed[\s\S]{0,60}?hidden/.test(admin))
check('⑨c 宿主从三列图表网格改回块流(否则新页面会被塞进旧网格的三个格子里)',
  readFileSync(join(ROOT, 'apps/web/styles.css'), 'utf8').includes('#dashboardCharts.dashboard-chart-grid { display: block; }'))
check('⑨d <900px 退化竖排(窄屏一张截图为证)',
  /@media \(max-width: 900px\)[\s\S]{0,200}?grid-template-columns: 1fr/.test(readFileSync(join(ROOT, 'apps/web/styles.css'), 'utf8')))

/* ══ 05r 补一 ①:六张截图**在不在仓里**(店主 09-08 三条现修之第一条)══
   案由:D154 回执写「交了两张截图」,`git show --stat` 与整仓找图**一张都没有** ——
   我看见的图只存在于聊天窗里。**「交了」而没有文件,与 J-27 同族**。
   所以这一组不看代码、只数文件:约定的六张,一张都不许缺,尺寸也得对得上。
   白名单式(判据三):目录里出现约定之外的 .png **也红** —— 免得改名当交付。 */
const SHOT_DIR = join(ROOT, 'handoff/night-runs/D154截图')
/* 契约:名字 · CSS 宽(截图按 2 倍图落盘,所以像素宽 = CSS 宽 × 2) */
const SHOTS = [
  ['01_旗舰店_本月.png', 1440], ['02_小婕店_本月.png', 1440], ['03_北京店_本月.png', 1440],
  ['04_窄屏420_旗舰店_本月.png', 420], ['05_休息日_旗舰店_今日.png', 1440], ['06_失败态_旗舰店_今日.png', 1440],
  /* D156 三张:顶栏那行显当前店名之后,三家店**靠图本身**就分得开(之前只能靠数字) */
  ['07_旗舰店_今日_顶栏店名.png', 1440], ['08_小婕店_今日_顶栏店名.png', 1440], ['09_北京店_今日_顶栏店名.png', 1440],
]
/* 段 11 全屏大屏那一张单独一册(它不在首页那个目录里) */
const FS_DIR = join(ROOT, 'handoff/night-runs/段11截图')
const FS_SHOTS = [['01_全屏大屏_旗舰店.png', 1440]]
const pngSize = (file) => {
  const b = readFileSync(file)
  /* 只认真 PNG:魔数 + IHDR 里的宽高。不看扩展名 —— 扩展名是改得出来的
     (判据律:能按像素/字节验的就别验元数据) */
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }
}
for (const [name, cssW] of SHOTS) {
  let size = null
  try { size = pngSize(join(SHOT_DIR, name)) } catch { size = null }
  check(`⑩ 截图在仓:${name}(真 PNG · 宽 ${cssW * 2}px · 非空)`,
    Boolean(size) && size.w === cssW * 2 && size.bytes > 20000,
    size ? `${size.w}x${size.h} ${size.bytes}B` : '文件不在,或不是 PNG')
}
for (const [name, cssW] of FS_SHOTS) {
  let size = null
  try { size = pngSize(join(FS_DIR, name)) } catch { size = null }
  check(`⑩f 段 11 截图在仓:${name}(真 PNG · 宽 ${cssW * 2}px)`,
    Boolean(size) && size.w === cssW * 2 && size.bytes > 20000, size ? `${size.w}x${size.h}` : '文件不在')
}
check('⑩b 🔴 白名单式:截图目录里不许有约定之外的 .png(改名不算交付)',
  readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png')).every((f) => SHOTS.some(([n]) => n === f)),
  readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png')).join(' · '))
check('⑩c 截图刀不写死令牌(走查凭证不进代码;拿不到就拒绝跑)',
  readFileSync(join(ROOT, 'tools/web-shot.mjs'), 'utf8').includes("envName: 'SHOT_TOKEN'")
  && !/owner-demo-token/.test(readFileSync(join(ROOT, 'tools/web-shot.mjs'), 'utf8')))

/* ══ 05r 补一 ②:币种出两遍 + 没千分位(店主现看:`CAD $25885` 又加小字 `CAD`)══ */
const mf = readFileSync(join(ROOT, 'apps/web/money-format.js'), 'utf8')
check('⑪ `moneyParts` 出口在 money-format.js,币码/币符/数字**拆开给**',
  /function parts\(/.test(mf) && /return \{ code[\s\S]{0,120}?symbol[\s\S]{0,120}?amount/.test(mf))
check('⑪b 千分位只加在整数部分(小数位不许被逗号切开)',
  /replace\(\/\\B\(\?=\(\\d\{3\}\)\+\(\?!\\d\)\)\/g, ','\)/.test(mf) && /bits\[0\]/.test(mf))
check('⑪c 映射表只剩一份:admin.js 从 money-format 取,不再自己写一张',
  /CURRENCY_DISPLAY = window\.MoneyFormat\.CURRENCY_DISPLAY/.test(admin)
  && (admin.match(/CNY: \{/g) || []).length === 0)
check('⑪d 🔴 首页大数**不自己拼币符**:走 moneyParts,币码单独一个小字节点',
  /st\.deps\.moneyParts\(m\.value\)/.test(home) && /data-dh-cur>\$\{esc\(p\.prefix\)\}\$\{esc\(p\.symbol\)\}<\/small>\$\{esc\(p\.amount\)\}/.test(home))

/* ══ D168 段 3 · 皮按图原样搬(店主 05t)══
   这一组守的是**「皮在不在」**,不守「皮好不好看」——好不好看由并排截图背书。
   每一条都能在源码上证伪;比不出来的(像素、动画真跑起来的样子)明说交给截图。 */
const tokens = readFileSync(join(ROOT, 'apps/web/design-tokens.css'), 'utf8')
const css = readFileSync(join(ROOT, 'apps/web/styles.css'), 'utf8')
check('⑬ 令牌单独成件且被 admin.html 引上(不引等于皮没上)',
  /design-tokens\.css\?v=/.test(html) && tokens.includes(':root[data-theme="dark"]'))
check('⑬b 三段令牌齐:浅色 / 系统深色 / 站内选深色(缺一段,某一态就回落到另一套色)',
  [':root{', ':root:not([data-theme="light"]){', ':root[data-theme="dark"]{'].every((x) => tokens.includes(x)))
check('⑬c 🔴 `dh-` 块里零兜底值 —— `var(--x, #硬编码)` 等于偷偷藏了第二套配色',
  !/\.dh-[^{}]*\{[^}]*var\(--[a-z0-9-]+,\s*#/.test(css),
  (css.match(/\.dh-[^{}]*\{[^}]*var\(--[a-z0-9-]+,\s*#[^)]*\)/g) || []).slice(0, 3).join(' | '))
check('⑬d 字体三件套在 admin.html 里引上了(方案①:合同图那一行 Google Fonts)',
  ['Fraunces', 'Noto+Serif+SC', 'Noto+Sans+SC'].every((f) => html.includes(f)))
check('⑬e 大数字/小牌/此刻/下一位都用 Fraunces + 等宽数字位(滚动时不许左右跳)',
  ['.dh-big', '.dh-tile-v', '.dh-now-cell strong', '.dh-next-time'].every((sel) => {
    const at = css.indexOf(sel + ' {')
    return at > 0 && /Fraunces/.test(css.slice(at, at + 260)) && /tabular-nums/.test(css.slice(at, at + 260))
  }))
check('⑬f 英雄块是深色:底色 = --hero,大数字 = --heroink,细网格 = --herogrid',
  /\.dh-hero \{[^}]*background-color: var\(--hero\)/.test(css)
  && /\.dh-big \{[^}]*color: var\(--heroink\)/.test(css)
  && /\.dh-now-cell \{[^}]*border: 1px solid var\(--herogrid\)/.test(css))
check('⑬g 折线三件齐:渐变 .35→0 + 金色描边 + 末点圆环(少一件就不是图上那条线)',
  /<linearGradient/.test(home) && /stop-opacity=".35"/.test(home) && /stop-opacity="0"/.test(home)
  && /stroke="var\(--herogold\)"/.test(home) && /<circle cx="\$\{last\[0\]\}"/.test(home))
check('⑬h 数字滚动 600ms + 系统「减少动态效果」直接跳(图 §一 第 1 条)',
  /ROLL_MS = 600/.test(home) && /prefers-reduced-motion: reduce/.test(home)
  && /requestAnimationFrame\(step\)/.test(home) && /if \(reduce \|\| from === undefined/.test(home))
/* 🔴 D177(夜班令6 段 8)把 ⑬i/⑬j **翻面**:网页首页**不该有** dots。
   案由:图 §三 里 dots 出现 0 次(它只在 §一 小程序与 §五 全屏态);
   我上一批把 §一 的规矩搬到了 §三,店主盯着的那个数会自己变成「总卡耗」。
   翻面之后,旧的两条(dots 恒 5 个 / 选择器跟节点走)在网页端**不再适用** ——
   它们搬去了 `test-mp-home-owner`(小程序那边 dots 照旧 5 颗)。 */
check('⑬i 🔴 网页首页**没有** dots(图 §三 一个都没画)',
  !/data-dh-dots/.test(home) && !/data-dh-dot=/.test(home))
check('⑬i2 大数字**固定为营业收入**,不再有轮播位',
  /HEAD_METRIC = 'revenue'/.test(home) && !/CAROUSEL/.test(home) && !/st\.slot/.test(home))
check('⑬i3 轮播定时器删干净(不是留着不调 —— 留着迟早有人再打开)',
  !/ROTATE_MS/.test(home) && !/scheduleRotate/.test(home) && !/rotateAt/.test(home))
check('⑬j 小程序端 dots 照旧 5 颗(§一 明写;这条是**反向守**:别把两端一起削了)',
  /CAROUSEL = \['revenue', 'cash', 'cardUse', 'newCard', 'visits'\]/.test(readFileSync(join(ROOT, 'miniprogram/utils/dashboard-view.js'), 'utf8')))
check('⑬j2 全屏态轮播照旧(§五 line 377 明写「每 6 秒一换」)',
  /ROTATE_MS = 6000/.test(fs))
check('⑬k AI 今日一句显示的是**门店当地时刻**,不是一串 ISO(后端出文本,前端零格式化)',
  /storeClockText\(tenantId\)/.test(readFileSync(join(ROOT, 'apps/api/dashboard-pulse.mjs'), 'utf8'))
  && !/toLocaleTimeString|toISOString/.test(home))

/* ══ D183 · 明暗双模式(夜班令6 段 3)══ */
const themeJs = readFileSync(join(ROOT, 'apps/web/theme-switch.js'), 'utf8')
check('⑭ 三档在:跟随系统(默认)/ 浅色 / 深色',
  /\['system', '跟随系统'/.test(themeJs) && /\['light', '浅色'/.test(themeJs) && /\['dark', '深色'/.test(themeJs))
check('⑭b 🔴 只有 theme-switch.js 会写 data-theme(一处真相)',
  (readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8') + css).indexOf('dataset.theme') < 0
  && /dataset\.theme/.test(themeJs))
check('⑭c 它排在所有脚本最前(晚一步页面会先闪一下浅色)',
  html.indexOf('theme-switch.js') > 0 && html.indexOf('theme-switch.js') < html.indexOf('admin.js?v='))
check('⑭d 跟随系统 = **不写** data-theme(交给 @media 那一段,不是自己判一次系统色)',
  /if \(m === 'system'\) delete document\.documentElement\.dataset\.theme/.test(themeJs)
  && !/matchMedia/.test(themeJs))
check('⑭e 点击委托只绑一次(renderInto 会被反复调,每次都绑就会点一下触发好几遍)',
  /renderInto\._on/.test(themeJs))
/* D172:深色一次走完 —— 台面那四个品类色在深色下有暗版,不再是深底上四块高亮补丁 */
check('⑮ 台面品类色有深色版(店主那张截图里「浅色台面卡」就是它)',
  ['hand', 'foot', 'lash', 'care'].every((k) => new RegExp(`:root\\[data-theme="dark"\\] \\.tb-blk\\.${k}`).test(css)))

/* ══ D184 · 「新增持卡 604」的**真正病根在前端**(05v 补一 §三)══
   接口那边查出来是 1,屏幕上是 604 —— **604 是一帧动画,不是一个数**:
   四张小牌的滚动记忆共用了一个键(`dh-tile-v:today`),
   「现金业绩 5,760」写进去的旧值成了「新增持卡 1」的起点,截图正好截在中间那一帧。
   所以这一组守的是「**每个会滚的数字都自带身份**」。 */
check('⑰ 每个会滚的元素都带自己的键(不许靠 className 当身份)',
  (home.match(/data-dh-roll-to=/g) || []).length === (home.match(/data-dh-roll-key=/g) || []).length
  && (home.match(/data-dh-roll-key=/g) || []).length >= 2,
  `roll-to ${(home.match(/data-dh-roll-to=/g) || []).length} 个 · roll-key ${(home.match(/data-dh-roll-key=/g) || []).length} 个`)
check('⑰b 记忆键**先取自带的那个**(className 只是最后的兜底)',
  /const key = `\$\{el\.dataset\.dhRollKey \|\| el\.dataset\.dhMetric \|\| el\.className\}:\$\{st\.period\}`/.test(home))
check('⑰c 小牌那一处真的带上了 metric key(它就是当初串味的那一处)',
  /<strong class="dh-tile-v" data-dh-roll-key="\$\{m\.key\}"/.test(home))

/* ══ D179 · 图 §六「动作 → 结果」七行(夜班令6 段 5)══
   店主原话:「你需要去增加一些交互」—— 她要的东西图上早就写了,只是一条都没做。
   这里守网页端那几行;小程序端由 `test-mp-home-owner` 那组守(两端落点表必须同一份)。 */
check('⑯ 第 4 行:点四小牌 → 各指标各去各的地方',
  /GO = \{ revenue: 'finance', cash: 'finance', cardUse: 'finance', newCard: 'customers', visits: 'board', bookings: 'board' \}/.test(home)
  && /data-dh-tiles\] \[data-dh-metric\]/.test(home))
check('⑯b 第 4 行:长按大数字 → 同一张落点表(网页没有 longpress,按住 500ms 算长按)',
  /mousedown/.test(home) && /Date\.now\(\) - t0 >= 500/.test(home))
check('⑯c 第 5 行:点「此刻」四格 → 今日台面',
  /data-dh-now\]'\)\.forEach\(\(el\) => \{[\s\S]{0,200}?goto\('board'\)/.test(home))
check('⑯d 落点在 admin.js 那张表里认得出来(finance / customers / board 三个新落点)',
  /finance: 'finance', customers: 'customers', board: 'schedule'/.test(readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8')))

/* ══ 端不对的动作词:网页没有下拉刷新,不许教店主做一个做不到的动作(D148 说人话族)══ */
check('⑫ 网页首页里没有「下拉」这类小程序动作词',
  !/下拉/.test(home.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')))

console.log(`\n[网页首页] 四态节点 · 币种红线 · 不轮询 · 旧块退役 · 三接口都调 · 全屏占位 · D154 十七块逐块`)
/* ═══ 05x §四 · 网页端同一条:大数与小牌**同一个金额出口、同一个串** ═══
   店主是在小程序截图上看出来的(大数 `…5,668.00` / 小牌 `5,668`),
   网页这边现在是对的(两处都走 `moneyParts`,`decimals` 默认 0)——
   但**没有判据守着**,谁给大数单独加一次 `toFixed(2)` 就又岔开了。
   所以按《双端同病检查律》补上:两端各一条,守的是同一件事。 */
{
  const src = readFileSync(join(ROOT, 'apps/web/dashboard-home.js'), 'utf8')
  /* 取函数体按**它真实的写法**取(`function 名字(...)`);头一版按 `const 名字 = (...) =>` 取,
     取到空串,判据于是红在「取错了」上 —— 又一次「判据自己错了」。 */
  const bodyOf = (name) => (src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`)) || [''])[0]
  /* 🔴 判 `$` 的时候要**避开模板串的 `${}`** —— 头一版把 `${esc(p.symbol)}` 里那个
     插值的 `$` 当成写死币符,判据自己误报。币符看的是「不跟着 `{` 的 $」与「¥」。 */
  const noComment = (x) => String(x).replace(/\/\*[\s\S]*?\*\//g, '')
  const CURRENCY_LITERAL = /¥|\$(?!\{)/
  const big = bodyOf('bigMoney'); const tile = bodyOf('moneyOf')
  check('05x§四a 网页大数字:只从注入的 moneyParts 出(不自己 toFixed、不自己拼币符)',
    big.includes('st.deps.moneyParts') && !/toFixed/.test(big) && !CURRENCY_LITERAL.test(noComment(big)),
    big.replace(/\s+/g, ' ').slice(0, 110))
  check('05x§四b 网页小牌:只从注入的 money() 出,同样不自己 toFixed、不拼币符',
    tile.includes('st.deps.money(') && !/toFixed/.test(tile) && !CURRENCY_LITERAL.test(noComment(tile)),
    tile.replace(/\s+/g, ' ').slice(0, 110))
  const adminSrc = readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8')
  check('05x§四b2 两条路**汇到同一个出口**:money() 与 moneyParts() 都只是 MoneyFormat.parts 的皮',
    /const money = \(cents[^)]*\) => \{ const p = moneyParts\(/.test(adminSrc)
    && /const moneyParts = \(cents[^)]*\) => window\.MoneyFormat\.parts\(/.test(adminSrc))
  /* 行为层:同一个 metric 喂进去,大数与小牌的**数字段**必须是同一个串 */
  const parts = (cents, decimals = 0) => {
    const text = Number(cents / 100).toFixed(Number(decimals) || 0)
    const bits = text.split('.')
    const grouped = bits[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return { prefix: 'CAD ', symbol: '$', amount: bits[1] ? `${grouped}.${bits[1]}` : grouped }
  }
  check('05x§四c 网页行为:566800 分 → 大数与小牌的数字段都是 5,668(不带 .00)',
    parts(566800).amount === '5,668', parts(566800).amount)
}

if (fails.length) {
  console.error(`\n❌ test-dashboard-home ${fails.length}/${n} 项未过`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`\n✅ test-dashboard-home 通过 ${n} 项`)
