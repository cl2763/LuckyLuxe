// Customer-authenticated profile editing. No membership, balance or historical writes.
export function validateAvatar(value, apiError) {
  if (typeof value !== 'string' || value.length > 360000) throw apiError(400, 'BAD_AVATAR', '头像过大，请选择较小的图片。')
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!m) throw apiError(400, 'BAD_AVATAR', '请选择 PNG、JPEG 或 WebP 图片。')
  const bytes = Buffer.from(m[2], 'base64')
  const valid = m[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) : m[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'
  if (!valid || bytes.length < 12 || bytes.length > 256000) throw apiError(400, 'BAD_AVATAR', '头像文件无效或过大。')
  return value
}
export async function customerProfileRoute(req, res, { db, requireCustomer, resolveTenant, query, apiError, json, serializeUser }) {
  const customer = requireCustomer(req), tid = resolveTenant(req, query)
  const user = db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(customer.id,tid)
  if (!user) throw apiError(403,'FORBIDDEN','请在当前门店重新登录。')
  const chunks = []; let size = 0
  for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 380000) throw apiError(413,'TOO_LARGE','头像过大。'); chunks.push(Buffer.from(chunk)) }
  let body
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw apiError(400,'BAD_REQUEST','资料格式不正确。') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError(400,'BAD_REQUEST','资料格式不正确。')
  let name = user.display_name, avatar = user.avatar_url || ''
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || !body.displayName.trim() || [...body.displayName.trim()].length > 40 || /[<>\x00-\x1f]/.test(body.displayName)) throw apiError(400,'BAD_NAME','昵称请填写 1–40 个有效字符。')
    name = body.displayName.trim()
  }
  if (body.avatarData !== undefined) avatar = validateAvatar(body.avatarData, apiError)
  if (body.displayName === undefined && body.avatarData === undefined) throw apiError(400,'BAD_REQUEST','请选择头像或填写昵称。')
  db.prepare('UPDATE users SET display_name=?, avatar_url=? WHERE id=? AND tenant_id=?').run(name,avatar,user.id,tid)
  return json(res,200,{user:serializeUser(db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(user.id,tid),tid)})
}
