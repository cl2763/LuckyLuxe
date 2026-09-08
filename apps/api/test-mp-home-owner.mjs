/* 段 9 · 小程序商家端首页「老板视角」按图 v3.2 §一 重画

   为什么这把刀能在常驻回归里跑:页面要显示的**每一句话**都由
   `miniprogram/utils/dashboard-view.js` 的纯函数算出来 —— 喂它三份数据,逐句对。
   像素与交互由 DevTools 截图背书(`handoff/night-runs/段9截图/`),两者分工写在这儿,
   免得下一个人以为静态全绿就等于页面对了(L1 末端验证律)。

   守三层:
   ① **图 §一 那几块在**(选择器,不锚文案);旧块真的退役了(删掉不是隐藏);
   ② **出句口径**:零回落 / 不自己拼币符 / 不编月目标 / 上期 0 不显示箭头 / 全 0 不画折线;
   ③ **与网页端同一份数据**:两端读的是同样三条接口(一份数据两端渲染律)。 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const requireCjs = createRequire(import.meta.url)
const view = requireCjs(join(ROOT, 'miniprogram/utils/dashboard-view.js'))
const wxml = readFileSync(join(ROOT, 'miniprogram/pages/merchant/home/index.wxml'), 'utf8')
const pageJs = readFileSync(join(ROOT, 'miniprogram/pages/merchant/home/index.js'), 'utf8')
const webHome = readFileSync(join(ROOT, 'apps/web/dashboard-home.js'), 'utf8')

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ═══ ① 图 §一 逐块(判据锚**选择器**,不锚文案)═══ */
const BLOCKS = [
  ['周期条(今日/本周/本月/本年)', 'data-dh-periods'],
  ['营业收入大数', 'data-dh-metric="revenue"'],
  ['比上期', 'data-delta'],
  ['折线', 'data-dh-spark'],
  ['五个小数一行', 'data-dh-smalls'],
  ['今日预约那格的实时副行', 'data-dh-live'],
  ['截至行', 'data-dh-asof'],
  ['AI 今日一句', 'data-dh-ai-line'],
  ['AI 没有一句', 'data-dh-ai-none'],
  ['今日预约前 3 条', 'data-dh-next3'],
  ['今日要处理', 'data-dh-todo'],
  ['急件标记', 'data-urgent'],
  ['休息日真话', 'data-dh-truth-closed'],
]
for (const [zh, sel] of BLOCKS) check(`①「${zh}」有稳定选择器 \`${sel}\``, wxml.includes(sel), sel)
for (const [zh, st] of [['加载中', 'loading'], ['取数失败', 'failed'], ['正常', 'ready']]) {
  check(`①b ${zh}态有自己的节点标记`, wxml.includes(`data-dh-state="${st}"`))
}
check('①c 三态**互斥**(wx:if / wx:elif / wx:else,不是三个各自判断)',
  /dhState==='loading'/.test(wxml) && /wx:elif="\{\{dhState==='failed'\}\}"/.test(wxml))
check('①d 🔴 失败态不画数(那一支里没有任何指标节点)',
  !/data-dh-state="failed"[\s\S]{0,400}?data-dh-metric/.test(wxml))
check('①e 🔴 取数失败时先把手上的数清掉(不显示旧数)', /dh: null, dhState: 'failed'/.test(pageJs))
check('①f 小程序端失败态用「下拉重试」(网页端才是「点一下重试」—— 待裁 #2 裁的两端不同)',
  /下拉重试/.test(wxml))

/* ═══ ② 旧块真的退役了(删掉不是隐藏)═══ */
check('② 🔴 老板端旧的「一屏横条」整段已删(留着就成了一页两套)',
  !/老板端:一屏横条 ================= -->\s*\n\s*<block wx:else>/.test(wxml)
  && wxml.includes('老板端旧块:整段退役'))
check('②b 快捷格取消(图 §一:底部导航四键还在,快捷格没了)', !/quickGrid|快捷格</.test(wxml))

/* ═══ ③ 出句口径:纯函数逐句对 ═══ */
const money = (c) => `CAD $${(c / 100).toFixed(0)}`
const mk = (over = {}) => ({
  currency: 'CAD', currencyDisplay: { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false },
  settled: { state: 'open' }, locked: false,
  metrics: [
    { key: 'revenue', value: 248600, spark: [1, 2, 3, 4, 5, 6, 7], delta: { percent: 18, basis: 100 } },
    { key: 'cash', value: 312000, spark: [], delta: { percent: 9, basis: 100 } },
    { key: 'cardUse', value: 94000, spark: [], extra: { times: 3, timesUnit: '次' } },
    { key: 'newCard', value: 2, spark: [] },
    { key: 'visits', value: 11, spark: [], delta: { percent: -2, basis: 50 } },
    { key: 'bookings', value: 12, spark: [] },
  ],
  ...over,
})
const now = { closed: false, total: 12, doing: 3, waiting: 2, done: 7, next: null }
const todo = { items: [{ key: 'notePending', n: 3 }, { key: 'aiHandoff', n: 2 }, { key: 'quotePending', n: 0 }] }
const built = view.buildOwnerHome({ pulse: mk(), now, todo, period: 'today', nowHM: '14:32', storeMoney: money })

check('③ 大数按**下发的那份 currencyDisplay** 出(页面自己不拼币符)',
  built.headValue === 'CAD $2,486.00', built.headValue)
check('③b 五个小数**顺序就是图上的顺序**',
  built.smalls.map((s) => s.key).join(',') === 'cash,cardUse,newCard,visits,bookings',
  built.smalls.map((s) => s.key).join(','))
check('③c 今日预约那格带实时副行「在做 N · 待到店 N」',
  built.smalls[4].sub === '在做 3 · 待到店 2', built.smalls[4].sub)
check('③d 🔴 换到本周,今日预约格改叫「本期预约」且副行不显示',
  (() => { const w = view.buildOwnerHome({ pulse: mk(), now, todo, period: 'week', nowHM: '14:32', storeMoney: money })
    return w.smalls[4].label === '本期预约' && w.smalls[4].sub === '' })())
check('③e 比上期在四个维度上说人话(比昨日/比上周/比上月/比去年)',
  ['today', 'week', 'month', 'year'].map((p) => view.buildOwnerHome({ pulse: mk(), now, todo, period: p, nowHM: '1', storeMoney: money }).headDelta.text)
    .every((t, i) => t.includes(['比昨日', '比上周', '比上月', '比去年'][i])))
check('③f 🔴 上期是 0 → **不显示箭头**(不显示 ∞/NaN)',
  view.deltaOf({ delta: { percent: 999, basis: 0 } }, 'today') === null)
check('③g 🔴 全 0 不画折线(不是画一条贴地的线)',
  view.buildOwnerHome({ pulse: mk({ metrics: mk().metrics.map((m) => ({ ...m, spark: [0, 0, 0, 0, 0, 0, 0] })) }), now, todo, period: 'today', nowHM: '1', storeMoney: money }).spark.length === 0)
check('③h 🔴 拿不到值出「—」,不编 0(零回落)',
  view.moneyText({ value: null }, money) === '—' && view.countText({ value: undefined }) === '—')
check('③i 财务锁遮成 ••••(不是显示 0)',
  view.moneyText({ locked: true, value: 123 }, money) === '••••')
check('③j 🔴 月目标恒不出现(门店没有这个配置项 —— 编一个百分比就是假数)',
  built.goal === null && !/月目标/.test(wxml))
check('③k 截至行说真话:未日结说未日结', built.asOf.includes('今日未日结,实时'), built.asOf)
check('③l 已日结要说「确认于」',
  view.asOfText({ settled: { state: 'closed', confirmedAt: '21:05' } }, '1').includes('确认于 21:05'))
check('③m 要处理:0 的不出现,顾客在等的两项排前面',
  built.todos.map((t) => t.key).join(',') === 'aiHandoff,notePending', built.todos.map((t) => t.key).join(','))
check('③n 全 0 换一句话', view.buildOwnerHome({ pulse: mk(), now, todo: { items: [] }, period: 'today', nowHM: '1', storeMoney: money }).todoEmpty === true)

/* ═══ ④ 与网页端同一份数据(一份数据两端渲染律)═══ */
for (const ep of ['/admin/dashboard/pulse', '/admin/dashboard/now', '/admin/dashboard/todo']) {
  check(`④ 小程序读的是同一条接口 ${ep}`, pageJs.includes(ep) && webHome.includes(ep))
}
check('④b 🔴 页面零计算零拼串:句子都从 `buildOwnerHome` 出',
  /buildOwnerHome\(/.test(pageJs) && !/toFixed\(/.test(pageJs))
check('④c 单页没超 600 行(公约③)', pageJs.split('\n').length <= 600, String(pageJs.split('\n').length))

/* ═══ ⑤ 币种红线:钱按**这次接口下发的币种**走,不吃客户端缓存 ═══ */
const pulseMod = readFileSync(join(ROOT, 'apps/api/dashboard-pulse.mjs'), 'utf8')
check('⑤ 后端 pulse 一并下发 `currencyDisplay`(币符怎么摆也由后端说了算)',
  /currencyDisplay: currencyDisplayOf\(tenantCurrencyCodeOrNull\(tid\)\)/.test(pulseMod))
const viewSrc = readFileSync(join(ROOT, 'miniprogram/utils/dashboard-view.js'), 'utf8')
check('⑤b 按**下发的那份**格式化,出口在 dashboard-view;页面一个格式化动作都不做',
  /makeMoneyFor\(pulse && pulse\.currencyDisplay, cur\)/.test(viewSrc)
  && !/storeCurrencyDisplay\(/.test(pageJs) && !/toFixed\(/.test(pageJs))
check('⑤c 🔴 拿不到币种 → 一个钱数都不出(fail-closed,与 D140 同口径)',
  view.buildOwnerHome({ pulse: mk({ currency: null }), now, todo, period: 'today', nowHM: '1', storeMoney: money }).headValue === '—')
check('⑤d 换一家 CNY 店,钱就该按 ¥ 出(不是回落成旗舰店的 CAD)',
  (() => { const cny = view.buildOwnerHome({ pulse: mk({ currency: 'CNY', currencyDisplay: { prefix: '', symbol: '¥', trimZeroDecimals: true } }),
      now, todo, period: 'today', nowHM: '1',
      moneyFor: (c, code) => { const f = { CNY: { p: '', s: '¥' }, CAD: { p: 'CAD ', s: '$' } }[code]; return `${f.p}${f.s}${(c / 100).toFixed(0)}` } })
    return cny.headValue === '¥2486' })())

/* ═══ ⑦ 段 10 · 员工打卡门(图 v3.2 §二 两态)═══ */
check('⑦ 没打卡:大屏位置只有一个钮 + 今天的班次一句',
  wxml.includes('data-clock-gate') && wxml.includes('data-clock-shift') && wxml.includes('data-clock-in'))
check('⑦b 🔴 打卡失败:钮不收起、说清原因、**不进大屏**(没成功不许演成成功)',
  wxml.includes('data-clock-err') && /clockErr: clockFailText\(e\)/.test(pageJs)
  && !/showBoard: true[\s\S]{0,80}?clockErr/.test(pageJs))
check('⑦c 打了卡:角标说真话(已打卡几点 / 已下班几点)',
  wxml.includes('data-clock-badge') && /已下班 \$\{/.test(readFileSync(join(ROOT, 'miniprogram/utils/dashboard-view.js'), 'utf8')))
check('⑦d 🔴 休息日 / 没排班**不出打卡钮**,大屏直接显示,顶一句「今天没有你的班」',
  (() => { const g = view.clockGate(null, { scheduled: false })
    return g.state === 'off' && g.showButton === false && g.showBoard === true && g.note === '今天没有你的班' })())
check('⑦e 没打卡 → 门关着(大屏不出)',
  (() => { const g = view.clockGate({ today: null }, { scheduled: true })
    return g.state === 'gate' && g.showBoard === false && g.showButton === true })())
check('⑦f 打了上班卡 → 门开,角标带打卡时刻,右侧给「下班打卡」',
  (() => { const g = view.clockGate({ today: { clockInAt: '2026-09-08T09:58:00.000Z' } }, { scheduled: true })
    return g.state === 'open' && g.showBoard === true && g.badge.includes('09:58') && g.action === 'out' })())
check('⑦g 打了下班卡 → 角标变「已下班」,不再给下班钮',
  (() => { const g = view.clockGate({ today: { clockInAt: '2026-09-08T09:58:00.000Z', clockOutAt: '2026-09-08T19:02:00.000Z' } }, { scheduled: true })
    return g.badge.includes('已下班') && g.badge.includes('19:02') && g.action === '' })())
check('⑦h 🔴 员工看不到店的五个指标(那一支里没有 revenue/cash/cardUse 这些)',
  !/data-staff-board[\s\S]{0,900}?data-dh-metric="revenue"/.test(wxml))
check('⑦i 员工维度只有今日 / 本月(不是四个)',
  view.STAFF_PERIODS.map((p) => p.key).join(',') === 'today,month')
check('⑦j 员工三个小数 = 今日单数 / 下一位 / 本周工时',
  view.staffSmalls({ perf: null, now: { total: 5, doing: 1, waiting: 2 }, week: { hours: 31 } })
    .map((x) => x.key).join(',') === 'myOrders,next,weekHours')
check('⑦k 拿不到工时出「—」,不编 0(零回落)',
  view.staffSmalls({ perf: null, now: null, week: null })[2].value === '—')
check('⑦l 走**现有考勤接口**,没另做一套',
  /\/admin\/attendance\/clock/.test(pageJs) && /\/admin\/attendance\/today/.test(pageJs))
check('⑦m `wx.getConnectedWifi` 带 fail 处理(波及面回归律四之八⑤)',
  /fail: \(\) => resolve\(\{\}\)/.test(pageJs))
check('⑦n 打卡失败那句**原样透后端**,自己不翻译不编',
  /const msg = \(err && \(err\.message \|\| err\.errMsg\)\) \|\| ''/.test(readFileSync(join(ROOT, 'miniprogram/utils/dashboard-view.js'), 'utf8')))

check('⑦o 员工端旧块退役:台面卡 / 打卡待办条 / 快捷格都不在了(图 §二)',
  !/我的今日台面 · 点击看全店/.test(wxml) && !/rowname">打卡</.test(wxml) && !/<view class="sec">快捷</.test(wxml))
check('⑦p 员工端「今日要处理」只留两项来源(待写小记 / 我的调休)',
  /<view class="sec">今日要处理<\/view>/.test(wxml))

/* ═══ ⑥ 截图落仓(夜班令 5 规矩 5:带图的段必交截图;DOM 证据不替代截图,J-32)═══
   判据**直接数文件**并读 PNG 魔数 —— 「交了」而没有文件与 J-27 同族。 */
const SHOT_DIR = join(ROOT, 'handoff/night-runs/段9截图')
const SHOTS = ['lucky-luxe_ready.png', 'jics-store_ready.png', 'luvia-bj_ready.png', 'luvia-bj_failed.png', 'luvia-bj_loading.png',
  /* 段 10 打卡门两态 + 打卡失败态。⚠️ 这三张是**造态截图**:沙箱库里没有员工账号,
     所以没能用真员工号登一次;渲染的是页面自己的分支,但不等于真员工走查(段 10 残留已登记)。 */
  'staff_gate.png', 'staff_gate_fail.png', 'staff_open.png']
for (const f of SHOTS) {
  let ok = false
  let why = '文件不在'
  try {
    const b = readFileSync(join(SHOT_DIR, f))
    ok = b.length > 20000 && b.readUInt32BE(0) === 0x89504e47
    why = `${b.length}B magic=${b.readUInt32BE(0).toString(16)}`
  } catch { /* 不在 */ }
  check(`⑥ 截图在仓:${f}(真 PNG · 非空)`, ok, why)
}
check('⑥b 白名单式:截图目录里不许有约定之外的 .png(改名不算交付)',
  readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png')).every((f) => SHOTS.includes(f)),
  readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png')).join(' · '))

console.log(`\n[段9 小程序老板视角] 图 §一 逐块 · 三态互斥 · 出句口径 · 与网页同源`)
/* ══ 05t 段 6 · 段 10 补件之二:员工首页「打卡」那一条退役 ══
   图 §二 原话:**打卡不再是一条待办,是一道门**。所以「打卡」只许出现在那道门里
   (`clock-*` 那几个类),横条待办里一条都不许有 —— 判据数的是**节点**,不是文案。 */
/* 注释先剥掉再数 —— 注释里写着「打卡不是一条待办,是一道门」,那句话是留给下一个人看的,
   把它数成违规,以后就没人敢在注释里写口径了(判据看代码,不看散文)。 */
const wxmlCode = wxml.replace(/<!--[\s\S]*?-->/g, '')
check('⑲ 员工首页待办里 0 个「打卡」节点(它只在那道门里)',
  wxmlCode.split('\n').filter((ln) => /打卡/.test(ln) && !/clock-/.test(ln)).length === 0,
  wxmlCode.split('\n').filter((ln) => /打卡/.test(ln) && !/clock-/.test(ln)).map((x) => x.trim().slice(0, 60)).join(' | '))

/* ══ D183 · 小程序也有明暗双模式(夜班令6 段 3;双端同批律)══ */
const themeUtil = readFileSync(join(ROOT, 'miniprogram/utils/theme.js'), 'utf8')
const meJs = readFileSync(join(ROOT, 'miniprogram/pages/merchant/me/index.js'), 'utf8')
const meWxml = readFileSync(join(ROOT, 'miniprogram/pages/merchant/me/index.wxml'), 'utf8')
const appJson = JSON.parse(readFileSync(join(ROOT, 'miniprogram/app.json'), 'utf8'))
check('⑳ 三档与网页端同一套语义(system 默认 / light / dark)',
  /MODES = \['system', 'light', 'dark'\]/.test(themeUtil))
check('⑳b 🔴 只有 utils/theme.js 读写这个 storage 键(一处真相)',
  /THEME_KEY = 'll-theme'/.test(themeUtil)
  && !/ll-theme/.test(meJs) && !/ll-theme/.test(readFileSync(join(ROOT, 'miniprogram/pages/merchant/home/index.js'), 'utf8')))
check('⑳c 跟随系统那一档**不加 class**(交给 @media;app.json 得开 darkmode 它才生效)',
  /m === 'light' \? 'theme-light' : \(m === 'dark' \? 'theme-dark' : ''\)/.test(themeUtil)
  && appJson.darkmode === true)
const tokensWxssEarly = readFileSync(join(ROOT, 'miniprogram/styles/tokens.wxss'), 'utf8')
check('⑳d 令牌里有站内选的那两段(.theme-light / .theme-dark)',
  /\.theme-light\{--paper/.test(tokensWxssEarly) && /\.theme-dark\{--paper/.test(tokensWxssEarly))
check('⑳e 首页与「我的」都把 class 挂在最外层 view 上(挂不上等于设置了没反应)',
  /<view class="page \{\{themeClass\}\}">/.test(wxml) && /<view class="page \{\{themeClass\}\}">/.test(meWxml))
check('⑳f 「我的」里那一行能点开三档,且 wx.showActionSheet 接了 fail(《波及面回归律》④)',
  /pickTheme\(\)/.test(meJs) && /wx\.showActionSheet/.test(meJs) && /fail: \(\) => \{\}/.test(meJs))

/* ══ 05t 段 6 · 段 9 补件之二:七柱全 0 不许「看起来有数」══
   店主 05s 现看:七根柱全 0 时首柱仍是实心高亮。两层一起守:
   ①全 0 → `spark` 整个清空(上游,图 §六「全 0 不画」);②**单根为 0 → 高度就是 0**
   (页面层,原来 `Math.max(4, …)` 给每根都垫了 4%)。只守一层都会漏。 */
check('⑱ 全 0 → spark 清空(一根都不画)',
  view.buildOwnerHome({ pulse: { currency: 'CNY', currencyDisplay: { symbol: '¥' },
    metrics: [{ key: 'revenue', value: 0, spark: [0, 0, 0, 0, 0, 0, 0] }] },
  now: {}, todo: {}, period: 'today', nowHM: '10:00', storeMoney: () => '¥0' }).spark.length === 0)
check('⑱b 页面层:0 的那一根高度就是 0(不许垫 4% 让它看起来有数)',
  /v === 0 \? 0 : Math\.max\(4,/.test(pageJs) && !/map\(\(x\) => Math\.max\(4,/.test(pageJs))

/* ══ D168 段 4 · 小程序皮按图搬(店主 05t)══
   守「皮在不在」+「说没说实话」——**字体那件做不到的事,判据要求它被说出来**,
   而不是让它悄悄退成系统字体(店主原话:「不许假装是 Noto」)。 */
const tokensWxss = readFileSync(join(ROOT, 'miniprogram/styles/tokens.wxss'), 'utf8')
const appWxss = readFileSync(join(ROOT, 'miniprogram/app.wxss'), 'utf8')
const homeWxss = readFileSync(join(ROOT, 'miniprogram/pages/merchant/home/index.wxss'), 'utf8')
const numfont = readFileSync(join(ROOT, 'miniprogram/utils/numfont.js'), 'utf8')
check('⑮ 令牌单独成件,且 app.wxss 第一件就 @import 它(不引 = 所有 var(--x) 落空)',
  /@import\s+"styles\/tokens\.wxss"/.test(appWxss) && tokensWxss.includes('page{--paper'))
check('⑮b 深色那一段在(小程序只有「跟系统」这一种深色)',
  /@media \(prefers-color-scheme: dark\)\{page\{/.test(tokensWxss))
check('⑮c 🔴 首页大屏那一段不许再写死颜色 —— 一律走令牌',
  !/\.dh-[a-z-]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(homeWxss),
  (homeWxss.match(/\.dh-[a-z-]*\{[^}]*#[0-9a-fA-F]{3,6}[^}]*\}/g) || []).slice(0, 2).join(' | '))
check('⑮d 英雄块是深色:背景 = --hero,大数字 = --heroink,金色在 dots 与选中的维度上',
  /\.dh-hero\{background:var\(--hero\)/.test(homeWxss)
  && /\.dh-big\{[^}]*color:var\(--heroink\)/.test(homeWxss)
  && /\.dh-dot-i\.on\{background:var\(--herogold\)/.test(homeWxss))
check('⑮e dots 恒 5 个且选中那个会移动(轮播名单与网页端同一份)',
  view.buildOwnerHome({ pulse: { currency: 'CNY', metrics: [] }, now: {}, todo: {}, period: 'today',
    nowHM: '10:00', storeMoney: () => '—' }).dots.length === 5
  && /\.dh-dot-i\.on\{[^}]*width:28rpx/.test(homeWxss)
  && webHome.includes("CAROUSEL = ['revenue', 'cash', 'cardUse', 'newCard', 'visits']"))
check('⑮f 轮播换指标**不发请求**:只把 headKey 换一个再跑一遍纯函数',
  /switchMetric\(e\)/.test(pageJs) && /repaintMetric\(\)/.test(pageJs)
  && !/repaintMetric\(\)\s*\{[\s\S]{0,400}?adminGet/.test(pageJs))
check('⑮g 轮播计时器**会被清掉**(onHide / onUnload),不留一条永远在跑的线',
  /onHide\(\) \{ this\.clearRotate\(\) \}/.test(pageJs) && /onUnload\(\) \{ this\.clearRotate\(\) \}/.test(pageJs))
check('⑯ 🔴 字体做不到那件事**被说出来**:numfont 明写「小程序不能引 Google Fonts」与「系统字体」',
  /不能引 Google Fonts/.test(numfont) && /系统字体/.test(numfont) && /上线批/.test(numfont))
check('⑯b 🔴 地址为空时不许假装加载成功(静默失败器族):回的是 loaded:false + why',
  /if \(!FRAUNCES_URL\)/.test(numfont) && /loaded: false, why/.test(numfont)
  && /fail: \(e\) =>/.test(numfont))
check('⑯c 首页真的调了它(留了口却没人调 = 等于没做)',
  /loadNumberFont\(\)/.test(pageJs) && /require\('\.\.\/\.\.\/\.\.\/utils\/numfont'\)/.test(pageJs))
/* 🔴 D173 双端同病:网页端查出「AI 今日一句从来没落过库」,小程序这边是同一个病的另一种长法
   —— 它读的是 pulse.aiLine,而 pulse 响应里从来没有这个字段。两端一起收在 /admin/dashboard/ai-line。 */
check('⑰ AI 今日一句两端读同一个口(小程序不再读 pulse 里那个根本不存在的字段)',
  pageJs.includes("adminGet('/admin/dashboard/ai-line')")
  /* 判据要看**代码**,不看注释 —— 注释里写着病因(「它读的是 pulse.aiLine」),
     那句话是要留给下一个人看的,不该把判据顶红(否则以后没人敢在注释里写病因)。 */
  && !/pulse\.aiLine/.test(pageJs.replace(/\/\*[\s\S]*?\*\//g, ''))
  && webHome.includes("/admin/dashboard/ai-line"))

if (fails.length) { console.error(`\n❌ test-mp-home-owner ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-mp-home-owner 通过 ${n} 项`)
