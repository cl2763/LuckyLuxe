#!/usr/bin/env node
/* 裁 #22 判据 · 小程序**三档 × 三个面**:量 computed 底色,必须等于当档令牌的值
 *
 * ══ 为什么是量 computed,不是看 class 挂没挂 ══
 * 店主 05v 补一 拍到的那张图就是反例:`theme-dark` 类**挂上了**、令牌 30 条**一条不少**,
 * 屏幕还是白的 —— 因为那些面读的是**字面色**,压根不读令牌。
 * 所以「类挂上了」是废判据(缺陷存在时照样绿),得量**算出来的底色**。
 * 归族 J-37:「在不在」不等于「看得见」;这里是「令牌在不在」不等于「面吃不吃它」。
 *
 * ══ 两层,缺一层就有盲区 ══
 * ①**行为层**(要开发者工具):三档各切一次,量 `.page` / `.dh-card` / `.card` 的
 *   `background-color`,必须等于该档 `--paper` / `--card` 的值;
 * ②**静态层**(不要工具,CI 常驻):那几个面的 WXSS 规则里**零字面色** ——
 *   `.rowcard` / `.nudge` / `.board` 这三个是**员工端/有提示时才渲染**的,
 *   这台夹具上够不着(老板身份),所以它们只有静态层。**如实写在输出里,不拿别的顶。**
 *
 * 用法:MP_AUTOMATOR=<模块绝对路径> node tools/mp-theme-proof.mjs
 *   (没给 MP_AUTOMATOR 时只跑静态层,并明说行为层没跑)
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ── 令牌值从 `tokens.wxss` 现读(判据不许自己抄一份色值 —— 那就成了第二处真相)── */
const TOK = readFileSync(new URL('../miniprogram/styles/tokens.wxss', import.meta.url), 'utf8')
/* 🔴 现测栽过一次:`indexOf('.theme-dark{')` 找到的是**注释里**提到的那一串
   (注释里写着「不写成 `.theme-light,.theme-dark{...}` 的共用规则」),
   于是切出来的「块」是一段注释,取到的令牌值是空的 → 深色两条判据自己 NaN 了。
   同族:**判据看代码不看注释**。改成按行首锚定的真规则块。 */
const blockOf = (sel) => (TOK.match(new RegExp(`^\\${sel}\\{[^}]*\\}`, 'm')) || [''])[0]
const tokenIn = (block, name) => (block.match(new RegExp(`--${name}:\\s*([^;}]+)`)) || [])[1]?.trim() || ''
const LIGHT = blockOf('.theme-light')
const DARK = blockOf('.theme-dark')
check('①0 令牌文件里三段都在(浅 / 深 / 跟系统)', Boolean(LIGHT) && Boolean(DARK) && TOK.includes('prefers-color-scheme: dark'),
  `light=${Boolean(LIGHT)} dark=${Boolean(DARK)}`)

const hexToRgb = (h) => {
  const s = h.replace('#', '').trim()
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return `rgb(${parseInt(f.slice(0, 2), 16)}, ${parseInt(f.slice(2, 4), 16)}, ${parseInt(f.slice(4, 6), 16)})`
}
const want = {
  light: { paper: hexToRgb(tokenIn(LIGHT, 'paper')), card: hexToRgb(tokenIn(LIGHT, 'card')) },
  dark: { paper: hexToRgb(tokenIn(DARK, 'paper')), card: hexToRgb(tokenIn(DARK, 'card')) },
}
console.log(`   [令牌现读] 浅:纸=${want.light.paper} 卡=${want.light.card} · 深:纸=${want.dark.paper} 卡=${want.dark.card}`)

/* ── 静态层:这几个面的规则里不许再有字面色 ───────────────────────── */
const FILES = {
  'app.wxss': readFileSync(new URL('../miniprogram/app.wxss', import.meta.url), 'utf8'),
  'merchant/home/index.wxss': readFileSync(new URL('../miniprogram/pages/merchant/home/index.wxss', import.meta.url), 'utf8'),
  'merchant/me/index.wxss': readFileSync(new URL('../miniprogram/pages/merchant/me/index.wxss', import.meta.url), 'utf8'),
}
/* 认的是**规则块**:从 `选择器{` 到最近的 `}`。字面色 = `#xxx` 或 `rgb()/rgba()` */
const ruleOf = (src, sel) => {
  const i = src.indexOf(sel)
  if (i < 0) return null
  return src.slice(i, src.indexOf('}', i) + 1)
}
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([0-9 .,]+\)/
for (const [file, sel] of [['app.wxss', '.card {'], ['app.wxss', 'page {'],
  ['merchant/home/index.wxss', '.dh-card{'], ['merchant/home/index.wxss', '.rowcard{'],
  ['merchant/home/index.wxss', '.nudge{'], ['merchant/home/index.wxss', '.board{'],
  /* 站内三档那个选择器就住在商家「我的」这一页 —— 它自己要是白的,店主一眼就看穿了 */
  ['merchant/me/index.wxss', '.group{'], ['merchant/me/index.wxss', 'page{']]) {
  const rule = ruleOf(FILES[file], sel)
  check(`① 静态 ${file} 里 \`${sel.replace('{', '').trim()}\` 读令牌、零字面色`,
    Boolean(rule) && !LITERAL.test(rule) && rule.includes('var(--'),
    rule ? `规则原文:${rule.replace(/\s+/g, ' ').slice(0, 120)}` : '没找到这条规则')
}

/* ── 裁 #25 之三(静态):导航栏那两个色**必须逐字等于令牌** ──
   `wx.setNavigationBarColor` 只吃十六进制串,JS 里读不到 WXSS 变量,所以 `utils/theme.js`
   里有一份 `CHROME` 映射 —— 它天然是「第二处真相」的种子。这条判据把它按住:
   两个 backgroundColor 必须逐字等于 tokens.wxss 里两档的 `--paper`。 */
const THEMEJS = readFileSync(new URL('../miniprogram/utils/theme.js', import.meta.url), 'utf8')
const chromeHex = (mode) => (THEMEJS.match(new RegExp(`${mode}:\\s*\\{[^}]*backgroundColor:\\s*'([^']+)'`)) || [])[1] || ''
for (const mode of ['light', 'dark']) {
  const want = tokenIn(mode === 'light' ? LIGHT : DARK, 'paper')
  check(`①c 导航栏 ${mode} 档的底色 ≡ 令牌 --paper(${want})—— JS 那份映射不许自成一套`,
    chromeHex(mode).toLowerCase() === String(want).toLowerCase(), `theme.js 写的是 ${chromeHex(mode)}`)
}
/* 裁 #25 之三(静态):两条 tabbar 的样式里不许再有字面色,根节点要挂 theme-root + themeClass */
for (const [name, wxss, wxml, root] of [
  ['顾客端 tabbar', '../miniprogram/custom-tab-bar/index.wxss', '../miniprogram/custom-tab-bar/index.wxml', '.custom-tabbar'],
  ['商家端 tabbar', '../miniprogram/components/merchant-tabbar/index.wxss', '../miniprogram/components/merchant-tabbar/index.wxml', '.mtab'],
]) {
  const css = readFileSync(new URL(wxss, import.meta.url), 'utf8')
  const xml = readFileSync(new URL(wxml, import.meta.url), 'utf8')
  const rule = ruleOf(css, `${root}{`) || ruleOf(css, `${root} {`)
  /* 🔴 白名单式的一处例外,写明理由:`box-shadow` 的颜色**不算**字面色违规 ——
     合同图那套令牌里**没有阴影色**(三份令牌逐条比的刀 `design-token-diff` 只认那几个),
     为了这一条另加一个 `--shadow` 会让三方比对当场红。阴影带 alpha、在深色底上几乎不可见,
     影响面小于「另起一套令牌」。**登记为已知缺口**,等合同图补阴影令牌再收。 */
  const noShadow = String(rule || '').replace(/box-shadow:[^;]*;?/g, '')
  check(`①d ${name}:根规则读令牌、零字面色(box-shadow 的颜色按已知缺口豁免,理由随码)`,
    Boolean(rule) && !LITERAL.test(noShadow) && rule.includes('var(--'),
    rule ? rule.replace(/\s+/g, ' ').slice(0, 110) : '没找到根规则')
  check(`①e ${name}:根节点挂了 theme-root + {{themeClass}}(组件吃不到 page{} 那段令牌,这是它的入口)`,
    /theme-root/.test(xml) && /\{\{themeClass\}\}/.test(xml) && css.includes('@import'),
    xml.split('\n')[0].slice(0, 110))
}

/* ── 行为层:三档各切一次,量算出来的底色 ─────────────────────────── */
const AUTO = process.env.MP_AUTOMATOR
if (!AUTO || AUTO === 'skip') {
  console.log('\n⚠️  没给 MP_AUTOMATOR —— **行为层这一半本轮没跑**(不是通过)。')
  console.log('   静态层能证明「面读了令牌」,证不了「切档之后屏幕真的跟着变」——')
  console.log('   那一半只有开发者工具能给,如实写在这里。')
} else {
  const PORT = Number(process.env.MP_AUTO_PORT || 9420)
  const automator = createRequire(import.meta.url)(AUTO)
  const T = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`automator 卡住了(${ms}ms):${what}`)), ms))])
  const mp = await T((automator.connect || automator.default.connect).call(automator,
    { wsEndpoint: `ws://127.0.0.1:${PORT}`, timeout: 20000 }), 25000, 'connect')
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const setTheme = async (mode) => {
    /* 一处真相:主题只由 `utils/theme.js` 的 THEME_KEY 决定,判据也走同一个键 */
    await T(mp.evaluate((m) => { wx.setStorageSync('ll-theme', m) }, mode), 8000, `setTheme ${mode}`)
  }
  /* J-37(店主 05w §五):量颜色之前先确认这个面**真占着地方** ——
     一个宽高为 0 的节点照样有 computed 底色,拿它当「深色生效了」的证据是废判据。 */
  const bgOf = async (page, sel) => {
    const el = await T(page.$(sel), 8000, `$(${sel})`)
    if (!el) return ''
    const size = await T(el.size(), 6000, `size(${sel})`).catch(() => null)
    if (!size || !(size.width > 0 && size.height > 0)) return `(${sel} 宽高为 0,不算看得见)`
    return String(await T(el.style('background-color'), 6000, `style(${sel})`) || '')
  }
  const seen = {}
  for (const mode of ['light', 'dark', 'system']) {
    await setTheme(mode)
    await T(mp.reLaunch('/pages/merchant/home/index'), 15000, 'reLaunch 商家首页'); await sleep(2200)
    const home = await T(mp.currentPage(), 8000, 'currentPage')
    const pageBg = await bgOf(home, '.page')
    const cardBg = await bgOf(home, '.dh-card')
    /* 量的是**商家端「我的」**:站内三档那个选择器就在这一页,而且它挂了主题类。
       顾客端 `/pages/me/index` 现在没挂主题类(见下面那条覆盖率判据),量它只会量到白。 */
    await T(mp.reLaunch('/pages/merchant/me/index'), 15000, 'reLaunch 商家我的'); await sleep(2000)
    const me = await T(mp.currentPage(), 8000, 'currentPage')
    const meCard = await bgOf(me, '.group')
    seen[mode] = { pageBg, cardBg, meCard }
    if (mode === 'system') {
      /* 跟系统那一档:值必须**是浅或深其中之一**,不许是第三种颜色(那说明它谁也没跟) */
      /* 🔴 跟系统档量的是**卡片**不是 `.page`:不挂主题类时那个 view 自己没有底色
         (底是 `page{}` 那个节点画的,automator 选不到 `page`)—— 量它必然是透明,
         那是**判据选错了取样点**,不是页面错了。如实写在这儿,免得下次又当缺陷追。 */
      check(`② 跟系统档:卡片底色 ${cardBg} 是浅(${want.light.card})或深(${want.dark.card})之一(它得跟着系统走)`,
        [want.light.card, want.dark.card].includes(cardBg), JSON.stringify(seen[mode]))
      check('②b 跟系统档:首页卡片与「我的」页卡片跟的是**同一档**(一半浅一半深 = 没跟成)',
        cardBg === meCard, JSON.stringify(seen[mode]))
      continue
    }
    check(`② ${mode} 档:整页底色 == --paper(${want[mode].paper})`, pageBg === want[mode].paper, `量到 ${pageBg}`)
    check(`②b ${mode} 档:首页卡片底色 == --card(${want[mode].card})`, cardBg === want[mode].card, `量到 ${cardBg}`)
    check(`②c ${mode} 档:商家「我的」页 .group 底色 == --card(${want[mode].card})`, meCard === want[mode].card, `量到 ${meCard}`)
  }
  /* ③ 反向守:两档量出来的**不能是同一个值** —— 都相同说明切档根本没生效 */
  check('③ 反向守:浅档与深档量出来的底色不一样(一样 = 切了个寂寞)',
    seen.light?.pageBg !== seen.dark?.pageBg && seen.light?.cardBg !== seen.dark?.cardBg,
    JSON.stringify({ 浅: seen.light, 深: seen.dark }))
  /* ── 裁 #25 之一(行为):**随机抽 5 个页面**,它们自己一行主题代码都没写,
     `reLaunch` 之后根节点必须带上档位类 —— 这才证明「挂在一处公共入口」真的生效。 ── */
  const SAMPLE = ['/pages/merchant/orders/index', '/pages/me/index', '/pages/home/index',
    '/pages/merchant/workbench/index', '/pages/merchant/manage/index']
  await setTheme('dark')
  const rooted = []
  for (const path of SAMPLE) {
    try {
      await T(mp.reLaunch(path), 18000, `reLaunch ${path}`); await sleep(2000)
      const pg = await T(mp.currentPage(), 8000, 'currentPage')
      const el = await T(pg.$('.page, .pg, .wrap'), 8000, 'root')
      const cls = el ? String(await T(el.attribute('class'), 5000, 'class') || '') : '(没取到根节点)'
      rooted.push({ path, cls, 挂上了: /theme-dark/.test(cls) })
    } catch (e) { rooted.push({ path, cls: `(打不开:${e.message})`, 挂上了: false }) }
  }
  check(`④ 裁#25:随机 5 个页面(它们自己一行主题代码没写)根节点都带上了档位类`,
    rooted.every((r) => r.挂上了), JSON.stringify(rooted))
  /* 导航栏读不回来颜色,能验的是**它最后一次被设成什么**(theme.js 每次 applyChrome 都记一笔) */
  const chrome = await T(mp.evaluate(() => wx.getStorageSync('ll-theme-chrome')), 8000, 'chrome')
  check('④b 裁#25:深色档下导航栏最后一次被设成深色那两个值(WXSS 管不到它,只能这么验)',
    chrome && chrome.eff === 'dark' && String(chrome.backgroundColor).toLowerCase() === String(tokenIn(DARK, 'paper')).toLowerCase(),
    JSON.stringify(chrome))
  await setTheme('light')
  await T(mp.reLaunch('/pages/merchant/home/index'), 18000, 'reLaunch'); await sleep(1800)
  const chromeL = await T(mp.evaluate(() => wx.getStorageSync('ll-theme-chrome')), 8000, 'chrome')
  check('④c 反向守:切回浅色档,导航栏跟着换成浅色那两个值(不换 = 只设过一次)',
    chromeL && chromeL.eff === 'light' && String(chromeL.backgroundColor).toLowerCase() === String(tokenIn(LIGHT, 'paper')).toLowerCase(),
    JSON.stringify(chromeL))

  await setTheme('system')   /* J-33:收摊 —— 把夹具改过的设置还回默认 */
  console.log('   [收摊] 主题已还回「跟随系统」')
  /* 🔴 J-33 收摊 = **收文件 + 收进程**(店主 05w §六):
     不 disconnect 的话 automator 那条 socket 一直挂着,进程跑完也不退 ——
     05w 抓到的「12 小时僵尸进程」就是这么来的。 */
  try { await T(mp.disconnect(), 5000, 'disconnect') } catch { /* 断不开也不该拖住收尾 */ }
}

/* ── ④ 覆盖率:站内三档靠**页面根 view 上那个 class** 生效,所以没挂类的页面切档一点反应都没有。
   这是 05w §三 之外我自己量出来的第二半病根,数字摆在这儿,只许升不许降(待裁 #25)。 */
const { execFileSync } = await import('node:child_process')
const ROOT = new URL('..', import.meta.url).pathname
const withTheme = execFileSync('bash', ['-lc',
  `grep -rl themeClass ${ROOT}miniprogram/pages --include=*.wxml | wc -l`], { encoding: 'utf8' }).trim()
const totalPages = execFileSync('bash', ['-lc',
  `find ${ROOT}miniprogram/pages -name index.wxml | wc -l`], { encoding: 'utf8' }).trim()
/* 🔴 棘轮方向(店主 05x §二 第 2 条要求写清楚):
   这一条是**覆盖率**棘轮 —— **只许升不许降**;
   而 `tools/pre-regression.sh` 里那条「写死色」棘轮是**只许降不许升**。
   两个方向相反,搬代码的时候最容易搬错,所以各自在注释里写死一句。 */
check(`⑤ 覆盖率棘轮(**只许升**,与写死色棘轮的方向相反):${withTheme}/${totalPages} 个页面的 wxml 挂了 {{themeClass}}`,
  Number(withTheme) >= 66, `挂了 ${withTheme} · 共 ${totalPages}(差的那一个是 pages/sign —— 根节点是 <web-view>,挂不上,如实列在这)`)
console.log(`   [如实说] 站内浅/深两档目前只在 ${withTheme} 个页面生效;其余页面切档没反应(「跟随系统」那一档不受影响,它走 @media,全仓都生效)。`)

console.log(`\n[小程序三档实测] ${JSON.stringify(want)}`)
if (fails.length) { console.error(`\n❌ mp-theme-proof ${fails.length}/${n} 条未过`); process.exit(1) }
console.log(`\n✅ mp-theme-proof 通过 ${n} 条`)
process.exit(0)   /* 收摊:显式退出,不留后台连接吊着(J-33) */
