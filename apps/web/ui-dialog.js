/* 对话框 · 唯一出口(D104,店主 03t §二第 4 条,2026-09-03)

   ══ 案由 ══
   网页端还在用浏览器**原生** `prompt / confirm / alert`:
   样式与产品完全两套、无法本地化排版、阻塞主线程、手机上表现不一致,
   而且这几处恰恰长在**工资发放、考勤改时刻、账本冲销、日结重开、顾客取消预约**这些要紧动作上。

   ══ 一处自纠(判据认长相不认机制)══
   我第一版扫描报「10 处」,**真底数是 25 处** —— 正则写了 `(?<![\w.])`,
   把 `window.prompt(...)` 这种带前缀的整类排除掉了,于是漏了 15 处,
   其中包括**顾客端取消预约**、**日结重开**,和 D122 事由出口自己(`correction-reason.js`)。
   机制定义应当是「**调用浏览器原生对话框**」,不是「某一种写法长什么样」。

   ══ 这个模块 ══
   三个 Promise 版替代品,样式跟随产品:
   · `UIDialog.text(title, { hint, value, placeholder })` → 字符串 或 null(取消)
   · `UIDialog.confirm(title, { hint, okText, danger })`  → true / false
   · `UIDialog.alert(title, { hint })`                    → undefined(点掉即返回)

   实现放在这里而不是 `admin.js`:巨型文件**只许搬出不许新增**(公约③棘轮律),
   调用点从 `prompt(x)` 换成 `await UIDialog.text(x)` 是**原地改行**,行数不涨。 */

window.UIDialog = (() => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  /* 一次只允许一个对话框在场:再开一个就把前一个撤掉,
     否则连点两次按钮会叠两层,底下那层永远等不到答案(挂住的 Promise 是静默失败器)。 */
  function mount(inner, { onKey } = {}) {
    document.querySelector('.ui-dialog-overlay')?.remove()
    const overlay = document.createElement('div')
    overlay.className = 'store-switch-overlay ui-dialog-overlay'
    overlay.innerHTML = `<div class="store-switch-panel card ui-dialog-panel">${inner}</div>`
    document.body.appendChild(overlay)
    const off = (e) => { if (onKey) onKey(e) }
    document.addEventListener('keydown', off)
    return {
      el: overlay,
      close() { document.removeEventListener('keydown', off); overlay.remove() },
    }
  }

  const head = (title, hint) => `
    <div class="section-row"><h2>${esc(title)}</h2></div>
    ${hint ? `<p class="subtle" style="margin:4px 0 10px">${esc(hint)}</p>` : ''}`

  /* 与原生同形的参数兼容:`prompt(title, defaultValue)` 的第二个参数是**默认值**,
     所以第二个参数是字符串时按 value 收 —— 这样 19 处调用点的替换是**纯换名**,
     不用逐个重排参数(重排参数最容易在多行调用上改坏)。 */
  function text(title, opts = {}) {
    const o = typeof opts === 'string' ? { value: opts } : (opts || {})
    const { hint = '', value = '', placeholder = '', okText = '确定', cancelText = '取消' } = o
    return new Promise((resolve) => {
      const m = mount(`${head(title, hint)}
        <input class="ui-dialog-input" type="${o.inputType === 'password' ? 'password' : 'text'}" value="${esc(value)}" placeholder="${esc(placeholder)}" style="width:100%">
        <div class="section-row" style="justify-content:flex-end;gap:8px;margin-top:12px">
          <button class="ghost slim" data-uid="cancel" type="button">${esc(cancelText)}</button>
          <button class="primary slim" data-uid="ok" type="button">${esc(okText)}</button>
        </div>`, { onKey: (e) => { if (e.key === 'Escape') done(null) } })
      const input = m.el.querySelector('.ui-dialog-input')
      const done = (v) => { m.close(); resolve(v) }
      m.el.querySelector('[data-uid="ok"]').addEventListener('click', () => done(input.value))
      m.el.querySelector('[data-uid="cancel"]').addEventListener('click', () => done(null))
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value) })
      setTimeout(() => { input.focus(); input.select() }, 0)
    })
  }

  function confirm(title, opts = {}) {
    const { hint = '', okText = '确定', cancelText = '取消', danger = false } = (opts || {})
    return new Promise((resolve) => {
      const m = mount(`${head(title, hint)}
        <div class="section-row" style="justify-content:flex-end;gap:8px;margin-top:12px">
          <button class="ghost slim" data-uid="cancel" type="button">${esc(cancelText)}</button>
          <button class="${danger ? 'danger' : 'primary'} slim" data-uid="ok" type="button">${esc(okText)}</button>
        </div>`, { onKey: (e) => { if (e.key === 'Escape') done(false) } })
      const done = (v) => { m.close(); resolve(v) }
      m.el.querySelector('[data-uid="ok"]').addEventListener('click', () => done(true))
      m.el.querySelector('[data-uid="cancel"]').addEventListener('click', () => done(false))
      setTimeout(() => m.el.querySelector('[data-uid="ok"]').focus(), 0)
    })
  }

  function alert(title, opts = {}) {
    const { hint = '', okText = '知道了' } = (opts || {})
    return new Promise((resolve) => {
      const m = mount(`${head(title, hint)}
        <div class="section-row" style="justify-content:flex-end;margin-top:12px">
          <button class="primary slim" data-uid="ok" type="button">${esc(okText)}</button>
        </div>`, { onKey: (e) => { if (e.key === 'Escape' || e.key === 'Enter') done() } })
      const done = () => { m.close(); resolve() }
      m.el.querySelector('[data-uid="ok"]').addEventListener('click', done)
      setTimeout(() => m.el.querySelector('[data-uid="ok"]').focus(), 0)
    })
  }

  return { text, confirm, alert }
})()
