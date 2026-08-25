/* R3 签字可靠性(店主 2026-08-10 开检:「确认签字第一次点开用不了,第二次又可以」)。
   店主原话要求:**不许以"偶发"结案**。所以这里连续开关页面 + 签字跑 N 轮,
   任何一轮签不成就红。

   开检查出来的两条根因(都已修,这里防复发):
     ① 签名画布在布局落定前就量尺寸 → 背板只有几像素,笔迹画不出来(刷新一次才好);
     ② 未绑定顾客的签署页把「确认签字」按钮 disabled + 底栏 .locked(pointer-events:none),
        点了毫无反馈,而提示语指向一个同样被禁用的勾选框。

   本文件跑的是**服务端可签性**(每轮新开一单 → 取页面 → 签 → 验快照),
   画布尺寸那条属纯前端,由 sign.html 里的 resize/ResizeObserver/落笔前重量三道保险兜住,
   并在这里断言页面确实带着那三道保险(改回去就红)。

   轮数:SIGN_ROUNDS(默认 30)。
*/
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const ROUNDS = Number(process.env.SIGN_ROUNDS || 30)
const RUN = Date.now().toString(36)

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
  return { status: response.status, data, text }
}

/* 分类唯一真相律(店主 2026-08-25):建店即落平台三大类(美甲/美睫/护理·其他),
   所以夹具再建同 key 的大类会撞 409 —— 改成「有就用,没有才建」。判据跟着口径走。 */
async function ensureCategory(token, body) {
  const made = await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify(body) }, token)
  if (made.data && made.data.category) return made.data.category
  const list = (await request('/admin/pricing/categories', {}, token)).data.categories || []
  return list.find((c) => c.key === body.key) || list.find((c) => c.name === body.name) || list[0]
}

async function newShop() {
  const id = `r3s-${RUN}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `签字店${RUN}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Sig-${RUN}-9a`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  return { tenantId: id, token: again.data.auth.accessToken }
}

async function main() {
  // ---- 前端三道保险还在不在(改回去就红)----
  const html = readFileSync(join(ROOT, 'apps/web/sign.html'), 'utf8')
  check('R3① 画布尺寸会重量:窗口变化 + 容器变化都挂了钩子',
    html.includes("window.addEventListener('resize', resize)") && html.includes('ResizeObserver'),
    '缺少 resize / ResizeObserver')
  check('R3① 落笔前先重量一次(容器什么时候变宽都不丢笔迹)',
    /const start = \(e\) => \{ e\.preventDefault\(\); resize\(\);/.test(html), '落笔前没有 resize()')
  check('R3① 重设尺寸后把已有笔迹重画回去(不擦掉顾客签好的字)',
    html.includes('const redraw = ()') && html.includes('redraw()'), '缺少 redraw')
  check('R3② 未绑定时「确认签字」不再是死按钮(不 disabled、底栏不加 .locked)',
    !html.includes("const btn = document.getElementById('signBtn'); if (btn) btn.disabled = true")
    && !html.includes("document.getElementById('cta').classList.add('locked')"),
    '按钮仍被钉死')
  check('R3② 缺哪一步就说哪一步:锁着时提示的是「确认本人」而不是被禁用的勾选框',
    html.includes("请先点上方的「是我本人，绑定并继续」"), '提示语没改')

  // ---- 服务端可签性:连续 N 轮开单 → 取页面 → 签字 → 验快照 ----
  const shop = await newShop()
  const cat = await ensureCategory(shop.token, { key: 'nail', name: '美甲' })
  const svc = (await request('/admin/pricing/items', {
    method: 'POST', body: JSON.stringify({ nameZh: `签字款${RUN}`, type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 20000, memberPriceCents: 20000 })
  }, shop.token)).data.item
  const tech = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技师${RUN}` }) })).data.technician
  const imp = await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `签字客${RUN}`, phone: `1383${RUN.slice(-7)}` }] })
  })
  const cust = imp.data.users[0].userId

  let firstTryFailures = 0
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await request('/admin/settlements', {
      method: 'POST',
      body: JSON.stringify({
        cardOwnerUserId: cust,
        settlements: [{ tierKey: 'list', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }]
      })
    }, shop.token)
    const sheet = g.data.settlements[0]
    if (!sheet) throw new Error(`第 ${i} 轮开单失败: ${JSON.stringify(g.data).slice(0, 160)}`)

    // 「点开页面」:HTML 与数据接口各取一次,模拟真实进入
    const page = await request(`/sign/${sheet.code}`, {}, null)
    if (page.status !== 200) throw new Error(`第 ${i} 轮页面打不开: ${page.status}`)
    const view = await request(`/settlements/${sheet.code}`, {}, null)
    if (view.status !== 200) throw new Error(`第 ${i} 轮单据取不到: ${view.status}`)

    // **第一次**就签(这正是店主说"第一次用不了"的那一次)
    const signed = await request(`/settlements/${sheet.code}/sign`, {
      method: 'POST',
      body: JSON.stringify({
        disclaimerAccepted: true,
        signature: `签字客${RUN}`,
        strokes: [[{ x: 8, y: 60 }, { x: 40, y: 20 }, { x: 72, y: 62 }]]
      })
    }, null)
    if (signed.status !== 200) { firstTryFailures += 1; continue }
    const after = (await request(`/settlements/${sheet.code}`, {}, null)).data.settlement
    if (after.status !== 'signed') throw new Error(`第 ${i} 轮签完状态不对: ${after.status}`)
    if (!after.snapshot || !(after.snapshot.url || after.snapshot.storage === 'inline')) throw new Error(`第 ${i} 轮签完没有快照: ${JSON.stringify(after.snapshot)}`)
    if (after.snapshotHasInk !== true) throw new Error(`第 ${i} 轮快照里没有手写笔迹(R3 的核心:笔迹要真进快照)`)
  }
  check(`R3 连续 ${ROUNDS} 轮「开单 → 点开页面 → 第一次就签」全部成功(零偶发)`,
    firstTryFailures === 0, `${firstTryFailures} 轮第一次没签成`)

  console.log(`\n签字可靠性回归通过:${checks} 项断言全绿(${ROUNDS} 轮)`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
