/* 注册按钮门(店主 12m §一-4;公约①「新功能一律新模块」,不往 admin.js 里堆)
 *
 * ══ 为什么有这一件 ══
 * 后端 local-server.mjs 那条 `/admin/auth/register` 在 `DEMO_LOGIN_ALLOWED=false` 时 403
 * 「注册已停用」,**但按钮在生产登录页照样亮着** —— 商家看见的是一个必然失败的口。
 * 这正是 D190 那条法(「界面上有按钮,那条路就必须走得通」)在商家侧的同一个病;
 * J-112 第二款:挡了后端一层不算,前端这一侧也要收,两侧各写一条判据。
 *
 * ══ 三态,默认关 ══
 *   null  = 还没问到 /health  → 藏
 *   false = 生产              → 藏
 *   true  = 沙箱/演示         → 显
 * `/health` 打不通就停在 null。这条回落**有依据**(J-119):
 * 12m §一-4 原话「生产上不许出现「注册」字样」—— 问不到就当生产办,fail-closed。
 *
 * ══ 读的是哪一格 ══
 * `/health` 的 `demoLoginAllowed`(health-report.mjs 里自己一格)。
 * 🔴 **不借 `guestIdUnsigned`**:那一格当下同值,但它回答的是「还认不认非服务端签发的身份」,
 * 是另一个问题。借别人的字段用 = 《假数回落红线》第 1 条「拿另一个语义的字段顶上」。
 */
window.RegisterGate = (function () {
  let allowed = null
  const listeners = []

  async function probe() {
    try {
      const res = await fetch('/health', { headers: { Accept: 'application/json' } })   // 同源,与 admin.js 的 request() 一样用裸路径
      if (!res.ok) throw new Error(`health ${res.status}`)
      const data = await res.json()
      allowed = data?.demoLoginAllowed === true
    } catch (error) {
      allowed = null                       // 问不到 = 当生产,藏
      console.warn('[admin] /health 问不到,注册按钮按生产处理(藏)', error?.message || error)
    }
    for (const fn of listeners) { try { fn(allowed) } catch (e) { console.warn('[RegisterGate] 回调抛错', e) } }
    return allowed
  }

  /* 探回来之后谁来重画:admin.js 是经典脚本(没有 type="module"),
     顶层 `function applyLoginRoleUi(){}` 就是 window 上的同名函数。
     🔴 不写 `window.applyLoginRoleUi?.()` —— `?.` 是静默失败器:
        真找不到的时候按钮会一直藏着,而没有任何人知道为什么。找不到就喊。 */
  function rerender() {
    const fn = window.applyLoginRoleUi
    if (typeof fn !== 'function') {
      console.error('[RegisterGate] 找不到 applyLoginRoleUi —— 探测回来了也没人重渲染,注册按钮会一直藏着')
      return
    }
    fn()
  }
  listeners.push(rerender)

  /* 懒探测:第一次问「该不该藏」时顺手去探一次。
     这样 admin.js 一行都不用加(棘轮律:两个巨型文件只许搬出、不许新增)。 */
  let probing = false
  function shouldHide(roleIsOwner) {
    if (allowed === null && !probing) { probing = true; probe() }
    return !roleIsOwner || allowed !== true          // 三态里只有明确 true 才显
  }

  return { probe, onSettled: (fn) => { listeners.push(fn) }, shouldHide, current: () => allowed }
})()
