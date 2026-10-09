import { createHash } from 'node:crypto'
import { svgToPng, pngSize } from './svg-raster.mjs'

// 发布作品的媒体适配层；原始图片/签署快照从不改写。
const cache = new Map()
let cacheBytes = 0
export function inlineMedia(source, convert = svgToPng) {
  const match = /^data:image\/(svg\+xml|png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(source))
  if (!match) return null
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > 8*1024*1024) return null
  if (match[1] !== 'svg+xml') return { bytes, type:'image/'+match[1] }
  const key = createHash('sha256').update(bytes).digest('hex')
  if (cache.has(key)) return cache.get(key)
  const svg = bytes.toString('utf8')
  // Approved gallery input is still untrusted; disallow external resources,
  // entities and active content before invoking the rasterizer.
  if (!/<svg[\s>]/i.test(svg) || /<!|<\?|<script|<foreignObject|\bon\w+\s*=|\bhref\s*=|url\s*\(|@import/i.test(svg)) return null
  const png = convert(svg, { width:900 })
  if (!pngSize(png)) return null
  const result = { bytes:png, type:'image/png' }
  while (cacheBytes + png.length > 16*1024*1024 && cache.size) { const k = cache.keys().next().value; cacheBytes -= cache.get(k).bytes.length; cache.delete(k) }
  if (png.length <= 16*1024*1024) { cache.set(key,result); cacheBytes += png.length }
  return result
}
export function portfolioImageUrl(source, { base, tenantId, bookingId, index }) {
  if (!String(source).startsWith('data:image/')) return source
  const version = createHash('sha256').update(source).digest('hex').slice(0,16)
  return `${base.replace(/\/$/,'')}/portfolio-image?tenantId=${encodeURIComponent(tenantId)}&bookingId=${encodeURIComponent(bookingId)}&index=${index}&v=${version}`
}
export function createPortfolioMedia({ db, resolveTenant, parseJson, apiError, json, customerAppUrl }) {
  return (req, res, { path, query }) => {
  if (req.method === 'GET' && path === '/portfolio') {
    // 2026-07-20 方案B:除按技师分组(portfolios,保留兼容)外,平铺 works(带品类/技师)+ categories
    // 品类来自作品所属订单的服务类型——该店没开的品类天然不会出现
    const rows = db.prepare(`
      SELECT b.*, t.name AS tech_name, t.title AS tech_title, s.type AS service_type, s.name_zh AS service_name
      FROM bookings b
      JOIN technicians t ON t.id = b.technician_id
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.gallery_status = 'approved' AND b.tenant_id = ?
      ORDER BY b.gallery_locked_at DESC, b.appointment_start DESC
    `).all(resolveTenant(req, query))
    const grouped = new Map()
    const works = []
    for (const row of rows) {
      const images = parseJson(row.approved_work_images_json).filter(Boolean).map((image,index) => portfolioImageUrl(image, {base:customerAppUrl(),tenantId:row.tenant_id,bookingId:row.id,index}))
      if (!images.length) continue
      if (!grouped.has(row.technician_id)) {
        grouped.set(row.technician_id, {
          technician: { id: row.technician_id, name: row.tech_name, title: row.tech_title },
          images: [], albums: []
        })
      }
      grouped.get(row.technician_id).images.push(...images)
      grouped.get(row.technician_id).albums.push({ id: row.id, images, serviceType: row.service_type || '', serviceName: row.service_name || '' })
      images.forEach((image, idx) => works.push({
        id: `${row.id}:${idx}`, albumId: row.id,
        image,
        technician: { id: row.technician_id, name: row.tech_name, title: row.tech_title },
        serviceType: row.service_type || '',
        serviceName: row.service_name || ''
      }))
    }
    const categories = [...new Set(works.map((w) => w.serviceType).filter(Boolean))]
    json(res, 200, { portfolios: [...grouped.values()], works, categories }); return true
  }
    if (req.method !== 'GET' || path !== '/portfolio-image') return false
    const tid = resolveTenant(req,query)
    if (!/^\d{1,3}$/.test(String(query.index))) throw apiError(400,'BAD_IMAGE_INDEX','图片编号无效')
    const row = db.prepare("SELECT approved_work_images_json FROM bookings WHERE id=? AND tenant_id=? AND gallery_status='approved'").get(String(query.bookingId || ''),tid)
    const source = row && parseJson(row.approved_work_images_json).filter(Boolean)[Number(query.index)]
    if (!source) throw apiError(404,'IMAGE_NOT_FOUND','作品图片不可用')
    const media = inlineMedia(source)
    if (!media) throw apiError(422,'IMAGE_UNSUPPORTED','作品图片无法显示，请店家重新上传 JPG 或 PNG 图片')
    res.writeHead(200, { 'Content-Type':media.type, 'Content-Length':media.bytes.length, 'Cache-Control':'private, max-age=300', 'X-Content-Type-Options':'nosniff' })
    res.end(media.bytes)
    return true
  }
}
