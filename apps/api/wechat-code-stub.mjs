/* 微信 `jscode2session` 那一跳的**替身**(店主 07i 裁 #80,2026-09-13)
 *
 * ══ 只替一跳 ══
 * 「问腾讯这个 code 是谁」这一跳,在任何回归里都**不可能真做** ——
 * 要真凭据、要外网、要一个真人在真微信里点一下。换替身。
 * **换完之后后面每一步照旧真跑**:校验响应 → 严格认人四条 → `signMiniPayload` **真签发**。
 * 所以那四套在门关档转的绿**是真绿**,token 是真签发的。
 *
 * ══ 🔴 替身由**库域**选,不由**开关**选(店主 07i §二 明令)══
 * 我原来提的是 `WECHAT_JSCODE2SESSION_URL` 这种环境变量。**店主不收,理由比我想的深**:
 *   这个变量一旦存在,**谁在生产上设一下,就能把身份来源指到任何一台服务器,给任意顾客造 openid**。
 *   那比 J-53 那个洞更大 —— J-53 至少要读过仓库才拿得到密钥,这个只要能改一行环境变量。
 *   **没有开关,就没有被拨错的开关。**
 * 所以:`ci` / `sandbox` → 替身;其余库域 → **硬编真地址,连开关都不提供**。
 * 库域判断**复用现成的** `DEV_SCOPES`(secret-gate.mjs),不另写一套。
 *
 * ══ 名字不许骗人(店主 07i §三)══
 * 文件名、函数名、常量名一律带 `Stub` —— 不许起 `..._URL` / `..._ENDPOINT` 这种
 * 看起来像正常部署配置的名字。半年后来看这段码的人要**一眼**认出它是替身。
 * (J-49 第二款的正向用法:第二款禁「换同义词躲判据」,这条禁「起个看不出是替身的名字」。)
 *
 * ══ 将来真要可配置上游(企业代理、境内镜像)══
 * **那时候单独提、单独画、单独走 J-53 的闸。现在不预留** ——
 * 预留的开关和已启用的开关,在被拨错这件事上是一样的。
 */
import { createHash } from 'node:crypto'
import { DEV_SCOPES } from './secret-gate.mjs'

/* 真地址:**硬编,不可配置**。全仓直连 `sns/jscode2session` 只许这一处(判据⑤守着)。 */
const WECHAT_JSCODE2SESSION_REAL = 'https://api.weixin.qq.com/sns/jscode2session'

/* 替身识别前缀:夹具把「我要哪个 openid」写进 code 里,**不经环境变量**。
   · `stub:<openid>[:<unionid>]` —— 指定一个 openid(夹具要驱动严格认人四条时用)
   · `stub-err:<errcode>`       —— 让替身回微信的错误形态(造病③用)
   · `stub-bad`                 —— 回畸形/空 openid(造病③用)
   · 其它任何 code              —— 由 code 推一个**确定的** openid(同一个 code 永远同一个人) */
export const STUB_CODE_PREFIX = 'stub'

export function isStubScope(scopeName) { return DEV_SCOPES.has(scopeName) }

/** 替身产出的「微信响应」。**只在 ci/sandbox 可达**;别的库域调它一律抛。 */
export function stubJsCode2SessionResponse(code, scopeName) {
  if (!isStubScope(scopeName)) {
    throw new Error(`替身只在 ci/sandbox 可达,当前库域 ${scopeName} —— 这一条是硬的,没有开关能打开它`)
  }
  const raw = String(code || '')
  if (raw.startsWith('stub-err:')) {
    const errcode = Number(raw.slice('stub-err:'.length)) || 40029
    return { errcode, errmsg: 'stub: invalid code' }
  }
  if (raw === 'stub-bad') return { session_key: 'stub', openid: '' }   /* 空 openid:响应校验该拒 */
  if (raw.startsWith('stub:')) {
    const [, openid = '', unionid = ''] = raw.split(':')
    return { openid, unionid: unionid || undefined, session_key: 'stub-session' }
  }
  const h = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  return { openid: `stub-openid-${h}`, session_key: 'stub-session' }
}

/**
 * `jscode2session` 那一跳的**唯一出口**。
 * ci/sandbox → 替身(不出网);其余库域 → 真地址(硬编)。
 * @returns {Promise<{ data: object, viaStub: boolean }>}
 */
export async function fetchJsCode2Session({ code, appid, secret, scopeName }) {
  if (isStubScope(scopeName)) {
    return { data: stubJsCode2SessionResponse(code, scopeName), viaStub: true }
  }
  const params = new URLSearchParams({ appid, secret, js_code: code, grant_type: 'authorization_code' })
  const response = await fetch(`${WECHAT_JSCODE2SESSION_REAL}?${params.toString()}`)
  const data = await response.json().catch(() => ({}))
  return { data, viaStub: false, ok: response.ok }
}
