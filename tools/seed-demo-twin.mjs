/* 演示孪生店铺设 + 跨店同一身份档案(店主 2026-08-23「演示租户与跨店串号检测批」)。

   为什么要孪生店:**店主的真账本不许混演示数据**(边界令①的延伸)。
   每家真店配一个演示孪生租户,演示顾客只进孪生店;真店(lucky-luxe / jics-nail)一行不写。

   本脚本做三件事(全部幂等,重跑只打印「已有,跳过」):
     ① 给演示店补齐目录:服务 / 技师 / 充值套餐 / 次卡套餐 / 券模板
     ② 每店建演示顾客,**会员信息全可见**:等级 / 成长值 / 累计消费 / 到店次数 /
        储值余额 / 次卡 / 券 / 积分 / 历史订单(含已签署单,五读方齐动)
     ③ 造**跨店同一个微信身份**的档案(同一 openid 在两店各一行 users,数字一眼可分辨),
        供跨店串号检测走查

   🔒 边界:
     - 只跑本机/沙箱(BASE 必须是 127.0.0.1 或 localhost),生产一步不碰;
     - 只写「演示租户」白名单里的租户,写别的直接拒绝;
     - 不动任何真店数据。

   用法:SEED_BASE_URL=http://127.0.0.1:4310 node tools/seed-demo-twin.mjs
*/
import { readFileSync } from 'node:fs'
import { isDemoTenant, PROTECTED_REAL_TENANTS } from '../apps/api/demo-reset.mjs'   // 判据与黑名单都直接用那一份,不抄
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SEED_BASE_URL || 'http://127.0.0.1:4310'
const ARGV = process.argv.slice(2)

/* ═══ 🔴 生产例外 · 七条(店主 2026-08-25 定,缺一条即拒)═══

   **原边界语义不改**:默认仍然是"只跑本机/沙箱"。下面只开一个**显式的窄例外**。

   ① 显式参数 --production-seed(不是环境变量、不是默认值,必须在命令行上打出来)
   ② 目标租户 kind='demo' —— 直接 import demo-reset 的判据函数,不抄
   ③ 真店黑名单二次硬拦 —— 复用 PROTECTED_REAL_TENANTS,**独立于第②条**
   ④ 手打目标租户完整店名确认(不许勾选框)
   ⑤ 跑前自动备份,备份或中止,路径写进回报
   ⑥ 跑后对账:lucky-luxe / jics-nail 五项零差异,**对不上立刻停下并报出来**
   ⑦ 落 platform_ops_log:谁 / 何时 / 哪家店 / 铺了多少行 / 备份路径

   用法(生产,**先试跑交 Cowork 核过才准真跑**):
     SEED_BASE_URL=https://… OWNER_TOKEN=… node tools/seed-demo-twin.mjs \
       --production-seed --tenant <租户id> --confirm-name "<完整店名>" --dry-run
     核过后去掉 --dry-run 才真写。
   不带 --production-seed 指向非本机 = 直接拒绝(第①条)。 */
const PRODUCTION_SEED = ARGV.includes('--production-seed')
const DRY_RUN = ARGV.includes('--dry-run')                 // 只读试跑:七条门禁照跑,一行不写
const argOf = (k) => { const i = ARGV.indexOf(k); return i >= 0 ? ARGV[i + 1] : '' }
const TARGET_TENANT = argOf('--tenant')
const CONFIRM_NAME = argOf('--confirm-name')
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(BASE)
/* 门禁不通过就干净地退,不甩堆栈 —— 拒绝是**正常结果**,不是崩溃。 */
const refuse = (msg) => { console.error(`🚫 ${msg}`); process.exit(1) }
if (!IS_LOCAL && !PRODUCTION_SEED) {
  refuse('第①条:演示铺设默认只给本机沙箱用。要对着生产跑,必须在命令行显式打出 --production-seed(不是环境变量、不是默认值)。')
}
if (PRODUCTION_SEED && !TARGET_TENANT) refuse('第①条:--production-seed 必须同时指定 --tenant <租户id>(一次只铺一家,不许一把梭)。')
/* 第④条的前半截放在这里:**没打店名连门都进不来**。
   放这儿是因为目标店可能还不存在(要现建),那种情况下没有"已有店名"可比,
   但确认这一步一样不许省 —— 打出来的名字就是要建的店名。 */
if (PRODUCTION_SEED && !String(CONFIRM_NAME || '').trim()) {
  refuse('第④条:--production-seed 必须用 --confirm-name 手打目标店的完整店名(店已存在=必须一字不差;店还没建=这就是要建的店名)。')
}
const TOKEN = process.env.OWNER_TOKEN || (readFileSync(join(ROOT, 'apps/api/.env'), 'utf8').split('\n')
  .find((l) => l.startsWith('OWNER_DEMO_TOKEN=')) || '').slice('OWNER_DEMO_TOKEN='.length).trim().replace(/^["']|["']$/g, '')

/* 🔴 B线第一段(店主 2026-08-25):目标判据从**租户名白名单**改成 **tenants.kind='demo'**,
   与 demo-reset.mjs 用**同一条判据**(唯一出口 isDemoTenant —— 判据只写一处,能共用就共用)。
   为什么改:靠名字认身份就是 D72/D73 那条病的根 —— 名字随时能改,归属是数据。
   下面这张表现在只提供**铺什么数据**(币种/时区/孪生档案的数字),**不再决定能不能写**:
   能不能写由 kind 说了算,非 demo 直接拒绝并说明是被拦了;真店黑名单保留作第二道锁。 */
const DEMO_TENANTS = [
  { tenantId: 'demo-lucky-luxe', label: 'Lucky Luxe(演示)', currency: 'CAD', timezone: 'America/Toronto',
    twin: { balance: 88800, timecardTimes: 5, coupons: 1, orders: 2, timecardRemaining: 4, name: '演示·跨店阿珍' } },
  { tenantId: 'jics-sandbox', label: '小婕的店(演示)', currency: 'CNY', timezone: 'Asia/Shanghai',
    twin: { balance: 36600, timecardTimes: 5, coupons: 3, orders: 1, timecardRemaining: 2, name: '演示·跨店阿珍' } }
]

/* 🔴 生产上要铺的两家(店主 2026-08-25 三裁):
   ① 店名不挂店主自己的品牌 —— 准商户要看的是"一家和我一样的店在用有迹",
      而且真店品牌不该挂在一个**可被整体重置的账本**上;id 保留 demo- 前缀,运维认得出孪生关系。
   ② 数字要"有零有整"(888 一眼是样板),且**两张已签署单里必须有一张组合支付**:
      储值抵扣 + 次卡核销 + 券,一张单说清 —— 那才是有迹和别家的区别。
   ③ 铺两家:清单里那个「演示·跨店阿珍」是跨店身份,只铺一家的话"跨店"就是个名字骗人;
      跨店串号又正是多商户平台最容易被质疑的地方,两家才演得出来。
   一次只铺一家(命令跑两遍)—— 与「不许一把梭」那条不冲突。 */
const PROD_TENANTS = [
  /* 次卡剩余的算法(别再按感觉填):买 5 次卡那张单**当场用掉 1 次** → 剩 4;
     组合支付单再核销 1 次 → 落地 = 4 − 1 = 3。要更少就让 ④b 先多核销几次。
     所以这里写的是**落地数**,清单上印的也是它(彩排实测对上了才敢印)。 */
  { tenantId: 'demo-lucky-luxe', label: '星野美甲(演示店)', currency: 'CAD', timezone: 'America/Toronto',
    twin: { balance: 73650, timecardTimes: 5, coupons: 2, orders: 2, combo: true, timecardRemaining: 3, name: '演示·跨店阿珍' },
    // 落地数=沙箱彩排**实测**(不是估的):充 736.50 → 组合支付单用掉 336.00 → 余 400.50
    landed: { balanceCents: 40050, totalSpentCents: 100200, visits: 3, timecardLeft: 3, activeCoupons: 1 } },
  { tenantId: 'demo-jienail', label: '悦容美甲(演示店)', currency: 'CNY', timezone: 'Asia/Shanghai',
    twin: { balance: 51240, timecardTimes: 5, coupons: 2, orders: 2, combo: true, timecardRemaining: 1, name: '演示·跨店阿珍' },
    landed: { balanceCents: 17640, totalSpentCents: 163800, visits: 3, timecardLeft: 1, activeCoupons: 1 } }
]
/* ③ 真店黑名单:**就是 demo-reset 导出的那一份**,本地零副本(店主 08-25 复核令①)。
   08-25 一度写成 `[...PROTECTED_REAL_TENANTS, 'jics-store']` —— 那就是第二份名单,
   两份迟早各自长歪(这批自己刚领悟的那条)。沙箱那家 `jics-store` 不进这份名单:
   它是**沙箱里的真店替身**、不是店主的真店,而且它照样过不了第②条 ——
   kind=real 直接拒;想把它改成 demo 又会被 setTenantKind 的方向律拦死
   (实测:403 HAS_REAL_MONEY,收入 168.00 · 结算单 2 张)。两道锁仍然都在,只是不靠抄名单。 */
const CROSS_OPENID = 'demo-openid-crossshop-a-zhen'   // 同一个微信身份,两店各一行 users

async function api(tenantId, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tenantId, 'x-tenant-id': tenantId, ...(options.headers || {}) }
  })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch (e) { data = { raw: text.slice(0, 200) } }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}
async function platform(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch (e) { data = { raw: text.slice(0, 200) } }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}
/* 🔴 2026-08-25:以前这里直连 sqlite 读事实(已签署单/次卡/券)、直写 openid ——
   本机能这么干,**生产拿不到库文件**,那条路在生产上等于断的。现在统一走服务端演示事实口
   (apps/api/demo-facts.mjs,真店连读都不给),本机与生产同一份代码,SEED_DB_PATH 已退役。 */
async function factsOf(tenantId, userId) {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : ''
  return (await platform(`/platform/tenants/${tenantId}/demo-facts${q}`)).facts
}
const log = (...a) => console.log(...a)
const dateStr = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
}

/* 第一道锁(唯一出口):kind='demo' 才允许写。非 demo 一律拒绝,并**说明是被拦了**,
   不是"找不到"——与 demo-reset 的 403 措辞同一条思路。 */
async function assertDemoTarget(tenantId) {
  /* 🔴 第③条:真店黑名单**独立于第②条**先判 —— 两道锁不许互相依赖(D75 同款)。
     就算哪天 kind 判据出问题,这一条照样拦死。 */
  if (PROTECTED_REAL_TENANTS.includes(tenantId)) {
    throw new Error(`第③条拒绝:${tenantId} 在真店黑名单里,任何情况下都不许铺演示数据。`)
  }
  const list = (await platform('/platform/tenants')).tenants || []
  const hit = list.find((t) => t.id === tenantId)
  if (!hit) return null                                     // 还没建店:由 ensureTenant 去建(建出来就是 demo)
  // 🔴 第②条:归属必须是 demo。判据直接用 demo-reset 那一份(不抄)
  if (!isDemoTenant(hit)) {
    throw new Error(`第②条拒绝:${tenantId} 的归属是 kind=${hit.kind || 'real'},不是演示店。`
      + `\n  这是**被拦住了**,不是找不到。演示归属只能在平台后台显式设置(新建时勾选,或「归属」列切换)。`)
  }
  // 🔴 第④条:生产例外必须手打完整店名(不许勾选框)
  if (PRODUCTION_SEED) {
    if (String(CONFIRM_NAME || '').trim() !== String(hit.name || '').trim()) {
      throw new Error(`第④条拒绝:二次确认没通过 —— 请用 --confirm-name 手打完整店名「${hit.name}」。它往生产写数据。`)
    }
  }
  return hit
}

async function ensureTenant(spec) {
  // 第二道锁:真店黑名单(kind 判据之外再兜一层,两道都过才写)
  if (PROTECTED_REAL_TENANTS.includes(spec.tenantId)) throw new Error(`拒绝:${spec.tenantId} 是真店,演示数据不许写进去。`)
  const hit = await assertDemoTarget(spec.tenantId)
  if (hit) { log(`  租户已有:${spec.tenantId}(${hit.name},kind=${hit.kind})`); return }
  const created = await platform('/platform/tenants', {
    method: 'POST',
    // D73:建店当场定归属(不靠名字前缀事后猜)
    body: JSON.stringify({ id: spec.tenantId, name: spec.label, plan: 'chain', initialTerm: 'year', currency: spec.currency, timezone: spec.timezone, isDemo: true })
  })
  log(`  ✅ 新建演示租户:${spec.tenantId}(${spec.label});老板账号 ${created.owner.username}(初始密码只显示这一次,演示店无需交付)`)
}

/* 目录清单:**一张表两用** —— 真跑照它建,dry-run 照它报「已有/将新建」,不再各写一份
   (dry-run 与真跑对不上是最难查的坑:清单说不建、真跑却建了)。 */
async function catalogPlan(spec) {
  const services = (await api(spec.tenantId, '/admin/services')).services || []
  const mains = services.filter((s) => (s.itemKind || 'main') === 'main' && !s.isTimecard)
  const techs = (await api(spec.tenantId, '/admin/technicians')).technicians || []
  const packages = (await api(spec.tenantId, '/admin/packages')).packages || []
  const coupons = (await api(spec.tenantId, '/admin/coupons')).coupons || []
  // 分类唯一真相律③:项目必须挂大类才准建 —— 演示项目照样挂,不走"平台代配"那条回落
  const cats = (await api(spec.tenantId, '/admin/pricing/categories')).categories || []
  const catOf = (key) => (cats.find((c) => c.key === key) || cats[0] || {}).id || null

  const items = []
  for (const s of [
    { nameZh: '演示·经典单色', nameEn: 'Demo Classic', type: 'NAIL', priceCents: 16800, baseDurationMin: 90, catKey: 'nail' },
    { nameZh: '演示·美睫自然款', nameEn: 'Demo Lash', type: 'LASH', priceCents: 19800, baseDurationMin: 120, catKey: 'lash' }
  ]) {
    const { catKey, ...svc } = s
    items.push({
      label: `服务「${s.nameZh}」`,
      have: mains.length >= 2 || mains.some((m) => m.nameZh === s.nameZh),
      create: () => api(spec.tenantId, '/admin/services', { method: 'POST', body: JSON.stringify({ ...svc, categoryId: catOf(catKey), storefront: true, isActive: true }) })
    })
  }
  for (const name of ['演示技师 A', '演示技师 B']) {
    items.push({
      label: `技师「${name}」`,
      have: techs.length >= 2 || techs.some((t) => t.name === name),
      create: () => api(spec.tenantId, '/admin/technicians', { method: 'POST', body: JSON.stringify({ name, isActive: true }) })
    })
  }
  items.push({
    label: '充值套餐「演示充值套餐」',
    have: packages.some((p) => p.kind === 'recharge'),
    create: () => api(spec.tenantId, '/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'recharge', name: '演示充值套餐', priceCents: 30000, bonusCents: 6000, mallVisible: true }) })
  })
  items.push({
    label: '次卡套餐「演示次卡(5 次)」',
    have: packages.some((p) => p.kind === 'times'),
    create: () => api(spec.tenantId, '/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'times', name: '演示次卡(5 次)', priceCents: 60000, timesCount: 5, mallVisible: true }) })
  })
  items.push({
    label: '券模板「演示满减券」',
    have: coupons.length > 0,
    create: () => api(spec.tenantId, '/admin/coupons', { method: 'POST', body: JSON.stringify({ name: '演示满减券', discountType: 'amount', amountCents: 3000, minSpendCents: 20000, validDays: 60, totalQty: 100 }) })
  })
  return items
}

async function ensureCatalog(spec) {
  for (const it of await catalogPlan(spec)) {
    if (it.have) { log(`  ${it.label}:已有,跳过`); continue }
    await it.create()
    log(`  ✅ 建${it.label}`)
  }
}

/* 两位演示顾客的参数**只写一处**:真跑照它铺,dry-run 照它算缺口。 */
const membersOf = (spec) => ([
  { name: spec.twin.name, openId: CROSS_OPENID, ...spec.twin, slotHour: 9 },
  { name: '演示·本店常客', openId: `demo-openid-${spec.tenantId}-regular`, balance: 12000, timecardTimes: 0, coupons: 1, orders: 1, slotHour: 15 }
])

/* 一位演示顾客:开单签署(积分/累计消费/到店次数)+ 储值 + 次卡 + 券,会员卡上每一格都有数。
   **逐项幂等**:哪一项缺就补哪一项(顾客已存在但资产没铺完时,重跑能补齐)。 */
async function seedMember(spec, { name, openId, balance, timecardTimes, coupons, orders, slotHour = 10, timecardRemaining = 0, combo = false }) {
  const services = ((await api(spec.tenantId, '/admin/services')).services || []).filter((s) => (s.itemKind || 'main') === 'main' && !s.isTimecard)
  const techs = (await api(spec.tenantId, '/admin/technicians')).technicians || []
  const svc = services[0]
  const tech = techs[0]
  let userId = (((await api(spec.tenantId, '/admin/customers')).customers || []).find((c) => c.displayName === name) || {}).id || null

  // 撞档就换时段重试(演示铺设不该因为一个时间点被占就整批失败)
  const bookOnce = async (dayOffset, hour) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const h = String((hour + attempt) % 24).padStart(2, '0')
      const body = userId
        ? { userId, serviceId: svc.id, technicianId: tech.id, date: dateStr(dayOffset), time: `${h}:00` }
        : { newCustomerName: name, serviceId: svc.id, technicianId: tech.id, date: dateStr(dayOffset), time: `${h}:00` }
      try {
        const bk = (await api(spec.tenantId, '/admin/bookings/direct', { method: 'POST', body: JSON.stringify(body) })).booking
        userId = userId || bk.userId || bk.user_id || (bk.user && bk.user.id)
        return bk
      } catch (e) {
        if (!/SLOT_UNAVAILABLE|BUSY|CLOSED|OUTSIDE/i.test(e.message)) throw e
      }
    }
    throw new Error(`${name}:连续 10 个时段都排不进(${dateStr(dayOffset)})`)
  }
  const settleAndSign = async (bookingId, extra = {}) => {
    await api(spec.tenantId, `/admin/bookings/${bookingId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) })
    const sh = (await api(spec.tenantId, '/admin/settlements', {
      method: 'POST',
      body: JSON.stringify({ userId, settlements: [{ bookingId, payIntent: 'offline_full', items: [{ serviceId: svc.id, qty: 1 }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }], ...extra }] })
    })).settlements[0]
    await fetch(`${BASE}/settlements/${encodeURIComponent(sh.code)}/sign`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': spec.tenantId },
      body: JSON.stringify({ signature: '演示签名', disclaimerAccepted: true })
    })
  }

  // ① 历史已签署单(=积分/累计消费/到店次数/成长值的来源)
  let signed = 0
  if (userId) signed = (await factsOf(spec.tenantId, userId)).signedSheets
  /* combo 的顾客留一张额度给最后那张**组合支付单**(它要等储值/次卡/券都铺好才能开),
     所以这里只铺 orders-1 张普通单 —— 两张加起来仍是 orders 张,幂等仍靠同一个计数。 */
  const plainTarget = combo ? Math.max(0, orders - 1) : orders
  for (let i = signed; i < plainTarget; i += 1) {
    const bk = await bookOnce(-3 - i, slotHour + i)
    await settleAndSign(bk.id)
    log(`  ✅ ${name}:补第 ${i + 1} 张已签署单`)
  }

  // ② 绑微信身份(跨店同一 openid:每家店各一行 users —— 这正是要验的隔离面)。
  //    直连库贴 openid:真实路径是顾客扫签署码授权(claimUserByOpenId),演示铺设没有真人扫码;
  //    只写 users.wechat_open_id 这一个字段,金额/账本一分不碰。D25 闸(未绑不可充值)也靠它。
  if (openId && userId && (await factsOf(spec.tenantId, userId)).wechatOpenId !== openId) {
    await platform(`/platform/tenants/${spec.tenantId}/demo-bind-openid`, { method: 'POST', body: JSON.stringify({ userId, openId }) })
  }

  // ③ 储值(缺才充)
  const customerRow = async () => ((await api(spec.tenantId, '/admin/customers')).customers || []).find((c) => c.id === userId) || {}
  if (balance && userId) {
    // 🔴 判"充过没有",不判"余额是不是 0":组合支付单会把余额花掉,按余额判等于每跑一次多充一笔
    const charged = Number((await factsOf(spec.tenantId, userId)).recharges || 0)
    if (!charged) {
      await api(spec.tenantId, '/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({ userId, amountCents: balance, payChannel: 'cash', note: '演示储值' }) })
      log(`  ✅ ${name}:充演示储值 ${balance / 100}`)
    }
  }

  // ④ 次卡(缺才买:随一张单一起购,与真实开单同路径)
  if (timecardTimes && userId) {
    const cards = (await factsOf(spec.tenantId, userId)).timecards
    if (!cards.length) {
      const pkg = ((await api(spec.tenantId, '/admin/packages')).packages || []).find((p) => p.kind === 'times')
      if (pkg) {
        const bk = await bookOnce(-1, slotHour + orders + 1)
        await settleAndSign(bk.id, { purchasePackageId: pkg.id, timecardServiceId: svc.id })
        log(`  ✅ ${name}:买次卡(${pkg.name})`)
      }
    }
  }

  /* ④b 核销次卡(走正规开单用卡路径):让两家演示店的「次卡剩余」不同,
     店主一眼就能看出切店后换了一套数,而不是两边碰巧一样。 */
  if (timecardRemaining && userId) {
    /* combo 那张单还要再核销一次,所以这里先留出一次 —— 否则最后落下来比清单上写的少 1 次
       (彩排第一遍就是这么落到 3 次的,清单写的是 4)。 */
    const preComboTarget = combo ? timecardRemaining + 1 : timecardRemaining
    const readCard = async () => (await factsOf(spec.tenantId, userId)).timecards[0] || null
    let card = await readCard()
    let guard = 0
    while (card && (card.totalTimes - card.usedTimes) > preComboTarget && guard < 6) {
      const bk = await bookOnce(-1, slotHour + orders + 4 + guard)
      await settleAndSign(bk.id, { timecardId: card.id, timecardServiceId: svc.id })
      log(`  ✅ ${name}:核销次卡 1 次(演示两店剩余不同:目标剩 ${timecardRemaining} 次${combo ? ',其中最后一次由组合支付单核销' : ''})`)
      card = await readCard()
      guard += 1
    }
  }

  // ⑤ 券(缺几张发几张)
  if (coupons && userId) {
    // 按**发过几张**判(含已核销)—— 只看还剩几张的话,组合支付单用掉一张,下次重跑就又发一张
    const have = Number((await factsOf(spec.tenantId, userId)).couponGrants || 0)   // 字段缺就当 0,不许"静默不发"
    const cpn = ((await api(spec.tenantId, '/admin/coupons')).coupons || [])[0]
    for (let i = have; i < coupons && cpn; i += 1) {
      await api(spec.tenantId, `/admin/coupons/${cpn.id}/grant`, { method: 'POST', body: JSON.stringify({ userId }) })
      log(`  ✅ ${name}:发第 ${i + 1} 张券`)
    }
  }
  /* ⑥ 🔴 组合支付单(店主 08-25 裁②):**一张单说清三件事** ——
     储值抵扣 + 次卡核销 + 券。普通单商户看不出有迹和别家的区别,这张才是卖点那一屏。
     必须排在储值/次卡/券都铺好之后:三样资产得先存在,才用得上。
     单里两个项目:一个由次卡盖掉,另一个走券 + 储值 —— 三条腿同时现形。 */
  if (combo && userId) {
    const f = await factsOf(spec.tenantId, userId)
    if (!f.comboSheets) {
      const card = f.timecards[0]
      const grant = ((await api(spec.tenantId, `/admin/coupon-grants?userId=${encodeURIComponent(userId)}&status=active`)).grants || [])[0]
      const svc2 = services[1] || svc
      if (card && grant) {
        const bk = await bookOnce(-2, slotHour + orders + 8)
        await settleAndSign(bk.id, {
          payIntent: 'balance_plus_offline',                     // 储值先抵,不够的才走线下
          items: [{ serviceId: svc.id, qty: 1 }, { serviceId: svc2.id, qty: 1 }],
          technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1, 2] }],
          timecardId: card.id, timecardServiceId: svc.id,        // 次卡盖住第一项
          couponGrantId: grant.id                                 // 券打在余下的部分
        })
        log(`  ✅ ${name}:组合支付单(储值抵扣 + 次卡核销 + 券,一张单三条腿)`)
      } else {
        log(`  ⚠️ ${name}:组合支付单没铺 —— ${card ? '' : '没有次卡 '}${grant ? '' : '没有可用券'}(不静默,记在这儿)`)
      }
    }
  }

  log(`  → ${name} 就绪(${userId})`)
  return userId
}

/* ⑤⑥⑦:生产例外的三件配套。放在这里,本机沙箱那条路一行不受影响。 */
const RECON_TENANTS = [...PROTECTED_REAL_TENANTS]      // 对账只盯店主那两家真店
/* 本库里实际存在的那几家(沙箱只有 lucky-luxe,没有 jics-nail)。
   不存在的**明说跳过**,不许静默 —— 生产上要是少了一家,那本身就是要抬头看的事。 */
async function reconTenantsOf() {
  const ids = new Set(((await platform('/platform/tenants')).tenants || []).map((t) => t.id))
  const present = RECON_TENANTS.filter((t) => ids.has(t))
  for (const t of RECON_TENANTS) if (!ids.has(t)) log(`  ⚠️ 对账名单里的 ${t} 本库不存在 → 跳过(生产上不该出现这行)`)
  return present
}
/* 铺哪几家:本机沙箱=两家孪生店全铺;生产例外=只铺 --tenant 指的那一家(不许一把梭)。
   生产上那家店不在下面这张表里也允许(表只提供"铺什么数",不决定"能不能写")—— 
   能不能写由七条门禁说了算。 */
function targetsOf() {
  if (!PRODUCTION_SEED) return DEMO_TENANTS
  const known = [...PROD_TENANTS, ...DEMO_TENANTS].find((x) => x.tenantId === TARGET_TENANT)
  /* 表里没有的目标:用彩排口径兜底(有零有整 + 组合支付单),别再回落到那套 888 的老数字。
     真要铺哪家,还是应该先进 PROD_TENANTS 那张表 —— 数字得有人看过才算数。 */
  return [known || {
    tenantId: TARGET_TENANT, label: CONFIRM_NAME, currency: 'CAD', timezone: 'America/Toronto',
    twin: { balance: 73650, timecardTimes: 5, coupons: 2, orders: 2, combo: true, timecardRemaining: 3, name: '演示·跨店阿珍' }
  }]
}
async function statsOf(tenantId) {
  return (await platform(`/platform/tenants/${tenantId}/stats`)).stats
}
function diffStats(before, after) {
  const keys = ['incomeCents', 'financeRows', 'bookings', 'users', 'settlements']
  const bad = []
  for (const t of Object.keys(before)) {
    for (const k of keys) {
      if (before[t][k] !== after[t][k]) bad.push(`${t}.${k}: ${before[t][k]} → ${after[t][k]}`)
    }
  }
  return bad
}

/* 🔴 --dry-run:**只读**,把"会往这家店写什么"逐条列出来交 Cowork 核。
   门禁(②③④)照跑不放宽 —— dry-run 通不过的,真跑更通不过。
   数据源与真跑同一份(catalogPlan / membersOf / factsOf),不另写一套判断。 */
async function dryRun(spec) {
  log(`\n===== 试跑清单 · ${spec.label}(${spec.tenantId})=====`)
  const hit = await assertDemoTarget(spec.tenantId)
  if (!hit) {
    log(`  租户:不存在 → **将新建**(kind=demo,老板账号一并生成)`)
    log('  目录:七项全新建(服务 ×2 / 技师 ×2 / 充值套餐 / 次卡套餐 / 券模板)')
    for (const m of membersOf(spec)) {
      log(`  顾客「${m.name}」:**将新建** —— 已签署单 ${m.orders || 0} 张${m.combo ? '(其中 1 张组合支付:储值抵扣 + 次卡核销 + 券)' : ''}`
        + ` / 储值 ${(m.balance || 0) / 100} / 次卡 ${m.timecardTimes ? `1 张(用到剩 ${m.timecardRemaining || 0} 次)` : '不铺'} / 券 ${m.coupons || 0} 张 / 贴 openid`)
    }
    log('  ── 合计将写 9 项(租户 1 + 目录 7 + 顾客 2 的资产按上面逐项);真店零写入')
    log('  ── 每张已签署单都带签署单原件(签完即生成快照,顾客端/商家端都能点开)')
    if (spec.landed) {
      const L = spec.landed
      log(`  ── 铺完「${spec.twin.name}」会员卡上落地长这样(沙箱彩排**实测**,不是估的):`)
      log(`       储值余额 ${(L.balanceCents / 100).toFixed(2)}(充 ${(spec.twin.balance / 100).toFixed(2)},组合支付单用掉 ${((spec.twin.balance - L.balanceCents) / 100).toFixed(2)})`)
      log(`       累计消费 ${(L.totalSpentCents / 100).toFixed(2)} · 到店 ${L.visits} 次 · 次卡剩 ${L.timecardLeft} 次 · 券 ${L.activeCoupons} 张`)
    }
    return
  }
  log(`  租户:已有「${hit.name}」kind=${hit.kind || 'real'} → **不动**`)
  let willWrite = 0
  for (const it of await catalogPlan(spec)) {
    if (it.have) log(`  ${it.label}:已有,跳过`)
    else { willWrite += 1; log(`  ${it.label}:**将新建**`) }
  }
  const customers = (await api(spec.tenantId, '/admin/customers')).customers || []
  for (const m of membersOf(spec)) {
    const c = customers.find((x) => x.displayName === m.name)
    if (!c) { willWrite += 1; log(`  顾客「${m.name}」:**将新建** —— 已签署单 ${m.orders || 0} 张 / 储值 ${(m.balance || 0) / 100} / 次卡 ${m.timecardTimes ? '1 张' : '不铺'} / 券 ${m.coupons || 0} 张`); continue }
    const f = await factsOf(spec.tenantId, c.id)
    const cards = f.timecards.reduce((n, t) => n + (t.totalTimes - t.usedTimes), 0)
    const gaps = []
    const plainWant = m.combo ? Math.max(0, (m.orders || 0) - 1) : (m.orders || 0)
    if (plainWant > f.signedSheets) { gaps.push(`补已签署单 ${plainWant - f.signedSheets} 张`); willWrite += 1 }
    if (m.balance && !c.storedValueBalanceCents) { gaps.push(`充储值 ${m.balance / 100}`); willWrite += 1 }
    if (m.timecardTimes && !f.timecards.length) { gaps.push('买次卡 1 张'); willWrite += 1 }
    if (m.timecardRemaining && cards > m.timecardRemaining) { gaps.push(`核销次卡 ${cards - m.timecardRemaining} 次`); willWrite += 1 }
    if ((m.coupons || 0) > f.couponGrants) { gaps.push(`发券 ${(m.coupons || 0) - f.couponGrants} 张`); willWrite += 1 }
    if (m.combo && !f.comboSheets) { gaps.push('开 1 张组合支付单(储值抵扣 + 次卡核销 + 券)'); willWrite += 1 }
    if (f.wechatOpenId === m.openId) gaps.push('openid 已贴,不动')
    else { willWrite += 1; gaps.push(`**将贴 openid**(${m.openId})`) }
    if (!gaps.length) gaps.push('齐了,不动')
    log(`  顾客「${m.name}」:已有(users.id=${c.id})→ ${gaps.join(' · ')}`)
  }
  log(`  ── 合计将写 ${willWrite} 项;真店(${RECON_TENANTS.join(' / ')})**零写入**`)
}

async function main() {
  log(`演示孪生店铺设 · ${BASE}${DRY_RUN ? ' · 🔎 试跑(只读,不写一行)' : ''}`)
  if (DRY_RUN) {
    if (PRODUCTION_SEED) log(`🔴 生产例外试跑:目标 ${TARGET_TENANT} · 确认名「${CONFIRM_NAME}」`)
    for (const t of await reconTenantsOf()) {
      const st = await statsOf(t)
      log(`  真店基线 ${t}:收入 ${(st.incomeCents / 100).toFixed(2)} · 账本 ${st.financeRows} 行 · 单 ${st.bookings} · 顾客 ${st.users} · 结算单 ${st.settlements}`)
    }
    for (const spec of targetsOf()) await dryRun(spec)
    log('\n试跑结束:**一行未写**。核过之后去掉 --dry-run 才会真跑。')
    return
  }
  /* 生产例外:先备份(⑤),再取真店五项基线(⑥),铺完再取一次逐项比,
     对不上**立刻停下并报出来** —— 这脚本不是事务,不许悄悄跑完。 */
  let backup = null
  let baseline = null
  if (PRODUCTION_SEED) {
    log(`\n🔴 生产例外模式:目标 ${TARGET_TENANT} · 确认名「${CONFIRM_NAME}」`)
    backup = await platform('/platform/backup', { method: 'POST', body: JSON.stringify({ tag: `生产铺演示店前-${TARGET_TENANT}`, tenantId: TARGET_TENANT, reason: '演示店种数据前的按需备份(生产例外第⑤条)' }) })
    if (!backup || !backup.path) throw new Error('第⑤条:备份没拿到路径,已中止(备份或中止,不许硬跑)。')
    log(`⑤ 已备份:${backup.path}(${backup.size} 字节)`)
    // ⓔ 离红线还有多远,每次都说;ⓐ 按保留策略清了哪几份,也点名
    log(`   卷余量:${backup.spaceText || '探不到'}${(backup.pruned || []).length ? ` · 已清理旧快照 ${backup.pruned.length} 份` : ''}`)
    baseline = {}
    for (const t of await reconTenantsOf()) baseline[t] = await statsOf(t)
    log(`⑥ 真店五项基线已取:${Object.keys(baseline).map((t) => `${t} 收入 ${(baseline[t].incomeCents / 100).toFixed(2)}`).join(' · ')}`)
  }
  const targets = targetsOf()
  for (const spec of targets) {
    log(`\n===== ${spec.label}(${spec.tenantId}) =====`)
    await ensureTenant(spec)
    await ensureCatalog(spec)
    // 第二位是本店常客:各店**各自的** openid(与跨店身份区分开),这样也能演示充值(D25 闸要求已绑定)
    for (const m of membersOf(spec)) await seedMember(spec, m)
  }
  log('\n===== 跨店对照(同一个微信身份 · 两店各一套数)=====')
  for (const spec of targets) {
    const c = ((await api(spec.tenantId, '/admin/customers')).customers || []).find((x) => x.displayName === spec.twin.name)
    if (!c) { log(`  ${spec.label}:没找到跨店档案`); continue }
    const f = await factsOf(spec.tenantId, c.id)
    const cards = f.timecards.reduce((n, t) => n + (t.totalTimes - t.usedTimes), 0)
    const cpns = f.activeCoupons
    log(`  ${spec.label}:储值 ${(c.storedValueBalanceCents || 0) / 100} · 累计消费 ${(c.totalSpentCents || 0) / 100} · 到店 ${c.visitCount} 次 · 次卡剩 ${cards} 次 · 券 ${cpns} 张 · users.id=${c.id}`)
  }

  /* 🔴 ⑥ 跑后对账 + ⑦ 落运维日志。
     对账**必须有"发现不对立即停下并报出来"的出口** —— 这脚本不是事务,
     悄悄跑完是最坏的结果:真店数字动了却没人知道。 */
  if (PRODUCTION_SEED) {
    const after = {}
    for (const t of Object.keys(baseline)) after[t] = await statsOf(t)
    const bad = diffStats(baseline, after)
    const rows = (await platform(`/platform/tenants/${TARGET_TENANT}/stats`)).stats
    if (bad.length) {
      console.error('\n🔴 第⑥条:真店五项对不上,已停下 —— 不要继续,先看这几项:')
      for (const b of bad) console.error('   ' + b)
      console.error(`   回滚办法:停服务 → 用备份覆盖回主库:${backup.path}`)
      await platform('/platform/backup', { method: 'POST', body: JSON.stringify({ tag: `对账失败-${TARGET_TENANT}`, tenantId: TARGET_TENANT, reason: `铺设后真店五项对不上:${bad.join(' | ')}` }) }).catch(() => {})
      process.exit(2)
    }
    log(`\n⑥ 对账:${Object.keys(after).join(' / ')} 五项**零差异**`)
    for (const t of Object.keys(after)) {
      log(`   ${t}:收入 ${(after[t].incomeCents / 100).toFixed(2)} · 账本 ${after[t].financeRows} 行 · 单 ${after[t].bookings} · 顾客 ${after[t].users} · 结算单 ${after[t].settlements}`)
    }
    // ⑦ 谁 / 何时 / 哪家店 / 铺了多少行 / 备份路径
    await platform('/platform/ops-log/demo-seed', { method: 'POST', body: JSON.stringify({
      tenantId: TARGET_TENANT,
      detail: `生产铺设演示店:项目 ${rows.bookings} 单 / 顾客 ${rows.users} 人 / 结算单 ${rows.settlements} 张(铺后计)。备份:${backup.path}。真店五项零差异。`
    }) })
    log(`⑦ 已落 platform_ops_log(含备份路径)`)
    log(`\n备份路径(留底):${backup.path}`)
  }
}
main().catch((e) => { console.error(`🚫 铺设停下:${e.message}`); process.exit(1) })
