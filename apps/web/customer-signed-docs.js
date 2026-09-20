/* 顾客端「我签署过的文件」· 只读(图 v2 第 5 屏 · 10d §二 批准)
 *
 * 🔴 这一屏的规矩全在「不能做什么」上,逐条对应到代码:
 *   · **只看自己的** —— 后端按「本人 + 同一家店」两个条件查,前端不传任何 id,连猜都猜不了
 *   · **不能传 / 不能删 / 不能作废** —— 本文件**一个写请求都没有**(全文只有 GET)
 *   · **作废掉的不显示** —— 后端就不下发,前端没有"过滤掉"这一步(过滤在前端 = 数据到过前端)
 *   · 句子全部后端出(`emptyText` / `readOnlyNote` / `signedAtText`),前端零拼串
 *
 * 🔴 为什么独立成文件、而且**自己挂载**:`apps/web/customer.js` 2,458 行,
 * 早已超过公约③ 给前端视图模块的 1,500 行上限 —— **超线文件不许再加新功能**。
 * 所以这一件不往里加一个字符:本文件用 MutationObserver 认出「我的」页,自己把区块插进去。
 */
;(function () {
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const SECTION_ID = 'customerSignedDocs'
  let lastKey = ''

  /* 🔴 这两个键名与取法我第一版是**猜**的(猜了 `lucky-customer-auth`、猜了 `data-tenant` 属性)。
     按 J-83② 去看了那一行:真的是 `lucky-web-tenant` + `lucky-web-auth`,
     而且 auth 是**带租户标的**(`readTenantJson`:`__tenant` 对不上就丢弃,D77 换店串号那条)。
     这里照抄同一套判断 —— 不是抄名字,是抄**那条「租户对不上就当没登录」的规矩**。 */
  function tenantId() {
    const q = new URLSearchParams(location.search)
    const t = (q.get('store') || q.get('tenant') || '').trim()
    if (t) return t
    try { return localStorage.getItem('lucky-web-tenant') || ((window.LL_DEPLOY || {}).defaultTenantId || '') }
    catch { return (window.LL_DEPLOY || {}).defaultTenantId || '' }
  }
  function customerAuth(tid) {
    let raw = null
    try { raw = JSON.parse(localStorage.getItem('lucky-web-auth') || 'null') } catch { return null }
    if (!raw || typeof raw !== 'object' || !('__tenant' in raw)) return null
    if (raw.__tenant !== tid) return null            // D77:换了店就当没登录,不拿上一家的令牌打这一家
    return raw.__value                               // 🔴 存的是 {__tenant, __value},令牌在里面一层(现读 customer.js:142)
  }

  /* 只读取:全文唯一一个网络调用,且是 GET */
  async function fetchDocs() {
    const tid = tenantId()
    if (!tid) return null
    const auth = customerAuth(tid)
    if (!auth?.accessToken) return null
    const r = await fetch('/my/signed-docs', {
      headers: { 'content-type': 'application/json', 'x-tenant-id': tid, authorization: `Bearer ${auth.accessToken}` },
    })
    if (!r.ok) return null
    return r.json()
  }

  function render(host, data) {
    const docs = data.docs || []
    host.innerHTML = `
      <div class="section-row"><h2>${esc(data.blockTitle)}</h2></div>
      ${docs.length ? `
        <div class="signed-docs-mine">${docs.map((d) => `
          <div class="signed-doc-mine">
            <span class="signed-doc-thumb" aria-hidden="true"></span>
            <span class="signed-doc-text">
              <span class="signed-doc-title">${esc(d.title)}</span>
              <span class="signed-doc-meta">${esc(d.signedAtText)} · ${esc(d.pageCountText)}</span>
            </span>
          </div>`).join('')}</div>
        <p class="subtle">${esc(data.readOnlyNote)}</p>`
        : `<div class="empty-state">${esc(data.emptyText)}<br><span class="subtle">${esc(data.emptyHint)}</span></div>`}`
  }

  /* 认出「我的」页就把区块插在消费记录那一段后面(图:跟卡包、订单放一起,不另开入口) */
  async function sync() {
    const grid = document.querySelector('.menu-grid-web')
    if (!grid) { lastKey = ''; return }                 // 不在「我的」页
    const anchor = grid.closest('section')
    if (!anchor || !anchor.parentNode) return
    const key = anchor.parentNode.childElementCount + ':' + (document.querySelector(`#${SECTION_ID}`) ? 1 : 0)
    if (key === lastKey) return
    lastKey = key
    let host = document.querySelector(`#${SECTION_ID}`)
    if (!host) {
      host = document.createElement('section')
      host.className = 'section'
      host.id = SECTION_ID
      anchor.parentNode.insertBefore(host, anchor)      // 插在「功能」格子之前
    }
    const data = await fetchDocs()
    if (!data) { host.remove(); lastKey = ''; return }  // 没登录 / 拿不到 → 整块不出现,不留空壳
    render(host, data)
  }

  const obs = new MutationObserver(() => { sync().catch(() => { lastKey = '' }) })
  function start() {
    const root = document.querySelector('#appView') || document.body
    obs.observe(root, { childList: true, subtree: true })
    sync().catch(() => {})
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
