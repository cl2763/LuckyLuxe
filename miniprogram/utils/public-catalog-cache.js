// Tenant + language + environment scoped; rejected requests never become empty data.
const entries = new Map()
function read(key, fetcher, ttl = 15000) {
  const hit = entries.get(key)
  if (hit && (hit.pending || hit.until > Date.now())) return hit.promise
  const entry = { pending: true, until: 0 }
  entry.promise = Promise.resolve().then(fetcher).then(value => {
    entry.pending = false; entry.until = Date.now() + ttl
    return value
  }, error => { if (entries.get(key) === entry) entries.delete(key); throw error })
  entries.set(key, entry)
  return entry.promise
}
function clear() { entries.clear() }
module.exports = { read, clear }
