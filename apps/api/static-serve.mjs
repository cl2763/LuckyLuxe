/* 静态文件服务(从 local-server.mjs 搬出,2026-08-25 丙线顺手)。

   本批动的就是这一域(微信业务域名校验文件要 .txt 原文返回、不存在要真 404),
   按公约②「边改边拆」把它整域搬出来;**行为一字未改**,依赖由调用方注入。 */
/* transformHtml:发 HTML 的那一刻过一道(2026-08-27 给前端资源打内容指纹用)。
   放在这里而不是各调用点 —— 页面有好几个入口,漏一个就等于那一页永远吃旧缓存。 */
export function createStaticServe({ existsSync, statSync, readFileSync, join, normalize, extname, transformHtml = null }) {
  function contentType(filePath) {
    const ext = extname(filePath)
    if (ext === '.html') return 'text/html; charset=utf-8'
    if (ext === '.css') return 'text/css; charset=utf-8'
    if (ext === '.js') return 'application/javascript; charset=utf-8'
    if (ext === '.png') return 'image/png'
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
    if (ext === '.svg') return 'image/svg+xml'
    if (ext === '.txt') return 'text/plain; charset=utf-8'   // 微信业务域名校验文件必须原文返回
    return 'application/octet-stream'
  }

  function serveFile(res, baseDir, requestPath, fallback = 'index.html') {
    const cleaned = normalize(decodeURIComponent(requestPath))
      .replace(/^[/\\]+/, '')
      .replace(/^(\.\.(\/|\\|$))+/, '')
    let candidate = join(baseDir, cleaned)
    // 图片扩展名自愈:引用 .png 但文件是 .jpg(或反之)时自动换后缀,避免退回 index.html 变成花图
    if (!(existsSync(candidate) && statSync(candidate).isFile()) && /\.(png|jpe?g)$/i.test(candidate)) {
      const swaps = candidate.endsWith('.png')
        ? [candidate.replace(/\.png$/i, '.jpg'), candidate.replace(/\.png$/i, '.jpeg')]
        : [candidate.replace(/\.jpe?g$/i, '.png')]
      const found = swaps.find((alt) => existsSync(alt) && statSync(alt).isFile())
      if (found) candidate = found
      else {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('image not found')
        return true
      }
    }
    const filePath = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(baseDir, fallback)
    if (!existsSync(filePath)) return false
    const type = contentType(filePath)
    res.writeHead(200, {
      'content-type': type,
      ...(type.startsWith('text/') || type.includes('javascript') ? { 'cache-control': 'no-store' } : {})
    })
    if (type.startsWith('text/html') && transformHtml) {
      res.end(transformHtml(readFileSync(filePath, 'utf8'), { baseDir }))
      return true
    }
    res.end(readFileSync(filePath))
    return true
  }

  return { contentType, serveFile }
}
