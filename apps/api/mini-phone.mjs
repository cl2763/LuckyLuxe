/* 小程序:授权手机号 → **按真算法解密** → 落到这家店的档案上(店主 夜11 段 B1/B2)
 *
 * 这一整段单独成文件,不往 `local-server.mjs` 里倒(裁 #89:顶破棘轮的正确反应是**摘出去**)。
 *
 * ══ 为什么不存 `session_key` ══
 * `session_key` 是 `jscode2session` 当场给的、**跟着每次 wx.login 变**的东西。
 * 存起来就要回答「存哪、多久过期、泄了怎么办」三个问题,而这一步压根不需要它跨请求活着 ——
 * 前端在点「允许」的同时**再 `wx.login` 一次**,把新的 `code` 和密文一起送上来,
 * 服务端自己换一把 key、当场解、当场丢。**库里不落 key,就没有 key 会泄。**
 *
 * ══ 解密失败一律拒(J-53 同族)══
 * **不许兜成「那就当没有手机号」继续走。** D190 之后我们知道:一个没手机号的档案
 * 就是一个后台永远认不出来的人。宁可让她再点一次,也不许静默生出一个空号档案。
 */
import { decryptWechatPhone } from './wechat-phone.mjs'
import { fetchPhoneByCode } from './wechat-phone-code.mjs'
import { DEV_SCOPES } from './secret-gate.mjs'

/** 缺号标记:与 `write-intake.mjs` 同一个词,补上号就摘掉 */
export const NO_PHONE_TAG = '无手机号'

/** 这个人还要不要问手机号 —— **判条件只有这一条:她这家店的档案上有没有号。**
 *  有号 → 永远不再问(「只问一次」就是这么成立的);没号 → 问。 */
export function needsPhone(user) {
  return !String((user && (user.phone ?? user.phone_number)) || '').trim()
}

function dropNoPhoneTag(tagsJson) {
  let tags = []
  try { tags = JSON.parse(tagsJson || '[]') } catch { tags = [] }
  if (!Array.isArray(tags)) tags = []
  return JSON.stringify(tags.filter((t) => String(t) !== NO_PHONE_TAG))
}

// 登录认领与补号共用同一微信验证；客户端自填 phone 不能证明号码所有权。
async function verifiedPhone({ body, openid, appid, secret, scopeName, apiError, fetchPhone = fetchPhoneByCode }) {
  let hop
  try { hop = await fetchPhone({ code: String(body.phoneCode).trim(), openid, appid, secret, scopeName }) }
  catch { throw apiError(502, 'WECHAT_PHONE_UNAVAILABLE', '微信手机号授权暂不可用，请重试。') }
  const info = hop?.data?.phone_info
  if (!hop?.ok || hop.data.errcode || !info || !/^\d{6,15}$/.test(info.purePhoneNumber || '')) {
    throw apiError(400, 'WECHAT_PHONE_FAILED', '手机号授权失败，请重新点击授权。')
  }
  if (info.watermark?.appid !== appid) throw apiError(403, 'WECHAT_APPID_MISMATCH', '手机号授权不属于当前小程序。')
  return info.purePhoneNumber
}

export async function resolveLoginPhone(options) {
  if (String(options.body.phoneCode || '').trim()) return verifiedPhone(options)
  // 老回归夹具仅在明确隔离的 CI / 沙箱中兼容。生产只信微信授权凭证。
  return DEV_SCOPES.has(options.scopeName) ? String(options.body.phone || '').trim() : ''
}

/**
 * `POST /auth/wechat/mini-phone`
 * 入参:`{ code, encryptedData, iv }`(`code` 是**当场新取**的 wx.login code)
 */
export async function bindMiniPhone({ body = {}, req, db, apiError, requireCustomer,
  fetchJsCode2Session, appid, secret, scopeName }) {
  const customer = requireCustomer(req)                       // 没登录不许绑号
  if (String(body.phoneCode || '').trim()) {
    const row = db.prepare('SELECT id, tags_json, wechat_open_id FROM users WHERE id = ?').get(customer.id)
    if (!row || !row.wechat_open_id) throw apiError(403, 'WECHAT_LOGIN_REQUIRED', '请先用微信登录后再授权手机号。')
    const phone = await verifiedPhone({ body, openid: row.wechat_open_id, appid, secret, scopeName, apiError })
    db.prepare('UPDATE users SET phone = ?, tags_json = ? WHERE id = ?')
      .run(phone, dropNoPhoneTag(row.tags_json), customer.id)
    return { ok: true, phone, needPhone: false }
  }
  const code = String(body.code || '').trim()
  const encryptedData = String(body.encryptedData || '').trim()
  const iv = String(body.iv || '').trim()
  if (!code) throw apiError(400, 'BAD_REQUEST', '缺 wx.login code(授权手机号时要当场再取一次)。')
  if (!encryptedData || !iv) throw apiError(400, 'BAD_REQUEST', '缺微信返回的 encryptedData / iv。')

  const hop = await fetchJsCode2Session({ code, appid, secret, scopeName })
  const data = hop.data || {}
  if (hop.ok === false || data.errcode || !data.openid) {
    throw apiError(401, 'WECHAT_LOGIN_FAILED', data.errmsg || '微信换 session_key 失败,请重试。')
  }
  /* 安全边界:这把 code 换出来的人,必须**就是**当前登录的这个人。
     不然 A 拿 B 的 code 上来,就能把 B 的手机号写进 A 的档案。 */
  const row = db.prepare('SELECT id, phone, tags_json, wechat_open_id FROM users WHERE id = ?').get(customer.id)
  if (!row) throw apiError(404, 'NOT_FOUND', '档案不存在。')
  if (row.wechat_open_id && row.wechat_open_id !== data.openid) {
    throw apiError(403, 'WECHAT_OPENID_MISMATCH', '这次授权的微信号与当前登录的不是同一个。')
  }

  let decoded = null
  try {
    decoded = decryptWechatPhone({ encryptedData, iv, sessionKey: data.session_key })
  } catch (e) {
    /* 🔴 这里**只许抛**。改成 `decoded = { phoneNumber: '' }` 就等于把「解密坏了」
       静默变成「这人没手机号」—— 静默失败器族,判据 ㊙⑭b 专门造病守这一条。 */
    throw apiError(400, 'WECHAT_PHONE_DECRYPT_FAILED', `手机号解密失败,请重试。(${e && e.message})`)
  }

  db.prepare('UPDATE users SET phone = ?, tags_json = ? WHERE id = ?')
    .run(decoded.phoneNumber, dropNoPhoneTag(row.tags_json), customer.id)
  return { ok: true, phone: decoded.phoneNumber, needPhone: false }
}
