import { createHash } from 'node:crypto'
export function storeScene(tenantId) { return 'p' + createHash('sha256').update('youji-store:' + tenantId).digest('hex').slice(0,24) }
export function storeForScene(db, scene, scopeName) {
  if (!/^p[0-9a-f]{24}$/.test(String(scene))) return null
  const rows = db.prepare("SELECT id,name,kind FROM tenants WHERE status='active'").all()
  const matches = rows.filter(r => storeScene(r.id) === scene && !(scopeName === 'production' && String(r.kind || '').startsWith('demo')))
  return matches.length === 1 ? matches[0] : null
}
export function storeCodeInfo(db, tenantId, scopeName, apiError) {
  const scene = storeScene(tenantId), store = storeForScene(db,scene,scopeName)
  if (!store) throw apiError(404,'STORE_UNAVAILABLE','门店暂不可用。')
  return { tenantId:store.id, name:store.name, scene, path:'/mini-code/'+scene, envVersion:scopeName === 'production' ? 'release' : 'trial' }
}
