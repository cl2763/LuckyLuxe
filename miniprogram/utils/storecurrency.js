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
  /* 2026-08-10 核验轮修复:这里原本调 api.getStores(),拿回来的是**门店数组**,
     数组上没有 currencyDisplay —— 判断永远不成立,缓存一次也没写进去,
     顾客端 32 处 {{cur.p}}{{cur.s}} 一直渲染成空币符。改调只取币种字段的接口。 */
  const r = await api.getStoreCurrency()
  if (r && r.currencyDisplay) {
    wx.setStorageSync(KEY, { currency: r.currency || '', currencyDisplay: r.currencyDisplay, at: Date.now() })
    repaintCurrency()
  }
  return r
}

/* 首开那一屏的时序:ensureCurrencyCached() 是异步取,curOf() 同一拍就同步读,
   拿到的必然是空。缓存落地后把**已经渲染过**的页面补刷一次(只动 cur 这一个字段,
   不碰布局、不碰金额),13 个页面不用各改一行。 */
function repaintCurrency() {
  try {
    const pages = (typeof getCurrentPages === 'function' ? getCurrentPages() : []) || []
    pages.forEach((p) => { if (p && p.data && p.data.cur && typeof p.setData === 'function') p.setData({ cur: curOf() }) })
  } catch (e) { /* 页面栈拿不到就算了,下一次 onShow 会带上 */ }
}

function ensureCurrencyCached() {
  if (!cached()) refreshStoreCurrency().catch(() => {})
}

// 换店必须清:¥ 店与 CAD 店共用同一个缓存键,不清会把上一家的币符带进新店
function clearStoreCurrency() { wx.removeStorageSync(KEY) }

// 分 → 门店币种显示串(decimals 默认按币种:CNY 整数、CAD 两位)
function money(cents, decimals) {
  const c = cached()
  if (!c) { ensureCurrencyCached(); return formatMoney(cents, { prefix: '', symbol: '', trimZeroDecimals: false }, decimals) }
  return formatMoney(cents, Object.assign({}, c.currencyDisplay, { code: c.currency }), decimals)
}

// 已经是「元」的数字(顾客端不少字段是元不是分)→ 同一套币种前缀
function moneyFromYuan(amount, decimals) { return money(Math.round(Number(amount || 0) * 100), decimals) }

module.exports = { money, moneyFromYuan, refreshStoreCurrency, ensureCurrencyCached, clearStoreCurrency }

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
