/* 对外域名按租户出(店主 11p §三 裁,2026-09-23)
 *
 * ══ 案由 ══
 * `APP_PUBLIC_URL` 是**一个全局常量**:所有店的推荐链接 / 签署链接 / 绑定链接都用它。
 * 而现在两家真店要分别落在两个域上:
 *   · 境内(`jics-nail` / `luvia-bj`)⇒ `https://app.jingshengyouji.com`(已备案,11f/11h 那条代理链)
 *   · 境外(`lucky-luxe`)          ⇒ `https://www.luckyluxeatelier.com`
 * 一个全局常量表达不了这件事 —— 小婕的顾客会收到一条境外域名的签署链接,
 * 那条链接在境内打不开(或者慢到打不开),**而系统不会有任何报错**。
 *
 * ══ 形状(唯一出口)══
 * 🔴 **三处用处全走这一个函数**,不许任何一处直接读 `APP_PUBLIC_URL`:
 *    推荐链接 `/?ref=` · 签署链接 `/sign?t=` · 绑定链接 `/bind?t=`。
 * 取值顺序,**每一层都明写**:
 *   ① 该店自己配的 `tenant_settings.public_domain`(平台后台建店表单那个下拉写进来的)
 *   ② 没配 ⇒ 按币种推:`CNY` ⇒ 境内域;其余 ⇒ 境外域
 *   ③ 都取不到 ⇒ 全局 `APP_PUBLIC_URL`(旧行为,不回落成写死的字面量)
 *
 * 🔴 **②那一层是「推」不是「猜」**:币种是店主建店时必选的(D210),
 *    所以它是一个**她确实做过的选择**,不是系统替她编的。
 *    而且它可以被①覆盖 —— 有例外就配一条,不用改代码。 */

/** 两个域各有一个名字,别处引用名字,不引用字面量 */
export const DOMAIN_CN = 'https://app.jingshengyouji.com'
export const DOMAIN_INTL = 'https://www.luckyluxeatelier.com'
/* ⚠️ 名字里不带 `KEY`:J-53 的密钥扫描按名字认「密钥类常量」,叫 *_KEY 会被它点名。
   这不是密钥,是 `tenant_settings` 里那一行的 key 名。(11m 的 SETTING_NAME 同款,第二次撞了。) */
export const PUBLIC_DOMAIN_SETTING = 'public_domain'
/** 平台后台那个下拉只有这两档 —— 值是「境内/境外」,不是域名本身(域名换了不用改每家店的配置) */
export const DOMAIN_CHOICES = ['cn', 'intl']

export function createTenantPublicUrl({ db, currentTenantId, fallbackUrl, localUrl }) {
  if (!db || !currentTenantId) throw new Error('createTenantPublicUrl 缺依赖')

  function domainChoiceOf(tenantId) {
    try {
      const row = db.prepare('SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?')
        .get(tenantId, PUBLIC_DOMAIN_SETTING)
      const v = String(row?.value || '').trim()
      return DOMAIN_CHOICES.includes(v) ? v : ''
    } catch (e) { return '' }
  }

  function currencyOf(tenantId) {
    try {
      const row = db.prepare('SELECT currency FROM stores WHERE tenant_id = ? LIMIT 1').get(tenantId)
      return String(row?.currency || '').toUpperCase()
    } catch (e) { return '' }
  }

  /** 这家店对外用哪个域 —— 唯一出口 */
  function publicUrlOf(tenantId = currentTenantId()) {
    const choice = domainChoiceOf(tenantId)
    if (choice === 'cn') return DOMAIN_CN
    if (choice === 'intl') return DOMAIN_INTL
    if (currencyOf(tenantId) === 'CNY') return DOMAIN_CN
    /* 🔴 最后一层是**全局环境变量**,不是写死的字面量 ——
       本机/沙箱跑起来时它指向 127.0.0.1,链接才点得开;写死了本地就永远拿到线上域名。 */
    return String(fallbackUrl() || DOMAIN_INTL).replace(/\/$/, '')
  }

  /** 平台后台建店/改配置时写进来 */
  function setDomainChoice(tenantId, choice) {
    const v = String(choice || '').trim()
    if (!DOMAIN_CHOICES.includes(v)) return false
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(tenantId, PUBLIC_DOMAIN_SETTING, v, now)
    return true
  }

  /* 顾客端草稿链接那一条:本机/沙箱要能点得开,所以**没配环境变量时回落到本机地址**,
     不是回落到线上域名(线上域名在本机是点不开的)。这一支与 `publicUrlOf` 的差别就在这里,
     所以它单独一个函数,而不是给上面那个加一个 flag —— 两件事,两个名字。 */
  function customerUrl() {
    return String(localUrl ? localUrl() : (fallbackUrl() || DOMAIN_INTL)).replace(/\/$/, '')
  }

  function wechatWebhookUrl(tenantId) {
    return `${publicUrlOf(tenantId)}/wechat/customer-service/webhook`
  }

  return { publicUrlOf, customerUrl, wechatWebhookUrl, setDomainChoice, domainChoiceOf, DOMAIN_CN, DOMAIN_INTL, DOMAIN_CHOICES }
}
