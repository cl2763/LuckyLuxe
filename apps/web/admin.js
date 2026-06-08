const owner = {
  token: '',
  auth: readJson('lucky-owner-auth'),
  lang: localStorage.getItem('lucky-admin-lang') || 'zh',
  bookings: [],
  services: [],
  technicians: [],
  adminView: 'today',
  calendarDate: new Date(),
  serviceEditor: null,
  selectedBookingId: ''
}

const els = {
  adminBrandTitle: document.querySelector('#adminBrandTitle'),
  adminBrandSubtitle: document.querySelector('#adminBrandSubtitle'),
  adminLangZh: document.querySelector('#adminLangZh'),
  adminLangEn: document.querySelector('#adminLangEn'),
  customerAppLink: document.querySelector('#customerAppLink'),
  tokenInput: document.querySelector('#tokenInput'),
  ownerLogin: document.querySelector('#ownerLogin'),
  ownerLoginForm: document.querySelector('#ownerLoginForm'),
  ownerAccessEyebrow: document.querySelector('#ownerAccessEyebrow'),
  ownerLoginTitle: document.querySelector('#ownerLoginTitle'),
  ownerLoginText: document.querySelector('#ownerLoginText'),
  ownerEmailLabel: document.querySelector('#ownerEmailLabel'),
  ownerPasswordLabel: document.querySelector('#ownerPasswordLabel'),
  ownerLoginButton: document.querySelector('#ownerLoginButton'),
  ownerRegisterButton: document.querySelector('#ownerRegisterButton'),
  ownerLogout: document.querySelector('#ownerLogout'),
  reloadButton: document.querySelector('#reloadButton'),
  metricGrid: document.querySelector('#metricGrid'),
  adminLayout: document.querySelector('#adminLayout'),
  bookingsTitle: document.querySelector('#bookingsTitle'),
  bookingsSubtitle: document.querySelector('#bookingsSubtitle'),
  bookingList: document.querySelector('#bookingList'),
  adminTabs: [...document.querySelectorAll('.admin-tab')],
  todayTab: document.querySelector('#todayTab'),
  allTab: document.querySelector('#allTab'),
  calendarTab: document.querySelector('#calendarTab'),
  bookingFilters: document.querySelector('#bookingFilters'),
  calendarControls: document.querySelector('#calendarControls'),
  calendarTitle: document.querySelector('#calendarTitle'),
  filterDate: document.querySelector('#filterDate'),
  filterStatus: document.querySelector('#filterStatus'),
  filterDateLabel: document.querySelector('#filterDateLabel'),
  filterStatusLabel: document.querySelector('#filterStatusLabel'),
  clearFilters: document.querySelector('#clearFilters'),
  prevMonth: document.querySelector('#prevMonth'),
  nextMonth: document.querySelector('#nextMonth'),
  scheduleTitle: document.querySelector('#scheduleTitle'),
  scheduleTechLabel: document.querySelector('#scheduleTechLabel'),
  scheduleDateLabel: document.querySelector('#scheduleDateLabel'),
  scheduleStartLabel: document.querySelector('#scheduleStartLabel'),
  scheduleEndLabel: document.querySelector('#scheduleEndLabel'),
  scheduleWorkingLabel: document.querySelector('#scheduleWorkingLabel'),
  servicesTitle: document.querySelector('#servicesTitle'),
  addServiceButton: document.querySelector('#addServiceButton'),
  serviceEditor: document.querySelector('#serviceEditor'),
  serviceAdminList: document.querySelector('#serviceAdminList'),
  scheduleTech: document.querySelector('#scheduleTech'),
  scheduleDate: document.querySelector('#scheduleDate'),
  scheduleStart: document.querySelector('#scheduleStart'),
  scheduleEnd: document.querySelector('#scheduleEnd'),
  scheduleWorking: document.querySelector('#scheduleWorking'),
  saveSchedule: document.querySelector('#saveSchedule'),
  toast: document.querySelector('#toast')
}

const copy = {
  zh: {
    adminTitle: 'Lucky Luxe 后台',
    ownerConsole: '店主控制台',
    customerApp: '客户网页',
    reload: '刷新',
    ownerAccess: '店主权限',
    ownerLogin: '店主登录',
    ownerLoginText: '请使用已批准的 owner 邮箱登录。登录成功前后台数据不会显示。',
    email: '邮箱',
    password: '密码',
    login: '登录',
    registerOwner: '注册 Owner',
    logout: '退出',
    bookings: '预约',
    bookingsSubtitle: '实时后端数据',
    today: '今天',
    allBookings: '全部预约',
    calendar: '日历',
    date: '日期',
    status: '状态',
    clear: '清除',
    schedule: '技师排班',
    technician: '技师',
    start: '开始',
    end: '结束',
    workingDay: '工作日',
    saveSchedule: '保存排班',
    confirmed: '已确认',
    pending: '待支付',
    completed: '已完成',
    cancelled: '已取消',
    expired: '已过期',
    activeAttention: '需关注',
    allStatuses: '全部状态',
    services: '服务',
    addService: '添加服务',
    modify: '修改',
    save: '保存',
    cancel: '取消',
    active: '上架',
    hidden: '隐藏',
    serviceEditor: '服务编辑',
    type: '类型',
    category: '分类',
    nameZh: '中文名',
    nameEn: '英文名',
    descriptionZh: '中文描述',
    descriptionEn: '英文描述',
    imageUrl: '图片路径',
    priceCad: '价格 CAD',
    depositCad: '定金 CAD',
    durationMin: '时长分钟',
    sortOrder: '排序',
    noBookings: '没有找到预约',
    adjustFilters: '请调整日期或状态筛选。',
    noServices: '暂无服务',
    needsAttention: '定金、排班或服务完成前需要关注。',
    finalDue: '尾款',
    revenue: '收入',
    serviceSaved: '服务已保存。',
    serviceCreated: '服务已添加。',
    scheduleSaved: '排班已保存。',
    loggedOut: '已退出。',
    loginSuccess: 'Owner 登录成功。',
    ownerCreated: 'Owner 账号已创建。',
    checkEmail: '请检查邮箱验证 owner 账号，然后再登录。',
    details: '详情',
    bookingDetails: '订单详情',
    customer: '顾客',
    orderCode: '订单号',
    notes: '备注',
    referenceImages: '参考图',
    workImages: '作品留档',
    uploadWorkImages: '上传完工作品',
    noWorkImages: '暂无完工作品图',
    workImagesSaved: '作品图已保存。',
    noNotes: '暂无备注',
    noImages: '暂无参考图',
    close: '关闭'
  },
  en: {
    adminTitle: 'Lucky Luxe Admin',
    ownerConsole: 'Owner Console',
    customerApp: 'Customer App',
    reload: 'Reload',
    ownerAccess: 'Owner Access',
    ownerLogin: 'Owner Login',
    ownerLoginText: 'Use your approved owner email. Admin data is hidden until login succeeds.',
    email: 'Email',
    password: 'Password',
    login: 'Login',
    registerOwner: 'Register Owner',
    logout: 'Log out',
    bookings: 'Bookings',
    bookingsSubtitle: 'Live backend data',
    today: 'Today',
    allBookings: 'All Bookings',
    calendar: 'Calendar',
    date: 'Date',
    status: 'Status',
    clear: 'Clear',
    schedule: 'Technician Schedule',
    technician: 'Technician',
    start: 'Start',
    end: 'End',
    workingDay: 'Working day',
    saveSchedule: 'Save Schedule',
    confirmed: 'Confirmed',
    pending: 'Pending',
    completed: 'Completed',
    cancelled: 'Cancelled',
    expired: 'Expired',
    activeAttention: 'Active attention',
    allStatuses: 'All statuses',
    services: 'Services',
    addService: 'Add Service',
    modify: 'Modify',
    save: 'Save',
    cancel: 'Cancel',
    active: 'Active',
    hidden: 'Hidden',
    serviceEditor: 'Service Editor',
    type: 'Type',
    category: 'Category',
    nameZh: 'Chinese Name',
    nameEn: 'English Name',
    descriptionZh: 'Chinese Description',
    descriptionEn: 'English Description',
    imageUrl: 'Image URL',
    priceCad: 'Price CAD',
    depositCad: 'Deposit CAD',
    durationMin: 'Duration min',
    sortOrder: 'Sort order',
    noBookings: 'No bookings found',
    adjustFilters: 'Adjust the date or status filter.',
    noServices: 'No services yet',
    needsAttention: 'Needs attention until deposit, schedule, or completion is settled.',
    finalDue: 'Final due',
    revenue: 'Revenue',
    serviceSaved: 'Service saved.',
    serviceCreated: 'Service created.',
    scheduleSaved: 'Schedule saved.',
    loggedOut: 'Logged out.',
    loginSuccess: 'Owner login successful.',
    ownerCreated: 'Owner account created.',
    checkEmail: 'Check your email to confirm the owner account, then log in.',
    details: 'Details',
    bookingDetails: 'Booking Details',
    customer: 'Customer',
    orderCode: 'Order Code',
    notes: 'Notes',
    referenceImages: 'Reference Images',
    workImages: 'Work Archive',
    uploadWorkImages: 'Upload Finished Work',
    noWorkImages: 'No finished work photos',
    workImagesSaved: 'Work photos saved.',
    noNotes: 'No notes',
    noImages: 'No reference images',
    close: 'Close'
  }
}

function t(key) {
  return copy[owner.lang][key] || key
}

els.tokenInput.value = owner.token
els.scheduleDate.value = formatDate(new Date())
els.filterDate.value = formatDate(new Date())

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function money(cents) {
  return `CAD $${Number(cents / 100).toFixed(0)}`
}

function cents(value) {
  return Number(value / 100).toFixed(0)
}

function dollarsToCents(value) {
  return Math.round(Number(value || 0) * 100)
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function technicianColor(id = '') {
  const palette = [
    ['#8a5a44', '#f4e8df'],
    ['#47735f', '#e7f0ea'],
    ['#7b5f91', '#efe7f4'],
    ['#9b7655', '#f7eadc'],
    ['#4f6f8f', '#e8eef6']
  ]
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0)
  return palette[sum % palette.length]
}

function toast(message) {
  els.toast.textContent = message
  els.toast.classList.add('show')
  setTimeout(() => els.toast.classList.remove('show'), 2200)
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function ownerBearer() {
  return owner.auth?.accessToken || owner.token || ''
}

async function request(path, options = {}) {
  const bearer = ownerBearer()
  const headers = {
    'content-type': 'application/json',
    ...(bearer && !options.public ? { authorization: `Bearer ${bearer}` } : {}),
    ...(options.headers || {})
  }
  delete options.public
  const response = await fetch(path, {
    headers,
    ...options
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Request failed')
  return data
}

function statusLabel(status) {
  const labels = {
    PENDING_PAYMENT: t('pending'),
    CONFIRMED: t('confirmed'),
    COMPLETED: t('completed'),
    CANCELLED: t('cancelled'),
    EXPIRED: t('expired'),
    AFTER_SALES: t('activeAttention')
  }
  return labels[status] || status
}

function applyLanguage() {
  const currentStatus = els.filterStatus.value || 'active'
  document.documentElement.lang = owner.lang === 'zh' ? 'zh-CN' : 'en'
  els.adminLangZh.classList.toggle('active', owner.lang === 'zh')
  els.adminLangEn.classList.toggle('active', owner.lang === 'en')
  els.adminBrandTitle.textContent = t('adminTitle')
  els.adminBrandSubtitle.textContent = t('ownerConsole')
  els.customerAppLink.textContent = t('customerApp')
  els.reloadButton.textContent = t('reload')
  els.ownerAccessEyebrow.textContent = t('ownerAccess')
  els.ownerLoginTitle.textContent = t('ownerLogin')
  els.ownerLoginText.textContent = t('ownerLoginText')
  els.ownerEmailLabel.textContent = t('email')
  els.ownerPasswordLabel.textContent = t('password')
  els.ownerLoginButton.textContent = t('login')
  els.ownerRegisterButton.textContent = t('registerOwner')
  els.ownerLogout.textContent = t('logout')
  els.bookingsTitle.textContent = t('bookings')
  els.bookingsSubtitle.textContent = t('bookingsSubtitle')
  els.todayTab.textContent = t('today')
  els.allTab.textContent = t('allBookings')
  els.calendarTab.textContent = t('calendar')
  els.filterDateLabel.textContent = t('date')
  els.filterStatusLabel.textContent = t('status')
  els.clearFilters.textContent = t('clear')
  els.scheduleTitle.textContent = t('schedule')
  els.scheduleTechLabel.textContent = t('technician')
  els.scheduleDateLabel.textContent = t('date')
  els.scheduleStartLabel.textContent = t('start')
  els.scheduleEndLabel.textContent = t('end')
  els.scheduleWorkingLabel.textContent = t('workingDay')
  els.saveSchedule.textContent = t('saveSchedule')
  els.servicesTitle.textContent = t('services')
  els.addServiceButton.textContent = t('addService')
  els.filterStatus.innerHTML = `
    <option value="active">${t('activeAttention')}</option>
    <option value="all">${t('allStatuses')}</option>
    <option value="PENDING_PAYMENT">${t('pending')}</option>
    <option value="CONFIRMED">${t('confirmed')}</option>
    <option value="COMPLETED">${t('completed')}</option>
    <option value="CANCELLED">${t('cancelled')}</option>
    <option value="EXPIRED">${t('expired')}</option>
  `
  els.filterStatus.value = currentStatus
  if (!els.filterStatus.value) els.filterStatus.value = 'active'
}

async function loadAll() {
  owner.token = els.tokenInput.value.trim()
  if (owner.token) localStorage.setItem('lucky-owner-token', owner.token)
  if (!ownerBearer()) {
    setLocked(true)
    return
  }
  const [bookingData, serviceData, techData] = await Promise.all([
    request('/admin/bookings'),
    request('/admin/services'),
    request('/admin/technicians')
  ])
  owner.bookings = bookingData.bookings
  owner.services = serviceData.services
  owner.technicians = techData.technicians
  setLocked(false)
  render()
}

async function ownerLogin(event) {
  event.preventDefault()
  const form = new FormData(event.target)
  const action = event.submitter?.dataset.authAction || 'login'
  const data = await request(action === 'register' ? '/admin/auth/register' : '/admin/auth/login', {
    method: 'POST',
    public: true,
    body: JSON.stringify({
      email: form.get('email'),
      password: form.get('password')
    })
  })
  if (data.needsEmailConfirmation) {
    toast(t('checkEmail'))
    return
  }
  owner.auth = data.auth
  localStorage.setItem('lucky-owner-auth', JSON.stringify(owner.auth))
  toast(action === 'register' ? t('ownerCreated') : t('loginSuccess'))
  await loadAll()
}

function ownerLogout() {
  owner.auth = null
  owner.token = ''
  els.tokenInput.value = ''
  localStorage.removeItem('lucky-owner-auth')
  localStorage.removeItem('lucky-owner-token')
  owner.bookings = []
  owner.services = []
  owner.technicians = []
  owner.serviceEditor = null
  owner.selectedBookingId = ''
  setLocked(true)
  toast(t('loggedOut'))
}

function setLocked(locked) {
  els.metricGrid.classList.toggle('hidden', locked)
  els.adminLayout.classList.toggle('hidden', locked)
  els.reloadButton.classList.toggle('hidden', locked)
  els.tokenInput.classList.add('hidden')
  els.ownerLogout.classList.toggle('hidden', locked)
  if (locked) {
    els.bookingList.innerHTML = ''
    els.metricGrid.innerHTML = ''
    els.serviceAdminList.innerHTML = ''
    els.serviceEditor.innerHTML = ''
    els.scheduleTech.innerHTML = ''
  }
}

function render() {
  applyLanguage()
  renderMetrics()
  renderBookings()
  renderServices()
  renderTechnicians()
}

function renderMetrics() {
  const confirmed = owner.bookings.filter((item) => item.status === 'CONFIRMED').length
  const pending = owner.bookings.filter((item) => item.status === 'PENDING_PAYMENT').length
  const revenue = owner.bookings
    .filter((item) => ['CONFIRMED', 'COMPLETED'].includes(item.status))
    .reduce((total, item) => total + (item.status === 'COMPLETED' ? item.servicePriceCents : item.depositCents), 0)
  els.metricGrid.innerHTML = `
    <div class="metric"><span class="subtle">${t('confirmed')}</span><strong>${confirmed}</strong></div>
    <div class="metric"><span class="subtle">${t('pending')}</span><strong>${pending}</strong></div>
    <div class="metric"><span class="subtle">${t('revenue')}</span><strong>${money(revenue)}</strong></div>
    <div class="metric"><span class="subtle">${t('services')}</span><strong>${owner.services.length}</strong></div>
  `
}

function renderBookings() {
  els.adminTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.adminView === owner.adminView))
  els.bookingFilters.classList.toggle('hidden', owner.adminView === 'today')
  els.calendarControls.classList.toggle('hidden', owner.adminView !== 'calendar')

  if (owner.adminView === 'calendar') {
    renderCalendar()
    return
  }

  const bookings = filteredBookings()
  const selectedBooking = selectedBookingDetail()
  if (!bookings.length) {
    els.bookingList.innerHTML = `
      ${selectedBooking ? renderBookingDetail(selectedBooking) : ''}
      <div class="empty-state"><strong>${t('noBookings')}</strong><span>${t('adjustFilters')}</span></div>
    `
    return
  }
  const grouped = groupByDate(bookings)
  els.bookingList.innerHTML = `
    ${selectedBooking ? renderBookingDetail(selectedBooking) : ''}
    ${Object.keys(grouped).sort().map((date) => `
    <section class="booking-date-group">
      <h2>${dateHeading(date)}</h2>
      ${grouped[date].map(renderBookingCard).join('')}
    </section>
  `).join('')}
  `
}

function activeStatuses() {
  return ['PENDING_PAYMENT', 'CONFIRMED']
}

function filteredBookings() {
  const status = els.filterStatus.value
  const date = owner.adminView === 'today' ? formatDate(new Date()) : els.filterDate.value
  return owner.bookings
    .filter((booking) => !date || booking.appointmentDate === date)
    .filter((booking) => {
      if (status === 'all') return true
      if (status === 'active') return activeStatuses().includes(booking.status)
      return booking.status === status
    })
    .sort((a, b) => `${a.appointmentDate} ${a.appointmentTime}`.localeCompare(`${b.appointmentDate} ${b.appointmentTime}`))
}

function groupByDate(bookings) {
  return bookings.reduce((groups, booking) => {
    groups[booking.appointmentDate] = groups[booking.appointmentDate] || []
    groups[booking.appointmentDate].push(booking)
    return groups
  }, {})
}

function dateHeading(date) {
  const today = formatDate(new Date())
  return date === today ? `${t('today')} · ${date}` : date
}

function renderBookingCard(booking) {
  const needsAttention = activeStatuses().includes(booking.status)
  return `
    <article class="booking-item">
      <img class="booking-image" src="${booking.service.imageUrl}" alt="${booking.service.name}">
      <div class="booking-copy">
        <span class="status ${booking.status}">${statusLabel(booking.status)}</span>
        <h3>${booking.service.name}</h3>
        <p>${booking.appointmentDate} ${booking.appointmentTime}-${booking.appointmentEndTime}</p>
        <p>${booking.technician.name} · ${booking.store.name}</p>
        <p>${t('depositCad')} ${money(booking.depositCents)} · ${t('finalDue')} ${money(booking.finalDueCents)} · ${booking.publicCode}</p>
        ${needsAttention ? `<p class="attention-note">${t('needsAttention')}</p>` : ''}
      </div>
      <div class="booking-actions">
        <button class="ghost" data-view-booking="${booking.id}" type="button">${t('details')}</button>
        <button class="ghost" data-status="COMPLETED" data-booking="${booking.id}" type="button">${t('completed')}</button>
        <button class="ghost" data-status="CANCELLED" data-booking="${booking.id}" type="button">${t('cancelled')}</button>
      </div>
    </article>
  `
}

function selectedBookingDetail() {
  return owner.bookings.find((booking) => booking.id === owner.selectedBookingId)
}

function renderBookingDetail(booking) {
  const images = booking.referenceImages || []
  const workImages = booking.workImages || []
  return `
    <section class="booking-detail-panel card">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('bookingDetails')}</p>
          <h2>${booking.service.name}</h2>
        </div>
        <button class="ghost slim" data-close-booking-detail type="button">${t('close')}</button>
      </div>
      <div class="booking-detail-grid">
        <p><span>${t('orderCode')}</span><strong>${booking.publicCode}</strong></p>
        <p><span>${t('status')}</span><strong>${statusLabel(booking.status)}</strong></p>
        <p><span>${t('date')}</span><strong>${booking.appointmentDate} ${booking.appointmentTime}-${booking.appointmentEndTime}</strong></p>
        <p><span>${t('technician')}</span><strong>${booking.technician.name}</strong></p>
        <p><span>${t('customer')}</span><strong>${booking.user?.display_name || booking.user?.email || '-'}</strong></p>
        <p><span>${t('depositCad')}</span><strong>${money(booking.depositCents)}</strong></p>
      </div>
      <section class="booking-detail-section">
        <h3>${t('notes')}</h3>
        <div class="booking-notes-box">${escapeHtml(booking.notes || t('noNotes'))}</div>
      </section>
      <section class="booking-detail-section">
        <div class="section-row compact-row">
          <h3>${t('referenceImages')}</h3>
          <span class="subtle">${images.length}/3</span>
        </div>
        ${images.length ? `
          <div class="admin-reference-grid">
            ${images.map((image, index) => `<a href="${image}" target="_blank" rel="noreferrer"><img src="${image}" alt="${t('referenceImages')} ${index + 1}"></a>`).join('')}
          </div>
        ` : `<div class="empty-state small-empty">${t('noImages')}</div>`}
      </section>
      <section class="booking-detail-section">
        <div class="section-row compact-row">
          <h3>${t('workImages')}</h3>
          <span class="subtle">${workImages.length}/6</span>
        </div>
        <div class="reference-upload-grid compact-upload-grid">
          <label class="upload-box-web card">
            <input data-work-image-input="${booking.id}" type="file" accept="image/*" multiple>
            <span>${t('uploadWorkImages')}</span>
          </label>
          ${workImages.map((image, index) => `
            <div class="reference-thumb card">
              <img src="${image}" alt="${t('workImages')} ${index + 1}">
              <button class="ghost mini-remove" data-remove-work-image="${index}" data-work-booking="${booking.id}" type="button">×</button>
            </div>
          `).join('')}
        </div>
        ${workImages.length ? '' : `<div class="empty-state small-empty">${t('noWorkImages')}</div>`}
      </section>
    </section>
  `
}

function renderCalendar() {
  const year = owner.calendarDate.getFullYear()
  const month = owner.calendarDate.getMonth()
  els.calendarTitle.textContent = owner.calendarDate.toLocaleString(owner.lang === 'zh' ? 'zh-CN' : 'en-CA', { month: 'long', year: 'numeric' })
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leading = first.getDay()
  const cells = []
  for (let i = 0; i < leading; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day))
  while (cells.length % 7 !== 0) cells.push(null)

  els.bookingList.innerHTML = `
    <div class="calendar-grid calendar-weekdays">
      ${(owner.lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day) => `<strong>${day}</strong>`).join('')}
    </div>
    <div class="calendar-grid">
      ${cells.map((date) => renderCalendarCell(date)).join('')}
    </div>
  `
}

function renderCalendarCell(date) {
  if (!date) return '<div class="calendar-cell muted-cell"></div>'
  const key = formatDate(date)
  const status = els.filterStatus.value
  const dayBookings = owner.bookings
    .filter((booking) => booking.appointmentDate === key)
    .filter((booking) => {
      if (status === 'all') return true
      if (status === 'active') return activeStatuses().includes(booking.status)
      return booking.status === status
    })
    .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime))
  return `
    <button class="calendar-cell ${key === formatDate(new Date()) ? 'today-cell' : ''}" data-calendar-date="${key}" type="button">
      <span class="calendar-day">${date.getDate()}</span>
      ${dayBookings.slice(0, 4).map((booking) => {
        const [color, bg] = technicianColor(booking.technician?.id)
        return `
        <span class="calendar-event ${booking.status}" style="--tech-color:${color};--tech-bg:${bg}">
          ${booking.appointmentTime} · ${booking.technician?.name || ''} · ${booking.service.name}
        </span>
      `}).join('')}
      ${dayBookings.length > 4 ? `<span class="calendar-more">+${dayBookings.length - 4} more</span>` : ''}
    </button>
  `
}

function renderServices() {
  renderServiceEditor()
  if (!owner.services.length) {
    els.serviceAdminList.innerHTML = `<div class="empty-state"><strong>${t('noServices')}</strong></div>`
    return
  }
  els.serviceAdminList.innerHTML = owner.services.map((service) => `
    <div class="service-admin-row">
      <div>
        <h3>${service.nameZh}</h3>
        <p>${service.nameEn} · ${service.type} · ${money(service.priceCents)} · ${service.durationMin} min</p>
        <div class="inline-edit">
          <label>
            <span>${t('priceCad')}</span>
            <input value="${cents(service.priceCents)}" data-price="${service.id}" inputmode="decimal">
          </label>
          <label>
            <span>${t('durationMin')}</span>
            <input value="${service.durationMin}" data-duration="${service.id}">
          </label>
          <button class="primary slim" data-save-service="${service.id}" type="button">${t('save')}</button>
          <button class="ghost slim" data-edit-service="${service.id}" type="button">${t('modify')}</button>
        </div>
      </div>
      <span class="status ${service.isActive ? 'CONFIRMED' : 'CANCELLED'}">${service.isActive ? t('active') : t('hidden')}</span>
    </div>
  `).join('')
}

function blankServiceEditor() {
  return {
    mode: 'create',
    id: '',
    type: 'NAIL',
    category: '',
    nameZh: '',
    nameEn: '',
    descriptionZh: '',
    descriptionEn: '',
    imageUrl: '/assets/images/nail-addon.png',
    price: '0',
    deposit: '50',
    duration: '120',
    sortOrder: String(owner.services.length + 1),
    isActive: true
  }
}

function editorFromService(service) {
  return {
    mode: 'edit',
    id: service.id,
    type: String(service.type || 'nail').toUpperCase(),
    category: service.category || '',
    nameZh: service.nameZh || '',
    nameEn: service.nameEn || '',
    descriptionZh: service.descriptionZh || '',
    descriptionEn: service.descriptionEn || '',
    imageUrl: service.imageUrl || '/assets/images/nail-addon.png',
    price: cents(service.priceCents),
    deposit: cents(service.depositCents),
    duration: String(service.durationMin || 120),
    sortOrder: String(service.sortOrder || 0),
    isActive: Boolean(service.isActive)
  }
}

function renderServiceEditor() {
  if (!owner.serviceEditor) {
    els.serviceEditor.innerHTML = ''
    return
  }
  const service = owner.serviceEditor
  els.serviceEditor.innerHTML = `
    <form class="service-editor-card card" id="serviceEditorForm">
      <div class="section-row compact-row">
        <h3>${t('serviceEditor')}</h3>
        <button class="ghost slim" data-cancel-service-editor type="button">${t('cancel')}</button>
      </div>
      <div class="form-grid">
        <label><span>${t('type')}</span><select name="type"><option value="NAIL" ${service.type === 'NAIL' ? 'selected' : ''}>NAIL</option><option value="LASH" ${service.type === 'LASH' ? 'selected' : ''}>LASH</option></select></label>
        <label><span>${t('category')}</span><input name="category" value="${escapeHtml(service.category)}"></label>
        <label><span>${t('nameZh')}</span><input name="nameZh" value="${escapeHtml(service.nameZh)}"></label>
        <label><span>${t('nameEn')}</span><input name="nameEn" value="${escapeHtml(service.nameEn)}"></label>
      </div>
      <label><span>${t('descriptionZh')}</span><textarea name="descriptionZh" rows="2">${escapeHtml(service.descriptionZh)}</textarea></label>
      <label><span>${t('descriptionEn')}</span><textarea name="descriptionEn" rows="2">${escapeHtml(service.descriptionEn)}</textarea></label>
      <label><span>${t('imageUrl')}</span><input name="imageUrl" value="${escapeHtml(service.imageUrl)}"></label>
      <div class="form-grid">
        <label><span>${t('priceCad')}</span><input name="price" inputmode="decimal" value="${escapeHtml(service.price)}"></label>
        <label><span>${t('depositCad')}</span><input name="deposit" inputmode="decimal" value="${escapeHtml(service.deposit)}"></label>
        <label><span>${t('durationMin')}</span><input name="duration" inputmode="numeric" value="${escapeHtml(service.duration)}"></label>
        <label><span>${t('sortOrder')}</span><input name="sortOrder" inputmode="numeric" value="${escapeHtml(service.sortOrder)}"></label>
      </div>
      <label class="check-row">
        <input name="isActive" type="checkbox" ${service.isActive ? 'checked' : ''}>
        <span>${t('active')}</span>
      </label>
      <button class="primary full" data-save-service-editor type="submit">${t('save')}</button>
    </form>
  `
}

function renderTechnicians() {
  els.scheduleTech.innerHTML = owner.technicians.map((tech) => `
    <option value="${tech.id}">${tech.name} · ${tech.title}</option>
  `).join('')
}

async function updateBookingStatus(id, status) {
  await request(`/admin/bookings/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  })
  toast(`${t('status')}: ${statusLabel(status)}`)
  await loadAll()
}

async function saveWorkImages(id, images) {
  const data = await request(`/admin/bookings/${id}/work-images`, {
    method: 'PATCH',
    body: JSON.stringify({ workImages: images })
  })
  owner.bookings = owner.bookings.map((booking) => booking.id === id ? data.booking : booking)
  owner.selectedBookingId = id
  toast(t('workImagesSaved'))
  render()
}

async function handleWorkImageFiles(id, files) {
  const booking = owner.bookings.find((item) => item.id === id)
  if (!booking) return
  const current = booking.workImages || []
  const remaining = 6 - current.length
  if (remaining <= 0) return
  const selected = [...files].slice(0, remaining)
  const images = await Promise.all(selected.map(readCompressedImage))
  await saveWorkImages(id, [...current, ...images])
}

function readCompressedImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const maxSize = 1200
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      image.onerror = reject
      image.src = reader.result
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function saveService(id) {
  const price = Math.round(Number(document.querySelector(`[data-price="${id}"]`).value) * 100)
  const duration = Number(document.querySelector(`[data-duration="${id}"]`).value)
  await request(`/admin/services/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ priceCents: price, baseDurationMin: duration })
  })
  toast(t('serviceSaved'))
  await loadAll()
}

async function saveServiceEditor(event) {
  event.preventDefault()
  const form = new FormData(event.target)
  const body = {
    type: form.get('type'),
    category: form.get('category'),
    nameZh: form.get('nameZh'),
    nameEn: form.get('nameEn'),
    descriptionZh: form.get('descriptionZh'),
    descriptionEn: form.get('descriptionEn'),
    imageUrl: form.get('imageUrl'),
    priceCents: dollarsToCents(form.get('price')),
    depositCents: dollarsToCents(form.get('deposit')),
    baseDurationMin: Number(form.get('duration')),
    sortOrder: Number(form.get('sortOrder')),
    isActive: form.get('isActive') === 'on'
  }
  const isCreate = owner.serviceEditor.mode === 'create'
  await request(isCreate ? '/admin/services' : `/admin/services/${owner.serviceEditor.id}`, {
    method: isCreate ? 'POST' : 'PATCH',
    body: JSON.stringify(body)
  })
  owner.serviceEditor = null
  toast(isCreate ? t('serviceCreated') : t('serviceSaved'))
  await loadAll()
}

async function saveSchedule() {
  const techId = els.scheduleTech.value
  await request(`/admin/technicians/${techId}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify({
      date: els.scheduleDate.value,
      startTime: els.scheduleStart.value,
      endTime: els.scheduleEnd.value,
      isWorking: els.scheduleWorking.checked
    })
  })
  toast(t('scheduleSaved'))
}

els.adminLangZh.addEventListener('click', () => switchAdminLang('zh'))
els.adminLangEn.addEventListener('click', () => switchAdminLang('en'))
els.reloadButton.addEventListener('click', () => loadAll().catch((error) => toast(error.message)))
els.ownerLoginForm.addEventListener('submit', (event) => ownerLogin(event).catch((error) => toast(error.message)))
els.ownerLogout.addEventListener('click', ownerLogout)
els.adminTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    owner.adminView = tab.dataset.adminView
    if (owner.adminView === 'today') {
      els.filterDate.value = formatDate(new Date())
      els.filterStatus.value = 'active'
    } else if (owner.adminView === 'all') {
      els.filterDate.value = ''
      els.filterStatus.value = 'active'
    } else if (owner.adminView === 'calendar' && els.filterDate.value) {
      owner.calendarDate = new Date(`${els.filterDate.value}T12:00:00`)
    }
    renderBookings()
  })
})
els.filterDate.addEventListener('change', () => {
  if (owner.adminView === 'calendar' && els.filterDate.value) {
    owner.calendarDate = new Date(`${els.filterDate.value}T12:00:00`)
  }
  renderBookings()
})
els.filterStatus.addEventListener('change', renderBookings)
els.clearFilters.addEventListener('click', () => {
  els.filterDate.value = ''
  els.filterStatus.value = 'active'
  owner.adminView = 'all'
  renderBookings()
})
els.prevMonth.addEventListener('click', () => {
  owner.calendarDate = new Date(owner.calendarDate.getFullYear(), owner.calendarDate.getMonth() - 1, 1)
  renderBookings()
})
els.nextMonth.addEventListener('click', () => {
  owner.calendarDate = new Date(owner.calendarDate.getFullYear(), owner.calendarDate.getMonth() + 1, 1)
  renderBookings()
})
els.saveSchedule.addEventListener('click', () => saveSchedule().catch((error) => toast(error.message)))
els.bookingList.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-booking-detail]')) {
    owner.selectedBookingId = ''
    renderBookings()
    return
  }
  const detailButton = event.target.closest('[data-view-booking]')
  if (detailButton) {
    owner.selectedBookingId = detailButton.dataset.viewBooking
    renderBookings()
    return
  }
  const removeWorkImage = event.target.closest('[data-remove-work-image]')
  if (removeWorkImage) {
    const booking = owner.bookings.find((item) => item.id === removeWorkImage.dataset.workBooking)
    if (!booking) return
    const images = [...(booking.workImages || [])]
    images.splice(Number(removeWorkImage.dataset.removeWorkImage), 1)
    saveWorkImages(booking.id, images).catch((error) => toast(error.message))
    return
  }
  const dateCell = event.target.closest('[data-calendar-date]')
  if (dateCell) {
    owner.adminView = 'all'
    els.filterDate.value = dateCell.dataset.calendarDate
    els.filterStatus.value = 'active'
    renderBookings()
    return
  }
  const button = event.target.closest('[data-booking]')
  if (!button) return
  updateBookingStatus(button.dataset.booking, button.dataset.status).catch((error) => toast(error.message))
})
els.bookingList.addEventListener('change', (event) => {
  if (!event.target.matches('[data-work-image-input]')) return
  handleWorkImageFiles(event.target.dataset.workImageInput, event.target.files).catch((error) => toast(error.message))
})
els.addServiceButton.addEventListener('click', () => {
  owner.serviceEditor = blankServiceEditor()
  renderServices()
})
els.serviceEditor.addEventListener('click', (event) => {
  if (event.target.closest('[data-cancel-service-editor]')) {
    owner.serviceEditor = null
    renderServices()
  }
})
els.serviceEditor.addEventListener('submit', (event) => {
  if (!event.target.matches('#serviceEditorForm')) return
  saveServiceEditor(event).catch((error) => toast(error.message))
})
els.serviceAdminList.addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-edit-service]')
  if (editButton) {
    const service = owner.services.find((item) => item.id === editButton.dataset.editService)
    owner.serviceEditor = editorFromService(service)
    renderServices()
    return
  }
  const button = event.target.closest('[data-save-service]')
  if (!button) return
  saveService(button.dataset.saveService).catch((error) => toast(error.message))
})

function switchAdminLang(lang) {
  owner.lang = lang
  localStorage.setItem('lucky-admin-lang', lang)
  render()
}

async function initAdmin() {
  applyLanguage()
  setLocked(true)
  if (!owner.auth?.accessToken) return
  try {
    await request('/admin/auth/me')
    await loadAll()
  } catch (error) {
    ownerLogout()
    toast(error.message)
  }
}

initAdmin().catch((error) => toast(error.message))
