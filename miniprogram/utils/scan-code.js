// wx.scanCode returns different shapes for a mini-program code, a QR URL,
// and a plain text code. Keep parsing in one place for customer and merchant.
function values(result) {
  if (typeof result === 'string') return [result]
  return [result && result.path, result && result.result].filter(Boolean).map(String)
}
function decoded(raw) {
  try { return decodeURIComponent(raw) } catch (e) { return raw }
}
function sceneFromScan(result) {
  for (const value of values(result)) {
    const raw = decoded(value.trim())
    const match = raw.match(/(?:^|[?&#/])scene=(?:%3D)?([sbpd][0-9a-f]{24}|m[A-Z0-9]{8})(?:[&#/]|$)/i)
      || raw.match(/(?:^|[?&#/])([sbpd][0-9a-f]{24}|m[A-Z0-9]{8})(?:[&#/]|$)/i)
    if (match) return match[1][0] === 'm' ? `m${match[1].slice(1).toUpperCase()}` : match[1].toLowerCase()
    const token = raw.match(/(?:^|[?&#])t=(sg_[0-9a-f]{64}|bind_[0-9a-f]{64})(?:[&#]|$)/i)?.[1]
    if (token) return `${token.startsWith('sg_') ? 's' : 'b'}${token.split('_')[1].slice(0,24).toLowerCase()}`
  }
  return ''
}
function memberCodeFromScan(result) {
  for (const value of values(result)) {
    const raw = decoded(value.trim())
    const code = raw.match(/(?:^|[^A-Z0-9])LL-([A-Z0-9]{8})(?:[^A-Z0-9]|$)/i)?.[1]
    if (code) return `LL-${code.toUpperCase()}`
  }
  const scene = sceneFromScan(result)
  return /^m[A-Z0-9]{8}$/.test(scene) ? `LL-${scene.slice(1)}` : ''
}
module.exports = { sceneFromScan, memberCodeFromScan }
