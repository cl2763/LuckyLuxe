/* 顾客端门店币种(店主 2026-08-10 红线修复)。

   顾客端**不能**调 /admin/store-clock(那是商家接口),以前各页就只好写死 "CAD $" ——
   Jie'Nail 是境内 ¥ 店,顾客看到的每一个价格币种都是错的,而商家端同一张单显示 ¥。
   现在从公开的 /stores 拿 currency + currencyDisplay,与商家端 storeMoney() 同一套口径,
   缓存起来同步读;没缓存时先回默认并异步刷一次。

   金额红线不变:这里一分钱都不算,只把后端给的分数按门店币种拼成字符串。 */
const api = require('./api')
const { formatMoney } = require('./money')
const KEY = 'lucky_store_currency'

function cached() {
  const v = wx.getStorageSync(KEY)
  return v && v.currencyDisplay ? v : null
}

async function refreshStoreCurrency() {
  const r = await api.getStores()
  if (r && r.currencyDisplay) {
    wx.setStorageSync(KEY, { currency: r.currency || '', currencyDisplay: r.currencyDisplay, at: Date.now() })
  }
  return r
}

function ensureCurrencyCached() {
  if (!cached()) refreshStoreCurrency().catch(() => {})
}

// 分 → 门店币种显示串(decimals 默认按币种:CNY 整数、CAD 两位)
function money(cents, decimals) {
  const c = cached()
  if (!c) { ensureCurrencyCached(); return formatMoney(cents, { prefix: '', symbol: '', trimZeroDecimals: false }, decimals) }
  return formatMoney(cents, Object.assign({}, c.currencyDisplay, { code: c.currency }), decimals)
}

// 已经是「元」的数字(顾客端不少字段是元不是分)→ 同一套币种前缀
function moneyFromYuan(amount, decimals) { return money(Math.round(Number(amount || 0) * 100), decimals) }

module.exports = { money, moneyFromYuan, refreshStoreCurrency, ensureCurrencyCached }

/* 给 WXML 用的币种前缀对象:{ p: 前缀, s: 符号 }。
   页面把它 setData 成 cur,模板里写 {{cur.p}}{{cur.s}}{{金额}} —— 只换币符,
   数字与排版一个字不动(店主 2026-08-10:不碰布局)。 */
function curOf() {
  const c = cached()
  const d = (c && c.currencyDisplay) || { prefix: '', symbol: '' }
  if (!c) ensureCurrencyCached()
  return { p: String(d.prefix || '').replace('<CODE>', (c && c.currency) || ''), s: d.symbol || '' }
}
module.exports.curOf = curOf
