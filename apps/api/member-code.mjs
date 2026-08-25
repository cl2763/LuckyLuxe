/* 会员码域(从 local-server.mjs 搬出,2026-08-25 A 线)。

   为什么这一批搬它:A1 清单 M2 记的就是这块 —— 两个顾客端各写了一份**会员码回落**
   (网页 compactUserCode / 小程序按 displayName 猜),而后端这里才是唯一算法。
   先把唯一算法搬成独立模块、名字叫清楚,回落那两处的收口(M2)排在 Cowork 裁完之后。
   **行为一字未改**,依赖注入。 */
export function createMemberCode({ db }) {
  function memberCodeForUserId(userId) {
    return `LL-${String(userId || 'member').replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase().padStart(8, '0')}`
  }

  function displayNameForUserId(userId) {
    return memberCodeForUserId(userId)
  }

  /* 会员码 → 档案(规则⑥ 反查)。会员码是从 userId 末 8 位推导的,不可逆,
     所以反查靠比对:命中唯一一条才认,零条或多条都不认(与「歧义不合并身份」同一条纪律)。 */
  function userIdFromMemberCode(memberCode) {
    const want = String(memberCode || '').trim().toUpperCase()
    if (!/^LL-[A-Z0-9]{8}$/.test(want)) return ''
    const hits = db.prepare('SELECT id FROM users').all().filter((u) => memberCodeForUserId(u.id) === want)
    return hits.length === 1 ? hits[0].id : ''
  }

  function isGenericDisplayName(value, userId = '') {
    const displayName = String(value || '').trim()
    if (!displayName) return true
    return ['Lucky Member', '微信用户', 'WeChat User', displayNameForUserId(userId)].includes(displayName)
  }

  return { memberCodeForUserId, displayNameForUserId, userIdFromMemberCode, isGenericDisplayName }
}
