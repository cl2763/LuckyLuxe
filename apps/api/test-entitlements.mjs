// 套餐开关回归(阶段2-3):
// 1. 默认租户 = 连锁版,AI 客服开通,AI 正常回复
// 2. 覆盖项关闭 AI → 进线照常记录、静默转人工、AI 不回复;网页端返回人工提示
// 3. 试用过期 → 拦截;试用未过期 → 放行
// 4. 移除覆盖项 → 回到套餐默认;owner 权限保护
/* D132 口径④(店主 04d §一):顾客侧公开路由**必须带门店标识**,不再回落旗舰店。
   夹具同批补头 —— 补的是「请求带不带 x-tenant-id」,判据一个字没放宽。
   per-call 的 headers 仍然后到先得(跨租户用例照旧覆盖它)。 */
const TENANT_HEADER = process.env.TEST_TENANT_ID || 'lucky-luxe'
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'x-tenant-id': TENANT_HEADER, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function chat(externalUserId, message) {
  return request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId, message, customerType: 'new', memberTier: 'silver', lang: 'zh', forceAi: true })
  })
}

async function setAi({ enabled, expiresAt = null, remove = false }) {
  return request('/admin/tenant/entitlements', {
    method: 'PUT',
    body: JSON.stringify({ feature: 'ai_customer_service', enabled, expiresAt, remove, note: 'regression test' })
  })
}

async function main() {
  try {
    // 1. 默认状态:连锁版,AI 开通,正常回复
    const plan = await request('/admin/tenant/plan')
    check('plan endpoint 200', plan.status === 200)
    check('default tenant on chain plan', plan.data.entitlements?.plan === 'chain', plan.data.entitlements?.plan)
    check('ai enabled by plan', plan.data.entitlements?.features?.ai_customer_service?.enabled === true)

    const before = await chat(`ent-on-${RUN_ID}`, '你好，想了解美甲')
    check('AI replies when entitled', Boolean(before.data?.reply?.data?.answerZh), JSON.stringify(before.data).slice(0, 150))

    /* 2. 关闭 AI → 转人工。
       🔴 口径改过一次(店主 05p 补二 裁 D147,2026-09-08):原来这里断言的是
       **「静默」**(`!reply`) —— 而那正是被裁掉的行为:商家会以为机器坏了。
       现在的合同是「**转人工,但要出声**」。这条断言按新口径改写,不是删掉:
       它守的东西从「不许说话」翻成了「必须说话且必须转人工」。 */
    const disabled = await setAi({ enabled: false })
    check('disable override applied', disabled.data.entitlements?.features?.ai_customer_service?.enabled === false)
    const blocked = await chat(`ent-off-${RUN_ID}`, '你好，想了解美甲')
    check('AI 关闭时**出声且转人工**(D147:不许沉默 —— 沉默会被当成「机器坏了」)',
      Boolean(blocked.data?.reply?.data?.answerZh) && blocked.data?.reply?.data?.handoffRequired === true,
      JSON.stringify(blocked.data?.reply || null).slice(0, 160))
    check('blocked flag returned', blocked.data?.entitlementBlocked === true)
    check('customer message still recorded and marked needs_human', blocked.data?.conversation?.status === 'needs_human', blocked.data?.conversation?.status)

    /* 🔴 口径第二次改(D155,店主 09-08:顾客端并进 handleWecomInbound 同一个出口)。
       08-04 那次把文案从「人工客服会回复」改成「自助预约/门店电话」,**理由是**:
       AI 关掉时顾客那句话**根本不入会话库**,所以「人工会回复」是句假话。
       D155 把这条路并进同一个出口之后,**那个理由不成立了** —— 顾客那句话真的落进
       `wechat_conversations` 并标 `needs_human`,店员在客服工作台看得见,承诺是真的。
       所以断言从「比对文案长什么样」翻成**「那句承诺兑不兑得了」**:
       ① 出声且转人工(不许沉默)② 顾客那句话真的入了库且待人工 ③ 不暴露商家订阅状态。
       —— 判据锚在「这句话是不是真的」上,不锚在当前措辞上(措辞由图/口径管,见待裁)。 */
    const webUid = `ent-web-${RUN_ID}`
    const webBlocked = await request('/ai/customer-service', { method: 'POST', body: JSON.stringify({ lang: 'zh', message: '营业时间？', clientId: webUid }) })
    const webReply = webBlocked.data?.reply?.data || {}
    check('web channel: AI 关闭时**出声且转人工**(不许沉默)',
      Boolean(webReply.answerZh) && webReply.handoffRequired === true, JSON.stringify(webBlocked.data).slice(0, 200))
    check('web channel: 不暴露商家订阅状态(不许把「没开通/没买」说给顾客听)',
      !/未开通|没有开通|订阅|套餐|付费/.test(String(webReply.answerZh || '')), String(webReply.answerZh || ''))
    /* 🔴 这一条才是 08-04 那个担忧的**可证形式**:承诺「同事会回」,就得真有一通待人工的会话在那儿。 */
    const webConv = await request('/admin/wechat/conversations')   // request() 自带主钥匙与租户头
    const webRow = (webConv.data?.conversations || []).find((c) => String(c.externalUserId || c.external_user_id || '').includes(webUid))
    check('web channel: 顾客那句话**真的入了会话库并待人工**(承诺兑得了,才不算假话)',
      Boolean(webRow) && webRow.status === 'needs_human', JSON.stringify(webRow || null).slice(0, 200))

    // 3. 试用过期 → 拦;试用未过期 → 放
    await setAi({ enabled: true, expiresAt: '2020-01-01T00:00:00.000Z' })
    const expired = await chat(`ent-expired-${RUN_ID}`, '你好')
    check('expired trial blocks AI', expired.data?.entitlementBlocked === true, JSON.stringify(expired.data).slice(0, 150))

    const future = new Date(Date.now() + 30 * 86400000).toISOString()
    const trial = await setAi({ enabled: true, expiresAt: future })
    check('active trial marked as trial source', trial.data.entitlements?.features?.ai_customer_service?.source === 'trial')
    const trialChat = await chat(`ent-trial-${RUN_ID}`, '你好，想了解美睫')
    check('active trial allows AI', Boolean(trialChat.data?.reply?.data?.answerZh), JSON.stringify(trialChat.data).slice(0, 150))

    // 4. 移除覆盖项 → 回套餐默认;权限保护
    const removed = await setAi({ remove: true })
    check('remove override restores plan default', removed.data.entitlements?.features?.ai_customer_service?.source === 'plan')

    // 5. 套餐整体到期 → 功能熄灯 + AI 拦截;恢复长期有效 → 放行
    const expiredPlan = await request('/admin/tenant/plan', { method: 'PUT', body: JSON.stringify({ planExpiresAt: '2020-01-01T00:00:00.000Z' }) })
    check('plan expiry saved', expiredPlan.data.entitlements?.planExpired === true, JSON.stringify(expiredPlan.data.entitlements?.planExpiresAt))
    check('expired plan disables plan features', expiredPlan.data.entitlements?.features?.ai_customer_service?.source === 'plan_expired')
    const planBlockedChat = await chat(`ent-planexp-${RUN_ID}`, '你好')
    check('expired plan blocks AI chat', planBlockedChat.data?.entitlementBlocked === true, JSON.stringify(planBlockedChat.data).slice(0, 150))
    const restoredPlan = await request('/admin/tenant/plan', { method: 'PUT', body: JSON.stringify({ planExpiresAt: null }) })
    check('restore no-expiry re-enables features', restoredPlan.data.entitlements?.features?.ai_customer_service?.enabled === true)

    // 6. 续费/升级申请入口
    const renewReq = await request('/admin/tenant/plan/change-request', { method: 'POST', body: JSON.stringify({ targetPlan: 'chain' }) })
    check('renew request recorded', renewReq.status === 201 && renewReq.data.entitlements?.latestPlanRequest?.requestType === 'renew', JSON.stringify(renewReq.data.entitlements?.latestPlanRequest))
    const upgradeReq = await request('/admin/tenant/plan/change-request', { method: 'POST', body: JSON.stringify({ targetPlan: 'custom' }) })
    check('upgrade request recorded', upgradeReq.data.entitlements?.latestPlanRequest?.requestType === 'upgrade' && upgradeReq.data.entitlements?.latestPlanRequest?.targetPlan === 'custom')
    const badPlan = await request('/admin/tenant/plan/change-request', { method: 'POST', body: JSON.stringify({ targetPlan: 'nonsense' }) })
    check('unknown target plan rejected', badPlan.status === 400, String(badPlan.status))
    const badAuth = await fetch(`${BASE_URL}/admin/tenant/entitlements`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ feature: 'ai_customer_service', enabled: false })
    })
    check('bad token rejected', badAuth.status === 401, String(badAuth.status))

    /* ══ D147(店主 05p 补二):没开 AI 包**不许沉默** ══════════════
       案底 09-08:北京新店建出来 AI 一句话都不答,后台一点报错都没有 ——
       商家会以为「机器坏了」,真相是套餐不含 AI 智能包。静默失败器族。
       这里自己建一家 single 店当景(《造景律》),三条一起验:
       ①平台那一屏看得见「未开通」②顾客进线有话说、且转同事 ③商家侧说清了原因。 */
    const D147 = `d147-${RUN_ID}`
    const born = await fetch(`${BASE_URL}/platform/tenants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: D147, name: `没开AI的店${RUN_ID}`, plan: 'single' })
    })
    check('D147⓪ 造景:建出一家不含 AI 包的 single 店(建不出来按红)', born.status === 201, String(born.status))
    if (born.status === 201) {
      const listed = await fetch(`${BASE_URL}/platform/tenants`, { headers: { authorization: `Bearer ${TOKEN}` } })
        .then((r) => r.json()).catch(() => null)
      const row = (listed?.tenants || []).find((t) => t.id === D147)
      check('D147① 平台那一屏能看见这家店「AI 包:未开通」(以前只能一家家进去试)',
        row?.aiEnabled === false && /未开通/.test(String(row?.aiLabel || '')), JSON.stringify({ e: row?.aiEnabled, l: row?.aiLabel }))
      const hit = await fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': D147 },
        body: JSON.stringify({ externalUserId: `c-${RUN_ID}`, message: '你们几点开门' })
      }).then((r) => r.json()).catch(() => null)
      check('D147② 🔴 顾客进线**有话说**,不是 reply=null 的沉默',
        Boolean(hit?.reply?.data?.answerZh), JSON.stringify(hit?.reply || null).slice(0, 80))
      check('D147③ 那句话转同事,且**不跟顾客提套餐**(商家买没买是商家的事)',
        hit?.reply?.data?.handoffRequired === true
        && !/套餐|开通|AI 包|智能包/.test(String(hit?.reply?.data?.answerZh || '')),
        String(hit?.reply?.data?.answerZh || '').slice(0, 70))
      check('D147④ 商家那侧说清了原因(后台状态灯与模拟面板读这一句)',
        /未开通/.test(String(hit?.entitlementNote || '')), String(hit?.entitlementNote || '').slice(0, 60))
      /* 反向守:开通之后立刻不再走这条闸 —— 不然「永远回这句」也能骗过上面四条 */
      await fetch(`${BASE_URL}/admin/tenant/entitlements`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': D147 },
        body: JSON.stringify({ feature: 'ai_customer_service', enabled: true })
      })
      const after = await fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': D147 },
        body: JSON.stringify({ externalUserId: `c2-${RUN_ID}`, message: '你们几点开门' })
      }).then((r) => r.json()).catch(() => null)
      check('D147⑤ 反向守:开通之后就不再走这条闸了(否则「永远回这句」也能骗过上面四条)',
        after?.entitlementBlocked !== true, JSON.stringify({ blocked: after?.entitlementBlocked }))
    }

    console.log(`[entitlements] all ${checks} checks passed`)
  } finally {
    // 无论成败,确保清掉覆盖项并恢复套餐长期有效,不影响其他测试
    await setAi({ remove: true }).catch(() => {})
    await request('/admin/tenant/plan', { method: 'PUT', body: JSON.stringify({ planExpiresAt: null }) }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('[entitlements] failed:', error.message)
  process.exit(1)
})
