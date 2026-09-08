/* 数字大字的字体 —— **三条路都试过了**(店主 05t 段 4 立的「如实说」+ 夜班令6 段 7 要求逐条试)
 *
 * ══ 结论(2026-09-09):**路① 成了**,数字现在是真 Fraunces ══
 *
 * · **路①(采用):woff2 子集 base64 内嵌 WXSS** ——
 *   `pyftsubset` 只留 0–9 与 `, . ¥ $ € £`,woff2 后 **2,748 字节**,
 *   base64 写进 `styles/fraunces-digits.wxss` 的 `@font-face`,由 `app.wxss` 引入。
 *   小程序**不能**在 WXSS 里引网络字体,但 base64 是官方支持的那条路。
 *   重新生成用 `tools/make-fraunces-subset.sh`,那份 wxss 是生成物不要手改。
 *
 * · **路②(没走通,原因写清):`wx.loadFontFace` + 本机地址** ——
 *   它要求 **https** 且域名进小程序后台的 downloadFile 白名单;
 *   本机沙箱是 `http://127.0.0.1:4310`,给不出这样的地址。
 *   开发者工具里勾「不校验合法域名」能过,但那只在**工具里**成立,真机不成立 ——
 *   拿它当「做到了」就是骗自己。生产要走这条得先有自有域名 + 白名单(留在上线批)。
 *
 * · **路③(不用了):退回系统字体** —— 只有前两条都不成才走。现在不走这条。
 *
 * ══ 中文仍然是系统字体 ══
 * 这一份只解决**数字**。中文标题与正文用的还是系统字体(iOS 苹方 / 安卓思源黑),
 * **不是 Noto Serif SC / Noto Sans SC** —— 小程序引不了外部样式表,中文字体几 MB 也不适合内嵌。
 * 店主 05u 已裁「中文接受系统字体」。**这句话不许改成「已按图落地」。**
 *
 * 下面这个 `loadNumberFont` 留着给**路②**用:哪天有了自有域名,把地址填上就多一条保险
 * (base64 那条已经生效,这条是冗余而不是必需)。地址为空时它**明说没加载**,不假装。
 */
/* 自托管 Fraunces(只要拉丁数字那一档,体积小)。**上线批填这里**。 */
const FRAUNCES_URL = ''

/** 加载数字大字。
 *  @returns {Promise<{loaded: boolean, why: string}>} —— `loaded=false` 时 `why` 说明为什么。 */
function loadNumberFont() {
  if (!FRAUNCES_URL) {
    const why = '没有可用的自托管字体地址:小程序不能引 Google Fonts,wx.loadFontFace 又只吃 https + 域名白名单。'
      + '所以数字现在是**系统字体**,不是 Fraunces(见 utils/numfont.js 抬头;上线批待办)。'
    console.warn('[numfont]', why)
    return Promise.resolve({ loaded: false, why })
  }
  return new Promise((resolve) => {
    wx.loadFontFace({
      family: 'Fraunces',
      source: `url("${FRAUNCES_URL}")`,
      global: true,
      success: () => resolve({ loaded: true, why: '' }),
      /* fail 一定要接(《波及面回归律》④:wx.* 异步调用一律有 fail 处理,CI 常驻) */
      fail: (e) => {
        const why = `字体没加载成功:${(e && e.errMsg) || '未知原因'} —— 数字仍是系统字体。`
        console.warn('[numfont]', why)
        resolve({ loaded: false, why })
      },
    })
  })
}

module.exports.loadNumberFont = loadNumberFont
module.exports.FRAUNCES_URL = FRAUNCES_URL
