/* 小程序顾客身份串:编 / 解 / 签 / 签发(店主 夜11 段 B1,2026-09-14 从 `local-server.mjs` 摘出来)
 *
 * 摘出来的理由是裁 #89:巨型文件的棘轮要的不是「行数别涨」,是**别再往里倒东西**;
 * 本批往那个文件里加了一条路由分发(手机号绑定),就该从它里面搬走等量以上的东西。
 * 这四件是天然一组 —— 它们合起来就是「顾客身份串长什么样、谁签的」,
 * 而 `mini-token-secret.mjs`(那把钥匙从哪来)已经在隔壁,这里正好补上另一半。
 *
 * ⚠️ **验签那一头 `customerFromMiniToken()` 仍留在 `local-server.mjs`** —— 不是漏了:
 * 判据 `test-auth-surface.mjs:346` 是从那个文件里抠这个函数体来验「验签不过当场 401」的。
 * 一起搬会让那条判据抠到空字符串(J-58:判据空转当红处理)。
 * 要搬得连判据一起重锚,那是单独一件事,**这一批不夹带**。
 */
import { createHmac } from 'node:crypto'

/** 有效期 7 天 —— 顾客不像商家有账号密码,过期就靠 `wx.login` 静默重登,顾客无感 */
export const MINI_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function makeMiniToken(secret) {
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
  return { base64UrlEncode, base64UrlDecode, signMiniPayload, miniAuthFor }
}
