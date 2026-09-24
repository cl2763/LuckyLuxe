import { gzipSync } from 'node:zlib'

// 同一出口负责压缩与长度，JSON/静态文件都保留自己的状态、权限和缓存规则。
export function writeHttpBody(res, status, headers, body) {
  body = body ?? ''
  const h = { ...headers }
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
  const type = String(h['content-type'] || '')
  const compressible = /^(text\/|application\/(javascript|json)|image\/svg\+xml)/i.test(type)
  let output = body
  if (compressible && !h['content-encoding']) {
    h.vary = [...new Set(String(h.vary || '').split(',').map(x => x.trim()).filter(Boolean).concat('Accept-Encoding'))].join(', ')
    const accepted = String(res.req?.headers?.['accept-encoding'] || '').split(',').map(part => {
      const [name, ...params] = part.trim().toLowerCase().split(';')
      const q = params.find(x => x.trim().startsWith('q='))
      return { name, quality: q === undefined ? 1 : Number(q.trim().slice(2)) }
    })
    const gzip = accepted.find(x => x.name === 'gzip') || accepted.find(x => x.name === '*')
    if (bytes.length >= 1024 && gzip?.quality > 0 && gzip.quality <= 1) {
      const packed = gzipSync(bytes)
      if (packed.length < bytes.length) { output = packed; h['content-encoding'] = 'gzip' }
    }
  }
  h['content-length'] = Buffer.isBuffer(output) ? output.length : Buffer.byteLength(String(output))
  res.writeHead(status, h)
  res.end(output)
}
