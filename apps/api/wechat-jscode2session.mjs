/* 全仓**唯一**一条通往腾讯的真路(店主 夜11 段 B1,2026-09-14 从 `wechat-code-stub.mjs` 摘出来)
 *
 * ══ 为什么要跟替身分家 ══
 * 那个文件叫 `wechat-code-stub`,却同时藏着这条**真**出网请求 —— 名不副实
 * (店主 07i §三:**名字不许骗人**)。分开之后一眼看得清:
 *   · `wechat-code-stub.mjs`   —— 假的那半,ci/sandbox 用,**不出网**
 *   · `wechat-jscode2session.mjs`(本文件)—— 真的那半,**全仓只此一处出网**
 * 判据 `test-wechat-stub.mjs ⑤` 白名单式守着「直连 `sns/jscode2session` 只许 1 处」,
 * 锚的就是本文件;冒出第二处当场红。
 */

/** 真地址:**硬编,不可配置**。可配置就等于多一个能被拨错的开关(裁 #80 同理)。 */
const WECHAT_JSCODE2SESSION_REAL = 'https://api.weixin.qq.com/sns/jscode2session'

export async function realJsCode2Session({ code, appid, secret }) {
  const params = new URLSearchParams({ appid, secret, js_code: code, grant_type: 'authorization_code' })
  const response = await fetch(`${WECHAT_JSCODE2SESSION_REAL}?${params.toString()}`)
  const data = await response.json().catch(() => ({}))
  return { data, viaStub: false, ok: response.ok }
}
