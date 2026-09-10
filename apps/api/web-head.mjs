/* D188 ① · **令牌引用的统一入口** —— 让「新建一页忘了引 design-tokens.css」这件事**不可能发生**
 *
 * ══ 立件经过 ══
 * 05z 把 `styles.css` 整个令牌化之后,`index.html` / `share.html` / `wechat-simulator.html`
 * 三页**从来没引过** `design-tokens.css` —— 于是所有 `var()` 解析成空:
 * 底色透明、字色纯黑,**整页塌掉**。而当时那把对比度刀只扫后台,照样全绿(又一次 J-37)。
 * 店主的裁定是:病根不是「那三页忘了」,是**「忘得掉」这件事本身**。
 *
 * ══ 这里做什么 ══
 * 发 HTML 的那一刻过一道:**没引令牌就当场补上**,并在服务日志里点名是哪一页。
 * 它挂在 `static-serve.mjs` 的 `transformHtml` 上 —— 页面有六个入口(/、/admin、/platform、
 * /share、/sign、/wechat-simulator),挂在那一处就等于六个入口全覆盖,不用每个调用点记得。
 *
 * ══ 它平时应该是个空转 ══
 * 每一页**仍然自己写着那一行 `<link>`**(显式、直接打开文件也有效),所以正常情况下这里
 * 一次都不该触发。判据 `test-token-entry` ① 就守着这条:六页都自带那一行 → 注入器永远是 0 次。
 * 换句话说:**显式那一行是真相,这里是「漏了也到不了浏览器」的兜底**,不是第二套真相。
 *
 * ══ 为什么不去管「引用顺序」══
 * 06c 那条原话是「必须也引 design-tokens.css **且顺序在前**」。现查仓里两种顺序都有:
 * `admin.html` 特意把令牌排在 `styles.css` **之后**(它页首写着「令牌是唯一真相,谁在后面谁说了算」),
 * 另外三页排在前面。**照字面立「顺序在前」会把旗舰页判红。**
 * 顺序只在「两个文件定义了同名令牌」时才决定胜负,所以这里换成更硬的那一条:
 * **两份文件不许定义同名令牌**(判据 ③),名字不撞车 → 顺序怎么排都对。
 * 再加运行判据(`--paper` 现取不许为空)从结果那一层兜底。
 */

/** 页面里那一行长这样(路径与 `apps/web/*.html` 里写的一致) */
export const TOKEN_HREF = '/web/design-tokens.css'

/** 已经引了吗 —— 只认真的 `<link>`,不认注释里提到这个名字(判据看代码不看注释) */
export function hasTokenLink(html) {
  return /<link[^>]+href\s*=\s*["'][^"']*design-tokens\.css[^"']*["'][^>]*>/i.test(
    String(html || '').replace(/<!--[\s\S]*?-->/g, ' '),
  )
}

/**
 * 没引就补上。返回 `{ html, injected }`：
 *   · `injected === false` 是**正常态**(页面自带那一行);
 *   · `injected === true` 说明有一页漏了 —— 浏览器那边被救回来了,但这是个缺陷,要报出来。
 */
export function ensureTokenLink(html, { file = '(未知页面)', log = null } = {}) {
  const src = String(html || '')
  if (!/<head[\s>]/i.test(src)) return { html: src, injected: false }   /* 不是完整 HTML 文档,不碰 */
  if (hasTokenLink(src)) return { html: src, injected: false }
  const tag = `<link rel="stylesheet" href="${TOKEN_HREF}">`
  const out = src.replace(/(<head[^>]*>)/i, `$1\n$tag_PLACEHOLDER`).replace('$tag_PLACEHOLDER', tag)
  if (log) log(`🔴 [D188] ${file} 没引 design-tokens.css —— 已在发出去的那一刻补上,但这是缺陷,去把那一行写进文件`)
  return { html: out, injected: true }
}
