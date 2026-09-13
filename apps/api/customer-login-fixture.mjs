/* 夹具建顾客的**唯一出口**:走正门(店主 07i §五,2026-09-13)
 *
 * ══ 为什么只留一条路 ══
 * 主档(演示门开着)那几套建顾客走的是**演示路**,门关档走**正门** ——
 * 就这么留着,两档会变成两条不同的路。**那正是 07d 我自己栽的那一跤:
 * 收敛完又分叉了,而分叉藏在参数顺序里。**
 * 演示登录路在生产上本来就不存在,让它继续在主档里扮演「顾客怎么来的」,
 * 等于让主档永远在测一条不存在的路。
 *
 * ══ 走的是哪条正门 ══
 * `POST /auth/wechat/mini-login` —— 与真顾客一模一样的那条:
 *   code → (ci/sandbox 走替身那一跳) → **响应校验** → **严格认人四条** → **真签发**。
 * 被替的只有「问腾讯这个 code 是谁」;token 是 `signMiniPayload` 真签的,
 * 下游 `customerFromMiniToken` 真验签、真验过期、真对 openid。
 *
 * ⚠️ 这个文件**不叫 `test-*`** —— 那样会被回归当成一支套件去跑。它是夹具,不是判据。
 */

/**
 * 按一个已知 openid 从正门登录,拿真签发的顾客 token。
 * @param {{ base: string, tenantId: string, openid: string, phone?: string, displayName?: string }} o
 * @returns {Promise<{ ok: boolean, status: number, user?: object, accessToken?: string, body?: object }>}
 */
export async function loginCustomerViaFrontDoor({ base, tenantId, openid, phone = '', displayName = '' }) {
  const res = await fetch(`${base}/auth/wechat/mini-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId },
    /* code 里带上要哪个 openid —— **写在请求里,不经环境变量**(裁 #80:没有开关) */
    body: JSON.stringify({ code: `stub:${openid}`, tenantId, phone, displayName }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, user: body.user, accessToken: body?.auth?.accessToken, body }
}
