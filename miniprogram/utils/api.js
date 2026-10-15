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
// 云端体验与本机沙箱分开；此标志只控制演示门店可见性，不放宽微信身份验证。
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

// Failed customer requests must remain errors; never substitute demo data.


// Historical rationale: handoff/messages-20261012/api历史开发说明.md #1
// QR target follows the running mini-program version; API/database scope never changes.
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
  adminMeCache = null
  wx.setStorageSync(ADMIN_AUTH_KEY, Object.assign({}, auth, { apiBase: API_BASE }))
  return auth
}

function clearAdminAuth() {
  adminMeCache = null
  wx.removeStorageSync(ADMIN_AUTH_KEY)
}

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #2
function currentTenant() {
  return wx.getStorageSync('lucky_tenant') || deploy.defaultTenantId || ''
}
const realWechatClaimKey = tenantId => `lucky_real_wechat_claim::${tenantId}`

// 有没有门店上下文(没有就该去选店,而不是拿别人家的店顶上)
function hasTenant() { return Boolean(currentTenant()) }

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #3
function onStoreSwitched() {
  publicCatalogCache.clear()
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

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #4
/* `/health` 是公开的服务自述口(版本指纹),不属于任何门店 —— 04f-3「关于」页读它 */
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

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #5
const publicPaths = new Set(['/shops', '/health', '/stores', '/services', '/portfolio', '/add-ons', '/service-categories'])
let renewingCustomer = null
function contextChanged() { return Object.assign(new Error('门店已切换，请重试'), { code: 'STORE_CHANGED' }) }
function publicRead(path) {
  const tid = currentTenant()
  return publicCatalogCache.read(API_BASE + '|' + tid + '|' + path, () => { if (tid !== currentTenant()) throw contextChanged(); return request(path) })
}
function request(path, method = 'GET', data, _retried) {
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
        // 顾客会话失效 → 静默重登一次再重放(只对"曾经登录过"的会话做,未登录照常报错走登录引导)
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
// Historical rationale: handoff/messages-20261012/api历史开发说明.md #6
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
    // R5:定金额来自门店配置(/stores 下发),拿不到就 0 不显示 —— 不许再写死 50
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
    // S1:列表「xxx 起」起价独立字段(详情/AI 报价 label 不动)
    priceFromLabelZh: service.priceFromLabelZh,
    priceFromLabelEn: service.priceFromLabelEn,
    // D49:详情页价格 label(多档=起+档说明,单档才是固定价/基础价)
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

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #7
function toMiniStore(store) {
  return {
    id: store.id || '',   // D19:不再用写死的旗舰店 id 兜底
    storeName: store.name || store.storeName || '',

    storeNameEn: store.name_en || store.storeNameEn || '',


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
    /* D32(4500 同族·假数回落):原来 booking.deposit 为 0 就回落店配定金额还标「已付」。
       现在真相直出:depositState/depositCents/payment(已签快照分解)由后端下发,前端零运算。 */
    depositState: booking.depositState || '',   // 拿不到不猜「无定金」(页面按未知走通用句)
    /* 🔴 c3 补扫(店主 08-25 通则提炼律):D71 那轮只扫了网页顾客端,小程序**映射层**这几处漏了。
       三宗罪都在这五行里:①`|| 0` 把"没有值"变成"零元"(0 在界面上=免费/免定金,是假话);
       ②`servicePrice || service.price` 拿**别的字段**顶上(零回落律明令禁止);
       ③页面层明明写了「!== null 才显示,否则 —」,被映射层的 `|| 0` 堵死,那句「—」永远走不到。
       现在:后端没给就是 null,让页面照它本来的写法显示「—」。 */
    depositCents: booking.depositCents == null ? null : booking.depositCents,
    payment: booking.payment || null,
    payableAmount: booking.depositCents == null ? null : Math.round(booking.depositCents / 100),
    finalDue: booking.finalDue == null ? null : booking.finalDue,
    servicePrice: booking.servicePrice == null ? null : booking.servicePrice,
    /* 🔴 D70 合同⑤(店主 08-24):**售后不改写主状态** —— 后端不再回 AFTER_SALES,
       售后中的单主状态就是 COMPLETED。列表「售后」分组因此必须改按售后字段筛,
       不然这个分组会永远是空的(网页端同刀,四之九)。 */
    status: (booking.afterSalesStatus ? 'after_sales' : (booking.status === 'COMPLETED' && !booking.payment ? 'pending_settlement' : statusMap[booking.status])) || '',
    paymentStatus: booking.status === 'PENDING_PAYMENT' ? 'pending' : 'paid',
    backendBookingId: booking.id,
    /* 屏 D2/D3(2026-08-10 核验轮修复):这个映射是**白名单**,后端 customerOrderBadges()
       下发的徽标三态 / 副行 / 实际应付 / 售后三步在这一层被整片丢掉了 ——
       后端断言全绿,页面上一个徽标也不出、售后进度卡整块不渲染。原样透传,前端仍零计算。 */
    /* A2(08-25):订单状态的人话句后端唯一给(与网页顾客端同一出口),映射层零裁剪 */
    statusText: booking.statusText || '',
    listBadgeText: booking.listBadgeText || '',
    listBadgeKind: booking.listBadgeKind || '',
    listNote: booking.listNote || '',
    // ㋉ D1(店主拍案一 08-22):多项目单列表标题「首项目 等N项」,句后端唯一;空串=前端回落服务名
    listTitleText: booking.listTitleText || '',
    actualDueText: booking.actualDueText || '',
    listAmountText: booking.listAmountText || '',
    actualDueCents: booking.actualDueCents === undefined ? null : booking.actualDueCents,
    settlementCode: booking.settlementCode || '',
    afterSales: booking.afterSales || null,
    // 批③首件 B1/B5:售后按钮位(后端句唯一,映射层零裁剪)
    /* D70(店主 08-24):顾客端可做的动作也由后端状态机给(customerActions);
       afterSalesAction 是售后线的既有字段,保留不动 —— 两者不冲突:
       前者管"这张单现在能做什么"(按钮显隐),后者管售后按钮的文案与进度。 */
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

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #8
async function loginForCurrentStore(options = {}) {
  const tid = currentTenant()
  const code = await wxLoginCode()
  if (tid !== currentTenant()) throw contextChanged()
  // An experience profile is only a preview. After a real scan/phone claim,
  // renew with the same WeChat identity instead of falling back to a demo user.
  const previousRealWechatClaim = Boolean(getAuth()?._realWechat || wx.getStorageSync(realWechatClaimKey(currentTenant())))
  const data = await request('/auth/wechat/mini-login', 'POST', {
    code,
    // 本地沙盘:走服务器演示登录旁路(无需真实微信授权即可演示登录后页面)。
    // 上线前 USE_LOCAL_SANDBOX 置回 false 后此标记自动为 false,走真实微信登录。
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
  setAuth(Object.assign({}, data.auth, { user: data.user, tenantId: currentTenant(), _realWechat: realWechatClaim }))
  wx.setStorageSync('lucky_member', Object.assign(miniMember(data.user), { _tenant: currentTenant() }))
  return data.user
}

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #9
async function bindWechatPhone({ encryptedData, iv, phoneCode }) {
  const payload = phoneCode ? {phoneCode} : {code:await wxLoginCode(),encryptedData,iv}
  const out = await request('/auth/wechat/mini-phone', 'POST', payload)
  if (out.auth) acceptCustomerSession(out)
  return out
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
  const user = await ensureLogin({
    interactive: true,
    displayName: profile.nickname || profile.displayName || '',
    avatarUrl: '',
    phoneCode: profile.phoneCode || '',
    phone: profile.phone || ''
  })
  if (profile.nickname || profile.avatarUrl) return updateProfile(profile)
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
  /* 🔴 A1-M2(店主 08-25):会员码**只认后端**(memberCodeForUserId 唯一算法)。
     原来这里拿 displayName 是不是以 LL- 开头来猜 —— 那是"名字碰巧长得像会员码就当成会员码",
     与网页那份本地推导同族。零回落律:拿不到显示「—」,不猜。
     (未登录场景后端本来就不给 user,页面另有登录引导,不靠这句话兜。) */
  const memberCode = user.memberCode || '—'
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
    // 积分入口的提示(后端唯一出口;整句给黑卡格、数字给小方格角标,同一个数)
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

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #10
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
  const data = await publicRead(`/services?lang=${lang}`)
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
    const data = await publicRead('/stores?lang=' + (wx.getStorageSync('lucky_lang') === 'en' ? 'en' : 'zh'))
    wx.setStorageSync('lucky_store_ai', data.aiEnabled === true)
    /* 03u:样例内容(充值套餐示例 / 我的消息样例)只许在演示店出。
       照 aiEnabled 同一形制缓存,不另起一套(先搜复用,公约④)。 */
    wx.setStorageSync('lucky_store_demo', data.isDemo === true)
    return (data.stores || []).map(toMiniStore)
  } catch (error) {
    throw error
  }
}

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #11
async function getHeroSlides(lang) {
  const data = await publicRead(`/stores?lang=${lang === 'en' ? 'en' : 'zh'}`)
  return data.heroSlides || []
}

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #12
async function getStoreCurrency() {
  const data = await publicRead('/stores?lang=' + (wx.getStorageSync('lucky_lang') === 'en' ? 'en' : 'zh'))
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
    // Use fallback below.
  }
  // D17(自纠:上一轮误分到 ⚪):这是**编造的作品图**,会端给顾客 —— 同样不许回 mock
  throw new Error('作品墙加载失败')
}

async function getService(id, lang) {
  /* D48(店主 08-16 实测:护理板块「服务不存在」):原实现靠猜 id 前缀定类
     (id 以 lash 开头→lash,否则一律→nail)——护理类 id(care-service-*)被猜成 nail,
     去美甲列表里找,永远 null → 护理详情从来打不开。改:全量目录里直查,不猜类。
     D17 红线不变:真找不到返回 null,绝不回 mock。 */
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

// Historical rationale: handoff/messages-20261012/api历史开发说明.md #13
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

// 我的资产(user × 当前店)
// 顾客端预约确认页(屏 3)读本店定金规则。公开接口,不需要登录。
function getDepositPolicy(qs) { return request(`/store/deposit-policy${qs ? `?${qs}` : ''}`) }
function getMyCoupons() { return request('/my/coupons') }
// 批③次段:卡包(三类聚合+角标同源)与商城(上架套餐+按钮句)两个只读出口
// getAssets 已删(资产层收敛,08-25):/my/assets 整条退役,小程序这边本来也已零使用方
function getCardPack() { return request('/my/card-pack') }
function getMyTimecards() { return request('/my/timecards') }
function getMall() { return request('/my/mall') }
function getMyStoredValue() { return request('/my/stored-value') }
// D57 顾客侧待签单再入口:全部未签单(不止最新一张;即时开单没挂预约的也在)
function getMyPendingSign() { return request('/my/pending-sign') }
// 批③首件 屏B:顾客侧售后发起/撤回(同一状态机,前置=已完成+已签署;撤回=转已解决留痕)

function cancelBooking(bookingId, reason) { return request(`/bookings/${encodeURIComponent(bookingId)}/cancel`, 'POST', { reason: reason || '' }) }
function startAfterSales(bookingId, description) { return request(`/my/bookings/${encodeURIComponent(bookingId)}/after-sales`, 'POST', { description }) }
function withdrawAfterSales(bookingId) { return request(`/my/bookings/${encodeURIComponent(bookingId)}/after-sales/withdraw`, 'POST', {}) }
// B3-4 代充回执确认:幂等,只许确认本人的充值行;未确认不阻塞任何链路
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
  // 演示身份切换会换顾客；全局订单缓存若沿用，会把上一人的订单显示给下一人。
  wx.removeStorageSync('lucky_orders')
  // Explicitly choosing a demo profile leaves the real-WeChat session for this
  // store. A later ordinary login may now use the preview identity again.
  wx.removeStorageSync(realWechatClaimKey(currentTenant()))
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
// 服务小记(P0-②)
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
  if (enforceHoursGate()) return false
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

let adminMeCache = null
async function adminMe(force = false) {
  const auth = getAdminAuth()
  const token = auth && (auth.accessToken || auth.token)
  if (!force && adminMeCache && adminMeCache.token === token && Date.now() - adminMeCache.at < 5000) return adminMeCache.value
  const data = await adminRequest('/admin/auth/me')
  if (data && data.admin && data.admin.role) wx.setStorageSync('lucky_admin_role', data.admin.role)
  /* D84 强制设置(图 v1.0):未设置旗标+后端句随 me 缓存,守卫零请求即时拦 */
  wx.setStorageSync('lucky_hours_unset', data && data.hoursUnset ? '1' : '')
  if (data && data.hoursGateText) wx.setStorageSync('lucky_hours_gate', JSON.stringify(data.hoursGateText))
  adminMeCache = { token, at: Date.now(), value: data.admin }
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


function getHealth() { return request('/health', 'GET') }

function getSignLink(code) { return request('/my/settlements/'+encodeURIComponent(code)+'/sign-link','POST',{}) }

function acceptCustomerSession(out) {
  if (!out?.tenantId || !out?.auth?.accessToken || !out?.user?.id) throw new Error('绑定会话不完整，请重试')
  if (currentTenant() !== out.tenantId) onStoreSwitched()
  wx.setStorageSync('lucky_tenant', out.tenantId)
  wx.setStorageSync(realWechatClaimKey(out.tenantId), true)
  setAuth(Object.assign({}, out.auth, {user:out.user, tenantId:out.tenantId, _realWechat:true}))
  wx.setStorageSync('lucky_member', Object.assign(miniMember(out.user), {_tenant:out.tenantId}))
}

module.exports = {
  miniCodeUrl, miniCodeEnvironment,
  getBookingDraft: id => request(`/booking-drafts/${encodeURIComponent(id)}`),
  acceptCustomerSession,
  getSignLink,
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
  createBooking,
  getBookings,
  getStoreCurrency,
  toMiniBooking,   // 导出只为回归断言:这层是白名单,漏字段=页面整块不渲染(见 test-double-sheet)
  analyzeReference
}
