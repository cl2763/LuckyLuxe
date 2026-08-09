const mock = require('./mock-data')

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
const STORE_ID = 'store-ontario-01'
const AUTH_KEY = 'lucky_mini_auth'
const ADMIN_AUTH_KEY = 'lucky_admin_auth'
const MEMBER_TIERS = [
  { key: 'silver', label: 'Silver Member', minSpend: 0, nextSpend: 500, depositWaived: false },
  { key: 'gold', label: 'Gold Member', minSpend: 500, nextSpend: 1200, depositWaived: true },
  { key: 'platinum', label: 'Platinum Member', minSpend: 1200, nextSpend: 2500, depositWaived: true },
  { key: 'diamond', label: 'Diamond Member', minSpend: 2500, nextSpend: null, depositWaived: true }
]

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

function toMiniService(service) {
  return {
    _id: service.id,
    type: service.type,
    category: service.category,
    name: service.name,
    description: service.description,
    price: service.price,
    depositAmount: 50,
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
    id: store.id || STORE_ID,
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
      depositAmount: booking.deposit || 50,
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
    payableAmount: booking.deposit || 50,
    finalDue: booking.finalDue || 0,
    servicePrice: booking.servicePrice || service.price || 0,
    status: statusMap[booking.status] || 'pending_service',
    paymentStatus: booking.status === 'PENDING_PAYMENT' ? 'pending' : 'paid',
    backendBookingId: booking.id,
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

async function ensureLogin(options = {}) {
  const existing = getAuth()
  if (existing && existing.accessToken && (!existing.expiresAt || Date.now() < existing.expiresAt - 60 * 1000)) {
    return existing.user
  }
  if (!options.interactive) throw authRequiredError()
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
  setAuth(Object.assign({}, data.auth, { user: data.user }))
  wx.setStorageSync('lucky_member', miniMember(data.user))
  return data.user
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
  const tierKey = String(user.memberTier || '').toLowerCase() || 'silver'
  const tierIndex = Math.max(0, MEMBER_TIERS.findIndex((item) => item.key === tierKey))
  const tier = MEMBER_TIERS[tierIndex]
  const nextTier = MEMBER_TIERS[tierIndex + 1] || null
  const growthValue = hasRealStats ? (user.growthValue || 0) : 0
  const nextLevelValue = user.nextLevelValue || tier.nextSpend || growthValue
  const profileDisplayName = isGenericName ? (user.id || memberCode || '微信用户') : displayName
  return {
    nickname: profileDisplayName,
    profileComplete,
    memberLevel: user.memberLevel || tier.label,
    memberTier: tier.key,
    nextMemberLevel: user.nextMemberLevel || (nextTier ? nextTier.label : ''),
    currentLevelValue: user.currentLevelValue || tier.minSpend,
    amountToNextLevel: user.amountToNextLevel === undefined
      ? (nextTier ? Math.max(0, nextTier.minSpend - growthValue) : 0)
      : user.amountToNextLevel,
    memberTiers: user.memberTiers || MEMBER_TIERS,
    depositWaived: user.depositWaived === undefined ? tier.depositWaived : Boolean(user.depositWaived),
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

function addOnById(id) {
  return mock.addOns.find((item) => item.id === id)
}

function selectedAddOns(ids) {
  return (ids || []).map((id) => {
    const item = addOnById(id)
    return item ? {
      id: item.id,
      name: item.name,
      priceCents: item.price * 100,
      durationMin: item.id === 'reinforce' ? 15 : item.id === 'senior' ? 0 : 30
    } : null
  }).filter(Boolean)
}

async function getServices(type, lang) {
  try {
    const data = await request(`/services?type=${type}&lang=${lang}`)
    return data.services.map(toMiniService)
  } catch (error) {
    return mock.services.filter((item) => item.type === type)
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
    return [mock.store]
  }
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
    return mock.addOns
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
  return mock.portfolios
}

async function getService(id, lang) {
  const type = id.indexOf('lash') === 0 ? 'lash' : 'nail'
  const services = await getServices(type, lang)
  return services.find((item) => item._id === id) || mock.findService(id)
}

async function getAvailability(serviceId, date, addOnIds, technicianId) {
  const extraDurationMin = selectedAddOns(addOnIds).reduce((total, item) => total + item.durationMin, 0)
  try {
    const techQuery = technicianId ? `&technicianId=${technicianId}` : ''
    const data = await request(`/availability?storeId=${STORE_ID}&serviceId=${serviceId}&date=${date}&extraDurationMin=${extraDurationMin}${techQuery}`)
    const firstGroup = data.slots && data.slots[0]
    return {
      technician: firstGroup ? firstGroup.technician : null,
      slots: firstGroup ? firstGroup.slots : [],
      durationMin: data.durationMin
    }
  } catch (error) {
    return { technician: { id: 'tech-mia', name: 'Mia Chen' }, slots: mock.timeSlots, durationMin: 120 }
  }
}

async function getTechnicians(serviceId) {
  try {
    const data = await request(`/technicians?storeId=${STORE_ID}&serviceId=${serviceId}`)
    return data.technicians || []
  } catch (error) {
    return [
      { id: 'tech-mia', name: 'Mia Chen', title: 'Natural Lash / Soft Volume' },
      { id: 'tech-lina', name: 'Lina Zhou', title: 'French / Japanese Shimmer' },
      { id: 'tech-ava', name: 'Ava Lin', title: 'Care / Daily Maintenance' }
    ]
  }
}

async function createBooking(cartItem, remark) {
  const user = await ensureLogin()
  const service = cartItem.service
  const appointment = cartItem.appointmentInfo
  const technicianId = appointment.technicianId || 'tech-mia'
  const data = await request('/bookings', 'POST', {
    userId: user.id || DEMO_USER_ID,
    storeId: STORE_ID,
    serviceId: cartItem.serviceId,
    technicianId,
    date: appointment.date,
    time: appointment.time,
    addOns: selectedAddOns(appointment.addOns),
    referenceImages: appointment.referenceDataImages || appointment.referenceImages || [],
    sourceChannel: appointment.sourceChannel || 'wechat_miniprogram',
    notes: remark || appointment.remark || '',
    bookingDraftId: cartItem.bookingDraftId || appointment.bookingDraftId || cartItem.draftId || ''
  })
  return data.booking || {
    service,
    technician: { id: technicianId, name: appointment.technicianName || 'Mia Chen' },
    depositCents: 5000,
    finalDueCents: Math.max(0, service.price * 100 - 5000)
  }
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
function getMyPointsHistory() { return request('/my/points-history') }
// 积分商城
function getPointsMall() { return request('/my/points-mall') }
function redeemPrize(prizeId) { return request('/my/points-mall/redeem', 'POST', { prizeId }) }

// 按"当前进的店"刷新会员数据(会员=用户×店:积分/储值/等级每店独立,切店后必须刷新)
async function refreshMember() {
  const auth = getAuth()
  if (!auth || !auth.accessToken || !auth.user || !auth.user.id) return null
  try {
    const data = await request(`/users/${auth.user.id}`)
    const fresh = miniMember(data.user)
    const prev = wx.getStorageSync('lucky_member') || {}
    // 头像/昵称/资料完善度是本机资料,保留;数字类(积分/储值/等级/消费)以当前店为准
    wx.setStorageSync('lucky_member', Object.assign({}, fresh, {
      nickname: prev.nickname || fresh.nickname,
      avatarUrl: prev.avatarUrl || fresh.avatarUrl,
      profileComplete: prev.profileComplete || fresh.profileComplete
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
  STORE_ID,
  MEMBER_TIERS,
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
  aiCustomerService,
  getDepositPolicy,
  getMyCoupons,
  getMyStoredValue,
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
  analyzeReference
}
