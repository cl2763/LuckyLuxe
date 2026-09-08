/* D183 · 明暗双模式(店主 2026-09-09:「可以选择晚上以及白天两种模式,
   但前提都是要不能影响正常功能的显示」)—— 新功能一律新模块(公约①),
   巨型文件 `admin.js` 只许搬出不许新增。

   三档:浅色 / 深色 / **跟随系统(默认)**。
   落法就是合同图那三段令牌:`data-theme="light"` / `="dark"` / 不写(跟系统)。
   存本地:这是**这台电脑的偏好**,不是这家店的设置 —— 换台电脑该重新选。
   即时生效、不刷新页面:令牌一换,整屏跟着走。

   🔴 一处真相:整仓只有这里会写 `documentElement.dataset.theme`。
   「不影响正常功能的显示」由 `tools/theme-contrast-proof.mjs` 那四条守(J-36):
   文字不重叠 · 正文对比度 ≥ 4.5:1 · 字体与浅色态同一套 · 数字不折行。 */
window.ThemeSwitch = (function () {
  const THEME_KEY = 'll-admin-theme'
  const THEMES = [['system', '跟随系统', 'System'], ['light', '浅色', 'Light'], ['dark', '深色', 'Dark']]

  function currentTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY)
      return THEMES.some(([k]) => k === v) ? v : 'system'
    } catch { return 'system' }   // 无痕模式读不到 storage,按默认走
  }

  function applyTheme(mode) {
    const m = THEMES.some(([k]) => k === mode) ? mode : 'system'
    try { localStorage.setItem(THEME_KEY, m) } catch { /* 存不了不影响这一次生效 */ }
    if (m === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = m
    return m
  }

  /* 「通用设置 → 外观」那一格也画在这里:同一个域的东西住同一个文件,
     `admin.js` 那边只留一句调用(巨型文件只许搬出不许新增)。 */
  /* 点击也在这里接:**委托到 document 上,只绑一次**(`renderInto` 会被反复调,
     每次都 addEventListener 的话点一下会触发好几遍)。
     `after` 是画完之后要重画的那个回调 —— 换完外观得把选中态更新过来。 */
  let bound = null
  function renderInto(body, summary, zh, after) {
    if (!body) return
    bound = after || bound
    if (!renderInto._on) {
      renderInto._on = true
      document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-gs-theme]')
        if (!btn) return
        applyTheme(btn.dataset.gsTheme)
        if (bound) bound()
      })
    }
    const cur = currentTheme()
    const label = (THEMES.find(([k]) => k === cur) || THEMES[0])[zh ? 1 : 2]
    if (summary) summary.textContent = label
    body.innerHTML = `<p class="subtle">${zh ? '深色只换配色,不改任何功能与数字;「跟随系统」= 跟着这台电脑的日夜设置走。' : 'Dark mode only changes colors.'}</p>
      <div class="row" style="gap:8px;margin-top:8px">
        ${THEMES.map(([k, z, e]) => `<button class="${cur === k ? 'primary' : 'ghost'} slim" data-gs-theme="${k}" type="button">${zh ? z : e}</button>`).join('')}
      </div>`
  }

  /* 进页面就先套上(在任何渲染之前),免得先闪一下浅色再变深 */
  applyTheme(currentTheme())
  return { THEMES, currentTheme, applyTheme, renderInto }
})()
