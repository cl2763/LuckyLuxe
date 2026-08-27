/* 前端资源指纹(2026-08-27,店主走查第三轮的根因)。

   她连撞两轮「功能没生效」——日结新排版没出来、输入框还是打不进连续数字。
   两次都是真的:代码改了、我的浏览器上也验过了,**而她的浏览器一直在跑旧的 admin.js**。
   ⌘+Shift+R 之后两处都对了 → 根因是缓存,不是功能。

   所以要修的不是那两个功能,是**缓存失效机制**:
     ① 每个前端资源的 URL 带**内容指纹**(文件内容一变,URL 就变;旧缓存不可能命中);
     ② 页面上那个版本串**跟着构建走** —— 原来是手写常量 `ADMIN_BUILD`,
        我改了三轮 admin.js(8,869 → 8,855 → 8,844)它一个字没动,
        等于店主完全没办法知道自己在看哪一版。现在由服务端按内容算,想忘也忘不了。

   实现刻意不引构建工具:服务端**在发 HTML 那一刻**按文件内容改写 `?v=`,零依赖、零构建步骤。 */
export function createAssetFingerprint({ readFileSync, existsSync, join, createHash }) {
  const cache = new Map()          // 路径 → { mtime, size, hash };只在文件变了才重算

  function hashOf(webRoot, name, statSync) {
    const file = join(webRoot, name)
    if (!existsSync(file)) return ''
    const st = statSync(file)
    const key = `${name}:${st.mtimeMs}:${st.size}`
    const hit = cache.get(name)
    if (hit && hit.key === key) return hit.hash
    const hash = createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10)
    cache.set(name, { key, hash })
    return hash
  }

  /* 把 HTML 里 /web/xxx.js|css 的 ?v= 全换成内容指纹,并注入 window.LL_BUILD
     (= 这一页所有资源指纹再哈希一次,页面上的版本串直接显示它)。 */
  function fingerprintHtml(html, { webRoot, statSync }) {
    const used = []
    const out = String(html).replace(/\/web\/([A-Za-z0-9_.-]+\.(?:js|css))(\?v=[^"']*)?/g, (all, name) => {
      const h = hashOf(webRoot, name, statSync)
      if (!h) return all
      used.push(`${name}:${h}`)
      return `/web/${name}?v=${h}`
    })
    if (!used.length) return out
    const build = createHash('sha1').update(used.sort().join('|')).digest('hex').slice(0, 8)
    const inject = `<script>window.LL_BUILD=${JSON.stringify(build)}</script>`
    return out.includes('</head>') ? out.replace('</head>', `${inject}</head>`) : `${inject}${out}`
  }

  return { fingerprintHtml, hashOf }
}
