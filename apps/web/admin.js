const owner = {
  token: '',
  auth: readJson('lucky-owner-auth'),
  role: readJson('lucky-owner-auth')?.admin?.role || 'owner',
  lang: localStorage.getItem('lucky-admin-lang') || 'zh',
  bookings: [],
  services: [],
  technicians: [],
  customers: [],
  adminView: 'today',
  adminPage: 'dashboard',
  calendarDate: new Date(),
  serviceEditor: null,
  selectedBookingId: '',
  galleryDetailId: '',
  galleryPlatform: 'xiaohongshu',
  gallerySelections: {},
  galleryMockImages: {},
  galleryMockApproved: {},
  finance: null,
  dashboardDetail: 'today',
  aiBrief: null,
  aiLoading: '',
  aiResults: {},
  aiCopyHistory: readJson('lucky-admin-social-copy-history') || {}
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
  adminSidebar: document.querySelector('#adminSidebar'),
  sidebarLinks: [...document.querySelectorAll('.sidebar-link')],
  sidebarDashboard: document.querySelector('#sidebarDashboard'),
  sidebarBookings: document.querySelector('#sidebarBookings'),
  sidebarSchedule: document.querySelector('#sidebarSchedule'),
  sidebarServices: document.querySelector('#sidebarServices'),
  sidebarCustomers: document.querySelector('#sidebarCustomers'),
  sidebarAiGallery: document.querySelector('#sidebarAiGallery'),
  adminDashboard: document.querySelector('#adminDashboard'),
  dashboardDetailPage: document.querySelector('#dashboardDetailPage'),
  dashboardCharts: document.querySelector('#dashboardCharts'),
  dashboardDetailPanel: document.querySelector('#dashboardDetailPanel'),
  dashboardEyebrow: document.querySelector('#dashboardEyebrow'),
  dashboardTitle: document.querySelector('#dashboardTitle'),
  dashboardSubtitle: document.querySelector('#dashboardSubtitle'),
  aiBriefPanel: document.querySelector('#aiBriefPanel'),
  financePanel: document.querySelector('#financePanel'),
  bookingsPage: document.querySelector('#bookingsPage'),
  schedulePage: document.querySelector('#schedulePage'),
  servicesPage: document.querySelector('#servicesPage'),
  customersPage: document.querySelector('#customersPage'),
  aiGalleryPage: document.querySelector('#aiGalleryPage'),
  aiGalleryEyebrow: document.querySelector('#aiGalleryEyebrow'),
  aiGalleryTitle: document.querySelector('#aiGalleryTitle'),
  aiGallerySubtitle: document.querySelector('#aiGallerySubtitle'),
  aiGalleryList: document.querySelector('#aiGalleryList'),
  customersTitle: document.querySelector('#customersTitle'),
  customerFilterSummary: document.querySelector('#customerFilterSummary'),
  customerSort: document.querySelector('#customerSort'),
  customerList: document.querySelector('#customerList'),
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
  techPerformanceEyebrow: document.querySelector('#techPerformanceEyebrow'),
  techPerformanceTitle: document.querySelector('#techPerformanceTitle'),
  technicianPerformance: document.querySelector('#technicianPerformance'),
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
    staffConsole: '员工工作台',
    customerApp: '客户网页',
    reload: '刷新',
    ownerAccess: '后台权限',
    ownerLogin: '后台登录',
    ownerLoginText: '请使用已批准的 owner 或员工邮箱登录。系统会根据账号权限显示对应功能。',
    email: '邮箱',
    password: '密码',
    login: '登录',
    registerOwner: '注册 Owner',
    logout: '退出',
    bookings: '订单管理',
    dashboard: '后台首页',
    dashboardSubtitle: '当天运营、本月趋势、财务与预约完成度总览',
    monthlyRevenue: '待验证月收入',
    monthServices: '月服务',
    totalServices: '总服务',
    openFinance: '查看财务',
    financeLogin: '财务登录',
    financeText: '总收入和完整财务数据需要二次验证后查看。',
    financePassword: '财务密码',
    totalRevenue: '总收入',
    financeUnlocked: '财务信息已解锁。',
    navBookings: '订单管理',
    navSchedule: '排班管理',
    navServices: '服务管理',
    navCustomers: '客户档案',
    navAiGallery: 'AI 图库',
    aiDailyBrief: 'AI 今日简报',
    generateBrief: '生成简报',
    aiGallery: 'AI 图库',
    aiGallerySubtitle: '完工作品、AI 文案与可发布素材',
    aiBookingSummary: 'AI 订单摘要',
    aiCustomerInsight: 'AI 客户洞察',
    aiSocialCopy: '生成社媒文案',
    aiProcessing: 'AI 处理中...',
    xiaohongshu: '小红书',
    douyin: '抖音',
    instagram: 'Instagram',
    aiNoWork: '暂无完工作品图，技师上传后会进入图库。',
    copyCaption: '复制文案',
    aiStatusUploaded: '已上传',
    aiStatusProcessing: 'AI 处理中',
    aiStatusReview: '待确认',
    aiStatusReady: '可发布',
    originalImage: '原图',
    editedImage: 'AI 修图版',
    shareLink: '转发链接',
    openShare: '打开分享页',
    viewWork: '查看作品',
    galleryBack: '返回图库',
    confirmGallery: '确认入库',
    selectedImages: '已选图片',
    lockedGallery: '已完成',
    draftGallery: '待确认',
    lockedAt: '确认时间',
    downloadImage: '下载图片',
    uploadMoreImages: '上传更多图片',
    mainImage: '主图',
    mockGallery: '演示图库',
    platformLinks: '发布平台',
    todayOverview: '今日运营',
    monthOverview: '本月趋势',
    bookingLoad: '预约完成度',
    customerTraffic: '客户流量',
    channelTraffic: '渠道来源',
    retentionReminder: '留存率提醒',
    retentionRate: '留存率',
    revisitDue: '待回访客户',
    dailyRevenueTrend: '月收入趋势',
    dailyDetail: '每日明细',
    popularStyle: '最热门款式',
    topRatedTechnician: '好评度最高技师',
    estimatedRating: '好评度',
    technicianPerformance: '技师业绩',
    techStatus: '当前状态',
    servingNow: '服务中',
    scheduledToday: '今日有预约',
    available: '可安排',
    monthPeople: '本月人数',
    monthAmount: '本月金额',
    monthCompletedAmount: '本月已完成金额',
    todayBookings: '今日预约',
    activeBookings: '进行中预约',
    totalCustomers: '客户总数',
    recentCustomers: '最近到店',
    dashboardDetails: '数据明细',
    viewDetails: '查看明细',
    noDetailItems: '暂无对应明细',
    financeLockedHint: '点击月收入后输入财务密码，可查看总收入。',
    pendingServices: '待支付服务',
    confirmedServices: '已确认服务',
    monthServiceDetails: '本月已完成服务',
    totalServiceDetails: '全部已完成服务',
    customers: '客户档案',
    customerSortAlpha: '按首字母',
    customerSortVisits: '按到店次数',
    customerSortRecent: '最近到店',
    filter: '筛选',
    visits: '到店次数',
    lastVisit: '最近到店',
    totalSpent: '累计消费',
    noCustomers: '暂无客户档案',
    bookingsSubtitle: '全部订单数据，状态变化不会隐藏订单',
    sourceChannel: '途径',
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
    imageUrl: '服务图片',
    uploadImage: '上传图片',
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
    loginSuccess: '后台登录成功。',
    ownerCreated: 'Owner 账号已创建。',
    checkEmail: '请检查邮箱验证账号，然后再登录。',
    staffMode: '员工模式',
    restrictedForStaff: '员工账号仅显示订单、技师状态与 AI 图库工作流。',
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
    staffConsole: 'Staff Console',
    customerApp: 'Customer App',
    reload: 'Reload',
    ownerAccess: 'Admin Access',
    ownerLogin: 'Admin Login',
    ownerLoginText: 'Use an approved owner or staff email. The system shows features based on account role.',
    email: 'Email',
    password: 'Password',
    login: 'Login',
    registerOwner: 'Register Owner',
    logout: 'Log out',
    bookings: 'Orders',
    dashboard: 'Admin Home',
    dashboardSubtitle: 'Today, month, finance, traffic, and completion overview',
    monthlyRevenue: 'Verified Month Revenue',
    monthServices: 'Monthly Services',
    totalServices: 'Total Services',
    openFinance: 'View Finance',
    financeLogin: 'Finance Login',
    financeText: 'Total revenue and full finance data require a second verification.',
    financePassword: 'Finance Password',
    totalRevenue: 'Total Revenue',
    financeUnlocked: 'Finance unlocked.',
    navBookings: 'Order Management',
    navSchedule: 'Schedule',
    navServices: 'Services',
    navCustomers: 'Customer Profiles',
    navAiGallery: 'AI Gallery',
    aiDailyBrief: 'AI Daily Brief',
    generateBrief: 'Generate Brief',
    aiGallery: 'AI Gallery',
    aiGallerySubtitle: 'Finished work, AI captions, and publish-ready assets',
    aiBookingSummary: 'AI Booking Summary',
    aiCustomerInsight: 'AI Customer Insight',
    aiSocialCopy: 'Generate Social Copy',
    aiProcessing: 'AI working...',
    xiaohongshu: 'RED',
    douyin: 'Douyin',
    instagram: 'Instagram',
    aiNoWork: 'No finished work yet. Uploaded work photos will appear here.',
    copyCaption: 'Copy Caption',
    aiStatusUploaded: 'Uploaded',
    aiStatusProcessing: 'AI Processing',
    aiStatusReview: 'Needs Review',
    aiStatusReady: 'Publish Ready',
    originalImage: 'Original',
    editedImage: 'AI Edited',
    shareLink: 'Share Link',
    openShare: 'Open Share Page',
    viewWork: 'View Work',
    galleryBack: 'Back to Gallery',
    confirmGallery: 'Approve to Portfolio',
    selectedImages: 'Selected Images',
    lockedGallery: 'Completed',
    draftGallery: 'Needs Review',
    lockedAt: 'Approved At',
    downloadImage: 'Download Image',
    uploadMoreImages: 'Upload More Images',
    mainImage: 'Main Image',
    mockGallery: 'Demo Gallery',
    platformLinks: 'Publish Platforms',
    todayOverview: 'Today Overview',
    monthOverview: 'Month Trend',
    bookingLoad: 'Booking Completion',
    customerTraffic: 'Customer Traffic',
    channelTraffic: 'Channel Sources',
    retentionReminder: 'Retention Reminder',
    retentionRate: 'Retention Rate',
    revisitDue: 'Revisit Due',
    dailyRevenueTrend: 'Revenue Trend',
    dailyDetail: 'Daily Detail',
    popularStyle: 'Most Popular Style',
    topRatedTechnician: 'Top Rated Technician',
    estimatedRating: 'Rating',
    technicianPerformance: 'Technician Performance',
    techStatus: 'Current Status',
    servingNow: 'Serving',
    scheduledToday: 'Booked Today',
    available: 'Available',
    monthPeople: 'Month Guests',
    monthAmount: 'Month Amount',
    monthCompletedAmount: 'Completed Amount',
    todayBookings: 'Today Bookings',
    activeBookings: 'Active Bookings',
    totalCustomers: 'Total Customers',
    recentCustomers: 'Recent Visits',
    dashboardDetails: 'Data Details',
    viewDetails: 'View Details',
    noDetailItems: 'No matching details',
    financeLockedHint: 'Open monthly revenue and enter the finance password to view total revenue.',
    pendingServices: 'Pending Payment Services',
    confirmedServices: 'Confirmed Services',
    monthServiceDetails: 'Completed This Month',
    totalServiceDetails: 'All Completed Services',
    customers: 'Customer Profiles',
    customerSortAlpha: 'A-Z',
    customerSortVisits: 'Visits',
    customerSortRecent: 'Recent Visit',
    filter: 'Filter',
    visits: 'Visits',
    lastVisit: 'Last Visit',
    totalSpent: 'Total Spent',
    noCustomers: 'No customer profiles',
    bookingsSubtitle: 'All orders stay visible when status changes',
    sourceChannel: 'Source Channel',
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
    imageUrl: 'Service Image',
    uploadImage: 'Upload Image',
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
    loginSuccess: 'Admin login successful.',
    ownerCreated: 'Owner account created.',
    checkEmail: 'Check your email to confirm the account, then log in.',
    staffMode: 'Staff Mode',
    restrictedForStaff: 'Staff accounts only show orders, technician status, and AI gallery workflow.',
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

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function ownerBearer() {
  return owner.auth?.accessToken || owner.token || ''
}

function isOwnerRole() {
  return owner.role === 'owner'
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
  const currentStatus = els.filterStatus.value || 'all'
  const currentCustomerSort = els.customerSort.value || 'alpha'
  document.documentElement.lang = owner.lang === 'zh' ? 'zh-CN' : 'en'
  els.adminLangZh.classList.toggle('active', owner.lang === 'zh')
  els.adminLangEn.classList.toggle('active', owner.lang === 'en')
  els.adminBrandTitle.textContent = t('adminTitle')
  els.adminBrandSubtitle.textContent = isOwnerRole() ? t('ownerConsole') : t('staffConsole')
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
  els.dashboardEyebrow.textContent = t('dashboard')
  els.dashboardTitle.textContent = t('dashboard')
  els.dashboardSubtitle.textContent = t('dashboardSubtitle')
  els.sidebarDashboard.textContent = t('dashboard')
  els.sidebarBookings.textContent = t('navBookings')
  els.sidebarSchedule.textContent = t('navSchedule')
  els.sidebarServices.textContent = t('navServices')
  els.sidebarCustomers.textContent = t('navCustomers')
  els.sidebarAiGallery.textContent = t('navAiGallery')
  els.bookingsTitle.textContent = t('bookings')
  els.bookingsSubtitle.textContent = t('bookingsSubtitle')
  els.customersTitle.textContent = t('customers')
  els.customerFilterSummary.textContent = t('filter')
  els.aiGalleryEyebrow.textContent = t('aiDailyBrief')
  els.aiGalleryTitle.textContent = t('aiGallery')
  els.aiGallerySubtitle.textContent = t('aiGallerySubtitle')
  els.customerSort.innerHTML = `
    <option value="alpha">${t('customerSortAlpha')}</option>
    <option value="visits">${t('customerSortVisits')}</option>
    <option value="recent">${t('customerSortRecent')}</option>
  `
  els.customerSort.value = currentCustomerSort
  els.todayTab.textContent = t('today')
  els.allTab.textContent = t('allBookings')
  els.calendarTab.textContent = t('calendar')
  els.filterDateLabel.textContent = t('date')
  els.filterStatusLabel.textContent = t('status')
  els.clearFilters.textContent = t('clear')
  els.scheduleTitle.textContent = t('schedule')
  els.techPerformanceEyebrow.textContent = t('monthOverview')
  els.techPerformanceTitle.textContent = t('technicianPerformance')
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
  if (!els.filterStatus.value) els.filterStatus.value = 'all'
}

async function loadAll() {
  owner.token = els.tokenInput.value.trim()
  if (owner.token) localStorage.setItem('lucky-owner-token', owner.token)
  if (!ownerBearer()) {
    setLocked(true)
    return
  }
  const [meData, bookingData, techData] = await Promise.all([
    request('/admin/auth/me'),
    request('/admin/bookings'),
    request('/admin/technicians')
  ])
  owner.role = meData.admin?.role || owner.auth?.admin?.role || 'owner'
  const [serviceData, customerData] = isOwnerRole()
    ? await Promise.all([request('/admin/services'), request('/admin/customers')])
    : [{ services: [] }, { customers: [] }]
  owner.bookings = bookingData.bookings
  owner.services = serviceData.services
  owner.technicians = techData.technicians
  owner.customers = customerData.customers
  if (!isOwnerRole() && !['bookings', 'schedule', 'aiGallery'].includes(owner.adminPage)) owner.adminPage = 'bookings'
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
  owner.auth.admin = data.admin || owner.auth.admin || {}
  owner.role = owner.auth.admin.role || 'owner'
  localStorage.setItem('lucky-owner-auth', JSON.stringify(owner.auth))
  toast(action === 'register' ? t('ownerCreated') : t('loginSuccess'))
  await loadAll()
}

function ownerLogout() {
  owner.auth = null
  owner.role = 'owner'
  owner.token = ''
  els.tokenInput.value = ''
  localStorage.removeItem('lucky-owner-auth')
  localStorage.removeItem('lucky-owner-token')
  owner.bookings = []
  owner.services = []
  owner.technicians = []
  owner.customers = []
  owner.serviceEditor = null
  owner.selectedBookingId = ''
  owner.finance = null
  owner.adminPage = 'dashboard'
  owner.dashboardDetail = 'today'
  setLocked(true)
  toast(t('loggedOut'))
}

function setLocked(locked) {
  els.adminLayout.classList.toggle('hidden', locked)
  els.ownerLogin.classList.toggle('hidden', !locked)
  els.reloadButton.classList.toggle('hidden', locked)
  els.tokenInput.classList.add('hidden')
  els.ownerLogout.classList.toggle('hidden', locked)
  if (locked) {
    els.bookingList.innerHTML = ''
    els.metricGrid.innerHTML = ''
    els.serviceAdminList.innerHTML = ''
    els.serviceEditor.innerHTML = ''
    els.scheduleTech.innerHTML = ''
    els.technicianPerformance.innerHTML = ''
    els.customerList.innerHTML = ''
    els.dashboardCharts.innerHTML = ''
    els.dashboardDetailPanel.innerHTML = ''
    els.aiBriefPanel.innerHTML = ''
    els.aiGalleryList.innerHTML = ''
    els.financePanel.innerHTML = ''
  }
}

function render() {
  applyLanguage()
  renderMetrics()
  renderAdminPages()
  renderDashboard()
  renderBookings()
  renderServices()
  renderTechnicians()
  renderTechnicianPerformance()
  renderCustomers()
  renderAiBrief()
  renderAiGallery()
  renderFinancePanel()
}

function renderMetrics() {
  if (!isOwnerRole()) {
    const todayCount = owner.bookings.filter((item) => isToday(item.appointmentDate)).length
    const activeCount = owner.bookings.filter((item) => activeStatuses().includes(item.status)).length
    const reviewCount = galleryGroups().filter((group) => group.booking.galleryStatus !== 'approved').length
    els.metricGrid.innerHTML = `
      <button class="metric" data-admin-page="bookings" type="button"><span class="subtle">${t('todayBookings')}</span><strong>${todayCount}</strong></button>
      <button class="metric" data-admin-page="bookings" type="button"><span class="subtle">${t('activeBookings')}</span><strong>${activeCount}</strong></button>
      <button class="metric" data-admin-page="aiGallery" type="button"><span class="subtle">${t('aiStatusReview')}</span><strong>${reviewCount}</strong></button>
      <button class="metric" data-admin-page="schedule" type="button"><span class="subtle">${t('staffMode')}</span><strong>${owner.technicians.length}</strong></button>
    `
    return
  }
  const stats = dashboardStats()
  els.metricGrid.innerHTML = `
    <button class="metric" data-dashboard-detail="confirmed" type="button"><span class="subtle">${t('confirmed')}</span><strong>${stats.confirmed}</strong></button>
    <button class="metric" data-dashboard-detail="pending" type="button"><span class="subtle">${t('pending')}</span><strong>${stats.pending}</strong></button>
    <button class="metric revenue-metric" data-dashboard-detail="finance" data-open-finance type="button"><span class="subtle">${t('monthlyRevenue')}</span><strong>${money(stats.monthRevenue)}</strong></button>
    <button class="metric" data-dashboard-detail="monthServices" type="button"><span class="subtle">${t('monthServices')}</span><strong>${stats.monthServices}</strong></button>
    <button class="metric" data-dashboard-detail="totalServices" type="button"><span class="subtle">${t('totalServices')}</span><strong>${stats.totalServices}</strong></button>
  `
}

function isCurrentMonth(dateString) {
  if (!dateString) return false
  const date = new Date(`${dateString}T12:00:00`)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function isToday(dateString) {
  return dateString === formatDate(new Date())
}

function dashboardStats() {
  const confirmed = owner.bookings.filter((item) => item.status === 'CONFIRMED').length
  const pending = owner.bookings.filter((item) => item.status === 'PENDING_PAYMENT').length
  const completed = owner.bookings.filter((item) => item.status === 'COMPLETED').length
  const cancelled = owner.bookings.filter((item) => ['CANCELLED', 'EXPIRED'].includes(item.status)).length
  const monthBookings = owner.bookings.filter((item) => isCurrentMonth(item.appointmentDate))
  const todayBookings = owner.bookings.filter((item) => isToday(item.appointmentDate))
  const monthRevenue = monthBookings
    .filter((item) => ['CONFIRMED', 'COMPLETED'].includes(item.status))
    .reduce((total, item) => total + (item.status === 'COMPLETED' ? item.servicePriceCents : item.depositCents), 0)
  const monthServices = monthBookings.filter((item) => item.status === 'COMPLETED').length
  return {
    confirmed,
    pending,
    completed,
    cancelled,
    monthBookings,
    todayBookings,
    monthRevenue,
    monthServices,
    totalServices: completed,
    active: confirmed + pending
  }
}

function bookingRevenueCents(booking) {
  if (!booking) return 0
  if (booking.status === 'COMPLETED') return booking.servicePriceCents || 0
  if (booking.status === 'CONFIRMED') return booking.depositCents || 0
  return 0
}

function monthRevenueRows() {
  const rows = owner.bookings
    .filter((booking) => isCurrentMonth(booking.appointmentDate))
    .filter((booking) => ['CONFIRMED', 'COMPLETED'].includes(booking.status))
    .reduce((groups, booking) => {
      const key = booking.appointmentDate
      groups[key] = groups[key] || { date: key, count: 0, amount: 0, completed: 0, confirmed: 0 }
      groups[key].count += 1
      groups[key].amount += bookingRevenueCents(booking)
      groups[key].completed += booking.status === 'COMPLETED' ? 1 : 0
      groups[key].confirmed += booking.status === 'CONFIRMED' ? 1 : 0
      return groups
    }, {})
  return Object.values(rows).sort((a, b) => a.date.localeCompare(b.date))
}

function popularStyle() {
  const counts = owner.bookings
    .filter((booking) => isCurrentMonth(booking.appointmentDate))
    .filter((booking) => ['CONFIRMED', 'COMPLETED'].includes(booking.status))
    .reduce((groups, booking) => {
      const name = booking.service?.name || booking.service?.category || 'Lucky Luxe'
      groups[name] = (groups[name] || 0) + 1
      return groups
    }, {})
  const [name, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['-', 0]
  return { name, count }
}

function topRatedTechnician() {
  const rows = technicianPerformanceRows()
    .map((tech) => ({
      ...tech,
      rating: Math.min(5, 4.7 + Math.min(0.25, tech.completed * 0.03))
    }))
    .sort((a, b) => b.rating - a.rating || b.completed - a.completed)
  return rows[0] || { name: '-', rating: 0, completed: 0 }
}

function retentionStats() {
  const customers = owner.customers || []
  const repeat = customers.filter((customer) => Number(customer.visitCount || 0) > 1)
  const due = customers
    .filter((customer) => {
      if (!customer.lastVisitAt) return true
      const days = (Date.now() - new Date(customer.lastVisitAt).getTime()) / 86400000
      return days >= 30
    })
    .sort((a, b) => (new Date(a.lastVisitAt || 0)).getTime() - (new Date(b.lastVisitAt || 0)).getTime())
  return {
    total: customers.length,
    repeat: repeat.length,
    rate: customers.length ? Math.round((repeat.length / customers.length) * 100) : 0,
    due: due.slice(0, 8)
  }
}

function sourceChannels() {
  return owner.lang === 'zh'
    ? ['美团', '大众点评', '小红书', '抖音', '微信', '到店转介绍']
    : ['Meituan', 'Dianping', 'RED', 'Douyin', 'WeChat', 'Referral']
}

function hashText(value = '') {
  return [...String(value)].reduce((total, char) => total + char.charCodeAt(0), 0)
}

function bookingSource(booking) {
  if (booking.sourceChannel || booking.source || booking.channel) return booking.sourceChannel || booking.source || booking.channel
  const channels = sourceChannels()
  return channels[hashText(booking.publicCode || booking.id || booking.service?.name) % channels.length]
}

function renderAdminPages() {
  els.sidebarDashboard.classList.toggle('hidden', !isOwnerRole())
  els.sidebarServices.classList.toggle('hidden', !isOwnerRole())
  els.sidebarCustomers.classList.toggle('hidden', !isOwnerRole())
  if (!isOwnerRole() && ['dashboard', 'dashboardDetail', 'services', 'customers'].includes(owner.adminPage)) owner.adminPage = 'bookings'
  const pages = {
    dashboard: els.adminDashboard,
    dashboardDetail: els.dashboardDetailPage,
    bookings: els.bookingsPage,
    schedule: els.schedulePage,
    services: els.servicesPage,
    customers: els.customersPage,
    aiGallery: els.aiGalleryPage
  }
  Object.entries(pages).forEach(([key, element]) => element.classList.toggle('hidden', owner.adminPage !== key))
  els.metricGrid.classList.toggle('hidden', owner.adminPage !== 'dashboard')
  els.sidebarLinks.forEach((link) => {
    const activePage = owner.adminPage === 'dashboardDetail' ? 'dashboard' : owner.adminPage
    link.classList.toggle('active', link.dataset.adminPage === activePage)
  })
}

function renderDashboard() {
  const stats = dashboardStats()
  const channelRows = trafficChannels()
  const techRows = technicianPerformanceRows()
  const dailyRows = monthRevenueRows()
  const popular = popularStyle()
  const topTech = topRatedTechnician()
  const retention = retentionStats()
  const maxChannel = Math.max(...channelRows.map((item) => item.count), 1)
  const maxTech = Math.max(...techRows.map((item) => item.completed), 1)
  const maxDaily = Math.max(...dailyRows.map((item) => item.amount), 1)
  els.dashboardCharts.innerHTML = `
    <button class="dashboard-chart-card card" data-dashboard-detail="today" type="button">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('todayOverview')}</p>
          <h2>${stats.todayBookings.length}</h2>
        </div>
        <span class="dashboard-card-cue">${t('viewDetails')}</span>
      </div>
      <div class="chart-stat-row">
        <span>${t('activeBookings')}</span>
        <strong>${stats.todayBookings.filter((item) => activeStatuses().includes(item.status)).length}</strong>
      </div>
      <div class="chart-stat-row">
        <span>${t('confirmed')}</span>
        <strong>${stats.todayBookings.filter((item) => item.status === 'CONFIRMED').length}</strong>
      </div>
    </button>
    <button class="dashboard-chart-card card" data-dashboard-detail="finance" type="button">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('dailyRevenueTrend')}</p>
          <h2>${money(stats.monthRevenue)}</h2>
        </div>
        <span class="dashboard-card-cue">${t('viewDetails')}</span>
      </div>
      ${dailyRows.slice(-4).map((row) => chartBar(row.date.slice(5), money(row.amount), maxDaily, Math.max(8, Math.round((row.amount / maxDaily) * 100)))).join('') || `<div class="empty-state small-empty">${t('noDetailItems')}</div>`}
      <div class="chart-stat-row"><span>${t('popularStyle')}</span><strong>${escapeHtml(popular.name)} · ${popular.count}</strong></div>
      <div class="chart-stat-row"><span>${t('topRatedTechnician')}</span><strong>${escapeHtml(topTech.name)} · ${topTech.rating.toFixed(1)}</strong></div>
    </button>
    <button class="dashboard-chart-card card" data-dashboard-detail="monthServices" type="button">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('monthOverview')}</p>
          <h2>${stats.monthBookings.length}</h2>
        </div>
        <span class="dashboard-card-cue">${t('viewDetails')}</span>
      </div>
      ${chartBar(t('monthServices'), stats.monthServices, Math.max(stats.monthBookings.length, 1))}
      ${chartBar(t('pending'), stats.monthBookings.filter((item) => item.status === 'PENDING_PAYMENT').length, Math.max(stats.monthBookings.length, 1))}
      ${chartBar(t('revenue'), money(stats.monthRevenue), Math.max(stats.monthBookings.length, 1), 100)}
    </button>
    <button class="dashboard-chart-card card" data-dashboard-detail="technicians" type="button">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('technicianPerformance')}</p>
          <h2>${techRows.reduce((sum, item) => sum + item.completed, 0)}</h2>
        </div>
        <span class="dashboard-card-cue">${t('viewDetails')}</span>
      </div>
      ${techRows.map((tech) => chartBar(`${tech.name} · ${tech.status}`, tech.completed, maxTech)).join('')}
    </button>
    <button class="dashboard-chart-card card" data-dashboard-detail="channels" type="button">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('channelTraffic')}</p>
          <h2>${channelRows.reduce((sum, item) => sum + item.count, 0)}</h2>
        </div>
        <span class="dashboard-card-cue">${t('viewDetails')}</span>
      </div>
      ${channelRows.map((channel) => chartBar(channel.name, channel.count, maxChannel)).join('')}
    </button>
    <button class="dashboard-chart-card card" data-dashboard-detail="retention" type="button">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('retentionReminder')}</p>
          <h2>${retention.rate}%</h2>
        </div>
        <span class="dashboard-card-cue">${t('viewDetails')}</span>
      </div>
      <div class="chart-stat-row"><span>${t('retentionRate')}</span><strong>${retention.repeat}/${retention.total}</strong></div>
      <div class="chart-stat-row"><span>${t('revisitDue')}</span><strong>${retention.due.length}</strong></div>
      ${retention.due.slice(0, 3).map((customer) => chartBar(customerName(customer), customer.visitCount || 0, Math.max(...retention.due.map((item) => item.visitCount || 0), 1))).join('') || `<div class="empty-state small-empty">${t('noDetailItems')}</div>`}
    </button>
  `
  renderDashboardDetail()
}

function renderAiBrief() {
  const data = owner.aiBrief?.data || owner.aiBrief
  els.aiBriefPanel.innerHTML = `
    <div class="section-row compact-row">
      <div>
        <p class="eyebrow">${t('aiDailyBrief')}</p>
        <h2>${data ? escapeHtml(owner.lang === 'en' ? data.headlineEn : data.headlineZh) : t('aiDailyBrief')}</h2>
      </div>
      <button class="ghost slim" data-ai-brief type="button">${owner.aiLoading === 'brief' ? t('aiProcessing') : t('generateBrief')}</button>
    </div>
    ${data ? `
      <div class="ai-brief-grid">
        ${renderAiList(owner.lang === 'en' ? 'Actions' : '建议行动', owner.lang === 'en' ? data.actionsEn : data.actionsZh)}
        ${renderAiList(owner.lang === 'en' ? 'Opportunities' : '机会', owner.lang === 'en' ? data.opportunitiesEn : data.opportunitiesZh)}
        ${renderAiList(owner.lang === 'en' ? 'Risks' : '风险', owner.lang === 'en' ? data.risksEn : data.risksZh)}
      </div>
    ` : `<p class="subtle">${owner.lang === 'zh' ? '点击生成后，AI 会根据预约、客户和服务数据给出今日运营建议。' : 'Generate an AI brief from bookings, customers, and services.'}</p>`}
  `
}

function renderAiList(title, items = []) {
  return `
    <div class="ai-list-card">
      <strong>${title}</strong>
      ${(items || []).map((item) => `<p>${escapeHtml(item)}</p>`).join('')}
    </div>
  `
}

function chartBar(label, value, max, forcedPercent) {
  const numeric = Number(value) || 0
  const percent = forcedPercent || Math.max(8, Math.round((numeric / Math.max(max, 1)) * 100))
  return `
    <div class="chart-bar-row">
      <div>
        <span>${label}</span>
        <strong>${value}</strong>
      </div>
      <i style="width:${Math.min(percent, 100)}%"></i>
    </div>
  `
}

function trafficChannels() {
  const total = Math.max(owner.customers.length, owner.bookings.length, 10)
  const channels = owner.lang === 'zh'
    ? ['大众点评', '美团', '小红书', '抖音', '微信']
    : ['Dianping', 'Meituan', 'RED', 'Douyin', 'WeChat']
  const weights = [0.18, 0.16, 0.28, 0.14, 0.24]
  return channels.map((name, index) => ({
    name,
    count: Math.max(1, Math.round(total * weights[index]))
  }))
}

function technicianPerformanceRows() {
  return owner.technicians.map((tech) => {
    const monthBookings = owner.bookings.filter((booking) => booking.technician?.id === tech.id && isCurrentMonth(booking.appointmentDate))
    const completed = monthBookings.filter((booking) => booking.status === 'COMPLETED')
    const activeToday = owner.bookings.find((booking) => booking.technician?.id === tech.id && isToday(booking.appointmentDate) && activeStatuses().includes(booking.status))
    const hasToday = owner.bookings.some((booking) => booking.technician?.id === tech.id && isToday(booking.appointmentDate))
    return {
      id: tech.id,
      name: tech.name,
      title: tech.title,
      completed: completed.length,
      amount: completed.reduce((sum, booking) => sum + booking.servicePriceCents, 0),
      people: new Set(monthBookings.map((booking) => booking.user?.id || booking.user?.email || booking.publicCode)).size,
      status: activeToday ? t('servingNow') : hasToday ? t('scheduledToday') : t('available')
    }
  })
}

function renderDashboardDetail() {
  const detail = dashboardDetail()
  if (detail.type === 'finance') {
    renderFinanceDashboardDetail(detail)
    return
  }
  els.dashboardDetailPanel.innerHTML = `
    <div class="section-row compact-row">
      <div>
        <p class="eyebrow">${t('dashboardDetails')}</p>
        <h2>${detail.title}</h2>
      </div>
    </div>
    ${detail.items.length ? `
      <div class="dashboard-detail-list">
        ${detail.items.map((item) => {
          if (detail.type === 'customers') return renderCustomerMini(item)
          if (detail.type === 'retention') return renderCustomerMini(item)
          if (detail.type === 'channels') return renderChannelMini(item)
          if (detail.type === 'technicians') return renderTechnicianMini(item)
          return renderBookingMini(item)
        }).join('')}
      </div>
    ` : `<div class="empty-state small-empty">${t('noDetailItems')}</div>`}
  `
}

function renderFinanceDashboardDetail(detail) {
  const popular = detail.meta?.popular || popularStyle()
  const topTech = detail.meta?.topTech || topRatedTechnician()
  els.dashboardDetailPanel.innerHTML = `
    <div class="section-row compact-row">
      <div>
        <p class="eyebrow">${t('dashboardDetails')}</p>
        <h2>${t('dailyRevenueTrend')}</h2>
      </div>
      <span class="subtle">${t('financeLockedHint')}</span>
    </div>
    <div class="finance-grid">
      <p><span>${t('monthlyRevenue')}</span><strong>${money(detail.meta?.monthRevenue || 0)}</strong></p>
      <p><span>${t('popularStyle')}</span><strong>${escapeHtml(popular.name)} · ${popular.count}</strong></p>
      <p><span>${t('topRatedTechnician')}</span><strong>${escapeHtml(topTech.name)} · ${topTech.rating.toFixed(1)}</strong></p>
      <p><span>${t('monthServices')}</span><strong>${detail.meta?.monthServices || 0}</strong></p>
    </div>
    ${detail.items.length ? `
      <div class="dashboard-detail-list">
        ${detail.items.map((row) => `
          <article class="dashboard-detail-card info-detail-card">
            <span class="mini-avatar">${row.date.slice(8)}</span>
            <span>
              <strong>${row.date} · ${money(row.amount)}</strong>
              <small>${t('completed')} ${row.completed} · ${t('confirmed')} ${row.confirmed}</small>
              <small>${t('bookings')} ${row.count}</small>
            </span>
          </article>
        `).join('')}
      </div>
    ` : `<div class="empty-state small-empty">${t('noDetailItems')}</div>`}
  `
}

function dashboardDetail() {
  const type = owner.dashboardDetail || 'today'
  const month = owner.bookings.filter((item) => isCurrentMonth(item.appointmentDate))
  if (type === 'finance') {
    const stats = dashboardStats()
    return {
      title: t('dailyRevenueTrend'),
      items: monthRevenueRows(),
      type,
      meta: {
        monthRevenue: stats.monthRevenue,
        monthServices: stats.monthServices,
        popular: popularStyle(),
        topTech: topRatedTechnician()
      }
    }
  }
  if (type === 'retention') {
    const retention = retentionStats()
    return {
      title: `${t('retentionReminder')} · ${retention.rate}%`,
      items: retention.due,
      type,
      meta: retention
    }
  }
  const details = {
    today: [t('todayBookings'), owner.bookings.filter((item) => isToday(item.appointmentDate))],
    pending: [t('pendingServices'), owner.bookings.filter((item) => item.status === 'PENDING_PAYMENT')],
    confirmed: [t('confirmedServices'), owner.bookings.filter((item) => item.status === 'CONFIRMED')],
    monthServices: [t('monthServiceDetails'), month.filter((item) => item.status === 'COMPLETED')],
    totalServices: [t('totalServiceDetails'), owner.bookings.filter((item) => item.status === 'COMPLETED')],
    customers: [t('recentCustomers'), sortedCustomers().slice(0, 8)],
    channels: [t('channelTraffic'), trafficChannels()],
    technicians: [t('technicianPerformance'), technicianPerformanceRows()]
  }
  const [title, items] = details[type] || details.today
  return { title, items, type }
}

function renderBookingMini(booking) {
  return `
    <button class="dashboard-detail-card" data-admin-page="bookings" data-view-booking="${booking.id}" type="button">
      <img src="${booking.service.imageUrl}" alt="${booking.service.name}">
      <span>
        <strong>${escapeHtml(booking.service.name)}</strong>
        <small>${booking.appointmentDate} · ${booking.appointmentTime} · ${escapeHtml(booking.technician?.name || '-')}</small>
        <small>${statusLabel(booking.status)} · ${money(booking.depositCents)} · ${booking.publicCode}</small>
      </span>
    </button>
  `
}

function renderCustomerMini(customer) {
  return `
    <button class="dashboard-detail-card" data-admin-page="customers" type="button">
      <span class="mini-avatar">${customerName(customer).slice(0, 1).toUpperCase()}</span>
      <span>
        <strong>${escapeHtml(customerName(customer))}</strong>
        <small>${t('visits')} ${customer.visitCount || 0} · ${t('lastVisit')} ${dateOnly(customer.lastVisitAt)}</small>
        <small>${escapeHtml(customer.email || '-')}</small>
      </span>
    </button>
  `
}

function renderChannelMini(channel) {
  return `
    <article class="dashboard-detail-card info-detail-card">
      <span class="mini-avatar">${escapeHtml(channel.name.slice(0, 1))}</span>
      <span>
        <strong>${escapeHtml(channel.name)}</strong>
        <small>${t('customerTraffic')} · ${channel.count}</small>
        <small>${t('viewDetails')}</small>
      </span>
    </article>
  `
}

function renderTechnicianMini(tech) {
  return `
    <article class="dashboard-detail-card info-detail-card">
      <span class="mini-avatar">${escapeHtml(tech.name.slice(0, 1))}</span>
      <span>
        <strong>${escapeHtml(tech.name)} · ${escapeHtml(tech.status)}</strong>
        <small>${t('monthPeople')} ${tech.people} · ${t('monthServices')} ${tech.completed}</small>
        <small>${t('monthAmount')} ${money(tech.amount)}</small>
      </span>
    </article>
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
  if (!bookings.length) {
    els.bookingList.innerHTML = `
      <div class="empty-state"><strong>${t('noBookings')}</strong><span>${t('adjustFilters')}</span></div>
    `
    return
  }
  const grouped = groupByDate(bookings)
  els.bookingList.innerHTML = `
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
  const status = owner.adminView === 'today' ? 'all' : (els.filterStatus.value || 'all')
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
  const isOpen = owner.selectedBookingId === booking.id
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
    ${isOpen ? renderBookingDetail(booking) : ''}
  `
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
        <div class="inline-actions">
          <button class="ghost slim" data-ai-booking="${booking.id}" type="button">${owner.aiLoading === `booking:${booking.id}` ? t('aiProcessing') : t('aiBookingSummary')}</button>
          <button class="ghost slim" data-close-booking-detail type="button">${t('close')}</button>
        </div>
      </div>
      ${owner.aiResults[`booking:${booking.id}`] ? renderBookingAiSummary(owner.aiResults[`booking:${booking.id}`].data || owner.aiResults[`booking:${booking.id}`]) : ''}
      <div class="booking-detail-grid">
        <p><span>${t('orderCode')}</span><strong>${booking.publicCode}</strong></p>
        <p><span>${t('status')}</span><strong>${statusLabel(booking.status)}</strong></p>
        <p><span>${t('date')}</span><strong>${booking.appointmentDate} ${booking.appointmentTime}-${booking.appointmentEndTime}</strong></p>
        <p><span>${t('technician')}</span><strong>${booking.technician.name}</strong></p>
        <p><span>${t('customer')}</span><strong>${booking.user?.display_name || booking.user?.email || '-'}</strong></p>
        <p><span>${t('sourceChannel')}</span><strong>${escapeHtml(bookingSource(booking))}</strong></p>
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

function renderBookingAiSummary(summary) {
  return `
    <div class="ai-result-box">
      <p><span>${t('aiBookingSummary')}</span><strong>${escapeHtml(owner.lang === 'en' ? summary.headlineEn : summary.headlineZh)}</strong></p>
      ${renderAiList(owner.lang === 'en' ? 'Preparation' : '准备事项', owner.lang === 'en' ? summary.preparationEn : summary.preparationZh)}
      ${renderAiList(owner.lang === 'en' ? 'Risks' : '风险', owner.lang === 'en' ? summary.risksEn : summary.risksZh)}
    </div>
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
      <label class="service-image-field">
        <span>${t('imageUrl')}</span>
        <img src="${escapeHtml(service.imageUrl)}" alt="${t('imageUrl')}">
        <input name="imageUrl" type="hidden" value="${escapeHtml(service.imageUrl)}">
        <input name="imageFile" type="file" accept="image/*">
        <small>${t('uploadImage')}</small>
      </label>
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

function renderTechnicianPerformance() {
  const rows = technicianPerformanceRows()
  if (!rows.length) {
    els.technicianPerformance.innerHTML = `<div class="empty-state small-empty">${t('noDetailItems')}</div>`
    return
  }
  els.technicianPerformance.innerHTML = rows.map((tech) => `
    <article class="technician-performance-card">
      <div>
        <h3>${escapeHtml(tech.name)}</h3>
        <p>${escapeHtml(tech.title || '')} · ${t('techStatus')} ${escapeHtml(tech.status)}</p>
      </div>
      <div class="performance-numbers">
        <span>${t('monthPeople')} <strong>${tech.people}</strong></span>
        <span>${t('monthServices')} <strong>${tech.completed}</strong></span>
        <span>${t('monthAmount')} <strong>${money(tech.amount)}</strong></span>
      </div>
    </article>
  `).join('')
}

function sortedCustomers() {
  const mode = els.customerSort.value || 'alpha'
  return [...owner.customers].sort((a, b) => {
    if (mode === 'visits') return (b.visitCount || 0) - (a.visitCount || 0) || customerName(a).localeCompare(customerName(b))
    if (mode === 'recent') return new Date(b.lastVisitAt || 0) - new Date(a.lastVisitAt || 0)
    return customerName(a).localeCompare(customerName(b))
  })
}

function customerName(customer) {
  return customer.displayName || customer.email || 'Lucky Member'
}

function dateOnly(value) {
  if (!value) return '-'
  return new Date(value).toISOString().slice(0, 10)
}

function renderCustomers() {
  const customers = sortedCustomers()
  if (!customers.length) {
    els.customerList.innerHTML = `<div class="empty-state"><strong>${t('noCustomers')}</strong></div>`
    return
  }
  els.customerList.innerHTML = customers.map((customer) => `
    <article class="customer-profile-card card">
      <div class="customer-avatar">${customerName(customer).slice(0, 1).toUpperCase()}</div>
      <div>
        <h3>${escapeHtml(customerName(customer))}</h3>
        <p>${escapeHtml(customer.email || '-')}</p>
        <p>${escapeHtml(customer.phone || '-')}</p>
        <button class="ghost slim" data-ai-customer="${customer.id}" type="button">${owner.aiLoading === `customer:${customer.id}` ? t('aiProcessing') : t('aiCustomerInsight')}</button>
      </div>
      <div class="customer-stats">
        <span>${t('visits')} <strong>${customer.visitCount || 0}</strong></span>
        <span>${t('lastVisit')} <strong>${dateOnly(customer.lastVisitAt)}</strong></span>
        <span>${t('totalSpent')} <strong>${money(customer.totalSpentCents || 0)}</strong></span>
      </div>
      ${owner.aiResults[`customer:${customer.id}`] ? renderCustomerInsight(owner.aiResults[`customer:${customer.id}`].data || owner.aiResults[`customer:${customer.id}`]) : ''}
    </article>
  `).join('')
}

function renderCustomerInsight(insight) {
  return `
    <div class="ai-result-box customer-ai-result">
      <p><span>${t('aiCustomerInsight')}</span><strong>${escapeHtml(owner.lang === 'en' ? insight.summaryEn : insight.summaryZh)}</strong></p>
      <p><span>${owner.lang === 'en' ? 'Recommendation' : '推荐'}</span><strong>${escapeHtml(owner.lang === 'en' ? insight.nextRecommendationEn : insight.nextRecommendationZh)}</strong></p>
      <small>${escapeHtml(owner.lang === 'en' ? insight.retentionActionEn : insight.retentionActionZh)}</small>
    </div>
  `
}

function galleryGroups() {
  const realGroups = owner.bookings
    .filter((booking) => booking.status === 'COMPLETED' || (Array.isArray(booking.workImages) && booking.workImages.length))
    .map((booking) => ({
      id: booking.id,
      booking,
      images: (booking.approvedWorkImages?.length ? booking.approvedWorkImages : booking.workImages || []).filter(Boolean),
      isMock: false
    }))
    .sort((a, b) => `${b.booking.appointmentDate} ${b.booking.appointmentTime}`.localeCompare(`${a.booking.appointmentDate} ${a.booking.appointmentTime}`))
  if (realGroups.length >= 3) return realGroups
  return [...realGroups, ...mockGalleryGroups().slice(0, 3 - realGroups.length)]
}

function mockGalleryGroups() {
  const baseDate = formatDate(new Date())
  const mocks = [
    {
      id: 'mock-gallery-french',
      service: { name: owner.lang === 'en' ? 'Classic Cream French' : '经典奶油法式', category: owner.lang === 'en' ? 'French' : '法式', imageUrl: '/assets/images/nail-french.png' },
      images: ['/assets/images/nail-french.png', '/assets/images/nail-luxe.png', '/assets/images/nail-jp.png'],
      technician: { name: 'Lina Zhou' },
      date: baseDate
    },
    {
      id: 'mock-gallery-lash',
      service: { name: owner.lang === 'en' ? 'Bare Natural Lash' : '裸感自然睫', category: owner.lang === 'en' ? 'Natural Lash' : '自然款', imageUrl: '/assets/images/lash-natural.png' },
      images: ['/assets/images/lash-natural.png', '/assets/images/lash-volume.png'],
      technician: { name: 'Mia Chen' },
      date: baseDate
    },
    {
      id: 'mock-gallery-soft',
      service: { name: owner.lang === 'en' ? 'Soft Volume Lash' : '轻盈浓密睫', category: owner.lang === 'en' ? 'Volume Lash' : '浓密款', imageUrl: '/assets/images/lash-volume.png' },
      images: ['/assets/images/lash-volume.png', '/assets/images/lash-lower.png'],
      technician: { name: 'Ava Lin' },
      date: baseDate
    }
  ]
  return mocks.map((mock) => ({
    id: mock.id,
    isMock: true,
    images: mockGalleryImages(mock),
    booking: {
      id: mock.id,
      appointmentDate: mock.date,
      appointmentTime: '14:30',
      technician: mock.technician,
      service: mock.service,
      publicCode: 'DEMO',
      workImages: mockGalleryImages(mock),
      approvedWorkImages: owner.galleryMockApproved[mock.id]?.images || [],
      galleryStatus: owner.galleryMockApproved[mock.id] ? 'approved' : 'draft',
      galleryLockedAt: owner.galleryMockApproved[mock.id]?.lockedAt || null
    }
  }))
}

function mockGalleryImages(mock) {
  if (!owner.galleryMockImages[mock.id]) owner.galleryMockImages[mock.id] = [...mock.images]
  return owner.galleryMockApproved[mock.id]?.images || owner.galleryMockImages[mock.id]
}

function renderAiGallery() {
  const groups = galleryGroups()
  const detail = groups.find((group) => group.id === owner.galleryDetailId)
  if (detail) {
    renderGalleryDetail(detail)
    return
  }
  if (!groups.length) {
    els.aiGalleryList.innerHTML = `<div class="empty-state"><strong>${t('aiNoWork')}</strong></div>`
    return
  }
  els.aiGalleryList.innerHTML = `<div class="ai-gallery-grid">${groups.map((group) => {
    const { booking } = group
    const images = Array.isArray(group.images) ? group.images.filter(Boolean) : []
    const status = galleryStatus(group)
    const mainImage = images[0] || booking.service?.imageUrl || '/assets/images/nail-french.png'
    return `
      <article class="ai-gallery-tile card">
        <button class="gallery-tile-image" data-gallery-detail="${group.id}" type="button" aria-label="${t('viewWork')}">
          <img src="${mainImage}" alt="${t('mainImage')}">
          <span class="gallery-status ${status.className}">${status.label}</span>
        </button>
        <div class="gallery-tile-copy">
          <h3>${escapeHtml(booking.service?.name || 'Lucky Luxe')}</h3>
          <p>${escapeHtml(booking.technician?.name || '')}</p>
          <p>${booking.appointmentDate} ${booking.appointmentTime || ''}</p>
          <small>${images.length} ${t('workImages')}${group.isMock ? ` · ${t('mockGallery')}` : ''}</small>
        </div>
      </article>
    `
  }).join('')}</div>`
}

function galleryStatus(group) {
  if (owner.aiLoading.startsWith(`social:${group.booking.id}:`)) return { className: 'processing', label: t('aiStatusProcessing') }
  const hasCopy = ['xiaohongshu', 'douyin', 'instagram'].some((platform) => owner.aiResults[socialKey(group.booking.id, 0, platform)])
  if (group.booking.galleryStatus === 'approved') return { className: 'ready', label: t('lockedGallery') }
  if (group.booking.status === 'COMPLETED') return { className: 'review', label: t('aiStatusReview') }
  if (hasCopy) return { className: 'review', label: t('aiStatusReview') }
  if (group.isMock) return { className: 'review', label: t('aiStatusReview') }
  return { className: 'uploaded', label: t('draftGallery') }
}

function renderGalleryDetail(group) {
  const { booking } = group
  const images = Array.isArray(group.images) ? group.images.filter(Boolean) : []
  const isLocked = booking.galleryStatus === 'approved'
  const selected = gallerySelectedImages(group)
  const copy = resolveSocialCopy(booking, 0, owner.galleryPlatform, group.isMock)
  els.aiGalleryList.innerHTML = `
    <section class="gallery-detail-page">
      <button class="ghost back-btn" data-gallery-back type="button">← ${t('galleryBack')}</button>
      <div class="gallery-detail-hero card">
        <img src="${images[0] || booking.service?.imageUrl || '/assets/images/nail-french.png'}" alt="${booking.service?.name || 'Lucky Luxe'}">
        <div>
          <div class="section-row compact-row">
            <div>
              <p class="eyebrow">${t('workImages')}</p>
              <h2>${escapeHtml(booking.service?.name || 'Lucky Luxe')}</h2>
            </div>
            <span class="gallery-status ${galleryStatus(group).className}">${galleryStatus(group).label}</span>
          </div>
          <div class="booking-detail-grid gallery-meta-grid">
            <p><span>${t('technician')}</span><strong>${escapeHtml(booking.technician?.name || '-')}</strong></p>
            <p><span>${t('date')}</span><strong>${booking.appointmentDate} ${booking.appointmentTime || ''}</strong></p>
            <p><span>${t('selectedImages')}</span><strong>${selected.length}/${images.length}</strong></p>
            ${isLocked ? `<p><span>${t('lockedAt')}</span><strong>${dateOnly(booking.galleryLockedAt)}</strong></p>` : ''}
          </div>
          ${isLocked ? `<p class="subtle">${owner.lang === 'zh' ? '此作品已确认入库，不能再上传、删除或修改图片。' : 'This gallery is approved and locked. Uploads, deletion, and edits are disabled.'}</p>` : ''}
        </div>
      </div>

      <section class="gallery-detail-section card">
        <div class="section-row compact-row">
          <h3>${t('workImages')}</h3>
          ${!isLocked ? `<label class="ghost slim upload-inline">${t('uploadMoreImages')}<input ${group.isMock ? `data-mock-work-image-input="${booking.id}"` : `data-work-image-input="${booking.id}"`} type="file" accept="image/*" multiple></label>` : ''}
        </div>
        <div class="gallery-review-grid">
          ${images.map((image, index) => `
            <article class="gallery-review-card">
              <img src="${image}" alt="${t('workImages')} ${index + 1}">
              <div class="gallery-review-actions">
                ${!isLocked ? `<label class="check-row"><input type="checkbox" data-gallery-select="${booking.id}" data-image-index="${index}" ${selected.includes(image) ? 'checked' : ''}><span>${t('selectedImages')}</span></label>` : ''}
                <a class="ghost slim" href="${image}" download="lucky-luxe-${booking.publicCode || booking.id}-${index + 1}.jpg">${t('downloadImage')}</a>
                ${!isLocked ? `<button class="ghost slim" data-remove-work-image="${index}" data-work-booking="${booking.id}" type="button">${t('cancel')}</button>` : ''}
              </div>
            </article>
          `).join('')}
        </div>
        ${images.length ? '' : `<div class="empty-state small-empty">${t('noWorkImages')}</div>`}
        ${!isLocked && images.length ? `<button class="primary slim" data-gallery-approve="${booking.id}" type="button">${t('confirmGallery')}</button>` : ''}
      </section>

      <section class="gallery-detail-section card">
        <div class="section-row compact-row">
          <h3>${t('aiSocialCopy')}</h3>
        </div>
        <div class="gallery-platform-list">
          ${['xiaohongshu', 'douyin', 'instagram'].map((platform) => `
            <div class="gallery-platform-row">
              <button class="ghost slim ${owner.galleryPlatform === platform ? 'active-pill' : ''}" data-gallery-platform="${platform}" data-gallery-platform-booking="${booking.id}" type="button">${t(platform)}</button>
              <a class="ghost slim share-link-button" href="${escapeHtml(shareUrlFor(booking.id, 0, platform))}" target="_blank" rel="noreferrer">${t('shareLink')}</a>
            </div>
          `).join('')}
        </div>
        ${copy ? renderSocialCopy(copy, socialKey(booking.id, 0, owner.galleryPlatform)) : `<p class="subtle">${t('aiSocialCopy')}</p>`}
      </section>
    </section>
  `
}

function gallerySelectedImages(group) {
  const images = Array.isArray(group.images) ? group.images.filter(Boolean) : []
  if (group.booking.galleryStatus === 'approved') return group.booking.approvedWorkImages?.length ? group.booking.approvedWorkImages : images
  if (!owner.gallerySelections[group.booking.id]) owner.gallerySelections[group.booking.id] = images.slice(0, 1)
  return owner.gallerySelections[group.booking.id].filter((image) => images.includes(image))
}

function updateGallerySelection(bookingId, image, checked) {
  const current = new Set(owner.gallerySelections[bookingId] || [])
  if (checked) current.add(image)
  else current.delete(image)
  owner.gallerySelections[bookingId] = [...current]
}

async function approveGallery(bookingId) {
  const group = galleryGroups().find((item) => item.booking.id === bookingId)
  if (!group) return
  const selected = gallerySelectedImages(group)
  if (group.isMock) {
    owner.galleryMockApproved[bookingId] = { images: selected, lockedAt: new Date().toISOString() }
    owner.galleryMockImages[bookingId] = selected
    owner.gallerySelections[bookingId] = selected
    toast(t('lockedGallery'))
    renderAiGallery()
    return
  }
  const data = await request(`/admin/bookings/${bookingId}/gallery-approval`, {
    method: 'PATCH',
    body: JSON.stringify({ images: selected })
  })
  owner.bookings = owner.bookings.map((booking) => booking.id === bookingId ? data.booking : booking)
  owner.gallerySelections[bookingId] = data.booking.approvedWorkImages || data.booking.workImages || []
  toast(t('lockedGallery'))
  renderAiGallery()
}

function socialKey(bookingId, index, platform) {
  return `social:${bookingId}:${index}:${platform}`
}

function copyFingerprint(copyData) {
  const data = copyData?.data || copyData
  if (!data) return ''
  return [data.titleZh, data.captionZh, data.titleEn, data.captionEn].filter(Boolean).join('\n')
}

function socialHistoryKey(audience, bookingId, index, platform) {
  return `${audience}:${bookingId}:${index}:${platform}`
}

function usedSocialHistory(audience, bookingId, index, platform) {
  return owner.aiCopyHistory[socialHistoryKey(audience, bookingId, index, platform)] || []
}

function rememberSocialHistory(audience, bookingId, index, platform, copyData) {
  const key = socialHistoryKey(audience, bookingId, index, platform)
  owner.aiCopyHistory[key] = [...new Set([...(owner.aiCopyHistory[key] || []), copyFingerprint(copyData)].filter(Boolean))].slice(-20)
  writeJson('lucky-admin-social-copy-history', owner.aiCopyHistory)
}

function resolveSocialCopy(booking, index, platform, isMock = false) {
  const saved = owner.aiResults[socialKey(booking.id, index, platform)]
  if (saved) return saved.data || saved
  return isMock ? fallbackSocialCopy(booking, platform) : null
}

function fallbackSocialCopy(booking, platform) {
  const serviceName = booking.service?.name || 'Lucky Luxe'
  const zh = {
    xiaohongshu: {
      title: `${serviceName}｜干净又显贵的细节`,
      caption: `今天这组是偏日常耐看的精致感，近看有细节，远看很干净。\n\n适合喜欢低调、通勤、约会都能搭的客人。到店可以带参考图，我们会根据手型、肤色和日常习惯微调。`,
      hashtags: ['#多伦多美甲', '#美甲分享', '#通勤美甲', '#LuckyLuxe']
    },
    douyin: {
      title: `${serviceName} 到店前后质感变化`,
      caption: `想要高级但不夸张的效果，可以参考这组。\n\n镜头里看是干净的，实际手上会更温柔。保存给下次预约用。`,
      hashtags: ['#今日美甲', '#美甲款式', '#同城美甲', '#LuckyLuxe']
    },
    instagram: {
      title: `${serviceName} | Soft Luxe Archive`,
      caption: `Soft, clean, and wearable from every angle.\n\nA polished Lucky Luxe finish for clients who love subtle details and a refined daily look.`,
      hashtags: ['#LuckyLuxeAtelier', '#nailarchive', '#lashstudio', '#torontobeauty']
    }
  }
  const item = zh[platform] || zh.xiaohongshu
  return {
    platform,
    styleTags: [booking.service?.category || 'soft luxury', 'clean', platform],
    titleZh: item.title,
    captionZh: item.caption,
    titleEn: platform === 'instagram' ? item.title : `${serviceName} | Soft Luxe Archive`,
    captionEn: platform === 'instagram' ? item.caption : 'A clean, polished Lucky Luxe finish with subtle detail and everyday wearability.',
    hashtags: item.hashtags,
    altTextZh: `${serviceName} 完工作品图`,
    altTextEn: `${serviceName} finished work archive`
  }
}

function shareUrlFor(bookingId, index, platform) {
  return `${window.location.origin}/web/share.html?bookingId=${encodeURIComponent(bookingId)}&image=${encodeURIComponent(index)}&platform=${encodeURIComponent(platform)}`
}

function renderSocialCopy(copy, key = '') {
  if (!copy) return `<p class="subtle">${t('aiSocialCopy')}</p>`
  const title = owner.lang === 'en' ? copy.titleEn : copy.titleZh
  const caption = owner.lang === 'en' ? copy.captionEn : copy.captionZh
  return `
    <div class="ai-copy-box">
      <strong>${escapeHtml(title || '')}</strong>
      <p>${escapeHtml(caption || '')}</p>
      <small>${(copy.hashtags || []).map(escapeHtml).join(' ')}</small>
      ${key ? `<button class="ghost slim" data-copy-caption="${key}" type="button">${t('copyCaption')}</button>` : ''}
    </div>
  `
}

async function copyCaptionByKey(key) {
  const [, bookingId, imageIndex, platform] = key.split(':')
  const group = galleryGroups().find((item) => item.booking.id === bookingId)
  if (!group) return
  const copy = resolveSocialCopy(group.booking, Number(imageIndex), platform, group.isMock)
  if (!copy) return
  const title = owner.lang === 'en' ? copy.titleEn : copy.titleZh
  const caption = owner.lang === 'en' ? copy.captionEn : copy.captionZh
  const text = [title, caption, (copy.hashtags || []).join(' ')].filter(Boolean).join('\n\n')
  await navigator.clipboard.writeText(text)
  toast(t('copyCaption'))
}

function renderFinancePanel() {
  if (els.financePanel.classList.contains('hidden')) return
  if (owner.finance) {
    els.financePanel.innerHTML = `
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('financeLogin')}</p>
          <h2>${t('totalRevenue')}</h2>
        </div>
        <button class="ghost slim" data-close-finance type="button">${t('close')}</button>
      </div>
      <div class="finance-grid">
        <p><span>${t('totalRevenue')}</span><strong>${money(owner.finance.total_revenue_cents || 0)}</strong></p>
        <p><span>${t('monthlyRevenue')}</span><strong>${money(owner.finance.month_revenue_cents || 0)}</strong></p>
        <p><span>${t('totalServices')}</span><strong>${owner.finance.completed_services || 0}</strong></p>
        <p><span>${t('monthServices')}</span><strong>${owner.finance.month_completed_services || 0}</strong></p>
      </div>
    `
    return
  }
  els.financePanel.innerHTML = `
    <form class="finance-form" id="financeForm">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${t('openFinance')}</p>
          <h2>${t('financeLogin')}</h2>
          <p class="subtle">${t('financeText')}</p>
        </div>
        <button class="ghost slim" data-close-finance type="button">${t('close')}</button>
      </div>
      <div class="form-grid">
        <label><span>${t('email')}</span><input name="email" type="email" autocomplete="username"></label>
        <label><span>${t('financePassword')}</span><input name="password" type="password" autocomplete="current-password"></label>
      </div>
      <button class="primary slim" type="submit">${t('login')}</button>
    </form>
  `
}

async function unlockFinance(event) {
  event.preventDefault()
  const form = new FormData(event.target)
  const data = await request('/admin/finance/summary', {
    method: 'POST',
    body: JSON.stringify({
      email: form.get('email'),
      password: form.get('password')
    })
  })
  owner.finance = data.finance
  toast(t('financeUnlocked'))
  renderFinancePanel()
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
  const imageFile = form.get('imageFile')
  const imageUrl = imageFile && imageFile.size ? await readCompressedImage(imageFile) : form.get('imageUrl')
  const body = {
    type: form.get('type'),
    category: form.get('category'),
    nameZh: form.get('nameZh'),
    nameEn: form.get('nameEn'),
    descriptionZh: form.get('descriptionZh'),
    descriptionEn: form.get('descriptionEn'),
    imageUrl,
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

async function generateDailyBrief() {
  owner.aiLoading = 'brief'
  renderAiBrief()
  try {
    const data = await request('/admin/ai/daily-brief', {
      method: 'POST',
      body: JSON.stringify({ lang: owner.lang })
    })
    owner.aiBrief = data.brief
  } finally {
    owner.aiLoading = ''
    renderAiBrief()
  }
}

async function generateBookingSummary(id) {
  owner.aiLoading = `booking:${id}`
  renderBookings()
  try {
    const data = await request('/admin/ai/booking-summary', {
      method: 'POST',
      body: JSON.stringify({ lang: owner.lang, bookingId: id })
    })
    owner.aiResults[`booking:${id}`] = data.summary
  } finally {
    owner.aiLoading = ''
    renderBookings()
  }
}

async function generateCustomerInsight(id) {
  owner.aiLoading = `customer:${id}`
  renderCustomers()
  try {
    const data = await request('/admin/ai/customer-insight', {
      method: 'POST',
      body: JSON.stringify({ lang: owner.lang, customerId: id })
    })
    owner.aiResults[`customer:${id}`] = data.insight
  } finally {
    owner.aiLoading = ''
    renderCustomers()
  }
}

async function generateSocialCopy(bookingId, index, platform) {
  const group = galleryGroups().find((item) => item.booking.id === bookingId)
  const booking = group?.booking
  if (!booking) return
  const image = group.images?.[Number(index)] || booking.workImages?.[Number(index)]
  const key = socialKey(bookingId, index, platform)
  owner.aiLoading = key
  renderAiGallery()
  try {
    const data = await request('/admin/ai/social-copy', {
      method: 'POST',
      body: JSON.stringify({
        lang: owner.lang,
        bookingId,
        booking,
        image,
        platform,
        audience: 'staff',
        variantSeed: `${Date.now()}:${Math.random()}`,
        avoidCaptions: usedSocialHistory('staff', bookingId, index, platform)
      })
    })
    owner.aiResults[key] = data.copy
    rememberSocialHistory('staff', bookingId, index, platform, data.copy)
  } finally {
    owner.aiLoading = ''
    renderAiGallery()
  }
}

els.adminLangZh.addEventListener('click', () => switchAdminLang('zh'))
els.adminLangEn.addEventListener('click', () => switchAdminLang('en'))
els.reloadButton.addEventListener('click', () => loadAll().catch((error) => toast(error.message)))
els.ownerLoginForm.addEventListener('submit', (event) => ownerLogin(event).catch((error) => toast(error.message)))
els.ownerLogout.addEventListener('click', ownerLogout)
els.adminLayout.addEventListener('click', (event) => {
  if (event.target.closest('[data-ai-brief]')) {
    generateDailyBrief().catch((error) => toast(error.message))
    return
  }
  const detailButton = event.target.closest('[data-dashboard-detail]')
  if (detailButton) {
    owner.dashboardDetail = detailButton.dataset.dashboardDetail
    owner.adminPage = 'dashboardDetail'
    render()
    return
  }
  const bookingDetailButton = event.target.closest('[data-view-booking]')
  if (bookingDetailButton) {
    owner.selectedBookingId = bookingDetailButton.dataset.viewBooking
    owner.adminPage = 'bookings'
    owner.adminView = 'all'
    els.filterDate.value = ''
    els.filterStatus.value = 'all'
    render()
    return
  }
  const pageButton = event.target.closest('[data-admin-page]')
  if (pageButton) {
    owner.adminPage = pageButton.dataset.adminPage
    if (owner.adminPage === 'bookings') owner.adminView = 'today'
    render()
    return
  }
  if (event.target.closest('[data-open-finance]')) {
    els.financePanel.classList.remove('hidden')
    renderFinancePanel()
    return
  }
  if (event.target.closest('[data-close-finance]')) {
    els.financePanel.classList.add('hidden')
  }
})
els.financePanel.addEventListener('submit', (event) => {
  if (!event.target.matches('#financeForm')) return
  unlockFinance(event).catch((error) => toast(error.message))
})
els.customerSort.addEventListener('change', renderCustomers)
els.adminTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    owner.adminView = tab.dataset.adminView
    if (owner.adminView === 'today') {
      els.filterDate.value = formatDate(new Date())
      els.filterStatus.value = 'all'
    } else if (owner.adminView === 'all') {
      els.filterDate.value = ''
      els.filterStatus.value = 'all'
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
  els.filterStatus.value = 'all'
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
  const aiBooking = event.target.closest('[data-ai-booking]')
  if (aiBooking) {
    generateBookingSummary(aiBooking.dataset.aiBooking).catch((error) => toast(error.message))
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
    els.filterStatus.value = 'all'
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
els.customerList.addEventListener('click', (event) => {
  const aiCustomer = event.target.closest('[data-ai-customer]')
  if (!aiCustomer) return
  generateCustomerInsight(aiCustomer.dataset.aiCustomer).catch((error) => toast(error.message))
})
els.aiGalleryList.addEventListener('click', (event) => {
  if (event.target.closest('[data-gallery-back]')) {
    owner.galleryDetailId = ''
    renderAiGallery()
    return
  }
  const detail = event.target.closest('[data-gallery-detail]')
  if (detail) {
    owner.galleryDetailId = detail.dataset.galleryDetail
    renderAiGallery()
    return
  }
  const platform = event.target.closest('[data-gallery-platform]')
  if (platform) {
    owner.galleryPlatform = platform.dataset.galleryPlatform
    const bookingId = platform.dataset.galleryPlatformBooking
    const group = galleryGroups().find((item) => item.booking.id === bookingId)
    const key = socialKey(bookingId, 0, owner.galleryPlatform)
    if (group && !group.isMock && !owner.aiResults[key]) {
      generateSocialCopy(bookingId, 0, owner.galleryPlatform).catch((error) => toast(error.message))
    } else {
      renderAiGallery()
    }
    return
  }
  const approve = event.target.closest('[data-gallery-approve]')
  if (approve) {
    approveGallery(approve.dataset.galleryApprove).catch((error) => toast(error.message))
    return
  }
  const removeWorkImage = event.target.closest('[data-remove-work-image]')
  if (removeWorkImage) {
    const group = galleryGroups().find((item) => item.booking.id === removeWorkImage.dataset.workBooking)
    if (group?.isMock) {
      const images = [...(owner.galleryMockImages[group.id] || [])]
      images.splice(Number(removeWorkImage.dataset.removeWorkImage), 1)
      owner.galleryMockImages[group.id] = images
      owner.gallerySelections[group.id] = (owner.gallerySelections[group.id] || []).filter((image) => images.includes(image))
      renderAiGallery()
      return
    }
    const booking = owner.bookings.find((item) => item.id === removeWorkImage.dataset.workBooking)
    if (!booking) return
    const images = [...(booking.workImages || [])]
    images.splice(Number(removeWorkImage.dataset.removeWorkImage), 1)
    saveWorkImages(booking.id, images).catch((error) => toast(error.message))
    return
  }
  const copyButton = event.target.closest('[data-copy-caption]')
  if (copyButton) {
    copyCaptionByKey(copyButton.dataset.copyCaption).catch((error) => toast(error.message))
    return
  }
  const social = event.target.closest('[data-ai-social]')
  if (!social) return
  generateSocialCopy(social.dataset.aiSocial, social.dataset.imageIndex, social.dataset.platform).catch((error) => toast(error.message))
})
els.aiGalleryList.addEventListener('change', (event) => {
  const mockInput = event.target.closest('[data-mock-work-image-input]')
  if (mockInput) {
    handleMockWorkImageFiles(mockInput.dataset.mockWorkImageInput, mockInput.files).catch((error) => toast(error.message))
    return
  }
  const input = event.target.closest('[data-work-image-input]')
  if (input) {
    handleWorkImageFiles(input.dataset.workImageInput, input.files).catch((error) => toast(error.message))
    return
  }
  const checkbox = event.target.closest('[data-gallery-select]')
  if (!checkbox) return
  const group = galleryGroups().find((item) => item.booking.id === checkbox.dataset.gallerySelect)
  const image = group?.images?.[Number(checkbox.dataset.imageIndex)]
  if (!image) return
  updateGallerySelection(checkbox.dataset.gallerySelect, image, checkbox.checked)
  renderAiGallery()
})

async function handleMockWorkImageFiles(id, files) {
  const selected = [...files].slice(0, 6)
  const images = await Promise.all(selected.map(readCompressedImage))
  owner.galleryMockImages[id] = [...(owner.galleryMockImages[id] || []), ...images].slice(0, 6)
  owner.gallerySelections[id] = owner.gallerySelections[id] || owner.galleryMockImages[id].slice(0, 1)
  toast(t('workImagesSaved'))
  renderAiGallery()
}
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
els.serviceEditor.addEventListener('change', (event) => {
  const input = event.target.closest('input[name="imageFile"]')
  if (!input || !input.files?.[0]) return
  readCompressedImage(input.files[0]).then((image) => {
    const form = input.closest('form')
    form.querySelector('input[name="imageUrl"]').value = image
    form.querySelector('.service-image-field img').src = image
  }).catch((error) => toast(error.message))
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
