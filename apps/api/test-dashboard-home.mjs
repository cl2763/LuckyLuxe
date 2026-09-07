/* 网页后台首页(段 6)· 静态判据 —— 图 v3.1 §三/§六/§八

   为什么是静态的:页面本体跑在浏览器里,常驻回归起不了浏览器。
   所以这一把守的是**能在源码上证伪的那几条**:四种态各有各的节点、
   金额不许写死币符、首页不许轮询、旧的那几块真的退役了。
   像素与交互由段 6 的现测 DOM 证据背书(`handoff/night-runs/段6_网页首页_DOM证据_2026-09-08.md`),
   两者分工写在这里,免得下一个人以为静态全绿就等于页面对了(L1 末端验证律)。 */
import { readFileSync } from 'node:fs'
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

/* ③ 图 §八 明确不做:首页**不轮询**(全屏态除外,那是段 11) */
check('③ 🔴 首页不许轮询:页面里没有 setInterval',
  !/setInterval/.test(home), '出现了 setInterval')

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
check('⑥ 全屏按钮是 disabled 的占位(本批不做,归段 11)', /data-dh-full disabled/.test(home))

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

console.log(`\n[网页首页] 四态节点 · 币种红线 · 不轮询 · 旧块退役 · 三接口都调 · 全屏占位 · D154 十七块逐块`)
if (fails.length) {
  console.error(`\n❌ test-dashboard-home ${fails.length}/${n} 项未过`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`\n✅ test-dashboard-home 通过 ${n} 项`)
