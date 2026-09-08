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

module.exports = { THEME_KEY, MODES, currentTheme, setTheme, themeClass }
