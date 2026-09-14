/* 身份行的**种类**:哪些算「已经绑过微信登录」(D191 修法,店主 07n §〇,2026-09-14)
 *
 * ══ D191 是怎么来的 ══
 * 严格认人四条里第三条「**还没绑过微信**」,原来写成:
 *     NOT EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id)
 * 也就是「这个人名下**一行身份记录都没有**」。
 * 而平台导入老顾客时(`import-customers.mjs`)会给**每一位**建一行 `provider='phone'` ——
 * 于是「**导入过的人 = 永远认领不了的人**」。
 *
 * 店主的定性,照录:**错的是那个等号。**
 *   > **「有身份记录」≠「已经绑过微信」。**
 * 归族 J-37:**存在 ≠ 是那一种**。判据数的是「有没有行」,而它想拦的是「是不是微信绑定」。
 *
 * ══ 为什么不许用「黑名单」写法 ══
 * 写成「排除 provider='phone'」是黑名单 —— 明天多一个 `sms` / `import` provider,它又漏。
 * 所以这里是**分类表**:仓里出现过的每一个 provider **都必须在表里有一行,并写明理由**;
 * 判据 `test-identity-kinds` 会把全仓的 provider 字面量抠出来逐个对表,新来的当场红。
 *
 * ══ 认不出来的 provider 往哪边倒 ══
 * **倒向「算微信登录」(= 不许被手机号认领)。**
 * 两种错法的代价不对称:
 *   · 错拦一次 → 顾客看到「这个号已被使用」,她会说,我们当场知道;
 *   · 错认一次 → **两个人的档案合成一份**,钱和消费记录混在一起,**没有人会发现**。
 * 失败朝安全那边倒。
 */

/** 仓里出现过的每一个 provider,逐个写明是不是「微信登录身份」 */
export const IDENTITY_PROVIDERS = {
  wechat_miniprogram: { wechatLogin: true, why: '小程序登录:这就是「绑过微信」本身' },
  google: { wechatLogin: true, why: '第三方登录身份 —— 不是微信,但同样是「这份档案已被某个登录身份占用」,不许再被手机号认领' },
  email: { wechatLogin: true, why: '同上:邮箱登录也是登录身份' },
  account: { wechatLogin: true, why: '账号密码身份(商家/员工),不是顾客手机号认领的对象' },
  owner: { wechatLogin: true, why: '老板账号,同上' },
  phone: { wechatLogin: false, why: '🔴 D191 就卡在这一行:导入老顾客时建的手机号凭据。它**正是手机号认领要用的东西**,不是拦路的理由' },
  wecom_customer_service: { wechatLogin: false, why: '企微客服**会话**标识,不是账号登录身份;把它算进去等于让「跟客服聊过天」的老顾客也认不出来(D191 复发)' },
  mock: { wechatLogin: false, why: '演示/测试用的假身份,不代表任何真实绑定' },
}

/** 认不出来的 provider → 当作「已被登录身份占用」(失败朝安全那边) */
export function isWechatLoginProvider(provider) {
  const row = IDENTITY_PROVIDERS[String(provider || '')]
  return row ? row.wechatLogin : true
}

/** 「微信登录类」的 provider 清单 —— 给 SQL 用 */
export const WECHAT_LOGIN_PROVIDERS = Object.entries(IDENTITY_PROVIDERS)
  .filter(([, v]) => v.wechatLogin).map(([k]) => k)

/**
 * 严格认人四条里**第三条**的 SQL 片段。
 * 🔴 只改这一条:**本店 / 号完全一致 / 唯一一条,一个字不许动**(店主 07n §八 停线)。
 * 认不出来的 provider 也要挡住 —— 所以是「provider 不在『不算登录』那张白名单里」,
 * 而不是「provider 在登录那张名单里」:前者对新来的 provider 是**挡**,后者是**放**。
 */
export function notBoundByLoginIdentitySql(alias = 'u') {
  const safe = Object.entries(IDENTITY_PROVIDERS).filter(([, v]) => !v.wechatLogin).map(([k]) => `'${k}'`)
  return `NOT EXISTS (
          SELECT 1 FROM user_identities i
          WHERE i.user_id = ${alias}.id AND i.provider NOT IN (${safe.join(', ')})
        )`
}

/* unionid 跨端认人 —— 同域搬过来(裁 #89:摘出去,不往巨型文件里倒)
 * 同一个微信用户从公众号/企微等别的端已注册过时(**同一家店内**),认成同一个人而不是新建。
 * ⚠️ 带租户:不带就会把 A 店那一行认成 B 店顾客(跨店串号的根子)。 */
export function makeUnionIdResolver(db) {
  return (unionId, tenantId) => {
    if (!unionId) return null
    return db.prepare(`
      SELECT users.* FROM user_identities
      JOIN users ON users.id = user_identities.user_id
      WHERE user_identities.union_id = ? AND users.tenant_id = ?
      ORDER BY user_identities.created_at ASC
    `).get(unionId, tenantId) || null
  }
}
