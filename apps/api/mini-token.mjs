/* 小程序顾客身份串:编 / 解 / 签 / 签发(店主 夜11 段 B1,2026-09-14 从 `local-server.mjs` 摘出来)
 *
 * 摘出来的理由是裁 #89:巨型文件的棘轮要的不是「行数别涨」,是**别再往里倒东西**;
 * 本批往那个文件里加了一条路由分发(手机号绑定),就该从它里面搬走等量以上的东西。
 * 这四件是天然一组 —— 它们合起来就是「顾客身份串长什么样、谁签的」,
 * 而 `mini-token-secret.mjs`(那把钥匙从哪来)已经在隔壁,这里正好补上另一半。
 *
 * ✅ **09-14(07l)验签那一头 `customerFromMiniToken()` 也搬进来了** —— 上一版留在
 * `local-server.mjs` 是因为判据 `test-auth-surface ㊙①–㊙③` 从那个文件里抠这个函数体来验;
 * 这一批**连判据一起重锚**到本文件,并重新造病验红(改坏验签 → ㊙① 必须红),
 * 所以不是「搬走之后判据抠到空字符串」(J-58 空转)那种搬法。
 * 至此「顾客身份串长什么样、谁签的、谁验的」四件全在一处。
 */
import { createHmac } from 'node:crypto'

/** 有效期 7 天 —— 顾客不像商家有账号密码,过期就靠 `wx.login` 静默重登,顾客无感 */
export const MINI_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function makeMiniToken(secret, { db, apiError, serializeUser, demoAllowed = () => false } = {}) {
  const base64UrlEncode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const base64UrlDecode = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  const signMiniPayload = (payload) => createHmac('sha256', secret).update(payload).digest('base64url')
  const miniAuthFor = (user, openid) => {
    const expiresAt = Date.now() + MINI_TOKEN_TTL_MS
    const payload = base64UrlEncode({ sub: user.id, openid, exp: expiresAt })
    return {
      accessToken: `mini.${payload}.${signMiniPayload(payload)}`,
      refreshToken: null,
      expiresAt,
      expiresIn: Math.round(MINI_TOKEN_TTL_MS / 1000),
      tokenType: 'bearer',
    }
  }
  /* 验签那一头:签名不对 401 · 过期 401 · 还要 openid 对得上(光有签名不够) */
  const customerFromMiniToken = (token) => {
    if (!token || !token.startsWith('mini.')) return null
    const [, payload, signature] = token.split('.')
    if (!payload || !signature || signMiniPayload(payload) !== signature) throw apiError(401, 'UNAUTHORIZED', 'Invalid mini program session.')
    const data = base64UrlDecode(payload)
    if (!data.exp || Date.now() > Number(data.exp)) throw apiError(401, 'UNAUTHORIZED', 'Mini program session expired.')
    let user = db.prepare('SELECT * FROM users WHERE id = ? AND wechat_open_id = ?').get(data.sub, data.openid)
    // 演示登录旁路:demo-openid 无真实 openid,仅在演示开关下按用户 id 回退(生产不触发)
    if (!user && demoAllowed() && String(data.openid || '').startsWith('demo-openid-')) {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(data.sub)
    }
    if (!user) throw apiError(401, 'UNAUTHORIZED', 'Mini program user was not found.')
    return serializeUser(user)
  }
  return { base64UrlEncode, base64UrlDecode, signMiniPayload, miniAuthFor, customerFromMiniToken }
}
