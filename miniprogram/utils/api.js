const mock = require('./mock-data')

// ===== 联调开关(店主用)=====
// true  = 连你 Mac 本地沙盘(模拟数据,随便测,不影响线上;开发者工具模拟器用 127.0.0.1 即可)
// false = 连线上生产(www.luckyluxeatelier.com,真实数据)
// ⚠️ 正式上传/发布前,务必把这里改回 false!
const USE_LOCAL_SANDBOX = true
const API_BASE = USE_LOCAL_SANDBOX ? 'http://127.0.0.1:4128' : 'https://www.luckyluxeatelier.com'
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
  return wx.getStorageSync(ADMIN_AUTH_KEY) || null
}

function setAdminAuth(auth) {
  wx.setStorageSync(ADMIN_AUTH_KEY, auth)
  return auth
}

function clearAdminAuth() {
  wx.removeStorageSync(ADMIN_AUTH_KEY)
}

function request(path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    const auth = getAuth()
    const header = { 'content-type': 'application/json' }
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
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(res.data && res.data.error ? res.data.error : new Error('Admin API request failed'))
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

async function getStores() {
  try {
    const data = await request('/stores')
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

async function analyzeReference(payload) {
  try {
    const data = await request('/ai/reference-analysis', 'POST', payload)
    return data.analysis || data
  } catch (error) {
    const isNail = String(payload && payload.serviceId || '').indexOf('nail') === 0
    const hasImages = payload && ((payload.images && payload.images.length) || payload.image)
    return {
      provider: 'mini-fallback',
      data: {
        complexity: isNail ? 'medium' : 'standard',
        estimatedExtraMinutes: isNail ? 30 : 0,
        estimatedPriceCents: isNail ? 23800 : 19800,
        manualQuoteRequired: isNail,
        detectedElements: isNail
          ? ['参考图已收到', '可能包含延长/款式细节', '最终报价需技师确认']
          : ['参考图已收到', '美睫款式可按固定价格预约'],
        clientMessageZh: hasImages
          ? (isNail
            ? '已根据参考图生成初步建议：此类款式可能涉及延长、饰品或细节绘制，系统先给出基础价格区间，最终美甲报价需要技师人工确认。'
            : '已收到参考图。美睫项目为固定价，若无特殊卸睫或修补需求，可按当前服务价格预约。')
          : '请先上传参考图后再进行分析。',
        clientMessageEn: hasImages
          ? (isNail
            ? 'Reference image received. This style may include extensions, charms, or detailed art. The system can estimate a base range, but the final nail quote requires technician confirmation.'
            : 'Reference image received. Lash services use fixed pricing unless removal or repair is needed.')
          : 'Please upload a reference image first.',
        priceMessageZh: isNail ? '详细价格请联系客服获取报价' : '美睫为固定服务价',
        priceMessageEn: isNail ? 'Please contact us for a confirmed quote' : 'Fixed lash service price',
        technicianNotesZh: isNail ? '请技师确认延长、卸甲、断甲修补、饰品和复杂度。' : '请确认是否需要卸睫或调整款式。',
        technicianNotesEn: isNail ? 'Technician should confirm extension, removal, repair, charms, and complexity.' : 'Please confirm if lash removal or style adjustment is needed.'
      }
    }
  }
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
function adminGet(path) {
  return adminRequest(path)
}
function adminPost(path, data) {
  return adminRequest(path, 'POST', data)
}
function adminPatch(path, data) {
  return adminRequest(path, 'PATCH', data)
}
// 角色缓存(登录/adminMe 后写入),供页面同步判断
function getCachedRole() { return wx.getStorageSync('lucky_admin_role') || '' }
function isOwner() { return getCachedRole() === 'owner' }
// owner-only 页面守卫:员工进入即弹回。返回 true=放行
async function guardOwner() {
  try { const m = await adminMe(); if (m && m.role === 'owner') return true } catch (e) { /* 网络异常时不误伤,继续 */ return true }
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
  adminGet,
  adminPost,
  adminPatch,
  adminRequest,
  getCachedRole,
  isOwner,
  guardOwner,
  financeUnlock,
  getFinanceKey,
  clearFinanceKey,
  getAdminDashboardData,
  miniMember,
  getServices,
  getService,
  getStores,
  getAddOns,
  getPortfolio,
  getTechnicians,
  getAvailability,
  createBooking,
  confirmMockPayment,
  getBookings,
  analyzeReference
}
