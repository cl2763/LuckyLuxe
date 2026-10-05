/* WeChat mini-program QR. Only the server holds app credentials; the scene is a
 * short bearer alias for one already-issued, expiring sign/bind token. */
let cached = null

export function sceneForToken(token) {
  const match = /^(sg_|bind_)([0-9a-f]{64})$/.exec(String(token || ''))
  if (!match) throw new Error('无效的小程序码令牌')
  return `${match[1] === 'sg_' ? 's' : 'b'}${match[2].slice(0, 24)}`
}

export async function getMiniCode({ appid, secret, scene, page = 'pages/scan-entry/index', envVersion = 'trial', fetcher = fetch }) {
  if (!appid || !secret) throw new Error('小程序码配置未就绪')
  if (!/^[sb][0-9a-f]{24}$/.test(scene)) throw new Error('小程序码场景无效')
  if (!cached || cached.appid !== appid || cached.secret !== secret || cached.expires <= Date.now()) {
    const query = new URLSearchParams({ grant_type: 'client_credential', appid, secret })
    const response = await fetcher(`https://api.weixin.qq.com/cgi-bin/token?${query}`, { signal: AbortSignal.timeout(8000) })
    const body = await response.json()
    if (!response.ok || body.errcode || !body.access_token || !Number.isFinite(body.expires_in)) {
      throw new Error(`微信小程序码凭据获取失败(${body.errcode || response.status})`)
    }
    cached = { appid, secret, token: body.access_token, expires: Date.now() + Math.max(0, body.expires_in - 120) * 1000 }
  }
  const response = await fetcher(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(cached.token)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // 未发布的新页面尚不在微信的正式路径目录中；体验/开发码需跳过正式版路径检查。
    body: JSON.stringify({ scene, page, width: 430, env_version: envVersion, check_path: envVersion === 'release' }),
    signal: AbortSignal.timeout(10000)
  })
  const type = response.headers.get('content-type') || ''
  if (!response.ok || !type.includes('image/')) {
    let code = response.status
    try { code = (await response.json()).errcode || code } catch {}
    throw new Error(`微信小程序码生成失败(${code})`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const png = bytes.toString('hex', 0, 8) === '89504e470d0a1a0a'
  const jpeg = bytes.toString('hex', 0, 2) === 'ffd8' && bytes.toString('hex', bytes.length - 2) === 'ffd9'
  if (bytes.length < 100 || bytes.length > 2_000_000 || (!png && !jpeg)) {
    throw new Error('微信小程序码返回了无效图片')
  }
  return { bytes, mimeType: png ? 'image/png' : 'image/jpeg' }
}
