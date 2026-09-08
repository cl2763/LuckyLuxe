/* 数字大字的字体 —— **如实说明版**(店主 05t 段 4 第 2 条:「不许悄悄用系统字体冒充」)
 *
 * ══ 事实,先说清楚 ══
 * 合同图的字体三件套是 **Fraunces(数字大字)/ Noto Serif SC(标题)/ Noto Sans SC(正文)**,
 * 网页端靠图里那一行 Google Fonts 链接就拿到了。**小程序拿不到**:
 *   · 小程序**不能引外部样式表**,所以 `Noto Serif SC / Noto Sans SC` 在小程序端**加载不进来**
 *     —— 中文就是**系统字体**(iOS 苹方、安卓思源黑)。这不是「差不多」,是**两回事**,
 *     回执与对照说明里都要照这句写,不许写成「已按图落地」。
 *   · 数字大字**有一条路**:`wx.loadFontFace` 能加载自托管的 woff2。但它要求
 *     **https 地址 + 该域名进小程序后台的 downloadFile 白名单**。本地沙箱(127.0.0.1)给不出这样的地址,
 *     所以**今天数字也是系统字体**;自托管字体进上线批(待裁 #18)。
 *
 * ══ 这个文件为什么还是要存在 ══
 * 因为「做不成」有两种写法:一种是什么都不写,下一个人以为忘了;
 * 另一种是**把口留好、把原因写在代码里、并且在控制台说出来**。这是后一种。
 * `FRAUNCES_URL` 一填上,数字立刻就是 Fraunces —— 上线批只需要改这一行 + 白名单。
 *
 * 🔴 **不许假装成功**(静默失败器族):地址为空时 `load()` 回的是
 * `{ loaded: false, why: '…' }`,不是一个看起来成功的空对象。判据守的就是这一条。
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
