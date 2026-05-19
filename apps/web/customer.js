const storeId = 'store-ontario-01'

const copy = {
  zh: {
    registerTitle: '创建 Lucky Luxe 账号',
    registerText: '网页版需要账号后才能预约，演示版支持邮箱注册和 Google 注册入口。',
    emailRegister: '邮箱注册',
    googleRegister: '使用 Google 注册',
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
    popularNail: '人气美甲',
    popularLash: '人气美睫',
    nail: '美甲 Nail',
    lash: '美睫 Lash',
    minutes: '分钟',
    deposit: '定金',
    servicePrice: '服务价',
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
    upload: '上传占位',
    checkout: '去结算',
    saveCart: '保存到购物车',
    requiredDeposit: '需付定金',
    emptyCart: '购物车是空的',
    emptyCartHint: '请选择服务并填写预约信息。',
    chooseService: '选择服务',
    pendingCheckout: '待结算',
    selectedDeposit: '已选定金',
    confirmOrder: '确认订单',
    mockPay: '演示版 Mock 支付',
    discount: '优惠与储值',
    coupon: '新人券',
    balance: '储值余额',
    store: '门店',
    payAction: '支付定金',
    paid: '已确认',
    pending: '待支付',
    memberGrowth: '会员成长值',
    points: '积分',
    coupons: '优惠券',
    orders: '我的订单',
    recent: '近期消费',
    functions: '常用功能',
    assets: '我的资产',
    settings: '设置',
    logout: '退出登录',
    completeFlow: '完整预约流程',
    noSlots: '当天暂无可预约时间',
    created: '已加入购物车',
    paidDone: '定金已支付，预约已确认',
    needLogin: '请先完成注册/登录'
  },
  en: {
    registerTitle: 'Create your Lucky Luxe account',
    registerText: 'The web app requires an account before booking. This demo supports email and Google registration.',
    emailRegister: 'Email Register',
    googleRegister: 'Register with Google',
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
    popularNail: 'Popular Nail',
    popularLash: 'Popular Lash',
    nail: 'Nail',
    lash: 'Lash',
    minutes: 'min',
    deposit: 'Deposit',
    servicePrice: 'Service price',
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
    upload: 'Upload Placeholder',
    checkout: 'Checkout',
    saveCart: 'Save to Cart',
    requiredDeposit: 'Deposit due',
    emptyCart: 'Your cart is empty',
    emptyCartHint: 'Choose a service and fill in appointment details.',
    chooseService: 'Choose Service',
    pendingCheckout: 'Pending checkout',
    selectedDeposit: 'Selected deposit',
    confirmOrder: 'Confirm Order',
    mockPay: 'Mock payment demo',
    discount: 'Discount & Balance',
    coupon: 'New member coupon',
    balance: 'Stored balance',
    store: 'Store',
    payAction: 'Pay Deposit',
    paid: 'Confirmed',
    pending: 'Pending payment',
    memberGrowth: 'Member growth',
    points: 'Points',
    coupons: 'Coupons',
    orders: 'My Orders',
    recent: 'Recent Records',
    functions: 'Common Tools',
    assets: 'My Assets',
    settings: 'Settings',
    logout: 'Log out',
    completeFlow: 'Full booking flow',
    noSlots: 'No available times',
    created: 'Added to cart',
    paidDone: 'Deposit paid. Booking confirmed.',
    needLogin: 'Please register or sign in first'
  }
}

const state = {
  lang: localStorage.getItem('lucky-web-lang') || 'zh',
  user: readJson('lucky-web-user'),
  view: 'home',
  type: 'nail',
  category: 'all',
  services: [],
  stores: [],
  service: null,
  technicians: [],
  selectedTechId: '',
  date: defaultDate(),
  slotsByTech: [],
  selectedSlot: '',
  addOns: [],
  selectedAddOns: new Set(),
  remark: '',
  cart: readJson('lucky-web-cart') || [],
  orders: readJson('lucky-web-orders') || []
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

function toast(message) {
  els.toast.textContent = message
  els.toast.classList.add('show')
  setTimeout(() => els.toast.classList.remove('show'), 2400)
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Request failed')
  return data
}

function setView(view) {
  if (!state.user) {
    toast(t('needLogin'))
    renderAuth()
    return
  }
  state.view = view
  els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view))
  render()
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
  await Promise.all([loadServices(), loadStores(), loadAddOns()])
  if (state.user) showApp()
  else renderAuth()
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

function bindGlobalEvents() {
  els.langZh.addEventListener('click', async () => switchLang('zh'))
  els.langEn.addEventListener('click', async () => switchLang('en'))
  els.tabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)))
  els.authView.addEventListener('submit', registerEmail)
  els.authView.addEventListener('click', (event) => {
    if (event.target.closest('#googleRegister')) registerGoogle().catch((error) => toast(error.message))
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
  if (state.service) state.service = state.services.find((item) => item.id === state.service.id) || state.service
  render()
  if (!state.user) renderAuth()
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
          <span>Name</span>
          <input name="displayName" value="Lucky Member">
        </label>
        <label>
          <span>Email</span>
          <input name="email" type="email" value="member@luckyluxe.demo">
        </label>
        <button class="primary full" type="submit">${t('emailRegister')}</button>
      </form>
      <button class="google-btn" id="googleRegister" type="button">
        <span>G</span>
        ${t('googleRegister')}
      </button>
    </div>
    <div class="auth-visual">
      <img src="/assets/images/store-cover.png" alt="Lucky Luxe">
    </div>
  `
}

async function registerEmail(event) {
  event.preventDefault()
  const form = new FormData(event.target)
  const data = await request('/auth/email/register', {
    method: 'POST',
    body: JSON.stringify({
      displayName: form.get('displayName'),
      email: form.get('email')
    })
  })
  state.user = data.user
  writeJson('lucky-web-user', state.user)
  showApp()
}

async function registerGoogle() {
  const data = await request('/auth/google/demo', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Google Member',
      email: 'google.member@luckyluxe.demo'
    })
  })
  state.user = data.user
  writeJson('lucky-web-user', state.user)
  showApp()
}

function showApp() {
  els.authView.classList.add('hidden')
  els.appView.classList.remove('hidden')
  state.view = 'home'
  els.langZh.classList.toggle('active', state.lang === 'zh')
  els.langEn.classList.toggle('active', state.lang === 'en')
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
}

function renderHome() {
  els.screen.innerHTML = `
    <section class="web-hero">
      <div class="web-hero-copy">
        <span class="brand-mark">LL</span>
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
    <section class="quick-grid section">
      <button class="quick-item card" data-go-services="nail" type="button"><span class="quick-icon">N</span><span>${t('quickNail')}</span></button>
      <button class="quick-item card" data-go-services="lash" type="button"><span class="quick-icon">L</span><span>${t('quickLash')}</span></button>
      <button class="quick-item card" data-view-target="cart" type="button"><span class="quick-icon">C</span><span>${t('cart')}</span></button>
      <button class="quick-item card" data-view-target="me" type="button"><span class="quick-icon">M</span><span>${t('quickMember')}</span></button>
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
          <span class="price">${money(service.priceCents)}</span>
          <span>${service.durationMin}${t('minutes')}</span>
          <span>${t('deposit')} ${money(service.depositCents)}</span>
        </span>
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
          <span><strong class="price">${money(service.priceCents)}</strong> / ${t('servicePrice')}</span>
          <span class="deposit">${t('deposit')} ${money(service.depositCents)}</span>
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

async function prepareBooking(mode) {
  state.bookingMode = mode
  state.selectedAddOns = new Set()
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
        <div class="section-row"><h2>${t('reference')}</h2><span class="subtle">0/3</span></div>
        <button class="upload-box-web card" type="button">${t('upload')}</button>
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

function buildCartItem() {
  const selectedAddOns = state.addOns.filter((item) => state.selectedAddOns.has(item.id))
  const tech = state.technicians.find((item) => item.id === state.selectedTechId)
  const addonTotal = selectedAddOns.reduce((total, item) => total + item.priceCents, 0)
  return {
    id: `cart_${Date.now()}`,
    service: state.service,
    technician: tech,
    date: state.date,
    time: state.selectedSlot,
    addOns: selectedAddOns,
    remark: state.remark,
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
          <div>
            <h2>${item.service.name}</h2>
            <p>${item.date} · ${item.time} · ${item.technician.name}</p>
            <p><strong>${t('deposit')} ${money(item.depositCents)}</strong> · ${t('servicePrice')} ${money(item.servicePriceCents)}</p>
          </div>
          <img src="${item.service.imageUrl}" alt="${item.service.name}">
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
        notes: item.remark
      })
    })
    const paid = await request('/payments/mock/confirm', {
      method: 'POST',
      body: JSON.stringify({ bookingId: bookingData.booking.id })
    })
    completed.push(paid.booking)
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
  const counts = {
    pending: state.orders.filter((item) => item.status === 'CONFIRMED').length,
    completed: state.orders.filter((item) => item.status === 'COMPLETED').length
  }
  els.screen.innerHTML = `
    <section class="me-web">
      <div class="member-card web-member-card">
        <div class="member-top">
          <img class="avatar" src="/assets/images/member-profile.png" alt="${user.displayName}">
          <div><h1>${user.displayName}</h1><p>${user.memberLevel} · ${user.provider}</p></div>
        </div>
        <div class="growth-block">
          <div class="growth-head"><span>${t('memberGrowth')}</span><span>${user.growthValue} / ${user.nextLevelValue}</span></div>
          <div class="growth-track"><div class="growth-fill" style="width:${Math.round(user.growthValue / user.nextLevelValue * 100)}%"></div></div>
        </div>
        <div class="member-assets">
          <div><strong>${user.points}</strong><span>${t('points')}</span></div>
          <div><strong>${user.couponCount}</strong><span>${t('coupons')}</span></div>
          <div><strong>${money(user.balanceCents)}</strong><span>${t('balance')}</span></div>
        </div>
      </div>
      <section class="section">
        <div class="section-row"><h2>${t('orders')}</h2><span class="subtle">All</span></div>
        <div class="order-entry card">
          <button type="button"><strong>${counts.pending}</strong><span>${t('paid')}</span></button>
          <button type="button"><strong>${counts.completed}</strong><span>Completed</span></button>
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('recent')}</h2><span class="subtle">Records</span></div>
        <div class="recent-list-web">
          ${state.orders.length ? state.orders.map((order) => `
            <article class="recent-card-web card">
              <img src="${order.service.imageUrl}" alt="${order.service.name}">
              <div>
                <div class="recent-top"><strong>${order.service.name}</strong><span>${t('paid')}</span></div>
                <p>${order.appointmentDate} ${order.appointmentTime} · ${order.technician.name}</p>
                <p>${t('deposit')} ${money(order.depositCents)}</p>
              </div>
            </article>
          `).join('') : `<div class="empty-state">${state.lang === 'zh' ? '暂无消费记录' : 'No records yet'}</div>`}
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('functions')}</h2></div>
        <div class="menu-grid-web">
          ${[
            [t('assets'), '/assets/images/nail-luxe.png'],
            [t('store'), '/assets/images/store-cover.png'],
            [t('coupons'), '/assets/images/nail-french.png'],
            [t('settings'), '/assets/images/lash-natural.png']
          ].map(([label, image]) => `<button class="menu-card card" type="button"><img src="${image}" alt="${label}"><strong>${label}</strong><span>Demo</span></button>`).join('')}
        </div>
      </section>
      <button class="ghost logout-btn" data-logout type="button">${t('logout')}</button>
    </section>
  `
}

async function handleScreenClick(event) {
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
    state.view = target.dataset.viewTarget
    render()
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
  if (event.target.closest('[data-save-cart]')) {
    saveCurrentToCart(false)
    return
  }
  if (event.target.closest('[data-checkout-now]')) {
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
    submitPayment().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-logout]')) {
    state.user = null
    localStorage.removeItem('lucky-web-user')
    renderAuth()
  }
}

async function handleScreenChange(event) {
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

bootstrap().catch((error) => toast(error.message))
