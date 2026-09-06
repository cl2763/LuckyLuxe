#!/usr/bin/env node
/* 新店造景:LUVIA 半径美甲美睫 · 北京旗舰店(tenant = luvia-bj)
   —— 店主 09-07 拍板:旗舰店 `lucky-luxe` 保留加拿大口径**一行不动**,另开一家北京店,三店并行走查。

   ══ 造景族白名单 · 为什么允许它写库(理由写在这里,不写在别处)══
   这是**新店从零建**,不是给既有店补数据:全程只 INSERT 新租户自己的行,
   不 UPDATE 任何既有租户的行。写前 `tools/db-backup.mjs` 备份、
   写后 `tools/tenant-fingerprint.mjs --diff` 证「既有租户逐表指纹零差异」。
   预约行一律盖 `x-demo-seed: seed-luvia-bj`(D121 演示标记唯一出口),
   一条 `WHERE demo_seed IS NOT NULL` 能整批认出来。

   ══ 幂等(《幂等判据律》)══
   判「**造过没有**」,不判「**还剩多少**」:
   · 租户 → 按 id 认;大类 → 按 key;项目/加项 → 按「名称+main/addon」;
   · 技师 / 顾客 / 券 / 知识库 → 按名称或问题认;
   · 预约 → 数 `demo_seed = 'seed-luvia-bj'` 的**造过的张数**,不数「现在还剩几张未取消的」。
     (剩余量会被正常业务消耗;拿它当幂等键必然重复执行 —— 05n 彩排撞出来的那两个破口就是这么来的。)

   ══ 不造什么 ══
   **不造结算单、不造账本流水**(05o §一③)。给真实经营凭空造钱是《假数回落红线》⑥ 明禁的。

   用法(目标库必须显式给,《db-target》不许有默认值):
     BASE_URL=http://127.0.0.1:4310 OWNER_TOKEN=<主钥匙> node tools/seed-luvia-bj.mjs   # 沙箱
     BASE_URL=http://127.0.0.1:4128 OWNER_TOKEN=<主钥匙> node tools/seed-luvia-bj.mjs   # 本机库 */
import { requireTarget, reportTarget, countRows } from './db-target.mjs'

const BASE_URL = String(requireTarget({
  envName: 'BASE_URL', value: process.env.BASE_URL,
  hint: '(沙箱 http://127.0.0.1:4310 / 本机库 http://127.0.0.1:4128;端口会骗人,以脚本自报的库路径为准)'
})).replace(/\/$/, '')
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'owner-demo-token'

const TENANT_ID = 'luvia-bj'
const TENANT_NAME = 'LUVIA 半径美甲美睫 · 北京旗舰店'
const TENANT_NAME_EN = 'LUVIA Beijing Flagship'
const STORE_ADDRESS = '北京市朝阳区CBD万达广场6号楼2005'
const STORE_PHONE = 'Phone TBD'
const STORE_TZ = 'Asia/Shanghai'
const STORE_CURRENCY = 'CNY'
const ASSISTANT_NAME = 'LUVIA 北京预约助手'
const SEED_TAG = 'seed-luvia-bj'

const log = (...args) => console.log(...args)

async function api(path, options = {}, asTenant = false) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-demo-seed': SEED_TAG,
      authorization: `Bearer ${OWNER_TOKEN}`,
      ...(asTenant ? { 'x-admin-tenant-id': TENANT_ID } : {}),
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!response.ok) { const e = new Error(`${options.method || 'GET'} ${path} → ${response.status} ${JSON.stringify(data)}`); e.status = response.status; throw e }
  return data
}
const T = (path, options = {}) => api(path, options, true)
const POST = (path, body) => T(path, { method: 'POST', body: JSON.stringify(body) })
const PUT = (path, body) => T(path, { method: 'PUT', body: JSON.stringify(body) })

/* ── 北京时间的「今天」与「第 N 天」──────────────────────────────
   裸 `new Date()` 推日期是被 CLAUDE.md 明禁的:门店时区说了算。
   这里统一用 Intl 把时刻格式化到 Asia/Shanghai 再取日期串。 */
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const WD = new Intl.DateTimeFormat('en-US', { timeZone: STORE_TZ, weekday: 'short' })
const WD_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const dayShift = (n) => new Date(Date.now() + n * 86400000)
const bjDate = (n) => FMT.format(dayShift(n))
const bjWeekday = (n) => WD_INDEX[WD.format(dayShift(n))]

// ── 价目(单位:分;三档 = 原价 / 分享价 / 会员价)────────────────
const CATEGORIES = [
  { key: 'nail_solid', name: '美甲单色', sortOrder: 1 },
  { key: 'nail_style', name: '美甲款式', sortOrder: 2 },
  { key: 'lash_basic', name: '美睫基础', sortOrder: 3 },
  { key: 'lash_style', name: '美睫款式', sortOrder: 4 },
  { key: 'removal', name: '卸除', sortOrder: 5 }
]

/* [名称, 大类key, 类型, 原价, 分享价, 会员价, 时长分钟, 需报价?]
   末位 'quote' = D146 的 `price_mode`:**要技师看过才报价**,AI 一个数字都不许出,
   也不参与「最便宜的是哪种」。05o §一 要的那 1–2 个「需报价」项,现在有列可放了。 */
const MAIN_ITEMS = [
  ['精致单色', 'nail_solid', 'NAIL', 29800, 25800, 19800, 90],
  ['猫眼渐变', 'nail_solid', 'NAIL', 39800, 33800, 26800, 100],
  ['简约款式', 'nail_style', 'NAIL', 49800, 42800, 33800, 120],
  ['法式镶钻', 'nail_style', 'NAIL', 69800, 58800, 45800, 150],
  ['参考图定制款', 'nail_style', 'NAIL', 0, 0, 0, 180, 'quote'],
  ['单根嫁接 · 自然', 'lash_basic', 'LASH', 39800, 33800, 25800, 90],
  ['日式平扇', 'lash_basic', 'LASH', 49800, 42800, 33800, 100],
  ['浓密款式', 'lash_style', 'LASH', 59800, 49800, 39800, 110],
  ['开扇混合款', 'lash_style', 'LASH', 79800, 65800, 52800, 130],
  ['眼型定制设计款', 'lash_style', 'LASH', 0, 0, 0, 150, 'quote']
]

// [名称, 大类key, 类型, 原价, 分享价, 会员价, 单位, 适用大类keys]
const NAIL_SCOPE = ['nail_solid', 'nail_style']
const ADDON_ITEMS = [
  ['本店制作免卸甲', 'removal', 'NAIL', 0, 0, 0, 'once', NAIL_SCOPE],
  ['卸本甲', 'removal', 'NAIL', 5800, 3800, 1800, 'once', NAIL_SCOPE],
  ['纤维补甲(单指)', 'nail_style', 'NAIL', 3800, 2800, 1800, 'per_finger', NAIL_SCOPE]
]

const TECHNICIANS = [
  { name: '棠棠', title: '美甲师' },
  { name: '知夏', title: '美睫师' },
  { name: '阿柚', title: '美甲美睫双修' }
]

const CUSTOMER_NAMES = [
  '陈曦', '沈知遥', '林书禾', '苏念', '周雨桐', '何宛清', '许听澜', '江斯屿', '祁佳岸', '温以然',
  '罗清和', '章沐白', '傅照野', '贺晚意', '柏舟', '殷宁', '简安', '桑晓', '路屿', '祝望舒'
]

const COUPONS = [
  { name: '北京店开业礼 · 满 300 减 50', discountType: 'amount', amountCents: 5000, minSpendCents: 30000, validDays: 60, totalQty: 200 },
  { name: '老客回店 9 折', discountType: 'percent', percentOff: 10, minSpendCents: 0, validDays: 90, totalQty: 100 }
]

const KB_ENTRIES = [
  {
    question: '你们店在哪?怎么走?',
    keywords: '地址,在哪,怎么走,位置,地铁,导航',
    answerZh: `我们在${STORE_ADDRESS}。地铁 1 号线/10 号线国贸站 C 口出,步行约 8 分钟;导航直接搜「万达广场 6 号楼」,到 2005 室按门铃就行。`
  },
  {
    question: '开车过来好停吗?',
    keywords: '停车,车位,地库,停车费,开车',
    answerZh: '楼下有地下停车场,B2、B3 层车位比较充裕。到店报手机号可以帮您登记,消费满 200 元免 2 小时停车。周末车位紧张,建议早到 10 分钟。'
  },
  {
    question: '第一次来要注意什么?',
    keywords: '注意事项,第一次,新客,需要带,提前多久,能不能带人',
    answerZh: '① 提前 5–10 分钟到就好,不用带任何东西;② 手部有伤口、甲沟炎或近期做过其他项目的,来之前跟我们说一声,技师会先看一下再决定做不做;③ 做美睫当天不要化眼妆、不要戴美瞳;④ 可以带一位同行,店里有等候位。'
  }
]

async function main() {
  /* 🔴 写库自报律的路径那一格,两件事绑在一起:
     ① `db-target` 里那个从 `/health.dataFile` 反查路径的办法**在本机是废的** ——
        09-08 现测 4128/4310 两个端口的 /health **都不下发这个字段**,
        它一直回的是那句提示语,路径从来没真报过(已登记待补);
     ② 所以这里改成**显式必给**,而且**同样走 `requireTarget`**:没有默认、没有回落。
        首版写的是「环境变量 || 反查」,被 `test-db-target-guard` ①d 当场咬住 ——
        那把刀是**按解析点判、不按文件判**:一个脚本两条腿,一条接了护栏、另一条裸读环境变量,
        按文件判会绿,而那正是 03q「本机库又被写了」的通道。判据是对的,改代码不改判据。
     真正的端口→文件硬证据仍是跑完那次 `tools/tenant-fingerprint.mjs --diff`:
     新租户落在**哪个文件**里,一看便知;自报字符串只是方便。 */
  const dbPath = requireTarget({
    envName: 'SEED_DB_PATH', value: process.env.SEED_DB_PATH,
    hint: '(目标库文件绝对路径;/health 不下发 dataFile,必须显式给)'
  })
  log(`\n════ 写库自报(开跑前)════`)
  log(`  服务:     ${BASE_URL}`)
  log(`  目标库:   ${dbPath}`)
  const before = countRows(dbPath)
  log(`  关键表:   ${Object.entries(before).map(([k, v]) => `${k}=${v ?? '?'}`).join(' · ')}`)
  log(`\n== 造景:${TENANT_NAME}(${TENANT_ID})==`)

  // ── 1. 租户(按 id 幂等)────────────────────────────────────
  const { tenants } = await api('/platform/tenants')
  let credentials = null
  if (tenants.some((t) => t.id === TENANT_ID)) {
    log('- 租户已存在,跳过建店(幂等)')
  } else {
    const created = await api('/platform/tenants', {
      method: 'POST',
      body: JSON.stringify({
        id: TENANT_ID, name: TENANT_NAME, nameEn: TENANT_NAME_EN, plan: 'single', initialTerm: 'year',
        city: STORE_ADDRESS, phone: STORE_PHONE, currency: STORE_CURRENCY, timezone: STORE_TZ
      })
    })
    credentials = created.owner
    log(`+ 建店成功;老板账号 ${credentials.username}(初始密码只显示这一次,首登强制改密)`)
  }

  // ── 2. 币种/时区/门店资料 ──────────────────────────────────
  const storeRes = await api(`/platform/tenants/${TENANT_ID}/store`, {
    method: 'PUT',
    body: JSON.stringify({ name: TENANT_NAME, currency: STORE_CURRENCY, timezone: STORE_TZ })
  })
  if (storeRes.store.timezone !== STORE_TZ) throw new Error(`时区没写进去(实际 ${storeRes.store.timezone})`)
  if (storeRes.store.currency !== STORE_CURRENCY) throw new Error(`币种没写进去(实际 ${storeRes.store.currency})`)
  // 地址/电话走商家端正门 —— 它顺手把 storeAddress/storePhone 同步进知识库事实(地址来源合一)
  const info = await PUT('/admin/store-info', { name: TENANT_NAME, address: STORE_ADDRESS, phone: STORE_PHONE })
  log(`- 门店:${storeRes.store.currency} · ${storeRes.store.timezone} · ${info.store.address}`)

  /* ── 2b. AI 智能包 ──────────────────────────────────────────
     🔴 09-08 现测踩到:新店建出来 AI **一句话都不答**(`entitlementBlocked: true`)。
     病根是建店走的 `plan: 'single'`,而 `ai_customer_service` 只在 chain/custom 档里,
     于是店主打开北京店试 AI 客服会看到「机器不理人」,而后台一点报错都没有。
     开通走平台正门(只有平台主钥匙写得动;商家侧自己开不了 —— 08-04 安全裁定)。 */
  await PUT('/admin/tenant/entitlements', { feature: 'ai_customer_service', enabled: true, note: '北京旗舰店走查店:开 AI 智能包' })
  const ents = (await T('/admin/tenant/entitlements')).entitlements || {}
  const aiOn = Boolean(ents.features?.ai_customer_service?.enabled)
  if (!aiOn) throw new Error('AI 智能包没开成 —— 新店 AI 会一句不答,不许当成功')
  log('- AI 智能包:已开通(现读回验过)')

  // ── 3. 营业时间:周一休,其余 10:00–20:00 ───────────────────
  await PUT('/admin/business-hours', {
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday === 1
      ? { weekday, isClosed: true }
      : { weekday, isClosed: false, openTime: '10:00', closeTime: '20:00' }))
  })
  log('- 营业时间:周一休,其余 10:00–20:00')

  // ── 4. 定金规则:fixed ¥50 · 不抵扣 · 24h 全退 / 临期 50% / 爽约 100% ──
  const dep = await PUT('/admin/deposit-config', {
    config: {
      enabled: true, mode: 'fixed', fixedAmountCents: 5000, deductible: false, memberWaive: 'none',
      cancelPolicy: { refundable: true, freeCancelHours: 24, lateForfeitPct: 50, noShowForfeitPct: 100 }
    }
  })
  log(`- 定金:${dep.config.mode} ¥${dep.config.fixedAmountCents / 100} · 不抵扣 · 24h/50%/100%`)

  // ── 5. 会员两档 ─────────────────────────────────────────────
  await PUT('/admin/membership/config', {
    config: {
      tiersEnabled: true, memberQualify: 'any_recharge', qualifyValueCents: 0, expireDays: null,
      tiers: [
        { key: 'silver', label: '银卡', minSpendCents: 0 },
        { key: 'gold', label: '金卡', minSpendCents: 300000 }
      ]
    }
  })
  log('- 会员:两档(银卡 / 金卡)')

  // ── 6. 大类(按 key 幂等)───────────────────────────────────
  const existingCats = (await T('/admin/pricing/categories')).categories
  const catIdByKey = {}
  for (const cat of CATEGORIES) {
    const hit = existingCats.find((c) => c.key === cat.key)
    if (hit) { catIdByKey[cat.key] = hit.id; continue }
    catIdByKey[cat.key] = (await POST('/admin/pricing/categories', { ...cat, isBookable: true })).category.id
  }
  log(`- 大类 ${CATEGORIES.length} 个就位`)

  // ── 7. 项目与加项(按「名称 + main/addon」幂等)──────────────
  const existingItems = (await T('/admin/pricing/items')).items
  const findItem = (nameZh, itemKind) => existingItems.find((i) => i.nameZh === nameZh && i.itemKind === itemKind)
  let created = 0
  for (const [nameZh, catKey, type, list, share, member, durationMin, priceMode] of MAIN_ITEMS) {
    if (findItem(nameZh, 'main')) continue
    await POST('/admin/pricing/items', {
      nameZh, nameEn: nameZh, type, itemKind: 'main', categoryId: catIdByKey[catKey], unit: 'once',
      listPriceCents: list, sharePriceCents: share, memberPriceCents: member,
      baseDurationMin: durationMin, depositCents: 0, isActive: true,
      priceMode: priceMode === 'quote' ? 'quote' : 'fixed',
      sortOrder: MAIN_ITEMS.findIndex((r) => r[0] === nameZh) + 1
    })
    created += 1
  }
  /* 自证:这两项确实是 quote —— 建过一次之后再跑是幂等跳过,所以**读回来验**,不靠「我发过了」 */
  const quoted = (await T('/admin/pricing/items')).items.filter((i) => i.priceMode === 'quote').map((i) => i.nameZh)
  if (quoted.length < 2) throw new Error(`需报价项目应有 2 个,实际 ${quoted.length}:${quoted.join('/')}`)
  log(`- 需报价项目 ${quoted.length} 个:${quoted.join(' · ')}`)
  for (const [nameZh, catKey, type, list, share, member, unit, scopeKeys] of ADDON_ITEMS) {
    if (findItem(nameZh, 'addon')) continue
    await POST('/admin/pricing/items', {
      nameZh, nameEn: nameZh, type, itemKind: 'addon', categoryId: catIdByKey[catKey], unit,
      listPriceCents: list, sharePriceCents: share, memberPriceCents: member,
      baseDurationMin: 0, depositCents: 0, isActive: true,
      addonScope: scopeKeys.map((k) => catIdByKey[k]).filter(Boolean),
      sortOrder: ADDON_ITEMS.findIndex((r) => r[0] === nameZh) + 1
    })
    created += 1
  }
  log(`- 项目 ${MAIN_ITEMS.length} + 加项 ${ADDON_ITEMS.length}(本次新建 ${created} 条)`)

  // ── 8. 技师三人(只有对外称呼)───────────────────────────────
  let techs = (await T('/admin/technicians')).technicians || []
  for (const t of TECHNICIANS) {
    if (techs.some((x) => x.name === t.name)) continue
    await POST('/admin/technicians', t)
  }
  techs = (await T('/admin/technicians')).technicians || []
  log(`- 技师 ${techs.length} 人:${techs.map((t) => t.name).join(' · ')}`)

  // ── 9. 顾客 20 人 ───────────────────────────────────────────
  /* 商家端没有「建顾客」这条口(顾客要么自己注册、要么排单时现建),
     批量建档的正门是平台端导入 —— 它按手机号去重,天生幂等。 */
  const phoneOf = (i) => `1390000${String(i + 1).padStart(4, '0')}`
  await api(`/platform/tenants/${TENANT_ID}/import/customers`, {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      rows: CUSTOMER_NAMES.map((name, i) => ({ name, phone: phoneOf(i) }))
    })
  })
  const customers = (await T('/admin/customers')).customers || []
  log(`- 顾客 ${customers.length} 位(平台端导入,按手机号去重)`)

  // ── 10. 优惠券 2 张(按名称幂等)─────────────────────────────
  const existingCoupons = (await T('/admin/coupons')).coupons || []
  for (const c of COUPONS) {
    if (existingCoupons.some((x) => x.name === c.name)) continue
    await POST('/admin/coupons', c)
  }
  log(`- 优惠券 ${COUPONS.length} 张`)

  // ── 11. 知识库:品牌事实 + 3 条 FAQ ─────────────────────────
  await PUT('/admin/kb/facts', {
    /* 币种**不在**这里写:D140 一处真相 —— 钱的单位只认 `stores.currency`,
       往知识事实里塞 currency 会被后端当场拒(现测 400 UNKNOWN_KB_KEY)。 */
    facts: { brandName: TENANT_NAME, assistantName: ASSISTANT_NAME, storeAddress: STORE_ADDRESS }
  })
  const existingKb = (await T('/admin/kb')).entries || []
  let kbAdded = 0
  for (const entry of KB_ENTRIES) {
    if (existingKb.some((row) => row.question === entry.question)) continue
    await POST('/admin/kb/entries', entry)
    kbAdded += 1
  }
  log(`- 知识库:品牌事实已写;FAQ ${KB_ENTRIES.length} 条(本次新增 ${kbAdded})`)

  // ── 12. 预约:未来两周 30 张 + 历史 20 张 ────────────────────
  /* 幂等键 = 「造过几张」(demo_seed 计数),不是「还剩几张未取消」。 */
  const NOTE_TAG = '北京店造景'
  const seededBefore = ((await T('/admin/bookings')).bookings || []).filter((b) => String(b.notes || '').startsWith(NOTE_TAG)).length
  const mains = (await T('/admin/pricing/items')).items.filter((i) => i.itemKind === 'main')
  const nailIds = mains.filter((i) => i.type === 'NAIL').map((i) => i.id)
  const lashIds = mains.filter((i) => i.type === 'LASH').map((i) => i.id)
  const techIds = techs.map((t) => t.id)
  const userIds = customers.map((c) => c.id)
  const TIMES = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00']

  /* 排单计划:逐天、逐技师、逐时段,天生不撞位;周一(休)自动跳过。 */
  function plan(dayFrom, dayTo, want) {
    const out = []
    for (let d = dayFrom; d !== dayTo && out.length < want; d += (dayTo > dayFrom ? 1 : -1)) {
      if (bjWeekday(d) === 1) continue
      for (let ti = 0; ti < TIMES.length && out.length < want; ti += 1) {
        for (let k = 0; k < techIds.length && out.length < want; k += 1) {
          if ((ti + k) % 2 === 1) continue        // 排稀一点,像真店而不是排满
          const n = out.length
          const useNail = n % 2 === 0
          out.push({
            date: bjDate(d), time: TIMES[ti], technicianId: techIds[k],
            serviceId: (useNail ? nailIds : lashIds)[n % (useNail ? nailIds.length : lashIds.length)],
            userId: userIds[n % userIds.length]
          })
        }
      }
    }
    return out
  }

  const WANT_FUTURE = 30
  const WANT_PAST = 20
  let madeF = 0; let madeP = 0; let skipped = 0
  if (seededBefore >= WANT_FUTURE + WANT_PAST) {
    log(`- 预约:已造过 ${seededBefore} 张(≥ ${WANT_FUTURE + WANT_PAST}),幂等跳过`)
  } else {
    for (const b of plan(1, 15, WANT_FUTURE)) {
      try { await POST('/admin/bookings/direct', { ...b, notes: NOTE_TAG }); madeF += 1 } catch (e) { skipped += 1; if (skipped <= 3) log(`  · 跳过一张(${e.message.slice(0, 90)})`) }
    }
    for (const b of plan(-1, -32, WANT_PAST)) {
      try { await POST('/admin/bookings/direct', { ...b, backfill: true, notes: `${NOTE_TAG} · 历史` }); madeP += 1 } catch (e) { skipped += 1; if (skipped <= 6) log(`  · 跳过一张(${e.message.slice(0, 90)})`) }
    }
    log(`- 预约:未来 ${madeF} 张 · 历史 ${madeP} 张(跳过 ${skipped})`)
  }

  // ── 13. 自证:三店口径两两不等 + 本店读回 ────────────────────
  const clock = await T('/admin/store-clock')
  log(`\n自证:`)
  log(`  本店时钟 ${clock.today} ${clock.localTime} · ${clock.timezone} · ${clock.currency}`)
  const kb = await T('/admin/kb')
  const kbf = kb.liveFacts || kb.facts || {}
  log(`  知识事实 brandName=${kbf.brandName || '(未读到)'} · storeAddress=${kbf.storeAddress || '(未读到)'}`)
  const total = ((await T('/admin/bookings')).bookings || []).filter((b) => String(b.notes || '').startsWith('北京店造景')).length
  log(`  造景预约累计 ${total} 张(库里另盖 demo_seed=${SEED_TAG},一条 WHERE demo_seed IS NOT NULL 能整批认出来)`)

  reportTarget('跑完', dbPath, before)

  if (credentials) {
    log(`\n★ 老板账号已创建:用户名 ${credentials.username}`)
    log(`  初始密码**不打印在这里** —— 见下面一行提示,由跑脚本的人自行记进 handoff/本地自查账号.txt。`)
    log(`  SEED_PRINT_PASSWORD=1 时才回显(默认不回显,避免进终端记录/回执)。`)
    if (process.env.SEED_PRINT_PASSWORD === '1') log(`  初始密码 ${credentials.initialPassword}`)
    log(`  首次登录强制改密 —— 脚本不代改老板密码(《脚本红线①》)。`)
  }
  log(`\n✅ ${TENANT_NAME} 造景完成(可重复执行)`)
}

main().catch((error) => {
  console.error(`\n✗ 造景失败: ${error.message}`)
  process.exit(1)
})
