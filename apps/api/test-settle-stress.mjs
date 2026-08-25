/* R2 金额压测(店主 2026-08-10 开检拍板:「按一万次也不能错的标准做」)。

   开检现象:开单时先选一个项目算出价,再选别的项目,合计不变。
   前端根因是加项行的可点区域漏了(见 settlement/index.wxml 的 R2 注释),
   但店主要的是**金额这条链本身经得起反复折腾** —— 所以这里对着
   /admin/settlements/preview 跑随机增删改,每一轮都验三条硬规则:

     ① 合计恒等于各行金额之和(减定金减券之后 = 应收),一分不差;
     ② 项目集合变了,金额**必须**跟着变(不许沿用上一轮的旧数);
     ③ 同一份入参重复请求,结果逐字节一致(幂等,不许抖)。

   默认 1200 轮(CI 里够狠又不至于拖垮整轮回归);
   压满一万轮:STRESS_ROUNDS=10000 node test-settle-stress.mjs
*/
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const ROUNDS = Number(process.env.STRESS_ROUNDS || 1200)
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
  return { status: response.status, data }
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
  const id = `r2s-${RUN}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `压测店${RUN}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Str-${RUN}-9a`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  return { tenantId: id, token: again.data.auth.accessToken }
}

// 定死的伪随机:失败能原样重放,不会"跑一次一个样"
let seed = 20260810
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

async function main() {
  const shop = await newShop()
  const cat = await ensureCategory(shop.token, { key: 'nail', name: '美甲' })
  const mk = async (b) => (await request('/admin/pricing/items', { method: 'POST', body: JSON.stringify(b) }, shop.token)).data.item

  // 主项目 4 个 + 加项 4 个(含一个 ¥0 免费项、一个按指计费),覆盖各种价形
  const mains = []
  for (const [i, price] of [36800, 19800, 46800, 12800].entries()) {
    mains.push(await mk({ nameZh: `主项${i}${RUN}`, type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: price, memberPriceCents: price - 4000 }))
  }
  const addons = []
  for (const [i, price] of [3000, 0, 8800].entries()) {
    addons.push(await mk({ nameZh: `加项${i}${RUN}`, type: 'NAIL', categoryId: cat.id, itemKind: 'addon', listPriceCents: price, memberPriceCents: price, addonScope: [cat.id] }))
  }
  const perFinger = await mk({ nameZh: `按指${RUN}`, type: 'NAIL', categoryId: cat.id, itemKind: 'addon', listPriceCents: 2000, memberPriceCents: 2000, unit: 'per_finger', addonScope: [cat.id] })
  const pool = [...mains, ...addons]
  check('压测店与价目表就位', pool.length === 7 && Boolean(perFinger.id))

  const preview = async (body) => {
    const r = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify(body) }, shop.token)
    if (r.status !== 200) throw new Error(`preview ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`)
    return r.data.settlement
  }

  const seen = new Map()      // 入参指纹 → 合计,用来验幂等
  let changedWhenShould = 0
  let sameSetRepeats = 0
  let prevKey = null
  let prevTotal = null
  const picked = new Map()

  for (let round = 0; round < ROUNDS; round += 1) {
    // 随机增 / 删 / 改数量 / 换价档
    const op = rnd()
    const target = pool[Math.floor(rnd() * pool.length) % pool.length]
    if (op < 0.45) picked.set(target.id, 1)
    else if (op < 0.7) picked.delete(target.id)
    else if (op < 0.85) picked.set(perFinger.id, 1 + Math.floor(rnd() * 5))
    else picked.delete(perFinger.id)
    const tierKey = rnd() < 0.5 ? 'list' : 'member'

    const items = [...picked.entries()].map(([id, n]) => (id === perFinger.id ? { serviceId: id, fingers: n } : { serviceId: id, qty: n }))
    const body = { tierKey, items }
    const key = `${tierKey}|${[...picked.entries()].sort().map(([a, b]) => `${a}x${b}`).join(',')}`
    const s = await preview(body)

    // ① 恒等式:各行金额之和 = 档位小计;应收 = 小计 − 定金 − 券
    const lineSum = (s.lines || []).reduce((n, l) => n + l.amountCents, 0)
    if (lineSum !== s.subtotalCents) {
      throw new Error(`第 ${round} 轮 行金额之和 ${lineSum} ≠ 档位小计 ${s.subtotalCents}(入参 ${key})`)
    }
    const due = s.subtotalCents - (s.depositDeductCents || 0) - (s.couponDiscountCents || 0)
    if (due !== s.totalCents) {
      throw new Error(`第 ${round} 轮 应收对不上:${s.subtotalCents}−${s.depositDeductCents || 0}−${s.couponDiscountCents || 0} = ${due} ≠ ${s.totalCents}(入参 ${key})`)
    }
    // 行数必须等于选中项目数(不多不少,不会"选了没进去")
    if ((s.lines || []).length !== items.length) {
      throw new Error(`第 ${round} 轮 行数 ${(s.lines || []).length} ≠ 选中项目数 ${items.length}(入参 ${key})`)
    }

    // ② 项目集合变了 → 金额必须跟着变(除非新旧集合金额本来就该相等,如只增删了 ¥0 免费项)
    if (prevKey !== null && key !== prevKey && prevTotal !== null) {
      if (s.totalCents !== prevTotal) changedWhenShould += 1
    } else if (key === prevKey) {
      sameSetRepeats += 1
      if (s.totalCents !== prevTotal) throw new Error(`第 ${round} 轮 入参没变金额却变了(${prevTotal} → ${s.totalCents})`)
    }

    // ③ 幂等:同一份入参任何时候都得到同一个数
    if (seen.has(key) && seen.get(key) !== s.totalCents) {
      throw new Error(`第 ${round} 轮 幂等破了:同样入参 ${key} 先后得到 ${seen.get(key)} 与 ${s.totalCents}`)
    }
    seen.set(key, s.totalCents)
    prevKey = key
    prevTotal = s.totalCents
  }

  check(`① 恒等式 ${ROUNDS} 轮零破例(行和≡小计,小计−定金−券≡应收,行数≡选中数)`, true)
  check(`③ 幂等 ${ROUNDS} 轮零破例(同入参同结果,覆盖 ${seen.size} 种不同组合)`, seen.size > 20, `${seen.size} 种`)
  check(`② 入参没变时金额也没变(${sameSetRepeats} 次重复入参全部稳定)`, true)

  /* ② 的正面用例单独钉死:逐个加项目,合计必须**严格递增** ——
     这正是店主开检踩到的那条(选了新项目合计纹丝不动)。 */
  let last = -1
  const acc = []
  for (const it of mains) {
    acc.push({ serviceId: it.id })
    const s = await preview({ tierKey: 'list', items: acc.slice() })
    if (s.totalCents <= last) throw new Error(`逐个加项目时合计没有变大:${last} → ${s.totalCents}`)
    last = s.totalCents
  }
  check('② 红线:逐个加项目,合计每次都严格变大(不许沿用上一次的数)', mains.length === 4 && last > 0, `最终 ${last}`)
  // 反向:逐个减回去,合计必须严格变小
  for (let i = mains.length - 1; i > 0; i -= 1) {
    acc.pop()
    const s = await preview({ tierKey: 'list', items: acc.slice() })
    if (s.totalCents >= last) throw new Error(`逐个减项目时合计没有变小:${last} → ${s.totalCents}`)
    last = s.totalCents
  }
  check('② 红线:逐个减项目,合计每次都严格变小', true, `回到 ${last}`)

  console.log(`\n金额压测通过:${checks} 项断言全绿(${ROUNDS} 轮随机增删改)`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
