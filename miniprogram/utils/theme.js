/* D183 · 明暗双模式(店主 2026-09-09:「可以选择晚上以及白天两种模式」)
 *
 * 三档:`system`(跟随系统,默认)/ `light` / `dark`,与网页端**同一套语义**。
 *
 * ══ 小程序这边为什么是「页面级 class」而不是 `[data-theme]` ══
 * WXSS 里没有 `:root`,页面根节点也挂不了任意属性 —— 令牌定义在 `page{}` 上,
 * 「跟随系统」那一档靠 `@media (prefers-color-scheme: dark)`(需要 app.json 里 `darkmode: true`)。
 * 站内显式选的那两档,只能在**页面最外层那个 view** 上加一个 class(`theme-light` / `theme-dark`),
 * 由 `styles/tokens.wxss` 里同名的两段令牌覆盖 `page{}` 的值。
 *
 * 🔴 一处真相:整仓只有这里读写 `THEME_KEY`,页面拿 `themeClass()` 往根 view 上挂。
 */
const THEME_KEY = 'll-theme'
const MODES = ['system', 'light', 'dark']

/* ══ 裁 #25 之三(店主 05x §二)· **导航栏与 tabbar 不归页面样式管** ══
 * 店主开 08截图/01 一眼看见:正文全深了,**顶上那条原生导航栏、底下那排 tabbar 还是白的**。
 * 原生导航栏只能用 `wx.setNavigationBarColor` 按档位设(WXSS 碰不到它);
 * tabbar 是自定义组件,得自己也吃一份档位。
 * 🔴 值不许在这里另起一套:下面这两组**必须逐字等于 `styles/tokens.wxss` 里那两段令牌**,
 *    `tools/mp-theme-proof.mjs` 有一条判据现读 wxss 逐字比对 —— 对不上就红(一件事一处真相)。 */
const CHROME = {
  light: { backgroundColor: '#faf8f3', frontColor: '#000000' },   // --paper(浅)
  dark: { backgroundColor: '#191b19', frontColor: '#ffffff' },    // --paper(深)
}

function currentTheme() {
  try { const v = wx.getStorageSync(THEME_KEY); return MODES.includes(v) ? v : 'system' } catch (e) { return 'system' }
}
function setTheme(mode) {
  const m = MODES.includes(mode) ? mode : 'system'
  try { wx.setStorageSync(THEME_KEY, m) } catch (e) { /* 存不上不影响这一次生效 */ }
  return m
}
/* 挂到根 view 的 class:`system` 时不加类,让 `@media` 那一段说了算 */
function themeClass(mode) {
  const m = mode || currentTheme()
  return m === 'light' ? 'theme-light' : (m === 'dark' ? 'theme-dark' : '')
}

/* 这一档实际要落到系统 UI 上的那两个色。`system` 档要问系统现在是深还是浅 —— 
   小程序给得到:`wx.getSystemInfoSync().theme`(旧基础库没有这个字段时按浅色办,并如实记下来)。 */
function chromeOf(mode) {
  const m = mode || currentTheme()
  let eff = m
  if (m === 'system') {
    let sys = ''
    try { sys = (wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).theme || '' } catch (e) { sys = '' }
    eff = sys === 'dark' ? 'dark' : 'light'
  }
  return { eff, ...CHROME[eff] }
}

/* 把这一档套到**系统 UI**上(导航栏)。页面里的 class 由 app.js 那层统一挂。
   ⚠️ `wx.*` 一律接 fail(《波及面回归律》④);顺手把「最后一次真设成什么」记进 storage,
   判据据此断言(导航栏的颜色读不回来,这是它唯一可验的痕)。 */
function applyChrome(mode) {
  const c = chromeOf(mode)
  try { wx.setStorageSync('ll-theme-chrome', { at: Date.now(), eff: c.eff, backgroundColor: c.backgroundColor, frontColor: c.frontColor }) } catch (e) { /* 记不上不影响这一次生效 */ }
  try {
    wx.setNavigationBarColor({
      frontColor: c.frontColor,
      backgroundColor: c.backgroundColor,
      fail: (e) => { console.warn('[theme] setNavigationBarColor 失败', e && e.errMsg) },
    })
  } catch (e) { console.warn('[theme] setNavigationBarColor 抛了', e && e.message) }
  return c
}

module.exports = { THEME_KEY, MODES, CHROME, currentTheme, setTheme, themeClass, chromeOf, applyChrome }
