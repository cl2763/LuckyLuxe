/* 门店币种 —— **唯一真相 = `stores.currency`**(D140,Cowork 05i §二 裁,2026-09-05)

   为什么单开一个文件:币种是**钱的单位**,29 处在读它。
   出错的方式不是「显示得难看」,是**顾客付的钱差一个汇率** —— 小婕店是人民币。
   所以它值得和「钱怎么算」放在一起看,而不是埋在 18,000 行里。 */
export function createTenantCurrency(deps) {
  const { db, currentTenantId } = deps
  if (!db || typeof currentTenantId !== 'function') throw new Error('createTenantCurrency 缺依赖:db / currentTenantId')

  /* 🔴 D140(Cowork 05i §二 裁,2026-09-05):**门店币种唯一真相 = `stores.currency`**。

     原来这里是四层兜底:先读 `tenant_kb_facts.currency` → 读不到读 `stores.currency`
     → 再读不到 `'CAD'` → 连 `catch` 都回 `'CAD'`。和 J-20 一个形状(两处真相),
     但**这次错的是钱的单位**:小婕店是人民币,哪天知识库那行没了,
     加币的定金就会以人民币的数字收 —— 顾客付的钱直接差一个汇率。

     所以改成 **fail-closed**:只读 `stores`;读不到就**抛错**,不许静默用 CAD。
     凡要出钱数的口拿到这个错就**不出数**(转人工 / 报错),
     「拿不到真值就别出数」比「出一个看起来正常的错数」安全得多(《假数回落红线》同族)。 */
  class CurrencyUnresolved extends Error {
    constructor(tenantId) {
      super(`CURRENCY_UNRESOLVED: 门店 ${tenantId} 没有配币种(stores.currency 为空)—— 不出钱数`)
      this.code = 'CURRENCY_UNRESOLVED'
      this.tenantId = tenantId
    }
  }

  function tenantCurrencyCode(tenantId = currentTenantId()) {
    const store = db.prepare('SELECT currency FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC LIMIT 1').get(tenantId)
    const code = String(store?.currency || '').trim().toUpperCase().slice(0, 6)
    if (!code) throw new CurrencyUnresolved(tenantId)
    return code
  }

  /* 出钱数的口用这个:拿不到币种就回 null,由调用方决定「不出数」怎么说。
     ——「不出数」的判断必须显式,不许靠一个悄悄回落的默认值。 */
  function tenantCurrencyCodeOrNull(tenantId = currentTenantId()) {
    try {
      return tenantCurrencyCode(tenantId)
    } catch (e) {
      if (e?.code === 'CURRENCY_UNRESOLVED') return null
      throw e
    }
  }

  /* 2026-08-08 币种显示映射表:同一套代码,按币种查表渲染。
     CNY → 「¥358」(符号前置、无币种前缀、整数不带小数)
     CAD → 「CAD $50」/「CAD $50.00」—— 逐字维持现状,所以旗舰店对外文案零 diff。
     以后想改某个币种的展示格式,改这张表一行即可,不用翻遍全站。 */
  const CURRENCY_DISPLAY = {
    CNY: { prefix: '', symbol: '¥', trimZeroDecimals: true },
    DEFAULT: { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false }
  }

  function currencyDisplayOf(code) {
    return CURRENCY_DISPLAY[String(code || '').toUpperCase()] || CURRENCY_DISPLAY.DEFAULT
  }


  /* `currencyDisplayOf`(币符/前缀/是否去掉 .00)本来就住在币种旁边,
     搬模块时跟着过来了 —— 它确实属于这个域,所以导出而不是搬回去。 */
  return { tenantCurrencyCode, tenantCurrencyCodeOrNull, currencyDisplayOf, CurrencyUnresolved }
}
