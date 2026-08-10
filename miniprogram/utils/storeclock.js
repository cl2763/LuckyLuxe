/* 门店「今天」。
   小程序原来到处用 new Date() 取今天 —— 那是**设备时钟**。店在多伦多、老板人在国内时,
   设备已经跨到明天、店里还在今天,点「今天」会跳到一个还没发生的日子,看着像单全没了。
   CLAUDE.md 的纪律是「所有『今天』按门店时区算」,这里补上:
   /admin/store-clock 给的 today 就是门店时区的今天,拿到后缓存,页面同步读。 */
const api = require('./api')
const KEY = 'lucky_store_clock'

function cached() {
  const v = wx.getStorageSync(KEY)
  return v && v.today ? v : null
}

/* 币种缓存是 2026-08-09 才加的,老缓存里没有这一项 —— 那种情况下必须去刷一次,
   不然会一直回落到默认 CAD,人民币店的金额就一直显示成 $。 */
function ensureCurrencyCached() {
  const c = cached()
  if (!c || !c.currencyDisplay) refreshStoreClock().catch(() => {})
}

// 同步读:没缓存时退回设备日期(总比没有强),但会顺手去后台刷新
function storeToday() {
  const c = cached()
  if (!c) {
    refreshStoreClock().catch(() => {})
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return c.today
}

function storeMonth() { return storeToday().slice(0, 7) }

/* 门店币种。和「今天」一样是门店级常量,跟着 /admin/store-clock 一起缓存 ——
   以前各页自己写 `'$' + n`,人民币店就会显示成「$5,440」。 */
function storeCurrencyDisplay() {
  const c = cached()
  if (!c || !c.currencyDisplay) ensureCurrencyCached()
  return (c && c.currencyDisplay) || { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false }
}
function storeCurrency() {
  const c = cached()
  return (c && c.currency) || 'CAD'
}
/* 只要币符前缀(给输入框 placeholder 这类"不带数字"的地方用)。
   R4:商家端会员充值页原来把 storeCurrency() 的**币种代码**当符号显示,
   于是 ¥ 店的输入框写着「CNY 如 1000」,而同屏别的金额是 ¥ —— 一屏两套写法。
   与顾客端 curOf() 同一口径:prefix + symbol。 */
function storeCurrencyPrefix() {
  const fmt = storeCurrencyDisplay()
  return `${String(fmt.prefix).replace('<CODE>', storeCurrency())}${fmt.symbol}`
}
// 分 → 门店币种显示串。decimals 默认按币种(CNY 整数、CAD 两位)
function storeMoney(cents, decimals) {
  const fmt = storeCurrencyDisplay()
  const n = Number(cents || 0) / 100
  const d = decimals === undefined ? (fmt.trimZeroDecimals ? 0 : 2) : decimals
  let text = n.toFixed(d)
  if (fmt.trimZeroDecimals) text = text.replace(/\.00$/, '')
  // 千分位:金额一多不加逗号很难读
  text = text.replace(/\B(?=(\d{3})+(?!\d)(\.|$))/g, ',')
  return `${String(fmt.prefix).replace('<CODE>', storeCurrency())}${fmt.symbol}${text}`
}

async function refreshStoreClock() {
  const r = await api.adminGet('/admin/store-clock')
  if (r && r.today) {
    wx.setStorageSync(KEY, {
      today: r.today, timezone: r.timezone || '', at: Date.now(),
      currency: r.currency || '', currencyDisplay: r.currencyDisplay || null
    })
  }
  return r
}

module.exports = {
  storeCurrencyPrefix, storeToday, storeMonth, storeMoney, storeCurrency, storeCurrencyDisplay, refreshStoreClock, ensureCurrencyCached }
