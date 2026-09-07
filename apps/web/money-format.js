/* 网页端金额出口(公约②边改边拆:05r 补一 动了这个域,就把它带出 admin.js)

   全仓金额只从这里出去 —— **页面里一个币符都不许自己拼**(币种红线)。
   映射表与后端 `CURRENCY_DISPLAY` 同一套口径;拿不到币种就交给调用方处理空,
   **绝不冒充 CAD**(假数回落红线:08-23 立)。

   两个出口:
   · `money(cents)`      → 「币码+币符+25,885」整串,老调用点原样用;
   · `moneyParts(cents)` → 拆成 `{ code, prefix, symbol, amount }`。
     为什么要拆(店主 05r 补一 现看):大屏大数用整串 + 旁边再挂小字币码 =
     **币种出两遍、还没千分位**;图上要的是「小字币码 + 2,486」。
     拆开之后页面要哪段自己挑,但符号与前缀仍然由这里给。
   千分位加在 `moneyParts` 里,`money()` 跟着也有了 —— 全仓金额都受益,不是只治首页那一处。 */
window.MoneyFormat = (function () {
  const CURRENCY_DISPLAY = {
    CNY: { prefix: '', symbol: '¥', trimZeroDecimals: true },
    DEFAULT: { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false }   /* currency-map:映射表默认档 */
  }
  function parts(cents, decimals, code) {
    const fmt = CURRENCY_DISPLAY[String(code).toUpperCase()] || CURRENCY_DISPLAY.DEFAULT
    let text = Number(cents / 100).toFixed(Number(decimals) || 0)
    if (fmt.trimZeroDecimals) text = text.replace(/\.00$/, '')
    const bits = text.split('.')
    const grouped = bits[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')   // 千分位只给整数部分
    return { code, prefix: fmt.prefix.replace('<CODE>', code), symbol: fmt.symbol, amount: bits[1] ? grouped + '.' + bits[1] : grouped }
  }
  return { CURRENCY_DISPLAY, parts }
})()
