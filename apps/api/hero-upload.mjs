import { createHash } from 'node:crypto'
// Temporary, bounded staging: never replaces published slides until the final PUT succeeds.
export function createHeroUpload({ apiError, now = Date.now, maxBytes = 32 * 1024 * 1024, ttl = 10 * 60 * 1000 }) {
  const entries = new Map()
  const clean = () => { for (const [key, entry] of entries) if (now() - entry.created > ttl) entries.delete(key) }
  const keyOf = (scope, hash) => JSON.stringify([scope, hash])
  function accept(scope, body) {
    clean()
    const { hash, index, count, chunk } = body || {}
    if (!scope || !/^[a-f0-9]{64}$/.test(hash || '') || !Number.isInteger(index) || !Number.isInteger(count) || count < 1 || count > 32 || index < 0 || index >= count || typeof chunk !== 'string' || !chunk.length || chunk.length > 100000 || !/^[\x20-\x7e]+$/.test(chunk)) throw apiError(400, 'BAD_REQUEST', '图片分段无效，请重新保存。')
    const key = keyOf(scope, hash)
    let entry = entries.get(key)
    if (entry && entry.count !== count) throw apiError(409, 'CONFLICT', '图片分段数量不一致。')
    if (entry?.chunks[index] !== undefined) {
      if (entry.chunks[index] !== chunk) throw apiError(409, 'CONFLICT', '图片分段内容不一致。')
      return { hash, index, accepted: true }
    }
    const all = [...entries.values()]
    const used = all.reduce((n, e) => n + e.bytes, 0)
    const own = all.filter(e => e.scope === scope).reduce((n, e) => n + e.bytes, 0)
    if (used + chunk.length > maxBytes || own + chunk.length > 13 * 1024 * 1024 || (!entry && entries.size >= 192)) throw apiError(429, 'UPLOAD_BUSY', '图片暂存繁忙，请稍后重试；草稿已保留。')
    if (!entry) { entry = { scope, count, chunks: [], bytes: 0, created: now() }; entries.set(key, entry) }
    if (entry.bytes + chunk.length > 2 * 1024 * 1024) throw apiError(400, 'BAD_REQUEST', '单张图片超过限制。')
    entry.chunks[index] = chunk; entry.bytes += chunk.length
    return { hash, index, accepted: true }
  }
  function resolve(scope, hash) {
    clean()
    const entry = entries.get(keyOf(scope, hash))
    if (!entry || Array.from({ length: entry.count }, (_, i) => entry.chunks[i]).some(x => x === undefined)) throw apiError(409, 'UPLOAD_INCOMPLETE', '图片尚未传完或已过期，请再次保存；草稿已保留。')
    const image = entry.chunks.join('')
    if (!image.startsWith('data:image/') || createHash('sha256').update(image).digest('hex') !== hash) throw apiError(400, 'UPLOAD_INVALID', '图片校验失败，请重新选择图片。')
    return image
  }
  return { accept, resolve }
}
