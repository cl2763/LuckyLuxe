const storeId = 'store-ontario-01'

const copy = {
  zh: {
    registerTitle: '创建 Lucky Luxe 账号',
    registerText: '你可以先以游客身份浏览。预约、购物车结算和会员档案需要登录。',
    emailRegister: '创建账号',
    emailLogin: '邮箱登录',
    displayName: '姓名',
    email: '邮箱',
    password: '密码',
    googleRegister: '使用 Google 登录',
    continueGuest: '继续游客浏览',
    enter: '进入',
    home: '首页',
    services: '服务',
    cart: '购物车',
    me: '我的',
    bookNow: '立即预约',
    viewStore: '查看门店',
    quickNail: '美甲服务',
    quickLash: '美睫服务',
    quickMember: '会员档案',
    technicianWorks: '技师作品',
    technicianPortfolio: '技师作品集',
    portfolioIntro: '浏览每位技师已确认入库的真实作品。',
    noPortfolio: '暂无已确认作品，作品确认后会自动出现在这里。',
    viewWork: '查看作品',
    popularNail: '人气美甲',
    popularLash: '人气美睫',
    nail: '美甲 Nail',
    lash: '美睫 Lash',
    minutes: '分钟',
    deposit: '定金',
    servicePrice: '服务价',
    basePrice: '基础价',
    fixedPrice: '固定价',
    detailedQuote: '详细价格请联系客服获取报价',
    finalPriceGuide: '加项确认后即为最终报价',
    priceBoundary: '价格说明',
    aiPriceSuggestion: 'AI 价格建议',
    manualQuote: '联系人工报价',
    process: '服务流程',
    notice: '注意事项',
    reference: '参考图',
    addToCart: '加入购物车',
    appointment: '预约时间',
    artist: '服务技师',
    date: '到店日期',
    addOns: '附加服务',
    optional: '可选',
    remark: '备注',
    upload: '上传参考图',
    aiAnalyze: 'AI 分析参考图',
    aiAnalyzing: 'AI 正在分析...',
    aiReferenceTitle: 'AI 款式建议',
    aiComplexity: '复杂度',
    aiExtraTime: '建议额外时间',
    aiTechNote: '给技师的备注',
    checkout: '去结算',
    saveCart: '保存到购物车',
    requiredDeposit: '需付定金',
    emptyCart: '购物车是空的',
    emptyCartHint: '请选择服务并填写预约信息。',
    chooseService: '选择服务',
    pendingCheckout: '待结算',
    selectedDeposit: '已选定金',
    confirmOrder: '确认订单',
    mockPay: 'Stripe 测试支付 / Mock 备用',
    discount: '优惠与储值',
    coupon: '新人券',
    balance: '储值余额',
    store: '门店',
    payAction: '支付定金',
    paid: '已确认',
    pending: '待支付',
    memberGrowth: '会员成长值',
    memberCode: '会员码',
    staffScan: '店员扫码',
    referralLink: '分享推荐链接',
    copyMemberLink: '复制推荐链接',
    memberCodeCopied: '推荐链接已复制',
    memberCodeHint: '店员扫码可用于识别客户；分享链接可用于后续推荐返佣追踪。',
    points: '积分',
    coupons: '优惠券',
    orders: '我的订单',
    recent: '近期消费',
    functions: '常用功能',
    assets: '我的资产',
    settings: '设置',
    giftCard: '礼品卡',
    pointsMall: '积分商城',
    completed: '已完成',
    cancelled: '已取消',
    afterSales: '售后',
    all: '全部',
    orderNo: '订单号',
    bookingInfo: '预约信息',
    payment: '支付信息',
    workArchive: '服务留档',
    finalPhotos: '完工作品',
    noWorkImages: '服务完成后会在这里看到作品照片。',
    downloadImage: '下载图片',
    oneClickShare: '一键分享',
    shareReady: '分享文案与链接',
    shareTo: '分享平台',
    shareLink: '分享链接',
    copyCaption: '复制文案',
    openPlatform: '打开平台',
    captionCopied: '文案已复制',
    arrival: '到店时间',
    duration: '服务时长',
    technician: '服务人员',
    address: '地址',
    none: '无',
    paidDeposit: '实付定金',
    finalDue: '到店尾款',
    totalSpent: '累计消费',
    visits: '到店次数',
    times: '次',
    comingSoon: '占位功能',
    back: '返回',
    logout: '退出登录',
    completeFlow: '完整预约流程',
    noSlots: '当天暂无可预约时间',
    created: '已加入购物车',
    paidDone: '定金已支付，预约已确认',
    needLogin: '请先完成注册/登录后继续',
    confirmEmail: '请检查邮箱完成验证，然后再登录。',
    paymentRedirect: '正在跳转到 Stripe 测试支付...',
    sessionExpired: '登录已过期，请重新登录后继续支付。'
  },
  en: {
    registerTitle: 'Create your Lucky Luxe account',
    registerText: 'You can browse as a guest. Booking, checkout, and member pages require sign-in.',
    emailRegister: 'Create Account',
    emailLogin: 'Email Login',
    displayName: 'Name',
    email: 'Email',
    password: 'Password',
    googleRegister: 'Continue with Google',
    continueGuest: 'Continue as Guest',
    enter: 'Enter',
    home: 'Home',
    services: 'Services',
    cart: 'Cart',
    me: 'Me',
    bookNow: 'Book Now',
    viewStore: 'View Store',
    quickNail: 'Nail Services',
    quickLash: 'Lash Services',
    quickMember: 'Member Profile',
    technicianWorks: 'Artist Work',
    technicianPortfolio: 'Artist Portfolio',
    portfolioIntro: 'Browse approved finished work by each artist.',
    noPortfolio: 'No approved work yet. Approved photos will appear here automatically.',
    viewWork: 'View Work',
    popularNail: 'Popular Nail',
    popularLash: 'Popular Lash',
    nail: 'Nail',
    lash: 'Lash',
    minutes: 'min',
    deposit: 'Deposit',
    servicePrice: 'Service price',
    basePrice: 'Base price',
    fixedPrice: 'Fixed price',
    detailedQuote: 'Contact us for a detailed quote',
    finalPriceGuide: 'Confirmed add-ons make the final quote',
    priceBoundary: 'Pricing Guide',
    aiPriceSuggestion: 'AI Price Suggestion',
    manualQuote: 'Contact staff for quote',
    process: 'Service Process',
    notice: 'Notice',
    reference: 'Reference',
    addToCart: 'Add to Cart',
    appointment: 'Appointment',
    artist: 'Artist',
    date: 'Date',
    addOns: 'Add-ons',
    optional: 'Optional',
    remark: 'Notes',
    upload: 'Upload Reference',
    aiAnalyze: 'AI Analyze Reference',
    aiAnalyzing: 'AI is analyzing...',
    aiReferenceTitle: 'AI Style Suggestion',
    aiComplexity: 'Complexity',
    aiExtraTime: 'Suggested extra time',
    aiTechNote: 'Note for technician',
    checkout: 'Checkout',
    saveCart: 'Save to Cart',
    requiredDeposit: 'Deposit due',
    emptyCart: 'Your cart is empty',
    emptyCartHint: 'Choose a service and fill in appointment details.',
    chooseService: 'Choose Service',
    pendingCheckout: 'Pending checkout',
    selectedDeposit: 'Selected deposit',
    confirmOrder: 'Confirm Order',
    mockPay: 'Stripe test payment / mock fallback',
    discount: 'Discount & Balance',
    coupon: 'New member coupon',
    balance: 'Stored balance',
    store: 'Store',
    payAction: 'Pay Deposit',
    paid: 'Confirmed',
    pending: 'Pending payment',
    memberGrowth: 'Member growth',
    memberCode: 'Member Code',
    staffScan: 'Staff Scan',
    referralLink: 'Referral Link',
    copyMemberLink: 'Copy Referral Link',
    memberCodeCopied: 'Referral link copied',
    memberCodeHint: 'Staff can scan this to identify the client; the referral link can track future rewards.',
    points: 'Points',
    coupons: 'Coupons',
    orders: 'My Orders',
    recent: 'Recent Records',
    functions: 'Common Tools',
    assets: 'My Assets',
    settings: 'Settings',
    giftCard: 'Gift Card',
    pointsMall: 'Points Mall',
    completed: 'Completed',
    cancelled: 'Cancelled',
    afterSales: 'After-sales',
    all: 'All',
    orderNo: 'Order No.',
    bookingInfo: 'Booking Info',
    payment: 'Payment',
    workArchive: 'Service Archive',
    finalPhotos: 'Finished Work',
    noWorkImages: 'Finished photos will appear here after the service.',
    downloadImage: 'Download',
    oneClickShare: 'Share',
    shareReady: 'Share copy and links',
    shareTo: 'Platform',
    shareLink: 'Share link',
    copyCaption: 'Copy caption',
    openPlatform: 'Open platform',
    captionCopied: 'Caption copied',
    arrival: 'Arrival',
    duration: 'Duration',
    technician: 'Technician',
    address: 'Address',
    none: 'None',
    paidDeposit: 'Paid Deposit',
    finalDue: 'Final Due',
    totalSpent: 'Total Spent',
    visits: 'Visits',
    times: 'times',
    comingSoon: 'Placeholder',
    back: 'Back',
    logout: 'Log out',
    completeFlow: 'Full booking flow',
    noSlots: 'No available times',
    created: 'Added to cart',
    paidDone: 'Deposit paid. Booking confirmed.',
    needLogin: 'Please register or sign in to continue',
    confirmEmail: 'Please verify your email, then sign in.',
    paymentRedirect: 'Redirecting to Stripe test payment...',
    sessionExpired: 'Your session expired. Please sign in again to continue payment.'
  }
}

const state = {
  lang: localStorage.getItem('lucky-web-lang') || 'zh',
  user: readJson('lucky-web-user'),
  auth: readJson('lucky-web-auth'),
  view: 'home',
  type: 'nail',
  category: 'all',
  services: [],
  stores: [],
  service: null,
  technicians: [],
  portfolios: [],
  selectedPortfolioTechId: '',
  selectedTechId: '',
  date: defaultDate(),
  slotsByTech: [],
  selectedSlot: '',
  addOns: [],
  selectedAddOns: new Set(),
  referenceImages: [],
  referenceAnalysis: null,
  isAnalyzingReference: false,
  remark: '',
  cart: readJson('lucky-web-cart') || [],
  orders: readJson('lucky-web-orders') || [],
  orderFilter: 'all',
  selectedOrderId: '',
  shareOrderId: '',
  sharePlatform: 'xiaohongshu',
  shareCopyByOrder: {},
  shareCopyHistory: readJson('lucky-social-copy-history') || {},
  memberCodeOpen: false,
  pendingAuth: readJson('lucky-web-pending-auth')
}

const els = {
  authView: document.querySelector('#authView'),
  appView: document.querySelector('#appView'),
  screen: document.querySelector('#screen'),
  tabs: [...document.querySelectorAll('.web-tab')],
  cartBadge: document.querySelector('#cartBadge'),
  langZh: document.querySelector('#langZh'),
  langEn: document.querySelector('#langEn'),
  toast: document.querySelector('#toast')
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function defaultDate() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  if (date.getDay() === 1) date.setDate(date.getDate() + 1)
  return formatDate(date)
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function t(key) {
  return copy[state.lang][key] || key
}

function money(cents) {
  return `CAD $${Number(cents / 100).toFixed(0)}`
}

function isNailService(service) {
  return String(service?.type || '').toLowerCase() === 'nail'
}

function priceLabel(service) {
  if (state.lang === 'en') return service.priceLabelEn || `${isNailService(service) ? t('basePrice') : t('fixedPrice')} ${money(service.priceCents)}`
  return service.priceLabelZh || `${isNailService(service) ? t('basePrice') : t('fixedPrice')} ${money(service.priceCents)}`
}

function quoteHint(service) {
  if (state.lang === 'en') return service.quoteHintEn || (isNailService(service) ? t('detailedQuote') : t('finalPriceGuide'))
  return service.quoteHintZh || (isNailService(service) ? t('detailedQuote') : t('finalPriceGuide'))
}

function priceExplanation(service) {
  if (state.lang === 'en') return service.priceExplanationEn || ''
  return service.priceExplanationZh || ''
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function customerVisibleWorkImages(order) {
  if (order?.galleryStatus !== 'approved') return []
  return Array.isArray(order.approvedWorkImages) ? order.approvedWorkImages : []
}

function platformUrl(platform) {
  return {
    xiaohongshu: 'https://www.xiaohongshu.com/',
    douyin: 'https://www.douyin.com/',
    instagram: 'https://www.instagram.com/'
  }[platform] || 'https://www.xiaohongshu.com/'
}

function shareUrlForOrder(orderId, imageIndex = 0, platform = state.sharePlatform) {
  const url = new URL('/web/share.html', window.location.origin)
  url.searchParams.set('bookingId', orderId)
  url.searchParams.set('image', String(imageIndex))
  url.searchParams.set('platform', platform)
  return url.toString()
}

function compactUserCode(user) {
  return `LL-${String(user?.id || user?.email || 'member').replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase().padStart(8, '0')}`
}

function referralCodeFor(user) {
  return user?.referralCode || compactUserCode(user).replace('LL-', 'REF-')
}

function referralUrlFor(user) {
  return user?.referralUrl || `${window.location.origin}/?ref=${encodeURIComponent(referralCodeFor(user))}`
}

function copyFingerprint(copyData) {
  if (!copyData) return ''
  return [copyData.titleZh, copyData.captionZh, copyData.titleEn, copyData.captionEn].filter(Boolean).join('\n')
}

function copyHistoryKey(scope, bookingId, platform) {
  return `${scope}:${bookingId}:${platform}`
}

function usedCopyHistory(scope, bookingId, platform) {
  return state.shareCopyHistory[copyHistoryKey(scope, bookingId, platform)] || []
}

function rememberCopyHistory(scope, bookingId, platform, copyData) {
  const key = copyHistoryKey(scope, bookingId, platform)
  const next = [...new Set([...(state.shareCopyHistory[key] || []), copyFingerprint(copyData)].filter(Boolean))].slice(-20)
  state.shareCopyHistory[key] = next
  writeJson('lucky-social-copy-history', state.shareCopyHistory)
}

function toast(message) {
  els.toast.textContent = message
  els.toast.classList.add('show')
  setTimeout(() => els.toast.classList.remove('show'), 2400)
}

async function request(path, options = {}) {
  const skipAuthRefresh = options.skipAuthRefresh
  delete options.skipAuthRefresh
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(state.auth?.accessToken ? { authorization: `Bearer ${state.auth.accessToken}` } : {}),
      ...(options.headers || {})
    },
    ...options
  })
  const data = await response.json()
  if (!response.ok) {
    const authExpired = isAuthExpiredMessage(data.error?.message)
    if (!skipAuthRefresh && authExpired && state.auth?.refreshToken) {
      const refreshed = await refreshAuth()
      if (refreshed) return request(path, { ...options, skipAuthRefresh: true })
    }
    const error = new Error(data.error?.message || 'Request failed')
    if (authExpired) error.code = 'AUTH_EXPIRED'
    throw error
  }
  return data
}

function isAuthExpiredMessage(message = '') {
  const normalized = String(message).toLowerCase()
  return normalized.includes('jwt') || normalized.includes('expired') || normalized.includes('invalid claims')
}

function clearCustomerAuth() {
  state.user = null
  state.auth = null
  localStorage.removeItem('lucky-web-user')
  localStorage.removeItem('lucky-web-auth')
}

async function refreshAuth() {
  try {
    const data = await request('/auth/refresh', {
      method: 'POST',
      skipAuthRefresh: true,
      body: JSON.stringify({ refreshToken: state.auth?.refreshToken })
    })
    state.user = data.user
    state.auth = data.auth
    writeJson('lucky-web-user', state.user)
    writeJson('lucky-web-auth', state.auth)
    return true
  } catch {
    clearCustomerAuth()
    return false
  }
}

function privateViews() {
  return new Set(['booking', 'cart', 'checkout', 'me', 'orders', 'orderDetail', 'assets', 'coupons', 'giftCard', 'pointsMall', 'settings'])
}

function requiresAuth(view) {
  return privateViews().has(view)
}

function requireLogin(pending = {}) {
  state.pendingAuth = {
    view: pending.view || state.view || 'home',
    serviceId: pending.serviceId || state.service?.id || '',
    bookingMode: pending.bookingMode || ''
  }
  writeJson('lucky-web-pending-auth', state.pendingAuth)
  toast(t('needLogin'))
  renderAuth()
}

function setView(view) {
  if (requiresAuth(view) && !state.user) {
    requireLogin({ view })
    return
  }
  state.view = view
  els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view))
  render()
  if (['me', 'orders'].includes(view) && state.user) {
    loadUserOrders()
      .then(() => {
        if (state.view === view) render()
      })
      .catch((error) => toast(error.message))
  }
}

function categories() {
  const names = [...new Set(state.services.filter((item) => item.type === state.type).map((item) => item.category))]
  return [{ key: 'all', label: state.lang === 'zh' ? '热门推荐' : 'Popular' }, ...names.map((name) => ({ key: name, label: name }))]
}

function servicesByType() {
  return state.services.filter((service) => {
    if (service.type !== state.type) return false
    return state.category === 'all' || service.category === state.category
  })
}

function recommended(type) {
  return state.services.filter((service) => service.type === type).slice(0, 3)
}

async function bootstrap() {
  bindGlobalEvents()
  await Promise.all([loadServices(), loadStores(), loadAddOns(), loadPortfolio()])
  await handleAuthRedirect()
  if (state.user && !state.auth?.accessToken) {
    state.user = null
    localStorage.removeItem('lucky-web-user')
  }
  await handleStripeReturn()
  await showApp()
}

async function handleAuthRedirect() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  if (!accessToken) return
  const data = await request('/auth/session', {
    method: 'POST',
    body: JSON.stringify({ accessToken, refreshToken })
  })
  state.user = data.user
  state.auth = data.auth
  writeJson('lucky-web-user', state.user)
  writeJson('lucky-web-auth', state.auth)
  history.replaceState(null, '', window.location.pathname)
}

async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('payment') !== 'success' || !params.get('session_id')) return
  const data = await request('/payments/stripe/confirm-session', {
    method: 'POST',
    body: JSON.stringify({ sessionId: params.get('session_id') })
  })
  state.orders = [data.booking, ...state.orders.filter((order) => order.id !== data.booking.id)]
  writeJson('lucky-web-orders', state.orders)
  localStorage.removeItem('lucky-web-pending-checkout')
  toast(t('paidDone'))
  state.view = 'me'
  history.replaceState(null, '', window.location.pathname)
}

async function loadServices() {
  const [nail, lash] = await Promise.all([
    request(`/services?type=nail&lang=${state.lang}`),
    request(`/services?type=lash&lang=${state.lang}`)
  ])
  state.services = [...nail.services, ...lash.services]
}

async function loadStores() {
  const data = await request('/stores')
  state.stores = data.stores
}

async function loadAddOns() {
  const data = await request('/add-ons')
  state.addOns = data.addOns
}

async function loadPortfolio() {
  const data = await request('/portfolio')
  state.portfolios = data.portfolios || []
}

async function loadUserOrders() {
  if (!state.user) return
  const data = await request(`/bookings?lang=${state.lang}`)
  state.orders = data.bookings || []
  writeJson('lucky-web-orders', state.orders)
}

function bindGlobalEvents() {
  els.langZh.addEventListener('click', async () => switchLang('zh'))
  els.langEn.addEventListener('click', async () => switchLang('en'))
  els.tabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)))
  els.authView.addEventListener('submit', registerEmail)
  els.authView.addEventListener('click', (event) => {
    if (event.target.closest('#googleRegister')) registerGoogle().catch((error) => toast(error.message))
    if (event.target.closest('#continueGuest')) {
      state.pendingAuth = null
      localStorage.removeItem('lucky-web-pending-auth')
      showApp().catch((error) => toast(error.message))
    }
  })
  els.screen.addEventListener('click', handleScreenClick)
  els.screen.addEventListener('change', handleScreenChange)
  els.screen.addEventListener('input', handleScreenInput)
}

async function switchLang(lang) {
  state.lang = lang
  localStorage.setItem('lucky-web-lang', lang)
  els.langZh.classList.toggle('active', lang === 'zh')
  els.langEn.classList.toggle('active', lang === 'en')
  await loadServices()
  await loadPortfolio()
  if (state.service) state.service = state.services.find((item) => item.id === state.service.id) || state.service
  render()
  if (!els.authView.classList.contains('hidden')) renderAuth()
}

function renderAuth() {
  els.authView.classList.remove('hidden')
  els.appView.classList.add('hidden')
  els.langZh.classList.toggle('active', state.lang === 'zh')
  els.langEn.classList.toggle('active', state.lang === 'en')
  els.authView.innerHTML = `
    <div class="auth-card">
      <div>
        <p class="eyebrow">Lucky Luxe Web</p>
        <h1>${t('registerTitle')}</h1>
        <p>${t('registerText')}</p>
      </div>
      <form class="auth-form" id="emailForm">
        <label>
          <span>${t('displayName')}</span>
          <input name="displayName" autocomplete="name">
        </label>
        <label>
          <span>${t('email')}</span>
          <input name="email" type="email" autocomplete="email">
        </label>
        <label>
          <span>${t('password')}</span>
          <input name="password" type="password" value="" minlength="6" autocomplete="current-password">
        </label>
        <button class="primary full" data-auth-action="register" type="submit">${t('emailRegister')}</button>
        <button class="ghost full" data-auth-action="login" type="submit">${t('emailLogin')}</button>
      </form>
      <button class="google-btn" id="googleRegister" type="button">
        <span>G</span>
        ${t('googleRegister')}
      </button>
      <button class="ghost full" id="continueGuest" type="button">${t('continueGuest')}</button>
    </div>
    <div class="auth-visual">
      <img src="/assets/images/store-cover.png" alt="Lucky Luxe">
    </div>
  `
}

async function registerEmail(event) {
  event.preventDefault()
  const form = new FormData(event.target)
  const action = event.submitter?.dataset.authAction || 'register'
  const data = await request(action === 'login' ? '/auth/email/login' : '/auth/email/register', {
    method: 'POST',
    body: JSON.stringify({
      displayName: form.get('displayName'),
      email: form.get('email'),
      password: form.get('password')
    })
  })
  if (data.needsEmailConfirmation) {
    toast(t('confirmEmail'))
    return
  }
  state.user = data.user
  state.auth = data.auth
  writeJson('lucky-web-user', state.user)
  writeJson('lucky-web-auth', state.auth)
  await showApp()
}

async function registerGoogle() {
  const data = await request(`/auth/google/start?redirectTo=${encodeURIComponent(window.location.origin + window.location.pathname)}`)
  window.location.href = data.url
}

async function showApp() {
  els.authView.classList.add('hidden')
  els.appView.classList.remove('hidden')
  els.langZh.classList.toggle('active', state.lang === 'zh')
  els.langEn.classList.toggle('active', state.lang === 'en')
  if (state.user) {
    try {
      await loadUserOrders()
    } catch (error) {
      toast(error.message)
    }
  }
  const pending = state.user ? state.pendingAuth : null
  if (pending) {
    state.pendingAuth = null
    localStorage.removeItem('lucky-web-pending-auth')
    if (pending.serviceId) state.service = state.services.find((item) => item.id === pending.serviceId) || state.service
    if (pending.bookingMode && state.service) {
      await prepareBooking(pending.bookingMode, { skipAuth: true })
      return
    }
    state.view = pending.view || state.view || 'home'
  }
  if (requiresAuth(state.view) && !state.user) state.view = 'home'
  render()
}

function render() {
  els.cartBadge.textContent = state.cart.length
  els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.view))
  if (state.view === 'home') renderHome()
  if (state.view === 'services') renderServices()
  if (state.view === 'detail') renderDetail()
  if (state.view === 'booking') renderBookingForm()
  if (state.view === 'cart') renderCart()
  if (state.view === 'checkout') renderCheckout()
  if (state.view === 'me') renderMe()
  if (state.view === 'orders') renderOrdersWeb()
  if (state.view === 'orderDetail') renderOrderDetailWeb()
  if (state.view === 'assets') renderAssetsWeb()
  if (state.view === 'store') renderStoreWeb()
  if (state.view === 'portfolio') renderPortfolio()
  if (state.view === 'coupons') renderPlaceholderWeb(t('coupons'), state.lang === 'zh' ? '优惠券列表和使用规则将在真实会员系统接入后同步。' : 'Coupon list and rules will sync after the real member system is connected.')
  if (state.view === 'giftCard') renderPlaceholderWeb(t('giftCard'), state.lang === 'zh' ? '礼品卡售卖与兑换功能保留为下一阶段。' : 'Gift card purchase and redemption is reserved for the next phase.')
  if (state.view === 'pointsMall') renderPlaceholderWeb(t('pointsMall'), state.lang === 'zh' ? '积分商城规则目前使用占位，后续可按会员规则兑换。' : 'The points mall currently uses placeholder rules.')
  if (state.view === 'settings') renderPlaceholderWeb(t('settings'), state.lang === 'zh' ? '语言、通知、账号安全等设置将在真实登录后接入。' : 'Language, notifications, and account security settings will connect after real auth.')
}

function renderHome() {
  els.screen.innerHTML = `
    <section class="web-hero">
      <div class="web-hero-copy">
        <span class="brand-mark hero-logo-mark"><img src="/assets/images/brand-logo.png" alt="Lucky Luxe"></span>
        <p class="eyebrow">Nail & Lash Atelier</p>
        <h1>Lucky Luxe</h1>
        <p>${state.lang === 'zh' ? '预约美甲与美睫，在线支付定金，到店完成尾款。' : 'Book nail and lash services online, pay the deposit, and settle the balance in store.'}</p>
        <div class="hero-actions">
          <button class="primary" data-go-services="nail" type="button">${t('bookNow')}</button>
          <button class="ghost" data-view-target="me" type="button">${t('quickMember')}</button>
        </div>
      </div>
      <img src="/assets/images/store-cover.png" alt="Lucky Luxe">
    </section>
    <section class="home-actions section">
      <div class="service-shortcut-row">
        <button class="quick-item card" data-go-services="nail" type="button"><span class="quick-icon">N</span><span>${t('quickNail')}</span></button>
        <button class="quick-item card" data-go-services="lash" type="button"><span class="quick-icon">L</span><span>${t('quickLash')}</span></button>
      </div>
      <button class="portfolio-wide-button card" data-view-target="portfolio" type="button">
        <span class="quick-icon">P</span>
        <span><strong>${t('technicianWorks')}</strong><small>${t('portfolioIntro')}</small></span>
        <span class="portfolio-arrow">→</span>
      </button>
    </section>
    ${renderRecommendSection(t('popularNail'), 'nail')}
    ${renderRecommendSection(t('popularLash'), 'lash')}
    <section class="section">
      <div class="section-row"><h2>${t('store')}</h2><span class="subtle">Ontario · CAD</span></div>
      <div class="store-card-wide card">
        <img src="/assets/images/store-cover.png" alt="Store">
        <div>
          <h3>Lucky Luxe Ontario</h3>
          <p>Tuesday-Sunday 10:00-19:00 · Monday closed</p>
          <p>Address TBD · Phone TBD</p>
        </div>
      </div>
    </section>
  `
}

function renderRecommendSection(title, type) {
  return `
    <section class="section">
      <div class="section-row"><h2>${title}</h2><span class="subtle">${type}</span></div>
      <div class="recommend-strip">
        ${recommended(type).map((service) => `
          <button class="recommend-card card" data-service-id="${service.id}" type="button">
            <img src="${service.imageUrl}" alt="${service.name}">
            <strong>${service.name}</strong>
            <span>${money(service.priceCents)} · ${service.durationMin}${t('minutes')}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `
}

function portfolioImages() {
  return effectivePortfolios().flatMap((portfolio) => (portfolio.images || []).map((image) => ({
    image,
    technician: portfolio.technician
  })))
}

function effectivePortfolios() {
  if (state.portfolios.length) return state.portfolios
  return [
    {
      technician: { id: 'tech-lina-demo', name: 'Lina Zhou', title: state.lang === 'zh' ? '法式 / 日式微闪 / 轻奢设计' : 'French / Japanese Shimmer / Soft Luxe' },
      images: ['/assets/images/nail-french.png', '/assets/images/nail-luxe.png', '/assets/images/nail-jp.png', '/assets/images/nail-addon.png']
    },
    {
      technician: { id: 'tech-mia-demo', name: 'Mia Chen', title: state.lang === 'zh' ? '自然美睫 / 裸感款 / 轻盈浓密' : 'Natural Lash / Bare Look / Soft Volume' },
      images: ['/assets/images/lash-natural.png', '/assets/images/lash-volume.png', '/assets/images/lash-lower.png', '/assets/images/lash-remove.png']
    },
    {
      technician: { id: 'tech-ava-demo', name: 'Ava Lin', title: state.lang === 'zh' ? '基础护理 / 短甲显白 / 日常维护' : 'Care / Short Nails / Daily Maintenance' },
      images: ['/assets/images/nail-care.png', '/assets/images/nail-jp.png', '/assets/images/nail-french.png']
    }
  ]
}

function renderPortfolio() {
  const portfolios = effectivePortfolios()
  const selected = portfolios.find((portfolio) => portfolio.technician?.id === state.selectedPortfolioTechId)
  els.screen.innerHTML = `
    <section class="portfolio-page-web">
      <button class="ghost back-btn" ${selected ? 'data-portfolio-back' : 'data-view-target="home"'} type="button">← ${selected ? t('technicianPortfolio') : t('home')}</button>
      <div class="section-row">
        <div>
          <p class="eyebrow">Lucky Luxe</p>
          <h1>${selected ? selected.technician?.name : t('technicianPortfolio')}</h1>
          <span class="subtle">${selected ? selected.technician?.title : t('portfolioIntro')}</span>
        </div>
      </div>
      ${selected ? `
        <div class="technician-work-grid">
          ${(selected.images || []).map((image, index) => `
            <a href="${image}" target="_blank" rel="noreferrer">
              <img src="${image}" alt="${selected.technician?.name || 'Lucky Luxe'} ${index + 1}">
            </a>
          `).join('')}
        </div>
      ` : portfolios.map((portfolio) => `
        <section class="technician-portfolio-section card">
          <div class="section-row compact-row">
            <div>
              <h2>${portfolio.technician?.name || 'Lucky Luxe'}</h2>
              <p>${portfolio.technician?.title || (state.lang === 'zh' ? '美甲 / 美睫技师' : 'Nail / Lash Artist')}</p>
            </div>
            <button class="ghost slim" data-portfolio-tech="${portfolio.technician?.id || ''}" type="button">${t('viewWork')}</button>
          </div>
          <div class="portfolio-preview-grid">
            ${(portfolio.images || []).slice(0, 4).map((image, index) => `
              <button class="portfolio-preview-card" data-portfolio-tech="${portfolio.technician?.id || ''}" type="button">
                <img src="${image}" alt="${portfolio.technician?.name || 'Lucky Luxe'} ${index + 1}">
              </button>
            `).join('')}
          </div>
        </section>
      `).join('')}
    </section>
  `
}

function renderServices() {
  const cats = categories()
  const list = servicesByType()
  els.screen.innerHTML = `
    <section class="service-web-page">
      <div class="service-toolbar">
        <h1>Lucky Luxe</h1>
        <div class="segmented compact">
          <button class="segment ${state.type === 'nail' ? 'active' : ''}" data-type="nail" type="button">${t('nail')}</button>
          <button class="segment ${state.type === 'lash' ? 'active' : ''}" data-type="lash" type="button">${t('lash')}</button>
        </div>
      </div>
      <div class="service-layout-web">
        <aside class="category-rail">
          ${cats.map((cat) => `<button class="${state.category === cat.key ? 'active' : ''}" data-category="${cat.key}" type="button">${cat.label}</button>`).join('')}
        </aside>
        <div class="service-list-web">
          ${list.map((service) => renderServiceCard(service)).join('')}
        </div>
      </div>
    </section>
  `
}

function renderServiceCard(service) {
  return `
    <button class="service-card web-service-card" data-service-id="${service.id}" type="button">
      <img src="${service.imageUrl}" alt="${service.name}">
      <span>
        <span class="eyebrow">${service.category}</span>
        <h2>${service.name}</h2>
        <p>${service.description}</p>
        <span class="meta">
          <span class="price">${priceLabel(service)}</span>
          <span>${service.durationMin}${t('minutes')}</span>
          <span>${t('deposit')} ${money(service.depositCents)}</span>
        </span>
        <small class="quote-hint">${quoteHint(service)}</small>
      </span>
    </button>
  `
}

function renderDetail() {
  const service = state.service
  if (!service) return renderServices()
  els.screen.innerHTML = `
    <section class="detail-web">
      <button class="ghost back-btn" data-view-target="services" type="button">← ${t('services')}</button>
      <img class="detail-visual-web" src="${service.imageUrl}" alt="${service.name}">
      <div class="detail-main card">
        <h1>${service.name}</h1>
        <p>${service.description}</p>
        <div class="detail-price-row">
          <span><strong class="price">${priceLabel(service)}</strong></span>
          <span class="deposit">${t('deposit')} ${money(service.depositCents)}</span>
        </div>
        <div class="price-boundary-box">
          <strong>${t('priceBoundary')}</strong>
          <p>${escapeHtml(priceExplanation(service))}</p>
          <small>${escapeHtml(quoteHint(service))}</small>
        </div>
        <div class="detail-tags">
          <span>${service.durationMin}${t('minutes')}</span>
          <span>${state.lang === 'zh' ? '适合想要高质感、稳定服务体验的客人。' : 'For guests who want a polished and reliable service experience.'}</span>
        </div>
      </div>
      <div class="detail-columns">
        ${renderListCard(t('process'), service.process)}
        ${renderListCard(t('notice'), service.notice)}
      </div>
      <section class="section">
        <div class="section-row"><h2>${t('reference')}</h2><span class="subtle">Preview</span></div>
        <div class="reference-grid-web">
          <img src="${service.imageUrl}" alt="${service.name}">
          <img src="${service.imageUrl}" alt="${service.name}">
        </div>
      </section>
      <div class="bottom-action-web">
        <button class="ghost" data-start-booking="cart" type="button">${t('addToCart')}</button>
        <button class="primary" data-start-booking="checkout" type="button">${t('bookNow')}</button>
      </div>
    </section>
  `
}

function renderListCard(title, items) {
  return `
    <section class="card list-card-web">
      <h2>${title}</h2>
      ${items.map((item, index) => `<p><span>${index + 1}</span>${item}</p>`).join('')}
    </section>
  `
}

async function prepareBooking(mode, options = {}) {
  if (!state.user && !options.skipAuth) {
    requireLogin({ view: 'booking', serviceId: state.service?.id, bookingMode: mode })
    return
  }
  state.bookingMode = mode
  state.selectedAddOns = new Set()
  state.referenceImages = []
  state.referenceAnalysis = null
  state.isAnalyzingReference = false
  state.remark = ''
  await loadTechnicians()
  await loadAvailability()
  state.view = 'booking'
  render()
}

async function loadTechnicians() {
  const data = await request(`/technicians?storeId=${storeId}&serviceId=${state.service.id}`)
  state.technicians = data.technicians
  state.selectedTechId = state.technicians[0]?.id || ''
}

async function loadAvailability() {
  const extraDuration = state.addOns
    .filter((item) => state.selectedAddOns.has(item.id))
    .reduce((total, item) => total + item.durationMin, 0)
  const data = await request(`/availability?storeId=${storeId}&serviceId=${state.service.id}&date=${state.date}&extraDurationMin=${extraDuration}`)
  state.slotsByTech = data.slots
  const entry = state.slotsByTech.find((item) => item.technician.id === state.selectedTechId)
  if (!entry?.slots.includes(state.selectedSlot)) state.selectedSlot = entry?.slots[0] || ''
}

function renderBookingForm() {
  const service = state.service
  const entry = state.slotsByTech.find((item) => item.technician.id === state.selectedTechId)
  const slots = entry?.slots || []
  els.screen.innerHTML = `
    <section class="booking-flow">
      <button class="ghost back-btn" data-view-target="detail" type="button">← ${service.name}</button>
      <div class="booking-service card">
        <img class="mini-visual-web" src="${service.imageUrl}" alt="${service.name}">
        <div>
          <h2>${service.name}</h2>
          <p>${service.durationMin}${t('minutes')} · ${t('deposit')} ${money(service.depositCents)}</p>
        </div>
      </div>
      <section class="section">
        <div class="section-row"><h2>${t('appointment')}</h2><span class="subtle">${t('completeFlow')}</span></div>
        <div class="form-card card">
          <div class="form-grid">
            <label><span>${t('artist')}</span><select data-field="tech">${state.technicians.map((tech) => `<option value="${tech.id}" ${tech.id === state.selectedTechId ? 'selected' : ''}>${tech.name} · ${tech.title}</option>`).join('')}</select></label>
            <label><span>${t('date')}</span><input data-field="date" type="date" value="${state.date}"></label>
          </div>
          <div class="slot-grid booking-slots">
            ${slots.length ? slots.map((slot) => `<button class="slot ${slot === state.selectedSlot ? 'active' : ''}" data-slot="${slot}" type="button">${slot}</button>`).join('') : `<div class="empty-state">${t('noSlots')}</div>`}
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('addOns')}</h2><span class="subtle">${t('optional')}</span></div>
        <div class="addon-grid">${state.addOns.map((item) => `
          <button class="addon ${state.selectedAddOns.has(item.id) ? 'active' : ''}" data-addon="${item.id}" type="button">
            <strong>${item.name}</strong>
            <small>+${money(item.priceCents)} · +${item.durationMin}${t('minutes')}</small>
          </button>
        `).join('')}</div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('reference')}</h2><span class="subtle">${state.referenceImages.length}/3</span></div>
        <div class="reference-upload-grid">
          <label class="upload-box-web card">
            <input data-reference-input type="file" accept="image/*" multiple>
            <span>${t('upload')}</span>
            <small>${state.lang === 'zh' ? '最多 3 张，可选设计或灵感图' : 'Up to 3 design or inspiration images'}</small>
          </label>
          ${state.referenceImages.map((image, index) => `
            <div class="reference-thumb card">
              <img src="${image}" alt="${t('reference')} ${index + 1}">
              <button class="ghost mini-remove" data-remove-reference="${index}" type="button">×</button>
            </div>
          `).join('')}
        </div>
        <div class="ai-reference-panel card">
          <div>
            <strong>${t('aiReferenceTitle')}</strong>
            <p>${state.lang === 'zh' ? '上传参考图后，可让 AI 初步判断款式复杂度和加项建议。' : 'After uploading references, AI can estimate complexity and add-on suggestions.'}</p>
          </div>
          <button class="ghost slim" data-ai-reference type="button" ${state.referenceImages.length ? '' : 'disabled'}>${state.isAnalyzingReference ? t('aiAnalyzing') : t('aiAnalyze')}</button>
          ${state.referenceAnalysis ? renderReferenceAnalysis() : ''}
        </div>
      </section>
      <label class="notes"><span>${t('remark')}</span><textarea data-field="remark" rows="3">${state.remark}</textarea></label>
      <div class="summary-bar">
        <div><span>${t('requiredDeposit')}</span><strong>${money(service.depositCents)}</strong></div>
        <button class="ghost" data-save-cart type="button">${t('saveCart')}</button>
        <button class="primary" data-checkout-now type="button">${t('checkout')}</button>
      </div>
    </section>
  `
}

function renderReferenceAnalysis() {
  const result = state.referenceAnalysis?.data || state.referenceAnalysis || {}
  const clientMessage = state.lang === 'en' ? result.clientMessageEn : result.clientMessageZh
  const techNote = state.lang === 'en' ? result.technicianNotesEn : result.technicianNotesZh
  return `
    <div class="ai-result-box">
      <p><span>${t('aiComplexity')}</span><strong>${result.complexity || '-'}</strong></p>
      <p><span>${t('aiExtraTime')}</span><strong>${result.estimatedExtraMinutes || 0}${t('minutes')}</strong></p>
      <p><span>${t('aiPriceSuggestion')}</span><strong>${result.estimatedPriceCents ? money(result.estimatedPriceCents) : '-'}</strong></p>
      ${result.manualQuoteRequired ? `<p><span>${t('manualQuote')}</span><strong>${state.lang === 'zh' ? '建议人工确认' : 'Recommended'}</strong></p>` : ''}
      <p><span>${t('aiTechNote')}</span><strong>${escapeHtml(techNote || '')}</strong></p>
      <small>${escapeHtml((state.lang === 'en' ? result.priceMessageEn : result.priceMessageZh) || clientMessage || '')}</small>
    </div>
  `
}

function buildCartItem() {
  const selectedAddOns = state.addOns.filter((item) => state.selectedAddOns.has(item.id))
  const tech = state.technicians.find((item) => item.id === state.selectedTechId)
  const addonTotal = selectedAddOns.reduce((total, item) => total + item.priceCents, 0)
  const aiNote = state.referenceAnalysis?.data
    ? (state.lang === 'en' ? state.referenceAnalysis.data.technicianNotesEn : state.referenceAnalysis.data.technicianNotesZh)
    : ''
  return {
    id: `cart_${Date.now()}`,
    service: state.service,
    technician: tech,
    date: state.date,
    time: state.selectedSlot,
    addOns: selectedAddOns,
    referenceImages: [...state.referenceImages],
    remark: [state.remark, aiNote ? `AI: ${aiNote}` : ''].filter(Boolean).join('\n'),
    referenceAnalysis: state.referenceAnalysis,
    servicePriceCents: state.service.priceCents + addonTotal,
    depositCents: state.service.depositCents,
    selected: true
  }
}

function saveCurrentToCart(goCheckout = false) {
  if (!state.selectedSlot) return toast(t('noSlots'))
  const item = buildCartItem()
  state.cart.push(item)
  writeJson('lucky-web-cart', state.cart)
  toast(t('created'))
  state.view = goCheckout ? 'checkout' : 'cart'
  render()
}

function renderCart() {
  const total = state.cart.filter((item) => item.selected).reduce((sum, item) => sum + item.depositCents, 0)
  els.screen.innerHTML = `
    <section class="cart-page-web">
      <div class="section-row"><h1>${t('cart')}</h1><span class="subtle">${t('pendingCheckout')}</span></div>
      ${state.cart.length ? state.cart.map((item) => renderCartItem(item)).join('') : `
        <div class="empty-state tall"><strong>${t('emptyCart')}</strong><span>${t('emptyCartHint')}</span><button class="primary" data-view-target="services" type="button">${t('chooseService')}</button></div>
      `}
      ${state.cart.length ? `
        <div class="summary-bar">
          <div><span>${t('selectedDeposit')}</span><strong>${money(total)}</strong></div>
          <button class="primary" data-view-target="checkout" type="button">${t('checkout')}</button>
        </div>` : ''}
    </section>
  `
}

function renderCartItem(item) {
  return `
    <article class="cart-card-web card">
      <button class="check ${item.selected ? 'checked' : ''}" data-toggle-cart="${item.id}" type="button">${item.selected ? '✓' : ''}</button>
      <div class="cart-copy">
        <div class="cart-title-row"><h2>${item.service.name}</h2><span class="status">${t('pendingCheckout')}</span></div>
        <p>${item.date} · ${item.time} · ${item.technician.name}</p>
        <p><strong>${t('deposit')} ${money(item.depositCents)}</strong> · ${t('servicePrice')} ${money(item.servicePriceCents)}</p>
        ${item.referenceImages?.length ? `<div class="cart-reference-row">${item.referenceImages.map((image, index) => `<img src="${image}" alt="${t('reference')} ${index + 1}">`).join('')}</div>` : ''}
      </div>
      <img src="${item.service.imageUrl}" alt="${item.service.name}">
      <button class="ghost" data-remove-cart="${item.id}" type="button">Remove</button>
    </article>
  `
}

function renderCheckout() {
  const selected = state.cart.filter((item) => item.selected)
  const deposit = selected.reduce((sum, item) => sum + item.depositCents, 0)
  const coupon = 0
  const payable = deposit
  els.screen.innerHTML = `
    <section class="checkout-page-web">
      <div class="section-row"><h1>${t('confirmOrder')}</h1><span class="subtle">${t('mockPay')}</span></div>
      ${selected.length ? selected.map((item) => `
        <article class="checkout-item-web card">
          <div class="checkout-copy-web">
            <h2>${item.service.name}</h2>
            <div class="checkout-meta-web">
              <span>${item.date}</span>
              <span>${item.time}</span>
              <span>${item.technician.name}</span>
            </div>
            <p><strong>${t('deposit')} ${money(item.depositCents)}</strong><span>${t('servicePrice')} ${money(item.servicePriceCents)}</span></p>
            ${item.referenceImages?.length ? `<div class="cart-reference-row">${item.referenceImages.map((image, index) => `<img src="${image}" alt="${t('reference')} ${index + 1}">`).join('')}</div>` : ''}
          </div>
        </article>
      `).join('') : `<div class="empty-state">${t('emptyCart')}</div>`}
      <section class="section">
        <div class="section-row"><h2>${t('discount')}</h2></div>
        <div class="cost-card card">
          <p><span>${t('appointment')}</span><strong>${money(deposit)}</strong></p>
          <p><span>${t('coupon')}</span><strong>-${money(coupon)}</strong></p>
          <p><span>${t('balance')}</span><strong>CAD $300</strong></p>
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('store')}</h2></div>
        <div class="store-box card"><strong>Lucky Luxe Ontario</strong><span>Address TBD · Phone TBD · Tue-Sun 10:00-19:00</span></div>
      </section>
      <div class="summary-bar">
        <div><span>${t('requiredDeposit')}</span><strong>${money(payable)}</strong></div>
        <button class="primary" data-submit-payment type="button" ${selected.length ? '' : 'disabled'}>${t('payAction')}</button>
      </div>
    </section>
  `
}

async function submitPayment() {
  if (!state.user) {
    requireLogin({ view: 'checkout' })
    return
  }
  const selected = state.cart.filter((item) => item.selected)
  const completed = []
  for (const item of selected) {
    const bookingData = await request('/bookings', {
      method: 'POST',
      body: JSON.stringify({
        userId: state.user.id,
        storeId,
        serviceId: item.service.id,
        technicianId: item.technician.id,
        date: item.date,
        time: item.time,
        addOns: item.addOns,
        referenceImages: item.referenceImages || [],
        notes: item.remark
      })
    })
    const checkout = await request('/payments/stripe/create-checkout', {
      method: 'POST',
      body: JSON.stringify({ bookingId: bookingData.booking.id })
    })
    if (checkout.checkoutUrl) {
      writeJson('lucky-web-pending-checkout', { bookingId: bookingData.booking.id, cartItemId: item.id })
      toast(t('paymentRedirect'))
      window.location.href = checkout.checkoutUrl
      return
    }
    completed.push(checkout.booking)
  }
  const selectedIds = new Set(selected.map((item) => item.id))
  state.cart = state.cart.filter((item) => !selectedIds.has(item.id))
  state.orders = [...completed, ...state.orders]
  writeJson('lucky-web-cart', state.cart)
  writeJson('lucky-web-orders', state.orders)
  toast(t('paidDone'))
  state.view = 'me'
  render()
}

function renderMe() {
  const user = state.user
  const memberCode = user.memberCode || compactUserCode(user)
  const referralCode = referralCodeFor(user)
  const referralUrl = referralUrlFor(user)
  const counts = {
    pending: state.orders.filter((item) => item.status === 'CONFIRMED').length,
    completed: state.orders.filter((item) => item.status === 'COMPLETED').length,
    cancelled: state.orders.filter((item) => item.status === 'CANCELLED').length,
    afterSales: 0
  }
  els.screen.innerHTML = `
    <section class="me-web">
      <div class="member-card web-member-card">
        <div class="member-top">
          <div class="member-identity">
            <img class="avatar" src="/assets/images/member-profile.png" alt="${user.displayName}">
            <div><h1>${user.displayName}</h1><p>${user.memberLevel} · ${user.provider}</p></div>
          </div>
          <button class="member-code-chip" data-toggle-member-code type="button" aria-label="${t('memberCode')} ${memberCode}">
            <span class="mini-qr">
              ${Array.from({ length: 25 }, (_, index) => `<i class="${(index + memberCode.charCodeAt(index % memberCode.length)) % 3 === 0 ? 'on' : ''}"></i>`).join('')}
            </span>
            <small>${t('memberCode')}</small>
          </button>
        </div>
        ${state.memberCodeOpen ? `
          <div class="member-code-detail">
            <div>
              <p class="eyebrow">${t('memberCode')}</p>
              <h2>${memberCode}</h2>
              <p>${t('memberCodeHint')}</p>
              <div class="member-code-meta">
                <span>${t('staffScan')}</span>
                <strong>${referralCode}</strong>
              </div>
            </div>
            <div class="member-referral-row">
              <code>${referralUrl}</code>
              <button class="primary slim" data-copy-member-link type="button">${t('copyMemberLink')}</button>
            </div>
          </div>
        ` : ''}
        <div class="growth-block">
          <div class="growth-head"><span>${t('memberGrowth')}</span><span>${user.growthValue} / ${user.nextLevelValue}</span></div>
          <div class="growth-track"><div class="growth-fill" style="width:${Math.round(user.growthValue / user.nextLevelValue * 100)}%"></div></div>
        </div>
        <div class="member-assets">
          <div><strong>${user.points}</strong><span>${t('points')}</span></div>
          <div><strong>${user.couponCount}</strong><span>${t('coupons')}</span></div>
          <div><strong>${money(user.balanceCents)}</strong><span>${t('balance')}</span></div>
        </div>
        <div class="member-extra web-member-extra">
          <div>${t('totalSpent')} ${money(user.totalSpentCents || 0)}</div>
          <div>${t('visits')} ${user.visits || 0} ${t('times')}</div>
        </div>
      </div>
      <section class="section">
        <div class="section-row"><h2>${t('orders')}</h2><button class="section-note-btn" data-order-filter="all" type="button">${t('all')}</button></div>
        <div class="order-entry card">
          <button data-order-filter="CONFIRMED" type="button"><strong>${counts.pending}</strong><span>${t('paid')}</span></button>
          <button data-order-filter="COMPLETED" type="button"><strong>${counts.completed}</strong><span>${t('completed')}</span></button>
          <button data-order-filter="CANCELLED" type="button"><strong>${counts.cancelled}</strong><span>${t('cancelled')}</span></button>
          <button data-order-filter="AFTER_SALES" type="button"><strong>${counts.afterSales}</strong><span>${t('afterSales')}</span></button>
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('recent')}</h2><span class="subtle">Records</span></div>
        <div class="recent-list-web">
          ${state.orders.length ? state.orders.map((order) => `
            <button class="recent-card-web card" data-order-id="${order.id}" type="button">
              <img src="${order.status === 'COMPLETED' && customerVisibleWorkImages(order)[0] ? customerVisibleWorkImages(order)[0] : order.service.imageUrl}" alt="${order.service.name}">
              <div>
                <div class="recent-top"><strong>${order.service.name}</strong><span>${statusLabel(order.status)}</span></div>
                <p>${order.appointmentDate} ${order.appointmentTime} · ${order.technician.name}</p>
                <p>${t('paidDeposit')} ${money(order.depositCents)}</p>
                ${order.status === 'COMPLETED' && customerVisibleWorkImages(order).length ? `<p>${t('finalPhotos')} · ${customerVisibleWorkImages(order).length}</p>` : ''}
              </div>
            </button>
          `).join('') : `<div class="empty-state">${state.lang === 'zh' ? '暂无消费记录' : 'No records yet'}</div>`}
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('functions')}</h2></div>
        <div class="menu-grid-web">
          ${[
            [t('assets'), '/assets/images/nail-luxe.png', 'assets'],
            [t('store'), '/assets/images/store-cover.png', 'store'],
            [t('coupons'), '/assets/images/nail-french.png', 'coupons'],
            [t('giftCard'), '/assets/images/lash-volume.png', 'giftCard'],
            [t('pointsMall'), '/assets/images/nail-jp.png', 'pointsMall'],
            [t('settings'), '/assets/images/lash-natural.png', 'settings']
          ].map(([label, image, target]) => `<button class="menu-card card" data-me-target="${target}" type="button"><img src="${image}" alt="${label}"><strong>${label}</strong><span>${t('comingSoon')}</span></button>`).join('')}
        </div>
      </section>
      <button class="ghost logout-btn" data-logout type="button">${t('logout')}</button>
    </section>
  `
}

function statusLabel(status) {
  const zh = {
    all: t('all'),
    PENDING_PAYMENT: t('pending'),
    CONFIRMED: t('paid'),
    COMPLETED: t('completed'),
    CANCELLED: t('cancelled'),
    EXPIRED: 'Expired',
    AFTER_SALES: t('afterSales')
  }
  return zh[status] || status
}

async function refreshOrder(id) {
  try {
    const data = await request(`/bookings/${id}?lang=${state.lang}`)
    state.orders = [data.booking, ...state.orders.filter((order) => order.id !== data.booking.id)]
    writeJson('lucky-web-orders', state.orders)
  } catch (error) {
    toast(error.message)
  }
}

async function generateCustomerShareCopy(order, platform = state.sharePlatform) {
  const images = customerVisibleWorkImages(order)
  const data = await request('/ai/social-copy', {
    method: 'POST',
    body: JSON.stringify({
      lang: state.lang,
      bookingId: order.id,
      image: images[0] || order.service?.imageUrl || '',
      platform,
      audience: 'customer',
      variantSeed: `${Date.now()}:${Math.random()}`,
      avoidCaptions: usedCopyHistory('customer', order.id, platform)
    })
  })
  const copyData = data.copy?.data || data.copy
  state.shareCopyByOrder[order.id] = {
    ...(state.shareCopyByOrder[order.id] || {}),
    [platform]: copyData
  }
  rememberCopyHistory('customer', order.id, platform, copyData)
}

function filteredOrders() {
  if (state.orderFilter === 'all') return state.orders
  return state.orders.filter((order) => order.status === state.orderFilter)
}

function renderOrdersWeb() {
  const tabs = [
    ['all', t('all')],
    ['CONFIRMED', t('paid')],
    ['COMPLETED', t('completed')],
    ['CANCELLED', t('cancelled')],
    ['AFTER_SALES', t('afterSales')]
  ]
  const orders = filteredOrders()
  els.screen.innerHTML = `
    <section class="orders-web-page">
      <button class="ghost back-btn" data-view-target="me" type="button">← ${t('me')}</button>
      <div class="section-row"><h1>${t('orders')}</h1><span class="subtle">${statusLabel(state.orderFilter)}</span></div>
      <div class="order-tabs-web">
        ${tabs.map(([key, label]) => `<button class="${state.orderFilter === key ? 'active' : ''}" data-order-filter="${key}" type="button">${label}</button>`).join('')}
      </div>
      <div class="order-list-web">
          ${orders.length ? orders.map((order) => `
          <button class="order-card-web card" data-order-id="${order.id}" type="button">
            <div class="order-head-web"><strong>${order.service.name}</strong><span>${statusLabel(order.status)}</span></div>
            <div class="order-body-web">
              <img src="${order.status === 'COMPLETED' && customerVisibleWorkImages(order)[0] ? customerVisibleWorkImages(order)[0] : order.service.imageUrl}" alt="${order.service.name}">
              <div>
                <p>${order.appointmentDate} ${order.appointmentTime}</p>
                <p>${order.technician.name} · ${order.store.name}</p>
                <p class="price">${t('paidDeposit')} ${money(order.depositCents)}</p>
                ${order.status === 'COMPLETED' && customerVisibleWorkImages(order).length ? `<p>${t('finalPhotos')} · ${customerVisibleWorkImages(order).length}</p>` : ''}
              </div>
            </div>
          </button>
        `).join('') : `<div class="empty-state tall"><strong>${state.lang === 'zh' ? '暂无订单' : 'No orders yet'}</strong><span>${state.lang === 'zh' ? '预约完成后会在这里看到记录。' : 'Your bookings will appear here.'}</span><button class="primary" data-view-target="services" type="button">${t('chooseService')}</button></div>`}
      </div>
    </section>
  `
}

function selectedOrder() {
  return state.orders.find((order) => order.id === state.selectedOrderId)
}

function customerShareCopy(order) {
  const cached = state.shareCopyByOrder[order.id]?.[state.sharePlatform]
  if (!cached) return null
  const title = state.lang === 'en' ? cached.titleEn : cached.titleZh
  const caption = state.lang === 'en' ? cached.captionEn : cached.captionZh
  return {
    title: title || '',
    caption: caption || '',
    hashtags: cached.hashtags || []
  }
}

function renderCustomerSharePanel(order, images) {
  if (state.shareOrderId !== order.id) return ''
  const platforms = [
    ['xiaohongshu', state.lang === 'zh' ? '小红书' : 'Xiaohongshu'],
    ['douyin', state.lang === 'zh' ? '抖音' : 'Douyin'],
    ['instagram', 'Instagram']
  ]
  const shareCopy = customerShareCopy(order)
  const shareUrl = shareUrlForOrder(order.id, 0, state.sharePlatform)
  return `
    <div class="customer-share-panel">
      <div class="section-row compact"><h3>${t('shareReady')}</h3><span class="subtle">${t('shareTo')}</span></div>
      <div class="customer-platform-row">
        ${platforms.map(([key, label]) => `<button class="${state.sharePlatform === key ? 'active' : ''}" data-order-share-platform="${key}" type="button">${label}</button>`).join('')}
      </div>
      ${shareCopy ? `
        <div class="customer-share-copy">
          <strong>${escapeHtml(shareCopy.title)}</strong>
          <p>${escapeHtml(shareCopy.caption)}</p>
          <small>${shareCopy.hashtags.map(escapeHtml).join(' ')}</small>
        </div>
      ` : `<div class="empty-state small-empty">${state.lang === 'zh' ? '选择平台后会生成对应文案。' : 'Choose a platform to generate a caption.'}</div>`}
      <div class="customer-share-actions">
        <button class="ghost" data-copy-order-caption="${order.id}" type="button" ${shareCopy ? '' : 'disabled'}>${t('copyCaption')}</button>
        <a class="ghost button-link" href="${shareUrl}" target="_blank" rel="noreferrer">${t('shareLink')}</a>
        <a class="primary button-link" href="${platformUrl(state.sharePlatform)}" target="_blank" rel="noreferrer">${t('openPlatform')}</a>
      </div>
      ${images.length ? `<small class="subtle">${state.lang === 'zh' ? '分享页只展示已确认入库的作品。' : 'The share page only shows approved archive photos.'}</small>` : ''}
    </div>
  `
}

function renderOrderDetailWeb() {
  const order = selectedOrder()
  if (!order) {
    state.view = 'orders'
    renderOrdersWeb()
    return
  }
  const workImages = customerVisibleWorkImages(order)
  els.screen.innerHTML = `
    <section class="order-detail-web">
      <button class="ghost back-btn" data-view-target="orders" type="button">← ${t('orders')}</button>
      <div class="detail-card-web card">
        <span class="status">${statusLabel(order.status)}</span>
        <h1>${order.service.name}</h1>
        <p class="subtle">${t('orderNo')} ${order.publicCode}</p>
        <img src="${order.service.imageUrl}" alt="${order.service.name}">
      </div>
      <section class="section">
        <div class="section-row"><h2>${t('bookingInfo')}</h2></div>
        <div class="info-card-web card">
          <p><span>${t('arrival')}</span><strong>${order.appointmentDate} ${order.appointmentTime}</strong></p>
          <p><span>${t('duration')}</span><strong>${order.totalDurationMin}${t('minutes')}</strong></p>
          <p><span>${t('technician')}</span><strong>${order.technician.name}</strong></p>
          <p><span>${t('store')}</span><strong>${order.store.name}</strong></p>
          <p><span>${t('address')}</span><strong>${order.store.address || 'Address TBD'}</strong></p>
          <p><span>${t('remark')}</span><strong>${order.notes || t('none')}</strong></p>
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('workArchive')}</h2><span class="subtle">${order.technician.name}</span></div>
        <div class="archive-card-web card">
          <p><span>${t('technician')}</span><strong>${order.technician.name}</strong></p>
          <p><span>${t('finalPhotos')}</span><strong>${workImages.length}/6</strong></p>
          ${workImages.length ? `
            <div class="customer-work-grid">
              ${workImages.map((image, index) => `
                <figure class="customer-work-item">
                  <a href="${image}" target="_blank" rel="noreferrer"><img src="${image}" alt="${t('finalPhotos')} ${index + 1}"></a>
                  <a class="ghost mini-download" href="${image}" download="Lucky-Luxe-${order.publicCode || order.id}-${index + 1}.jpg">${t('downloadImage')}</a>
                </figure>
              `).join('')}
            </div>
            <button class="primary slim" data-order-share="${order.id}" type="button">${t('oneClickShare')}</button>
            ${renderCustomerSharePanel(order, workImages)}
          ` : `<div class="empty-state small-empty">${t('noWorkImages')}</div>`}
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('payment')}</h2></div>
        <div class="info-card-web card">
          <p><span>${t('payment')}</span><strong>${statusLabel(order.status)}</strong></p>
          <p><span>${t('paidDeposit')}</span><strong class="price">${money(order.depositCents)}</strong></p>
          <p><span>${t('finalDue')}</span><strong>${money(order.finalDueCents)}</strong></p>
          <p><span>${t('servicePrice')}</span><strong>${money(order.servicePriceCents)}</strong></p>
        </div>
      </section>
    </section>
  `
}

function renderAssetsWeb() {
  const user = state.user
  els.screen.innerHTML = `
    <section class="assets-web-page">
      <button class="ghost back-btn" data-view-target="me" type="button">← ${t('me')}</button>
      <div class="asset-card-web dark">
        <div><span>${t('balance')}</span><strong>${money(user.balanceCents || 0)}</strong></div>
        <span>Stored Card</span>
      </div>
      <div class="asset-grid-web">
        <button class="asset-card-web card" data-me-target="pointsMall" type="button"><span>${t('points')}</span><strong>${user.points}</strong><small>${state.lang === 'zh' ? '积分商城后续接入' : 'Points mall coming later'}</small></button>
        <button class="asset-card-web card" data-me-target="coupons" type="button"><span>${t('coupons')}</span><strong>${user.couponCount}</strong><small>${state.lang === 'zh' ? '含新人体验券' : 'Includes new member coupon'}</small></button>
      </div>
      <section class="section">
        <div class="section-row"><h2>${t('giftCard')}</h2><span class="subtle">${t('comingSoon')}</span></div>
        <button class="gift-card-web card" data-me-target="giftCard" type="button"><strong>${state.lang === 'zh' ? '暂无礼品卡' : 'No gift cards yet'}</strong><span>${state.lang === 'zh' ? '真实售卖功能可在下一阶段接入。' : 'Real purchase flow can be added next.'}</span></button>
      </section>
    </section>
  `
}

function renderStoreWeb() {
  const store = state.stores[0] || {}
  els.screen.innerHTML = `
    <section class="store-web-page">
      <button class="ghost back-btn" data-view-target="me" type="button">← ${t('me')}</button>
      <img class="store-hero-web" src="/assets/images/store-cover.png" alt="Lucky Luxe Ontario">
      <div class="store-info-web card">
        <h1>${store.name || 'Lucky Luxe Ontario'}</h1>
        <p>${store.address || 'Address TBD'}</p>
        <p>${store.phone || 'Phone TBD'}</p>
        <p>Tuesday-Sunday 10:00-19:00 · Monday closed</p>
      </div>
    </section>
  `
}

function renderPlaceholderWeb(title, text) {
  els.screen.innerHTML = `
    <section class="placeholder-web">
      <button class="ghost back-btn" data-view-target="me" type="button">← ${t('me')}</button>
      <div class="placeholder-card card">
        <img src="/assets/images/store-cover.png" alt="${title}">
        <h1>${title}</h1>
        <p>${text}</p>
      </div>
    </section>
  `
}

async function handleScreenClick(event) {
  if (event.target.closest('[data-portfolio-back]')) {
    state.selectedPortfolioTechId = ''
    renderPortfolio()
    return
  }
  const portfolioTech = event.target.closest('[data-portfolio-tech]')
  if (portfolioTech) {
    state.selectedPortfolioTechId = portfolioTech.dataset.portfolioTech
    state.view = 'portfolio'
    renderPortfolio()
    return
  }
  const orderFilter = event.target.closest('[data-order-filter]')
  if (orderFilter) {
    if (!state.user) {
      requireLogin({ view: 'orders' })
      return
    }
    state.orderFilter = orderFilter.dataset.orderFilter
    state.view = 'orders'
    render()
    return
  }
  const orderButton = event.target.closest('[data-order-id]')
  if (orderButton) {
    if (!state.user) {
      requireLogin({ view: 'orders' })
      return
    }
    state.selectedOrderId = orderButton.dataset.orderId
    state.shareOrderId = ''
    await refreshOrder(state.selectedOrderId)
    state.view = 'orderDetail'
    render()
    return
  }
  const orderShare = event.target.closest('[data-order-share]')
  if (orderShare) {
    const order = state.orders.find((item) => item.id === orderShare.dataset.orderShare)
    if (!order) return
    state.shareOrderId = state.shareOrderId === order.id ? '' : order.id
    if (state.shareOrderId && !state.shareCopyByOrder[order.id]?.[state.sharePlatform]) {
      await generateCustomerShareCopy(order)
    }
    render()
    return
  }
  const sharePlatform = event.target.closest('[data-order-share-platform]')
  if (sharePlatform) {
    const order = selectedOrder()
    if (!order) return
    state.sharePlatform = sharePlatform.dataset.orderSharePlatform
    if (!state.shareCopyByOrder[order.id]?.[state.sharePlatform]) {
      await generateCustomerShareCopy(order, state.sharePlatform)
    }
    render()
    return
  }
  const copyCaption = event.target.closest('[data-copy-order-caption]')
  if (copyCaption) {
    const order = state.orders.find((item) => item.id === copyCaption.dataset.copyOrderCaption)
    const shareCopy = order ? customerShareCopy(order) : null
    if (!shareCopy) return
    await navigator.clipboard.writeText([shareCopy.title, shareCopy.caption, shareCopy.hashtags.join(' ')].filter(Boolean).join('\n\n'))
    toast(t('captionCopied'))
    return
  }
  if (event.target.closest('[data-copy-member-link]')) {
    await navigator.clipboard.writeText(referralUrlFor(state.user))
    toast(t('memberCodeCopied'))
    return
  }
  if (event.target.closest('[data-toggle-member-code]')) {
    state.memberCodeOpen = !state.memberCodeOpen
    render()
    return
  }
  const meTarget = event.target.closest('[data-me-target]')
  if (meTarget) {
    setView(meTarget.dataset.meTarget)
    return
  }
  const serviceButton = event.target.closest('[data-service-id]')
  if (serviceButton) {
    state.service = state.services.find((service) => service.id === serviceButton.dataset.serviceId)
    state.view = 'detail'
    render()
    return
  }
  const goServices = event.target.closest('[data-go-services]')
  if (goServices) {
    state.type = goServices.dataset.goServices
    state.category = 'all'
    setView('services')
    return
  }
  const target = event.target.closest('[data-view-target]')
  if (target) {
    setView(target.dataset.viewTarget)
    return
  }
  const type = event.target.closest('[data-type]')
  if (type) {
    state.type = type.dataset.type
    state.category = 'all'
    renderServices()
    return
  }
  const category = event.target.closest('[data-category]')
  if (category) {
    state.category = category.dataset.category
    renderServices()
    return
  }
  const bookingMode = event.target.closest('[data-start-booking]')
  if (bookingMode) {
    await prepareBooking(bookingMode.dataset.startBooking)
    return
  }
  const slot = event.target.closest('[data-slot]')
  if (slot) {
    state.selectedSlot = slot.dataset.slot
    renderBookingForm()
    return
  }
  const addOn = event.target.closest('[data-addon]')
  if (addOn) {
    if (state.selectedAddOns.has(addOn.dataset.addon)) state.selectedAddOns.delete(addOn.dataset.addon)
    else state.selectedAddOns.add(addOn.dataset.addon)
    await loadAvailability()
    renderBookingForm()
    return
  }
  const removeReference = event.target.closest('[data-remove-reference]')
  if (removeReference) {
    state.referenceImages.splice(Number(removeReference.dataset.removeReference), 1)
    state.referenceAnalysis = null
    renderBookingForm()
    return
  }
  if (event.target.closest('[data-ai-reference]')) {
    await analyzeReferenceImages().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-save-cart]')) {
    if (!state.user) {
      requireLogin({ view: 'booking', serviceId: state.service?.id, bookingMode: state.bookingMode || 'cart' })
      return
    }
    saveCurrentToCart(false)
    return
  }
  if (event.target.closest('[data-checkout-now]')) {
    if (!state.user) {
      requireLogin({ view: 'booking', serviceId: state.service?.id, bookingMode: state.bookingMode || 'checkout' })
      return
    }
    saveCurrentToCart(true)
    return
  }
  const toggle = event.target.closest('[data-toggle-cart]')
  if (toggle) {
    state.cart = state.cart.map((item) => item.id === toggle.dataset.toggleCart ? { ...item, selected: !item.selected } : item)
    writeJson('lucky-web-cart', state.cart)
    renderCart()
    return
  }
  const remove = event.target.closest('[data-remove-cart]')
  if (remove) {
    state.cart = state.cart.filter((item) => item.id !== remove.dataset.removeCart)
    writeJson('lucky-web-cart', state.cart)
    renderCart()
    return
  }
  if (event.target.closest('[data-submit-payment]')) {
    submitPayment().catch((error) => {
      if (error.code === 'AUTH_EXPIRED') {
        clearCustomerAuth()
        requireLogin({ view: 'checkout' })
        toast(t('sessionExpired'))
        return
      }
      toast(error.message)
    })
    return
  }
  if (event.target.closest('[data-logout]')) {
    clearCustomerAuth()
    state.view = 'home'
    render()
  }
}

async function handleScreenChange(event) {
  if (event.target.matches('[data-reference-input]')) {
    await handleReferenceFiles(event.target.files)
    renderBookingForm()
    return
  }
  const field = event.target.dataset.field
  if (field === 'tech') {
    state.selectedTechId = event.target.value
    await loadAvailability()
    renderBookingForm()
  }
  if (field === 'date') {
    state.date = event.target.value
    await loadAvailability()
    renderBookingForm()
  }
}

function handleScreenInput(event) {
  if (event.target.dataset.field === 'remark') state.remark = event.target.value
}

async function handleReferenceFiles(files) {
  const remaining = 3 - state.referenceImages.length
  if (remaining <= 0) return
  const selected = [...files].slice(0, remaining)
  const images = await Promise.all(selected.map(readCompressedImage))
  state.referenceImages.push(...images)
  state.referenceAnalysis = null
}

async function analyzeReferenceImages() {
  if (!state.referenceImages.length) return
  state.isAnalyzingReference = true
  renderBookingForm()
  try {
    const data = await request('/ai/reference-analysis', {
      method: 'POST',
      body: JSON.stringify({
        lang: state.lang,
        images: state.referenceImages,
        service: state.service,
        notes: state.remark
      })
    })
    state.referenceAnalysis = data.analysis
  } finally {
    state.isAnalyzingReference = false
    renderBookingForm()
  }
}

function readCompressedImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const maxSize = 1000
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.78))
      }
      image.onerror = reject
      image.src = reader.result
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

bootstrap().catch((error) => toast(error.message))
