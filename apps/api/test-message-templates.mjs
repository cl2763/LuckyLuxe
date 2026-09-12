// P1.2 话术模板中心回归(2026-08-08):本批只做建模 + 配置,自动发送引擎归后续批次。
// 1. 每店首次读取自动预置一套默认模板(六个场景各一条)
// 2. CRUD:新增 / 改 / 停用 / 删除
// 3. 租户隔离:A 店的模板 B 店看不到、也改不动
// 4. 预置只做一次(商家删掉的模板不会被重新塞回来)
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `p12t-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `话术店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  return { tenantId: id, token: again.data.auth.accessToken }
}

/* 🔴 判据翻面(店主 2026-08-28,靠列举的判据 A 类之一)。
   原来这里手写六个场景名 —— 后端加第七个场景时,这份清单不会跟着变,
   于是「六个场景各预置一条」照样绿,而那个新场景**从没被验过预置、验过标签、验过越权**。
   改成**从后端现取**:场景枚举本来就随接口下发(`listA.data.scenes`),
   拿它当被测集合,加一个场景就自动纳入。手写的这份降级成**反向守**:
   它必须是后端那份的子集 —— 万一后端哪天把某个场景删了,这里当场红,而不是悄悄少验一个。 */
const SCENES_MUST_HAVE = ['pre_sale', 'in_service', 'post_sale', 'booking_confirmed_invite', 'arrival_reminder', 'coupon_expiry']

async function main() {
  const shopA = await newShop('a')
  const shopB = await newShop('b')
  check('两家临时店建好', Boolean(shopA.token && shopB.token))

  // ---- 1. 预置 ----
  const listA = await request('/admin/message-templates', {}, shopA.token)
  check('模板列表可读', listA.status === 200, JSON.stringify(listA.data).slice(0, 200))
  const scenesA = (listA.data.templates || []).map((t) => t.scene)
  const SCENES = (listA.data.scenes || []).map((x) => x.scene)          // 被测集合从后端现取,不写死
  check(`白名单式:后端下发 ${SCENES.length} 个场景,**每一个**都自动预置了一条(加新场景自动纳入)`,
    SCENES.length > 0 && SCENES.every((sc) => scenesA.includes(sc)) && listA.data.templates.length === SCENES.length,
    JSON.stringify({ 后端: SCENES, 预置: scenesA }))
  check('反向守:手写那六个仍在后端清单里(后端删了场景 → 这里当场红,不许悄悄少验)',
    SCENES_MUST_HAVE.every((sc) => SCENES.includes(sc)),
    JSON.stringify(SCENES_MUST_HAVE.filter((sc) => !SCENES.includes(sc))))
  check('场景枚举随接口下发(每一个都带中文标签,不是只有第一个有)',
    (listA.data.scenes || []).length === SCENES.length && (listA.data.scenes || []).every((x) => x.label && /[一-龥]/.test(x.label)),
    JSON.stringify(listA.data.scenes))
  const invite = listA.data.templates.find((t) => t.scene === 'booking_confirmed_invite')
  check('预约成功邀请函模板带变量说明', invite && invite.variables.includes('{bookingTime}') && invite.variables.includes('{storeName}'), JSON.stringify(invite))

  const listAgain = await request('/admin/message-templates', {}, shopA.token)
  check('再读一次不会重复预置', listAgain.data.templates.length === SCENES.length, String(listAgain.data.templates.length))

  // ---- 2. CRUD ----
  const created = await request('/admin/message-templates', {
    method: 'POST',
    body: JSON.stringify({ scene: 'post_sale', title: `回访话术${RUN_ID}`, content: '{customerName}你好~', variables: ['{customerName}'], sort: 9 })
  }, shopA.token)
  check('新增模板 201', created.status === 201 && created.data.template.title === `回访话术${RUN_ID}`, JSON.stringify(created.data).slice(0, 200))
  const tplId = created.data.template.id

  const patched = await request(`/admin/message-templates/${tplId}`, { method: 'PATCH', body: JSON.stringify({ content: '改过的内容', isActive: false }) }, shopA.token)
  check('改内容与停用生效', patched.data.template.content === '改过的内容' && patched.data.template.isActive === false, JSON.stringify(patched.data.template))

  const badScene = await request('/admin/message-templates', { method: 'POST', body: JSON.stringify({ scene: 'not_a_scene', title: '兜底场景' }) }, shopA.token)
  check('未知场景回落到 pre_sale(不报错也不写坏数据)', badScene.status === 201 && badScene.data.template.scene === 'pre_sale', JSON.stringify(badScene.data.template))

  const noTitle = await request('/admin/message-templates', { method: 'POST', body: JSON.stringify({ scene: 'pre_sale' }) }, shopA.token)
  check('标题必填', noTitle.status === 400, JSON.stringify(noTitle.data))

  // ---- 3. 租户隔离 ----
  const listB = await request('/admin/message-templates', {}, shopB.token)
  check('B 店看不到 A 店的模板', !(listB.data.templates || []).some((t) => t.id === tplId), JSON.stringify((listB.data.templates || []).map((t) => t.id)))
  check('B 店也拿到了自己的一套预置', (listB.data.templates || []).length === 6)
  const crossPatch = await request(`/admin/message-templates/${tplId}`, { method: 'PATCH', body: JSON.stringify({ title: '越权改名' }) }, shopB.token)
  check('B 店改不动 A 店的模板(404)', crossPatch.status === 404, JSON.stringify(crossPatch.data))
  const crossDelete = await request(`/admin/message-templates/${tplId}`, { method: 'DELETE' }, shopB.token)
  check('B 店删不掉 A 店的模板(404)', crossDelete.status === 404)

  // ---- 4. 删除 + 不会被重新预置 ----
  const removed = await request(`/admin/message-templates/${tplId}`, { method: 'DELETE' }, shopA.token)
  check('A 店可以删自己的模板', removed.status === 200 && removed.data.deleted === true)
  const invite2 = (await request('/admin/message-templates', {}, shopA.token)).data.templates.find((t) => t.scene === 'booking_confirmed_invite')
  const delInvite = await request(`/admin/message-templates/${invite2.id}`, { method: 'DELETE' }, shopA.token)
  check('删掉预置的邀请函模板', delInvite.status === 200)
  const after = await request('/admin/message-templates', {}, shopA.token)
  check('删掉的预置模板不会被重新塞回来', !after.data.templates.some((t) => t.id === invite2.id), JSON.stringify(after.data.templates.map((t) => t.scene)))

  // ---- 5. 员工角色不可管理 ----
  const staffDenied = await request('/admin/message-templates', {}, 'not-a-real-token')
  check('未登录/无效凭证拿不到模板', staffDenied.status === 401, String(staffDenied.status))

  console.log(`\n话术模板回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
