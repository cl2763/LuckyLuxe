// Non-destructive display framing. Storage and validation are shared by merchant/platform writes.
const profiles = ['desktop', 'mobile', 'mini', 'card', 'detail']
export function imageView(value, fail = (message) => new Error(message)) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw fail('图片显示范围格式不正确。')
  const result = {}
  for (const [key, view] of Object.entries(value)) {
    if (!profiles.includes(key) || !view || typeof view !== 'object' || Array.isArray(view) || Object.keys(view).some(k => !['x', 'y', 'zoom'].includes(k))) throw fail('图片显示位置不正确。')
    for (const [k, min, max] of [['x',0,100], ['y',0,100], ['zoom',1,3]]) {
      if (typeof view[k] !== 'number' || !Number.isFinite(view[k]) || view[k] < min || view[k] > max) throw fail('图片范围须为 0–100，缩放须为 1–3 倍。')
    }
    result[key] = {x:view.x, y:view.y, zoom:view.zoom}
  }
  return result
}
export function storedImageView(raw) { return raw ? imageView(JSON.parse(raw)) : {} }
export function ensureServiceImageViewSchema(db) {
  if (!db.prepare('PRAGMA table_info(services)').all().some(c => c.name === 'image_view_json')) {
    db.exec("ALTER TABLE services ADD COLUMN image_view_json TEXT NOT NULL DEFAULT '{}'")
  }
}
export function serviceImageFields(body, current, fail) {
  const changed = body.imageUrl !== undefined && body.imageUrl !== current.image_url
  return JSON.stringify(imageView(body.imageView === undefined ? (changed ? {} : storedImageView(current.image_view_json)) : body.imageView, fail))
}
