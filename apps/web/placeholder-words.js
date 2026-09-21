/* 占位词表 —— 顾客可见字段的「这不是数据」判别(店主 11j 判据 B,2026-09-22)
 *
 * ══ 为什么要这份表 ══
 * `Address TBD` / `Phone TBD` 是种子里的占位值。它们不是数据,显示给顾客 = 假信息。
 * 网页端早就挡了,但只认 `/TBD/i` 四个字母;小程序端一个字没挡。
 * 🔴 J-106(第三次出现同一个毛病就修产生它的那个东西):这次是 `Address TBD`,
 *    下次是 `Phone TBD`,再下次是别人手打的「待补充」。**治那一类,不治这一个。**
 *
 * ══ 为什么是两份不是一份 ══
 * 小程序和网页是两个独立的包,谁也 import 不到谁(全仓零先例,现查过)。
 * 所以两端各存一份,**由 `test-store-placeholder` 守住两份逐字一致** ——
 * 改一端不改另一端,当场红。这是「一件事一处真相」在无法共享文件时唯一诚实的做法。
 *
 * ══ 网页端四个出口,原来只挡了两个(J-112) ══
 *   `storeContactLine`(门店联系行)与订单详情地址   —— 原本手写 `!/TBD/i.test(v)`,只认那四个字母
 *   切换门店列表 与 订单卡地址                      —— **原本一点没挡**
 *   所以「网页端早就挡住了」这句话对一半。**有几个出口就得验几次。**
 *
 * ══ J-107 行为等价 ══
 *   把手写的 `/TBD/i` 换成这份词表,**对原来就挡的那些值行为必须逐个对得上**
 *   (`test-store-placeholder` ⑤ 组把这条钉住了)。
 *   新词表是**超集**,多挡的是「待补充」这类 —— 那是本批要的改进,不是抽取带来的走样。
 *
 * 🔴🔴 下面那一行 `const PLACEHOLDER_WORDS = [...]`,两端必须一模一样(判据逐字比)。
 *      词表来自 11j 判据 A 明列的七个词,**不许自己加**(J-107:法只授权它明写的那件事)。 */
const PLACEHOLDER_WORDS = ['TBD', 'placeholder', 'N/A', '待填', '待补充', '占位', '未填']

/* 空值也算「没填」—— 调用方要的是「这个值能不能给顾客看」,空串当然不能。 */
function isPlaceholderValue(v) {
  const s = String(v === null || v === undefined ? '' : v).trim()
  if (!s) return true
  const low = s.toLowerCase()
  for (let i = 0; i < PLACEHOLDER_WORDS.length; i++) {
    if (low.indexOf(PLACEHOLDER_WORDS[i].toLowerCase()) >= 0) return true
  }
  return false
}

/* 占位值一律收成空串 —— 空串才会让两端已有的空态逻辑接手
   (小程序 `wx:if` 落空 → 走 addressText 那句如实说明,且**不挂 bindtap**;
    网页 `filter(Boolean)` 把它丢掉)。
   🔴 不要改成返回「待补充」之类的句子:那是空态话术该管的事,不是这里。 */
function realValue(v) {
  return isPlaceholderValue(v) ? '' : String(v)
}

/* 网页端没有模块系统(和 customer-recommend.js 同款):挂到 window 上,
   由 index.html 在 customer.js 之前加载。 */
window.LLPlaceholder = { PLACEHOLDER_WORDS, isPlaceholderValue, realValue }
