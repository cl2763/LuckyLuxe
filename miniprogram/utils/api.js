const USE_LOCAL_SANDBOX = false // 正式提审构建
const { realValue } = require('./placeholder-words.js')   // 11j 判据 A:占位词表两端同源(见该文件抬头)
const publicCatalogCache = require('./public-catalog-cache')
const requestLoading = require('./request-loading')
const beginRequestLoading = () => typeof requestLoading.begin === 'function' ? requestLoading.begin() : (() => {})

const devhost = require('./devhost')
const deploy = require('./deploy')
const LOCAL_PORT = devhost.port || 4310
const LOCAL_LOOPBACK = `http://127.0.0.1:${LOCAL_PORT}`
function isDevtools() {
  try {
    const info = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()) || {}
    return String(info.platform || '').toLowerCase() === 'devtools'
  } catch (e) { return false }   // 拿不到就按真机走(真机连回环必死,回环连不上还能报错自证)
}
const LOCAL_API = isDevtools() ? LOCAL_LOOPBACK : `http://${devhost.lanHost}:${LOCAL_PORT}`

const API_BASE = USE_LOCAL_SANDBOX ? LOCAL_API : 'https://api.jingshengyouji.com'

const EXPERIENCE = /\/experience$/.test(API_BASE)
const EXPERIENCE_TENANTS = ['demo-ai', 'demo-basic', 'demo-empty']
const DEMO_USER_ID = 'user-demo'

function storeIdKey() { return `lucky_store_id::${currentTenant()}` }
function cacheStoreId(stores) {
  const id = stores && stores[0] && stores[0].id
  if (id) wx.setStorageSync(storeIdKey(), id)
  return id || ''
}
async function activeStoreId() {
  const cached = wx.getStorageSync(storeIdKey())
  if (cached) return cached
  const data = await publicRead('/stores?lang=' + (wx.getStorageSync('lucky_lang') === 'en' ? 'en' : 'zh'))
  wx.setStorageSync('lucky_store_ai', data.aiEnabled === true)
  const id = cacheStoreId(data.stores)
  if (!id) throw new Error('取不到本店门店信息')
  return id
}
const AUTH_KEY = 'lucky_mini_auth'
const ADMIN_AUTH_KEY = 'lucky_admin_auth'


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






function miniCodeEnvironment() {
  try { const v = wx.getAccountInfoSync().miniProgram.envVersion; return ['trial', 'develop'].includes(v) ? v : 'release' } catch (e) { return 'release' }
}
function miniCodeUrl(path) { return path ? API_BASE + path + '?envVersion=' + miniCodeEnvironment() : '' }

function normalizeImage(url) {
  if (!url) return ''
  if (localImageMap[url]) return localImageMap[url]
  if (url.indexOf('/assets/images/') === 0) return localImageMap[url] || url
  return url
}


function getAuth() {
  const auth = wx.getStorageSync(AUTH_KEY) || null
  if (!auth) return null
  if (auth._tenant !== currentTenant() || (auth.apiBase && auth.apiBase !== API_BASE)) {   // 没戳的老数据也走这一条:认不出属于哪家店 → 丢
    try { wx.removeStorageSync(AUTH_KEY) } catch (e) { /* 清不掉也别拿它当登录态 */ }
    return null
  }
  return auth
}

function setAuth(auth) {
  wx.setStorageSync(AUTH_KEY, Object.assign({}, auth, { _tenant: currentTenant(), apiBase: API_BASE }))
  return auth
}

function clearAuth() {
  wx.removeStorageSync(AUTH_KEY)
}

function isLoggedIn() {
  const auth = getAuth()
  return Boolean(auth && auth.needPhone === false && auth.accessToken && (!auth.expiresAt || Date.now() < auth.expiresAt - 60 * 1000))
}

function getAdminAuth() {
  const auth = wx.getStorageSync(ADMIN_AUTH_KEY) || null
  if (!auth) return null


  if (auth.apiBase && auth.apiBase !== API_BASE) {
    wx.removeStorageSync(ADMIN_AUTH_KEY)
    return null
  }
  return auth
}

function setAdminAuth(auth) {
  adminMeCache = null
  wx.setStorageSync(ADMIN_AUTH_KEY, Object.assign({}, auth, { apiBase: API_BASE }))
  return auth
}

function clearAdminAuth() {
  adminMeCache = null
  wx.removeStorageSync(ADMIN_AUTH_KEY)
}


function currentTenant() {
  return wx.getStorageSync('lucky_tenant') || deploy.defaultTenantId || ''
}
const realWechatClaimKey = tenantId => `lucky_real_wechat_claim::${tenantId}`


function hasTenant() { return Boolean(currentTenant()) }


function onStoreSwitched() {
  publicCatalogCache.clear()
  for (const k of ['lucky_member', 'lucky_store_currency', 'lucky_store_deposit', 'lucky_store_ai', 'lucky_cart', 'lucky_orders', 'lucky_style_preset']) {
    try { wx.removeStorageSync(k) } catch (e) { /* 单键清不掉不阻塞换店 */ }
  }
}


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



const TENANT_FREE_PATHS = ['/shops', '/health']
let pickingStore = false
function goPickStore() {
  if (pickingStore) return
  pickingStore = true
  wx.reLaunch({
    url: '/pages/shop-select/index',
    complete() { setTimeout(function () { pickingStore = false }, 1200) }
  })
}


const publicPaths = new Set(['/shops', '/health', '/stores', '/services', '/portfolio', '/add-ons', '/service-categories'])
let renewingCustomer = null
function contextChanged() { return Object.assign(new Error('门店已切换，请重试'), { code: 'STORE_CHANGED' }) }
function publicRead(path) {
  const tid = currentTenant()
  return publicCatalogCache.read(API_BASE + '|' + tid + '|' + path, () => { if (tid !== currentTenant()) throw contextChanged(); return request(path) })
}
const inflight = require('./inflight')
function request(path, method = 'GET', data, _retried) {
  return inflight.run(JSON.stringify(['c',currentTenant(),getAuth()?.accessToken,path,data,_retried]),method==='GET',()=>customerRequest(path,method,data,_retried))
}
function customerRequest(path, method, data, _retried) {
  return new Promise((resolve, reject) => {
    const tid = currentTenant()
    if (!tid && !TENANT_FREE_PATHS.some((p) => path.indexOf(p) === 0)) {
      goPickStore()
      reject({ code: 'NO_TENANT', message: '请先扫码或选择门店' })
      return
    }
    const auth = getAuth()
    const header = { 'content-type': 'application/json', 'x-tenant-id': tid }
    if (auth && auth.accessToken && !(method === 'GET' && publicPaths.has(path.split('?')[0]))) header.authorization = `Bearer ${auth.accessToken}`
    const finish = beginRequestLoading()
    wx.request({
      url: `${API_BASE}${path}`,
      timeout: 15000,
      method,
      data,
      header,
      complete: finish,
      success(res) {
        if (tid !== currentTenant()) return reject(contextChanged())
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data)
        const err = res.data && res.data.error ? res.data.error : new Error('请求失败，请重试')
        err.statusCode = res.statusCode
        err.requestPath = path.split('?')[0]
        if (err.code === 'PHONE_BINDING_REQUIRED' && getAuth()) setAuth(Object.assign({}, getAuth(), {needPhone:true}))

        if (res.statusCode === 401 && !_retried && path.indexOf('/auth/') !== 0 && getAuth() && getAuth().accessToken) {
          if (!renewingCustomer || renewingCustomer.tenant !== tid) {
            const renewal = { tenant: tid }
            renewal.promise = loginForCurrentStore().finally(() => { if (renewingCustomer === renewal) renewingCustomer = null })
            renewingCustomer = renewal
          }
          renewingCustomer.promise
            .then(() => { if (tid !== currentTenant()) throw contextChanged(); return request(path, method, data, true) }).then(resolve)
            .catch(() => {
              if (tid !== currentTenant()) return reject(contextChanged())
              clearAuth()
              try { wx.removeStorageSync('lucky_member') } catch (e) { /* 清不掉不阻塞报错 */ }
              reject(err)
            })
          return
        }
        reject(err)
      },
      fail: (err) => reject(Object.assign({}, err, { code: /timeout/i.test(err.errMsg || '') ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', requestPath: path.split('?')[0] }))
    })
  })
}

function adminRequest(path, method = 'GET', data) {
  return inflight.run(JSON.stringify(['a',getAdminAuth()?.accessToken,wx.getStorageSync('lucky_finance_key'),path,data]),method==='GET',()=>merchantRequest(path,method,data))
}
function merchantRequest(path, method, data) {
  return new Promise((resolve, reject) => {
    const auth = getAdminAuth()
    const header = { 'content-type': 'application/json' }
    if (auth && auth.accessToken) header.authorization = `Bearer ${auth.accessToken}`
    const fk = wx.getStorageSync('lucky_finance_key')
    if (fk) header['x-finance-key'] = fk
    const finish = beginRequestLoading()
    wx.request({
      url: `${API_BASE}${path}`,
      timeout: 15000,
      method,
      data,
      header,
      complete: finish,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data)

        const err = res.data && res.data.error ? res.data.error : new Error('Admin API request failed')
        try { err.statusCode = res.statusCode } catch (e) { /* 冻结对象忽略 */ }


        if (res.statusCode === 401) kickToLogin()
        reject(err)
      },
      fail: reject
    })
  })
}



function storeDepositAmount() {
  try {
    const d = wx.getStorageSync('lucky_store_deposit')
    if (d && d.enabled === false) return 0                    // 明确配了「不收定金」= 真的 0
    if (d && d.enabled && typeof d.amountCents === 'number') return Math.round(d.amountCents) / 100
  } catch (e) { /* storage 拿不到 = 下面返 null,不猜 */ }
  return null
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

    depositAmount: storeDepositAmount(),
    duration: service.durationMin,
    suitableFor: service.suitableFor || '',
    imageLabel: `${service.type} · ${service.category}`,
    image: normalizeImage(service.imageUrl), imageView: service.imageView || {},
    process: service.process || [],
    notice: service.notice || [],
    requiresManualQuote: service.requiresManualQuote,
    pricingType: service.pricingType,
    priceLabelZh: service.priceLabelZh,
    priceLabelEn: service.priceLabelEn,

    priceFromLabelZh: service.priceFromLabelZh,
    priceFromLabelEn: service.priceFromLabelEn,

    priceDetailLabelZh: service.priceDetailLabelZh,
    priceDetailLabelEn: service.priceDetailLabelEn,
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
    storeName: store.name || store.storeName || '',

    storeNameEn: store.name_en || store.storeNameEn || '',


    arrivalGuide: (store.arrivalGuide || []).map(s=>({...s,image:s.image.startsWith('/')?API_BASE+s.image:s.image})),
    address: realValue(store.address), navigation: store.navigation || null,
    phone: realValue(store.phone),
    addressText: realValue(store.address) || '门店地址待补充',   // 只作展示句,不驱动动作
    phoneText: realValue(store.phone) || '门店电话待补充',
    businessHours: store.businessHours || store.business_hours || '',
    hours: store.hours || [],
    todayHours: store.todayHours || null,
    timezone: store.timezone || '',
    latitude: store.latitude,
    longitude: store.longitude,
    description: store.description || ''
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


    depositState: booking.depositState || '',   // 拿不到不猜「无定金」(页面按未知走通用句)





    depositCents: booking.depositCents == null ? null : booking.depositCents,
    memberDocuments:booking.memberDocuments||null,
    depositPayment:booking.depositPayment||null,
    payment: booking.payment || null,
    payableAmount: booking.depositCents == null ? null : Math.round(booking.depositCents / 100),
    finalDue: booking.finalDue == null ? null : booking.finalDue,
    servicePrice: booking.servicePrice == null ? null : booking.servicePrice,



    status: (booking.afterSalesStatus ? 'after_sales' : (booking.status === 'COMPLETED' && !booking.payment ? 'pending_settlement' : statusMap[booking.status])) || '',
    paymentStatus: booking.status === 'PENDING_PAYMENT' ? 'pending' : 'paid',
    backendBookingId: booking.id,




    statusText: booking.statusText || '',
    listBadgeText: booking.listBadgeText || '',
    listBadgeKind: booking.listBadgeKind || '',
    listNote: booking.listNote || '',

    listTitleText: booking.listTitleText || '',
    actualDueText: booking.actualDueText || '',
    listAmountText: booking.listAmountText || '',
    actualDueCents: booking.actualDueCents === undefined ? null : booking.actualDueCents,
    settlementCode: booking.settlementCode || '',
    afterSales: booking.afterSales || null,




    customerActions: booking.customerActions || [],
    afterSalesStatus: booking.afterSalesStatus || '',
    afterSalesAction: booking.afterSalesAction || '',
    afterSalesActionText: booking.afterSalesActionText || '',
    createdAt: booking.createdAt || '',
    updatedAt: booking.updatedAt || booking.createdAt || ''
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


async function loginForCurrentStore(options = {}) {
  const tid = currentTenant()
  const code = await wxLoginCode()
  if (tid !== currentTenant()) throw contextChanged()


  const previousRealWechatClaim = Boolean(getAuth()?._realWechat || wx.getStorageSync(realWechatClaimKey(currentTenant())))
  const data = await request('/auth/wechat/mini-login', 'POST', {
    code,


    demoLogin: USE_LOCAL_SANDBOX && !previousRealWechatClaim,
    tenantId: currentTenant(),
    displayName: options.displayName || '',
    avatarUrl: options.avatarUrl || '',
    phoneCode: options.phoneCode || '',
    phone: options.phone || ''
  })
  if (tid !== currentTenant()) throw contextChanged()
  const realWechatClaim = previousRealWechatClaim || data.wechatVerified === true
  if (realWechatClaim) wx.setStorageSync(realWechatClaimKey(currentTenant()), true)
  setAuth(Object.assign({}, data.auth, { user: data.user, needPhone: data.needPhone, tenantId: currentTenant(), _realWechat: realWechatClaim }))
  wx.setStorageSync('lucky_member', Object.assign(miniMember(data.user), { _tenant: currentTenant() }))
  return data.user
}


async function bindWechatPhone({ encryptedData, iv, phoneCode }) {
  const payload = phoneCode ? {phoneCode} : {code:await wxLoginCode(),encryptedData,iv}
  const out = await request('/auth/wechat/mini-phone', 'POST', payload)
  if (out.auth) acceptCustomerSession(out)
  else if (out.needPhone === false) setAuth(Object.assign({}, getAuth(), {needPhone:false}))
  return out
}

async function ensureLogin(options = {}) {
  const existing = getAuth()
  const fresh = Boolean(existing && existing.accessToken && (!existing.expiresAt || Date.now() < existing.expiresAt - 60 * 1000))
  const sameStore = Boolean(existing && existing.tenantId === currentTenant())  // 旧会话无租户戳=按不匹配处理,静默重登一次后就有戳了
  if (fresh && sameStore && typeof existing.needPhone === 'boolean') return existing.user
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


async function ensureStoreScopedAuth() {
  const a = getAuth()
  if (a && a.accessToken && a.tenantId !== currentTenant()) await ensureLogin({ interactive: false })
}

async function loginWithWechat(profile = {}) {
  const user = await ensureLogin({
    interactive: true,
    displayName: profile.nickname || profile.displayName || '',
    avatarUrl: '',
    phoneCode: profile.phoneCode || '',
    phone: profile.phone || ''
  })
  if (!phoneBindingRequired() && (profile.nickname || profile.avatarUrl)) return updateProfile(profile)
  return user
}
async function updateProfile(profile) {
  const tid = currentTenant()
  const body = {}
  if ((profile.nickname || '').trim()) body.displayName = profile.nickname.trim()
  if (profile.avatarUrl && !/^https?:/.test(profile.avatarUrl)) body.avatarData = await require('./profile-avatar').avatarData(profile.avatarUrl)
  if (tid !== currentTenant()) throw contextChanged()
  if (!Object.keys(body).length) return (getAuth() || {}).user
  const out = await request('/my/profile', 'PATCH', body)
  const auth = getAuth()
  if (!auth) throw authRequiredError()
  setAuth(Object.assign({}, auth, { user: out.user }))
  wx.setStorageSync('lucky_member', Object.assign(miniMember(out.user), { _tenant: tid }))
  return out.user
}

function miniMember(user = {}) {
  const displayName = String(user.displayName || '').trim()




  const memberCode = user.memberCode || '—'
  const isGenericName = !displayName || displayName === 'Lucky Member' || displayName === '微信用户' || displayName === 'WeChat User' || displayName === memberCode
  const hasRealName = Boolean(!isGenericName)
  const profileComplete = user.profileComplete === undefined ? Boolean(hasRealName || user.avatarUrl) : Boolean(user.profileComplete)
  const hasRealStats = user.hasRealStats === undefined ? Boolean(user.id) : Boolean(user.hasRealStats)

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

    redeemablePrizeText: user.redeemablePrizeText || '',
    redeemablePrizeCount: user.redeemablePrizeCount || 0,
    balance: hasRealStats ? Math.round((user.balanceCents || 0) / 100) : 0,
    totalSpent: hasRealStats ? Math.round((user.totalSpentCents || 0) / 100) : 0,
    visits: hasRealStats ? (user.visits || 0) : 0,
    memberCode,
    referralCode: user.referralCode || '',
    referralUrl: user.referralUrl || '',
    avatarUrl: user.avatarUrl || ''   // 裁定二同族:没头像=占位,不拿平台示例头像顶
  }
}


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


async function getServiceCatalog(lang) {
  const data = await publicRead(`/services?lang=${lang}`)
  return {
    services: (data.services || []).map(toMiniService),
    platformCategories: data.platformCategories || []
  }
}



function getStoreAiEnabled() { return wx.getStorageSync('lucky_store_ai') === true }

async function getStores() {
  try {
    const data = await publicRead('/stores?lang=' + (wx.getStorageSync('lucky_lang') === 'en' ? 'en' : 'zh'))
    wx.setStorageSync('lucky_store_ai', data.aiEnabled === true)


    wx.setStorageSync('lucky_store_demo', data.isDemo === true)
    return (data.stores || []).map(toMiniStore)
  } catch (error) {
    throw error
  }
}


async function getHeroSlides(lang) {
  const data = await publicRead(`/stores?lang=${lang === 'en' ? 'en' : 'zh'}`)
  return data.heroSlides || []
}


async function getStoreCurrency() {
  const data = await publicRead('/stores?lang=' + (wx.getStorageSync('lucky_lang') === 'en' ? 'en' : 'zh'))

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


async function getPortfolioWall() {
  try {
    const data = await request('/portfolio')
    return {
      works: data.works || [],
      categories: data.categories || []
    }
  } catch (error) {
    throw error
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

  }

  throw new Error('作品墙加载失败')
}

async function getService(id, lang) {




  const data = await publicRead(`/services?lang=${lang}`)
  return (data.services || []).map(toMiniService).find((item) => item._id === id) || null
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


async function bookingCheckoutPayload(items,remark,useBalance){const user=await ensureLogin(),store=await activeStoreId();return {useBalance:!!useBalance,items:await Promise.all(items.map(async x=>({clientItemId:x._id,userId:user.id,storeId:x.storeId||store,serviceId:x.serviceId,technicianId:x.appointmentInfo.technicianId,date:x.appointmentInfo.date,time:x.appointmentInfo.time,addOns:await selectedAddOns(x.appointmentInfo.addOns),referenceImages:x.appointmentInfo.referenceDataImages||x.appointmentInfo.referenceImages||[],sourceChannel:'wechat_miniprogram',notes:remark||x.appointmentInfo.remark||'',bookingDraftId:x.bookingDraftId||x.appointmentInfo.bookingDraftId||x.draftId||''})))}}
async function createBooking(cartItem, remark) {
  const user = await ensureLogin()
  const appointment = cartItem.appointmentInfo
  const technicianId = appointment.technicianId || ''
  if (!technicianId) throw new Error('请先选择技师')
  const data = await request('/bookings', 'POST', {
    userId: user.id || DEMO_USER_ID,
    storeId: cartItem.storeId || await activeStoreId(),   // D19:预约归属当前门店,不写死旗舰店
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

async function getBookings(lang) {
  await ensureLogin()
  const data = await request(`/bookings?lang=${lang || 'zh'}`)
  return (data.bookings || []).map(toMiniBooking)
}





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


function isAdminLoggedIn() {
  const a = getAdminAuth()
  return Boolean(a && a.accessToken && (!a.expiresAt || Date.now() < a.expiresAt - 60 * 1000))
}

async function adminChangePassword(oldPassword, newPassword, confirmPassword) {
  return adminRequest('/admin/auth/change-password', 'POST', { oldPassword, newPassword, confirmPassword })
}



function submitMerchantLead(data) {
  return request('/merchant-leads', 'POST', data)
}



function getShops(includeDemo = EXPERIENCE) {
  return request(includeDemo ? '/shops?include=demo' : '/shops')
}


function clientChatId() {
  let id = wx.getStorageSync('lucky_client_id')
  if (!id) {
    id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    wx.setStorageSync('lucky_client_id', id)
  }
  return id
}
function aiCustomerService(message) {
  return request('/ai/customer-service', 'POST', { message, lang: 'zh', clientId: clientChatId() })
}



function getDepositPolicy(qs) { return request(`/store/deposit-policy${qs ? `?${qs}` : ''}`) }
function getMyCoupons() { return request('/my/coupons') }


function getCardPack() { return request('/my/card-pack') }
function getMyTimecards() { return request('/my/timecards') }
function getMall() { return request('/my/mall') }
function getMyStoredValue() { return request('/my/stored-value') }

function getMyPendingSign() { return request('/my/pending-sign') }


function cancelBooking(bookingId, reason,reviewHash) { return request(`/bookings/${encodeURIComponent(bookingId)}/cancel`, 'POST', { reason: reason || '',reviewHash }) }
function startAfterSales(bookingId, description) { return request(`/my/bookings/${encodeURIComponent(bookingId)}/after-sales`, 'POST', { description }) }
function withdrawAfterSales(bookingId) { return request(`/my/bookings/${encodeURIComponent(bookingId)}/after-sales/withdraw`, 'POST', {}) }

function confirmStoredRecharge(id) { return request('/my/stored-value/confirm', 'POST', { id }) }

async function myBalance() {
  try { await ensureStoreScopedAuth() } catch (e) { /* 未登录时照常请求,由服务端 401 */ }
  const r = await request('/my/stored-value')
  const cents = (r && r.balanceCents) || 0
  return { cents, yuan: Math.round(cents / 100) }
}

function getSandboxRoster() { return request('/sandbox/demo-roster') }
async function sandboxLoginAs(userId) {
  const data = await request('/auth/wechat/mini-login', 'POST', { demoLogin: true, tenantId: currentTenant(), asUserId: userId })

  wx.removeStorageSync('lucky_orders')


  wx.removeStorageSync(realWechatClaimKey(currentTenant()))
  setAuth(Object.assign({}, data.auth, { user: data.user, tenantId: currentTenant() }))
  wx.setStorageSync('lucky_member', Object.assign(miniMember(data.user), { _tenant: currentTenant() }))
  return data.user
}
function getMyPointsHistory() { return request('/my/points-history') }

function getPointsMall() { return request('/my/points-mall') }
function redeemPrize(prizeId) { return request('/my/points-mall/redeem', 'POST', { prizeId }) }


async function refreshMember() {

  try { await ensureStoreScopedAuth() } catch (e) { return null }
  const auth = getAuth()



  if (!auth || !auth.accessToken) return null
  const uid = (auth.user && auth.user.id) || auth.userId || (wx.getStorageSync('lucky_member') || {}).id
  if (!uid) return null
  try {
    const data = await request(`/users/${uid}`)
    const fresh = miniMember(data.user)


    wx.setStorageSync('lucky_member', Object.assign({}, fresh, {
      _tenant: currentTenant(),
      nickname: fresh.nickname,
      avatarUrl: fresh.avatarUrl,
      profileComplete: fresh.profileComplete
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

function saveServiceNote(data) {
  return adminRequest('/admin/service-notes', 'POST', data)
}
function getCustomerNotes(userId) {
  return adminRequest(`/admin/customers/${encodeURIComponent(userId)}/notes`)
}

function getSignedDocs(userId) {
  return adminRequest(`/admin/customers/${encodeURIComponent(userId)}/signed-docs`)
}
function createSignedDoc(userId, data) {
  return adminRequest(`/admin/customers/${encodeURIComponent(userId)}/signed-docs`, 'POST', data)
}
function getSignedDoc(docId) {
  return adminRequest(`/admin/signed-docs/${encodeURIComponent(docId)}`)
}
function voidSignedDoc(docId, reason) {
  return adminRequest(`/admin/signed-docs/${encodeURIComponent(docId)}/void`, 'POST', { reason })
}

function getMySignedDocs() { return request('/my/signed-docs') }

function getCachedRole() { return wx.getStorageSync('lucky_admin_role') || '' }
function isOwner() { return getCachedRole() === 'owner' }


function goMerchantLogin() {
  kickToLogin(true)
}




const HOURS_SETUP_PAGE = 'pages/merchant/hours-setup/index'
function hoursGateText() { try { return JSON.parse(wx.getStorageSync('lucky_hours_gate') || 'null') || {} } catch (e) { return {} } }
function enforceHoursGate() {
  if (wx.getStorageSync('lucky_hours_unset') !== '1') return false
  const pages = getCurrentPages()
  const cur = pages[pages.length - 1]
  if (cur && cur.route === HOURS_SETUP_PAGE) return false
  require('./nav').relaunch('/' + HOURS_SETUP_PAGE)   // 清栈进强制页(裸导航棘轮㉑:新增一律走 nav)
  return true
}
function guardMerchant() {
  if (!isAdminLoggedIn()) { goMerchantLogin(); return false }
  if (enforceHoursGate()) return false
  return true
}

async function guardOwner() {




  if (!isAdminLoggedIn()) { goMerchantLogin(); return false }
  let me = null
  try {
    me = await adminMe()
  } catch (e) {
    const code = e && (e.statusCode || e.code)

    if (code === 401 || code === 403 || code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'ACCOUNT_DISABLED') return false
    return true // 断网/超时:不误伤
  }
  if (enforceHoursGate()) return false
  if (me && me.role === 'owner') return true
  wx.showToast({ title: '仅老板可用', icon: 'none' })
  setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/merchant/home/index' }) }), 350)
  return false
}


function getFinanceKey() { return wx.getStorageSync('lucky_finance_key') || '' }
function clearFinanceKey() { wx.removeStorageSync('lucky_finance_key') }
async function financeUnlock(password, confirmPassword) {
  const d = await adminRequest('/admin/finance/unlock', 'POST', { password, confirmPassword })
  if (d && d.financeKey) wx.setStorageSync('lucky_finance_key', d.financeKey)
  return d
}

let adminMeCache = null
async function adminMe(force = false) {
  const auth = getAdminAuth()
  const token = auth && (auth.accessToken || auth.token)
  if (!force && adminMeCache && adminMeCache.token === token && Date.now() - adminMeCache.at < 5000) return adminMeCache.value
  const data = await adminRequest('/admin/auth/me')
  if (data && data.admin && data.admin.role) wx.setStorageSync('lucky_admin_role', data.admin.role)

  wx.setStorageSync('lucky_hours_unset', data && data.hoursUnset ? '1' : '')
  if (data && data.hoursGateText) wx.setStorageSync('lucky_hours_gate', JSON.stringify(data.hoursGateText))
  adminMeCache = { token, at: Date.now(), value: data.admin }
  return data.admin
}



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


function getHealth() { return request('/health', 'GET') }

function getSignLink(code) { return request('/my/settlements/'+encodeURIComponent(code)+'/sign-link','POST',{}) }

function acceptCustomerSession(out) {
  if (!out?.tenantId || !out?.auth?.accessToken || !out?.user?.id) throw new Error('绑定会话不完整，请重试')
  if (currentTenant() !== out.tenantId) onStoreSwitched()
  wx.setStorageSync('lucky_tenant', out.tenantId)
  wx.setStorageSync(realWechatClaimKey(out.tenantId), true)
  setAuth(Object.assign({}, out.auth, {user:out.user, needPhone:out.needPhone, tenantId:out.tenantId, _realWechat:true}))
  wx.setStorageSync('lucky_member', Object.assign(miniMember(out.user), {_tenant:out.tenantId}))
}

function phoneBindingRequired() { return getAuth()?.needPhone !== false }
async function refreshPhoneRequirement() {
  const session = getAuth()?.accessToken
  if (!session) return
  const out = await request('/auth/wechat/mini-phone-status')
  if (getAuth()?.accessToken !== session) return
  setAuth(Object.assign({}, getAuth(), {needPhone:out.needPhone}))
}

module.exports = {
  getMemberPricing:()=>request('/my/member-pricing'),
  getMemberDocuments:()=>request('/my/member-documents'),
  getMemberGroupLink:id=>request('/my/member-document-groups/'+encodeURIComponent(id)+'/sign-link','POST',{}),
  phoneBindingRequired, refreshPhoneRequirement,
  miniCodeUrl, miniCodeEnvironment,
  getBookingDraft: id => request(`/booking-drafts/${encodeURIComponent(id)}`),
  acceptCustomerSession,
  getSignLink,
  subscriptionOnboarding: () => request('/my/subscription-onboarding'),
  subscriptionConfig: id => request('/my/bookings/'+encodeURIComponent(id)+'/subscription'),
  subscriptionConsent: data => request('/my/subscription-consent','POST',data),
  getMessages: () => request('/my/messages'),
  readMessage: id => request('/my/messages/'+encodeURIComponent(id)+'/read','POST',{}),
  getDocumentLink: code => request('/my/settlements/'+encodeURIComponent(code)+'/document-link'),
  getHealth,
  getHeroSlides,
  API_BASE,
  DEMO_USER_ID,
  SANDBOX: USE_LOCAL_SANDBOX,
  EXPERIENCE,
  EXPERIENCE_TENANTS,
  onStoreSwitched,
  getSandboxRoster,
  sandboxLoginAs,
  normalizeImage,
  ensureLogin,
  bindWechatPhone,
  loginWithWechat,
  updateProfile,
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
  hasTenant,
  currentTenantId: currentTenant,   // 租户唯一出口(app.js / 页面判空都读它)
  getServiceCatalog,
  aiCustomerService,
  getDepositPolicy,
  getMyCoupons,
  getCardPack,
  getMyTimecards,
  getMall,
  getMyStoredValue,
  getMyPendingSign,
  cancelBooking,
  startAfterSales,
  withdrawAfterSales,
  confirmStoredRecharge,
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
  getSignedDocs, createSignedDoc, getSignedDoc, voidSignedDoc,
  getMySignedDocs,
  adminRequest,
  getCachedRole,
  isOwner,
  guardOwner,
  guardMerchant,
  enforceHoursGate,
  hoursGateText,
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
  createBooking,bookingCheckoutPayload,
  previewBookingCheckout:b=>request('/my/booking-checkout/preview','POST',b),
  submitBookingCheckout:b=>request('/my/booking-checkout','POST',b),
  previewBookingCancel:id=>request('/bookings/'+encodeURIComponent(id)+'/cancel-preview'),
  getBookings,
  getStoreCurrency,
  toMiniBooking,   // 导出只为回归断言:这层是白名单,漏字段=页面整块不渲染(见 test-double-sheet)
  analyzeReference
}
