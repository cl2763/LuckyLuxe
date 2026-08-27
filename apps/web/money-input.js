/* 钱的输入框(2026-08-27,店主走查第 ② 处撞出来的那条)。

   她实测:退款金额框里连续数字打不进去 —— 打了 1 就被重画一次,5 和 0 丢了;
   而且右边还挂着浏览器给 `type=number` 自带的一对上下箭头(一下加一块钱,退款金额没人这么点)。

   三条规矩,**所有钱的输入框一体适用**(充值 / 赠送 / 冲销 / 退卡 / 退次卡):
     ① **敲的过程中不许重画、不许格式化** —— 重画一次就吃掉一个字符;
     ② 归一成两位小数只在 **blur**(离开这个框)时做一次;
     ③ `type=text` + `inputmode="decimal"`:去掉箭头,手机上照样弹数字键盘。 */
window.MoneyInput = (function () {
  // 只留数字与一个小数点;最多两位小数(超出的直接不收,免得敲完才被打回)
  function sanitize(raw) {
    let v = String(raw == null ? '' : raw).replace(/[^\d.]/g, '')
    const i = v.indexOf('.')
    if (i >= 0) v = `${v.slice(0, i + 1)}${v.slice(i + 1).replace(/\./g, '')}`
    const m = /^(\d*)(?:\.(\d{0,2}))?/.exec(v)
    return m ? `${m[1]}${m[2] === undefined ? (v.includes('.') ? '.' : '') : `.${m[2]}`}` : ''
  }

  // 离开输入框时才归一:'150' → '150.00';空串仍是空串(不要凭空塞 0.00)
  function normalize(raw) {
    const v = sanitize(raw)
    if (!v || v === '.') return ''
    const n = Number(v)
    return Number.isFinite(n) ? n.toFixed(2) : ''
  }

  const centsOf = (raw) => Math.round(Number(sanitize(raw) || 0) * 100)

  /* 生成一个钱输入框。**不给 type=number** —— 那对箭头就是从它来的。 */
  function field({ id, value = '', placeholder = '0.00', extra = '' }) {
    return `<input id="${id}" data-money type="text" inputmode="decimal" autocomplete="off"`
      + ` placeholder="${placeholder}" value="${String(value == null ? '' : value)}" ${extra}>`
  }

  /* 全局兜底:任何带 data-money 的框,敲的时候只做字符过滤(不重排、不补零),
     离开时才归一。挂一次,全站生效 —— 免得每个页面各写一遍又各写歪一遍。 */
  document.addEventListener('input', (e) => {
    const el = e.target
    if (!el || !el.matches || !el.matches('[data-money]')) return
    const before = el.value
    const after = sanitize(before)
    if (after !== before) {
      const drop = before.length - after.length
      const pos = Math.max(0, (el.selectionStart || after.length) - drop)
      el.value = after
      try { el.setSelectionRange(pos, pos) } catch (err) { /* 有的浏览器不支持就算了 */ }
    }
  }, true)
  document.addEventListener('blur', (e) => {
    const el = e.target
    if (!el || !el.matches || !el.matches('[data-money]')) return
    const v = normalize(el.value)
    if (v !== el.value) el.value = v
  }, true)

  return { sanitize, normalize, centsOf, field }
})()
