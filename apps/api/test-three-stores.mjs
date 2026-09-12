/* 三店并行常驻套件(05o §一⑤⑥ · 店主 09-07 拍板开北京店 `luvia-bj`)

   立件背景:此前所有隔离类判据都是**两店**(A/B)。两店只能证「换店换得动」,
   证不了「**同币种不同店**分不分得开」——而新开的北京店与小婕店**币种时区一模一样**(CNY / Asia/Shanghai),
   两者之间唯一的区别只剩数据本身。所以第三店不是「多跑一遍」,是补上一类此前不存在的判据。

   ══ 三档口径(照真店造,不自己编)══
   · A = 加拿大档:CAD / America/Toronto   (真店 lucky-luxe)
   · B = 境内档一:CNY / Asia/Shanghai     (真店 jics-nail 小婕店)
   · C = 境内档二:CNY / Asia/Shanghai     (真店 luvia-bj 北京旗舰店)

   ══ 一处必须说清的规格与事实之差(不许判据假装看不见)══
   05o §一⑤ 原话是「storeAddress / currency / timezone 与另两店**两两不等**」。
   **币种与时区做不到两两不等** —— B 与 C 都是 CNY / Asia/Shanghai,这是事实不是缺陷。
   所以本套件写成**白名单式**(判据三:数「我列的都对」永远漏没列的):
   · 地址:三者**两两不等**(硬判据);
   · 币种/时区:**逐店必须落进它自己那一档**,且 A 与 B/C 必须不同档。
   把「两两不等」硬套到币种上,只会得到一条**永远绿不了**或**改判据凑绿**的假判据。 */
import { assertTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.OWNER_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

async function request(path, options = {}, token = PLATFORM, tid = '') {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(tid ? { 'x-admin-tenant-id': tid } : {}), ...(options.headers || {}) }
  })
  let data = null
  try { data = await r.json() } catch { data = null }
  return { status: r.status, data }
}

/* 三档:key / 币种 / 时区 / 地址锚字 —— 地址里的城市名就是「串味」判据要抓的把手 */
const SHOPS = [
  { key: 'A', id: `ts3a-${RUN}`, name: `三店A加拿大档${RUN}`, currency: 'CAD', timezone: 'America/Toronto', address: `A街 ${RUN} 号,多伦多`, city: '多伦多' },
  { key: 'B', id: `ts3b-${RUN}`, name: `三店B境内一${RUN}`, currency: 'CNY', timezone: 'Asia/Shanghai', address: `B路 ${RUN} 号,上海市静安区`, city: '上海' },
  { key: 'C', id: `ts3c-${RUN}`, name: `三店C北京档${RUN}`, currency: 'CNY', timezone: 'Asia/Shanghai', address: `北京市朝阳区 ${RUN} 号院`, city: '北京' }
]
const byKey = Object.fromEntries(SHOPS.map((s) => [s.key, s]))

/* ── ⓪ 造景(《造景律》:谁出走查单,谁先把景造好;造不出来按红)────── */
let fixtureOk = true
for (const shop of SHOPS) {
  const made = await request('/platform/tenants', {
    method: 'POST',
    body: JSON.stringify({ id: shop.id, name: shop.name, plan: 'single', currency: shop.currency, timezone: shop.timezone, city: shop.address })
  })
  if (made.status !== 201) { fixtureOk = false; shop.err = `建店 ${made.status}`; break }
  shop.owner = made.data.owner
  const set = await request(`/platform/tenants/${shop.id}/store`, {
    method: 'PUT', body: JSON.stringify({ currency: shop.currency, timezone: shop.timezone, address: shop.address })
  })
  if (![200, 201].includes(set.status)) { fixtureOk = false; shop.err = `设门店 ${set.status}`; break }
  shop.store = set.data.store
}
check('⓪ 造景:三家店(加拿大档 / 境内档一 / 境内档二)都建出来了',
  fixtureOk, SHOPS.map((s) => `${s.key}${s.err ? `✗${s.err}` : '✓'}`).join(' '))

if (!fixtureOk) {
  console.log(`\n[三店] 造景失败,后续判据没验到东西 —— 按红处理,不许「造不出来就当过了」`)
  console.log(`\n${fails.length ? `✗ ${fails.length} 条未通过` : ''}`)
  process.exit(1)
}

/* 老板令牌:走正门登录 + 首登改密(平台建店给的是一次性初始密码) */
for (const shop of SHOPS) {
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: shop.owner.username, password: shop.owner.initialPassword }) }, null)
  const pass = `Ts3-${RUN}-${shop.key}9a`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: shop.owner.initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data?.auth?.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: shop.owner.username, password: pass }) }, null)
  shop.token = again.data?.auth?.accessToken || ''
}
check('⓪b 三家老板令牌都拿到了(下面的越权判据靠它,拿不到等于没验)',
  SHOPS.every((s) => s.token), SHOPS.map((s) => `${s.key}=${s.token ? 'ok' : '空'}`).join(' '))

/* ── ① 三店口径:地址两两不等 · 币种时区逐店落档(白名单式)────── */
for (const shop of SHOPS) {
  const clock = await request('/admin/store-clock', {}, shop.token)
  shop.clock = clock.data || {}
  const kb = await request('/admin/kb', {}, shop.token)
  shop.addrRead = String(kb.data?.liveFacts?.storeAddress || kb.data?.facts?.storeAddress || '')
}
const addrs = SHOPS.map((s) => s.addrRead)
check('① 地址三者两两不等(先证换店真的换了,否则底下全是自己跟自己比)',
  new Set(addrs).size === 3 && addrs.every(Boolean), addrs.join(' | '))
check('①b 且各自等于夹具写进去的那一个',
  SHOPS.every((s) => s.addrRead === s.address), SHOPS.map((s) => `${s.key}:${s.addrRead}`).join(' | '))
check('①c 币种逐店落档(白名单:每家必须等于它自己那一档,不是「彼此不同」)',
  SHOPS.every((s) => s.clock.currency === s.currency),
  SHOPS.map((s) => `${s.key} 期望${s.currency} 实际${s.clock.currency}`).join(' | '))
check('①d 时区逐店落档(同上)',
  SHOPS.every((s) => s.clock.timezone === s.timezone),
  SHOPS.map((s) => `${s.key} 期望${s.timezone} 实际${s.clock.timezone}`).join(' | '))
check('①e 🔴 加拿大档与两家境内档**必须分属不同币种/时区**(这一条才是「串味」会红的那条)',
  byKey.A.clock.currency !== byKey.B.clock.currency && byKey.A.clock.timezone !== byKey.C.clock.timezone,
  `A=${byKey.A.clock.currency}/${byKey.A.clock.timezone} B=${byKey.B.clock.currency} C=${byKey.C.clock.timezone}`)
check('①f 反向守:B 与 C **本来就同币同时区**(这是事实)—— 判据不许靠「它俩不同」凑绿',
  byKey.B.clock.currency === byKey.C.clock.currency && byKey.B.clock.timezone === byKey.C.clock.timezone,
  `B=${byKey.B.clock.currency}/${byKey.B.clock.timezone} C=${byKey.C.clock.currency}/${byKey.C.clock.timezone}`)
check('①g 三家「今天」由各自时区算(B/C 同区必同日;A 与境内档跨了 12 小时,同一时刻日期可差一天)',
  byKey.B.clock.today === byKey.C.clock.today && /^\d{4}-\d{2}-\d{2}$/.test(byKey.A.clock.today || ''),
  `A=${byKey.A.clock.today} B=${byKey.B.clock.today} C=${byKey.C.clock.today}`)

/* ── ② 时区反算:同一句「下午三点」,两档落在不同的 UTC 上 ────────
   这条是《判据律》要的那种能证伪的判据:时区没生效 → 两店 UTC 会一样 → 立刻红。
   北京 15:00 = 07:00Z(UTC+8,不实行夏令时);多伦多 15:00 = 19:00Z(EDT, UTC-4)/ 20:00Z(EST)。 */
async function bookAtThree(shop) {
  /* 新建的租户只有平台默认大类,**没有价目项** —— 首跑就栽在这儿(判据如实报「缺件 svc=false」
     而不是静默跳过,这正是《断言增量律》要的形状)。造景归造景:这里自己补一项。 */
  let svc = (await request('/admin/pricing/items', {}, shop.token)).data?.items?.find((i) => (i.itemKind || 'main') !== 'addon')
  if (!svc) {
    const cat = (await request('/admin/pricing/categories', {}, shop.token)).data?.categories?.[0]
    if (!cat) return { err: '连默认大类都没有,建店流程变了' }
    const made = await request('/admin/pricing/items', {
      method: 'POST',
      body: JSON.stringify({ nameZh: `项目${shop.key}${RUN}`, nameEn: `Item${shop.key}`, type: 'NAIL', itemKind: 'main',
        categoryId: cat.id, unit: 'once', listPriceCents: 19800, baseDurationMin: 60, depositCents: 0, isActive: true })
    }, shop.token)
    svc = made.data?.item
    if (!svc) return { err: `建项目失败 ${made.status} ${JSON.stringify(made.data).slice(0, 120)}` }
  }
  const tech = (await request(`/platform/tenants/${shop.id}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技${shop.key}${RUN}` }) })).data?.technician
  if (!tech) return { err: '建技师失败' }
  // 「明天」按该店自己的今天推 —— 不用裸 new Date()
  const today = shop.clock.today
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  const date = d.toISOString().slice(0, 10)
  const made = await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: `顾客${shop.key}${RUN}`, serviceId: svc.id, technicianId: tech.id, date, time: '15:00' })
  }, shop.token)
  if (made.status !== 201) return { err: `排单 ${made.status} ${JSON.stringify(made.data).slice(0, 120)}` }
  return { date, booking: made.data.booking }
}
const bookA = await bookAtThree(byKey.A)
const bookC = await bookAtThree(byKey.C)
const utcOf = (b) => String(b?.booking?.appointmentStart || b?.booking?.startsAt || b?.booking?.appointment_start || '')
const hourA = utcOf(bookA).slice(11, 16)
const hourC = utcOf(bookC).slice(11, 16)
check('② 造景:两档各排一张「明天 15:00」',
  !bookA.err && !bookC.err, `A:${bookA.err || 'ok'} | C:${bookC.err || 'ok'}`)
check('②a 🔴 北京档 15:00 存进库是 **07:00Z**(UTC+8 反算;时区没生效这条立刻红)',
  hourC === '07:00', `实际 ${utcOf(bookC)}`)
check('②b 🔴 加拿大档同一句 15:00 落在 **19:00Z 或 20:00Z**(夏令时两种都算对)',
  ['19:00', '20:00'].includes(hourA), `实际 ${utcOf(bookA)}`)
check('②c 🔴 同一句话、两家店,UTC **必须不同** —— 相同就说明时区根本没参与换算',
  Boolean(hourA) && Boolean(hourC) && hourA !== hourC, `A=${hourA} C=${hourC}`)

/* ── ③ 提醒任务按门店时区算 ────────────────────────────────
   排单会生成提醒;提醒时刻必须早于服务开始,且落在同一条时区换算链上。 */
const tasksC = (await request('/admin/reminder-tasks', {}, byKey.C.token)).data
const listC = Array.isArray(tasksC?.reminderTasks) ? tasksC.reminderTasks : []
const mineC = listC.filter((t) => t.bookingId === bookC.booking?.id)
check('③ 北京档那张单生成了提醒任务(0 条 = 提醒链没接上,不是「本来就没有」)',
  mineC.length > 0, `本店提醒 ${listC.length} 条,其中挂这张单 ${mineC.length} 条`)
/* 🔴 《断言增量律》:下面这两条被条件块包着 —— **取不到前置就红,不许静默跳过**。
   01w 就是靠这条查出「取结算单号的字段名写错、if 整块被跳过而套件报绿」。 */
const arrival = mineC.find((t) => t.type === 'arrival_reminder')
check('③a 到店提醒(arrival_reminder)这一条在(字段名/类型名改了这里会红,不会静默跳过)',
  Boolean(arrival?.scheduledAt), `本单 ${mineC.length} 条,类型=${mineC.map((t) => t.type).join(',') || '(无)'}`)
const startMs = Date.parse(utcOf(bookC))
const runMs = Date.parse(arrival?.scheduledAt || '')
check('③b 到店提醒早于服务开始,且**同一天之内**(按门店时区算;换算链错了会飘到别的日子)',
  !Number.isNaN(runMs) && !Number.isNaN(startMs) && runMs < startMs && startMs - runMs <= 24 * 3600 * 1000,
  `提醒=${arrival?.scheduledAt} 服务=${utcOf(bookC)}`)
/* 反算证:提醒时刻按**北京时间**看必须是个整点营业时段内的时刻,而不是按 UTC 直接当本地用 */
const bjHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date(runMs || 0))
check('③c 提醒时刻反算回北京时间落在 06:00–20:00 之间(拿 UTC 当本地用会掉到半夜)',
  !Number.isNaN(runMs) && Number(bjHour) >= 6 && Number(bjHour) <= 20, `北京 ${bjHour} 点(${arrival?.scheduledAt})`)

/* ── ④ 越权:各店老板只看得见自己的单(三店两两互查)────────── */
const seen = {}
for (const shop of SHOPS) {
  const list = (await request('/admin/bookings', {}, shop.token)).data?.bookings || []
  seen[shop.key] = new Set(list.map((b) => b.id))
}
const idA = bookA.booking?.id
const idC = bookC.booking?.id
check('④ 北京档老板看得见自己那张单(反向守:拦串味不等于把功能拦没)',
  Boolean(idC) && seen.C.has(idC), `C 名下 ${seen.C.size} 张`)
check('④b 🔴 北京档老板**看不见**加拿大档那张单', Boolean(idA) && !seen.C.has(idA), `A 单 ${idA}`)
check('④c 🔴 加拿大档老板**看不见**北京档那张单', Boolean(idC) && !seen.A.has(idC), `C 单 ${idC}`)
check('④d 🔴 境内档一(同币同时区那家)也**看不见**北京档那张单 —— 同口径不等于同一家店',
  Boolean(idC) && !seen.B.has(idC), `B 名下 ${seen.B.size} 张`)

/* ── ⑤ 币种红线:境内档的钱不许说成加币,也不许冒出另一档的城市名 ── */
const depC = (await request('/admin/deposit-config', {}, byKey.C.token)).data
const textC = `${depC?.text?.zh || ''}${(depC?.summaryRows?.zh || []).map((r) => `${r.label}${r.value}`).join('')}`
check('⑤ 境内档定金出句里**没有** CAD / 加币 / Toronto / 多伦多',
  Boolean(textC) && !/CAD|加币|Toronto|多伦多/i.test(textC), textC.slice(0, 140))
check('⑤b 反向守:境内档的钱**说得出来**(整句为空 = 把功能拦没了,不算过)',
  /[¥￥]|元/.test(textC), textC.slice(0, 140))
/* 🔴 补一家**没填地址**的店(05p 段 4 挨刀时发现的判据盲区):
   ⑤c 原来只验「三家都填了地址、彼此不串」——**而回落只在「这家没地址」时才发生**。
   现测:给「地址为空就取全表第一家店的地址」这个经典回落写法落刀,⑤c 一条都没红,
   因为夹具里三家都有地址,那个分支根本没被走到。
   案底不是假想的:`jics-nail` 在沙箱库里的 storeAddress 就是空的(05o-2 现测登记过)。
   所以再造一家空地址的店,专门守这条:**没地址就是没地址,不许穿别人家的**。 */
const EMPTY_ID = `ts3e-${RUN}`
{
  const made = await request('/platform/tenants', {
    method: 'POST', body: JSON.stringify({ id: EMPTY_ID, name: `三店E没填地址${RUN}`, plan: 'single', currency: 'CNY', timezone: 'Asia/Shanghai' })
  })
  check('⑤d0 造景:建出一家**没填地址**的店(建不出来按红)', made.status === 201, String(made.status))
  if (made.status === 201) {
    const kb = await request('/admin/kb', {}, PLATFORM, EMPTY_ID)
    const addr = String(kb.data?.liveFacts?.storeAddress || kb.data?.facts?.storeAddress || '')
    /* 判据写成**「必须是空」**,不写成「不含那三个地址」——
       后者是黑名单式的:回落到**第四家**店的地址照样绿(首跑就这么放过了一把真刀)。
       契约本来就是「拿不到真值就空着」,那就直接验空。 */
    check('⑤d 🔴 没填地址的店,读到的地址**必须是空**(零回落红线:拿不到真值就空着,不许穿别人家的)',
      addr.trim() === '', `读到「${addr}」`)
  }
}

check('⑤c 🔴 三店地址两两之间零串味:各店读到的地址里不含另两店的城市锚字',
  SHOPS.every((s) => SHOPS.filter((o) => o.key !== s.key).every((o) => !s.addrRead.includes(o.city))),
  SHOPS.map((s) => `${s.key}:${s.addrRead}`).join(' | '))

console.log(`\n[三店并行] 三档口径(CAD/多伦多 · CNY/上海 · CNY/北京)· 地址两两不等 · 币种时区白名单落档 · `
  + `15:00 两档 UTC 反算 · 提醒链 · 三店两两越权 · 币种红线`)
if (fails.length) {
  console.log(`\n✗ ${fails.length} 条未通过:`)
  for (const f of fails) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`\n✅ ${n} 条全部通过`)
