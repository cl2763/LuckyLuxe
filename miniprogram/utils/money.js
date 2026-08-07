/* 金额显示。小程序端不认识任何具体币种,也不做任何金额运算 ——
   格式(前缀/符号/要不要留两位小数)由后端 currencyDisplay 下发,这里只负责拼字符串。
   与 apps/api/local-server.mjs 的 CURRENCY_DISPLAY、apps/web/admin.js 的 money() 同一套口径。 */
const DEFAULT_DISPLAY = { prefix: '', symbol: '', trimZeroDecimals: false }

function formatMoney(cents, display, decimals) {
  const fmt = display && typeof display === 'object' ? display : DEFAULT_DISPLAY
  const n = Number(cents || 0) / 100
  const d = decimals === undefined || decimals === null ? 2 : decimals
  let text = n.toFixed(d)
  if (fmt.trimZeroDecimals) text = text.replace(/\.00$/, '')
  const prefix = String(fmt.prefix || '').replace('<CODE>', fmt.code || '')
  return `${prefix}${fmt.symbol || ''}${text}`
}

/* currencyDisplay 里的 prefix 形如 "<CODE> ",占位符要用币种代码填。
   后端 /admin/settlements/preview 等响应同时给 currency 与 currencyDisplay,
   这里把两者合成一个可直接用的 display 对象。 */
function displayOf(payload) {
  if (!payload) return DEFAULT_DISPLAY
  const d = payload.currencyDisplay || payload.display || DEFAULT_DISPLAY
  return Object.assign({}, d, { code: payload.currency || d.code || '' })
}

module.exports = { formatMoney, displayOf, DEFAULT_DISPLAY }
