
// ===== 联调开关(店主用)=====
// true  = 连你 Mac 本地沙盘(模拟数据,随便测,不影响线上;开发者工具模拟器用 127.0.0.1 即可)
// false = 连线上生产(www.luckyluxeatelier.com,真实数据)
// ⚠️ 正式上传/发布前,务必把这里改回 false!
const USE_LOCAL_SANDBOX = true // 2026-08-04 演示结束,切回本地沙盘继续开发(上传/发布前务必改回 false)
// 本地沙盘地址:127.0.0.1 走开发者工具本机代理,模拟器与真机调试通用,换网络也不用改。
// 真机预览/体验版连本地沙盘:用电脑局域网 IP(手机与电脑须同一 WiFi);开发者工具上两者皆可。此行临时改动,不提交。
const LOCAL_API = 'http://127.0.0.1:4128' // 开发者工具模拟器用这个;真机调试改成电脑当前局域网 IP(2026-08-03 查询为 192.168.0.104,IP 会变,连不上先重查)
const API_BASE = USE_LOCAL_SANDBOX ? LOCAL_API : 'https://www.luckyluxeatelier.com'
const DEMO_USER_ID = 'user-demo'
/* 🔴 D19(店主 2026-08-11 拍板,《财务总逻辑》v1.5.1):storeId 必须来自当前门店上下文。
   以前这里写死 `const STORE_ID = 'store-ontario-01'`(旗舰店)——非旗舰商家的顾客
   技师列表永远为空、可约时段直接 404,**下单还会把预约写到旗舰店名下**(顾客端方向的
   租户串味)。现在 storeId 由 /stores 随租户下发并按租户缓存;取不到就如实抛错(D17 路线),
   不设兜底常量。 */
function storeIdKey() { return `lucky_store_id::${currentTenant()}` }
function cacheStoreId(stores) {
  const id = stores && stores[0] && stores[0].id
  if (id) wx.setStorageSync(storeIdKey(), id)
  return id || ''
}
async function activeStoreId() {
  const cached = wx.getStorageSync(storeIdKey())
  if (cached) return cached
  const data = await request('/stores')
  wx.setStorageSync('lucky_store_ai', data.aiEnabled === true)
  const id = cacheStoreId(data.stores)
  if (!id) throw new Error('取不到本店门店信息')
  return id
}
const AUTH_KEY = 'lucky_mini_auth'
const ADMIN_AUTH_KEY = 'lucky_admin_auth'
/* F3 收敛(店主 2026-08-12 拍板②):等级梯子单源=后端下发 user.memberTiers(租户配置推导)。
   本地梯子副本已删——四份实现之一;顾客看到的等级只能来自后端,前端不再自算。 */

const localImageMap = {
  '/assets/images/nail-french.png': '/assets/images/nail-french.jpg',
  '/assets/images/nail-luxe.png': '/assets/images/nail-luxe.jpg',
  '/assets/images/nail-jp.png': '/assets/images/nail-jp.jpg',
  '/assets/images/nail-care.png': '/assets/images/nail-care.jpg',
  '/assets/images/nail-addon.png': '/assets/images/nail-addon.jpg',
  '/assets/images/lash-natural.png': '/assets/images/lash-natural.jpg',
  '/assets/images/lash-volume.png': '/assets/images/lash-volume.jpg',
  '/assets/images/lash-lower.png': '/assets/images/lash-lower.jpg',
  '/assets/images/lash-remove.png': '/assets/images/lash-remove.jpg',
  '/assets/images/store-cover.png': '/assets/images/store-cover.jpg',
  '/assets/images/member-profile.png': '/assets/images/member-profile.jpg'
}

/* 🔴 D17(店主 2026-08-11 拍板):顾客端接口失败**绝不回 mock**。
   这是 08-04「假报价」的同类第二次 —— 接口一挂就回写死的演示数据,
   顾客看到的是一整套不存在的服务/门店/技师/可约时段,还能照着约进去,
   界面上没有任何"这是假的"痕迹。现在一律如实抛错,由页面渲染失败态。 */

function normalizeImage(url) {
  if (!url) return '/assets/images/store-cover.jpg'
  if (localImageMap[url]) return localImageMap[url]
  if (url.indexOf('/assets/images/') === 0) return localImageMap[url] || url
  return url
}

function getAuth() {
  return wx.getStorageSync(AUTH_KEY) || null
}

function setAuth(auth) {
  wx.setStorageSync(AUTH_KEY, auth)
  return auth
}

function clearAuth() {
  wx.removeStorageSync(AUTH_KEY)
}

function isLoggedIn() {
  const auth = getAuth()
  return Boolean(auth && auth.accessToken && (!auth.expiresAt || Date.now() < auth.expiresAt - 60 * 1000))
}

function getAdminAuth() {
  const auth = wx.getStorageSync(ADMIN_AUTH_KEY) || null
  if (!auth) return null
  // 会话是跟环境绑定的:本地沙盘发的 token 生产不认,反之亦然。
  // 切了 USE_LOCAL_SANDBOX 之后旧 token 还留着,会造成"本地看着已登录、实际每个接口都 401、页面一片空白"。
  if (auth.apiBase && auth.apiBase !== API_BASE) {
    wx.removeStorageSync(ADMIN_AUTH_KEY)
    return null
  }
  return auth
}

function setAdminAuth(auth) {
  wx.setStorageSync(ADMIN_AUTH_KEY, Object.assign({}, auth, { apiBase: API_BASE }))
  return auth
}

function clearAdminAuth() {
  wx.removeStorageSync(ADMIN_AUTH_KEY)
}

function currentTenant() {
  return wx.getStorageSync('lucky_tenant') || 'lucky-luxe'
}

/* D39 L2(换店残留机制,第 2 案后全仓清单化):换店时必须清/重取的键统一从这走。
   清:member 快照/币种/定金配置/AI 开关/购物车/本地订单缓存/款式预设(全部 per-store 值挂全局键);
   不清:lucky_lang(用户偏好)/lucky_service_type(通用过滤)/lucky_store_id::<tenant>(键自带租户)/
   商家端会话(商家无换店流,跨店有 D35 闸)。auth 不在这清 —— 打了租户戳,下次取数自动静默重登。 */
function onStoreSwitched() {
  for (const k of ['lucky_member', 'lucky_store_currency', 'lucky_store_deposit', 'lucky_store_ai', 'lucky_cart', 'lucky_orders', 'lucky_style_preset']) {
    try { wx.removeStorageSync(k) } catch (e) { /* 单键清不掉不阻塞换店 */ }
  }
}

// 会话失效时统一弹回登录页。多个接口并行 401 时只跳一次,避免路由打架。
let kickingToLogin = false
function kickToLogin(silent) {
  if (kickingToLogin) return
  kickingToLogin = true
  clearAdminAuth()
  if (!silent) wx.showToast({ title: '登录已过期,请重新登录', icon: 'none' })
  setTimeout(() => {
    wx.reLaunch({
      url: '/pages/merchant-login/index',
      complete: () => { setTimeout(() => { kickingToLogin = false }, 800) }
    })
  }, silent ? 0 : 500)
}

function request(path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    const auth = getAuth()
    const header = { 'content-type': 'application/json', 'x-tenant-id': currentTenant() }
    if (auth && auth.accessToken) header.authorization = `Bearer ${auth.accessToken}`
    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(res.data && res.data.error ? res.data.error : new Error('API request failed'))
      },
      fail: reject
    })
  })
}

function adminRequest(path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    const auth = getAdminAuth()
    const header = { 'content-type': 'application/json' }
    if (auth && auth.accessToken) header.authorization = `Bearer ${auth.accessToken}`
    const fk = wx.getStorageSync('lucky_finance_key')
    if (fk) header['x-finance-key'] = fk
    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data)
        // 把 HTTP 状态码带出去:调用方要能区分「没登录/没权限」和「网络不通」
        const err = res.data && res.data.error ? res.data.error : new Error('Admin API request failed')
        try { err.statusCode = res.statusCode } catch (e) { /* 冻结对象忽略 */ }
        // 兜底:任何商家接口 401 都说明这个会话在当前后端不成立(过期、被顶、或换了环境),
        // 一律清会话弹回登录页——页面各自 catch 掉错误就会停在空白页上,这里必须拦住。
        if (res.statusCode === 401) kickToLogin()
        reject(err)
      },
      fail: reject
    })
  })
}

/* R5:门店定金额(元)。读 /stores 缓存下来的配置;没有就回 0,
   宁可不显示,也不拿旗舰店的 50 冒充本店配置。 */
function storeDepositAmount() {
  try {
    const d = wx.getStorageSync('lucky_store_deposit')
    if (d && d.enabled && typeof d.amountCents === 'number') return Math.round(d.amountCents) / 100
  } catch (e) { /* storage 拿不到就当没配 */ }
  return 0
}

function toMiniService(service) {
  return {
    _id: service.id,
    type: service.type,
    category: service.category,
    platformCategory: service.platformCategory,
    name: service.name,
    description: service.description,
    price: service.price,
    // R5:定金额来自门店配置(/stores 下发),拿不到就 0 不显示 —— 不许再写死 50
    depositAmount: storeDepositAmount(),
    duration: service.durationMin,
    suitableFor: service.suitableFor || '',
    imageLabel: `${service.type} · ${service.category}`,
    image: normalizeImage(service.imageUrl),
    process: service.process || [],
    notice: service.notice || [],
    requiresManualQuote: service.requiresManualQuote,
    pricingType: service.pricingType,
    priceLabelZh: service.priceLabelZh,
    priceLabelEn: service.priceLabelEn,
    // S1:列表「¥xxx 起」独立字段(详情/AI 报价 label 不动)
    priceFromLabelZh: service.priceFromLabelZh,
    priceFromLabelEn: service.priceFromLabelEn,
    quoteHintZh: service.quoteHintZh,
    quoteHintEn: service.quoteHintEn,
    priceExplanationZh: service.priceExplanationZh,
    priceExplanationEn: service.priceExplanationEn,
    isRecommended: service.sortOrder <= 3,
    sort: service.sortOrder,
    status: service.isActive ? 'active' : 'hidden'
  }
}

function toMiniStore(store) {
  return {
    id: store.id || '',   // D19:不再用写死的旗舰店 id 兜底
    storeName: store.name || store.storeName || 'Lucky Luxe Ontario',
    address: store.address || '门店地址待补充',
    phone: store.phone || '门店电话待补充',
    businessHours: store.businessHours || store.business_hours || 'Tue-Sun 10:00-19:00',
    hours: store.hours || [],
    timezone: store.timezone || 'America/Toronto',
    latitude: store.latitude,
    longitude: store.longitude,
    description: store.description || 'Lucky Luxe nail and lash atelier.'
  }
}

function toMiniBooking(booking) {
  const service = booking.service ? toMiniService(booking.service) : {}
  const statusMap = {
    PENDING_PAYMENT: 'pending_payment',
    CONFIRMED: 'pending_service',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    AFTER_SALES: 'after_sales'
  }
  return {
    _id: booking.id,
    orderNo: booking.publicCode,
    serviceInfo: {
      serviceId: service._id,
      serviceName: service.name,
      serviceType: service.type,
      duration: booking.totalDurationMin || service.duration,
      depositAmount: booking.deposit || storeDepositAmount(),
      technicianName: booking.technician ? booking.technician.name : ''
    },
    service,
    appointment: {
      date: booking.appointmentDate,
      time: booking.appointmentTime,
      remark: booking.notes || ''
    },
    store: toMiniStore(booking.store || {}),
    referenceImages: (booking.referenceImages || []).map(normalizeImage),
    workImages: (booking.approvedWorkImages || booking.workImages || []).map(normalizeImage),
    galleryStatus: booking.galleryStatus,
    couponDiscount: 0,
    balanceDeduction: 0,
    /* D32(4500 同族·假数回落):原来 booking.deposit 为 0 就回落店配定金额还标「已付」。
       现在真相直出:depositState/depositCents/payment(已签快照分解)由后端下发,前端零运算。 */
    depositState: booking.depositState || 'none',
    depositCents: booking.depositCents || 0,
    payment: booking.payment || null,
    payableAmount: booking.depositCents ? Math.round(booking.depositCents / 100) : 0,
    finalDue: booking.finalDue || 0,
    servicePrice: booking.servicePrice || service.price || 0,
    status: statusMap[booking.status] || 'pending_service',
    paymentStatus: booking.status === 'PENDING_PAYMENT' ? 'pending' : 'paid',
    backendBookingId: booking.id,
    /* 屏 D2/D3(2026-08-10 核验轮修复):这个映射是**白名单**,后端 customerOrderBadges()
       下发的徽标三态 / 副行 / 实际应付 / 售后三步在这一层被整片丢掉了 ——
       后端断言全绿,页面上一个徽标也不出、售后进度卡整块不渲染。原样透传,前端仍零计算。 */
    listBadgeText: booking.listBadgeText || '',
    listBadgeKind: booking.listBadgeKind || '',
    listNote: booking.listNote || '',
    actualDueText: booking.actualDueText || '',
    listAmountText: booking.listAmountText || '',
    actualDueCents: booking.actualDueCents === undefined ? null : booking.actualDueCents,
    settlementCode: booking.settlementCode || '',
    afterSales: booking.afterSales || null,
    createdAt: booking.createdAt || Date.now()
  }
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res.code) resolve(res.code)
        else reject(new Error('微信登录失败'))
      },
      fail: reject
    })
  })
}

function authRequiredError() {
  const error = new Error('请先登录后再继续')
  error.code = 'AUTH_REQUIRED'
  return error
}

/* 🔴 D39(店主 2026-08-12 末验,数据随店走红线):顾客 token 是按「出生店」的用户行签的
   (会员=用户×店,同一个微信身份在每家店是独立档案)。换店后旧 token 会把上家店的身份带进本店:
   「我的」页头部(累计消费/等级/积分)全是上家店的,而 /my/* 明细按新店查=全空。
   修法:auth 打租户戳;租户不匹配=对本店而言未登录 → wx.login 静默重登(顾客无感);
   重登失败如实清会话,绝不拿上家店身份凑数。 */
async function loginForCurrentStore(options = {}) {
  const code = await wxLoginCode()
  const data = await request('/auth/wechat/mini-login', 'POST', {
    code,
    // 本地沙盘:走服务器演示登录旁路(无需真实微信授权即可演示登录后页面)。
    // 上线前 USE_LOCAL_SANDBOX 置回 false 后此标记自动为 false,走真实微信登录。
    demoLogin: USE_LOCAL_SANDBOX,
    tenantId: currentTenant(),
    displayName: options.displayName || '',
    avatarUrl: options.avatarUrl || '',
    phoneCode: options.phoneCode || '',
    phone: options.phone || ''
  })
  setAuth(Object.assign({}, data.auth, { user: data.user, tenantId: currentTenant() }))
  wx.setStorageSync('lucky_member', Object.assign(miniMember(data.user), { _tenant: currentTenant() }))
  return data.user
}

async function ensureLogin(options = {}) {
  const existing = getAuth()
  const fresh = Boolean(existing && existing.accessToken && (!existing.expiresAt || Date.now() < existing.expiresAt - 60 * 1000))
  const sameStore = Boolean(existing && existing.tenantId === currentTenant())  // 旧会话无租户戳=按不匹配处理,静默重登一次后就有戳了
  if (fresh && sameStore) return existing.user
  if (fresh && !sameStore) {
    try { return await loginForCurrentStore(options) } catch (e) {
      clearAuth()
      wx.removeStorageSync('lucky_member')
      if (!options.interactive) throw authRequiredError()
      throw e
    }
  }
  if (!options.interactive) throw authRequiredError()
  return loginForCurrentStore(options)
}

// 供 /my/* 出口在请求前自愈:换店后 token 不属于本店 → 先静默重登再取数
async function ensureStoreScopedAuth() {
  const a = getAuth()
  if (a && a.accessToken && a.tenantId !== currentTenant()) await ensureLogin({ interactive: false })
}

async function loginWithWechat(profile = {}) {
  return ensureLogin({
    interactive: true,
    displayName: profile.nickname || profile.displayName || '',
    avatarUrl: profile.avatarUrl || '',
    phoneCode: profile.phoneCode || '',
    phone: profile.phone || ''
  })
}

function miniMember(user = {}) {
  const displayName = String(user.displayName || '').trim()
  const memberCode = user.memberCode || (displayName && displayName.indexOf('LL-') === 0 ? displayName : '登录后生成')
  const isGenericName = !displayName || displayName === 'Lucky Member' || displayName === '微信用户' || displayName === 'WeChat User' || displayName === memberCode
  const hasRealName = Boolean(!isGenericName)
  const profileComplete = user.profileComplete === undefined ? Boolean(hasRealName || user.avatarUrl) : Boolean(user.profileComplete)
  const hasRealStats = user.hasRealStats === undefined ? Boolean(user.id) : Boolean(user.hasRealStats)
  // 等级信息全部以后端为准(租户单源);后端没给的字段一律中性回落,不再用本地梯子补
  const tiers = Array.isArray(user.memberTiers) ? user.memberTiers : []
  const tierKey = String(user.memberTier || '').toLowerCase() || 'member'
  const tierIndex = tiers.findIndex((item) => item.key === tierKey)
  const tier = tierIndex >= 0 ? tiers[tierIndex] : null
  const nextTier = tierIndex >= 0 ? (tiers[tierIndex + 1] || null) : null
  const growthValue = hasRealStats ? (user.growthValue || 0) : 0
  const nextLevelValue = user.nextLevelValue || (tier && tier.nextSpend) || growthValue
  const profileDisplayName = isGenericName ? (user.id || memberCode || '微信用户') : displayName
  return {
    nickname: profileDisplayName,
    profileComplete,
    memberLevel: user.memberLevel || (tier ? tier.label : '顾客'), // D41:兜底不再默认「会员」
    memberTier: tierKey,
    nextMemberLevel: user.nextMemberLevel || (nextTier ? nextTier.label : ''),
    currentLevelValue: user.currentLevelValue || (tier ? tier.minSpend : 0),
    amountToNextLevel: user.amountToNextLevel === undefined
      ? (nextTier ? Math.max(0, nextTier.minSpend - growthValue) : 0)
      : user.amountToNextLevel,
    memberTiers: tiers,
    memberPerks: user.memberPerks || [],
    tiersEnabled: user.membershipTiersEnabled === undefined ? true : Boolean(user.membershipTiersEnabled),
    depositWaived: Boolean(user.depositWaived),
    depositRule: user.depositRule || '',
    growthValue,
    nextLevelValue,
    points: hasRealStats ? (user.points || 0) : 0,
    couponCount: hasRealStats ? (user.couponCount || 0) : 0,
    balance: hasRealStats ? Math.round((user.balanceCents || 0) / 100) : 0,
    totalSpent: hasRealStats ? Math.round((user.totalSpentCents || 0) / 100) : 0,
    visits: hasRealStats ? (user.visits || 0) : 0,
    memberCode,
    referralCode: user.referralCode || '',
    referralUrl: user.referralUrl || '',
    avatarUrl: user.avatarUrl || '/assets/images/member-profile.jpg'
  }
}

/* D17 家族终章(S组卫生批 2026-08-12):加项解析从 mock 表改**真目录**。
   旧实现按 id 查写死的 mock.addOns——服务端下发的真加项 id 在 mock 表里查不到,
   会被 filter 静默丢掉:可用时段少算加项时长、下单载荷丢加项。真目录带 60s 缓存。 */
let _addOnCatalog = null
let _addOnCatalogAt = 0
async function selectedAddOns(ids) {
  if (!ids || !ids.length) return []
  if (!_addOnCatalog || Date.now() - _addOnCatalogAt > 60000) {
    _addOnCatalog = await getAddOns()
    _addOnCatalogAt = Date.now()
  }
  return ids.map((id) => {
    const item = _addOnCatalog.find((a) => a.id === id)
    return item ? { id: item.id, name: item.name, priceCents: item.priceCents, durationMin: item.durationMin || 0 } : null
  }).filter(Boolean)
}

async function getServices(type, lang) {
  try {
    const data = await request(`/services?type=${type}&lang=${lang}`)
    return data.services.map(toMiniService)
  } catch (error) {
    throw error
  }
}

/* v1.4 大类改造:服务 Tab 一次拉全量+平台大类字典(左栏=大类,空类不显示,与网页同构)。 */
async function getServiceCatalog(lang) {
  const data = await request(`/services?lang=${lang}`)
  return {
    services: (data.services || []).map(toMiniService),
    platformCategories: data.platformCategories || []
  }
}

// 门店是否开通 AI 智能包。顾客端据此隐藏 AI 入口(未知时按"没有"处理,宁可少显示一个按钮,
// 也不要让顾客点了一个没有结果的 AI)。由 /stores 顺带下发,不额外发请求。
function getStoreAiEnabled() { return wx.getStorageSync('lucky_store_ai') === true }

async function getStores() {
  try {
    const data = await request('/stores')
    wx.setStorageSync('lucky_store_ai', data.aiEnabled === true)
    return (data.stores || []).map(toMiniStore)
  } catch (error) {
    throw error
  }
}

/* 门店币种(2026-08-10 核验轮修复)。
   getStores() 返回的是**门店数组**,顶层的 currency / currencyDisplay 在那一步就被丢了 ——
   storecurrency.js 拿到数组去读 .currencyDisplay 永远是 undefined,缓存一次都写不进去,
   顾客端 32 处 {{cur.p}}{{cur.s}} 全渲染成空币符(只有后端拼好的价格串才带得出币符)。
   这里单独把原始字段取回来,不经过 toMiniStore。 */
async function getStoreCurrency() {
  const data = await request('/stores')
  // R5:定金配置跟币种同一趟取回来,顾客端不再自己编默认 50
  return { currency: data.currency || '', currencyDisplay: data.currencyDisplay || null, deposit: data.deposit || null }
}

async function getAddOns() {
  try {
    const data = await request('/add-ons')
    return (data.addOns || []).map((item) => ({
      id: item.id,
      name: item.name,
      price: Math.round(item.priceCents / 100),
      priceCents: item.priceCents,
      durationMin: item.durationMin
    }))
  } catch (error) {
    throw error
  }
}

// 方案B作品墙:平铺作品+品类(旧 getPortfolio 保留给仍按技师分组的调用方)
async function getPortfolioWall() {
  try {
    const data = await request('/portfolio')
    return {
      works: data.works || [],
      categories: data.categories || []
    }
  } catch (error) {
    return { works: [], categories: [] }
  }
}

async function getPortfolio() {
  try {
    const data = await request('/portfolio')
    if (data.portfolios && data.portfolios.length) {
      return data.portfolios.map((item) => ({
        technician: item.technician,
        images: (item.images || []).map(normalizeImage)
      }))
    }
  } catch (error) {
    // Use fallback below.
  }
  // D17(自纠:上一轮误分到 ⚪):这是**编造的作品图**,会端给顾客 —— 同样不许回 mock
  throw new Error('作品墙加载失败')
}

async function getService(id, lang) {
  const type = id.indexOf('lash') === 0 ? 'lash' : 'nail'
  const services = await getServices(type, lang)
  /* 🔴 D17 同类(2026-08-11 L2 补扫,第六处 mock 回落):原来 `|| mock.findService(id)` ——
     本店真价目表里没有这个项目时,就从写死的演示表里翻一个**编造的项目连价格**给顾客,
     顾客还能拿它去预约。真找不到就返回 null,调用方已有「项目不存在」的处理。 */
  return services.find((item) => item._id === id) || null
}

async function getAvailability(serviceId, date, addOnIds, technicianId) {
  const extraDurationMin = (await selectedAddOns(addOnIds)).reduce((total, item) => total + item.durationMin, 0)
  try {
    const techQuery = technicianId ? `&technicianId=${technicianId}` : ''
    const storeId = await activeStoreId()   // D19:当前门店上下文,不写死
    const data = await request(`/availability?storeId=${storeId}&serviceId=${serviceId}&date=${date}&extraDurationMin=${extraDurationMin}${techQuery}`)
    const firstGroup = data.slots && data.slots[0]
    return {
      technician: firstGroup ? firstGroup.technician : null,
      slots: firstGroup ? firstGroup.slots : [],
      durationMin: data.durationMin
    }
  } catch (error) {
    throw error
  }
}

async function getTechnicians(serviceId) {
  try {
    const storeId = await activeStoreId()   // D19:当前门店上下文,不写死
    const data = await request(`/technicians?storeId=${storeId}&serviceId=${serviceId}`)
    return data.technicians || []
  } catch (error) {
    throw error
  }
}

/* 🔴 D21(店主 2026-08-11 拍板):删掉假订单路径。
   以前这里 ①technicianId 兜底写死 'tech-mia' ②后端没回 booking 就自己编一张
   (假技师 Mia Chen + 写死 50 元定金 + 自算尾款)。拍板④预言的「技师里有 Mia Chen
   就是系统在骗人」,源头就是这两行;写死的 5000 还与 R5「定金只来自 /stores 配置」
   直接冲突(本店真实定金 100 元,编出来的是错的一半)。
   现在:预约由后端创建,或如实失败;技师必须真选(booking 页由真技师列表带出)。 */
async function createBooking(cartItem, remark) {
  const user = await ensureLogin()
  const appointment = cartItem.appointmentInfo
  const technicianId = appointment.technicianId || ''
  if (!technicianId) throw new Error('请先选择技师')
  const data = await request('/bookings', 'POST', {
    userId: user.id || DEMO_USER_ID,
    storeId: await activeStoreId(),   // D19:预约归属当前门店,不写死旗舰店
    serviceId: cartItem.serviceId,
    technicianId,
    date: appointment.date,
    time: appointment.time,
    addOns: await selectedAddOns(appointment.addOns),
    referenceImages: appointment.referenceDataImages || appointment.referenceImages || [],
    sourceChannel: appointment.sourceChannel || 'wechat_miniprogram',
    notes: remark || appointment.remark || '',
    bookingDraftId: cartItem.bookingDraftId || appointment.bookingDraftId || cartItem.draftId || ''
  })
  if (!data.booking) throw new Error('预约创建失败，请稍后重试')
  return data.booking
}

async function confirmMockPayment(bookingId) {
  await ensureLogin()
  const data = await request('/payments/mock/confirm', 'POST', { bookingId })
  return data.booking
}

async function getBookings(lang) {
  await ensureLogin()
  const data = await request(`/bookings?lang=${lang || 'zh'}`)
  return (data.bookings || []).map(toMiniBooking)
}

// 2026-08-04 安全修复:这里原来有一段"假分析"回退——请求一失败就返回写死的
// estimatedPriceCents(美甲 $238 / 美睫 $198)+ "已根据参考图生成初步建议"话术,
// 界面上跟真 AI 结果长得一模一样。等于给顾客看一个跟他的图、跟门店价目表都无关的报价,
// 还挂着商家的品牌。已删除:失败就如实抛错,由页面提示顾客走人工报价。
async function analyzeReference(payload) {
  const data = await request('/ai/reference-analysis', 'POST', payload)
  return data.analysis || data
}

async function adminLogin(email, password, remember = true) {
  const data = await adminRequest('/admin/auth/login', 'POST', { email, password, remember })
  const auth = Object.assign({}, data.auth, { admin: data.admin || (data.auth && data.auth.admin) })
  const ttlMs = (data.auth && data.auth.expiresIn ? data.auth.expiresIn : 30 * 86400) * 1000
  auth.expiresAt = Date.now() + ttlMs
  setAdminAuth(auth)
  return auth
}

// 保持登录:本地有未过期的商家会话即视为已登录
function isAdminLoggedIn() {
  const a = getAdminAuth()
  return Boolean(a && a.accessToken && (!a.expiresAt || Date.now() < a.expiresAt - 60 * 1000))
}

async function adminChangePassword(oldPassword, newPassword, confirmPassword) {
  return adminRequest('/admin/auth/change-password', 'POST', { oldPassword, newPassword, confirmPassword })
}

// 通用商家端接口封装:任意 /admin/* GET/POST
// 商家入驻申请(公开,无需登录)
function submitMerchantLead(data) {
  return request('/merchant-leads', 'POST', data)
}

// 公开门店列表(兜底进店)
// includeDemo=true 时返回演示门店(店主在选店页开「演示模式」才会传;顾客永远看不到)
function getShops(includeDemo) {
  return request(includeDemo ? '/shops?include=demo' : '/shops')
}

// AI 客服(按当前店回答;登录时自动带顾客身份与订单上下文)
function aiCustomerService(message, history) {
  return request('/ai/customer-service', 'POST', { message, lang: 'zh', history: history || [] })
}

// 我的资产(user × 当前店)
// 顾客端预约确认页(屏 3)读本店定金规则。公开接口,不需要登录。
function getDepositPolicy(qs) { return request(`/store/deposit-policy${qs ? `?${qs}` : ''}`) }
function getMyCoupons() { return request('/my/coupons') }
function getMyStoredValue() { return request('/my/stored-value') }
/* D33 余额单源(2026-08-12):顾客端可见余额一律实时取后端 /my/stored-value,
   不再读 lucky_member.balance 缓存(旧演示残留 4500 事件)。返回 {cents, yuan}。 */
async function myBalance() {
  try { await ensureStoreScopedAuth() } catch (e) { /* 未登录时照常请求,由服务端 401 */ }
  const r = await request('/my/stored-value')
  const cents = (r && r.balanceCents) || 0
  return { cents, yuan: Math.round(cents / 100) }
}
/* 沙盒切换演示身份(补强批):名册+按人登录。服务端 ALLOW_DEMO 闸门,生产 404。 */
function getSandboxRoster() { return request('/sandbox/demo-roster') }
async function sandboxLoginAs(userId) {
  const data = await request('/auth/wechat/mini-login', 'POST', { demoLogin: true, tenantId: currentTenant(), asUserId: userId })
  setAuth(Object.assign({}, data.auth, { user: data.user, tenantId: currentTenant() }))
  wx.setStorageSync('lucky_member', Object.assign(miniMember(data.user), { _tenant: currentTenant() }))
  return data.user
}
function getMyPointsHistory() { return request('/my/points-history') }
// 积分商城
function getPointsMall() { return request('/my/points-mall') }
function redeemPrize(prizeId) { return request('/my/points-mall/redeem', 'POST', { prizeId }) }

// 按"当前进的店"刷新会员数据(会员=用户×店:积分/储值/等级每店独立,切店后必须刷新)
async function refreshMember() {
  // D39:换店后先把身份换成本店的,再刷会员数据;换不动(未登录/网络断)按原逻辑走
  try { await ensureStoreScopedAuth() } catch (e) { return null }
  const auth = getAuth()
  /* D33 根因之一:登录存的 auth 里可能没有 user.id(mini-login 的 auth 与 user 是并列字段),
     这里一早退,lucky_member 里旧演示时代的 4500 余额缓存就永远洗不掉。
     id 兜底链:auth.user.id → auth.userId → 本机 lucky_member.id。 */
  if (!auth || !auth.accessToken) return null
  const uid = (auth.user && auth.user.id) || auth.userId || (wx.getStorageSync('lucky_member') || {}).id
  if (!uid) return null
  try {
    const data = await request(`/users/${uid}`)
    const fresh = miniMember(data.user)
    const prev = wx.getStorageSync('lucky_member') || {}
    // D40(换店残留第 3 案):昵称/头像/资料完善度这类「档案身份字段」只在**同一家店**内保留;
    // 跨店快照一律以当前店档案为准 —— 快照带租户戳(_tenant)界定归属
    const sameStore = prev._tenant === currentTenant()
    wx.setStorageSync('lucky_member', Object.assign({}, fresh, {
      _tenant: currentTenant(),
      nickname: (sameStore && prev.nickname) || fresh.nickname,
      avatarUrl: (sameStore && prev.avatarUrl) || fresh.avatarUrl,
      profileComplete: (sameStore && prev.profileComplete) || fresh.profileComplete
    }))
    return fresh
  } catch (e) { return null }
}

function adminGet(path) {
  return adminRequest(path)
}
function adminPost(path, data) {
  return adminRequest(path, 'POST', data)
}
function adminPut(path, data) {
  return adminRequest(path, 'PUT', data)
}
function adminPatch(path, data) {
  return adminRequest(path, 'PATCH', data)
}
// 服务小记(P0-②)
function saveServiceNote(data) {
  return adminRequest('/admin/service-notes', 'POST', data)
}
function getCustomerNotes(userId) {
  return adminRequest(`/admin/customers/${encodeURIComponent(userId)}/notes`)
}
// 角色缓存(登录/adminMe 后写入),供页面同步判断
function getCachedRole() { return wx.getStorageSync('lucky_admin_role') || '' }
function isOwner() { return getCachedRole() === 'owner' }
// owner-only 页面守卫:员工进入即弹回。返回 true=放行
// 未登录时跳回商家登录页(而不是把人放进一个没有数据的空白后台)
function goMerchantLogin() {
  kickToLogin(true)
}

// 商家区通用守卫(老板或员工都可):没登录就送回登录页,别让人停在没有数据的空壳页面上。
// 只做本地会话判断,不发请求——放在 onShow 开头零成本。
function guardMerchant() {
  if (isAdminLoggedIn()) return true
  goMerchantLogin()
  return false
}

async function guardOwner() {
  // 2026-08-04 修:原来这里 catch 到任何异常都 return true,401 也照放——
  // 结果没登录也能进商家页,但每个接口都 401,页面一片空白,看起来像"不用密码就能登录"。
  // 现在:本地压根没有有效会话 → 直接去登录页;会话失效(401/403)→ 清掉再去登录;
  // 只有真的断网/超时才沿用旧的"不误伤"策略,放行让页面自己重试。
  if (!isAdminLoggedIn()) { goMerchantLogin(); return false }
  let me = null
  try {
    me = await adminMe()
  } catch (e) {
    const code = e && (e.statusCode || e.code)
    // 401 已由 adminRequest 统一踢回登录页,这里只需要不放行
    if (code === 401 || code === 403 || code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'ACCOUNT_DISABLED') return false
    return true // 断网/超时:不误伤
  }
  if (me && me.role === 'owner') return true
  wx.showToast({ title: '仅老板可用', icon: 'none' })
  setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/merchant/home/index' }) }), 350)
  return false
}

// 财务门禁:解锁后本地存 x-finance-key,后续财务请求自动带上
function getFinanceKey() { return wx.getStorageSync('lucky_finance_key') || '' }
function clearFinanceKey() { wx.removeStorageSync('lucky_finance_key') }
async function financeUnlock(password, confirmPassword) {
  const d = await adminRequest('/admin/finance/unlock', 'POST', { password, confirmPassword })
  if (d && d.financeKey) wx.setStorageSync('lucky_finance_key', d.financeKey)
  return d
}

async function adminMe() {
  const data = await adminRequest('/admin/auth/me')
  if (data && data.admin && data.admin.role) wx.setStorageSync('lucky_admin_role', data.admin.role)
  return data.admin
}

// 商家端「本店有没有 AI 智能包」。小程序原先完全不读权限,所有 AI 按钮无差别显示;
// 现在进商家页时取一次并缓存,页面用 merchantHasAi() 同步判断要不要显示 AI 入口。
async function refreshMerchantAi() {
  try {
    const d = await adminRequest('/admin/tenant/entitlements')
    const on = Boolean(d && d.entitlements && d.entitlements.features
      && d.entitlements.features.ai_customer_service && d.entitlements.features.ai_customer_service.enabled)
    wx.setStorageSync('lucky_merchant_ai', on)
    return on
  } catch (e) { return merchantHasAi() }
}
function merchantHasAi() { return wx.getStorageSync('lucky_merchant_ai') === true }

async function getAdminDashboardData() {
  const [me, bookingsData, techniciansData] = await Promise.all([
    adminMe(),
    adminRequest('/admin/bookings'),
    adminRequest('/admin/technicians')
  ])
  let servicesData = { services: [] }
  let customersData = { customers: [] }
  if (me.role === 'owner') {
    const ownerData = await Promise.all([
      adminRequest('/admin/services'),
      adminRequest('/admin/customers')
    ])
    servicesData = ownerData[0]
    customersData = ownerData[1]
  }
  return {
    admin: me,
    bookings: bookingsData.bookings || [],
    technicians: techniciansData.technicians || [],
    services: servicesData.services || [],
    customers: customersData.customers || []
  }
}

module.exports = {
  API_BASE,
  DEMO_USER_ID,
  SANDBOX: USE_LOCAL_SANDBOX,
  onStoreSwitched,
  getSandboxRoster,
  sandboxLoginAs,
  normalizeImage,
  ensureLogin,
  loginWithWechat,
  isLoggedIn,
  getAuth,
  clearAuth,
  getAdminAuth,
  clearAdminAuth,
  adminLogin,
  adminChangePassword,
  isAdminLoggedIn,
  adminMe,
  submitMerchantLead,
  getShops,
  getServiceCatalog,
  aiCustomerService,
  getDepositPolicy,
  getMyCoupons,
  getMyStoredValue,
  myBalance,
  getMyPointsHistory,
  getPointsMall,
  redeemPrize,
  refreshMember,
  adminGet,
  adminPost,
  adminPut,
  adminPatch,
  saveServiceNote,
  getCustomerNotes,
  adminRequest,
  getCachedRole,
  isOwner,
  guardOwner,
  guardMerchant,
  refreshMerchantAi,
  merchantHasAi,
  financeUnlock,
  getFinanceKey,
  clearFinanceKey,
  getAdminDashboardData,
  miniMember,
  getServices,
  getService,
  getStores,
  getStoreAiEnabled,
  getAddOns,
  getPortfolio,
  getPortfolioWall,
  getTechnicians,
  getAvailability,
  createBooking,
  confirmMockPayment,
  getBookings,
  getStoreCurrency,
  toMiniBooking,   // 导出只为回归断言:这层是白名单,漏字段=页面整块不渲染(见 test-double-sheet)
  analyzeReference
}
