/* D228:手机号组件 code 与 wx.login code 是两种凭证，不能混用。
 * 官方接口：https://developers.weixin.qq.com/miniprogram/dev/server/API/user-info/phone-number/api_getphonenumber.html
 * ci/sandbox 只用显式替身；生产固定微信地址，不提供可改上游的环境变量。
 */
import { DEV_SCOPES } from './secret-gate.mjs'

let cached = null
async function realPhoneByCode({ code, openid, appid, secret }) {
  if (!appid || !secret) throw new Error('小程序手机号授权配置未就绪，请联系平台。')
  if (!cached || cached.appid !== appid || cached.secret !== secret || cached.expires <= Date.now()) {
    const query = new URLSearchParams({ grant_type: 'client_credential', appid, secret })
    const r = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`, { signal: AbortSignal.timeout(8000) })
    const d = await r.json()
    if (!r.ok || d.errcode || !d.access_token || !Number.isFinite(d.expires_in)) {
      throw new Error(`微信访问凭据获取失败(${d.errcode || r.status})，请重试。`)
    }
    cached = { appid, secret, token: d.access_token, expires: Date.now() + Math.max(0, d.expires_in - 120) * 1000 }
  }
  const r = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(cached.token)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, openid }), signal: AbortSignal.timeout(8000)
  })
  const d = await r.json()
  if ([40001, 40014, 42001].includes(d.errcode)) cached = null
  return { ok: r.ok, data: d, viaStub: false }
}

export async function fetchPhoneByCode({ code, openid, appid, secret, scopeName }) {
  if (!DEV_SCOPES.has(scopeName)) return realPhoneByCode({ code, openid, appid, secret })
  const parts = String(code).split(':')
  if (parts[0] === 'stub-phone-error') return { ok: true, viaStub: true, data: { errcode: Number(parts[1]) || 40001 } }
  if (parts[0] !== 'stub-phone' || parts[1] !== openid || !/^\d{6,15}$/.test(parts[2] || '')) {
    return { ok: true, viaStub: true, data: { errcode: 40029 } }
  }
  return { ok: true, viaStub: true, data: { errcode: 0, phone_info: {
    purePhoneNumber: parts[2], watermark: { appid, timestamp: Math.floor(Date.now() / 1000) }
  } } }
}
