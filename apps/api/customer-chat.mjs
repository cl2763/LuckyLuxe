/* 顾客侧 AI 对话 · 「这是谁」(D155,店主 2026-09-08)

   为什么需要这件东西:D155 把 `/ai/customer-service` 并进 `handleWecomInbound` 之后,
   会话流水成了**记忆的唯一真相**(客户端不再带 history)。而流水是按「外部用户」归档的 ——
   企微那边天然有 `external_userid`,小程序这边**没有**,得由我们定一个。

   定法(顺序不许颠倒):
   ① **登录了** → `mp:<用户 id>`。这个 id 是**服务端从令牌解出来的**,客户端伪造不了 ——
      顾客的会话历史只认这一条,谁也读不到别人的。
   ② **没登录** → `mp-guest:<客户端 id>`。小程序在本地存一个随机串带上来;
      前缀把访客和登录用户**分在两个命名空间**,访客串不到任何一个真实顾客头上。
   ③ 连客户端 id 都没有 → 现造一个。**这种会话没有记忆**(每句话各成一通),
      如实这样,不假装有 —— 想要记忆就把 ② 那个 id 带上。

   🔴 不许用 IP、不许用「租户 + 时间戳」这类看着能用其实会撞的东西当身份:
   撞了就是把两个顾客的对话并进同一通。 */

/** @returns {string} 归档这通对话用的外部用户 id */
export function customerChatIdentity(req, body = {}, { requireCustomer, randomId }) {
  try {
    const customer = requireCustomer(req)
    if (customer?.id) return `mp:${customer.id}`
  } catch { /* 没登录是正常情况,往下走访客那一路 */ }
  const clientId = String(body.clientId || body.client_id || '').trim().slice(0, 64)
  return clientId ? `mp-guest:${clientId}` : `mp-guest:${randomId('anon')}`
}
