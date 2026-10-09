function latest(orders) {
  const time = o => { const n = Date.parse(o.updatedAt || o.createdAt || ''); return Number.isFinite(n) ? n : 0 }
  return orders.slice().sort((a, b) => time(b) - time(a) || String(b._id || b.id || '').localeCompare(String(a._id || a.id || ''))).slice(0, 2)
}
module.exports = { latest }
