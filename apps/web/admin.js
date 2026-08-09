// 构建号:每次交付递增。侧栏可见,排查"改了没生效"时先对版本。
const ADMIN_BUILD = '20260809c-audit-fix'
console.log(`[admin] build ${ADMIN_BUILD}`)

// "今天"必须按门店时区算,否则老板人在别的时区时全站日期错位一天。
// 2026-08-07 多租户清账:时区改为从 /admin/business-hours 下发的门店字段读(拿到之前用默认值兜底)。
// 注意:后端 process.env.TZ 目前仍是单一时区,跨时区门店的服务端日期口径见审计报告 B-1。
let STORE_TZ = 'America/Toronto'
function storeTimezone() {
  return (owner?.businessHoursStores || [])[0]?.timezone || STORE_TZ
}
function storeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: storeTimezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function readStoredAuth() {
  try {
    return readJson('lucky-owner-auth') || JSON.parse(sessionStorage.getItem('lucky-owner-auth') || 'null')
  } catch {
    return readJson('lucky-owner-auth')
  }
}

const owner = {
  token: '',
  auth: readStoredAuth(),
  role: readStoredAuth()?.admin?.role || 'owner',
  lang: localStorage.getItem('lucky-admin-lang') || 'zh',
  bookings: [],
  services: [],
  technicians: [],
  customers: [],
  selectedCustomerId: '',
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
  aiCopyHistory: readJson('lucky-admin-social-copy-history') || {},
  wechatMockSessionId: 'wechat-quote-01',
  wechatMockOverrides: readJson('lucky-wechat-mock-overrides') || {},
  wechatStatus: null,
  wechatConversations: [],
  quoteRequests: [],
  reminderTasks: [],
  manualDraftLink: '',
  wechatChatCustomerId: localStorage.getItem('lucky-wechat-chat-customer-id') || 'mock-customer-001',
  wechatChatSource: localStorage.getItem('lucky-wechat-chat-source') || '小红书',
  wechatChatStage: localStorage.getItem('lucky-wechat-chat-stage') || 'new_quote',
  wechatMockReferenceImages: [],
  businessHoursStores: [],
  wechatFilter: 'all',
  wechatSearch: '',
  tenantPlan: null,
  tenantKb: null,
  financeLedger: { month: '', data: null, rules: [], ledger: null, filterType: 'all', filterCategory: 'all', lockConfigured: undefined, lockEnabled: undefined, tab: 'quick' },
  financeKey: sessionStorage.getItem('lucky-finance-key') || ''
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
  sidebarWechatMock: document.querySelector('#sidebarWechatMock'),
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
  pricingPage: document.querySelector('#pricingPage'),
  pricingTabs: document.querySelector('#pricingTabs'),
  pricingCategoriesPanel: document.querySelector('#pricingCategoriesPanel'),
  pricingItemsPanel: document.querySelector('#pricingItemsPanel'),
  pricingRulesPanel: document.querySelector('#pricingRulesPanel'),
  pricingCategoryList: document.querySelector('#pricingCategoryList'),
  pricingItemList: document.querySelector('#pricingItemList'),
  pricingItemEditor: document.querySelector('#pricingItemEditor'),
  pricingRuleList: document.querySelector('#pricingRuleList'),
  pricingPreviewBox: document.querySelector('#pricingPreviewBox'),
  sidebarPricing: document.querySelector('#sidebarPricing'),
  membershipSettingsSummary: document.querySelector('#membershipSettingsSummary'),
  depositSettingsSummary: document.querySelector('#depositSettingsSummary'),
  depositSettingsBody: document.querySelector('#depositSettingsBody'),
  aiPackSummary: document.querySelector('#aiPackSummary'),
  aiPackBody: document.querySelector('#aiPackBody'),
  membershipSettingsBody: document.querySelector('#membershipSettingsBody'),
  membershipPage: document.querySelector('#membershipPage'),
  packageAdminList: document.querySelector('#packageAdminList'),
  couponAdminList: document.querySelector('#couponAdminList'),
  couponGrantCard: document.querySelector('#couponGrantCard'),
  couponGrantForm: document.querySelector('#couponGrantForm'),
  couponGrantFilters: document.querySelector('#couponGrantFilters'),
  couponGrantList: document.querySelector('#couponGrantList'),
  couponDiscountPanel: document.querySelector('#couponDiscountPanel'),
  couponDiscountBody: document.querySelector('#couponDiscountBody'),
  dcJumpBar: document.querySelector('#dcJumpBar'),
  pointsPrizeList: document.querySelector('#pointsPrizeList'),
  customersPage: document.querySelector('#customersPage'),
  wechatMockPage: document.querySelector('#wechatMockPage'),
  wechatMockEyebrow: document.querySelector('#wechatMockEyebrow'),
  wechatMockTitle: document.querySelector('#wechatMockTitle'),
  wechatMockSubtitle: document.querySelector('#wechatMockSubtitle'),
  wechatSessionTitle: document.querySelector('#wechatSessionTitle'),
  wechatMockBadge: document.querySelector('#wechatMockBadge'),
  wechatSessionList: document.querySelector('#wechatSessionList'),
  wechatMockDetail: document.querySelector('#wechatMockDetail'),
  sidebarWechatMockLabel: document.querySelector('#sidebarWechatMockLabel'),
  wechatNeedsHumanBadge: document.querySelector('#wechatNeedsHumanBadge'),
  wechatFilterBar: document.querySelector('#wechatFilterBar'),
  wechatContextPanel: document.querySelector('#wechatContextPanel'),
  wechatWorkflowPanel: document.querySelector('#wechatWorkflowPanel'),
  sidebarStoreSettings: document.querySelector('#sidebarStoreSettings'),
  storeSettingsPage: document.querySelector('#storeSettingsPage'),
  subscriptionBadge: document.querySelector('#subscriptionBadge'),
  storeSettingsEyebrow: document.querySelector('#storeSettingsEyebrow'),
  storeSettingsTitle: document.querySelector('#storeSettingsTitle'),
  storeSettingsSubtitle: document.querySelector('#storeSettingsSubtitle'),
  businessHoursTitle: document.querySelector('#businessHoursTitle'),
  businessHoursUpdated: document.querySelector('#businessHoursUpdated'),
  businessHoursEditor: document.querySelector('#businessHoursEditor'),
  saveBusinessHours: document.querySelector('#saveBusinessHours'),
  businessHoursSummary: document.querySelector('#businessHoursSummary'),
  planTitle: document.querySelector('#planTitle'),
  planSummary: document.querySelector('#planSummary'),
  planDetailBody: document.querySelector('#planDetailBody'),
  kbTitle: document.querySelector('#kbTitle'),
  kbSummary: document.querySelector('#kbSummary'),
  kbDetailBody: document.querySelector('#kbDetailBody'),
  storeInfoTitle: document.querySelector('#storeInfoTitle'),
  storeInfoSummary: document.querySelector('#storeInfoSummary'),
  storeInfoBody: document.querySelector('#storeInfoBody'),
  sidebarFinance: document.querySelector('#sidebarFinance'),
  financePage: document.querySelector('#financePage'),
  financePageTitle: document.querySelector('#financePageTitle'),
  financeMonth: document.querySelector('#financeMonth'),
  financeMetrics: document.querySelector('#financeMetrics'),
  financeQuickBody: document.querySelector('#financeQuickBody'),
  financeRecurringBody: document.querySelector('#financeRecurringBody'),
  financeRecurringSummary: document.querySelector('#financeRecurringSummary'),
  financeLedgerBody: document.querySelector('#financeLedgerBody'),
  financeLedgerSummary: document.querySelector('#financeLedgerSummary'),
  financeFilters: document.querySelector('#financeFilters'),
  financeTxnList: document.querySelector('#financeTxnList'),
  financeProgress: document.querySelector('#financeProgress'),
  storedValueBody: document.querySelector('#storedValueBody'),
  financeTargetsBody: document.querySelector('#financeTargetsBody'),
  financeTargetsSummary: document.querySelector('#financeTargetsSummary'),
  finNavPayroll: document.querySelector('#finNavPayroll'),
  financePayrollBody: document.querySelector('#financePayrollBody'),
  attendanceBody: document.querySelector('#attendanceBody'),
  salaryPlanButton: document.querySelector('#salaryPlanButton'),
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
  scheduleWeekEyebrow: document.querySelector('#scheduleWeekEyebrow'),
  scheduleWeekGrid: document.querySelector('#scheduleWeekGrid'),
  scheduleWeekToolbar: document.querySelector('#scheduleWeekToolbar'),
  scheduleThisWeek: document.querySelector('#scheduleThisWeek'),
  scheduleDefaultLabel: document.querySelector('#scheduleDefaultLabel'),
  applyWeekPattern: document.querySelector('#applyWeekPattern'),
  scheduleGridHint: document.querySelector('#scheduleGridHint'),
  addTechnicianButton: document.querySelector('#addTechnicianButton'),
  techPerformanceEyebrow: document.querySelector('#techPerformanceEyebrow'),
  techPerformanceTitle: document.querySelector('#techPerformanceTitle'),
  technicianPerformance: document.querySelector('#technicianPerformance'),
  servicesTitle: document.querySelector('#servicesTitle'),
  addServiceButton: document.querySelector('#addServiceButton'),
  serviceEditor: document.querySelector('#serviceEditor'),
  serviceAdminList: document.querySelector('#serviceAdminList'),
  scheduleStart: document.querySelector('#scheduleStart'),
  scheduleEnd: document.querySelector('#scheduleEnd'),
  toast: document.querySelector('#toast')
}

const copy = {
  zh: {
    adminTitle: '有迹 · 商家后台',
    ownerConsole: '店主控制台',
    staffConsole: '员工工作台',
    customerApp: '客户网页',
    reload: '刷新',
    ownerAccess: '后台权限',
    ownerLogin: '后台登录',
    ownerLoginText: '老板用 owner 邮箱登录,看到全部功能。员工请用员工邮箱登录:只会看到订单、排班和图库工作区,不会看到财务与客户档案。',
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
    navSchedule: '员工管理',
    navStaffPerformance: '技师业绩',
    navServices: '服务管理',
    navCustomers: '客户档案',
    navWechatMock: '客服工作台',
    navAiGallery: 'AI 图库',
    navStoreSettings: '门店设置',
    storeSettingsEyebrow: '商家自助设置',
    storeSettingsTitle: '门店设置',
    storeSettingsSubtitle: '保存后 AI 回答与预约空位立即生效',
    businessHoursTitle: '营业时间',
    saveBusinessHours: '保存营业时间',
    businessHoursSaved: '营业时间已保存，AI 回答与预约空位立即生效。',
    closedDay: '休息',
    lastUpdatedLabel: '最近修改',
    needsHumanQueue: '需人工处理',
    takeOverChat: '接管',
    releaseChatToAi: '归还 AI',
    filterAll: '全部',
    filterNeedsHuman: '需人工',
    filterAiActive: 'AI 接待中',
    searchCustomers: '搜索顾客',
    customerProfileCard: '顾客档案',
    aiMemoryCard: 'AI 工作记忆',
    quoteTasksCard: '报价任务',
    backendTasksCard: '后台任务',
    noTasks: '无进行中任务',
    mockPreviewGroup: 'Mock 预演（测试）',
    intentLabel: '意图',
    stageLabel: '阶段',
    refImagesLabel: '参考图',
    knowledgePanelGroup: '知识匹配详情',
    backendWorkflowGroup: '后端流程详情',
    takenOverToast: '已接管，AI 停止自动回复。',
    releasedToAiToast: '已归还 AI 接待。',
    wechatMockEyebrow: '企微 / 微信客服',
    wechatMockTitle: '客服工作台',
    wechatMockSubtitle: '真实会话优先，需人工处理的会话置顶；Mock 预演仅用于测试。',
    wechatSessionTitle: '进线会话',
    mockOnly: 'Mock 预演',
    aiReception: 'AI 接待',
    customerTimeline: '客户对话流',
    staffQuoteWorkbench: '技师报价工作台',
    sourceChannelQuestion: '渠道来源询问',
    quoteTask: '报价任务',
    waitingArtistQuote: '等待技师报价',
    quoteReturned: '技师已回价',
    draftPending: '草稿待确认',
    draftCreated: '预约草稿已创建',
    reminderSent: '10 分钟提醒已发送',
    draftReleased: '30 分钟已释放',
    paidConfirmed: '定金已支付',
    artistReply: '技师回价',
    canDo: '可做',
    cannotDo: '不可做',
    quotePriceCad: '报价 CAD',
    quoteDurationMin: '预计时长分钟',
    quoteNotes: '注意事项 / 缺失元素',
    aiPolishReply: 'AI 润色并回复',
    createDraft: '创建预约草稿',
    sendPaymentReminder: '发送 10 分钟提醒',
    releaseDraft: '释放 30 分钟草稿',
    miniProgramLink: '小程序草稿链接',
    quoteElements: '参考图要素',
    handoffRoute: '人工路由',
    expectedReplyTime: '预计 10 分钟内回价',
    noWechatSession: '暂无会话',
    wechatConnectionStatus: '真实接入状态',
    wechatWebhookUrl: '企业微信回调 URL',
    wechatConfigReady: '凭证已就绪',
    wechatConfigPending: '等待企业微信凭证',
    liveConversations: '真实/测试会话',
    sendMockInbound: '发送模拟微信消息',
    mockCustomerMessage: '客户消息',
    mockSource: '来源',
    injectMock: '注入测试消息',
    customerChatSimulator: '顾客端聊天模拟器',
    customerChatHint: '连续发消息测试 AI 是否按上下文回复；需要人工时右侧后台承接。',
    customerId: '顾客 ID',
    newMockCustomer: '新顾客',
    sendAsCustomer: '顾客发送',
    forceAiReply: '交回 AI 回复',
    adminManualReply: '后台人工承接',
    adminManualReplyHint: '用于模拟转人工、技师报价或复杂情况人工回复。人工回复后，会话会保持人工接管状态。',
    sendManualReply: '发送人工回复',
    sendKeepHuman: '发送并保持人工接管',
    sendReleaseAi: '发送并交回 AI',
    humanHandoffHint: '保持人工后，顾客新消息不会触发 AI；10 分钟无人工回复后会自动交回 AI。',
    waitingHuman: '等待人工',
    aiAutoReplied: 'AI 已回复',
    missingCredentials: '缺少配置',
    configured: '已配置',
    noLiveConversations: '暂无真实或测试会话。你可以先发送一条模拟微信消息。',
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
    topRatedTechnician: '本月完成最多技师',
    estimatedRating: '好评度',
    technicianPerformance: '技师业绩',
    myTechnicianPerformance: '我的技师业绩',
    staffPerformanceHint: '这里只显示当前登录技师的本月人数、服务次数、金额和当前状态。',
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
    viewCustomerFile: '查看档案',
    customerRecords: '到店记录',
    backToCustomers: '返回客户列表',
    noCustomerRecords: '暂无到店记录',
    recordImages: '图片记录',
    customerSince: '建档时间',
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
    depositLabel: '定金',
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
    adminTitle: 'Youji Merchant Admin',
    ownerConsole: 'Owner Console',
    staffConsole: 'Staff Console',
    customerApp: 'Customer App',
    reload: 'Reload',
    ownerAccess: 'Admin Access',
    ownerLogin: 'Admin Login',
    ownerLoginText: 'Owners see everything. Staff: log in with your staff email — you will only see bookings, schedule and the gallery workspace, never finance or customer files.',
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
    navSchedule: 'Staff',
    navStaffPerformance: 'My Performance',
    navServices: 'Services',
    navCustomers: 'Customer Profiles',
    navWechatMock: 'Service Workbench',
    navAiGallery: 'AI Gallery',
    navStoreSettings: 'Store Settings',
    storeSettingsEyebrow: 'Merchant Self-Service',
    storeSettingsTitle: 'Store Settings',
    storeSettingsSubtitle: 'Changes apply instantly to AI answers and booking availability',
    businessHoursTitle: 'Business Hours',
    saveBusinessHours: 'Save Business Hours',
    businessHoursSaved: 'Business hours saved. AI answers and availability updated instantly.',
    closedDay: 'Closed',
    lastUpdatedLabel: 'Last updated',
    needsHumanQueue: 'Needs Human',
    takeOverChat: 'Take Over',
    releaseChatToAi: 'Return to AI',
    filterAll: 'All',
    filterNeedsHuman: 'Needs Human',
    filterAiActive: 'AI Active',
    searchCustomers: 'Search customers',
    customerProfileCard: 'Customer Profile',
    aiMemoryCard: 'AI Working Memory',
    quoteTasksCard: 'Quote Tasks',
    backendTasksCard: 'Backend Tasks',
    noTasks: 'No active tasks',
    mockPreviewGroup: 'Mock Previews (testing)',
    intentLabel: 'Intent',
    stageLabel: 'Stage',
    refImagesLabel: 'Reference images',
    knowledgePanelGroup: 'Knowledge Match Details',
    backendWorkflowGroup: 'Backend Workflow Details',
    takenOverToast: 'Taken over. AI replies paused.',
    releasedToAiToast: 'Returned to AI.',
    wechatMockEyebrow: 'WeCom / WeChat Service',
    wechatMockTitle: 'Customer Service Workbench',
    wechatMockSubtitle: 'Live conversations first; needs-human chats pinned on top. Mock previews are for testing only.',
    wechatSessionTitle: 'Inbound Sessions',
    mockOnly: 'Mock Preview',
    aiReception: 'AI Reception',
    customerTimeline: 'Customer Timeline',
    staffQuoteWorkbench: 'Staff Quote Workbench',
    sourceChannelQuestion: 'Source Channel Question',
    quoteTask: 'Quote Task',
    waitingArtistQuote: 'Waiting for staff quote',
    quoteReturned: 'Quote Returned',
    draftPending: 'Draft Pending',
    draftCreated: 'Booking Draft Created',
    reminderSent: '10-min Reminder Sent',
    draftReleased: '30-min Draft Released',
    paidConfirmed: 'Deposit Paid',
    artistReply: 'Artist Reply',
    canDo: 'Can do',
    cannotDo: 'Cannot do',
    quotePriceCad: 'Quote CAD',
    quoteDurationMin: 'Estimated Duration Min',
    quoteNotes: 'Notes / Missing Elements',
    aiPolishReply: 'AI Polish & Reply',
    createDraft: 'Create Booking Draft',
    sendPaymentReminder: 'Send 10-min Reminder',
    releaseDraft: 'Release 30-min Draft',
    miniProgramLink: 'Mini Program Draft Link',
    quoteElements: 'Reference Elements',
    handoffRoute: 'Handoff Route',
    expectedReplyTime: 'Expected within 10 minutes',
    noWechatSession: 'No sessions',
    wechatConnectionStatus: 'Real Integration Status',
    wechatWebhookUrl: 'WeCom callback URL',
    wechatConfigReady: 'Credentials ready',
    wechatConfigPending: 'Waiting for WeCom credentials',
    liveConversations: 'Live/Test Conversations',
    sendMockInbound: 'Send mock WeChat message',
    mockCustomerMessage: 'Customer message',
    mockSource: 'Source',
    injectMock: 'Inject Test Message',
    customerChatSimulator: 'Customer Chat Simulator',
    customerChatHint: 'Send continuous customer messages to test AI context. When handoff is needed, reply from the admin side.',
    customerId: 'Customer ID',
    newMockCustomer: 'New Customer',
    sendAsCustomer: 'Send as Customer',
    forceAiReply: 'Return to AI',
    adminManualReply: 'Admin Manual Reply',
    adminManualReplyHint: 'Simulate human takeover, technician quotes, or complex replies. After manual reply, this conversation stays in human takeover.',
    sendManualReply: 'Send Manual Reply',
    sendKeepHuman: 'Send and keep human',
    sendReleaseAi: 'Send and return to AI',
    humanHandoffHint: 'When kept human, new customer messages will not trigger AI. AI resumes after 10 minutes without a staff reply.',
    waitingHuman: 'Waiting for human',
    aiAutoReplied: 'AI replied',
    missingCredentials: 'Missing config',
    configured: 'Configured',
    noLiveConversations: 'No live or test conversations yet. Send a mock WeChat message first.',
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
    topRatedTechnician: 'Top Technician (completed)',
    estimatedRating: 'Rating',
    technicianPerformance: 'Technician Performance',
    myTechnicianPerformance: 'My Technician Performance',
    staffPerformanceHint: 'Only your own monthly guests, services, revenue, and current status are shown here.',
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
    viewCustomerFile: 'Open Profile',
    customerRecords: 'Visit Records',
    backToCustomers: 'Back to Customers',
    noCustomerRecords: 'No visit records yet',
    recordImages: 'Image Records',
    customerSince: 'Profile Since',
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
    depositLabel: 'Deposit',
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
els.filterDate.value = storeToday()

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 金额一律按本店币种显示。以前写死 CAD,境内店(CNY)整个老板端都在显示加币。
// 取值:门店 currency → AI 事实 currency → CAD(旗舰店就是 CAD,显示结果一字不变)
function storeCurrency() {
  return (owner?.businessHoursStores || [])[0]?.currency || owner?.tenantKb?.facts?.currency || 'CAD'
}
// 币种显示映射表(与后端 CURRENCY_DISPLAY 同一套口径):
// CNY → 「¥358」;其它币种 → 「CAD $358」逐字维持现状,旗舰店零 diff。
const CURRENCY_DISPLAY = {
  CNY: { prefix: '', symbol: '¥', trimZeroDecimals: true },
  DEFAULT: { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false }
}
function money(cents, decimals = 0) {
  const code = storeCurrency()
  const fmt = CURRENCY_DISPLAY[String(code).toUpperCase()] || CURRENCY_DISPLAY.DEFAULT
  let text = Number(cents / 100).toFixed(Number(decimals) || 0)
  if (fmt.trimZeroDecimals) text = text.replace(/\.00$/, '')
  return `${fmt.prefix.replace('<CODE>', code)}${fmt.symbol}${text}`
}

// 本店是否开通 AI 智能包。2026-08-04 店主定:全部 AI 能力归智能包,前端据此隐藏纯 AI 入口。
// 数据来自启动时拉的 /admin/tenant/entitlements(owner.tenantPlan),与后端 requireAi() 同一个判断依据。
function hasAi() {
  return Boolean(owner.tenantPlan?.features?.ai_customer_service?.enabled)
}

// 套餐与续费状态(渲染在「门店设置 → 当前套餐」里);声明放这里,防 renderTenantPlan 早于文件尾执行时踩死区
const subState = { data: null, period: 'year', paying: false }
const SUB_STATUS = {
  active: { tag: '使用中', cls: 'ok' },
  expiring: { tag: '即将到期', cls: 'warn' },
  grace: { tag: '宽限期', cls: 'warn' },
  suspended: { tag: '已停用', cls: 'warn' },
  unlimited: { tag: '长期授权', cls: 'ok' }
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
  const isPublic = Boolean(options.public)
  delete options.public
  const doFetch = (token) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    return fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(token && !isPublic ? { authorization: `Bearer ${token}` } : {}),
        ...(owner.financeKey ? { 'x-finance-key': owner.financeKey } : {}),
        ...(options.headers || {})
      }
    }).finally(() => clearTimeout(timer))
  }
  let response
  try {
    response = await doFetch(ownerBearer())
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? '请求超时（30秒）：服务器没有响应，请查看服务器终端窗口' : (error.message || '网络错误：连不上服务器'))
  }
  if (response.status === 401 && !isPublic && owner.auth?.accessToken) {
    // 登录凭证过期时自动降级：丢弃过期 auth，用备用 token 重试一次
    owner.auth = null
    localStorage.removeItem('lucky-owner-auth')
    const fallbackToken = owner.token || localStorage.getItem('lucky-owner-token') || 'owner-demo-token'
    response = await doFetch(fallbackToken)
  }
  let data = null
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok) {
    // AI 智能包未开通:给一句人话 + 指路,而不是把后端英文原文弹给老板
    if (data.error?.code === 'AI_ADDON_REQUIRED') {
      const err = new Error('该功能属于 AI 智能包，去「门店设置 → 当前套餐」可申请试用或订阅')
      err.code = 'AI_ADDON_REQUIRED'
      throw err
    }
    const err = new Error(data.error?.message || `请求失败（HTTP ${response.status}）`)
    err.code = data.error?.code
    throw err
  }
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
  applyLoginRoleUi()
  els.ownerPasswordLabel.textContent = t('password')
  els.ownerLoginButton.textContent = t('login')
  els.ownerRegisterButton.textContent = t('registerOwner')
  els.ownerLogout.textContent = t('logout')
  els.dashboardEyebrow.textContent = t('dashboard')
  els.dashboardTitle.textContent = t('dashboard')
  els.dashboardSubtitle.textContent = t('dashboardSubtitle')
  els.sidebarDashboard.textContent = t('dashboard')
  els.sidebarBookings.textContent = t('navBookings')
  els.sidebarSchedule.textContent = isOwnerRole() ? t('navSchedule') : t('navStaffPerformance')
  const staffTabScheduleBtn = document.querySelector('#staffTabSchedule')
  if (staffTabScheduleBtn) staffTabScheduleBtn.textContent = owner.lang === 'zh' ? '计时排班' : 'Schedule'
  const staffTabPerformanceBtn = document.querySelector('#staffTabPerformance')
  if (staffTabPerformanceBtn) staffTabPerformanceBtn.textContent = owner.lang === 'zh' ? '技师业绩' : 'Performance'
  const staffTabTargetsBtn = document.querySelector('#staffTabTargets')
  if (staffTabTargetsBtn) staffTabTargetsBtn.textContent = owner.lang === 'zh' ? '业绩目标' : 'Targets'
  const staffTabSalaryBtn = document.querySelector('#staffTabSalary')
  if (staffTabSalaryBtn) staffTabSalaryBtn.textContent = owner.lang === 'zh' ? '薪资方案' : 'Salary plans'
  const staffTabAccountsBtn = document.querySelector('#staffTabAccounts')
  if (staffTabAccountsBtn) staffTabAccountsBtn.textContent = owner.lang === 'zh' ? '账号管理' : 'Accounts'
  const attendanceTitleEl = document.querySelector('#attendanceTitle')
  if (attendanceTitleEl) attendanceTitleEl.textContent = owner.lang === 'zh' ? '🕐 打卡考勤（今日）' : '🕐 Attendance (today)'
  const finNavPayrollEl = document.querySelector('#finNavPayroll')
  if (finNavPayrollEl) finNavPayrollEl.textContent = owner.lang === 'zh' ? '👥 员工工资' : '👥 Payroll'
  els.sidebarServices.textContent = t('navServices')
  els.sidebarCustomers.textContent = t('navCustomers')
  els.sidebarWechatMockLabel.textContent = t('navWechatMock')
  els.sidebarAiGallery.textContent = t('navAiGallery')
  els.sidebarStoreSettings.textContent = t('navStoreSettings')
  els.storeSettingsEyebrow.textContent = t('storeSettingsEyebrow')
  els.storeSettingsTitle.textContent = t('storeSettingsTitle')
  els.storeSettingsSubtitle.textContent = t('storeSettingsSubtitle')
  els.businessHoursTitle.textContent = t('businessHoursTitle')
  els.saveBusinessHours.textContent = t('saveBusinessHours')
  els.planTitle.textContent = owner.lang === 'zh' ? '当前套餐' : 'Current Plan'
  els.kbTitle.textContent = owner.lang === 'zh' ? 'AI 知识库（店规 / FAQ）' : 'AI Knowledge Base (Rules / FAQ)'
  els.storeInfoTitle.textContent = owner.lang === 'zh' ? '店铺信息（技术支持用）' : 'Store Info (for support)'
  const storeProfileTitle = document.querySelector('#storeProfileTitle')
  if (storeProfileTitle) storeProfileTitle.textContent = owner.lang === 'zh' ? '门店信息（名称 / 地址 / 电话）' : 'Store Profile (name / address / phone)'
  const bookingSearchInput = document.querySelector('#bookingSearch')
  if (bookingSearchInput) bookingSearchInput.placeholder = owner.lang === 'zh' ? '搜顾客名 / 手机号 / 订单号…' : 'Search name / phone / order code…'
  const customerSearchInput = document.querySelector('#customerSearch')
  if (customerSearchInput) customerSearchInput.placeholder = owner.lang === 'zh' ? '搜姓名 / 手机 / 会员码…' : 'Search name / phone / member code…'
  els.sidebarFinance.textContent = owner.lang === 'zh' ? '财务' : 'Finance'
  els.financePageTitle.textContent = owner.lang === 'zh' ? '财务' : 'Finance'
  const setLabelText = (element, text) => {
    if (!element) return
    if (element.firstChild && element.firstChild.nodeType === 3) element.firstChild.nodeValue = `${text} `
    else element.textContent = text
  }
  setLabelText(document.querySelector('#financeQuickTitle'), owner.lang === 'zh' ? '记一笔' : 'Quick Entry')
  setLabelText(document.querySelector('#storedValueTitle'), owner.lang === 'zh' ? '储值卡' : 'Stored Value')
  setLabelText(document.querySelector('#financeRecurringTitle'), owner.lang === 'zh' ? '固定支出' : 'Recurring Expenses')
  setLabelText(document.querySelector('#financeTargetsTitle'), owner.lang === 'zh' ? '目标设置' : 'Targets')
  setLabelText(document.querySelector('#financePayrollTitle'), owner.lang === 'zh' ? '员工工资（月结）' : 'Payroll (Monthly)')
  setLabelText(document.querySelector('#financeLedgerTitle'), owner.lang === 'zh' ? '账本安全' : 'Ledger Security')
  const quickHint = document.querySelector('#financeQuickHint')
  if (quickHint) quickHint.textContent = owner.lang === 'zh' ? '日常收支随手记，三秒入账' : 'Record daily income/expenses in seconds'
  const svHint = document.querySelector('#storedValueHint')
  if (svHint) svHint.textContent = owner.lang === 'zh' ? '卡上的钱是欠顾客的服务；耗卡才是收入' : 'Card balance is a liability; consumption becomes revenue'
  const groupTitle = document.querySelector('#financeSettingsGroupTitle')
  if (groupTitle) groupTitle.textContent = owner.lang === 'zh' ? '财务设置' : 'Finance Settings'
  const groupHint = document.querySelector('#financeSettingsGroupHint')
  if (groupHint) groupHint.textContent = owner.lang === 'zh' ? '固定项与规则，设一次长期生效' : 'Set once, applies continuously'
  const txnTitle = document.querySelector('#financeTxnTitle')
  if (txnTitle) txnTitle.textContent = owner.lang === 'zh' ? '流水' : 'Transactions'
  const exportCsvBtn = document.querySelector('#financeExportCsv')
  if (exportCsvBtn) exportCsvBtn.textContent = owner.lang === 'zh' ? '导出 CSV' : 'Export CSV'
  const guideBtn = document.querySelector('#financeGuideButton')
  if (guideBtn) guideBtn.textContent = owner.lang === 'zh' ? '使用指南' : 'Guide'
  const demoBtn = document.querySelector('#financeDemoButton')
  if (demoBtn) demoBtn.textContent = owner.lang === 'zh' ? '演示数据' : 'Demo data'
  const navLabels = [
    ['#finNavQuick', owner.lang === 'zh' ? '✎ 记一笔' : '✎ Quick entry'],
    ['#finNavStored', owner.lang === 'zh' ? '💳 储值卡' : '💳 Stored value'],
    ['#finNavTxns', owner.lang === 'zh' ? '☰ 流水' : '☰ Transactions'],
    ['#finNavSettings', owner.lang === 'zh' ? '⚙ 财务设置' : '⚙ Settings'],
    ['#finNavInsights', owner.lang === 'zh' ? '✦ AI 解读' : '✦ AI insights']
  ]
  for (const [selector, label] of navLabels) {
    const button = document.querySelector(selector)
    if (button) button.textContent = label
  }
  els.wechatMockEyebrow.textContent = t('wechatMockEyebrow')
  els.wechatMockTitle.textContent = t('wechatMockTitle')
  els.wechatMockSubtitle.textContent = t('wechatMockSubtitle')
  els.wechatSessionTitle.textContent = t('wechatSessionTitle')
  els.wechatMockBadge.textContent = t('mockOnly')
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
    <option value="spent">${owner.lang === 'zh' ? '按累计消费' : 'By total spent'}</option>
  `
  els.customerSort.value = currentCustomerSort
  els.todayTab.textContent = t('today')
  els.allTab.textContent = t('allBookings')
  els.calendarTab.textContent = t('calendar')
  els.filterDateLabel.textContent = t('date')
  els.filterStatusLabel.textContent = t('status')
  els.clearFilters.textContent = t('clear')
  els.scheduleTitle.textContent = t('schedule')
  els.techPerformanceEyebrow.textContent = isOwnerRole() ? t('monthOverview') : t('staffMode')
  els.techPerformanceTitle.textContent = isOwnerRole() ? t('technicianPerformance') : t('myTechnicianPerformance')
  els.scheduleWeekEyebrow.textContent = owner.lang === 'zh' ? '周视图' : 'Week view'
  els.scheduleThisWeek.textContent = owner.lang === 'zh' ? '本周' : 'This week'
  els.scheduleDefaultLabel.textContent = owner.lang === 'zh' ? '上班默认时段' : 'Default shift'
  els.applyWeekPattern.textContent = owner.lang === 'zh' ? '本周模式应用到未来 4 周' : 'Apply this week to next 4 weeks'
  els.scheduleGridHint.textContent = owner.lang === 'zh'
    ? '点格子切换上班/休息;上班格显示当天时段与已约单数;店休日排班会黄色提醒。'
    : 'Click a cell to toggle working/off. Working cells show hours and booked count; shifts on closed days get a yellow warning.'
  els.addTechnicianButton.textContent = owner.lang === 'zh' ? '＋ 添加技师' : '+ Add technician'
  const fullDemoSeedBtn = document.querySelector('#fullDemoSeed')
  if (fullDemoSeedBtn) fullDemoSeedBtn.textContent = owner.lang === 'zh' ? '演示数据' : 'Demo data'
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
  const [wechatStatus, wechatConversations, quoteRequests, reminderTasks, businessHours, tenantPlan, tenantKb, scheduleWeek, scheduleRequests, compEstimate, staffAccounts] = await Promise.allSettled([
    request('/admin/wechat/status'),
    request('/admin/wechat/conversations'),
    request('/admin/quote-requests'),
    request('/admin/reminder-tasks'),
    request('/admin/business-hours'),
    request('/admin/tenant/plan'),
    request('/admin/kb'),
    request(`/admin/schedule-week${owner.scheduleWeekFrom ? `?from=${owner.scheduleWeekFrom}` : ''}`),
    request('/admin/schedule-requests'),
    isOwnerRole() ? Promise.resolve({ estimate: null }) : request('/admin/my-compensation-estimate'),
    isOwnerRole() ? request('/admin/staff-accounts') : Promise.resolve({ accounts: [] })
  ])
  owner.wechatStatus = wechatStatus.status === 'fulfilled' ? wechatStatus.value.wechat : null
  owner.wechatConversations = wechatConversations.status === 'fulfilled' ? wechatConversations.value.conversations : []
  owner.quoteRequests = quoteRequests.status === 'fulfilled' ? quoteRequests.value.quoteRequests : []
  owner.reminderTasks = reminderTasks.status === 'fulfilled' ? reminderTasks.value.reminderTasks : []
  owner.businessHoursStores = businessHours.status === 'fulfilled' ? businessHours.value.stores : []
  owner.tenantPlan = tenantPlan.status === 'fulfilled' ? tenantPlan.value.entitlements : null
  owner.tenantKb = tenantKb.status === 'fulfilled' ? tenantKb.value : null
  if (scheduleWeek.status === 'fulfilled') {
    owner.scheduleWeek = scheduleWeek.value
    owner.scheduleWeekFrom = scheduleWeek.value.weekStart
  }
  owner.scheduleRequests = scheduleRequests.status === 'fulfilled' ? scheduleRequests.value.requests : []
  owner.myCompEstimate = compEstimate.status === 'fulfilled' ? compEstimate.value.estimate : null
  owner.staffAccounts = staffAccounts.status === 'fulfilled' ? staffAccounts.value.accounts : []
  // 首页营收与待办的财务数据(账本口径,需财务钥匙;没有钥匙则显示锁定态)
  if (owner.financeKey) {
    const currentMonth = new Date().toISOString().slice(0, 7)
    const [dashTxns, dashPayroll, dashStored] = await Promise.allSettled([
      request(`/admin/finance/transactions?month=${currentMonth}`),
      request(`/admin/finance/payroll?month=${currentMonth}`),
      request('/admin/stored-value')
    ])
    owner.dashFinance = dashTxns.status === 'fulfilled' ? dashTxns.value : null
    owner.dashPayrollPending = dashPayroll.status === 'fulfilled' ? (dashPayroll.value.drafts || []).filter((item) => !item.settled && item.totalCents > 0).length : 0
    owner.dashDormantCards = dashStored.status === 'fulfilled' ? (dashStored.value.storedValue?.accounts || []).filter((item) => item.dormantDays >= 30).length : 0
  } else {
    owner.dashFinance = null
    owner.dashPayrollPending = 0
    owner.dashDormantCards = 0
  }
  if (!isOwnerRole() && !['bookings', 'schedule', 'wechatMock', 'aiGallery'].includes(owner.adminPage)) owner.adminPage = 'bookings'
  setLocked(false)
  render()
}

// 登录页双入口:老板/员工两个 tab,提示语和找回路径分开写(防呆)
function applyLoginRoleUi() {
  const zh = owner.lang === 'zh'
  const role = owner.loginRole || 'owner'
  const tabOwner = document.querySelector('#loginTabOwner')
  const tabStaff = document.querySelector('#loginTabStaff')
  if (tabOwner) { tabOwner.textContent = zh ? '老板登录' : 'Owner'; tabOwner.classList.toggle('active', role === 'owner') }
  if (tabStaff) { tabStaff.textContent = zh ? '员工登录' : 'Staff'; tabStaff.classList.toggle('active', role === 'staff') }
  els.ownerLoginTitle.textContent = role === 'owner' ? (zh ? '老板登录' : 'Owner Login') : (zh ? '员工登录' : 'Staff Login')
  els.ownerLoginText.textContent = role === 'owner'
    ? (zh ? '用平台交付的老板账号登录(首次登录会要求设置新密码)。忘记密码请联系平台重置。' : 'Use the owner account from the platform. Forgot it? Contact the platform.')
    : (zh ? '用老板发给你的员工账号登录(首次登录会要求设置新密码)。忘记密码找老板一键重置。' : 'Use the staff account from your owner. Forgot it? Ask your owner to reset.')
  els.ownerEmailLabel.textContent = zh ? '账号(用户名或邮箱)' : 'Account (username or email)'
  const rememberLabel = document.querySelector('#loginRememberLabel')
  if (rememberLabel) rememberLabel.textContent = zh ? '保持登录 30 天' : 'Keep me signed in for 30 days'
  els.ownerRegisterButton.classList.toggle('hidden', role !== 'owner')
}

async function ownerLogin(event) {
  event.preventDefault()
  const form = new FormData(event.target)
  const action = event.submitter?.dataset.authAction || 'login'
  const remember = document.querySelector('#loginRemember')?.checked !== false
  const data = await request(action === 'register' ? '/admin/auth/register' : '/admin/auth/login', {
    method: 'POST',
    public: true,
    body: JSON.stringify({
      email: form.get('email'),
      password: form.get('password'),
      remember
    })
  })
  if (data.needsEmailConfirmation) {
    toast(t('checkEmail'))
    return
  }
  owner.auth = data.auth
  owner.auth.admin = data.admin || owner.auth.admin || {}
  owner.role = owner.auth.admin.role || 'owner'
  // 保持登录30天 → localStorage;不保持 → 仅本次浏览器会话
  if (remember) {
    localStorage.setItem('lucky-owner-auth', JSON.stringify(owner.auth))
    sessionStorage.removeItem('lucky-owner-auth')
  } else {
    sessionStorage.setItem('lucky-owner-auth', JSON.stringify(owner.auth))
    localStorage.removeItem('lucky-owner-auth')
  }
  toast(action === 'register' ? t('ownerCreated') : t('loginSuccess'))
  await loadAll()
  if (owner.auth.admin.mustChangePassword) renderForcePasswordChange()
}

// 首次登录/被重置后强制改密:遮罩挡住全站,改完才放行
function renderForcePasswordChange() {
  const zh = owner.lang === 'zh'
  let overlay = document.querySelector('#forcePassOverlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'forcePassOverlay'
    overlay.className = 'fin-lock-overlay force-pass-overlay'
    document.body.appendChild(overlay)
  }
  overlay.innerHTML = `
    <div class="fin-lock-card">
      <strong>${zh ? '首次登录:请设置你自己的密码' : 'First login: set your own password'}</strong>
      <p class="subtle">${zh ? '初始密码是临时的,设置新密码后才能继续使用(至少 6 位)。' : 'The initial password is temporary. Set a new one to continue (min 6 chars).'}</p>
      <input id="forceOldPass" type="password" placeholder="${zh ? '初始密码(刚才登录用的)' : 'Initial password'}" autocomplete="off">
      <input id="forceNewPass" type="password" placeholder="${zh ? '新密码' : 'New password'}" autocomplete="new-password">
      <input id="forceNewPass2" type="password" placeholder="${zh ? '再输入一次新密码' : 'Confirm new password'}" autocomplete="new-password">
      <button class="primary" data-force-pass-submit type="button">${zh ? '设置并进入' : 'Set and continue'}</button>
    </div>`
  overlay.querySelector('[data-force-pass-submit]').addEventListener('click', async () => {
    try {
      await request('/admin/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          oldPassword: document.querySelector('#forceOldPass')?.value || '',
          newPassword: document.querySelector('#forceNewPass')?.value || '',
          confirmPassword: document.querySelector('#forceNewPass2')?.value || ''
        })
      })
      owner.auth.admin.mustChangePassword = false
      const store = localStorage.getItem('lucky-owner-auth') ? localStorage : sessionStorage
      store.setItem('lucky-owner-auth', JSON.stringify(owner.auth))
      overlay.remove()
      toast(zh ? '密码已设置,以后用新密码登录' : 'Password set')
    } catch (error) {
      toast(error.message)
    }
  })
}

function ownerLogout() {
  owner.auth = null
  owner.role = 'owner'
  owner.token = ''
  els.tokenInput.value = ''
  localStorage.removeItem('lucky-owner-auth')
  sessionStorage.removeItem('lucky-owner-auth')
  localStorage.removeItem('lucky-owner-token')
  document.querySelector('#forcePassOverlay')?.remove()
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
    els.scheduleWeekGrid.innerHTML = ''
    els.technicianPerformance.innerHTML = ''
    els.customerList.innerHTML = ''
    els.dashboardCharts.innerHTML = ''
    els.dashboardDetailPanel.innerHTML = ''
    els.aiBriefPanel.innerHTML = ''
    els.aiGalleryList.innerHTML = ''
    els.wechatSessionList.innerHTML = ''
    els.wechatMockDetail.innerHTML = ''
    els.businessHoursEditor.innerHTML = ''
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
  renderScheduleWeek()
  renderTechnicianPerformance()
  renderCustomers()
  renderAiBrief()
  renderWechatMock()
  renderAiGallery()
  renderStoreSettings()
  if (owner.adminPage === 'finance') {
    if (owner.financeLedger.lockEnabled !== false && !owner.financeKey) renderFinanceLock()
    else if (owner.financeLedger.data) renderFinancePage()
  }
}

function renderMetrics() {
  if (!isOwnerRole()) {
    const todayCount = owner.bookings.filter((item) => isToday(item.appointmentDate)).length
    const activeCount = owner.bookings.filter((item) => activeStatuses().includes(item.status)).length
    const reviewCount = galleryGroups().filter((group) => group.booking.galleryStatus !== 'approved').length
    // 待传作品:完成了但一张作品图都没传的单——图库素材断供预警
    const missingWork = owner.bookings.filter((item) => item.status === 'COMPLETED' && !(item.workImages || []).length && item.galleryStatus !== 'approved').length
    els.metricGrid.innerHTML = `
      <button class="metric" data-admin-page="bookings" type="button"><span class="subtle">${t('todayBookings')}</span><strong>${todayCount}</strong></button>
      <button class="metric" data-admin-page="bookings" type="button"><span class="subtle">${t('activeBookings')}</span><strong>${activeCount}</strong></button>
      <button class="metric ${missingWork ? 'metric-warn' : ''}" data-admin-page="aiGallery" type="button"><span class="subtle">${owner.lang === 'zh' ? '待传作品' : 'Missing photos'}</span><strong>${missingWork}</strong></button>
      <button class="metric" data-admin-page="aiGallery" type="button"><span class="subtle">${t('aiStatusReview')}</span><strong>${reviewCount}</strong></button>
      <button class="metric" data-admin-page="schedule" type="button"><span class="subtle">${t('staffMode')}</span><strong>${owner.technicians.length}</strong></button>
    `
    return
  }
  const stats = dashboardStats()
  // 营收统一走财务账本口径;未解锁财务时显示锁定,点击跳财务页解锁
  const ledgerIncome = owner.dashFinance?.summary?.incomeCents
  // 没开财务密码门禁的店直接显示金额;开了才在未解锁时打码
  const financeGated = owner.financeLedger.lockEnabled !== false && !owner.financeKey
  const revenueDisplay = !financeGated && ledgerIncome !== undefined ? money(ledgerIncome) : '🔒'
  els.metricGrid.innerHTML = `
    <button class="metric" data-dashboard-detail="confirmed" type="button"><span class="subtle">${t('confirmed')}</span><strong>${stats.confirmed}</strong></button>
    <button class="metric" data-dashboard-detail="pending" type="button"><span class="subtle">${t('pending')}</span><strong>${stats.pending}</strong></button>
    <button class="metric revenue-metric" data-admin-page="finance" type="button"><span class="subtle">${owner.lang === 'zh' ? '本月收入(账本)' : 'Income (ledger)'}</span><strong>${revenueDisplay}</strong></button>
    <button class="metric" data-dashboard-detail="monthServices" type="button"><span class="subtle">${t('monthServices')}</span><strong>${stats.monthServices}</strong></button>
    <button class="metric" data-dashboard-detail="totalServices" type="button"><span class="subtle">${t('totalServices')}</span><strong>${stats.totalServices}</strong></button>
  `
}

function renderTodayTasksCard() {
  const needsHuman = (owner.wechatConversations || []).filter((item) => item.status === 'needs_human').length
  const pendingQuotes = (owner.quoteRequests || []).filter((item) => ['PENDING_STAFF', 'WAITING_STAFF_QUOTE'].includes(String(item.status || '').toUpperCase())).length
  const todayActive = dashboardStats().todayBookings.filter((item) => activeStatuses().includes(item.status)).length
  const financeLocked = owner.financeLedger.lockEnabled !== false && !owner.financeKey
  const item = (count, label, page, tone = '') => `
    <button class="today-task ${tone ? `tone-${tone}` : ''} ${count > 0 ? 'has-items' : ''}" data-admin-page="${page}" type="button">
      <span class="task-label">${label}</span>
      <strong class="task-count">${count}</strong>
    </button>`
  const lockedItem = `
    <button class="today-task is-locked" data-admin-page="finance" type="button">
      <span class="task-label">${owner.lang === 'zh' ? '财务待办' : 'Finance tasks'}</span>
      <strong class="task-count task-lock">🔒</strong>
    </button>`
  return `
    <div class="today-tasks-card card" style="grid-column: 1 / -1;">
      <div class="section-row compact-row">
        <h2 class="today-tasks-title">${owner.lang === 'zh' ? '今日待办' : 'Today’s Tasks'}</h2>
        <span class="subtle">${owner.lang === 'zh' ? '每项点击直达处理页面' : 'Click any item to act'}</span>
      </div>
      <div class="today-tasks-grid">
        ${item(needsHuman, owner.lang === 'zh' ? '待人工会话' : 'Needs human', 'wechatMock', 'danger')}
        ${item(pendingQuotes, owner.lang === 'zh' ? '待技师报价' : 'Pending quotes', 'wechatMock')}
        ${item(todayActive, owner.lang === 'zh' ? '今日预约' : 'Today bookings', 'bookings')}
        ${item((owner.scheduleRequests || []).filter((req) => req.status === 'pending').length, owner.lang === 'zh' ? '排班申请' : 'Schedule requests', 'schedule', 'warn')}
        ${financeLocked ? lockedItem : `
          ${item(owner.dashPayrollPending || 0, owner.lang === 'zh' ? '待结工资' : 'Payroll pending', 'finance')}
          ${item(owner.dashDormantCards || 0, owner.lang === 'zh' ? '沉睡储值卡' : 'Dormant cards', 'finance', 'warn')}`}
      </div>
    </div>`
}

function isCurrentMonth(dateString) {
  if (!dateString) return false
  return String(dateString).slice(0, 7) === storeToday().slice(0, 7)
}

function isToday(dateString) {
  return dateString === storeToday()
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
  // 诚实口径:按本月完成单数排序;好评率等点评功能上线后才显示,不做估算值
  const rows = technicianPerformanceRows().sort((a, b) => b.completed - a.completed || b.amount - a.amount)
  return rows[0] || { name: '-', completed: 0 }
}

function retentionStats() {
  const customers = owner.customers || []
  const repeat = customers.filter((customer) => Number(customer.visitCount || 0) > 1)
  const due = customers
    .filter((customer) => {
      // 从没来过店的(测试残留/纯注册用户)不算"待回访",避免一排 0 的噪音
      if (!Number(customer.visitCount || 0)) return false
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
  // 员工端没有首页,"← Dashboard"返回按钮一并隐藏
  document.querySelectorAll('.back-btn').forEach((btn) => btn.classList.toggle('hidden', !isOwnerRole()))
  els.sidebarServices.classList.toggle('hidden', !isOwnerRole())
  els.sidebarCustomers.classList.toggle('hidden', !isOwnerRole())
  els.sidebarStoreSettings.classList.toggle('hidden', !isOwnerRole())
  els.sidebarFinance.classList.toggle('hidden', !isOwnerRole())
  els.sidebarPricing?.classList.toggle('hidden', !isOwnerRole())
  // 2026-08-04 店主定「全部 AI 归智能包」:没开通就把纯 AI 的入口收起来,别让人点了没反应。
  // AI 图库整页只做 AI 文案,没 AI 就没意义;客服工作台保留(它是人工会话收件箱,没 AI 也要用)。
  const hasAiAddon = hasAi()
  els.sidebarAiGallery?.classList.toggle('hidden', !hasAiAddon)
  document.querySelector('#finNavInsights')?.classList.toggle('hidden', !hasAiAddon)
  if (!hasAiAddon && owner.adminPage === 'aiGallery') owner.adminPage = isOwnerRole() ? 'dashboard' : 'bookings'
  if (!isOwnerRole() && ['dashboard', 'dashboardDetail', 'services', 'pricing', 'membership', 'customers', 'storeSettings', 'finance'].includes(owner.adminPage)) owner.adminPage = 'bookings'
  const pages = {
    dashboard: els.adminDashboard,
    dashboardDetail: els.dashboardDetailPage,
    bookings: els.bookingsPage,
    schedule: els.schedulePage,
    services: els.servicesPage,
    pricing: els.pricingPage,
    membership: els.membershipPage,
    customers: els.customersPage,
    wechatMock: els.wechatMockPage,
    aiGallery: els.aiGalleryPage,
    finance: els.financePage,
    storeSettings: els.storeSettingsPage
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
  const ledgerTxns = owner.dashFinance?.transactions || []
  const dailyLedger = Object.entries(ledgerTxns.filter((txn) => txn.amountCents > 0).reduce((groups, txn) => {
    groups[txn.occurredOn] = (groups[txn.occurredOn] || 0) + txn.amountCents
    return groups
  }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount }))
  const maxLedgerDaily = Math.max(...dailyLedger.map((row) => row.amount), 1)
  const ledgerIncomeCents = owner.dashFinance?.summary?.incomeCents
  els.dashboardCharts.innerHTML = `
    ${renderTodayTasksCard()}
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
    <button class="dashboard-chart-card card" data-admin-page="finance" type="button">
      <div class="section-row compact-row">
        <div>
          <p class="eyebrow">${owner.lang === 'zh' ? '本月经营' : 'This Month'}</p>
          <h2>${owner.financeKey && ledgerIncomeCents !== undefined ? money(ledgerIncomeCents) : `${stats.monthServices}${owner.lang === 'zh' ? ' 单' : ''}`}</h2>
        </div>
        <span class="dashboard-card-cue">${owner.financeKey ? (owner.lang === 'zh' ? '查看财务' : 'Finance') : (owner.lang === 'zh' ? '🔒 收入解锁' : '🔒 Unlock')}</span>
      </div>
      <div class="chart-stat-row"><span>${t('popularStyle')}</span><strong>${escapeHtml(popular.name)} · ${popular.count}</strong></div>
      <div class="chart-stat-row"><span>${t('topRatedTechnician')}</span><strong>${escapeHtml(topTech.name)} · ${topTech.completed}${owner.lang === 'zh' ? ' 单' : ''}</strong></div>
      ${owner.financeKey
        ? (dailyLedger.slice(-3).map((row) => chartBar(row.date.slice(5), money(row.amount), maxLedgerDaily, Math.max(8, Math.round((row.amount / maxLedgerDaily) * 100)))).join('') || `<div class="chart-stat-row"><span>${owner.lang === 'zh' ? '本月账本收入' : 'Ledger income'}</span><strong>${ledgerIncomeCents !== undefined ? money(ledgerIncomeCents) : '-'}</strong></div>`)
        : `<div class="chart-stat-row locked-stat-row"><span>${owner.lang === 'zh' ? '收入金额与日趋势' : 'Income & trend'}</span><strong>${owner.lang === 'zh' ? '🔒 点击解锁' : '🔒 Unlock'}</strong></div>`}
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
      ${owner.financeKey ? chartBar(t('revenue'), money(stats.monthRevenue), Math.max(stats.monthBookings.length, 1), 100) : ''}
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

function wechatMockSessions() {
  const zhGreeting = '您好欢迎来到 Lucky Luxe，我是您的预约助手，您有任何问题可以随时向我咨询，可以帮您了解美甲/美睫服务、价格规则、预约时间、定金和护理说明。如果是复杂美甲款式，也可以先发参考图，我会帮您整理需求并转给技师确认报价。'
  const enGreeting = 'Hi, welcome to Lucky Luxe. I am your booking assistant. I can help with nail and lash services, price rules, booking time, deposit policy, and after-care. For custom nail designs, you can send a reference image and I will organize the request for a technician quote.'
  return [
    {
      id: 'wechat-quote-01',
      customer: owner.lang === 'zh' ? 'Mia · 微信新客' : 'Mia · WeChat New Guest',
      source: owner.lang === 'zh' ? '小红书' : 'RED',
      intent: owner.lang === 'zh' ? '复杂美甲参考图报价' : 'Custom nail reference quote',
      serviceType: 'nail',
      status: 'waiting_quote',
      draftStatus: '',
      route: owner.lang === 'zh' ? '美甲师 Lina Zhou' : 'Nail artist Lina Zhou',
      expected: t('expectedReplyTime'),
      elements: owner.lang === 'zh'
        ? ['需要延长：是', '卸甲：不确定，需追问', '断甲修补：否', '饰品：珍珠与小钻', '复杂度：中高']
        : ['Extension: yes', 'Removal: unclear, ask follow-up', 'Repair: no', 'Decor: pearls and small rhinestones', 'Complexity: medium-high'],
      messages: [
        ['assistant', zhGreeting, enGreeting],
        ['assistant', '请问您是从哪个渠道关注到我们的？可以选择：小红书、抖音、大众点评/美团、朋友推荐、其他。', 'May I ask where you found us? Options: Google, Instagram, WeChat, TikTok, Friend referral, or Other.'],
        ['customer', '小红书。我想做这个法式加珍珠，可以帮我看价格吗？我也想预约周五下午。', 'I found you on RED. I want this French style with pearls. Could you check the price? I also want Friday afternoon.'],
        ['assistant', '可以的。我会先帮您整理参考图要素并转给技师确认报价。正常 10 分钟内给您回复，确认后我可以帮您创建预约草稿。', 'Of course. I will organize the reference details and send them to a technician for a quote. Usually we reply within 10 minutes, then I can create a booking draft for you.']
      ],
      defaultReply: {
        canDo: 'yes',
        price: '228',
        duration: '150',
        notes: owner.lang === 'zh' ? '可做，建议预留 2.5 小时。珍珠数量如果很多需现场微调，卸甲另算。' : 'Can do. Reserve about 2.5 hours. Heavy pearls may be adjusted on site. Removal is extra.'
      }
    },
    {
      id: 'wechat-lash-02',
      customer: owner.lang === 'zh' ? 'Olivia · 英文咨询' : 'Olivia · English inquiry',
      source: owner.lang === 'zh' ? 'Instagram' : 'Instagram',
      intent: owner.lang === 'zh' ? '美睫固定价预约' : 'Fixed-price lash booking',
      serviceType: 'lash',
      status: 'draft_created',
      draftStatus: 'created',
      route: owner.lang === 'zh' ? 'AI 自动处理' : 'AI handled',
      expected: owner.lang === 'zh' ? '无需人工报价' : 'No manual quote needed',
      elements: owner.lang === 'zh'
        ? ['自然款美睫', '固定价格 CAD $198', '时长 120 分钟', '定金 CAD $50']
        : ['Natural lash set', 'Fixed price CAD $198', 'Duration 120 min', 'Deposit CAD $50'],
      messages: [
        ['assistant', zhGreeting, enGreeting],
        ['customer', 'Hi, how much is a natural lash set?', 'Hi, how much is a natural lash set?'],
        ['assistant', '自然款美睫是固定价格 CAD $198，时长约 120 分钟，预约定金 CAD $50。价格已包含基础嫁接服务，不需要人工报价。', 'A natural lash set is CAD $198, about 120 minutes, with a CAD $50 booking deposit. This is a fixed lash price and does not need a manual quote.'],
        ['assistant', '我已为您生成预约草稿，请在小程序中确认时间并支付定金。', 'I created a booking draft for you. Please confirm the time and pay the deposit in the Mini Program.']
      ],
      defaultReply: {
        canDo: 'yes',
        price: '198',
        duration: '120',
        notes: owner.lang === 'zh' ? '固定价美睫项目，价格无需人工确认。' : 'Fixed-price lash service. No manual quote required.'
      }
    },
    {
      id: 'wechat-reschedule-03',
      customer: owner.lang === 'zh' ? 'Nina · 已预约客户' : 'Nina · Existing guest',
      source: owner.lang === 'zh' ? '朋友推荐' : 'Friend referral',
      intent: owner.lang === 'zh' ? '改期请求' : 'Reschedule request',
      serviceType: 'nail',
      status: 'handoff',
      draftStatus: '',
      route: owner.lang === 'zh' ? '转给对应技师' : 'Route to assigned technician',
      expected: owner.lang === 'zh' ? 'AI 停止自动回复，等待人工接管' : 'AI paused until human returns control',
      elements: owner.lang === 'zh'
        ? ['取消/改期属于人工接管范围', '需确认 24 小时规则', '需查看原预约技师排班']
        : ['Cancellation/reschedule requires human takeover', 'Check 24-hour policy', 'Confirm original technician schedule'],
      messages: [
        ['assistant', zhGreeting, enGreeting],
        ['customer', '我明天的预约想改到周末，可以吗？', 'Can I move my appointment tomorrow to the weekend?'],
        ['assistant', '改期需要帮您转给对应技师确认排班与定金规则。我会先暂停自动回复，技师接管后会继续处理。', 'Rescheduling needs the assigned technician to confirm schedule and deposit policy. I will pause automatic replies and route this to staff.']
      ],
      defaultReply: {
        canDo: 'no',
        price: '',
        duration: '',
        notes: owner.lang === 'zh' ? '改期请求，需人工接管。' : 'Reschedule request, human takeover required.'
      }
    }
  ]
}

function wechatMockState(session) {
  const override = owner.wechatMockOverrides[session.id] || {}
  return {
    quoteStatus: session.status,
    draftStatus: session.draftStatus,
    artistReply: session.defaultReply,
    ...override
  }
}

function selectedWechatSession() {
  if (String(owner.wechatMockSessionId || '').startsWith('live:')) {
    const id = owner.wechatMockSessionId.slice(5)
    const found = owner.wechatConversations.find((conversation) => conversation.id === id)
    if (found) return found
  }
  return filteredWechatConversations()[0] || (owner.wechatConversations || [])[0] || null
}

function currentCustomerChatConversation() {
  return owner.wechatConversations.find((conversation) => conversation.id === `wecom:${owner.wechatChatCustomerId}`) || null
}

function wechatStageOptions(selected = owner.wechatChatStage) {
  const options = [
    ['new_quote', owner.lang === 'zh' ? '新客询价 / 未预约' : 'New quote / no booking'],
    ['quote_waiting', owner.lang === 'zh' ? '已发参考图 / 等技师报价' : 'Image sent / waiting quote'],
    ['draft_unpaid', owner.lang === 'zh' ? '已有预约草稿 / 未付定金' : 'Draft created / unpaid'],
    ['confirmed_visit', owner.lang === 'zh' ? '已预约 / 即将到店' : 'Confirmed / visiting soon'],
    ['in_store', owner.lang === 'zh' ? '已到店 / 正在服务' : 'In store / service in progress'],
    ['completed_aftercare', owner.lang === 'zh' ? '已完成 / 售后护理' : 'Completed / after-care'],
    ['refund_dispute', owner.lang === 'zh' ? '取消改期 / 退款争议' : 'Cancel/reschedule dispute']
  ]
  return options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')
}

function previousCustomerInTranscript(transcript = [], index = 0) {
  for (let i = Number(index) - 1; i >= 0; i -= 1) {
    if (transcript[i]?.role === 'customer') return transcript[i]?.content || ''
  }
  return ''
}

function renderAiFeedbackEditor(message, index, transcript = [], conversation = {}) {
  if ((message.role || 'assistant') !== 'assistant') return ''
  const corrected = Boolean(message.correctedByOwner)
  const customerMessage = previousCustomerInTranscript(transcript, index)
  const original = message.originalContent || message.content || ''
  return `
    <details class="ai-feedback-editor" ${corrected ? 'open' : ''}>
      <summary>${corrected ? (owner.lang === 'zh' ? '已保存为满意样本' : 'Saved as approved sample') : (owner.lang === 'zh' ? '这条不满意，改成满意版本' : 'Improve this AI reply')}</summary>
      <div class="ai-feedback-body">
        <label>
          <span>${owner.lang === 'zh' ? '顾客原话' : 'Customer message'}</span>
          <textarea rows="2" readonly>${escapeHtml(customerMessage)}</textarea>
        </label>
        <label>
          <span>${owner.lang === 'zh' ? '你希望 AI 这样回复' : 'Owner-approved reply'}</span>
          <textarea rows="5" data-ai-feedback-reply="${index}">${escapeHtml(message.content || '')}</textarea>
        </label>
        <label>
          <span>${owner.lang === 'zh' ? '备注：为什么这样改（可选）' : 'Notes: why this is better (optional)'}</span>
          <textarea rows="2" data-ai-feedback-notes="${index}" placeholder="${owner.lang === 'zh' ? '例如：语气更像真人；复杂款必须先转技师报价；不要承诺最终价格。' : 'Example: warmer tone; custom nails need technician quote; do not promise final price.'}">${escapeHtml(message.feedbackNotes || '')}</textarea>
        </label>
        <div class="action-row wrap">
          <button class="primary slim" data-ai-feedback-save="${index}" data-conversation-id="${escapeHtml(conversation.id || '')}" data-customer-message="${escapeHtml(customerMessage)}" data-original-reply="${escapeHtml(original)}" type="button">${owner.lang === 'zh' ? '保存并让 AI 学习' : 'Save as training sample'}</button>
        </div>
      </div>
    </details>
  `
}

function uploadedImageUrl(image = {}) {
  if (typeof image === 'string') return image
  return image.url || image.dataUrl || image.src || ''
}

function renderMessageImages(message = {}) {
  const images = [
    ...(Array.isArray(message.referenceImages) ? message.referenceImages : []),
    ...(Array.isArray(message.images) ? message.images : [])
  ].filter(Boolean)
  if (!images.length) return ''
  return `
    <div class="wechat-message-images">
      ${images.map((image, index) => {
        const src = uploadedImageUrl(image)
        if (!src) return ''
        return `
          <figure>
            <img src="${escapeHtml(src)}" alt="${escapeHtml(image.name || `reference ${index + 1}`)}">
            <figcaption>${escapeHtml(image.name || `参考图 ${index + 1}`)}</figcaption>
          </figure>
        `
      }).join('')}
    </div>
  `
}

function linkifyEscapedText(text = '') {
  const escaped = escapeHtml(text)
  return escaped.replace(/(https?:\/\/[^\s<，。；、！？")）】]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')
}

function renderWechatTranscript(transcript = [], conversation = {}) {
  if (!transcript.length) {
    return `<div class="empty-state small-empty">${owner.lang === 'zh' ? '还没有对话。请先在左侧以顾客身份发送一条消息。' : 'No chat yet. Send a message as the customer on the left.'}</div>`
  }
  return transcript.map((message, index) => {
    const role = message.role || 'assistant'
    const label = role === 'customer'
      ? (conversation.externalUserId || owner.wechatChatCustomerId || 'Customer')
      : role === 'staff'
        ? (message.staffName || (owner.lang === 'zh' ? '后台人工' : 'Admin Staff'))
        : 'Lucky Luxe 预约助手'
    return `
      <div class="wechat-bubble ${role === 'customer' ? 'customer' : role === 'staff' ? 'staff' : 'assistant'}">
        <span>${escapeHtml(label)}${message.correctedByOwner ? ` · ${owner.lang === 'zh' ? '店主已修正' : 'Owner corrected'}` : ''}</span>
        <p>${linkifyEscapedText(message.content || '')}</p>
        ${renderMessageImages(message)}
        ${renderAiFeedbackEditor(message, index, transcript, conversation)}
      </div>
    `
  }).join('')
}

function renderWechatCustomerChatPanel() {
  const conversation = currentCustomerChatConversation()
  const status = conversation?.status || 'new'
  return `
    ${renderWechatConnectionStatus()}
    <div class="wechat-customer-simulator">
      <div class="section-row compact-row">
        <div>
          <strong>${t('customerChatSimulator')}</strong>
          <p>${t('customerChatHint')}</p>
        </div>
        <span class="mock-state-pill">${escapeHtml(status)}</span>
      </div>
      <label>
        <span>${t('customerId')}</span>
        <input id="wechatChatCustomerId" value="${escapeHtml(owner.wechatChatCustomerId)}">
      </label>
      <div class="form-grid tight">
        <label>
          <span>${owner.lang === 'zh' ? '顾客阶段' : 'Customer stage'}</span>
          <select id="wechatMockCustomerStage">${wechatStageOptions()}</select>
        </label>
        <label>
          <span>${t('mockSource')}</span>
          <input id="wechatMockInboundSource" value="${escapeHtml(owner.wechatChatSource)}">
        </label>
      </div>
      <label>
        <span>${owner.lang === 'zh' ? '参考图上传（测试）' : 'Reference images (test)'}</span>
        <input id="wechatMockReferenceImages" type="file" accept="image/*" multiple>
      </label>
      ${owner.wechatMockReferenceImages.length ? `
        <div class="mock-image-preview-grid">
          ${owner.wechatMockReferenceImages.map((image, index) => `
            <figure>
              <img src="${escapeHtml(image.url)}" alt="reference ${index + 1}">
              <figcaption>${escapeHtml(image.name || `Image ${index + 1}`)}</figcaption>
            </figure>
          `).join('')}
          <button class="ghost slim" data-clear-mock-images type="button">${owner.lang === 'zh' ? '清空图片' : 'Clear images'}</button>
        </div>
      ` : ''}
      <div class="wechat-phone-preview">
        <div class="wechat-phone-head">
          <strong>Lucky Luxe</strong>
          <span>${status === 'needs_human' || status === 'human_active' ? t('waitingHuman') : t('aiAutoReplied')}</span>
        </div>
        <div class="wechat-phone-timeline">
          ${renderWechatTranscript(conversation?.transcript || [], conversation || {})}
        </div>
      </div>
      <label>
        <span>${t('mockCustomerMessage')}</span>
        <textarea id="wechatChatMessage" rows="3" placeholder="${owner.lang === 'zh' ? '例如：我想做带珍珠的法式，可以帮我看价格吗？' : 'Example: Can you help quote a French set with pearls?'}"></textarea>
      </label>
      <div class="action-row wrap">
        <a class="ghost slim" href="/wechat-simulator" target="_blank" rel="noreferrer">${owner.lang === 'zh' ? '打开独立模拟器' : 'Open simulator'}</a>
        <button class="primary slim" data-wechat-chat-send type="button">${t('sendAsCustomer')}</button>
        <button class="ghost slim" data-wechat-chat-force-ai type="button">${t('forceAiReply')}</button>
        <button class="ghost slim" data-wechat-chat-new-customer type="button">${t('newMockCustomer')}</button>
      </div>
    </div>
  `
}

function wechatStatusLabel(session, state = wechatMockState(session)) {
  if (session.status === 'handoff') return t('handoffRoute')
  if (state.draftStatus === 'paid') return t('paidConfirmed')
  if (state.draftStatus === 'released') return t('draftReleased')
  if (state.draftStatus === 'reminded') return t('reminderSent')
  if (state.draftStatus === 'created') return t('draftCreated')
  if (state.quoteStatus === 'quoted') return t('quoteReturned')
  return t('waitingArtistQuote')
}

const WEEKDAY_UI_ORDER = [1, 2, 3, 4, 5, 6, 0]

function weekdayLabel(weekday) {
  const zh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const en = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return owner.lang === 'zh' ? zh[weekday] : en[weekday]
}

const FEATURE_LABELS = {
  booking: ['预约系统', 'Booking'],
  crm: ['客户档案', 'CRM'],
  gallery: ['作品图库', 'Gallery'],
  staff_schedule: ['员工排班', 'Staff schedule'],
  multi_store: ['多门店', 'Multi-store'],
  reports: ['汇总报表', 'Reports'],
  ai_customer_service: ['AI 客服', 'AI customer service'],
  white_label: ['白标定制', 'White label']
}

function featureLabel(key) {
  const pair = FEATURE_LABELS[key] || [key, key]
  return owner.lang === 'zh' ? pair[0] : pair[1]
}

function renderTenantPlan() {
  if (!els.planSummary || !els.planDetailBody) return
  const plan = owner.tenantPlan
  if (!plan) {
    els.planSummary.textContent = '-'
    els.planDetailBody.innerHTML = ''
    return
  }
  const planName = owner.lang === 'zh' ? plan.planNameZh : plan.planNameEn
  const expiryText = plan.planExpired
    ? (owner.lang === 'zh' ? `已到期（${String(plan.planExpiresAt).slice(0, 10)}）` : `Expired (${String(plan.planExpiresAt).slice(0, 10)})`)
    : plan.planExpiresAt
      ? (owner.lang === 'zh' ? `${String(plan.planExpiresAt).slice(0, 10)} 到期` : `Renews ${String(plan.planExpiresAt).slice(0, 10)}`)
      : (owner.lang === 'zh' ? '长期有效' : 'No expiry')
  els.planSummary.textContent = `${planName} · ${expiryText}`
  els.planSummary.classList.toggle('plan-expired', Boolean(plan.planExpired))
  const limits = plan.limits || {}
  // 2026-08-04 店主指出重复:原来这里只有一个写死四档(solo/studio/chain/custom,其中 solo 早已废弃)的下拉,
  // 左栏又另建了「套餐与续费」页。现合并——「当前套餐」展开即完整订阅管理,档位一律由后端下发。
  els.planDetailBody.innerHTML = `
    ${plan.planExpired ? `<p class="plan-expired-banner">${owner.lang === 'zh' ? '套餐已到期，AI 客服等功能已暂停。请续费恢复。' : 'Plan expired. AI features are paused until renewal.'}</p>` : ''}
    <div class="plan-feature-grid">
      ${Object.entries(plan.features || {}).map(([key, value]) => `
        <span class="plan-feature ${value.enabled ? 'on' : 'off'}">
          ${escapeHtml(featureLabel(key))}${value.expiresAt && value.source === 'trial' ? ` · ${owner.lang === 'zh' ? '试用至' : 'until'} ${escapeHtml(String(value.expiresAt).slice(0, 10))}` : ''}
        </span>`).join('')}
    </div>
    <p class="subtle">${owner.lang === 'zh'
      ? `门店上限 ${limits.maxStores ?? '-'} · 员工上限 ${limits.maxStaff ?? '-'} · AI 消息 ${limits.aiMessagesPerMonth ?? '-'} 条/月`
      : `Stores up to ${limits.maxStores ?? '-'} · Staff up to ${limits.maxStaff ?? '-'} · AI messages ${limits.aiMessagesPerMonth ?? '-'}/month`}</p>
    <div class="sub-wrap">${subscriptionMarkup()}</div>
  `
  playSubscriptionAnimation()
}

function renderTenantKb() {
  if (!els.kbSummary || !els.kbDetailBody) return
  const kb = owner.tenantKb
  if (!kb) {
    els.kbSummary.textContent = '-'
    els.kbDetailBody.innerHTML = ''
    return
  }
  const facts = kb.facts || {}
  const entries = kb.entries || []
  const enabledCount = entries.filter((item) => item.enabled).length
  els.kbSummary.textContent = owner.lang === 'zh'
    ? `${enabledCount} 条 FAQ · 定金 ${facts.currency || 'CAD'} $${facts.depositAmount || '-'}`
    : `${enabledCount} FAQ entries · Deposit ${facts.currency || 'CAD'} $${facts.depositAmount || '-'}`
  els.kbDetailBody.innerHTML = `
    <div class="kb-facts-grid">
      <label><span>${owner.lang === 'zh' ? '品牌名' : 'Brand'}</span><input id="kbFactBrand" value="${escapeHtml(facts.brandName || '')}"></label>
      <label><span>${owner.lang === 'zh' ? 'AI 助理名称' : 'Assistant name'}</span><input id="kbFactAssistant" value="${escapeHtml(facts.assistantName || '')}"></label>
      <label><span>${owner.lang === 'zh' ? '门店地址' : 'Store address'}</span><input id="kbFactAddress" value="${escapeHtml(facts.storeAddress || '')}"></label>
      <label><span>${owner.lang === 'zh' ? '定金金额' : 'Deposit amount'}</span><input id="kbFactDeposit" type="number" min="0" value="${escapeHtml(facts.depositAmount || '')}"></label>
    </div>
    <button class="primary slim" data-kb-save-facts type="button">${owner.lang === 'zh' ? '保存店铺事实' : 'Save facts'}</button>
    <p class="subtle">${owner.lang === 'zh' ? '以上信息 AI 回答时实时读取，保存即生效。' : 'AI reads these facts live; changes apply immediately.'}</p>
    <div class="kb-entry-list">
      <strong class="kb-entry-list-title">${owner.lang === 'zh' ? '自助 FAQ（命中关键词时 AI 用你的原文直接回答）' : 'Self-service FAQ (AI answers with your exact text on keyword match)'}</strong>
      ${entries.length ? entries.map((entry) => `
        <div class="kb-entry ${entry.enabled ? '' : 'disabled'}">
          <div class="kb-entry-main">
            <strong>${escapeHtml(entry.question)}</strong>
            <small>${owner.lang === 'zh' ? '关键词' : 'Keywords'}: ${escapeHtml(entry.keywords || '-')}</small>
            <p>${escapeHtml(entry.answerZh)}</p>
          </div>
          <div class="kb-entry-actions">
            <button class="ghost slim" data-kb-toggle-entry="${escapeHtml(entry.id)}" data-kb-next="${entry.enabled ? '0' : '1'}" type="button">${entry.enabled ? (owner.lang === 'zh' ? '停用' : 'Disable') : (owner.lang === 'zh' ? '启用' : 'Enable')}</button>
            <button class="ghost slim" data-kb-delete-entry="${escapeHtml(entry.id)}" type="button">${owner.lang === 'zh' ? '删除' : 'Delete'}</button>
          </div>
        </div>`).join('') : `<p class="subtle">${owner.lang === 'zh' ? '还没有 FAQ。顾客问到知识库外的问题时会静默转人工；把高频问题加进来，AI 就能直接回答。' : 'No FAQ yet. Out-of-scope questions hand off silently; add frequent ones so AI can answer directly.'}</p>`}
    </div>
    <div class="kb-add-form">
      <strong>${owner.lang === 'zh' ? '新增 FAQ' : 'Add FAQ'}</strong>
      <input id="kbNewQuestion" placeholder="${owner.lang === 'zh' ? '问题，例如：停车方便吗' : 'Question, e.g. parking?'}">
      <input id="kbNewKeywords" placeholder="${owner.lang === 'zh' ? '触发关键词（逗号分隔），例如：停车,车位,parking' : 'Keywords, comma separated'}">
      <textarea id="kbNewAnswerZh" rows="2" placeholder="${owner.lang === 'zh' ? '中文回答（AI 将原文使用）' : 'Chinese answer (used verbatim)'}"></textarea>
      <textarea id="kbNewAnswerEn" rows="2" placeholder="${owner.lang === 'zh' ? '英文回答（可选）' : 'English answer (optional)'}"></textarea>
      <div class="action-row wrap">
        <button class="primary slim" data-kb-add-entry type="button">${owner.lang === 'zh' ? '添加 FAQ' : 'Add FAQ'}</button>
        <label class="ghost slim kb-upload-button">
          <input id="kbImportFile" type="file" accept=".txt,.csv,.md" hidden>
          ${owner.lang === 'zh' ? '上传文件导入（价目表 / 服务准则）' : 'Import file (price list / policies)'}
        </label>
      </div>
      <p class="subtle">${owner.lang === 'zh'
        ? '支持 .txt / .csv / .md：CSV（问题,关键词,回答）和问答体（问：/答：）自动拆成 FAQ；自由文本会先尝试 AI 拆条，否则整篇存为知识文档供 AI 回答时参考。PDF/Word 解析在真实通道版接入。'
        : 'Supports .txt / .csv / .md. CSV and Q&A formats become FAQ entries automatically; free text is AI-split or stored as a reference document. PDF/Word parsing arrives with the channel release.'}</p>
      ${(kb.documents || []).length ? `
        <div class="kb-doc-list">
          <strong>${owner.lang === 'zh' ? '知识文档' : 'Knowledge documents'}</strong>
          ${(kb.documents || []).map((doc) => `
            <div class="kb-doc-row">
              <span>${escapeHtml(doc.title)} · ${Math.round((doc.size || 0) / 100) / 10}KB · ${escapeHtml(String(doc.createdAt || '').slice(0, 10))}</span>
              <button class="ghost slim" data-kb-delete-doc="${escapeHtml(doc.id)}" type="button">${owner.lang === 'zh' ? '删除' : 'Delete'}</button>
            </div>`).join('')}
        </div>` : ''}
    </div>
  `
}

async function refreshTenantKb() {
  const data = await request('/admin/kb')
  owner.tenantKb = data
  renderTenantKb()
}

async function saveKbFacts() {
  await request('/admin/kb/facts', {
    method: 'PUT',
    body: JSON.stringify({
      facts: {
        brandName: document.querySelector('#kbFactBrand')?.value.trim(),
        assistantName: document.querySelector('#kbFactAssistant')?.value.trim(),
        storeAddress: document.querySelector('#kbFactAddress')?.value.trim(),
        depositAmount: document.querySelector('#kbFactDeposit')?.value.trim()
      }
    })
  })
  await refreshTenantKb()
  toast(owner.lang === 'zh' ? '店铺事实已保存，AI 回答立即生效。' : 'Facts saved. AI answers updated immediately.')
}

async function addKbEntry() {
  const question = document.querySelector('#kbNewQuestion')?.value.trim()
  const answerZh = document.querySelector('#kbNewAnswerZh')?.value.trim()
  if (!question || !answerZh) {
    toast(owner.lang === 'zh' ? '问题和中文回答必填' : 'Question and Chinese answer are required')
    return
  }
  await request('/admin/kb/entries', {
    method: 'POST',
    body: JSON.stringify({
      question,
      keywords: document.querySelector('#kbNewKeywords')?.value.trim() || question,
      answerZh,
      answerEn: document.querySelector('#kbNewAnswerEn')?.value.trim() || ''
    })
  })
  await refreshTenantKb()
  toast(owner.lang === 'zh' ? 'FAQ 已添加，AI 即刻可用。' : 'FAQ added and live.')
}

// ===== 财务页(阶段3B)=====
const FINANCE_INCOME_CATEGORIES = ['产品销售', '礼品卡', '其他收入']
const FINANCE_EXPENSE_CATEGORIES_BASE = ['房租', '水电网', '耗材采购', '设备', '营销推广', '平台软件费', '其他支出']
const FINANCE_STAFF_CATEGORIES = ['员工工资', '提成']
const FINANCE_PAY_CHANNELS = [['wechat', '微信'], ['alipay', '支付宝'], ['cash', '现金'], ['card', '刷卡'], ['stored_value', '储值卡'], ['unknown', '其他']]

function financeExpenseCategories() {
  const hasStaff = Boolean(owner.tenantPlan?.features?.staff_schedule?.enabled)
  return hasStaff ? [...FINANCE_EXPENSE_CATEGORIES_BASE.slice(0, 4), ...FINANCE_STAFF_CATEGORIES, ...FINANCE_EXPENSE_CATEGORIES_BASE.slice(4)] : FINANCE_EXPENSE_CATEGORIES_BASE
}

function cadText(cents) {
  const value = (cents || 0) / 100
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function renderFinanceLock() {
  els.financePage.classList.add('fin-locked')
  let overlay = document.querySelector('#financeLockOverlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'financeLockOverlay'
    overlay.className = 'fin-lock-overlay'
    els.financePage.appendChild(overlay)
  }
  // 锁状态必须以服务器为准:未确认前先显示加载,绝不猜"首次设置"(否则会误导用户重复设密码)
  if (owner.financeLedger.lockConfigured === undefined) {
    overlay.innerHTML = `<div class="fin-lock-card"><strong>${owner.lang === 'zh' ? '正在确认财务锁状态…' : 'Checking lock status…'}</strong></div>`
    request('/admin/finance/lock-status')
      .then((data) => {
        owner.financeLedger.lockConfigured = Boolean(data.configured)
        if (owner.adminPage === 'finance' && !owner.financeKey) renderFinanceLock()
      })
      .catch(() => {
        overlay.innerHTML = `<div class="fin-lock-card"><strong>${owner.lang === 'zh' ? '无法连接服务器确认锁状态' : 'Cannot reach server'}</strong><button class="primary" data-fin-lock-retry type="button">${owner.lang === 'zh' ? '重试' : 'Retry'}</button></div>`
      })
    return
  }
  const setup = !owner.financeLedger.lockConfigured
  overlay.innerHTML = `
    <div class="fin-lock-card">
      <strong>${setup
        ? (owner.lang === 'zh' ? '首次使用：设置财务密码' : 'First time: set a finance password')
        : (owner.lang === 'zh' ? '财务数据已加锁' : 'Finance data is locked')}</strong>
      <p class="subtle">${setup
        ? (owner.lang === 'zh' ? '财务页需要独立密码保护。设置后每次进入都需输入（浏览器会话内免重复输入）。' : 'Finance requires its own password. You will be asked each new browser session.')
        : (owner.lang === 'zh' ? '请输入财务密码查看和操作财务数据。' : 'Enter the finance password to view and operate.')}</p>
      <input id="finLockPass" type="password" placeholder="${owner.lang === 'zh' ? '财务密码' : 'Finance password'}" autocomplete="off">
      ${setup ? `<input id="finLockPass2" type="password" placeholder="${owner.lang === 'zh' ? '再输入一次确认' : 'Confirm password'}" autocomplete="off">` : ''}
      <button class="primary" data-fin-unlock type="button">${setup ? (owner.lang === 'zh' ? '设置并进入' : 'Set and enter') : (owner.lang === 'zh' ? '解锁' : 'Unlock')}</button>
      ${!setup ? `<p class="subtle fin-lock-hint">${owner.lang === 'zh' ? '忘记密码?输入启动服务器窗口里显示的 Owner Token 也可解锁,进入后在「财务设置 → 财务密码」重设或关掉。' : 'Forgot it? The Owner Token from the server window also unlocks; reset it under Finance Settings.'}</p>` : ''}
    </div>
  `
}

function clearFinanceLock() {
  els.financePage.classList.remove('fin-locked')
  document.querySelector('#financeLockOverlay')?.remove()
}

async function submitFinanceUnlock() {
  const password = document.querySelector('#finLockPass')?.value || ''
  const confirmPassword = document.querySelector('#finLockPass2')?.value || ''
  const data = await request('/admin/finance/unlock', {
    method: 'POST',
    body: JSON.stringify({ password, confirmPassword })
  })
  owner.financeKey = data.financeKey
  sessionStorage.setItem('lucky-finance-key', owner.financeKey)
  owner.financeLedger.lockConfigured = true
  clearFinanceLock()
  await loadFinancePage()
  toast(data.created
    ? (owner.lang === 'zh' ? '财务密码已设置' : 'Finance password set')
    : (owner.lang === 'zh' ? '已解锁' : 'Unlocked'))
  // 解锁后回首页时,营收卡/今日待办的财务项要立即有数据
  loadAll().catch(() => {})
}

async function loadFinancePage() {
  const month = owner.financeLedger.month || new Date().toISOString().slice(0, 7)
  owner.financeLedger.month = month
  const lockStatus = await request('/admin/finance/lock-status').catch(() => ({ enabled: owner.financeLedger.lockEnabled, configured: owner.financeLedger.lockConfigured }))
  owner.financeLedger.lockConfigured = Boolean(lockStatus.configured)
  // 财务密码默认关闭(店主 2026-08-08 拍板)。没开门禁就不弹锁屏,直接进财务区(仍是老板专属)
  owner.financeLedger.lockEnabled = Boolean(lockStatus.enabled)
  loadFinanceLockSettings().catch(() => { /* 卡片拉不到不影响财务页本身 */ })
  if (owner.financeLedger.lockEnabled && !owner.financeKey) {
    renderFinanceLock()
    return
  }
  if (!owner.financeLedger.lockEnabled) clearFinanceLock()
  const [txns, rules, verify, progress, payroll, compensation, storedValue] = await Promise.allSettled([
    request(`/admin/finance/transactions?month=${month}`),
    request('/admin/finance/recurring'),
    request('/admin/finance/verify'),
    request(`/admin/finance/progress?month=${month}`),
    request(`/admin/finance/payroll?month=${month}`),
    request('/admin/finance/compensation'),
    request('/admin/stored-value')
  ])
  owner.financeLedger.data = txns.status === 'fulfilled' ? txns.value : null
  owner.financeLedger.rules = rules.status === 'fulfilled' ? rules.value.rules : []
  owner.financeLedger.ledger = verify.status === 'fulfilled' ? verify.value.ledger : null
  owner.financeLedger.progress = progress.status === 'fulfilled' ? progress.value.progress : null
  owner.financeLedger.payroll = payroll.status === 'fulfilled' ? payroll.value : null
  owner.financeLedger.compensation = compensation.status === 'fulfilled' ? compensation.value.compensation : null
  const lockedOut = [txns, rules, verify, progress].every((result) => result.status === 'rejected' && /FINANCE_LOCKED/.test(String(result.reason?.message || '')))
  if (lockedOut) {
    owner.financeKey = ''
    sessionStorage.removeItem('lucky-finance-key')
    renderFinanceLock()
    return
  }
  clearFinanceLock()
  owner.financeLedger.storedValue = storedValue.status === 'fulfilled' ? storedValue.value.storedValue : null
  renderFinancePage()
}

const FINANCE_GUIDE = {
  quick: {
    zh: ['记一笔 — 日常收支随手记', '选“收入/支出”→ 选类别 → 填金额和支付方式 → 记账。适合随机发生的采购、零售等。服务收入不用手记：订单标记完成后自动入账。记错了不能改，去流水里点该笔的「冲销」生成红字更正。'],
    en: ['Quick entry — record as it happens', 'Pick income/expense, choose a category, enter amount and channel, done. Service revenue posts automatically when a booking completes. Entries cannot be edited; correct mistakes with a reversal in the transactions list.']
  },
  storedValue: {
    zh: ['储值卡 — 卡上的钱是负债，耗卡才是收入', '顾客充值时选会员、填金额和收款方式，点「充值」——这笔钱记为“欠顾客的服务”（负债），不算收入。顾客用卡消费时点「耗卡」，此刻才确认为收入。储值总余额=所有卡上的“死钱”。列表按“沉睡天数”排序，最久没动的卡排最上——这就是你该做唤醒营销的名单。'],
    en: ['Stored value — balance is a liability', 'Recharges are recorded as a liability (services you owe), not revenue. Revenue is recognized only on consumption. Accounts are sorted by dormant days — the top of the list is your reactivation-marketing target.']
  },
  recurring: {
    zh: ['固定支出 — 设一次，每月自动入账', '房租、水电网、订阅这类每月固定的支出，填名称、类别、金额、每月几号扣，系统到日子自动生成流水。金额有小波动的先按平均值设，账单来了冲销后重记实际数。停用规则即停止后续生成。'],
    en: ['Recurring expenses — set once, auto-post monthly', 'Rent, utilities, subscriptions: set name, category, amount, and day of month. The system posts them automatically. Disable a rule to stop future postings; history is kept.']
  },
  targets: {
    zh: ['目标设置 — 系统帮你反推每天要做多少', '推荐填“月净利润目标”，系统反推需要的月营收：(固定支出+目标净利)÷(1−变动成本率)。变动成本率=耗材+提成约占收入比例，不确定先用 25%。日目标按营业日自动摊（休息日不算）。'],
    en: ['Targets — the system works backwards for you', 'Set a monthly net-profit target; required revenue = (fixed costs + target) ÷ (1 − variable cost rate). Daily targets spread across business days only.']
  },
  payroll: {
    zh: ['员工工资 — 月底确认才入账', '先配底薪和提成比例（提成=当月完成业绩×比例）。系统每月自动算草稿，你月底核对后点「确认结算」才入账。未确认期间按“预估净利”口径显示，防止利润虚高。'],
    en: ['Payroll — posts only after month-end confirmation', 'Configure base salary + commission rate. Drafts are computed automatically; profit shows an estimated caliber until you confirm settlement.']
  },
  ledger: {
    zh: ['账本安全 — 为什么不能改数字', '三重防护：① 流水禁止修改删除（数据库层强制），纠错只能红字冲销；② 每笔带加密指纹与上一笔咬合成链，直改文件立即断链；③ 随时一键校验全链。保证每个数字可信、可审计。'],
    en: ['Ledger security — why numbers cannot be edited', 'Append-only at the database level (corrections via reversal), hash-chained rows that break on tampering, and one-click chain verification.']
  },
  txns: {
    zh: ['流水 — 所有钱的来龙去脉', '每笔收支都在这里，可按类型/类别筛选、按月翻看。绿色收入、红色支出、灰色已冲销、粉底冲销单。点「冲销」生成等额反向记录纠错——原始记录永远保留。'],
    en: ['Transactions — every dollar accounted for', 'Filter by type/category, browse by month. Green income, red expense, grey reversed, pink reversal entries. Use reversal to correct; originals are kept forever.']
  }
}

function showFinanceGuide(section = 'all') {
  const existing = document.querySelector('.cs-lightbox')
  if (existing) existing.remove()
  const overlay = document.createElement('div')
  overlay.className = 'cs-lightbox'
  const panel = document.createElement('div')
  panel.className = 'fin-guide-panel'
  const lang = owner.lang === 'zh' ? 'zh' : 'en'
  const keys = section === 'all' ? Object.keys(FINANCE_GUIDE) : [section]
  panel.innerHTML = `
    <div class="fin-guide-head">
      <strong>${section === 'all'
        ? (owner.lang === 'zh' ? '财务使用指南' : 'Finance Guide')
        : escapeHtml(FINANCE_GUIDE[section]?.[lang]?.[0] || 'Guide')}</strong>
      <button class="ghost slim" data-guide-close type="button">${owner.lang === 'zh' ? '关闭' : 'Close'}</button>
    </div>
    <div class="fin-guide-body">
      ${keys.map((key) => `
        <div class="fin-guide-section">
          ${section === 'all' ? `<strong>${escapeHtml(FINANCE_GUIDE[key][lang][0])}</strong>` : ''}
          <p>${escapeHtml(FINANCE_GUIDE[key][lang][1])}</p>
        </div>`).join('')}
    </div>
  `
  panel.addEventListener('click', (event) => {
    event.stopPropagation()
    if (event.target.closest('[data-guide-close]')) overlay.remove()
  })
  overlay.addEventListener('click', () => overlay.remove())
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
}

function renderStoredValue() {
  if (!els.storedValueBody) return
  const sv = owner.financeLedger.storedValue
  if (!sv) {
    els.storedValueBody.innerHTML = '<p class="subtle">-</p>'
    return
  }
  const memberOptions = (owner.customers || []).slice(0, 200).map((customer) => `
    <option value="${escapeHtml(customer.id)}">${escapeHtml(customer.displayName || customer.memberCode || customer.id)}</option>`).join('')
  els.storedValueBody.innerHTML = `
    <div class="finance-metrics sv-metrics">
      <div class="finance-metric"><span>${owner.lang === 'zh' ? '储值总余额（负债）' : 'Outstanding balance'}</span><strong>${cadText(sv.totalBalanceCents)}</strong></div>
      <div class="finance-metric"><span>${owner.lang === 'zh' ? '本月充值' : 'Recharged'}</span><strong>${cadText(sv.monthRechargeCents)}</strong></div>
      <div class="finance-metric"><span>${owner.lang === 'zh' ? '本月耗卡' : 'Consumed'}</span><strong>${cadText(sv.monthConsumeCents)}</strong></div>
      <div class="finance-metric"><span>${owner.lang === 'zh' ? '耗卡率' : 'Consume rate'}</span><strong>${sv.consumeRate}%</strong></div>
    </div>
    <div class="sv-op-row">
      <select id="svMember">${memberOptions || `<option value="">${owner.lang === 'zh' ? '暂无会员' : 'No members'}</option>`}</select>
      <input id="svAmount" type="number" min="0" step="0.01" placeholder="${owner.lang === 'zh' ? '金额' : 'Amount'}">
      <select id="svChannel">${FINANCE_PAY_CHANNELS.filter(([id]) => id !== 'stored_value').map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>
      <select id="svTech" title="${owner.lang === 'zh' ? '经手技师:这笔算谁促成,计入其充值/耗卡提成' : 'Handled by'}">
        <option value="">${owner.lang === 'zh' ? '经手:店里直收' : 'House'}</option>
        ${(owner.technicians || []).map((t2) => `<option value="${escapeHtml(t2.id)}">${escapeHtml(t2.name)}</option>`).join('')}
      </select>
      <button class="primary slim" data-sv-recharge type="button">${owner.lang === 'zh' ? '充值' : 'Recharge'}</button>
      <button class="ghost slim" data-sv-consume type="button">${owner.lang === 'zh' ? '耗卡' : 'Consume'}</button>
    </div>
    ${(sv.accounts || []).length ? `
      <div class="sv-account-list">
        ${(sv.accounts || []).map((account) => `
          <div class="sv-account-row ${account.dormantDays >= 30 ? 'dormant' : ''}">
            <span class="sv-account-name"><strong>${escapeHtml(account.displayName)}</strong><small>${escapeHtml(account.memberCode)}</small></span>
            <span class="sv-account-balance">${cadText(account.balanceCents)}</span>
            <span class="sv-account-dormant">${account.dormantDays >= 30
              ? (owner.lang === 'zh' ? `沉睡 ${account.dormantDays} 天 ⚠` : `dormant ${account.dormantDays}d ⚠`)
              : account.lastConsumeAt
                ? (owner.lang === 'zh' ? `${account.dormantDays} 天前耗卡` : `${account.dormantDays}d ago`)
                : (owner.lang === 'zh' ? '尚未耗卡' : 'never consumed')}</span>
          </div>`).join('')}
      </div>` : `<p class="subtle">${owner.lang === 'zh' ? '还没有储值账户。用上方表单给会员充值即可开卡。' : 'No stored-value accounts yet.'}</p>`}
  `
}

// 2026-08-02 指标显隐重构(店主 v4 定稿):四个真数永远显示;目标条/平衡线/年度 设了才出现;
// 提示统一收进「✦ AI 智能总结」卡(模板即时生成,无 emoji;外观与将来接真 AI 一致);旧四环删除。
function renderFinanceProgress() {
  if (!els.financeProgress) return
  const zh = owner.lang === 'zh'
  const p = owner.financeLedger.progress
  if (!p) { els.financeProgress.innerHTML = ''; return }
  const hasTarget = Number(p.targets?.monthTargetCents || 0) > 0
  const hasFixed = Number(p.fixedCents || 0) > 0
  const est = owner.salaryEstimateCache
  const wagesPending = est && est.month === p.month && !est.paid && est.totalCents > 0 ? est.totalCents : 0
  // —— AI 智能总结:按"有什么数据说什么话"逐条生成 ——
  const bullets = []
  if (p.businessDays?.elapsed > 0 && p.paceProjectionCents > 0) {
    bullets.push({ tone: '', html: zh
      ? `照这个节奏,月底预计收入 <b>${cadText(p.paceProjectionCents)}</b>(按已过营业天数推算)`
      : `On current pace, month-end revenue ≈ <b>${cadText(p.paceProjectionCents)}</b>` })
  }
  if (hasTarget && hasFixed) {
    if (p.revenueCents >= p.breakEvenRevenueCents) {
      bullets.push({ tone: 'good', html: zh
        ? `已越过收支平衡线 <b>${cadText(p.breakEvenRevenueCents)}</b>(估算),本月进入盈利区间`
        : `Break-even <b>${cadText(p.breakEvenRevenueCents)}</b> (est.) crossed` })
    } else {
      bullets.push({ tone: '', html: zh
        ? `距收支平衡线 ${cadText(p.breakEvenRevenueCents)}(估算)还差 <b>${cadText(p.breakEvenRevenueCents - p.revenueCents)}</b>`
        : `<b>${cadText(p.breakEvenRevenueCents - p.revenueCents)}</b> to break-even (est.)` })
    }
  }
  if (hasTarget) {
    if (p.revenueCents >= p.monthRevenueTargetCents) {
      bullets.push({ tone: 'good', html: zh ? `本月目标 ${cadText(p.monthRevenueTargetCents)} 已达成` : `Monthly target hit` })
    } else if (p.businessDays?.elapsed >= 3 && p.paceProjectionCents > 0 && p.paceProjectionCents < p.monthRevenueTargetCents) {
      const gap = p.monthRevenueTargetCents - p.paceProjectionCents
      const remainDays = Math.max(1, (p.businessDays.total || 1) - (p.businessDays.elapsed || 0))
      bullets.push({ tone: 'warn', html: zh
        ? `按当前节奏月底约 ${cadText(p.paceProjectionCents)},距目标差 <b>${cadText(gap)}</b>,日均再多收 ${cadText(Math.ceil(gap / remainDays))} 可追上`
        : `Pace ≈ ${cadText(p.paceProjectionCents)}, <b>${cadText(gap)}</b> short of target` })
    }
  }
  if (wagesPending) {
    bullets.push({ tone: '', html: zh
      ? `本月工资试算 <b>${cadText(wagesPending)}</b> 待发,扣除后净赚约 <b>${cadText(p.netCents - wagesPending)}</b>`
      : `Payroll estimate <b>${cadText(wagesPending)}</b> pending; net after ≈ <b>${cadText(p.netCents - wagesPending)}</b>` })
  }
  const aiHtml = bullets.length ? `
    <div class="fin-ai">
      <div class="fin-ai-h"><span class="fin-ai-spark">✦</span> ${zh ? 'AI 智能总结' : 'AI Summary'}</div>
      ${bullets.map((b) => `<div class="fin-ai-li ${b.tone}">${b.html}</div>`).join('')}
    </div>` : ''
  if (!hasTarget) {
    // 没设目标:不摆空进度环,只留一行淡引导(店主定稿:不逼人设目标)
    els.financeProgress.innerHTML = `
      ${aiHtml}
      <div class="fin-goal-guide">
        <span>${zh ? '想看 <b>目标进度 / 收支平衡线</b>?就 3 项,一分钟' : 'Want progress bars? A 3-field, one-minute setup'}</span>
        <button class="fin-goal-go" data-goal-setup type="button">${zh ? '去设置 ›' : 'Set up ›'}</button>
      </div>`
    animateFinanceProgress()
    return
  }
  const pct = Math.min(100, Math.round((p.revenueCents / p.monthRevenueTargetCents) * 100))
  const breakPct = hasFixed && p.breakEvenRevenueCents > 0 && p.breakEvenRevenueCents < p.monthRevenueTargetCents
    ? Math.round((p.breakEvenRevenueCents / p.monthRevenueTargetCents) * 100) : null
  const modeText = p.targets.targetMode === 'net_profit'
    ? (zh ? `净利目标 ${cadText(p.targets.monthTargetCents)} 折算` : 'from net-profit target')
    : (zh ? '营收目标' : 'revenue target')
  const yearPct = p.targets?.yearTargetCents ? Math.min(100, Math.round((p.yearRevenueCents / p.yearTargetCents) * 100)) : null
  els.financeProgress.innerHTML = `
    ${aiHtml}
    <div class="fin-goalbox">
      <div class="fin-goal-head">
        <strong>${zh ? '本月目标' : 'Month target'} ${cadText(p.monthRevenueTargetCents)}</strong>
        <em>${modeText} · ${zh ? '已完成' : 'done'} ${pct}% · <button class="fin-goal-edit" data-goal-setup type="button">${zh ? '改目标' : 'Edit'}</button></em>
      </div>
      <div class="fin-gbar"><i data-w="${pct}"></i>${breakPct != null ? `<span class="fin-breakline" style="left:${breakPct}%" title="${zh ? `收支平衡线(估算)= 固定支出 ${cadText(p.fixedCents)} ÷ (1−变动成本率 ${Math.round((p.targets.variableCostRate || 0) * 100)}%);过线=固定成本都赚回来了` : 'Break-even (estimate)'}"></span>` : ''}</div>
      <div class="fin-goal-sub">
        <span>${zh ? '日均需收' : 'Daily'} <b>${cadText(p.dailyTargetCents)}</b> · ${zh ? '今日已收' : 'today'} ${cadText(p.todayRevenueCents)}</span>
        ${breakPct != null ? `<span>▲ ${zh ? '平衡线' : 'Break-even'} ${cadText(p.breakEvenRevenueCents)}(${zh ? '估算' : 'est.'})</span>` : ''}
      </div>
    </div>
    ${yearPct != null ? `
    <div class="fin-goalbox">
      <div class="fin-goal-head"><strong>${zh ? '年度目标' : 'Year target'} ${cadText(p.yearTargetCents)}</strong><em>${zh ? '已完成' : 'done'} ${yearPct}%</em></div>
      <div class="fin-gbar"><i data-w="${yearPct}"></i></div>
    </div>` : ''}`
  animateFinanceProgress()
}

// 动效:进度条从 0 生长、AI 总结逐条浮现——只在渲染时播一次,不循环
function animateFinanceProgress() {
  document.querySelectorAll('#financeProgress .fin-gbar i').forEach((el) => {
    const w = el.dataset.w
    el.style.width = '0%'
    setTimeout(() => { el.style.width = `${w}%` }, 100)
  })
  document.querySelectorAll('#financeProgress .fin-ai-li').forEach((el, i) => {
    setTimeout(() => el.classList.add('show'), 350 + i * 220)
  })
}

/* ===== P2② 日结板块(屏 1 下半)+ 金额更正(屏 1b)+ 财务趋势(P2.4)=====
   金额红线同 P1:本页不算钱。分成比例是老板填的输入,金额一律由后端算好回传;
   改比例时前端只做「本地回显」,提交后以后端返回的 shares 为准。 */
let dailyCloseState = { date: '', view: null, loading: false, open: {}, correcting: null }

function shiftDate(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

async function loadDailyClose(date) {
  dailyCloseState.date = date || dailyCloseState.date || storeToday()
  dailyCloseState.loading = true
  renderDailyClose()
  const data = await request(`/admin/daily-close?date=${encodeURIComponent(dailyCloseState.date)}`)
  dailyCloseState.view = data.dailyClose
  dailyCloseState.loading = false
  renderDailyClose()
}

function renderDailyClose() {
  const body = document.querySelector('#dailyCloseBody')
  if (!body) return
  const zh = owner.lang === 'zh'
  const dateEl = document.querySelector('#dailyCloseDate')
  if (dateEl) dateEl.textContent = dailyCloseState.date || ''
  if (dailyCloseState.loading) { body.innerHTML = `<p class="subtle">${zh ? '加载中…' : 'Loading…'}</p>`; return }
  const v = dailyCloseState.view
  if (!v) { body.innerHTML = ''; return }
  if (dailyCloseState.correcting) { body.innerHTML = renderCorrectionForm(dailyCloseState.correcting, zh); return }

  const confirmed = v.status === 'confirmed'
  const pend = v.pendingAllocation || []
  const anomalies = v.anomalies || {}
  body.innerHTML = `
    ${confirmed ? `<div class="dc-warnbar" style="background:#e3eee8;border-color:#bcdccd;color:#2f7d5c">
      ${zh ? `已确认日结 · ${String(v.confirmedAt || '').slice(0, 16).replace('T', ' ')} · ${escapeHtml(v.confirmedBy || '')}${v.reopenCount ? ` · 重开过 ${v.reopenCount} 次` : ''}` : 'Confirmed'}
      <button class="ghost slim" id="dcReopen" type="button" style="margin-left:10px">${zh ? '重开日结' : 'Reopen'}</button>
    </div>` : ''}

    <div class="section-row compact-row" style="margin-top:4px">
      <span class="subtle">${zh ? `本日 ${v.orderCount} 单 · 营业额 ${money(v.revenueCents, 2)}` : `${v.orderCount} orders`}</span>
    </div>

    ${pend.length ? `<h3 style="font-size:14px;margin:12px 0 8px">${zh ? `待分配 ${pend.length} 单` : `${pend.length} to allocate`}<span class="subtle" style="margin-left:8px;font-weight:400">${zh ? '逐单点开' : ''}</span></h3>` : ''}
    ${pend.map((p) => {
      const open = dailyCloseState.open[p.settlementId] !== false
      return `
      <div class="dc-alloc ${open ? '' : 'collapsed'}" data-alloc="${escapeHtml(p.settlementId)}">
        <div class="head" data-alloc-toggle="${escapeHtml(p.settlementId)}">
          <span>${escapeHtml(p.code)} ${escapeHtml(p.servedPersonName || p.customerName || '')} · ${p.technicians.length > 1 ? (zh ? '双技师' : 'Two techs') : (zh ? '单技师' : 'Single')}</span>
          <span>${money(p.perfBaseCents, 2)}${p.couponDiscountCents ? `<span class="subtle" style="margin-left:6px">${zh ? '业绩基数(不含券)' : 'perf base'}</span>` : ''} <span class="arr">${open ? (zh ? '收起 ∧' : 'Hide ∧') : (zh ? '点开分配 ∨' : 'Open ∨')}</span></span>
        </div>
        <div class="body">
          ${p.technicians.map((t, i) => `
            <div class="dc-line">
              <span class="nm">${escapeHtml(t.name)}</span>
              <span class="wnote">${t.role === 'main' ? (zh ? '主' : 'Main') : (zh ? '副' : 'Assist')}${t.itemNos.length ? ` · ${t.itemNos.join('、')}` : ''}</span>
              <input data-share-tech="${escapeHtml(t.technicianId)}" inputmode="numeric"
                value="${p.technicians.length === 1 ? 100 : (i === 0 ? p.defaultSplit.mainPct : p.defaultSplit.assistPct)}"> %
            </div>`).join('')}
          <div class="dc-links">
            ${(v.settlements.find((s) => s.settlementId === p.settlementId) || {}).hasSnapshot
              ? `<a data-dc-snapshot="${escapeHtml(p.code)}">${zh ? '查看签署单' : 'View signed sheet'}</a>` : ''}
            <a data-dc-correct="${escapeHtml(p.settlementId)}">${zh ? '金额有误?发起更正' : 'Amount wrong? Amend'}</a>
            <button class="primary slim" data-dc-allocate="${escapeHtml(p.settlementId)}" type="button">${zh ? '保存分配' : 'Save split'}</button>
          </div>
        </div>
      </div>`
    }).join('')}

    <table class="dc-sum">
      <tr>
        <th>${zh ? '技师' : 'Tech'}</th><th>${zh ? '单数' : 'Orders'}</th><th>${zh ? '业绩' : 'Revenue'}</th>
        <th>${zh ? '卡耗' : 'Card used'}</th><th>${zh ? '冲卡' : 'Recharge'}</th><th>${zh ? '目标' : 'Target'}</th>
      </tr>
      ${(v.technicians || []).map((t) => `
      <tr>
        <td class="nm">${escapeHtml(t.name)}</td>
        <td>${t.orderCount}</td>
        <td>${t.pendingCount ? `<span class="dc-badge mut">${zh ? '待分配' : 'pending'}</span>` : money(t.perfCents, 2)}</td>
        <td>${money(t.cardUsedCents, 2)}</td>
        <td>${t.rechargeTotalCents ? money(t.rechargeTotalCents, 2) : '—'}</td>
        <td>${targetCellText(t, zh)}</td>
      </tr>`).join('')}
    </table>

    <div class="dc-anom">
      ${zh ? '价档异常' : 'Tier changes'} <span class="dc-badge ${(anomalies.tierChanges || []).length ? 'warn' : 'mut'}">${(anomalies.tierChanges || []).length}</span>
      ${(anomalies.tierChanges || []).map((a) => `<span style="margin-left:8px">${escapeHtml(a.code)} ${escapeHtml(a.from || '')}→${escapeHtml(a.to || '')}${a.by ? `(${escapeHtml(a.by)} ${String(a.at || '').slice(11, 16)})` : ''}</span>`).join('')}
      <br>${zh ? '免卸甲/免卸睫' : 'Free removals'} <span class="dc-badge mut">${(anomalies.freeRemoval || {}).count || 0} ${zh ? '笔' : ''}</span>
    </div>

    ${(v.blockers || []).map((b) => `<div class="dc-warnbar">${escapeHtml(b.message)}</div>`).join('')}
    ${confirmed ? '' : `<button class="primary full" id="dcConfirm" type="button" ${v.canConfirm ? '' : 'disabled'}>
      ${v.canConfirm ? (zh ? '确认日结' : 'Confirm day') : (zh ? `确认日结(${(v.blockers || [])[0]?.message || ''})` : 'Blocked')}
    </button>`}`
}

function targetCellText(t, zh) {
  if (!t.target || !t.target.perfTargetCents) return '—'
  const gap = t.target.perfTargetCents - t.perfCents
  return gap <= 0
    ? `<span class="dc-badge ok">${zh ? '达标' : 'Hit'}</span>`
    : `${zh ? '差' : 'Short'} ${money(gap, 2)}`
}

/* 屏 1b 金额更正:上半是顾客已签的存档单(只读带锁标),下半填改后金额与原因。
   提交 = 追加一条更正记录,原签署单永不改动;储值差额由后端自动补配。 */
function renderCorrectionForm(row, zh) {
  return `
    <div class="section-row compact-row">
      <h3 style="font-size:15px">${zh ? '金额更正' : 'Amend'} · ${escapeHtml(row.code)}</h3>
      <button class="ghost slim" id="dcCorrectCancel" type="button">${zh ? '返回日结' : 'Back'}</button>
    </div>
    <div class="dc-ro">
      <div class="ro-t"><span>${zh ? '顾客已签存档单(只读)' : 'Signed sheet (read-only)'}</span><span class="lock">${zh ? '不可修改' : 'locked'}</span></div>
      ${escapeHtml(row.servedPersonName || '')}${row.isProxyPaid ? (zh ? '(代付)' : ' (proxy)') : ''} · ${String(row.signedAt || '').slice(0, 16).replace('T', ' ')}
      · ${(row.technicians || []).map((t) => `${escapeHtml(t.name)}(${t.role === 'main' ? (zh ? '主' : 'main') : (zh ? '副' : 'assist')})`).join('/')}<br>
      ${(row.items || []).map((l) => `${String(l.itemNo).padStart(2, '0')} ${escapeHtml(l.name)} ${l.isFree ? (zh ? '免收' : 'free') : money(l.amountCents, 2)}`).join(' · ')}<br>
      ${row.depositDeductCents ? `${zh ? '定金抵扣' : 'Deposit'} −${money(row.depositDeductCents, 2)} · ` : ''}<b>${zh ? '合计' : 'Total'} ${money(row.totalCents, 2)}</b>
    </div>
    <div class="dep-block" style="margin-top:12px">
      <h4>${zh ? '更正内容' : 'Amendment'}</h4>
      <div class="dep-inline" style="margin-top:0">
        <label>${zh ? '更正后合计' : 'New total'}<input id="dcNewTotal" inputmode="decimal" value="${row.totalCents / 100}"></label>
      </div>
      <textarea class="dep-text" id="dcReason" style="min-height:80px;margin-top:10px"
        placeholder="${zh ? '原因(必填):例「实际只补了 1 指,技师勾多了」' : 'Reason (required)'}"></textarea>
      <p class="subtle">${zh
        ? '提交后:① 原签署单保持原样,顾客服务记录追加一条「订单更正记录」(改前/改后/操作人/时间)② 用卡付过的单,储值差额由系统自动补配(人工不可改这笔)③ 更正进当日日结留痕'
        : 'The signed sheet stays untouched; an amendment record is appended.'}</p>
      <button class="primary slim" id="dcCorrectSubmit" type="button">${zh ? '提交更正' : 'Submit'}</button>
    </div>`
}

/* 订单页「待日结 N · 去日结」直达条(裁决①:网页日结留在财务页,订单页给个直达)。
   只有老板看得见 —— 员工调这个接口本来就是 403。 */
async function renderDailyCloseJump() {
  const bar = els.dcJumpBar
  if (!bar) return
  if (!isOwnerRole()) { bar.classList.add('hidden'); return }
  try {
    const data = await request('/admin/daily-close')
    const dc = data.dailyClose
    const pending = (dc.pendingAllocation || []).length
    const unsigned = (dc.blockers || []).filter((b) => b.code === 'UNSIGNED').reduce((n, b) => n + b.count, 0)
    if (dc.status === 'confirmed' && !pending) { bar.classList.add('hidden'); return }
    const zh = owner.lang === 'zh'
    bar.classList.remove('hidden')
    bar.innerHTML = `
      <span>${zh ? '待日结' : 'To close'} <b>${pending}</b> ${zh ? '单' : ''}${unsigned ? `(${zh ? '另有' : 'plus'} ${unsigned} ${zh ? '张待顾客签字' : 'unsigned'})` : ''}
        · ${escapeHtml(dc.date)}${dc.status === 'confirmed' ? (zh ? ' · 已确认' : ' · confirmed') : ''}</span>
      <button class="primary slim" id="dcJumpGo" type="button">${zh ? '去日结' : 'Go'}</button>`
    const go = bar.querySelector('#dcJumpGo')
    if (go) go.addEventListener('click', () => {
      owner.adminPage = 'finance'
      render()
      loadFinancePage()
        .then(() => document.querySelector('#finNavDailyClose')?.click())
        .catch((error) => toast(error.message))
    })
  } catch { bar.classList.add('hidden') }
}

let financeTrendState = { granularity: 'month', data: null }

async function loadFinanceTrend(granularity) {
  const g = granularity || financeTrendState.granularity
  const periods = g === 'day' ? 14 : (g === 'week' ? 8 : (g === 'year' ? 3 : 6))
  const body = document.querySelector('#financeTrendBody')
  if (body) body.innerHTML = `<p class="subtle">${owner.lang === 'zh' ? '加载中…' : 'Loading…'}</p>`
  const data = await request(`/admin/finance/trend?granularity=${g}&periods=${periods}`)
  financeTrendState = { granularity: g, data: data.trend }
  document.querySelectorAll('#financeTrendTabs [data-trend-g]').forEach((b) => b.classList.toggle('active', b.dataset.trendG === g))
  renderFinanceTrend()
  loadCouponDiscounts().catch(() => { /* 券让利卡拉不到不拖垮趋势页 */ })
}

/* 月度券让利汇总(设计图 C3 末句)。口径 = 当月已签服务单上实际抵掉的券金额,
   按发放类型拆「特批 / 系统」。金额全是后端算好的,这里只显示。 */
async function loadCouponDiscounts() {
  const box = document.querySelector('#couponDiscountBody')
  if (!box) return
  const month = els.financeMonth?.value || ''
  const data = await request(`/admin/finance/coupon-discounts${month ? `?month=${month}` : ''}`)
  const d = data.couponDiscounts
  // 币种格式用后端下发的 currencyDisplay,和其它页同一套映射
  const fmt = data.currencyDisplay || { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false }
  const money = (cents) => {
    let text = (Math.round(cents || 0) / 100).toFixed(2)
    if (fmt.trimZeroDecimals) text = text.replace(/\.00$/, '')
    return `${String(fmt.prefix).replace('<CODE>', data.currency)}${fmt.symbol}${text}`
  }
  box.innerHTML = `
    <div class="finance-metrics" style="margin-bottom:10px">
      <div class="finance-metric"><span>券让利合计（${d.count} 张已核销）</span><strong>${money(d.totalCents)}</strong></div>
      <div class="finance-metric"><span>特批券（老板逐张发放）</span><strong>${money(d.customCents)}</strong></div>
      <div class="finance-metric"><span>系统 / 模板券</span><strong>${money(d.templateCents)}</strong></div>
    </div>
    ${d.rows.length ? `<table class="dc-sum"><thead><tr><th>日期</th><th>单号</th><th>券</th><th>类型</th><th>发放人 · 原因</th><th style="text-align:right">让利</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr>
        <td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.couponName)}</td>
        <td>${r.grantKind === 'custom' ? '特批' : '系统'}</td>
        <td>${escapeHtml(r.grantedBy)}${r.grantReason ? ` · ${escapeHtml(r.grantReason)}` : ''}</td>
        <td style="text-align:right">−${money(r.discountCents)}</td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="subtle">本月还没有用券的已签单。</p>'}`
}

function renderFinanceTrend() {
  const body = document.querySelector('#financeTrendBody')
  if (!body || !financeTrendState.data) return
  const zh = owner.lang === 'zh'
  const t = financeTrendState.data
  // 柱高只是画图比例,不是金额运算;所有数字都照后端返回值显示
  const max = Math.max(1, ...t.points.map((p) => Math.max(p.revenueCents, p.expenseCents)))
  const cmp = t.compare
  body.innerHTML = `
    <div class="trend-chart">
      ${t.points.map((p) => `
        <div class="trend-bar">
          <div class="stack">
            <div class="b ${p.hitTarget ? 'hit' : ''}" style="height:${Math.round(p.revenueCents / max * 130)}px" title="${zh ? '收入' : 'Revenue'} ${money(p.revenueCents, 2)}"></div>
            <div class="b exp" style="height:${Math.round(p.expenseCents / max * 130)}px" title="${zh ? '支出' : 'Expense'} ${money(p.expenseCents, 2)}"></div>
          </div>
          <span class="lb">${escapeHtml(p.label)}</span>
        </div>`).join('')}
    </div>
    <div class="trend-legend">
      <span><i style="background:#c8a47e"></i>${zh ? '收入' : 'Revenue'}</span>
      <span><i style="background:#2f7d5c"></i>${zh ? '收入(达标)' : 'Revenue (hit)'}</span>
      <span><i style="background:#e0d3c4"></i>${zh ? '支出' : 'Expense'}</span>
    </div>
    ${cmp ? `<p class="subtle" style="margin-top:10px">${zh ? '环比上期' : 'vs previous'}:${cmp.revenueDeltaCents >= 0 ? '+' : '−'}${money(Math.abs(cmp.revenueDeltaCents), 2)}${cmp.revenueDeltaPct === null ? '' : `(${cmp.revenueDeltaPct >= 0 ? '+' : ''}${cmp.revenueDeltaPct}%)`} · ${zh ? '单量' : 'Orders'} ${cmp.orderDelta >= 0 ? '+' : ''}${cmp.orderDelta}</p>` : ''}
    <table class="dc-sum" style="margin-top:12px">
      <tr>
        <th>${zh ? '周期' : 'Period'}</th><th>${zh ? '收入' : 'Revenue'}</th><th>${zh ? '支出' : 'Expense'}</th><th>${zh ? '净利' : 'Net'}</th>
        <th>${zh ? '单量' : 'Orders'}</th><th>${zh ? '客单' : 'Avg'}</th><th>${zh ? '充值' : 'Recharge'}</th><th>${zh ? '耗卡' : 'Card used'}</th><th>${zh ? '目标' : 'Target'}</th>
      </tr>
      ${t.points.slice().reverse().map((p) => `
      <tr>
        <td class="nm">${escapeHtml(p.label)}</td>
        <td>${money(p.revenueCents, 2)}</td>
        <td>${money(p.expenseCents, 2)}</td>
        <td>${money(p.netCents, 2)}</td>
        <td>${p.orderCount}</td>
        <td>${money(p.avgTicketCents, 2)}</td>
        <td>${money(p.rechargeCents, 2)}</td>
        <td>${money(p.cardUsedCents, 2)}</td>
        <td>${p.targetCents === null ? '—' : (p.hitTarget ? `<span class="dc-badge ok">${zh ? '达标' : 'Hit'}</span>` : money(p.targetCents, 2))}</td>
      </tr>`).join('')}
    </table>`
}

function applyFinanceTab() {
  const tab = owner.financeLedger.tab || 'quick'
  document.querySelectorAll('#financePage [data-fin-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.finPanel !== tab)
  })
  document.querySelectorAll('#financeNav [data-fin-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.finTab === tab)
  })
}

function showFinanceInsights() {
  const existing = document.querySelector('.cs-lightbox')
  if (existing) existing.remove()
  const overlay = document.createElement('div')
  overlay.className = 'cs-lightbox'
  const panel = document.createElement('div')
  panel.className = 'fin-guide-panel'
  panel.innerHTML = `
    <div class="fin-guide-head">
      <strong>✦ ${owner.lang === 'zh' ? 'AI 财务解读' : 'AI Finance Insights'} · ${owner.financeLedger.month || ''}</strong>
      <button class="ghost slim" data-guide-close type="button">${owner.lang === 'zh' ? '关闭' : 'Close'}</button>
    </div>
    <div class="fin-insight-box" id="finInsightModalBody">${owner.lang === 'zh' ? '正在分析本月账目…' : 'Analyzing…'}</div>
  `
  panel.addEventListener('click', (event) => {
    event.stopPropagation()
    if (event.target.closest('[data-guide-close]')) overlay.remove()
  })
  overlay.addEventListener('click', () => overlay.remove())
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
  request('/admin/finance/insights', { method: 'POST', body: '{}' })
    .then((data) => {
      const body = document.querySelector('#finInsightModalBody')
      if (body) body.textContent = data.insight?.text || '-'
    })
    .catch((error) => {
      const body = document.querySelector('#finInsightModalBody')
      if (body) body.textContent = error.message
    })
}

// 2026-08-02 「设个目标」聚焦弹窗(店主 v4 定稿):仅 4 项——类型/金额/变动成本率(带智能建议值)/年目标;
// 不是整个财务设置。建议率 =(上月总支出 − 固定支出)÷ 上月收入,上月没收入则不出现按钮。
async function openGoalSetupModal() {
  const zh = owner.lang === 'zh'
  const t0 = owner.financeLedger.progress?.targets || { targetMode: 'net_profit', monthTargetCents: 0, variableCostRate: 0.25, yearTargetCents: null }
  let suggestPct = null
  try {
    const cur = /^\d{4}-\d{2}$/.test(owner.financeLedger.month || '') ? owner.financeLedger.month : storeToday().slice(0, 7)
    const [y, m] = cur.split('-').map(Number)
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    const prevData = await request(`/admin/finance/transactions?month=${prev}`)
    const inc = prevData.summary?.incomeCents || 0
    const exp = prevData.summary?.expenseCents || 0
    const fixed = owner.financeLedger.progress?.fixedCents || 0
    if (inc > 0 && exp > fixed) suggestPct = Math.min(95, Math.max(1, Math.round(((exp - fixed) / inc) * 100)))
  } catch { /* 拿不到上月账就只用默认值,不出建议按钮 */ }
  const existing = document.querySelector('.cs-lightbox')
  if (existing) existing.remove()
  const overlay = document.createElement('div')
  overlay.className = 'cs-lightbox'
  const panel = document.createElement('div')
  panel.className = 'fin-guide-panel'
  panel.innerHTML = `
    <div class="fin-guide-head">
      <strong>${zh ? '设个目标' : 'Set a goal'}</strong>
      <button class="ghost slim" data-goal-close type="button">${zh ? '关闭' : 'Close'}</button>
    </div>
    <div class="fin-goal-form">
      <p class="fin-goal-lab">① ${zh ? '目标类型' : 'Target type'}</p>
      <div class="seg-toggle">
        <button class="${t0.targetMode !== 'revenue' ? 'on' : ''}" data-goal-mode="net_profit" type="button">${zh ? '每月想净赚' : 'Net profit'}</button>
        <button class="${t0.targetMode === 'revenue' ? 'on' : ''}" data-goal-mode="revenue" type="button">${zh ? '每月想收到' : 'Revenue'}</button>
      </div>
      <p class="fin-goal-lab">② ${zh ? '目标金额($ / 月)' : 'Amount ($/month)'}</p>
      <input id="goalMonth" type="number" min="0" step="100" value="${t0.monthTargetCents ? t0.monthTargetCents / 100 : ''}" placeholder="3500">
      <p class="fin-goal-lab">③ ${zh ? '变动成本率(每营收100块中耗材和提成的占比)' : 'Variable cost % (materials + commission per $100 revenue)'}</p>
      <div class="fin-goal-raterow">
        <input id="goalRate" type="number" min="0" max="95" value="${Math.round((t0.variableCostRate || 0.25) * 100)}">
        ${suggestPct != null ? `<button class="fin-suggest-btn" data-goal-suggest="${suggestPct}" type="button">${zh ? '使用智能建议值' : 'Use suggested value'}</button>` : ''}
      </div>
      <p class="subtle fin-goal-tip">${zh ? `新店没账时默认 25%(行业经验值);之后每个月会使用上个月的真实变动成本率作为智能建议值${suggestPct != null ? `(当前建议:${suggestPct}%)` : ''}。` : `Default 25%; the suggestion is derived from last month's real ledger${suggestPct != null ? ` (currently ${suggestPct}%)` : ''}.`}</p>
      <p class="fin-goal-lab">④ ${zh ? '年目标($,可选,留空不显示年度进度)' : 'Year target ($, optional)'}</p>
      <input id="goalYear" type="number" min="0" step="1000" value="${t0.yearTargetCents ? t0.yearTargetCents / 100 : ''}">
      <button class="primary slim fin-goal-save" data-goal-save type="button">${zh ? '保存,点亮进度条' : 'Save'}</button>
      <p class="subtle fin-goal-skip">${zh ? '先不设也没关系,四个真数永远都在' : 'Skipping is fine — the four base numbers always show'}</p>
    </div>
  `
  panel.addEventListener('click', async (event) => {
    event.stopPropagation()
    if (event.target.closest('[data-goal-close]')) { overlay.remove(); return }
    const mode = event.target.closest('[data-goal-mode]')
    if (mode) {
      panel.querySelectorAll('[data-goal-mode]').forEach((b) => b.classList.toggle('on', b === mode))
      return
    }
    const sug = event.target.closest('[data-goal-suggest]')
    if (sug) { panel.querySelector('#goalRate').value = sug.dataset.goalSuggest; return }
    if (event.target.closest('[data-goal-save]')) {
      const monthTarget = Number(panel.querySelector('#goalMonth')?.value || 0)
      if (!monthTarget) { toast(zh ? '先填目标金额' : 'Enter an amount first'); return }
      try {
        await request('/admin/finance/targets', { method: 'PUT', body: JSON.stringify({
          targetMode: panel.querySelector('[data-goal-mode].on')?.dataset.goalMode || 'net_profit',
          monthTarget,
          variableCostRate: Math.min(0.95, Math.max(0, Number(panel.querySelector('#goalRate')?.value || 25) / 100)),
          yearTarget: panel.querySelector('#goalYear')?.value ? Number(panel.querySelector('#goalYear').value) : null
        }) })
        overlay.remove()
        owner._finAnimAt = 0 // 保存后重播动效,进度条"点亮"
        await loadFinancePage()
        toast(zh ? '目标已保存,进度条点亮' : 'Targets saved')
      } catch (error) { toast(error.message) }
    }
  })
  overlay.addEventListener('click', () => overlay.remove())
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
}

function renderFinanceTargets() {
  if (!els.financeTargetsBody) return
  const targets = owner.financeLedger.progress?.targets || { targetMode: 'net_profit', monthTargetCents: 0, variableCostRate: 0.25, yearTargetCents: null }
  els.financeTargetsSummary.textContent = targets.monthTargetCents
    ? `${targets.targetMode === 'revenue' ? (owner.lang === 'zh' ? '月营收' : 'Revenue') : (owner.lang === 'zh' ? '月净利' : 'Net')} ${cadText(targets.monthTargetCents)}`
    : (owner.lang === 'zh' ? '未设置' : 'Not set')
  els.financeTargetsBody.innerHTML = `
    <div class="finance-quick-grid">
      <label><span>${owner.lang === 'zh' ? '目标类型' : 'Target type'}</span>
        <select id="finTargetMode">
          <option value="net_profit" ${targets.targetMode === 'net_profit' ? 'selected' : ''}>${owner.lang === 'zh' ? '月净利润' : 'Monthly net profit'}</option>
          <option value="revenue" ${targets.targetMode === 'revenue' ? 'selected' : ''}>${owner.lang === 'zh' ? '月营收' : 'Monthly revenue'}</option>
        </select>
      </label>
      <label><span>${owner.lang === 'zh' ? '月目标 (CAD)' : 'Monthly target'}</span><input id="finTargetMonth" type="number" min="0" step="100" value="${(targets.monthTargetCents / 100) || ''}"></label>
      <label><span>${owner.lang === 'zh' ? '变动成本率 %(每营收100块中耗材和提成的占比)' : 'Variable cost %'}</span><input id="finTargetRate" type="number" min="0" max="95" value="${Math.round((targets.variableCostRate || 0.25) * 100)}"></label>
      <label><span>${owner.lang === 'zh' ? '年营收目标 (可选)' : 'Yearly target (optional)'}</span><input id="finTargetYear" type="number" min="0" step="1000" value="${targets.yearTargetCents ? targets.yearTargetCents / 100 : ''}"></label>
    </div>
    <button class="primary slim" data-fin-targets-save type="button">${owner.lang === 'zh' ? '保存目标' : 'Save targets'}</button>
    <p class="subtle">${owner.lang === 'zh' ? '变动成本率=耗材+提成约占收入的比例,不确定就先用 25%,跑出流水后可随时调。系统据此反推:需要的月营收=(固定支出+目标净利)÷(1−变动成本率)。' : 'Required revenue = (fixed costs + target net) ÷ (1 − variable cost rate).'}</p>
  `
}

function renderFinancePayroll() {
  // 2026-08-02 独立「👥 员工工资」tab(店主定:工资月月变,不属于"设置"):试算 → 业绩核查(归属备注+待写小记,融合在本页)→ 锁定 → 发放入账;月份跟随上方财务月份
  if (!els.financePayrollBody) return
  const hasStaffPlan = Boolean(owner.tenantPlan?.features?.staff_schedule?.enabled)
  els.finNavPayroll?.classList.toggle('hidden', !hasStaffPlan)
  if (!hasStaffPlan) return
  const zh = owner.lang === 'zh'
  const month = /^\d{4}-\d{2}$/.test(owner.financeLedger.month || '') ? owner.financeLedger.month : new Date().toISOString().slice(0, 7)
  els.financePayrollBody.innerHTML = `<p class="subtle">${zh ? '加载工资试算…' : 'Loading payroll…'}</p>`
  Promise.allSettled([
    request(`/admin/salary/estimate?month=${month}`),
    request('/admin/service-notes/pending?days=14'),
    request(`/admin/daily-close/month?month=${month}`)
  ])
    .then(([estRes, pendRes, closeRes]) => {
      if (estRes.status === 'rejected') {
        els.financePayrollBody.innerHTML = `<p class="subtle">${escapeHtml(estRes.reason?.message || '加载失败')}</p>`
        return
      }
      const data = estRes.value
      const rows = data.rows || []
      const locked = Boolean(data.locked)
      const paid = Boolean(data.paid)
      const hasPlanRows = rows.filter((r) => !r.noPlan)
      // 净赚"一实一虚"数据源:工资试算合计缓存给指标卡/AI总结用(替代旧薪酬表的失效计提)
      owner.salaryEstimateCache = { month, totalCents: data.totalCents || 0, paid, locked }
      renderFinanceMetrics()
      renderFinanceProgress()
      // 业绩核查数据:归属备注(estimate 未锁定时返回)+ 近14天完成单未写小记按人汇总
      const reviewedAt = localStorage.getItem(`lucky-salary-review-${month}`)
      // 屏 2:业绩 = 已确认日结累加。没日结的天不进试算,黄条明说少算了哪几天
      const closeInfo = closeRes.status === 'fulfilled' ? closeRes.value : { days: [], openDays: [], allClosed: true }
      const openDays = closeInfo.openDays || []
      const pendItems = pendRes.status === 'fulfilled' ? (pendRes.value.items || []) : []
      const pendByTech = {}
      pendItems.forEach((item) => {
        if (!item.technicianId) return
        if (!pendByTech[item.technicianId]) pendByTech[item.technicianId] = { name: item.technicianName || '技师', count: 0 }
        pendByTech[item.technicianId].count += 1
      })
      const rowHtml = (r) => {
        if (r.noPlan) return `<div class="finance-rule-row disabled"><span><strong>${escapeHtml(r.name)}</strong> · ${zh ? '未配薪资方案(员工管理 →「薪资方案」页签里配,与小程序同步)' : 'No plan'}</span></div>`
        const bits = []
        if (r.baseSalaryCents) bits.push(`${zh ? '底薪' : 'base'} ${cadText(r.baseSalaryCents)}`)
        if (r.handworkCents) bits.push(`${zh ? '手工' : 'hand'} ${cadText(r.handworkCents)}`)
        bits.push(`${zh ? '业绩' : 'perf'} ${cadText(r.perfCents)}×${r.pct || 0}% = ${cadText(r.commissionCents)}`)
        if (r.rechargePayCents) bits.push(`${zh ? '充值提成' : 'recharge'} ${cadText(r.rechargePayCents)}`)
        if (r.cardCents) bits.push(`${zh ? '耗卡提成' : 'card'} ${cadText(r.cardCents)}`)
        if (r.overtimePayCents) bits.push(`${zh ? '加班' : 'OT'} ${cadText(r.overtimePayCents)}`)
        if (r.adjustCents) bits.push(`${zh ? '调整' : 'adj'} ${cadText(r.adjustCents)}(${escapeHtml(r.adjustNote || '')})`)
        return `<div class="finance-rule-row">
          <span><strong>${escapeHtml(r.name)}</strong> · ${bits.join(' + ')} = <strong>${cadText(r.totalCents)}</strong></span>
          ${!locked ? `<button class="ghost slim" data-sal-adjust="${escapeHtml(r.technicianId)}" data-sal-name="${escapeHtml(r.name)}" type="button">± ${zh ? '调整' : 'Adjust'}</button>` : ''}
        </div>`
      }
      const reviewHtml = locked ? '' : `
        <div style="margin:12px 0;padding:10px 12px;border:1px solid #eadfce;border-radius:10px">
          <p class="subtle" style="margin:0 0 6px"><strong>${zh ? '② 业绩核查' : '② Performance review'}</strong>${reviewedAt ? ` · ✅ ${zh ? '已核查' : 'reviewed'} ${String(reviewedAt).slice(0, 16).replace('T', ' ')}` : ''}</p>
          ${Object.keys(pendByTech).length ? `
          <p class="subtle" style="margin:6px 0 0">${zh ? '近14天完成单还没写服务小记:' : 'Missing service notes (last 14 days):'}</p>
          ${Object.entries(pendByTech).map(([techId, info]) => `
          <div class="finance-rule-row">
            <span><strong>${escapeHtml(info.name)}</strong> · ${info.count} ${zh ? '单未写小记' : 'orders without notes'}</span>
            <button class="ghost slim" data-review-nudge="${escapeHtml(techId)}" data-review-name="${escapeHtml(info.name)}" type="button">${zh ? '提醒TA' : 'Nudge'}</button>
          </div>`).join('')}` : ''}
          ${reviewedAt
            ? `<button class="ghost slim" data-sal-review-undo type="button">${zh ? '撤销核查' : 'Undo review'}</button>`
            : `<button class="primary slim" data-sal-review type="button">✓ ${zh ? `完成 ${month} 业绩核查` : `Mark ${month} reviewed`}</button> <span class="subtle">${zh ? '核查完成后才能锁定工资表' : 'Required before locking'}</span>`}
        </div>`
      const closeHtml = `
        <div style="margin:0 0 12px;padding:10px 12px;border:1px solid #eadfce;border-radius:10px">
          <p class="subtle" style="margin:0 0 6px"><strong>${zh ? '日结业绩' : 'Daily closes'}</strong>${openDays.length ? ` <span class="dc-badge warn">${openDays.length}</span>` : ''} · ${zh ? '业绩=已确认日结累加' : 'perf = confirmed closes'}</p>
          ${(closeInfo.days || []).length ? (closeInfo.days || []).map((d) => `
          <div class="finance-rule-row">
            <span><strong>${escapeHtml(d.date)}</strong> · ${d.orderCount} ${zh ? '单' : ''} · ${money(d.revenueCents, 2)}${d.pendingAllocation ? ` · ${zh ? `${d.pendingAllocation} 单待分配` : `${d.pendingAllocation} to allocate`}` : (d.confirmed ? '' : ` · ${zh ? '未确认' : 'open'}`)}</span>
            ${d.confirmed
              ? `<span class="dc-badge ok">${zh ? '已日结' : 'Closed'}</span>`
              : `<button class="ghost slim" data-go-close="${escapeHtml(d.date)}" type="button">${zh ? '去日结' : 'Close it'}</button>`}
          </div>`).join('') : `<p class="subtle" style="margin:0">${zh ? '本月还没有已签署的服务单。' : 'No signed sheets yet.'}</p>`}
        </div>
        ${openDays.length
          ? `<div class="dc-warnbar">${zh ? `本月有 <b>${openDays.length} 天</b>未日结,试算暂不含这几天业绩` : `${openDays.length} day(s) not closed; excluded from the estimate`}</div>`
          : ((closeInfo.days || []).length ? '' : `<div class="dc-warnbar">${zh
            ? '本月业绩显示为 0 是正常的:业绩口径已改为「已确认日结累加」,要走完 <b>结算 → 顾客签署 → 日结确认</b> 才会有数。老流程(直接标记完成)不再计入。'
            : 'Zero performance is expected until you run settlement → signature → daily close.'}</div>`)}`
      els.financePayrollBody.innerHTML = `
        ${closeHtml}
        ${paid ? `<p class="subtle">💰 ${zh ? `已发放入账 · ${String(data.paidAt || '').slice(0, 16).replace('T', ' ')} · 账本可查(支出·工资);更正需红字冲销` : 'Paid into ledger'}</p>`
          : locked ? `<p class="subtle">✅ ${zh ? `已锁定存档 · ${String(data.lockedAt || '').slice(0, 16).replace('T', ' ')}` : 'Locked'} <button class="ghost slim" data-sal-unlock type="button">${zh ? '解锁重算' : 'Unlock'}</button></p>`
          : `<p class="subtle" style="margin:0 0 6px"><strong>${zh ? '① 本月试算' : '① Estimate'}</strong> · ${cadText(data.totalCents || 0)}</p>`}
        ${rows.length ? rows.map(rowHtml).join('') : `<p class="subtle">${zh ? '本月暂无技师数据。' : 'No data.'}</p>`}
        ${reviewHtml}
        ${!locked && hasPlanRows.length ? `<button class="primary slim" data-sal-lock type="button"${reviewedAt && !openDays.length ? '' : ' disabled style="opacity:.5"'}>${zh
          ? `③ 确认并锁定 ${month} 工资表${openDays.length ? `(需全部日结完成,还差 ${openDays.length} 天)` : (reviewedAt ? '' : '(先完成上方核查)')}`
          : 'Lock payroll'}</button>` : ''}
        ${locked && !paid ? `<button class="primary slim" data-sal-payout type="button">${zh ? `记为已发放 · 入账本(${cadText(data.totalCents || 0)})` : 'Pay out'}</button>` : ''}
        <p class="subtle">${zh ? '口径与小程序一致:底薪+手工费×单数+业绩落档提成+充值/耗卡提成(按储值流水的经手技师)+加班费(打卡考勤)±调整。方案在 员工管理 →「薪资方案」页签配(与小程序同步);锁定=快照防事后改数;发放=逐人写入账本「支出·工资」。' : 'Same engine as the mini app.'}</p>
      `
      els.financePayrollBody.querySelectorAll('[data-sal-adjust]').forEach((btn) => btn.addEventListener('click', async () => {
        const tid = btn.dataset.salAdjust
        const v = prompt(zh ? `调整 ${btn.dataset.salName} 的工资:金额$(可负,如 50 或 -20)` : 'Adjust amount $')
        if (v === null) return
        const n = Number(v)
        if (!Number.isFinite(n) || n === 0) { toast(zh ? '金额无效' : 'Invalid amount'); return }
        const note = prompt(zh ? '调整备注(必填,如:代班补贴 / 迟到扣款)' : 'Note (required)')
        if (!note || !note.trim()) { toast(zh ? '备注必填' : 'Note required'); return }
        try {
          await request('/admin/salary/adjust', { method: 'PUT', body: JSON.stringify({ month, technicianId: tid, adjustCents: Math.round(n * 100), note: note.trim() }) })
          toast(zh ? '已调整' : 'Adjusted'); renderFinancePayroll()
        } catch (error) { toast(error.message) }
      }))
      const lockBtn = els.financePayrollBody.querySelector('[data-sal-lock]')
      if (lockBtn) lockBtn.addEventListener('click', async () => {
        // 2026-08-02 核查门槛(店主定):先点上方「✓ 完成业绩核查」才能锁定(按钮未核查时本就 disabled,这里兜底)
        if (!localStorage.getItem(`lucky-salary-review-${month}`)) {
          toast(zh ? '请先完成上方「② 业绩核查」再锁定' : 'Complete the performance review above first')
          return
        }
        if (!confirm(zh ? `按当前数字锁定 ${month} 工资表?锁定后业绩/考勤变动不影响本月工资。` : 'Lock payroll?')) return
        try { await request('/admin/salary/lock', { method: 'POST', body: JSON.stringify({ month }) }); toast(zh ? '已锁定存档' : 'Locked'); renderFinancePayroll() } catch (error) { toast(error.message) }
      })
      els.financePayrollBody.querySelector('[data-sal-review]')?.addEventListener('click', () => {
        const warn = notes.length
          ? (zh ? `本月有 ${notes.length} 条归属备注,确认都已核对(需要修正的已用「± 调整」处理)?` : `${notes.length} attribution notes — all verified?`)
          : (zh ? `确认完成 ${month} 业绩核查?` : `Mark ${month} as reviewed?`)
        if (!confirm(warn)) return
        localStorage.setItem(`lucky-salary-review-${month}`, new Date().toISOString())
        toast(zh ? '核查完成,可以锁定工资表了' : 'Reviewed — you can lock now')
        renderFinancePayroll()
      })
      els.financePayrollBody.querySelector('[data-sal-review-undo]')?.addEventListener('click', () => {
        localStorage.removeItem(`lucky-salary-review-${month}`)
        renderFinancePayroll()
      })
      els.financePayrollBody.querySelectorAll('[data-review-nudge]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          await request('/admin/staff-nudges', { method: 'POST', body: JSON.stringify({
            technicianId: btn.dataset.reviewNudge,
            type: 'service-note',
            message: zh ? '你有已完成的订单还没写服务小记,记得在小程序里补一下哦~' : 'You have completed orders missing service notes — please add them in the mini app.'
          }) })
          toast(zh ? `已提醒 ${btn.dataset.reviewName}(员工小程序主页会显示横幅)` : 'Nudged')
        } catch (error) { toast(error.message) }
      }))
      const unlockBtn = els.financePayrollBody.querySelector('[data-sal-unlock]')
      if (unlockBtn) unlockBtn.addEventListener('click', async () => {
        if (!confirm(zh ? `删除 ${month} 锁定存档,回到实时试算?` : 'Unlock?')) return
        try { await request('/admin/salary/unlock', { method: 'POST', body: JSON.stringify({ month }) }); toast(zh ? '已解锁' : 'Unlocked'); renderFinancePayroll() } catch (error) { toast(error.message) }
      })
      const payoutBtn = els.financePayrollBody.querySelector('[data-sal-payout]')
      if (payoutBtn) payoutBtn.addEventListener('click', async () => {
        if (!confirm(zh ? `确认发放 ${month} 工资?将按锁定工资表逐人写入账本(支出·工资),入账后不可解锁,发错需红字冲销。` : 'Pay out into ledger?')) return
        try {
          const r = await request('/admin/salary/payout', { method: 'POST', body: JSON.stringify({ month }) })
          toast(zh ? `已入账 ${r.count} 人` : 'Paid'); renderFinancePayroll(); loadFinancePage()
        } catch (error) { toast(error.message) }
      })
    })
    .catch((error) => { els.financePayrollBody.innerHTML = `<p class="subtle">${escapeHtml(error.message || '加载失败')}</p>` })
}

function renderAttendanceBoard() {
  // 2026-08-02 考勤看板(员工管理→技师业绩):与员工小程序打卡同一套 /admin/attendance API;修正/补卡不涉账
  if (!els.attendanceBody || !isOwnerRole()) return
  const zh = owner.lang === 'zh'
  els.attendanceBody.innerHTML = `<p class="subtle">${zh ? '加载今日考勤…' : 'Loading attendance…'}</p>`
  request('/admin/attendance/today')
    .then((data) => {
      const rows = data.rows || []
      const stateText = (s) => ({
        working: zh ? '在岗' : 'On duty',
        overtime: zh ? '超时未走' : 'Overtime',
        done: zh ? '已下班' : 'Done',
        rest: zh ? '休息' : 'Rest',
        none: zh ? '未上班' : 'Not in'
      })[s] || s
      const stateColor = { working: '#3f6b52', overtime: '#b0483c', done: '#8a8578', rest: '#a89d8c', none: '#a89d8c' }
      const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}` : `${m}m`
      const rowHtml = (r) => `
        <div class="finance-rule-row${r.state === 'none' || r.state === 'rest' ? ' disabled' : ''}"${r.state === 'overtime' ? ' style="background:#fdf0ee;border-radius:8px"' : ''}>
          <span>
            <strong>${escapeHtml(r.name)}</strong>${r.title ? ` <span class="subtle">${escapeHtml(r.title)}</span>` : ''}
            · <span style="font-weight:700;color:${stateColor[r.state] || '#8a8578'}">${stateText(r.state)}</span>
            ${r.clockIn ? ` · ${r.clockIn}${r.clockOut ? `–${r.clockOut}` : ''}` : ''}
            ${r.workedMin ? ` · ${zh ? '已工作' : 'worked'} ${fmtMin(r.workedMin)}` : ''}
            ${r.overtimeMin > 0 ? ` · <strong style="color:#b0483c">${zh ? '加班' : 'OT'} ${fmtMin(r.overtimeMin)}</strong>` : ''}
            ${r.adjusted ? ` · <span class="subtle">${zh ? '已修正' : 'adjusted'}</span>` : ''}
          </span>
          <button class="ghost slim" data-att-fix="${escapeHtml(r.technicianId)}" data-att-record="${escapeHtml(r.recordId || '')}" data-att-name="${escapeHtml(r.name)}" data-att-in="${escapeHtml(r.clockIn || '')}" data-att-out="${escapeHtml(r.clockOut || '')}" type="button">${r.recordId ? (zh ? '修正' : 'Fix') : (zh ? '补卡' : 'Add')}</button>
        </div>`
      els.attendanceBody.innerHTML = `
        <div class="finance-metrics" style="margin-bottom:10px">
          ${[[zh ? '在岗' : 'On duty', data.working || 0, 'good'], [zh ? '已下班' : 'Done', data.done || 0, ''], [zh ? '超时未走' : 'Overtime', data.overtime || 0, data.overtime ? 'bad' : '']]
            .map(([label, v, tone]) => `<div class="finance-metric ${tone}"><span>${label}</span><strong>${v}</strong></div>`).join('')}
        </div>
        <p class="subtle">${escapeHtml(data.date || '')} · ${zh ? '门店现在' : 'store time'} ${escapeHtml(data.storeNow || '')} <button class="ghost slim" data-att-refresh type="button">${zh ? '↻ 刷新' : '↻ Refresh'}</button></p>
        ${rows.length ? rows.map(rowHtml).join('') : `<p class="subtle">${zh ? '暂无在职技师。' : 'No active technicians.'}</p>`}
        <p class="subtle">${zh
          ? '打卡在员工小程序端(需连店内 WiFi 验证);这里可修正时刻或补卡,保存后自动重算加班,计入工资加班费。「设打卡 WiFi」需真机读取 WiFi 信息,请在小程序 管理→考勤 里操作。'
          : 'Clock-in/out happens in the staff mini app (WiFi-verified). Fix times or add missing records here; overtime recalculates automatically.'}</p>
      `
      els.attendanceBody.querySelector('[data-att-refresh]')?.addEventListener('click', () => renderAttendanceBoard())
      els.attendanceBody.querySelectorAll('[data-att-fix]').forEach((btn) => btn.addEventListener('click', async () => {
        const recId = btn.dataset.attRecord
        const clockIn = prompt(zh ? `${btn.dataset.attName} 上班时刻(HH:mm,24小时制,留空=不改)` : 'Clock-in HH:mm (blank = keep)', btn.dataset.attIn || '')
        if (clockIn === null) return
        const clockOut = prompt(zh ? `${btn.dataset.attName} 下班时刻(HH:mm,留空=不改)` : 'Clock-out HH:mm (blank = keep)', btn.dataset.attOut || '')
        if (clockOut === null) return
        const body = {}
        if (clockIn.trim()) body.clockIn = clockIn.trim()
        if (clockOut.trim()) body.clockOut = clockOut.trim()
        if (!Object.keys(body).length) { toast(zh ? '没有要修正的内容' : 'Nothing to change'); return }
        if (!/^\d{2}:\d{2}$/.test(body.clockIn || '00:00') || !/^\d{2}:\d{2}$/.test(body.clockOut || '00:00')) {
          toast(zh ? '时刻格式应为 HH:mm,如 09:30' : 'Use HH:mm, e.g. 09:30')
          return
        }
        if (!recId) { body.technicianId = btn.dataset.attFix; body.date = data.date }
        try {
          await request(`/admin/attendance/${recId || 'new'}`, { method: 'PATCH', body: JSON.stringify(body) })
          toast(zh ? '已保存,加班已重算' : 'Saved')
          renderAttendanceBoard()
        } catch (error) { toast(error.message) }
      }))
    })
    .catch((error) => { els.attendanceBody.innerHTML = `<p class="subtle">${escapeHtml(error.message || '加载失败')}</p>` })
}

// 2026-08-02 员工管理页两板块:📅计时排班 / 📈技师业绩(业绩卡+薪资方案+打卡考勤);月度业绩核查已并入 财务→👥员工工资
function applyStaffTab() {
  const tab = owner.staffTab || 'schedule'
  document.querySelectorAll('#schedulePage [data-staff-panel]').forEach((panel) => {
    // 后三个板块都是老板专属(业绩目标/薪资方案/账号管理)
    const ownerOnly = ['attendanceCard', 'perfTargetsCard', 'salaryPlansCard', 'staffAccountsCard'].includes(panel.id)
    panel.classList.toggle('hidden', panel.dataset.staffPanel !== tab || (ownerOnly && !isOwnerRole()))
  })
  // 员工登录时只显示前两个页签
  document.querySelectorAll('#staffTabs [data-staff-tab]').forEach((button) => {
    const ownerOnlyTab = ['targets', 'salary', 'accounts'].includes(button.dataset.staffTab)
    button.classList.toggle('hidden', ownerOnlyTab && !isOwnerRole())
  })
  document.querySelectorAll('#staffTabs [data-staff-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.staffTab === tab)
  })
}

/* 财务密码门禁状态(商家自助,店主 2026-08-08 拍板):默认关闭,老板自己开/关/改密。 */
let financeLockState = { enabled: undefined, configured: false }

/* ===== P2.5 技师业绩可视化(设计图 V1,2026-08-08)=====
   排行与目标进度都读 /admin/perf-ranking —— 后端那边与工资试算是同一个函数,
   两处数字逐分一致(测试里有断言)。前端只负责画,条宽用后端给的 barPct。
   设计图硬性要求:**金额在条外右列,进度条里不压任何文字**。 */
let perfRankState = { metric: 'perf', period: 'month', data: null, loading: false }

async function loadPerfRanking() {
  perfRankState.loading = true
  renderPerfRanking()
  const res = await request(`/admin/perf-ranking?metric=${perfRankState.metric}&period=${perfRankState.period}`)
  perfRankState.data = res.ranking
  perfRankState.loading = false
  renderPerfRanking()
}

function renderPerfRanking() {
  const body = document.querySelector('#perfRankBody')
  const prog = document.querySelector('#perfProgBody')
  if (!body || !prog) return
  const zh = owner.lang === 'zh'
  document.querySelectorAll('#perfRankMetric [data-rank-metric]').forEach((b) => b.classList.toggle('on', b.dataset.rankMetric === perfRankState.metric))
  document.querySelectorAll('#perfRankPeriod [data-rank-period]').forEach((b) => b.classList.toggle('on', b.dataset.rankPeriod === perfRankState.period))
  if (perfRankState.loading) { body.innerHTML = `<p class="subtle">${zh ? '加载中…' : 'Loading…'}</p>`; return }
  const d = perfRankState.data
  if (!d) { body.innerHTML = ''; prog.innerHTML = ''; return }

  const title = document.querySelector('#perfRankTitle')
  if (title) title.textContent = `${zh ? '业绩排行' : 'Ranking'} · ${d.key}`
  const valueText = (r) => (d.metric === 'orders'
    ? `${r.orderCount} ${zh ? '单' : ''}`
    : money(d.metric === 'recharge' ? r.rechargeCents : r.perfCents, 2))

  body.innerHTML = d.ranking.length ? d.ranking.map((r) => `
    <div class="rankrow">
      <span class="no ${r.rank <= 2 ? 'top' : ''}">${r.rank}</span>
      <span class="who">${escapeHtml(r.name)}<small>${escapeHtml(r.title || (zh ? '技师' : 'Tech'))} · ${r.orderCount} ${zh ? '单' : ''}</small></span>
      <span class="barwrap"><i style="width:${r.barPct}%"></i></span>
      <span class="amt">${valueText(r)}</span>
      <span class="meta">${zh ? '卡耗' : 'Card'} ${money(r.cardUsedCents, 2)} · ${zh ? '冲卡' : 'Recharge'} ${money(r.rechargeCents, 2)}</span>
    </div>`).join('') : `<p class="subtle">${zh ? '本店还没有已确认的日结,排行是空的。' : 'No confirmed daily closes yet.'}</p>`

  // 目标进度只在月维度有意义;日维度后端不下发 target,这里整块提示一句
  prog.innerHTML = d.period !== 'month'
    ? `<p class="subtle">${zh ? '目标按月设置,切到「本月」看进度。' : 'Targets are monthly.'}</p>`
    : (d.targets.length ? d.targets.map((t) => (t.target ? `
      <div class="progrow">
        <span class="nm">${escapeHtml(t.name)}</span>
        <span class="pbar"><i class="${t.target.hit ? 'done' : ''}" style="width:${Math.min(100, t.target.pct)}%"></i></span>
        <span class="pct"><b>${money(t.perfCents, 2)}</b> / ${money(t.target.perfTargetCents, 2)}</span>
        <span class="pct">${t.target.hit ? `<span class="dc-badge ok">${zh ? '已达标' : 'Hit'}</span>` : `<b>${t.target.pct}%</b>`}</span>
      </div>` : `
      <div class="progrow">
        <span class="nm">${escapeHtml(t.name)}</span>
        <span class="tag-none" style="grid-column:span 3">${zh ? '未设目标 · 去「业绩目标」页签设置' : 'No target set'}</span>
      </div>`)).join('') : '')
}

/* ===== P2.5 财务密码卡(设计图 V4)=====
   两态:未启用(默认)/ 已启用。开启要设新密码并确认两次;
   关闭与改密都要验当前密码 —— 后端也拦一道(不是只靠前端自觉)。
   忘记密码走平台重置,文案写明。 */
async function loadFinanceLockSettings() {
  const res = await request('/admin/finance/lock-settings')
  financeLockState = { enabled: Boolean(res.enabled), configured: Boolean(res.configured) }
  owner.financeLedger.lockEnabled = financeLockState.enabled
  renderFinanceLockSettings()
}

function renderFinanceLockSettings() {
  const body = document.querySelector('#financeLockBody')
  if (!body) return
  const zh = owner.lang === 'zh'
  const summary = document.querySelector('#financeLockSummary')
  const on = financeLockState.enabled === true
  if (summary) {
    summary.textContent = financeLockState.enabled === undefined ? ''
      : (on ? (zh ? '已启用' : 'On') : (zh ? '未启用(默认)' : 'Off (default)'))
  }
  body.innerHTML = `
    <p class="subtle" style="margin:0 0 8px">${on
      ? (zh ? '关闭或修改都需验证当前密码。' : 'Changing or disabling requires the current password.')
      : (zh ? '开启后,进入财务板块需输入财务密码。' : 'When on, opening Finance requires a password.')}</p>
    <div class="dep-sw"><span>${zh ? '启用财务密码' : 'Require finance password'}</span>
      <button class="sw" type="button" id="finLockSw" role="switch" aria-checked="${on ? 'true' : 'false'}"><i></i></button></div>
    ${on ? `<div class="dep-inline">
      <label>${zh ? '当前密码' : 'Current password'}<input id="finLockCurrent" type="password" autocomplete="current-password"></label>
    </div>` : ''}
    <div id="finLockPwd" class="${on ? '' : 'hidden'}">
      <div class="dep-inline">
        <label>${on ? (zh ? '新密码(不改就留空)' : 'New password (blank = keep)') : (zh ? '设置密码' : 'Set password')}
          <input id="finLockPass" type="password" autocomplete="new-password"></label>
        <label>${zh ? '再输一次' : 'Confirm'}<input id="finLockPass2" type="password" autocomplete="new-password"></label>
      </div>
    </div>
    <button class="primary slim" id="finLockSave" type="button" style="margin-top:10px">${zh ? '保存' : 'Save'}</button>
    <p class="subtle">${zh
      ? '默认不开,这一项由你自己管,不需要联系平台。忘记密码?联系平台重置(会下发一次性新密码,登录后请立即修改)。'
      : 'Off by default and self-managed. Forgot it? Contact the platform to reset.'}</p>`
}

/* ===== P2② 员工管理五页签(屏 4d,2026-08-08)=====
   计时排班｜技师业绩｜业绩目标｜薪资方案｜账号管理。页签按使用频率排,一律纯文字无 emoji。
   薪资方案编辑从「财务区」迁到这里(工资试算仍留财务)。 */
let perfTargetsState = { month: '', rows: [], loading: false }

function shiftMonthKey(month, delta) {
  const [y, m] = String(month || '').split('-').map(Number)
  if (!y || !m) return month
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

async function loadPerfTargets(month) {
  const target = month || perfTargetsState.month || storeToday().slice(0, 7)
  perfTargetsState.loading = true
  renderPerfTargets()
  const data = await request(`/admin/perf-targets?month=${encodeURIComponent(target)}`)
  perfTargetsState = { month: data.month, rows: data.technicians || [], loading: false }
  renderPerfTargets()
}

function renderPerfTargets() {
  const body = document.querySelector('#perfTargetsBody')
  if (!body) return
  const zh = owner.lang === 'zh'
  const monthEl = document.querySelector('#perfTargetsMonth')
  if (monthEl) monthEl.textContent = perfTargetsState.month || ''
  if (perfTargetsState.loading) { body.innerHTML = `<p class="subtle">${zh ? '加载中…' : 'Loading…'}</p>`; return }
  if (!perfTargetsState.rows.length) { body.innerHTML = `<p class="subtle">${zh ? '本店还没有技师。' : 'No technicians yet.'}</p>`; return }
  const seg = (techId, group, options, current) => `
    <span class="seg2" data-seg-group="${group}" data-seg-tech="${escapeHtml(techId)}">
      ${options.map(([v, l]) => `<button type="button" class="${v === current ? 'on' : ''}" data-seg-value="${v}">${l}</button>`).join('')}
    </span>`
  body.innerHTML = perfTargetsState.rows.map((r) => `
    <div class="trow2" data-target-row="${escapeHtml(r.technicianId)}">
      <span class="nm">${escapeHtml(r.name)}</span>
      <span class="lab">${zh ? '设置' : 'Target'}</span>
      ${seg(r.technicianId, 'mode', [['total', zh ? '总目标' : 'Total'], ['split', zh ? '分项' : 'Split']], r.mode)}
      <span class="tgt-fields" data-mode="${r.mode}">
        <label>${zh ? '业绩' : 'Revenue'}<input data-tgt="perf" inputmode="decimal" value="${r.perfTargetCents / 100}"></label>
        <label class="split-only">${zh ? '卡耗' : 'Card'}<input data-tgt="card" inputmode="decimal" value="${r.cardTargetCents / 100}"></label>
        <label class="split-only">${zh ? '单量' : 'Orders'}<input data-tgt="orders" inputmode="numeric" value="${r.orderTarget}"></label>
      </span>
      <span class="lab">${zh ? '显示' : 'Show'}</span>
      ${seg(r.technicianId, 'display', [['total_only', zh ? '仅总进度' : 'Total only'], ['with_split', zh ? '含分项' : 'With split']], r.displayMode)}
    </div>`).join('')
    + `<p class="subtle" style="margin-top:10px">${zh
      ? '系统默认:设置=总目标、显示=仅总进度。显示=仅总进度时,员工端整页(含每日流水)不出现分项来源。'
      : 'Defaults: total target, total-only display.'}</p>`
}

// 元 → 分。业绩目标面板在文件里排在价目表模块之前,不能用那边的 pCents(const 暂时性死区)
function yuanToCents(v) {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function collectPerfTargets() {
  return [...document.querySelectorAll('#perfTargetsBody [data-target-row]')].map((row) => {
    const val = (k) => row.querySelector(`[data-tgt="${k}"]`)?.value
    const segOf = (g) => row.querySelector(`[data-seg-group="${g}"] .on`)?.dataset.segValue
    return {
      technicianId: row.dataset.targetRow,
      mode: segOf('mode') || 'total',
      displayMode: segOf('display') || 'total_only',
      perfTargetCents: yuanToCents(val('perf')),
      cardTargetCents: yuanToCents(val('card')),
      orderTarget: Number(val('orders')) || 0
    }
  })
}

// 薪资方案板块:每人一行(模板名 + 入口),点开就是既有的编辑器
async function loadSalaryPlansPanel() {
  const body = document.querySelector('#salaryPlansBody')
  if (!body) return
  const zh = owner.lang === 'zh'
  body.innerHTML = `<p class="subtle">${zh ? '加载中…' : 'Loading…'}</p>`
  const data = await request('/admin/salary-plans')
  const byTech = {}
  for (const p of data.plans || []) byTech[p.technicianId] = p
  const label = (plan) => {
    if (!plan) return zh ? '按全店默认' : 'Store default'
    const mode = plan.mode || 'ladder'
    return mode === 'fixed' ? (zh ? '底薪+固定提成' : 'Fixed')
      : (mode === 'custom' ? (zh ? '自定义' : 'Custom')
        : `${zh ? '底薪+阶梯' : 'Ladder'}(${plan.ladderMode === 'progressive' ? (zh ? '阶梯' : 'progressive') : (zh ? '阶段' : 'whole')})`)
  }
  const rows = (owner.technicians || []).filter((t) => t.is_active !== 0 && t.is_active !== false)
  body.innerHTML = `
    <div class="trow2">
      <span class="nm">${zh ? '全店默认' : 'Store default'}</span>
      <span class="lab">${escapeHtml(label(data.defaultPlan))}</span>
      <button class="ghost slim" data-sp-plan="" data-sp-name="${zh ? '全店默认' : 'Store default'}" type="button">${zh ? '编辑' : 'Edit'}</button>
    </div>
    ${rows.map((t) => `
    <div class="trow2">
      <span class="nm">${escapeHtml(t.name)}</span>
      <span class="lab">${escapeHtml(label(byTech[t.id]))}</span>
      <button class="ghost slim" data-sp-plan="${escapeHtml(t.id)}" data-sp-name="${escapeHtml(t.name)}" type="button">${zh ? '编辑' : 'Edit'}</button>
    </div>`).join('')}
    <p class="subtle" style="margin-top:10px">${zh ? '工资试算仍在 财务 → 员工工资;这里只配方案。' : 'Payroll estimate stays under Finance.'}</p>`
}

// 账号管理板块:每人一行行内按钮(生成 / 重置密码 / 停用启用)
async function loadStaffAccountsPanel() {
  const body = document.querySelector('#staffAccountsBody')
  if (!body) return
  const zh = owner.lang === 'zh'
  body.innerHTML = `<p class="subtle">${zh ? '加载中…' : 'Loading…'}</p>`
  await refreshStaffAccounts()
  const rows = (owner.technicians || [])
  body.innerHTML = rows.map((t) => {
    const inactive = t.is_active === 0 || t.is_active === false
    return `
    <div class="trow2">
      <span class="nm">${escapeHtml(t.name)}${inactive ? `<span class="tech-inactive-tag">${zh ? '已停用' : 'Inactive'}</span>` : ''}</span>
      <span class="acct-controls">${renderTechAccountControls(t.id, zh)}</span>
    </div>`
  }).join('')
    + `<p class="subtle" style="margin-top:10px">${zh ? '初始密码只显示一次,复制后发给员工;员工首次登录会被要求改密。' : 'Initial password is shown once.'}</p>`
}

// 2026-08-02 薪资方案配置(固定/浮动绩效)——入口在 员工管理→技师业绩,与小程序 员工管理→薪资方案 同逻辑同字段(/admin/salary-plans)
let salaryPlanEditing = null // null=列表;{techId,name}=编辑中(techId 空串=全店默认)

function openSalaryPlanPanel(techId, name) {
  // techId == null → 列表总览;'' → 直接编辑全店默认;技师id → 直接编辑该技师
  const zh = owner.lang === 'zh'
  const existing = document.querySelector('.cs-lightbox')
  if (existing) existing.remove()
  const overlay = document.createElement('div')
  overlay.className = 'cs-lightbox'
  const panel = document.createElement('div')
  panel.className = 'fin-guide-panel'
  panel.innerHTML = `
    <div class="fin-guide-head">
      <strong>💰 ${zh ? '薪资方案(固定/浮动绩效)' : 'Salary Plans'}</strong>
      <button class="ghost slim" data-sp-close type="button">${zh ? '关闭' : 'Close'}</button>
    </div>
    <div id="salaryPlanPanelBody"></div>
  `
  panel.addEventListener('click', (event) => {
    event.stopPropagation()
    if (event.target.closest('[data-sp-close]')) overlay.remove()
  })
  overlay.addEventListener('click', () => overlay.remove())
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
  salaryPlanEditing = techId == null ? null : { techId, name: name || '' }
  if (salaryPlanEditing) renderSalaryPlanEditor()
  else renderSalaryPlans()
}
const SP_TPL_TEXT = {
  commission: ['纯提成', 'Commission only'],
  base_ladder: ['底薪+阶梯提成(浮动绩效)', 'Base + tiered %'],
  base_flat: ['底薪+固定提成', 'Base + flat %']
}
function spPlanBrief(p, zh) {
  const bits = [SP_TPL_TEXT[p.template] ? SP_TPL_TEXT[p.template][zh ? 0 : 1] : p.template]
  if (p.baseSalaryCents) bits.push(`${zh ? '底薪' : 'base'} ${cadText(p.baseSalaryCents)}`)
  if (p.template === 'base_ladder') bits.push(`${(p.ladder || []).length} ${zh ? '档' : 'tiers'}`)
  else if (p.flatPct) bits.push(`${p.flatPct}%`)
  return bits.join(' · ')
}

function renderSalaryPlans() {
  const body = document.querySelector('#salaryPlanPanelBody')
  if (!body) return
  const zh = owner.lang === 'zh'
  if (salaryPlanEditing) { renderSalaryPlanEditor(); return }
  body.innerHTML = `<p class="subtle">${zh ? '加载薪资方案…' : 'Loading plans…'}</p>`
  request('/admin/salary-plans')
    .then((data) => {
      if (!document.body.contains(body)) return // 面板已被关闭
      const dft = data.defaultPlan
      const customs = data.plans || []
      const byTech = {}; customs.forEach((p) => { byTech[p.technicianId] = p })
      const activeTechs = (owner.technicians || []).filter((t2) => !(t2.is_active === 0 || t2.is_active === false))
      body.innerHTML = `
        <div class="finance-rule-row">
          <span><strong>${zh ? '全店默认方案' : 'Store default'}</strong> · ${dft ? spPlanBrief(dft, zh) : `<span class="subtle">${zh ? '未设置(无方案的员工不参与工资试算)' : 'Not set'}</span>`}</span>
          <button class="ghost slim" data-sp-edit="" data-sp-name="${zh ? '全店默认' : 'Store default'}" type="button">${dft ? (zh ? '编辑' : 'Edit') : (zh ? '设置' : 'Set up')}</button>
        </div>
        ${activeTechs.map((t2) => { const p = byTech[t2.id]; return `
          <div class="finance-rule-row">
            <span><strong>${escapeHtml(t2.name)}</strong> · ${p ? `${zh ? '专属:' : 'Custom: '}${spPlanBrief(p, zh)}` : `<span class="subtle">${zh ? '跟随全店默认' : 'Follows default'}</span>`}</span>
            <span>
              <button class="ghost slim" data-sp-edit="${escapeHtml(t2.id)}" data-sp-name="${escapeHtml(t2.name)}" type="button">${p ? (zh ? '编辑专属' : 'Edit') : (zh ? '设专属' : 'Override')}</button>
              ${p ? `<button class="ghost slim" data-sp-reset="${escapeHtml(t2.id)}" data-sp-name="${escapeHtml(t2.name)}" type="button">${zh ? '恢复默认' : 'Reset'}</button>` : ''}
            </span>
          </div>`}).join('')}
        <p class="subtle">${zh
          ? '与小程序 员工管理→薪资方案 同一套配置,保存立即生效,当月试算自动按新方案。「底薪+阶梯」=浮动绩效:月业绩落到哪档整月按该档提成%;「底薪+固定提成」=固定绩效。'
          : 'Same engine as the mini app. Tiered = floating commission by monthly performance; flat = fixed %.'}</p>
      `
      body.querySelectorAll('[data-sp-edit]').forEach((btn) => btn.addEventListener('click', () => {
        salaryPlanEditing = { techId: btn.dataset.spEdit, name: btn.dataset.spName }
        renderSalaryPlanEditor()
      }))
      body.querySelectorAll('[data-sp-reset]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!confirm(zh ? `删除 ${btn.dataset.spName} 的专属方案,改为跟随全店默认?` : 'Delete this override and follow store default?')) return
        try {
          await request(`/admin/salary-plans/${btn.dataset.spReset}`, { method: 'DELETE' })
          toast(zh ? '已恢复跟随默认' : 'Reset to default')
          renderSalaryPlans()
          if (owner.financeKey) renderFinancePayroll() // 财务页已解锁时同步刷新试算
        } catch (error) { toast(error.message) }
      }))
    })
    .catch((error) => { if (document.body.contains(body)) body.innerHTML = `<p class="subtle">${escapeHtml(error.message || '加载失败')}</p>` })
}

/* 屏 3a｜商家后台 · 薪资方案(网页版)· 三模板三状态(2026-08-09 按设计图重做)
   与小程序 3b/3c 同一套字段:三段选 阶段|阶梯|自定义 →(template, ladderMode);
   基础项开关化;卡提成只有 首充/续卡/自定义行 —— 耗卡不设提成,卡耗计入业绩。
   两模式对比常驻显示,三个数都由后端 /admin/salary-plans/preview 算,前端不算钱。 */
const SP_PREVIEW_PERF_CENTS = 1200000 // 图上的算例:业绩 ¥12,000

function renderSalaryPlanEditor() {
  const zh = owner.lang === 'zh'
  const ed = salaryPlanEditing
  if (!ed) { renderSalaryPlans(); return }
  const body = document.querySelector('#salaryPlanPanelBody')
  if (!body) return
  body.innerHTML = `<p class="subtle">${zh ? '加载方案…' : 'Loading…'}</p>`
  request(`/admin/salary-plans/effective?technicianId=${encodeURIComponent(ed.techId)}`)
    .then((r) => {
      if (!document.body.contains(body)) return // 面板已被关闭
      const seed = r.plan || {}
      const c2y = (c) => c ? String(Math.round(c) / 100) : ''
      const y2c = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0 }
      // 三段选是 (template, ladderMode) 的投影;老的 commission(纯提成)= 自定义 + 底薪开关关闭
      const st = {
        mode: (seed.template || 'base_ladder') === 'base_ladder'
          ? (seed.ladderMode === 'progressive' ? 'progressive' : 'whole')
          : 'flat',
        enableBase: seed.template === 'commission' ? false : seed.enableBase !== false,
        enableHandwork: seed.enableHandwork !== false,
        enableOvertime: seed.enableOvertime !== false,
        custom: (seed.customCommissions || []).map((c) => ({ name: c.name || '', pct: String(c.pct || 0) }))
      }
      let ladder = (seed.ladder && seed.ladder.length
        ? seed.ladder
        : [{ minCents: 0, maxCents: 800000, pct: 10 }, { minCents: 800000, maxCents: 1500000, pct: 12 }, { minCents: 1500000, maxCents: null, pct: 15 }])
        .map((t2) => ({ min: c2y(t2.minCents) || '0', max: t2.maxCents == null ? '' : c2y(t2.maxCents), pct: String(t2.pct || 0) }))

      body.innerHTML = `
        <p class="subtle"><strong>${zh ? '编辑:' : 'Editing: '}${escapeHtml(ed.name || '')}</strong>${ed.techId && r.source !== 'custom' ? `(${zh ? '当前跟随默认,保存后变为专属方案' : 'currently follows default; saving creates an override'})` : ''}</p>

        <div class="sp-modes" id="spModes">
          <button class="sp-mode${st.mode === 'whole' ? ' on' : ''}" data-sp-mode="whole" type="button">
            <b>${zh ? '模板:阶段' : 'Whole'}</b><span>${zh ? '落档 · 全额乘该档点位' : 'pick tier, apply to all'}</span></button>
          <button class="sp-mode${st.mode === 'progressive' ? ' on' : ''}" data-sp-mode="progressive" type="button">
            <b>${zh ? '模板:阶梯' : 'Progressive'}</b><span>${zh ? '超额累进 · 分段各乘各档' : 'marginal by bracket'}</span></button>
          <button class="sp-mode${st.mode === 'flat' ? ' on' : ''}" data-sp-mode="flat" type="button">
            <b>${zh ? '模板:自定义' : 'Flat'}</b><span>${zh ? '固定提点 · 自由组合' : 'flat rate'}</span></button>
        </div>

        <div id="spLadderWrap">
          <p class="subtle" style="margin:8px 0 4px" id="spLadderHint"></p>
          <div id="spLadderRows"></div>
          <button class="ghost slim" id="spAddTier" type="button">＋ ${zh ? '加档' : 'Add tier'}</button>
        </div>
        <div id="spFlatWrap" class="finance-quick-grid">
          <label><span>${zh ? '业绩固定提点 %' : 'Flat %'}</span><input id="spFlatPct" type="number" min="0" max="100" value="${seed.flatPct || ''}"></label>
          <p class="subtle" style="align-self:end">${zh ? '不分档;基础项/卡提成开关照常可配' : 'No tiers; base & card switches still apply'}</p>
        </div>

        <div class="sp-compare" id="spCompare"><span class="subtle">${zh ? '试算中…' : 'Calculating…'}</span></div>

        <h4 class="sp-h">${zh ? '基础项' : 'Base items'} <span class="subtle">${zh ? '关闭或 0 = 不启用' : 'off or 0 = disabled'}</span></h4>
        <div class="sp-switch-row">
          <label class="sp-sw"><input type="checkbox" id="spEnBase" ${st.enableBase ? 'checked' : ''}> ${zh ? '底薪' : 'Base'}</label>
          <input id="spBase" type="number" min="0" step="50" placeholder="${zh ? '月底薪' : 'per month'}" value="${c2y(seed.baseSalaryCents)}">
        </div>
        <div class="sp-switch-row">
          <label class="sp-sw"><input type="checkbox" id="spEnHandwork" ${st.enableHandwork ? 'checked' : ''}> ${zh ? '手工费(每单固定)' : 'Handwork'}</label>
          <input id="spHandwork" type="number" min="0" step="0.5" placeholder="${zh ? '每单' : 'per order'}" value="${c2y(seed.handworkFeeCents)}">
        </div>
        <div class="sp-switch-row">
          <label class="sp-sw"><input type="checkbox" id="spEnOt" ${st.enableOvertime ? 'checked' : ''}> ${zh ? '加班费' : 'Overtime'}</label>
          <input id="spOtRate" type="number" min="0" step="0.5" placeholder="${zh ? '费率' : 'rate'}" value="${c2y(seed.overtimeRateCents)}">
          <select id="spOtUnit">
            <option value="30" ${seed.overtimeUnitMin === 60 ? '' : 'selected'}>${zh ? '每满30分钟' : 'per 30 min'}</option>
            <option value="60" ${seed.overtimeUnitMin === 60 ? 'selected' : ''}>${zh ? '每满1小时' : 'per 60 min'}</option>
          </select>
        </div>

        <h4 class="sp-h">${zh ? '卡提成' : 'Card commission'} <span class="subtle">${zh ? '填 0 = 不启用' : '0 = disabled'}</span></h4>
        <div class="finance-quick-grid">
          <label><span>${zh ? '首充提成 %' : 'First recharge %'}</span><input id="spFirstPct" type="number" min="0" max="100" value="${seed.firstRechargePct || ''}"></label>
          <label><span>${zh ? '续卡提成 %' : 'Renew %'}</span><input id="spRenewPct" type="number" min="0" max="100" value="${seed.renewRechargePct || ''}"></label>
        </div>
        <div id="spCustomRows"></div>
        <button class="ghost slim" id="spAddCustom" type="button">＋ ${zh ? '加一行(名称 + 比例 + 可选关联卡种)' : 'Add row'}</button>
        <p class="subtle" style="margin:6px 0 0">${zh ? '耗卡不设提成——卡耗计入业绩' : 'No commission on card usage; it counts as performance'}</p>

        <div style="margin-top:14px">
          <button class="primary slim" id="spSave" type="button">${zh ? '保存方案' : 'Save plan'}</button>
          <button class="ghost slim" id="spCancel" type="button">${zh ? '← 返回列表' : '← Back'}</button>
        </div>
      `

      const renderRows = () => {
        const wrap = body.querySelector('#spLadderRows')
        wrap.innerHTML = ladder.map((t2, i) => `
          <div class="finance-rule-add" style="margin-bottom:6px">
            <input data-lad="${i}" data-f="min" type="number" min="0" placeholder="${zh ? '起点' : 'min'}" value="${t2.min}">
            <input data-lad="${i}" data-f="max" type="number" min="0" placeholder="${zh ? '上限(空=不封顶)' : 'max (blank=∞)'}" value="${t2.max}">
            <input data-lad="${i}" data-f="pct" type="number" min="0" max="100" placeholder="%" value="${t2.pct}">
            <button class="ghost slim" data-lad-del="${i}" type="button">✕</button>
          </div>`).join('')
        wrap.querySelectorAll('input[data-lad]').forEach((inp) => inp.addEventListener('input', () => {
          ladder[Number(inp.dataset.lad)][inp.dataset.f] = inp.value
          refreshCompare()
        }))
        wrap.querySelectorAll('[data-lad-del]').forEach((b) => b.addEventListener('click', () => {
          if (ladder.length <= 1) { toast(zh ? '至少留一档' : 'Keep at least one tier'); return }
          ladder.splice(Number(b.dataset.ladDel), 1); renderRows(); refreshCompare()
        }))
      }
      const renderCustom = () => {
        const wrap = body.querySelector('#spCustomRows')
        wrap.innerHTML = st.custom.map((c, i) => `
          <div class="finance-rule-add" style="margin-bottom:6px">
            <input data-cc="${i}" data-f="name" placeholder="${zh ? '名称(如 疗程卡销售)' : 'name'}" value="${escapeHtml(c.name)}">
            <input data-cc="${i}" data-f="pct" type="number" min="0" max="100" placeholder="%" value="${escapeHtml(c.pct)}">
            <button class="ghost slim" data-cc-del="${i}" type="button">✕</button>
          </div>`).join('')
        wrap.querySelectorAll('input[data-cc]').forEach((inp) => inp.addEventListener('input', () => {
          st.custom[Number(inp.dataset.cc)][inp.dataset.f] = inp.value
        }))
        wrap.querySelectorAll('[data-cc-del]').forEach((b) => b.addEventListener('click', () => {
          st.custom.splice(Number(b.dataset.ccDel), 1); renderCustom()
        }))
      }
      // 三模式对比常驻:金额全部由后端算,这里只显示(含「与阶段差 ¥X」)
      let compareTimer = null
      const refreshCompare = () => {
        clearTimeout(compareTimer)
        compareTimer = setTimeout(async () => {
          const boxEl = body.querySelector('#spCompare')
          if (!boxEl) return
          try {
            const p = await request('/admin/salary-plans/preview', { method: 'POST', body: JSON.stringify({
              perfCents: SP_PREVIEW_PERF_CENTS,
              ladder: ladder.map((row) => ({ minCents: y2c(row.min), maxCents: row.max === '' ? null : y2c(row.max), pct: Number(row.pct) || 0 })),
              flatPct: Number(body.querySelector('#spFlatPct')?.value) || 0
            }) })
            const fmt = p.currencyDisplay || { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false }
            const m = (cents) => {
              let text = (Math.round(cents || 0) / 100).toFixed(2)
              if (fmt.trimZeroDecimals) text = text.replace(/\.00$/, '')
              return `${String(fmt.prefix).replace('<CODE>', p.currency)}${fmt.symbol}${text}`
            }
            boxEl.innerHTML = `
              <span class="sp-cmp-lab">${zh ? '试算' : 'Preview'} ${m(p.perfCents)}:</span>
              <span class="sp-cmp${st.mode === 'progressive' ? ' on' : ''}">${zh ? '阶梯' : 'Progressive'} ${m(p.progressive.cents)}</span>
              <span class="sp-cmp${st.mode === 'whole' ? ' on' : ''}">${zh ? '阶段' : 'Whole'} ${m(p.whole.cents)}</span>
              <span class="sp-cmp${st.mode === 'flat' ? ' on' : ''}">${zh ? '自定义' : 'Flat'} ${m(p.flat.cents)}</span>
              ${p.diffCents ? `<span class="sp-cmp-diff">${zh ? '与阶段差' : 'diff'} ${m(Math.abs(p.diffCents))} —— ${zh ? '两模式对比常驻显示' : 'always shown'}</span>` : ''}`
          } catch { boxEl.textContent = '' }
        }, 250)
      }
      const applyMode = () => {
        body.querySelectorAll('[data-sp-mode]').forEach((b) => b.classList.toggle('on', b.dataset.spMode === st.mode))
        const isLadder = st.mode !== 'flat'
        body.querySelector('#spLadderWrap').classList.toggle('hidden', !isLadder)
        body.querySelector('#spFlatWrap').classList.toggle('hidden', isLadder)
        const hint = body.querySelector('#spLadderHint')
        if (hint) {
          hint.textContent = st.mode === 'progressive'
            ? (zh ? '阶梯(超额累进):每一段各乘各档,只有超出的部分按高档算。' : 'Marginal: each bracket at its own rate.')
            : (zh ? '阶段(落档全额):月业绩落在哪一档,整月业绩都按该档点位算。' : 'Whole: the tier you land in applies to the full amount.')
        }
        refreshCompare()
      }
      renderRows(); renderCustom(); applyMode()

      body.querySelectorAll('[data-sp-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.spMode; applyMode() }))
      body.querySelector('#spFlatPct').addEventListener('input', refreshCompare)
      body.querySelector('#spAddTier').addEventListener('click', () => {
        if (ladder.length >= 8) { toast(zh ? '最多 8 档' : 'Max 8 tiers'); return }
        const last = ladder[ladder.length - 1]
        ladder.push({ min: (last && last.max) || '', max: '', pct: '' })
        renderRows(); refreshCompare()
      })
      body.querySelector('#spAddCustom').addEventListener('click', () => {
        if (st.custom.length >= 10) { toast(zh ? '最多 10 行' : 'Max 10 rows'); return }
        st.custom.push({ name: '', pct: '' }); renderCustom()
      })
      body.querySelector('#spCancel').addEventListener('click', () => { salaryPlanEditing = null; renderSalaryPlans() })
      body.querySelector('#spSave').addEventListener('click', async () => {
        const isLadder = st.mode !== 'flat'
        if (isLadder) {
          if (!ladder.length) { toast(zh ? '至少留一档' : 'Need at least one tier'); return }
          for (const row of ladder) {
            if (row.pct === '' || !Number.isFinite(Number(row.pct)) || Number(row.pct) < 0) { toast(zh ? '每档都要填提成 %' : 'Each tier needs a %'); return }
          }
        }
        const enBase = body.querySelector('#spEnBase').checked
        const enHandwork = body.querySelector('#spEnHandwork').checked
        const enOt = body.querySelector('#spEnOt').checked
        try {
          await request('/admin/salary-plans', { method: 'PUT', body: JSON.stringify({
            technicianId: ed.techId,
            template: isLadder ? 'base_ladder' : 'base_flat',
            ladderMode: isLadder ? st.mode : 'whole',
            baseSalaryCents: enBase ? y2c(body.querySelector('#spBase').value) : 0,
            handworkFeeCents: enHandwork ? y2c(body.querySelector('#spHandwork').value) : 0,
            ladder: isLadder ? ladder.map((row) => ({ minCents: y2c(row.min), maxCents: row.max === '' ? null : y2c(row.max), pct: Number(row.pct) || 0 })) : [],
            flatPct: isLadder ? 0 : (Number(body.querySelector('#spFlatPct').value) || 0),
            firstRechargePct: Number(body.querySelector('#spFirstPct').value) || 0,
            renewRechargePct: Number(body.querySelector('#spRenewPct').value) || 0,
            customCommissions: st.custom.filter((c) => Number(c.pct) > 0)
              .map((c) => ({ name: (c.name || '').trim() || '自定义提成', pct: Number(c.pct) || 0 })),
            enableBase: enBase,
            enableHandwork: enHandwork,
            enableOvertime: enOt,
            overtimeRateCents: enOt ? y2c(body.querySelector('#spOtRate').value) : 0,
            overtimeUnitMin: Number(body.querySelector('#spOtUnit').value) === 60 ? 60 : 30
          }) })
          toast(zh ? '已保存,立即生效' : 'Saved')
          salaryPlanEditing = null
          renderSalaryPlans()
          if (owner.financeKey) renderFinancePayroll() // 财务页已解锁时同步刷新试算
        } catch (error) { toast(error.message) }
      })
    })
    .catch((error) => { body.innerHTML = `<p class="subtle">${escapeHtml(error.message || '加载失败')}</p>` })
}

// 2026-08-02 指标卡(店主 v4 定稿):本日收款/本月收入/本月支出/本月净赚(已入账) 四个真数永远显示;
// 净利率撤下常驻卡(AI 解读里讲人话);净赚"一实一虚"——工资未发放时小字给"扣待发工资后约 $X(预估)",取新工资试算实时值。
function renderFinanceMetrics() {
  if (!els.financeMetrics) return
  const zh = owner.lang === 'zh'
  const fin = owner.financeLedger
  const summary = fin.data?.summary || { incomeCents: 0, expenseCents: 0, netCents: 0 }
  const todayCents = fin.progress?.todayRevenueCents ?? null
  const est = owner.salaryEstimateCache
  const showEst = est && est.month === fin.month && !est.paid && est.totalCents > 0
  els.financeMetrics.innerHTML = [
    [zh ? '本日收款' : 'Today', todayCents, '', ''],
    [zh ? '本月收入' : 'Income', summary.incomeCents, '', ''],
    [zh ? '本月支出' : 'Expense', summary.expenseCents, '', ''],
    [zh ? '本月净赚(已入账)' : 'Net (booked)', summary.netCents, summary.netCents >= 0 ? 'good' : 'bad',
      showEst ? (zh ? `扣待发工资后约 ${cadText(summary.netCents - est.totalCents)}(预估)` : `≈ ${cadText(summary.netCents - est.totalCents)} after pending payroll`) : '']
  ].map(([label, cents, tone, sub]) => `
    <div class="finance-metric ${tone}">
      <span>${label}</span>
      <strong ${cents != null ? `data-fin-cents="${cents}"` : ''}>${cents == null ? '-' : cadText(cents)}</strong>
      ${sub ? `<small class="fin-est-note">${sub}</small>` : ''}
    </div>`).join('')
  animateFinanceMetrics()
}

// 数字滚动动效:金额从 0 滚到实际值,约 1 秒;10 秒内重复渲染不重播,避免晃眼
function animateFinanceMetrics() {
  const now = Date.now()
  if (owner._finAnimAt && now - owner._finAnimAt < 10000) return
  owner._finAnimAt = now
  document.querySelectorAll('#financeMetrics [data-fin-cents]').forEach((el) => {
    const target = Number(el.dataset.finCents)
    if (!Number.isFinite(target) || target === 0) return
    let t0 = null
    const step = (ts) => {
      if (!t0) t0 = ts
      const pRaw = Math.min(1, (ts - t0) / 1000)
      const ease = 1 - Math.pow(1 - pRaw, 3)
      el.textContent = cadText(Math.round(target * ease))
      if (pRaw < 1) requestAnimationFrame(step)
    }
    el.textContent = cadText(0)
    requestAnimationFrame(step)
  })
}

function renderFinancePage() {
  if (!els.financeMetrics) return
  renderFinanceProgress()
  renderFinanceTargets()
  renderFinancePayroll()
  renderStoredValue()
  applyFinanceTab()
  const fin = owner.financeLedger
  if (els.financeMonth && fin.month) els.financeMonth.value = fin.month
  renderFinanceMetrics()
  const incomeOptions = FINANCE_INCOME_CATEGORIES.map((cat) => `<option value="${cat}">${cat}</option>`).join('')
  const expenseOptions = financeExpenseCategories().map((cat) => `<option value="${cat}">${cat}</option>`).join('')
  const channelOptions = FINANCE_PAY_CHANNELS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')
  els.financeQuickBody.innerHTML = `
    <div class="finance-quick-grid">
      <label><span>${owner.lang === 'zh' ? '类型' : 'Type'}</span>
        <select id="finType">
          <option value="expense">${owner.lang === 'zh' ? '支出' : 'Expense'}</option>
          <option value="income">${owner.lang === 'zh' ? '收入' : 'Income'}</option>
        </select>
      </label>
      <label><span>${owner.lang === 'zh' ? '类别' : 'Category'}</span><select id="finCategory">${expenseOptions}</select></label>
      <label><span>${owner.lang === 'zh' ? '金额 (CAD)' : 'Amount (CAD)'}</span><input id="finAmount" type="number" min="0" step="0.01" placeholder="0.00"></label>
      <label><span>${owner.lang === 'zh' ? '支付方式' : 'Channel'}</span><select id="finChannel">${channelOptions}</select></label>
      <label><span>${owner.lang === 'zh' ? '日期' : 'Date'}</span><input id="finDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label><span>${owner.lang === 'zh' ? '标签(可选)' : 'Tags'}</span><input id="finTags" placeholder="${owner.lang === 'zh' ? '如:6月采购' : 'optional'}"></label>
    </div>
    <label class="finance-note-field"><span>${owner.lang === 'zh' ? '备注' : 'Note'}</span><input id="finNote" placeholder="${owner.lang === 'zh' ? '例如:超市买棉片和酒精' : ''}"></label>
    <button class="primary slim" data-fin-submit type="button">${owner.lang === 'zh' ? '记账' : 'Record'}</button>
    <p class="subtle">${owner.lang === 'zh' ? '服务收入由订单完成自动入账,不需要手记。账本只追加:记错了用流水里的"冲销"纠正。' : 'Service income auto-posts on booking completion. The ledger is append-only; correct mistakes via reversal.'}</p>
  `
  const activeRules = (fin.rules || []).filter((rule) => rule.active)
  els.financeRecurringSummary.textContent = activeRules.length
    ? `${activeRules.length} ${owner.lang === 'zh' ? '条规则' : 'rules'} · ${cadText(activeRules.reduce((sum, rule) => sum + rule.amountCents, 0))}/${owner.lang === 'zh' ? '月' : 'mo'}`
    : (owner.lang === 'zh' ? '未设置' : 'None')
  els.financeRecurringBody.innerHTML = `
    ${(fin.rules || []).length ? (fin.rules || []).map((rule) => `
      <div class="finance-rule-row ${rule.active ? '' : 'disabled'}">
        <span><strong>${escapeHtml(rule.name)}</strong> · ${escapeHtml(rule.category)} · ${cadText(rule.amountCents)} · ${owner.lang === 'zh' ? `每月${rule.dayOfMonth}号` : `day ${rule.dayOfMonth}`}</span>
        <button class="ghost slim" data-fin-rule-toggle="${escapeHtml(rule.id)}" data-fin-rule-next="${rule.active ? '0' : '1'}" type="button">${rule.active ? (owner.lang === 'zh' ? '停用' : 'Disable') : (owner.lang === 'zh' ? '启用' : 'Enable')}</button>
      </div>`).join('') : `<p class="subtle">${owner.lang === 'zh' ? '还没有固定支出。房租、水电这类每月固定的,建一条规则后系统每月自动入账。' : 'No recurring expenses yet.'}</p>`}
    <div class="finance-rule-add">
      <input id="finRuleName" placeholder="${owner.lang === 'zh' ? '名称,如:店面房租' : 'Name'}">
      <select id="finRuleCategory">${expenseOptions}</select>
      <input id="finRuleAmount" type="number" min="0" step="0.01" placeholder="${owner.lang === 'zh' ? '金额' : 'Amount'}">
      <input id="finRuleDay" type="number" min="1" max="31" value="1" title="${owner.lang === 'zh' ? '每月几号' : 'Day of month'}">
      <button class="primary slim" data-fin-rule-add type="button">${owner.lang === 'zh' ? '添加规则' : 'Add'}</button>
    </div>
  `
  const ledger = fin.ledger
  els.financeLedgerSummary.textContent = ledger
    ? (ledger.valid ? (owner.lang === 'zh' ? `完整 ✓ (${ledger.count} 笔)` : `Intact ✓ (${ledger.count})`) : (owner.lang === 'zh' ? '⚠ 校验失败' : '⚠ Broken'))
    : '-'
  els.financeLedgerBody.innerHTML = `
    <p class="subtle">${owner.lang === 'zh'
      ? '账本三重保护:① 数据库层禁止修改/删除任何流水,纠错只能红字冲销;② 每笔流水带加密指纹并与上一笔咬合成链,绕过系统直改数据库会立即断链;③ 下方按钮随时校验全链完整性。'
      : 'Ledger protection: append-only at DB level (corrections via reversal only); each row is hash-chained to the previous; verify the whole chain anytime below.'}</p>
    ${ledger && !ledger.valid ? `<p class="plan-expired-banner">${owner.lang === 'zh' ? `链条在第一处断裂:${escapeHtml(ledger.firstBrokenId || '')}（${escapeHtml(String(ledger.firstBrokenAt || ''))}）,该笔及之后的数据可能被篡改过。` : `Chain broken at ${escapeHtml(ledger.firstBrokenId || '')}.`}</p>` : ''}
    <button class="ghost slim" data-fin-verify type="button">${owner.lang === 'zh' ? '重新校验账本' : 'Verify ledger'}</button>
  `
  const categories = ['all', ...new Set((fin.data?.transactions || []).map((txn) => txn.category))]
  els.financeFilters.innerHTML = `
    <select id="finFilterType">
      <option value="all" ${fin.filterType === 'all' ? 'selected' : ''}>${owner.lang === 'zh' ? '全部类型' : 'All types'}</option>
      <option value="income" ${fin.filterType === 'income' ? 'selected' : ''}>${owner.lang === 'zh' ? '仅收入' : 'Income'}</option>
      <option value="expense" ${fin.filterType === 'expense' ? 'selected' : ''}>${owner.lang === 'zh' ? '仅支出' : 'Expense'}</option>
    </select>
    <select id="finFilterCategory">
      ${categories.map((cat) => `<option value="${escapeHtml(cat)}" ${fin.filterCategory === cat ? 'selected' : ''}>${cat === 'all' ? (owner.lang === 'zh' ? '全部类别' : 'All categories') : escapeHtml(cat)}</option>`).join('')}
    </select>
  `
  const rows = (fin.data?.transactions || [])
    .filter((txn) => fin.filterType === 'all' || txn.type === fin.filterType)
    .filter((txn) => fin.filterCategory === 'all' || txn.category === fin.filterCategory)
  const reversedIds = new Set((fin.data?.transactions || []).map((txn) => txn.reversalOf).filter(Boolean))
  els.financeTxnList.innerHTML = rows.length ? rows.map((txn) => `
    <div class="finance-txn-row ${txn.amountCents < 0 ? 'negative' : 'positive'} ${txn.reversalOf ? 'is-reversal' : ''} ${reversedIds.has(txn.id) ? 'is-reversed' : ''}">
      <span class="finance-txn-date">${escapeHtml(txn.occurredOn)}</span>
      <span class="finance-txn-main">
        <strong>${escapeHtml(txn.category)}</strong>
        <small>${escapeHtml([txn.tags, txn.note].filter(Boolean).join(' · ') || txn.source)}</small>
      </span>
      <span class="finance-txn-channel">${escapeHtml((FINANCE_PAY_CHANNELS.find(([id]) => id === txn.payChannel) || ['', txn.payChannel])[1])}</span>
      <strong class="finance-txn-amount">${cadText(txn.amountCents)}</strong>
      ${!txn.reversalOf && !reversedIds.has(txn.id)
        ? `<button class="ghost slim" data-fin-reverse="${escapeHtml(txn.id)}" type="button">${owner.lang === 'zh' ? '冲销' : 'Reverse'}</button>`
        : `<span class="finance-txn-flag">${txn.reversalOf ? (owner.lang === 'zh' ? '冲销单' : 'reversal') : (owner.lang === 'zh' ? '已冲销' : 'reversed')}</span>`}
    </div>`).join('') : `<p class="subtle">${owner.lang === 'zh' ? '本月还没有流水。' : 'No transactions this month.'}</p>`
}

function exportFinanceCsv() {
  const zh = owner.lang === 'zh'
  const fin = owner.finance || {}
  const txns = fin.data?.transactions || []
  if (!txns.length) {
    toast(zh ? '本月没有流水可导出' : 'Nothing to export this month')
    return
  }
  const header = zh
    ? ['日期', '类型', '类别', '金额(CAD)', '支付方式', '标签', '备注', '来源', '冲销于', '流水ID']
    : ['Date', 'Type', 'Category', 'Amount (CAD)', 'Channel', 'Tags', 'Note', 'Source', 'Reversal of', 'ID']
  const csvCell = (value) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [header.join(',')]
  for (const txn of txns) {
    lines.push([
      txn.occurredOn,
      zh ? (txn.type === 'income' ? '收入' : '支出') : txn.type,
      txn.category,
      (txn.amountCents / 100).toFixed(2),
      txn.payChannel || '',
      txn.tags || '',
      txn.note || '',
      txn.source || '',
      txn.reversalOf || '',
      txn.id
    ].map(csvCell).join(','))
  }
  // ﻿ BOM 让 Excel 正确识别中文
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `lucky-luxe-流水-${fin.month || new Date().toISOString().slice(0, 7)}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
  toast(zh ? 'CSV 已导出(含冲销记录,与账本完全一致)' : 'CSV exported')
}

async function submitFinanceEntry() {
  const type = document.querySelector('#finType')?.value || 'expense'
  const amount = Number(document.querySelector('#finAmount')?.value || 0)
  if (!amount || amount <= 0) {
    toast(owner.lang === 'zh' ? '请填写正确的金额' : 'Enter a valid amount')
    return
  }
  await request('/admin/finance/transactions', {
    method: 'POST',
    body: JSON.stringify({
      type,
      category: document.querySelector('#finCategory')?.value || '其他支出',
      amount,
      payChannel: document.querySelector('#finChannel')?.value || 'unknown',
      occurredOn: document.querySelector('#finDate')?.value || '',
      tags: document.querySelector('#finTags')?.value.trim() || '',
      note: document.querySelector('#finNote')?.value.trim() || ''
    })
  })
  await loadFinancePage()
  toast(owner.lang === 'zh' ? '已入账（账本只追加，不可修改）' : 'Recorded (append-only).')
}

function renderStoreInfo() {
  if (!els.storeInfoSummary || !els.storeInfoBody) return
  const tenantId = owner.tenantPlan?.tenantId || 'lucky-luxe'
  const store = (owner.businessHoursStores || [])[0]
  els.storeInfoSummary.textContent = tenantId
  const rows = [
    [owner.lang === 'zh' ? '商户 ID' : 'Tenant ID', tenantId],
    [owner.lang === 'zh' ? '门店 ID' : 'Store ID', store?.id || '-'],
    [owner.lang === 'zh' ? '门店名称' : 'Store name', store?.name || '-'],
    [owner.lang === 'zh' ? '当前套餐' : 'Plan', owner.tenantPlan?.plan || '-']
  ]
  els.storeInfoBody.innerHTML = `
    <table class="store-info-table">
      ${rows.map(([label, value]) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td><code>${escapeHtml(String(value))}</code></td>
          <td><button class="ghost slim" data-copy-value="${escapeHtml(String(value))}" type="button">${owner.lang === 'zh' ? '复制' : 'Copy'}</button></td>
        </tr>`).join('')}
    </table>
    <p class="subtle">${owner.lang === 'zh' ? '联系技术支持或反馈问题时，提供商户 ID 和门店 ID 可以快速定位你的数据。' : 'Share the tenant and store IDs with support to locate your data quickly.'}</p>
  `
}

function renderStoreProfile() {
  const body = document.querySelector('#storeProfileBody')
  const summary = document.querySelector('#storeProfileSummary')
  if (!body || !summary) return
  const store = (owner.businessHoursStores || [])[0]
  if (!store) {
    summary.textContent = '-'
    body.innerHTML = ''
    return
  }
  const addressUsable = store.address && !/tbd/i.test(store.address) ? store.address : ''
  summary.textContent = addressUsable || (owner.lang === 'zh' ? '⚠ 地址未设置' : '⚠ Address not set')
  summary.classList.toggle('plan-expired', !addressUsable)
  body.innerHTML = `
    <div class="kb-facts-grid">
      <label><span>${owner.lang === 'zh' ? '门店名称' : 'Store name'}</span><input id="storeProfileName" value="${escapeHtml(store.name || '')}"></label>
      <label><span>${owner.lang === 'zh' ? '门店地址' : 'Address'}</span><input id="storeProfileAddress" value="${escapeHtml(addressUsable)}"></label>
      <label><span>${owner.lang === 'zh' ? '联系电话' : 'Phone'}</span><input id="storeProfilePhone" value="${escapeHtml(store.phone && !/tbd/i.test(store.phone) ? store.phone : '')}"></label>
    </div>
    <button class="primary slim" data-store-profile-save type="button">${owner.lang === 'zh' ? '保存门店信息' : 'Save store info'}</button>
    <p class="subtle">${owner.lang === 'zh' ? '保存后同步到订单系统和 AI 知识库——顾客问路、预约确认、AI 回答三处永远一致。' : 'Saved info syncs to bookings and the AI knowledge base so all three stay consistent.'}</p>
  `
}

async function saveStoreProfile() {
  const store = (owner.businessHoursStores || [])[0]
  if (!store) return
  await request('/admin/store-info', {
    method: 'PUT',
    body: JSON.stringify({
      storeId: store.id,
      name: document.querySelector('#storeProfileName')?.value.trim(),
      address: document.querySelector('#storeProfileAddress')?.value.trim(),
      phone: document.querySelector('#storeProfilePhone')?.value.trim()
    })
  })
  const refreshed = await request('/admin/business-hours')
  owner.businessHoursStores = refreshed.stores || []
  await refreshTenantKb().catch(() => {})
  renderStoreSettings()
  toast(owner.lang === 'zh' ? '门店信息已保存并同步到 AI 知识库' : 'Store info saved and synced')
}

function renderStoreSettings() {
  if (!els.businessHoursEditor) return
  renderMembershipSettings()
  renderDepositSettings()
  renderAiPackSettings()
  renderTenantPlan()
  renderTenantKb()
  renderStoreInfo()
  renderStoreProfile()
  const store = (owner.businessHoursStores || [])[0]
  if (!store) {
    els.businessHoursEditor.innerHTML = `<div class="empty-state small-empty">-</div>`
    els.businessHoursUpdated.textContent = ''
    if (els.businessHoursSummary) els.businessHoursSummary.textContent = ''
    return
  }
  if (els.businessHoursSummary) {
    els.businessHoursSummary.textContent = (owner.lang === 'zh' ? store.hoursText?.zh : store.hoursText?.en) || ''
  }
  const byWeekday = new Map((store.hours || []).map((row) => [row.weekday, row]))
  const updated = (store.hours || []).map((row) => row.updatedAt).filter(Boolean).sort().pop()
  els.businessHoursUpdated.textContent = updated ? `${t('lastUpdatedLabel')}: ${String(updated).slice(0, 16).replace('T', ' ')}` : ''
  els.businessHoursEditor.innerHTML = `
    <div class="business-hours-grid">
      ${WEEKDAY_UI_ORDER.map((weekday) => {
        const row = byWeekday.get(weekday) || { openTime: '10:00', closeTime: '19:00', isClosed: false }
        return `
          <div class="business-hours-row ${row.isClosed ? 'closed' : ''}">
            <strong>${weekdayLabel(weekday)}</strong>
            <label class="check-row slim-check">
              <input type="checkbox" data-hours-closed="${weekday}" ${row.isClosed ? 'checked' : ''}>
              <span>${t('closedDay')}</span>
            </label>
            <input type="time" data-hours-open="${weekday}" value="${row.openTime}" ${row.isClosed ? 'disabled' : ''}>
            <span class="hours-dash">–</span>
            <input type="time" data-hours-close="${weekday}" value="${row.closeTime}" ${row.isClosed ? 'disabled' : ''}>
          </div>`
      }).join('')}
    </div>
    <div class="special-dates-block">
      <h4>${owner.lang === 'zh' ? '特殊日期(节假日休息 / 临时调整)' : 'Special dates (holidays / temporary changes)'}</h4>
      <p class="subtle">${owner.lang === 'zh' ? '优先于每周固定模式,保存后立即影响可预约时段和 AI 的营业时间回答。' : 'Overrides the weekly pattern; affects booking slots and AI answers instantly.'}</p>
      ${(store.specialDates || []).length ? `
        <div class="special-dates-list">
          ${store.specialDates.map((row) => `
            <div class="special-date-row">
              <strong>${row.date}</strong>
              <span>${row.isClosed ? (owner.lang === 'zh' ? '休息' : 'Closed') : `${row.openTime}–${row.closeTime}`}</span>
              <span class="subtle">${escapeHtml(row.note || '')}</span>
              <button class="ghost slim" data-special-date-delete="${row.date}" type="button">✕</button>
            </div>`).join('')}
        </div>` : `<p class="subtle">${owner.lang === 'zh' ? '暂无特殊日期。' : 'None yet.'}</p>`}
      <div class="special-date-add-row">
        <input type="date" id="specialDateInput">
        <select id="specialDateMode">
          <option value="closed">${owner.lang === 'zh' ? '休息' : 'Closed'}</option>
          <option value="hours">${owner.lang === 'zh' ? '调整时段' : 'Adjusted hours'}</option>
        </select>
        <input type="time" id="specialDateOpen" value="12:00" class="hidden">
        <input type="time" id="specialDateClose" value="17:00" class="hidden">
        <input type="text" id="specialDateNote" placeholder="${owner.lang === 'zh' ? '备注,如:圣诞节' : 'Note, e.g. Christmas'}">
        <button class="ghost slim" data-special-date-add type="button">${owner.lang === 'zh' ? '添加' : 'Add'}</button>
      </div>
    </div>`
}

async function addSpecialDate() {
  const zh = owner.lang === 'zh'
  const store = (owner.businessHoursStores || [])[0]
  const date = document.querySelector('#specialDateInput')?.value
  if (!store || !date) {
    toast(zh ? '请先选择日期' : 'Pick a date first')
    return
  }
  const isClosed = document.querySelector('#specialDateMode')?.value !== 'hours'
  await request('/admin/special-dates', {
    method: 'POST',
    body: JSON.stringify({
      storeId: store.id,
      date,
      isClosed,
      openTime: document.querySelector('#specialDateOpen')?.value,
      closeTime: document.querySelector('#specialDateClose')?.value,
      note: document.querySelector('#specialDateNote')?.value || ''
    })
  })
  const refreshed = await request('/admin/business-hours')
  owner.businessHoursStores = refreshed.stores || []
  renderStoreSettings()
  toast(zh ? '特殊日期已保存,预约与 AI 回答立即生效' : 'Special date saved')
}

async function deleteSpecialDate(date) {
  const store = (owner.businessHoursStores || [])[0]
  if (!store) return
  await request(`/admin/special-dates/${date}?storeId=${encodeURIComponent(store.id)}`, { method: 'DELETE' })
  const refreshed = await request('/admin/business-hours')
  owner.businessHoursStores = refreshed.stores || []
  renderStoreSettings()
  toast(owner.lang === 'zh' ? '已删除,恢复每周固定模式' : 'Removed')
}

async function saveBusinessHoursSettings() {
  const store = (owner.businessHoursStores || [])[0]
  if (!store) return
  const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    openTime: document.querySelector(`[data-hours-open="${weekday}"]`)?.value || '10:00',
    closeTime: document.querySelector(`[data-hours-close="${weekday}"]`)?.value || '19:00',
    isClosed: Boolean(document.querySelector(`[data-hours-closed="${weekday}"]`)?.checked)
  }))
  const data = await request('/admin/business-hours', {
    method: 'PUT',
    body: JSON.stringify({ storeId: store.id, hours })
  })
  owner.businessHoursStores = (owner.businessHoursStores || []).map((item) => item.id === store.id
    ? { ...item, hours: data.hours, hoursText: data.hoursText }
    : item)
  renderStoreSettings()
  toast(t('businessHoursSaved'))
}

function wechatConversationRank(conversation) {
  if (conversation.status === 'needs_human') return 0
  if (conversation.status === 'human_active') return 1
  return 2
}

function relativeTimeLabel(value) {
  if (!value) return ''
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000))
  if (owner.lang === 'zh') {
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟`
    if (minutes < 1440) return `${Math.round(minutes / 60)}小时`
    return `${Math.round(minutes / 1440)}天`
  }
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function conversationDisplayName(conversation) {
  return conversation.externalUserId || 'Customer'
}

function conversationWaitingMinutes(conversation) {
  const transcript = conversation.transcript || []
  const last = transcript[transcript.length - 1]
  if (!last || last.role !== 'customer') return 0
  const time = new Date(last.at || conversation.updatedAt).getTime()
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.round((Date.now() - time) / 60000))
}

function renderLiveConversationRow(conversation) {
  const needsHuman = ['needs_human', 'human_active'].includes(conversation.status)
  const waitingMinutes = needsHuman ? conversationWaitingMinutes(conversation) : 0
  const overdue = waitingMinutes >= 10
  const name = conversationDisplayName(conversation)
  const initial = name.replace(/^(mock-customer-|sim-|probe-|bh-|guard-|wb-)/, '').charAt(0).toUpperCase() || '客'
  return `
    <button class="cs-chat-row ${needsHuman ? 'needs-human' : ''} ${overdue ? 'overdue' : ''} ${owner.wechatMockSessionId === `live:${conversation.id}` ? 'active' : ''}" data-wechat-live="${escapeHtml(conversation.id)}" type="button">
      <span class="cs-avatar ${overdue ? 'overdue' : needsHuman ? 'danger' : ''}">${escapeHtml(initial)}</span>
      <span class="cs-chat-row-main">
        <span class="cs-chat-row-top">
          <strong>${escapeHtml(name)}</strong>
          <small class="${overdue ? 'cs-overdue-time' : ''}">${overdue
            ? (owner.lang === 'zh' ? `已等 ${waitingMinutes} 分钟` : `waiting ${waitingMinutes}m`)
            : escapeHtml(relativeTimeLabel(conversation.updatedAt))}</small>
        </span>
        <span class="cs-chat-row-preview">${escapeHtml((conversation.lastMessage || '-').slice(0, 40))}</span>
      </span>
    </button>`
}

function filteredWechatConversations() {
  const search = owner.wechatSearch.trim().toLowerCase()
  let list = [...(owner.wechatConversations || [])].sort((a, b) => wechatConversationRank(a) - wechatConversationRank(b))
  if (owner.wechatFilter === 'needsHuman') list = list.filter((item) => ['needs_human', 'human_active'].includes(item.status))
  if (owner.wechatFilter === 'aiActive') list = list.filter((item) => !['needs_human', 'human_active'].includes(item.status))
  if (search) {
    list = list.filter((item) => `${item.externalUserId || ''} ${item.lastMessage || ''}`.toLowerCase().includes(search))
  }
  return list
}

function renderWechatFilterBar() {
  if (!els.wechatFilterBar) return
  const all = owner.wechatConversations || []
  const needsHumanCount = all.filter((item) => ['needs_human', 'human_active'].includes(item.status)).length
  const filters = [
    ['all', t('filterAll'), all.length],
    ['needsHuman', t('filterNeedsHuman'), needsHumanCount],
    ['aiActive', t('filterAiActive'), all.length - needsHumanCount]
  ]
  els.wechatFilterBar.innerHTML = filters.map(([key, label, count]) => `
    <button class="cs-filter-pill ${owner.wechatFilter === key ? 'active' : ''}" data-wechat-filter="${key}" type="button">
      ${escapeHtml(label)}${key === 'needsHuman' && count ? ` <b>${count}</b>` : ` (${count})`}
    </button>`).join('')
}

function renderWechatMock() {
  if (!els.wechatSessionList || !els.wechatMockDetail) return
  const liveConversations = filteredWechatConversations()
  const needsHumanConversations = liveConversations.filter((conversation) => ['needs_human', 'human_active'].includes(conversation.status))
  const normalConversations = liveConversations.filter((conversation) => !['needs_human', 'human_active'].includes(conversation.status))
  const needsHumanCount = (owner.wechatConversations || []).filter((conversation) => conversation.status === 'needs_human').length
  if (els.wechatNeedsHumanBadge) {
    els.wechatNeedsHumanBadge.textContent = String(needsHumanCount)
    els.wechatNeedsHumanBadge.classList.toggle('hidden', !needsHumanCount)
  }
  renderWechatFilterBar()
  const selected = selectedWechatSession()
  els.wechatSessionList.innerHTML = `
    <input class="cs-search" id="wechatSearchInput" placeholder="${t('searchCustomers')}" value="${escapeHtml(owner.wechatSearch)}">
    ${needsHumanConversations.length ? `
      <div class="wechat-session-group-title needs-human-title">${t('needsHumanQueue')} (${needsHumanConversations.length})</div>
      ${needsHumanConversations.map(renderLiveConversationRow).join('')}
    ` : ''}
    ${(() => {
      // 员工端:与我相关的会话置顶(我的报价任务所属会话),其余照常可见
      if (isOwnerRole()) return ''
      const myTechId = (owner.technicians || [])[0]?.id
      const mineIds = new Set((owner.quoteRequests || []).filter((item) => item.technicianId === myTechId).map((item) => item.conversationId).filter(Boolean))
      const mine = normalConversations.filter((conversation) => mineIds.has(conversation.id))
      if (!mine.length) return ''
      mine.forEach((conversation) => normalConversations.splice(normalConversations.indexOf(conversation), 1))
      return `
        <div class="wechat-session-group-title mine-title">${owner.lang === 'zh' ? '与我相关' : 'Mine'} (${mine.length})</div>
        ${mine.map(renderLiveConversationRow).join('')}`
    })()}
    <div class="wechat-session-group-title">${t('liveConversations')}</div>
    ${normalConversations.length ? normalConversations.map(renderLiveConversationRow).join('') : `<div class="empty-state small-empty">${t('noLiveConversations')}</div>`}
  `
  if (selected) {
    renderWechatLiveDetail(selected)
    renderWechatContextPanel(selected)
  } else {
    els.wechatMockDetail.innerHTML = `<div class="empty-state">${t('noLiveConversations')}</div>`
    if (els.wechatContextPanel) els.wechatContextPanel.innerHTML = ''
    if (els.wechatWorkflowPanel) els.wechatWorkflowPanel.innerHTML = ''
  }
}

function renderWechatContextPanel(conversation) {
  if (!els.wechatContextPanel) return
  const state = conversation.conversationState || {}
  const stateData = state.state || {}
  const memory = stateData.workingMemory || {}
  const memoryCustomer = memory.customer || {}
  const quoteTasks = (owner.quoteRequests || []).filter((item) => item.conversationId === conversation.id && !['COMPLETED', 'CANCELLED', 'SENT'].includes(String(item.status || '').toUpperCase()))
  const conversationReminders = (owner.reminderTasks || []).filter((item) => item.conversationId === conversation.id && String(item.status || '') === 'PENDING')
  const memberTier = memoryCustomer.memberTier || stateData.memberTier || '-'
  const customerType = memoryCustomer.customerType || stateData.customerType || '-'
  els.wechatContextPanel.innerHTML = `
    <div class="cs-context-card">
      <div class="cs-context-card-head"><span>${t('customerProfileCard')}</span></div>
      <strong class="cs-context-name">${escapeHtml(conversationDisplayName(conversation))}</strong>
      <p class="subtle">${escapeHtml(conversation.sourceChannel || conversation.provider || '-')} · ${escapeHtml(String(memberTier))} · ${escapeHtml(String(customerType))}</p>
      ${conversation.linkedUserId && isOwnerRole() ? `<button class="ghost slim" data-open-customer-file="${escapeHtml(conversation.linkedUserId)}" type="button">${owner.lang === 'zh' ? '查看客户档案 →' : 'Customer file →'}</button>` : ''}
      ${!conversation.linkedUserId && isOwnerRole() && (owner.customers || []).length ? `
      <details class="cs-inline-details">
        <summary>${owner.lang === 'zh' ? '绑定会员' : 'Link member'}</summary>
        <div class="cs-link-member-row">
          <select data-link-member-select>
            ${owner.customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customerName(customer))} · ${escapeHtml(customer.memberCode || '')}</option>`).join('')}
          </select>
          <button class="ghost slim" data-link-member="${escapeHtml(conversation.id)}" type="button">${owner.lang === 'zh' ? '绑定' : 'Link'}</button>
        </div>
      </details>` : ''}
    </div>
    <div class="cs-context-card">
      <div class="cs-context-card-head"><span>${t('aiMemoryCard')}</span></div>
      <p class="subtle">${t('intentLabel')}: ${escapeHtml(state.intent || conversation.lastIntent || '-')}<br>
      ${t('stageLabel')}: ${escapeHtml(state.quoteStage || '-')} / ${escapeHtml(state.nextAction || '-')}<br>
      ${t('refImagesLabel')}: ${(stateData.referenceImages || []).length}</p>
      <details class="cs-inline-details">
        <summary>${t('knowledgePanelGroup')}</summary>
        ${renderKnowledgeMatchPanel(conversation.aiReply)}
      </details>
    </div>
    <div class="cs-context-card">
      <div class="cs-context-card-head"><span>${t('quoteTasksCard')}</span>${quoteTasks.length ? `<span class="cs-count-badge">${quoteTasks.length}</span>` : ''}</div>
      ${quoteTasks.length ? quoteTasks.map((item) => `
        <div class="cs-task-item cs-quote-task">
          <strong>${escapeHtml(item.serviceType || '-')}</strong> · ${escapeHtml(quoteStatusText(item.status))}
          <small>${escapeHtml((item.customerMessage || '').slice(0, 60))}</small>
          ${(item.referenceImages || []).length ? `
            <div class="cs-quote-thumbs">
              ${(item.referenceImages || []).slice(0, 4).map((src, index) => `<img src="${escapeHtml(src)}" alt="ref ${index + 1}">`).join('')}
            </div>` : ''}
          ${String(item.status || '').toUpperCase() === 'PENDING_STAFF' ? `
            <textarea rows="3" data-quote-id="${escapeHtml(item.id)}" data-backend-quote-field="message" placeholder="${owner.lang === 'zh' ? '技师回价/判断，例如：可以做，本甲120，延长200，大概3小时以内' : 'Technician reply, e.g.: can do, natural 120, extension 200, within 3 hours'}">${escapeHtml(item.staffNotes || '')}</textarea>
            <div class="action-row wrap cs-quote-actions">
              <button class="primary slim" data-backend-quote-send="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '润色并发送' : 'Polish and send'}</button>
              <button class="ghost slim" data-backend-quote-draft="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '建草稿链接' : 'Draft link'}</button>
            </div>` : ''}
        </div>`).join('') : `<p class="subtle">${t('noTasks')}</p>`}
    </div>
    <div class="cs-context-card cs-context-card-last">
      <div class="cs-context-card-head"><span>${t('backendTasksCard')}</span>${conversationReminders.length ? `<span class="cs-count-badge">${conversationReminders.length}</span>` : ''}</div>
      ${conversationReminders.length ? conversationReminders.map((item) => `
        <div class="cs-task-item">
          <strong>${escapeHtml(reminderTypeText(item.type))}</strong>
          <small>${escapeHtml(String(item.scheduledAt || '').slice(0, 16).replace('T', ' '))}</small>
        </div>`).join('') : `<p class="subtle">${t('noTasks')}</p>`}
    </div>
  `
  if (els.wechatWorkflowPanel) {
    els.wechatWorkflowPanel.innerHTML = renderManualBookingDraftPanel(conversation.id)
  }
}

function renderWechatConnectionStatus() {
  const status = owner.wechatStatus
  if (!status) return `<div class="wechat-status-card"><strong>${t('wechatConnectionStatus')}</strong><span>${t('wechatConfigPending')}</span></div>`
  return `
    <div class="wechat-status-card">
      <div class="section-row compact-row">
        <strong>${t('wechatConnectionStatus')}</strong>
        <span class="mock-state-pill">${status.mode === 'ready' ? t('wechatConfigReady') : t('wechatConfigPending')}</span>
      </div>
      <label>
        <span>${t('wechatWebhookUrl')}</span>
        <input readonly value="${escapeHtml(status.webhookUrl || '')}">
      </label>
      <div class="wechat-check-grid">
        ${(status.checks || []).map((item) => `<span class="${item.ok ? 'ok' : 'missing'}">${escapeHtml(item.label)} · ${item.ok ? t('configured') : t('missingCredentials')}</span>`).join('')}
      </div>
    </div>
  `
}

function compactDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(owner.lang === 'zh' ? 'zh-CN' : 'en-CA', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function quoteStatusText(status = '') {
  const zh = {
    NEEDS_INFO: '待补充信息',
    PENDING_STAFF: '待技师报价',
    WAITING_STAFF_QUOTE: '待技师报价',
    QUOTED: '已回价',
    DRAFT_CREATED: '已建草稿',
    DECLINED: '不可做',
    CLOSED: '已关闭',
    EXPIRED: '已释放',
    CANCELLED: '已取消'
  }
  const en = {
    NEEDS_INFO: 'Needs info',
    PENDING_STAFF: 'Waiting quote',
    WAITING_STAFF_QUOTE: 'Waiting quote',
    QUOTED: 'Quoted',
    DRAFT_CREATED: 'Draft created',
    DECLINED: 'Cannot do',
    CLOSED: 'Closed',
    EXPIRED: 'Released',
    CANCELLED: 'Cancelled'
  }
  return (owner.lang === 'zh' ? zh : en)[status] || status || '-'
}

function reminderTypeText(type = '') {
  const zh = {
    QUOTE_STAFF_RESPONSE_10_MIN: '技师 10 分钟回价提醒',
    DRAFT_PAYMENT_REMINDER: '定金支付提醒',
    DRAFT_RELEASE: '30 分钟草稿释放',
    AFTERCARE_7_DAY: '7 天护理回访',
    REFILL_3_TO_4_WEEK: '3-4 周补甲/补睫提醒'
  }
  const en = {
    QUOTE_STAFF_RESPONSE_10_MIN: '10-min staff quote follow-up',
    DRAFT_PAYMENT_REMINDER: 'Deposit payment reminder',
    DRAFT_RELEASE: '30-min draft release',
    AFTERCARE_7_DAY: '7-day after-care follow-up',
    REFILL_3_TO_4_WEEK: '3-4 week refill reminder'
  }
  return (owner.lang === 'zh' ? zh : en)[type] || type || '-'
}

function quoteRequestBrief(item) {
  if (item.customerMessage) return item.customerMessage
  const questions = item.missingQuestions || {}
  if (Array.isArray(questions)) return questions.join(' / ')
  const list = owner.lang === 'zh' ? questions.zh : questions.en
  return (list || questions.zh || questions.en || []).join(' / ')
}

function quoteRequestMeta(item) {
  const images = item.referenceImages?.length || 0
  const stage = item.styleElements?.customerStage || '-'
  const imageText = owner.lang === 'zh' ? `${images} 张图` : `${images} image${images === 1 ? '' : 's'}`
  return `${item.serviceType || '-'} · ${item.sourceChannel || '-'} · ${imageText} · ${stage}`
}

function renderQuoteReferenceImages(item) {
  const images = Array.isArray(item.referenceImages) ? item.referenceImages : []
  if (!images.length) {
    return `<p class="quote-image-empty">${owner.lang === 'zh' ? '暂无参考图。若顾客前面发过图，系统会自动带入到这里。' : 'No reference image yet. Prior customer images will be attached here automatically.'}</p>`
  }
  return `
    <div class="quote-reference-strip">
      ${images.map((src, index) => `
        <figure>
          <img src="${escapeHtml(src)}" alt="${owner.lang === 'zh' ? `顾客参考图 ${index + 1}` : `Customer reference ${index + 1}`}">
          <figcaption>${owner.lang === 'zh' ? `参考图 ${index + 1}` : `Image ${index + 1}`}</figcaption>
        </figure>
      `).join('')}
    </div>
  `
}

function renderManualBookingDraftPanel(conversationId = '') {
  const serviceOptions = (owner.services || []).map((service) => `
    <option value="${escapeHtml(service.id)}">${escapeHtml(service.name || service.nameZh || service.id)} · ${escapeHtml(String(service.type || '').toUpperCase())}</option>
  `).join('')
  const technicianOptions = (owner.technicians || []).map((tech) => `
    <option value="${escapeHtml(tech.id)}">${escapeHtml(tech.name || tech.id)}</option>
  `).join('')
  const link = owner.manualDraftLink || ''
  return `
    <article class="workflow-card quote-card manual-draft-card">
      <div class="workflow-summary">
        <span class="pill muted">${owner.lang === 'zh' ? '人工入口' : 'Manual'}</span>
        <strong>${owner.lang === 'zh' ? '人工创建预约草稿' : 'Create Booking Draft Manually'}</strong>
        <small>${owner.lang === 'zh' ? '用于客服或店主直接给顾客生成可支付草稿链接。' : 'Create a checkout-ready draft link for the customer.'}</small>
      </div>
      <div class="manual-draft-grid">
        <label>
          <span>${owner.lang === 'zh' ? '服务' : 'Service'}</span>
          <select id="manualDraftService">${serviceOptions}</select>
        </label>
        <label>
          <span>${owner.lang === 'zh' ? '技师' : 'Technician'}</span>
          <select id="manualDraftTechnician">
            <option value="">${owner.lang === 'zh' ? '系统自动匹配' : 'Auto assign'}</option>
            ${technicianOptions}
          </select>
        </label>
        <label>
          <span>${owner.lang === 'zh' ? '日期' : 'Date'}</span>
          <input id="manualDraftDate" type="date">
        </label>
        <label>
          <span>${owner.lang === 'zh' ? '时间' : 'Time'}</span>
          <input id="manualDraftTime" type="time">
        </label>
        <label class="quote-notes-field">
          <span>${owner.lang === 'zh' ? '备注/顾客需求' : 'Notes'}</span>
          <textarea id="manualDraftNotes" rows="3" placeholder="${owner.lang === 'zh' ? '例如：顾客要本甲、需要卸甲、参考图已发，技师确认可做。' : 'Example: natural nails, removal needed, reference image sent, technician confirmed.'}"></textarea>
        </label>
      </div>
      <div class="workflow-actions">
        ${link ? `<a class="ghost slim" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${owner.lang === 'zh' ? '打开最近草稿' : 'Open latest draft'}</a>` : ''}
        <button class="primary slim" data-manual-draft-create="${escapeHtml(conversationId || '')}" type="button">${owner.lang === 'zh' ? '生成草稿链接' : 'Create draft link'}</button>
      </div>
      ${link ? `<p class="draft-link-preview">${escapeHtml(link)}</p>` : ''}
    </article>
  `
}

function renderWechatBackendWorkflow(conversationId = '') {
  const quotes = (owner.quoteRequests || [])
    .filter((item) => !conversationId || item.conversationId === conversationId)
    .filter((item) => ['PENDING_STAFF'].includes(String(item.status || '').toUpperCase()))
  const reminders = (owner.reminderTasks || []).filter((item) => !conversationId || item.conversationId === conversationId)
  const hasData = quotes.length || reminders.length
  return `
    <section class="quote-workbench live-workflow-panel">
      <div class="section-row compact-row">
        <div>
          <h3>${owner.lang === 'zh' ? '后端任务池' : 'Backend Workflow Queue'}</h3>
          <p class="subtle">${owner.lang === 'zh' ? '真实接口生成的报价、草稿和提醒任务。' : 'Quote, draft, and reminder tasks generated by real API endpoints.'}</p>
        </div>
        <span class="pill muted">${quotes.length} / ${reminders.length}</span>
      </div>
      <div class="workflow-list manual-draft-list">
        ${renderManualBookingDraftPanel(conversationId)}
      </div>
      ${hasData ? `
        <div class="workflow-list">
          ${quotes.slice(0, 6).map((item) => `
            <article class="workflow-card quote-card">
              <div class="workflow-summary">
                <span class="pill muted">${escapeHtml(quoteStatusText(item.status))}</span>
                <strong>${escapeHtml(item.customerName || item.customerExternalId || 'Guest')}</strong>
                <small>${escapeHtml(quoteRequestMeta(item))}</small>
                <p>${escapeHtml(quoteRequestBrief(item).slice(0, 140))}</p>
              </div>
              ${renderQuoteReferenceImages(item)}
              <div class="quote-response-grid">
                <label class="quote-notes-field">
                  <span>${owner.lang === 'zh' ? '技师留言给 AI' : 'Technician message for AI'}</span>
                  <textarea rows="4" data-quote-id="${escapeHtml(item.id)}" data-backend-quote-field="message" placeholder="${owner.lang === 'zh' ? '例如：可做，基础 $238，约 150 分钟。珍珠数量到店确认，建议提前预留延长时间。' : 'Example: Can do, base $238, about 150 min. Pearls confirmed in store; recommend reserving extension time.'}">${escapeHtml(item.staffNotes || '')}</textarea>
                </label>
              </div>
              <div class="workflow-actions">
                <button class="primary slim" data-backend-quote-send="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '交给 AI 润色并发送' : 'Polish and send'}</button>
                <button class="ghost slim" data-backend-quote-draft="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '建 30 分钟草稿链接' : 'Create draft link'}</button>
              </div>
            </article>
          `).join('')}
          ${reminders.slice(0, 8).map((item) => `
            <article class="workflow-card reminder">
              <div>
                <span class="pill muted">${escapeHtml(item.status || '-')}</span>
                <strong>${escapeHtml(reminderTypeText(item.type))}</strong>
                <small>${compactDateTime(item.scheduledAt)} · ${escapeHtml(item.channel || '-')}</small>
              </div>
              <div class="workflow-actions">
                <button class="ghost slim" data-backend-reminder-sent="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '标记已发' : 'Mark sent'}</button>
              </div>
            </article>
          `).join('')}
        </div>
      ` : `<div class="empty-state small-empty">${owner.lang === 'zh' ? '暂无真实任务。可以先在左侧发送一条 mock 进线消息生成报价任务。' : 'No real tasks yet. Send a mock inbound message on the left to generate a quote task.'}</div>`}
    </section>
  `
}

function renderKnowledgeMatchPanel(reply = {}) {
  const knowledge = reply?.knowledgeContext || reply?.data?.knowledgeContext || {}
  const rules = knowledge.matchedRules || []
  const qaEntries = knowledge.matchedQa || []
  const handoffs = knowledge.matchedHandoffRules || []
  const intents = knowledge.intents || []
  if (!rules.length && !qaEntries.length && !handoffs.length && !intents.length) return ''
  const privateNote = owner.lang === 'zh'
    ? '会员等级、定金减免、价格和门店规则属于 Lucky Luxe 私有知识。'
    : 'Member tiers, deposit waivers, prices, and store rules are Lucky Luxe private knowledge.'
  return `
    <section class="knowledge-match-panel">
      <div class="knowledge-match-head">
        <div>
          <h3>${owner.lang === 'zh' ? '命中知识库' : 'Matched Knowledge'}</h3>
          <p>${owner.lang === 'zh' ? '检查 AI 这次回复参考了哪些平台模板与私有规则。' : 'Inspect which platform templates and private rules informed this reply.'}</p>
        </div>
        <span>${escapeHtml((knowledge.version || '').replace('2026-06-26.', ''))}</span>
      </div>
      <div class="knowledge-intents">
        ${(intents.length ? intents : ['unknown']).map((intent) => `<em>${escapeHtml(intent)}</em>`).join('')}
      </div>
      <p class="knowledge-private-note">${privateNote}</p>
      <div class="knowledge-match-grid">
        ${rules.map((rule) => `
          <article class="knowledge-match-card ${rule.scope === 'tenant' ? 'tenant' : 'platform'}">
            <small>${escapeHtml(rule.scope || 'platform')} · ${escapeHtml(rule.status || '')}</small>
            <strong>${escapeHtml(rule.id || '')}</strong>
            <p>${escapeHtml(rule.rule || '')}</p>
          </article>
        `).join('')}
        ${qaEntries.map((entry) => `
          <article class="knowledge-match-card ${entry.scope === 'tenant' ? 'tenant' : 'platform'}">
            <small>${escapeHtml(entry.scope || 'platform')} · ${escapeHtml(entry.intent || '')}</small>
            <strong>${escapeHtml(entry.id || '')}</strong>
            <p>${escapeHtml(entry.customerQuestionZh || entry.answerGuidanceZh || '')}</p>
          </article>
        `).join('')}
        ${handoffs.map((handoff) => `
          <article class="knowledge-match-card handoff">
            <small>${escapeHtml(handoff.type || 'handoff')}</small>
            <strong>${escapeHtml(handoff.id || '')}</strong>
            <p>${escapeHtml(owner.lang === 'zh' ? handoff.customerFacingLineZh : handoff.customerFacingLineEn)}</p>
          </article>
        `).join('')}
      </div>
    </section>
  `
}

function renderWechatLiveDetail(conversation) {
  const transcript = conversation.transcript || []
  const needsHuman = ['needs_human', 'human_active'].includes(conversation.status)
  els.wechatMockDetail.innerHTML = `
    <div class="cs-chat-head">
      <div class="cs-chat-head-main">
        <strong>${escapeHtml(conversationDisplayName(conversation))}</strong>
        <span class="pill muted">${escapeHtml(conversation.sourceChannel || conversation.provider || '-')}</span>
        <span class="pill ${needsHuman ? 'cs-pill-danger' : 'muted'}">${needsHuman ? t('waitingHuman') : t('aiAutoReplied')}</span>
      </div>
      <div class="action-row">
        ${needsHuman
          ? `<button class="ghost slim" data-wechat-release-ai="${escapeHtml(conversation.id)}" type="button">${t('releaseChatToAi')}</button>`
          : `<button class="ghost slim" data-wechat-take-over="${escapeHtml(conversation.id)}" type="button">${t('takeOverChat')}</button>`}
      </div>
    </div>
    <div class="wechat-timeline cs-chat-timeline">
      ${renderWechatTranscript(transcript, conversation)}
    </div>
    <div class="cs-reply-box ${needsHuman ? 'needs-human' : ''}">
      <textarea id="wechatManualReplyText" rows="2" placeholder="${owner.lang === 'zh' ? '输入人工回复…' : 'Type a manual reply…'}"></textarea>
      <div class="action-row cs-reply-actions">
        <button class="ghost slim" data-wechat-manual-reply="${escapeHtml(conversation.id)}" data-release-to-ai="false" type="button">${t('sendKeepHuman')}</button>
        <button class="primary slim" data-wechat-manual-reply="${escapeHtml(conversation.id)}" data-release-to-ai="true" type="button">${t('sendReleaseAi')}</button>
      </div>
    </div>
  `
  requestAnimationFrame(() => {
    const timeline = els.wechatMockDetail.querySelector('.cs-chat-timeline')
    if (timeline) timeline.scrollTop = timeline.scrollHeight
  })
}

function renderWechatMockDetail(session) {
  const state = wechatMockState(session)
  const reply = state.artistReply || session.defaultReply
  const canDo = reply.canDo !== 'no'
  const aiReply = canDo
    ? (owner.lang === 'zh'
      ? `技师确认这款可以做，预估价格 CAD $${reply.price || '待确认'}，预计 ${reply.duration || '待确认'} 分钟。${reply.notes || ''} 如果您想继续，我可以先为您创建预约草稿，最后需要您在小程序里确认时间并支付 CAD $50 定金。`
      : `The technician confirmed this style can be done. Estimated price is CAD $${reply.price || 'TBD'} and estimated duration is ${reply.duration || 'TBD'} minutes. ${reply.notes || ''} If you would like to continue, I can create a booking draft for you. Final confirmation and CAD $50 deposit payment happen in the Mini Program.`)
    : (owner.lang === 'zh'
      ? `技师看过后认为这次需要人工进一步确认：${reply.notes || '目前信息不足。'} 我会先为您转人工处理。`
      : `The technician needs human follow-up for this request: ${reply.notes || 'More information is needed.'} I will route this to a staff member.`)
  els.wechatMockDetail.innerHTML = `
    <div class="wechat-detail-head">
      <div>
        <p class="eyebrow">${t('aiReception')}</p>
        <h2>${escapeHtml(session.customer)}</h2>
        <p class="subtle">${escapeHtml(session.intent)} · ${escapeHtml(session.source)}</p>
      </div>
      <span class="mock-state-pill">${escapeHtml(wechatStatusLabel(session, state))}</span>
    </div>
    <div class="wechat-info-grid">
      <div>
        <strong>${t('quoteElements')}</strong>
        ${session.elements.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
      <div>
        <strong>${t('handoffRoute')}</strong>
        <span>${escapeHtml(session.route)}</span>
        <span>${escapeHtml(session.expected)}</span>
      </div>
    </div>
    <section class="wechat-timeline-section">
      <h3>${t('customerTimeline')}</h3>
      <div class="wechat-timeline">
        ${session.messages.map(([speaker, zh, en]) => `
          <div class="wechat-bubble ${speaker}">
            <span>${speaker === 'assistant' ? 'Lucky Luxe 预约助手' : escapeHtml(session.customer)}</span>
            <p>${escapeHtml(owner.lang === 'zh' ? zh : en)}</p>
          </div>
        `).join('')}
        ${state.quoteStatus === 'quoted' ? `
          <div class="wechat-bubble assistant">
            <span>${t('aiPolishReply')}</span>
            <p>${escapeHtml(aiReply)}</p>
          </div>
        ` : ''}
        ${state.draftStatus ? `
          <div class="wechat-bubble assistant">
            <span>${t('miniProgramLink')}</span>
            <p>${escapeHtml(owner.lang === 'zh' ? `预约草稿：${draftMockLink(session)}。状态：${wechatStatusLabel(session, state)}。` : `Booking draft: ${draftMockLink(session)}. Status: ${wechatStatusLabel(session, state)}.`)}</p>
          </div>
        ` : ''}
      </div>
    </section>
    <section class="quote-workbench">
      <div class="section-row compact-row">
        <h3>${t('staffQuoteWorkbench')}</h3>
        <span class="pill muted">${t('mockOnly')}</span>
      </div>
      <div class="form-grid tight">
        <label>
          <span>${t('artistReply')}</span>
          <select id="wechatQuoteCanDo">
            <option value="yes" ${reply.canDo !== 'no' ? 'selected' : ''}>${t('canDo')}</option>
            <option value="no" ${reply.canDo === 'no' ? 'selected' : ''}>${t('cannotDo')}</option>
          </select>
        </label>
        <label>
          <span>${t('quotePriceCad')}</span>
          <input id="wechatQuotePrice" inputmode="decimal" value="${escapeHtml(reply.price || '')}">
        </label>
        <label>
          <span>${t('quoteDurationMin')}</span>
          <input id="wechatQuoteDuration" inputmode="numeric" value="${escapeHtml(reply.duration || '')}">
        </label>
      </div>
      <label>
        <span>${t('quoteNotes')}</span>
        <textarea id="wechatQuoteNotes" rows="3">${escapeHtml(reply.notes || '')}</textarea>
      </label>
      <div class="action-row wrap">
        <button class="primary slim" data-mock-quote-return="${session.id}" type="button">${t('aiPolishReply')}</button>
        <button class="ghost slim" data-mock-draft-create="${session.id}" type="button">${t('createDraft')}</button>
        <button class="ghost slim" data-mock-reminder="${session.id}" type="button">${t('sendPaymentReminder')}</button>
        <button class="ghost slim" data-mock-release="${session.id}" type="button">${t('releaseDraft')}</button>
      </div>
      <p class="subtle">${t('miniProgramLink')}: ${escapeHtml(draftMockLink(session))}</p>
    </section>
    ${renderWechatBackendWorkflow()}
  `
}

function draftMockLink(session) {
  return `/miniapp/booking-draft/${session.id}?deposit=50CAD`
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
      <p><span>${t('topRatedTechnician')}</span><strong>${escapeHtml(topTech.name)} · ${topTech.completed}${owner.lang === 'zh' ? ' 单' : ''}</strong></p>
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
        <small>${owner.lang === 'zh' ? '本月服务' : 'Services'} ${tech.completed} ${owner.lang === 'zh' ? '单' : ''}</small>
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

  const staffTimeline = !isOwnerRole() ? renderStaffTodayTimeline() : ''
  const bookings = filteredBookings()
  if (!bookings.length) {
    els.bookingList.innerHTML = `
      ${staffTimeline}
      <div class="empty-state"><strong>${t('noBookings')}</strong><span>${t('adjustFilters')}</span></div>
    `
    return
  }
  const grouped = groupByDate(bookings)
  els.bookingList.innerHTML = `
    ${staffTimeline}
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
  const date = owner.adminView === 'today' ? storeToday() : els.filterDate.value
  const search = (owner.bookingSearch || '').trim().toLowerCase()
  return owner.bookings
    .filter((booking) => !date || booking.appointmentDate === date)
    .filter((booking) => {
      if (status === 'all') return true
      if (status === 'active') return activeStatuses().includes(booking.status)
      return booking.status === status
    })
    .filter((booking) => {
      if (!search) return true
      const haystack = [
        booking.user?.display_name, booking.user?.email, booking.user?.phone,
        booking.publicCode, booking.id, booking.service?.name, booking.technician?.name
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(search)
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
  const today = storeToday()
  return date === today ? `${t('today')} · ${date}` : date
}

// 服务安全:订单上直接亮出顾客的过敏史/忌讳标签与服务前备注,技师上钟前必看
function renderCustomerCare(booking) {
  const care = booking.customerCare || {}
  const tags = care.tags || []
  if (!tags.length && !care.notes) return ''
  return `
    <div class="customer-care-strip">
      ${tags.map((tag) => `<span class="customer-tag care-tag">⚠ ${escapeHtml(tag)}</span>`).join('')}
      ${care.notes ? `<span class="care-note">📌 ${escapeHtml(care.notes)}</span>` : ''}
    </div>`
}

// 员工端:我的今日时间线——按时间排今天自己的单,一眼看完该知道的事
function renderStaffTodayTimeline() {
  const zh = owner.lang === 'zh'
  const today = (owner.bookings || [])
    .filter((booking) => isToday(booking.appointmentDate) && booking.status !== 'CANCELLED' && booking.status !== 'EXPIRED')
    .sort((a, b) => String(a.appointmentTime).localeCompare(String(b.appointmentTime)))
  // 待传作品/待审核入口放在这里(员工端没有首页,这张卡是员工每天必看的地方)
  const missingWork = (owner.bookings || []).filter((booking) => booking.status === 'COMPLETED' && !(booking.workImages || []).length && booking.galleryStatus !== 'approved').length
  const reviewCount = galleryGroups().filter((group) => group.booking.galleryStatus !== 'approved' && (group.images || []).length).length
  return `
    <section class="staff-timeline-card card">
      <div class="section-row compact-row">
        <h2>${zh ? '我的今天' : 'My Day'}</h2>
        <div class="staff-day-chips">
          ${missingWork ? `<button class="staff-day-chip chip-warn" data-admin-page="aiGallery" type="button">📷 ${zh ? '待传作品' : 'Missing photos'} ${missingWork}</button>` : ''}
          ${reviewCount ? `<button class="staff-day-chip" data-admin-page="aiGallery" type="button">${zh ? '待审核图' : 'For review'} ${reviewCount}</button>` : ''}
          <span class="subtle">${today.length ? `${today.length} ${zh ? '单' : 'bookings'}` : (zh ? '今天没有预约' : 'No bookings today')}</span>
        </div>
      </div>
      ${today.length ? today.map((booking) => `
        <div class="staff-timeline-row ${booking.status === 'COMPLETED' ? 'is-done' : ''}">
          <strong class="stl-time">${booking.appointmentTime}<small>–${booking.appointmentEndTime}</small></strong>
          <div class="stl-main">
            <strong>${escapeHtml(booking.user?.displayName || booking.publicCode)}</strong>
            <span>${escapeHtml(booking.service?.name || '-')} · ${booking.totalDurationMin || ''}${zh ? ' 分钟' : ' min'}</span>
            ${renderCustomerCare(booking)}
          </div>
          <span class="status ${booking.status}">${statusLabel(booking.status)}</span>
        </div>`).join('') : ''}
    </section>`
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
        <p>${t('depositLabel')} ${money(booking.depositCents)} · ${t('finalDue')} ${money(booking.finalDueCents)} · ${booking.publicCode}</p>
        ${renderCustomerCare(booking)}
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
    <button class="calendar-cell ${key === storeToday() ? 'today-cell' : ''}" data-calendar-date="${key}" type="button">
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
  const aiHint = `<p class="services-ai-hint">💡 ${owner.lang === 'zh' ? '此价目表是 AI 客服报价的唯一事实来源:改价格、时长、上下架,AI 的回答立即跟着变。' : 'This price list is the single source of truth for AI quotes — changes apply to AI answers instantly.'}</p>`
  if (!owner.services.length) {
    els.serviceAdminList.innerHTML = `${aiHint}<div class="empty-state"><strong>${t('noServices')}</strong></div>`
    return
  }
  els.serviceAdminList.innerHTML = aiHint + owner.services.map((service) => `
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
      <label class="service-active-toggle">
        <input type="checkbox" data-service-active="${service.id}" ${service.isActive ? 'checked' : ''}>
        <span class="status ${service.isActive ? 'CONFIRMED' : 'CANCELLED'}">${service.isActive ? t('active') : t('hidden')}</span>
      </label>
    </div>
  `).join('')
}

async function toggleServiceActive(serviceId, isActive) {
  const service = owner.services.find((item) => item.id === serviceId)
  // 乐观更新:先改界面,失败再回滚——开关和状态徽章即时同步
  if (service) service.isActive = isActive
  renderServices()
  try {
    await request(`/admin/services/${serviceId}`, { method: 'PATCH', body: JSON.stringify({ isActive }) })
    toast(owner.lang === 'zh' ? (isActive ? '已上架,AI 立即可报价此服务' : '已下架,AI 不再推荐此服务') : 'Updated')
  } catch (error) {
    if (service) service.isActive = !isActive
    renderServices()
    throw error
  }
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
    imageUrl: '/assets/images/nail-addon.jpg',
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
    imageUrl: service.imageUrl || '/assets/images/nail-addon.jpg',
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

// ===== 周排班网格 =====
function mondayOf(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return formatDate(d)
}

async function loadScheduleWeek(from) {
  owner.scheduleWeekFrom = from || owner.scheduleWeekFrom || mondayOf(new Date(`${storeToday()}T12:00:00`))
  const data = await request(`/admin/schedule-week?from=${owner.scheduleWeekFrom}`)
  owner.scheduleWeek = data
  owner.scheduleWeekFrom = data.weekStart
  renderScheduleWeek()
}

function scheduleCellState(techId, day) {
  const override = (owner.scheduleWeek?.schedules || []).find((row) => row.technicianId === techId && row.date === day.date)
  if (override) {
    return { working: override.isWorking, start: override.startTime, end: override.endTime, source: 'override' }
  }
  // 无记录 = 跟随门店:店开则默认上班(门店时段)
  return { working: !day.isClosed, start: day.openTime, end: day.closeTime, source: 'default' }
}

function renderScheduleWeek() {
  if (!els.scheduleWeekGrid) return
  const week = owner.scheduleWeek
  els.scheduleWeekToolbar?.classList.toggle('hidden', !isOwnerRole())
  if (!week) {
    els.scheduleWeekGrid.innerHTML = `
      <div class="empty-state small-empty">
        <p>${owner.lang === 'zh' ? '排班数据没有加载成功(服务器可能刚重启)。' : 'Schedule data failed to load.'}</p>
        <button class="ghost slim" data-week-nav="0" type="button">${owner.lang === 'zh' ? '重新加载' : 'Retry'}</button>
      </div>`
    return
  }
  const zh = owner.lang === 'zh'
  const weekdayNames = zh ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const today = storeToday()
  const countFor = (techId, date) => (week.bookingCounts || []).find((row) => row.technicianId === techId && row.date === date)?.count || 0
  const techs = (week.technicians || []).filter((tech) => tech.isActive)
  const header = `<div class="swg-row swg-head">
    <div class="swg-tech-col">${zh ? '技师' : 'Tech'}</div>
    ${week.days.map((day) => `
      <div class="swg-day ${day.date === today ? 'is-today' : ''} ${day.isClosed ? 'is-closed-day' : ''}">
        <strong>${zh ? '周' : ''}${weekdayNames[day.weekday]}</strong>
        <small>${day.date.slice(5)}</small>
        ${day.isClosed ? `<small class="swg-closed-tag">${zh ? '店休' : 'Closed'}</small>` : ''}
      </div>`).join('')}
  </div>`
  const rows = techs.map((tech) => `<div class="swg-row">
    <div class="swg-tech-col"><strong>${escapeHtml(tech.name)}</strong><small>${escapeHtml(tech.title || '')}</small></div>
    ${week.days.map((day) => {
      const state = scheduleCellState(tech.id, day)
      const bookings = countFor(tech.id, day.date)
      const conflict = state.working && day.isClosed
      const classes = ['swg-cell', state.working ? 'is-working' : 'is-off', conflict ? 'is-conflict' : '', day.date === today ? 'is-today' : ''].filter(Boolean).join(' ')
      const body = state.working
        ? `<strong>${state.start}–${state.end}</strong>${bookings ? `<small class="swg-count">${bookings} ${zh ? '单' : ''}</small>` : ''}${conflict ? `<small class="swg-warn">⚠ ${zh ? '店休日' : 'closed day'}</small>` : ''}`
        : `<strong>${zh ? '休' : 'Off'}</strong>${bookings ? `<small class="swg-warn">⚠ ${bookings} ${zh ? '单已约' : 'booked'}</small>` : ''}`
      return isOwnerRole()
        ? `<button class="${classes}" data-swg-tech="${escapeHtml(tech.id)}" data-swg-date="${day.date}" type="button">${body}</button>`
        : `<button class="${classes}" data-swg-request-date="${day.date}" type="button" title="${zh ? '点击发起排班申请' : 'Request a change'}">${body}</button>`
    }).join('')}
  </div>`).join('')
  els.scheduleWeekGrid.innerHTML = header + (rows || `<div class="empty-state small-empty">${zh ? '暂无在职技师' : 'No active technicians'}</div>`) + renderScheduleRequestsPanel()
}

// 排班申请面板:员工看自己的申请与结果;老板看待处理队列并审批
function renderScheduleRequestsPanel() {
  const zh = owner.lang === 'zh'
  const requests = owner.scheduleRequests || []
  const statusText = (req) => req.status === 'pending'
    ? (zh ? '待老板处理' : 'Pending')
    : req.status === 'rejected'
      ? (zh ? '已拒绝' : 'Rejected')
      : (req.resolution === 'set-off' ? (zh ? '已批准(当天休息)' : 'Approved (off)') : (zh ? '已处理' : 'Handled'))
  if (!isOwnerRole()) {
    return `
      <div class="schedule-requests-panel">
        <h4>${zh ? '我的排班申请' : 'My requests'}</h4>
        <p class="subtle">${zh ? '点上面自己的格子即可发起申请(想休/想换时段),老板确认后生效。' : 'Click one of your cells above to request a change.'}</p>
        ${requests.length ? requests.slice(0, 8).map((req) => `
          <div class="schedule-request-row">
            <strong>${req.date}</strong>
            <span class="subtle">${escapeHtml(req.note || '')}</span>
            <span class="schreq-status schreq-${req.status}">${statusText(req)}</span>
          </div>`).join('') : `<p class="subtle">${zh ? '暂无申请记录。' : 'No requests yet.'}</p>`}
      </div>`
  }
  const pending = requests.filter((req) => req.status === 'pending')
  if (!pending.length) return ''
  return `
    <div class="schedule-requests-panel">
      <h4>${zh ? `排班申请(${pending.length} 条待处理)` : `Schedule requests (${pending.length})`}</h4>
      ${pending.map((req) => `
        <div class="schedule-request-row">
          <strong>${escapeHtml(req.technicianName)} · ${req.date}</strong>
          <span class="subtle">${escapeHtml(req.note || (zh ? '(无留言)' : ''))}</span>
          <span class="schreq-actions">
            <button class="ghost slim" data-schreq-action="set-off" data-schreq-id="${req.id}" type="button">${zh ? '批准并设为休息' : 'Approve: off'}</button>
            <button class="ghost slim" data-schreq-action="handled" data-schreq-id="${req.id}" type="button">${zh ? '已手动调整' : 'Handled'}</button>
            <button class="ghost slim danger-ghost" data-schreq-action="reject" data-schreq-id="${req.id}" type="button">${zh ? '拒绝' : 'Reject'}</button>
          </span>
        </div>`).join('')}
    </div>`
}

async function submitScheduleRequest(date) {
  const zh = owner.lang === 'zh'
  const note = window.prompt(zh
    ? `向老板申请调整 ${date} 的排班。留言(例如:想休一天 / 想改成 12:00-18:00):`
    : `Request a change for ${date}. Note for the owner:`)
  if (note === null) return
  await request('/admin/schedule-requests', { method: 'POST', body: JSON.stringify({ date, note: note.trim() }) })
  toast(zh ? '申请已发给老板,处理结果会显示在下方列表' : 'Request sent')
  const data = await request('/admin/schedule-requests')
  owner.scheduleRequests = data.requests
  renderScheduleWeek()
}

async function resolveScheduleRequest(id, action) {
  const zh = owner.lang === 'zh'
  await request(`/admin/schedule-requests/${id}/${action}`, { method: 'POST' })
  toast(zh ? (action === 'reject' ? '已拒绝' : action === 'set-off' ? '已批准,当天已设为休息' : '已标记处理') : 'Done')
  const data = await request('/admin/schedule-requests')
  owner.scheduleRequests = data.requests
  await loadScheduleWeek(owner.scheduleWeekFrom)
}

async function toggleScheduleCell(techId, date) {
  const week = owner.scheduleWeek
  const zh = owner.lang === 'zh'
  const day = week?.days.find((item) => item.date === date)
  if (!day) {
    toast(zh ? '排班数据未加载,正在重新拉取…' : 'Schedule data missing, reloading…')
    await loadScheduleWeek(owner.scheduleWeekFrom)
    return
  }
  const state = scheduleCellState(techId, day)
  const bookings = (week.bookingCounts || []).find((row) => row.technicianId === techId && row.date === date)?.count || 0
  if (state.working && bookings > 0) {
    const ok = window.confirm(zh
      ? `该技师当天已有 ${bookings} 个预约,确定改成休息吗?已有预约不会自动取消,需要另行联系顾客。`
      : `This technician has ${bookings} booking(s) that day. Mark as off anyway? Existing bookings are not cancelled automatically.`)
    if (!ok) return
  }
  const nextWorking = !state.working
  const startTime = els.scheduleStart?.value || day.openTime
  const endTime = els.scheduleEnd?.value || day.closeTime
  // 乐观更新:格子立刻翻转,失败回滚
  const overrides = week.schedules || (week.schedules = [])
  const existing = overrides.find((row) => row.technicianId === techId && row.date === date)
  const backup = existing ? { ...existing } : null
  if (existing) Object.assign(existing, { isWorking: nextWorking, startTime, endTime })
  else overrides.push({ technicianId: techId, date, isWorking: nextWorking, startTime, endTime })
  renderScheduleWeek()
  try {
    await request(`/admin/technicians/${techId}/schedule`, {
      method: 'PATCH',
      body: JSON.stringify({ date, startTime, endTime, isWorking: nextWorking })
    })
    toast(zh
      ? (nextWorking ? `${date.slice(5)} 已排班 ${startTime}–${endTime}` : `${date.slice(5)} 已改为休息`)
      : (nextWorking ? `Scheduled ${startTime}–${endTime}` : 'Marked off'))
    await loadScheduleWeek(owner.scheduleWeekFrom)
  } catch (error) {
    if (backup) Object.assign(existing, backup)
    else overrides.splice(overrides.findIndex((row) => row.technicianId === techId && row.date === date), 1)
    renderScheduleWeek()
    throw error
  }
}

async function applyWeekPatternForward() {
  const week = owner.scheduleWeek
  if (!week) return
  const zh = owner.lang === 'zh'
  if (!window.confirm(zh ? '把本周每位技师的上/休模式复制到未来 4 周?(会覆盖那几周已有的排班)' : 'Copy this week pattern to the next 4 weeks? Existing entries will be overwritten.')) return
  const entries = []
  for (const tech of (week.technicians || []).filter((item) => item.isActive)) {
    for (const day of week.days) {
      const state = scheduleCellState(tech.id, day)
      for (let w = 1; w <= 4; w += 1) {
        const target = new Date(`${day.date}T12:00:00`)
        target.setDate(target.getDate() + w * 7)
        entries.push({ technicianId: tech.id, date: formatDate(target), startTime: state.start, endTime: state.end, isWorking: state.working })
      }
    }
  }
  const result = await request('/admin/schedule-batch', { method: 'POST', body: JSON.stringify({ entries }) })
  toast(zh ? `已应用到未来 4 周(${result.applied} 条)` : `Applied to next 4 weeks (${result.applied} entries)`)
}

async function addTechnicianPrompt() {
  const zh = owner.lang === 'zh'
  const name = window.prompt(zh ? '技师姓名:' : 'Technician name:')
  if (!name || !name.trim()) return
  const title = window.prompt(zh ? '职称(可留空,例如:美甲师/美睫师):' : 'Title (optional):') || ''
  await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: name.trim(), title: title.trim() }) })
  toast(zh ? '技师已添加,默认可做所有在售服务' : 'Technician added')
  await loadAll()
  await loadScheduleWeek(owner.scheduleWeekFrom).catch(() => {})
}

function renderTechnicianPerformance() {
  const zh = owner.lang === 'zh'
  const rows = technicianPerformanceRows()
  els.addTechnicianButton?.classList.toggle('hidden', !isOwnerRole())
  els.salaryPlanButton?.classList.toggle('hidden', !isOwnerRole())
  applyStaffTab() // 员工管理两板块可见性(含 考勤/核查 卡仅老板)
  // 单卡(员工端只看自己)时铺满整行,数据块均匀展开,不留大片空白
  els.technicianPerformance.classList.toggle('single-card', rows.length === 1)
  if (!rows.length) {
    els.technicianPerformance.innerHTML = `<div class="empty-state small-empty">${t('noDetailItems')}</div>`
    return
  }
  els.technicianPerformance.innerHTML = rows.map((tech) => {
    const raw = owner.technicians.find((item) => item.id === tech.id) || {}
    const inactive = raw.is_active === 0 || raw.is_active === false
    return `
    <article class="technician-performance-card ${inactive ? 'is-inactive' : ''}">
      <div>
        <h3>${escapeHtml(tech.name)}${inactive ? `<span class="tech-inactive-tag">${zh ? '已停用' : 'Inactive'}</span>` : ''}</h3>
        <p>${escapeHtml(tech.title || '')} ${inactive ? '' : `· ${t('techStatus')} ${escapeHtml(tech.status)}`}</p>
      </div>
      <div class="performance-numbers">
        <span>${zh ? '本月服务' : 'Services'} <strong>${tech.completed} ${zh ? '单' : ''}</strong></span>
        <span>${zh ? '本月业绩' : 'Amount'} <strong>${money(tech.amount)}</strong></span>
        ${!isOwnerRole() && owner.myCompEstimate ? `
        <span>${zh ? '预计本月薪酬' : 'Est. pay'} <strong title="${zh ? `底薪 ${money(owner.myCompEstimate.baseSalaryCents)} + 提成 ${Math.round(owner.myCompEstimate.commissionRate * 100)}% × 业绩` : ''}">${money(owner.myCompEstimate.totalCents)}</strong></span>` : ''}
      </div>
      ${!isOwnerRole() && owner.myCompEstimate ? `<p class="subtle comp-estimate-note">${zh ? `底薪 ${money(owner.myCompEstimate.baseSalaryCents)} + 提成 ${money(owner.myCompEstimate.commissionCents)}(${Math.round(owner.myCompEstimate.commissionRate * 100)}%),以老板月结确认为准。` : 'Base + commission; final amount confirmed at monthly settlement.'}</p>` : ''}
      ${isOwnerRole() ? `
      <div class="tech-manage-row">
        <button class="ghost slim" data-tech-edit="${escapeHtml(tech.id)}" type="button">${zh ? '编辑资料' : 'Edit'}</button>
        <button class="ghost slim ${inactive ? '' : 'danger-ghost'}" data-tech-toggle="${escapeHtml(tech.id)}" type="button">${inactive ? (zh ? '恢复在职' : 'Reactivate') : (zh ? '停用' : 'Deactivate')}</button>
      </div>` : ''}
    </article>
  `
  }).join('')
    + (!isOwnerRole() ? renderMyQuoteHistory() : '')
    + (!isOwnerRole() ? `<p class="staff-performance-note">${t('staffPerformanceHint')}</p>` : '')
}

// 员工端:我的报价记录——报过什么价、结果如何,既是复盘也是话术沉淀
function renderMyQuoteHistory() {
  const zh = owner.lang === 'zh'
  const myTechId = (owner.technicians || [])[0]?.id
  const quotes = (owner.quoteRequests || [])
    .filter((item) => item.technicianId === myTechId)
    .slice(0, 10)
  return `
    <article class="my-quote-history">
      <h3>${zh ? '我的报价记录' : 'My quote history'}</h3>
      ${quotes.length ? quotes.map((quote) => `
        <div class="quote-history-row">
          <span class="qh-date">${String(quote.updatedAt || quote.createdAt || '').slice(0, 10)}</span>
          <span class="qh-message">${escapeHtml((quote.customerMessage || '-').slice(0, 40))}</span>
          <span class="qh-price">${quote.staffPriceCents ? money(quote.staffPriceCents) : (zh ? '未报价' : '-')}</span>
          <span class="qh-status">${escapeHtml(quoteStatusText(quote.status))}</span>
        </div>`).join('') : `<p class="subtle">${zh ? '暂无报价记录。工作台里回复的报价会沉淀在这里。' : 'Quotes you answer will appear here.'}</p>`}
    </article>`
}

// 员工登录账号管理:生成/重置密码/停用启用(初始密码只显示一次)
function renderTechAccountControls(techId, zh) {
  const account = (owner.staffAccounts || []).find((item) => item.technicianId === techId)
  if (!account) {
    return `<button class="ghost slim" data-acct-create="${escapeHtml(techId)}" type="button">${zh ? '生成登录账号' : 'Create login'}</button>`
  }
  const disabled = account.status !== 'active'
  return `
    <span class="tech-account-name" title="${zh ? '登录用户名' : 'Username'}">${escapeHtml(account.username)}${disabled ? (zh ? '(已停用)' : ' (disabled)') : ''}</span>
    <button class="ghost slim" data-acct-reset="${escapeHtml(account.id)}" type="button">${zh ? '重置密码' : 'Reset password'}</button>
    <button class="ghost slim ${disabled ? '' : 'danger-ghost'}" data-acct-toggle="${escapeHtml(account.id)}" type="button">${disabled ? (zh ? '启用账号' : 'Enable') : (zh ? '停用账号' : 'Disable')}</button>`
}

function showCredentialsOnce(username, password) {
  const zh = owner.lang === 'zh'
  window.prompt(
    zh ? '账号已就绪(初始密码只显示这一次,复制后发给员工;员工首次登录会被要求改密):' : 'Copy and send to the staff member (shown only once):',
    `${zh ? '用户名' : 'Username'}: ${username}  ${zh ? '初始密码' : 'Password'}: ${password}`
  )
}

async function refreshStaffAccounts() {
  const data = await request('/admin/staff-accounts')
  owner.staffAccounts = data.accounts
  renderTechnicianPerformance()
}

async function editTechnicianPrompt(techId) {
  const zh = owner.lang === 'zh'
  const tech = owner.technicians.find((item) => item.id === techId)
  if (!tech) return
  const name = window.prompt(zh ? '技师姓名:' : 'Name:', tech.name)
  if (name === null) return
  const title = window.prompt(zh ? '职称:' : 'Title:', tech.title || '')
  if (title === null) return
  await request(`/admin/technicians/${techId}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() || tech.name, title: title.trim() }) })
  toast(zh ? '已保存' : 'Saved')
  await loadAll()
}

async function toggleTechnicianActive(techId) {
  const zh = owner.lang === 'zh'
  const tech = owner.technicians.find((item) => item.id === techId)
  if (!tech) return
  const nowActive = !(tech.is_active === 0 || tech.is_active === false)
  if (nowActive && !window.confirm(zh ? `停用「${tech.name}」?停用后不再接受新预约,历史数据保留。` : `Deactivate ${tech.name}? No new bookings; history is kept.`)) return
  await request(`/admin/technicians/${techId}`, { method: 'PATCH', body: JSON.stringify({ isActive: !nowActive }) })
  toast(zh ? (nowActive ? '已停用' : '已恢复在职') : 'Updated')
  await loadAll()
  await loadScheduleWeek(owner.scheduleWeekFrom).catch(() => {})
}

function sortedCustomers() {
  const mode = els.customerSort.value || 'alpha'
  return [...owner.customers].sort((a, b) => {
    if (mode === 'visits') return (b.visitCount || 0) - (a.visitCount || 0) || customerName(a).localeCompare(customerName(b))
    if (mode === 'recent') return new Date(b.lastVisitAt || 0) - new Date(a.lastVisitAt || 0)
    if (mode === 'spent') return (b.totalSpentCents || 0) - (a.totalSpentCents || 0) || customerName(a).localeCompare(customerName(b))
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

const MEMBER_TIER_STYLES = {
  Silver: 'tier-silver',
  Gold: 'tier-gold',
  Platinum: 'tier-platinum',
  Diamond: 'tier-diamond'
}

function memberTierBadge(customer) {
  const tier = customer.memberTier || 'Silver'
  return `<span class="member-tier-badge ${MEMBER_TIER_STYLES[tier] || 'tier-silver'}">${escapeHtml(tier)}</span>`
}

// RFM 分层(与小程序客户库同口径,默认阈值;详细微调在小程序「⚙ 规则」)
function rfmTierOf(c) {
  const visits = c.completedCount || 0
  if (!visits) return null
  const days = (iso2) => iso2 ? Math.floor((Date.now() - new Date(iso2).getTime()) / 86400000) : 9999
  const lastD = days(c.lastCompletedAt)
  if (lastD > 60) return { k: 's', label: owner.lang === 'zh' ? '沉睡S' : 'Dormant', color: '#8a5a52' }
  if (lastD <= 45 && visits >= 3 && (c.totalSpentCents || 0) >= 50000) return { k: 'a', label: owner.lang === 'zh' ? '高价值A' : 'VIP', color: '#b5885d' }
  if (days(c.firstVisitAt) <= 30) return { k: 'n', label: owner.lang === 'zh' ? '新客N' : 'New', color: '#3b6ea5' }
  return { k: 'b', label: owner.lang === 'zh' ? '回头客B' : 'Repeat', color: '#3f6b52' }
}

function renderCustomers() {
  if (owner.selectedCustomerId) {
    renderCustomerDetail()
    return
  }
  const search = (owner.customerSearch || '').trim().toLowerCase()
  const customers = sortedCustomers().filter((customer) => {
    if (!search) return true
    return [customerName(customer), customer.email, customer.phone, customer.memberCode]
      .filter(Boolean).join(' ').toLowerCase().includes(search)
  })
  if (!customers.length) {
    els.customerList.innerHTML = `<div class="empty-state"><strong>${search ? (owner.lang === 'zh' ? '没有匹配的客户' : 'No matches') : t('noCustomers')}</strong></div>`
    return
  }
  // 分层汇总条(全量客户口径,不受搜索影响)
  const tierCounts = { a: 0, b: 0, n: 0, s: 0 }
  ;(owner.customers || []).forEach((c) => { const tr = rfmTierOf(c); if (tr) tierCounts[tr.k] += 1 })
  const tierBar = `<div class="subtle" style="margin:0 0 10px 2px">${owner.lang === 'zh'
    ? `客户分层:高价值A <strong>${tierCounts.a}</strong> · 回头客B <strong>${tierCounts.b}</strong> · 新客N <strong>${tierCounts.n}</strong> · 沉睡S <strong>${tierCounts.s}</strong>(自动按 最近到店/频率/累计消费;名单动作与阈值微调在小程序客户库)`
    : `Tiers: VIP ${tierCounts.a} · Repeat ${tierCounts.b} · New ${tierCounts.n} · Dormant ${tierCounts.s}`}</div>`
  els.customerList.innerHTML = tierBar + customers.map((customer) => `
    <article class="customer-profile-card card">
      <div class="customer-avatar">${customerName(customer).slice(0, 1).toUpperCase()}</div>
      <div>
        <h3>${escapeHtml(customerName(customer))} ${memberTierBadge(customer)}${(() => { const tr = rfmTierOf(customer); return tr ? ` <span style="font-size:11px;font-weight:800;color:#fff;background:${tr.color};border-radius:5px;padding:2px 8px;vertical-align:middle">${tr.label}</span>` : '' })()}</h3>
        <p class="subtle">${escapeHtml(customer.memberCode || '')}${customer.birthday ? ` · 🎂 ${escapeHtml(customer.birthday)}` : ''}</p>
        <p class="customer-contact">${escapeHtml([customer.phone, customer.email].filter(Boolean).join(' · ') || '-')}</p>
        ${(customer.tags || []).length ? `<div class="customer-tags">${customer.tags.slice(0, 3).map((tag) => `<span class="customer-tag">${escapeHtml(tag)}</span>`).join('')}${customer.tags.length > 3 ? `<span class="customer-tag">+${customer.tags.length - 3}</span>` : ''}</div>` : ''}
        <div class="inline-actions compact-actions customer-card-actions">
          <button class="ghost slim" data-customer-detail="${customer.id}" type="button">${t('viewCustomerFile')}</button>
          <button class="ghost slim" data-ai-customer="${customer.id}" type="button">${owner.aiLoading === `customer:${customer.id}` ? t('aiProcessing') : t('aiCustomerInsight')}</button>
          ${(() => { const tr = rfmTierOf(customer); return tr && tr.k === 's' ? `<button class="ghost slim" data-recall-copy="${customer.id}" type="button">✦ ${owner.lang === 'zh' ? 'AI 召回' : 'Recall'}</button>` : '' })()}
        </div>
      </div>
      <div class="customer-stats">
        <span>${t('visits')} <strong>${customer.visitCount || 0}</strong></span>
        <span>${t('lastVisit')} <strong>${dateOnly(customer.lastVisitAt)}</strong></span>
        <span>${t('totalSpent')} <strong>${money(customer.totalSpentCents || 0)}</strong></span>
        ${customer.storedValueBalanceCents > 0 ? `<span>${owner.lang === 'zh' ? '储值余额' : 'Stored value'} <strong>${money(customer.storedValueBalanceCents)}</strong></span>` : ''}
      </div>
      ${owner.aiResults[`customer:${customer.id}`] ? renderCustomerInsight(owner.aiResults[`customer:${customer.id}`].data || owner.aiResults[`customer:${customer.id}`]) : ''}
    </article>
  `).join('')
}

async function saveCustomerProfile(customerId) {
  const zh = owner.lang === 'zh'
  const payload = {
    tags: (document.querySelector('#customerTagsInput')?.value || '').split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean),
    notes: document.querySelector('#customerNotesInput')?.value || '',
    birthday: (document.querySelector('#customerBirthdayInput')?.value || '').trim()
  }
  const result = await request(`/admin/customers/${customerId}/profile`, { method: 'PATCH', body: JSON.stringify(payload) })
  const customer = owner.customers.find((item) => item.id === customerId)
  if (customer) Object.assign(customer, result.customer)
  toast(zh ? '运营信息已保存' : 'Saved')
  renderCustomers()
}

function customerBookings(customerId) {
  return owner.bookings
    .filter((booking) => booking.user?.id === customerId)
    .sort((a, b) => `${b.appointmentDate} ${b.appointmentTime}`.localeCompare(`${a.appointmentDate} ${a.appointmentTime}`))
}

function renderCustomerDetail() {
  const customer = owner.customers.find((item) => item.id === owner.selectedCustomerId)
  if (!customer) {
    owner.selectedCustomerId = ''
    renderCustomers()
    return
  }
  const bookings = customerBookings(customer.id)
  els.customerList.innerHTML = `
    <section class="customer-detail-page">
      <button class="ghost slim" data-customer-back type="button">← ${t('backToCustomers')}</button>
      <article class="customer-detail-hero card">
        <div class="customer-avatar large">${customerName(customer).slice(0, 1).toUpperCase()}</div>
        <div>
          <p class="eyebrow">${t('customers')}</p>
          <h2>${escapeHtml(customerName(customer))} ${memberTierBadge(customer)}</h2>
          <p class="subtle">${escapeHtml(customer.memberCode || '')}</p>
          <p>${escapeHtml(customer.email || '-')}</p>
          <p>${escapeHtml(customer.phone || '-')}</p>
        </div>
        <div class="customer-stats">
          <span>${t('visits')} <strong>${customer.visitCount || 0}</strong></span>
          <span>${t('lastVisit')} <strong>${dateOnly(customer.lastVisitAt)}</strong></span>
          <span>${t('totalSpent')} <strong>${money(customer.totalSpentCents || 0)}</strong></span>
          <span>${owner.lang === 'zh' ? '储值余额' : 'Stored value'} <strong>${money(customer.storedValueBalanceCents || 0)}</strong></span>
        </div>
      </article>
      <section class="customer-profile-edit card">
        <div class="section-row compact-row">
          <div>
            <p class="eyebrow">${owner.lang === 'zh' ? '运营信息' : 'Care profile'}</p>
            <h2>${owner.lang === 'zh' ? '标签 · 备注 · 生日' : 'Tags · Notes · Birthday'}</h2>
          </div>
          ${(() => {
            const conv = (owner.wechatConversations || []).find((item) => item.linkedUserId === customer.id)
            return conv ? `<button class="ghost slim" data-customer-open-chat="${escapeHtml(conv.id)}" type="button">${owner.lang === 'zh' ? '查看会话记录 →' : 'View conversations →'}</button>` : ''
          })()}
        </div>
        <div class="customer-profile-form">
          <label>
            <span>${owner.lang === 'zh' ? '标签(逗号分隔,例如:对甲油胶过敏, 偏好裸色系, 怕痛)' : 'Tags (comma separated)'}</span>
            <input id="customerTagsInput" value="${escapeHtml((customer.tags || []).join(', '))}" placeholder="${owner.lang === 'zh' ? '过敏史 / 偏好 / 忌讳…' : 'Allergies / preferences…'}">
          </label>
          <label>
            <span>${owner.lang === 'zh' ? '生日(MM-DD 或 YYYY-MM-DD)' : 'Birthday (MM-DD or YYYY-MM-DD)'}</span>
            <input id="customerBirthdayInput" value="${escapeHtml(customer.birthday || '')}" placeholder="08-16">
          </label>
          <label class="customer-notes-label">
            <span>${owner.lang === 'zh' ? '备注(技师服务前须知)' : 'Notes (for technicians)'}</span>
            <textarea id="customerNotesInput" rows="3" placeholder="${owner.lang === 'zh' ? '例如:美睫只用低刺激胶水;上次做过延长甲。' : 'e.g. sensitive to standard lash glue.'}">${escapeHtml(customer.notes || '')}</textarea>
          </label>
          <button class="primary slim" data-customer-profile-save="${escapeHtml(customer.id)}" type="button">${owner.lang === 'zh' ? '保存运营信息' : 'Save'}</button>
        </div>
      </section>
      <section class="customer-records card" id="customerNotesSection">
        <div class="section-row compact-row">
          <div>
            <p class="eyebrow">${owner.lang === 'zh' ? '服务小记 · 画像' : 'Service Notes · Profile'}</p>
            <h2>${owner.lang === 'zh' ? '技师小记与自动画像' : 'Notes & auto profile'}</h2>
          </div>
          ${(() => { const tr = rfmTierOf(customer); return tr && tr.k === 's' ? `<button class="ghost slim" data-recall-copy="${escapeHtml(customer.id)}" type="button">✦ ${owner.lang === 'zh' ? 'AI 召回话术' : 'AI recall message'}</button>` : '' })()}
        </div>
        <div id="customerNotesBody"><p class="subtle">${owner.lang === 'zh' ? '加载小记与画像…' : 'Loading…'}</p></div>
      </section>
      <section class="customer-records card">
        <div class="section-row compact-row">
          <div>
            <p class="eyebrow">${t('customerRecords')}</p>
            <h2>${escapeHtml(customerName(customer))}</h2>
          </div>
          <button class="ghost slim" data-ai-customer="${customer.id}" type="button">${owner.aiLoading === `customer:${customer.id}` ? t('aiProcessing') : t('aiCustomerInsight')}</button>
        </div>
        ${owner.aiResults[`customer:${customer.id}`] ? renderCustomerInsight(owner.aiResults[`customer:${customer.id}`].data || owner.aiResults[`customer:${customer.id}`]) : ''}
        ${bookings.length ? bookings.map(renderCustomerRecord).join('') : `<div class="empty-state small-empty">${t('noCustomerRecords')}</div>`}
      </section>
    </section>
  `
  loadCustomerNotes(customer.id)
}

// 2026-08-02 服务小记+画像(只读;与小程序画像页同一 /admin/customers/:id/notes 口径)
function loadCustomerNotes(customerId) {
  if (!document.querySelector('#customerNotesBody')) return
  const zh = owner.lang === 'zh'
  request(`/admin/customers/${customerId}/notes`)
    .then((data) => {
      const target = document.querySelector('#customerNotesBody')
      if (!target || owner.selectedCustomerId !== customerId) return // 用户已切走,丢弃
      const p = data.profile || {}
      const tag = (text, danger) => `<span class="customer-tag"${danger ? ' style="background:#b0483c;color:#fff;font-weight:700"' : ''}>${escapeHtml(text)}</span>`
      const groups = [
        [zh ? '⚠ 安全' : '⚠ Safety', p.safetyFlags || [], true],
        [zh ? '款式' : 'Styles', p.styles || [], false],
        [zh ? '偏好' : 'Prefers', p.preferences || [], false],
        [zh ? '性格' : 'Personality', p.personality || [], false],
        [zh ? '同行' : 'Companions', p.companions || [], false]
      ].filter((g) => g[1].length)
      const stats = []
      if (p.visitCount) stats.push(`${zh ? '到店' : 'visits'} ${p.visitCount}${zh ? ' 次' : ''}`)
      if (p.avgIntervalDays) stats.push(`${zh ? '平均间隔' : 'avg interval'} ${p.avgIntervalDays}${zh ? ' 天' : 'd'}`)
      if (p.topService) stats.push(`${zh ? '常做' : 'top'} ${escapeHtml(p.topService)}`)
      const notes = data.notes || []
      target.innerHTML = `
        ${groups.length
          ? `<div class="customer-tags" style="flex-wrap:wrap;gap:6px;margin-bottom:6px">${groups.map(([label, items, danger]) =>
              `<span class="subtle" style="margin:0 2px 0 6px${danger ? ';color:#b0483c;font-weight:700' : ''}">${label}</span>${items.map((x) => tag(x, danger)).join('')}`).join('')}</div>`
          : `<p class="subtle">${zh ? '还没有画像标签。技师在小程序完成订单时写服务小记,画像会自动生成。' : 'No profile yet — technicians add notes in the mini app when completing orders.'}</p>`}
        ${stats.length ? `<p class="subtle">${stats.join(' · ')}</p>` : ''}
        ${notes.length ? notes.map((n) => `
          <div class="finance-rule-row" style="align-items:flex-start">
            <span>
              <strong>${escapeHtml(n.date || '')}</strong> · ${escapeHtml(n.serviceName || '-')}${n.technicianName ? ` · ${escapeHtml(n.technicianName)}` : ''}
              <br><span>${escapeHtml(n.rawText || '')}</span>
            </span>
          </div>`).join('') : `<p class="subtle">${zh ? '暂无服务小记。' : 'No notes yet.'}</p>`}
      `
    })
    .catch((error) => {
      const target = document.querySelector('#customerNotesBody')
      if (target) target.innerHTML = `<p class="subtle">${escapeHtml(error.message || '加载失败')}</p>`
    })
}

// 2026-08-02 S层沉睡客一键 AI 召回话术(POST /admin/ai/recall-copy;AI 失败后端自动落模板)
async function generateRecallCopy(customerId, btn) {
  const zh = owner.lang === 'zh'
  const original = btn ? btn.textContent : ''
  if (btn) { btn.disabled = true; btn.textContent = zh ? 'AI 生成中…' : 'Generating…' }
  try {
    const data = await request('/admin/ai/recall-copy', { method: 'POST', body: JSON.stringify({ userIds: [customerId] }) })
    const msg = data.messages?.[0]?.message || ''
    if (!msg) throw new Error(zh ? '没有生成结果,稍后再试' : 'No result')
    let copied = false
    try { await navigator.clipboard.writeText(msg); copied = true } catch { /* 剪贴板被拒时降级为手动复制 */ }
    if (!copied) window.prompt(zh ? '自动复制被浏览器拦截,请手动复制:' : 'Copy manually:', msg)
    toast(copied ? (zh ? '召回话术已复制,粘贴到微信即可发' : 'Copied to clipboard') : (zh ? '已生成' : 'Generated'))
  } finally {
    if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = original }
  }
}

function renderCustomerRecord(booking) {
  const imageCount = (booking.referenceImages || []).length + (booking.workImages || []).length + (booking.approvedWorkImages || []).length
  return `
    <article class="customer-record-row">
      <img src="${booking.service?.imageUrl || '/assets/images/store-cover.jpg'}" alt="${booking.service?.name || 'Lucky Luxe'}">
      <div>
        <span class="status ${booking.status}">${statusLabel(booking.status)}</span>
        <h3>${escapeHtml(booking.service?.name || '-')}</h3>
        <p>${booking.appointmentDate} ${booking.appointmentTime}-${booking.appointmentEndTime} · ${escapeHtml(booking.technician?.name || '-')}</p>
        <p>${t('sourceChannel')} ${escapeHtml(bookingSource(booking))} · ${t('recordImages')} ${imageCount}</p>
        <p>${t('depositLabel')} ${money(booking.depositCents)} · ${t('finalDue')} ${money(booking.finalDueCents)} · ${booking.publicCode}</p>
      </div>
      <button class="ghost slim" data-view-booking="${booking.id}" type="button">${t('details')}</button>
    </article>
    ${owner.selectedBookingId === booking.id ? renderBookingDetail(booking) : ''}
  `
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
  const baseDate = storeToday()
  const mocks = [
    {
      id: 'mock-gallery-french',
      service: { name: owner.lang === 'en' ? 'Classic Cream French' : '经典奶油法式', category: owner.lang === 'en' ? 'French' : '法式', imageUrl: '/assets/images/nail-french.jpg' },
      images: ['/assets/images/nail-french.jpg', '/assets/images/nail-luxe.jpg', '/assets/images/nail-jp.jpg'],
      technician: { name: 'Lina Zhou' },
      date: baseDate
    },
    {
      id: 'mock-gallery-lash',
      service: { name: owner.lang === 'en' ? 'Bare Natural Lash' : '裸感自然睫', category: owner.lang === 'en' ? 'Natural Lash' : '自然款', imageUrl: '/assets/images/lash-natural.jpg' },
      images: ['/assets/images/lash-natural.jpg', '/assets/images/lash-volume.jpg'],
      technician: { name: 'Mia Chen' },
      date: baseDate
    },
    {
      id: 'mock-gallery-soft',
      service: { name: owner.lang === 'en' ? 'Soft Volume Lash' : '轻盈浓密睫', category: owner.lang === 'en' ? 'Volume Lash' : '浓密款', imageUrl: '/assets/images/lash-volume.jpg' },
      images: ['/assets/images/lash-volume.jpg', '/assets/images/lash-lower.jpg'],
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
    const mainImage = images[0] || booking.service?.imageUrl || '/assets/images/nail-french.jpg'
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
          ${!images.length && booking.status === 'COMPLETED' ? `<span class="missing-work-badge">📷 ${owner.lang === 'zh' ? '待传作品图' : 'Photos missing'}</span>` : ''}
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
        <img src="${images[0] || booking.service?.imageUrl || '/assets/images/nail-french.jpg'}" alt="${booking.service?.name || 'Lucky Luxe'}">
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
        ${copy ? renderSocialCopy(copy, socialKey(booking.id, 0, owner.galleryPlatform)) : `<p class="subtle gallery-copy-hint">${owner.lang === 'zh' ? '点击上方平台按钮,AI 会为该平台生成对应风格的文案;「转发链接」是发给顾客/发到平台的作品页。' : 'Click a platform above to generate copy in that style; the share link opens the public gallery page.'}</p>`}
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
  if (!copy) return `<p class="subtle gallery-copy-hint">${owner.lang === 'zh' ? '点击上方平台按钮生成文案。' : 'Click a platform above to generate copy.'}</p>`
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
els.ownerLogin.addEventListener('click', (event) => {
  const roleTab = event.target.closest('[data-login-role]')
  if (roleTab) {
    owner.loginRole = roleTab.dataset.loginRole
    applyLoginRoleUi()
  }
})
els.ownerLogout.addEventListener('click', ownerLogout)
els.adminLayout.addEventListener('click', (event) => {
  if (event.target.closest('#fullDemoSeed')) {
    request('/admin/demo/full-seed', { method: 'POST', body: '{}' })
      .then(async (data) => {
        toast(data.message || (owner.lang === 'zh' ? '演示数据已填充' : 'Demo data seeded'))
        await loadAll()
      })
      .catch((error) => toast(error.message))
    return
  }
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
    if (owner.adminPage === 'bookings') { owner.adminView = 'today'; renderDailyCloseJump() }
    if (owner.adminPage === 'finance') loadFinancePage().catch((error) => toast(error.message))
    if (owner.adminPage === 'membership') loadMembershipPage().catch((error) => toast(error.message))
    if (owner.adminPage === 'pricing') loadPricingPage().catch((error) => toast(error.message))
    // 套餐与续费并入「门店设置 → 当前套餐」,进页时取一次订阅数据
    if (owner.adminPage === 'storeSettings') loadSubscriptionPage().catch((error) => toast(error.message))
    if (owner.adminPage === 'storeSettings') loadMembershipSettings().catch((error) => toast(error.message))
    if (owner.adminPage === 'storeSettings') loadDepositSettings().catch((error) => toast(error.message))
    if (owner.adminPage === 'storeSettings') loadAiPackSettings().catch((error) => toast(error.message))
    render()
    return
  }
})
els.wechatMockPage.addEventListener('input', (event) => {
  if (event.target.id === 'wechatSearchInput') {
    owner.wechatSearch = event.target.value
    const activeInput = event.target
    const caret = activeInput.selectionStart
    renderWechatMock()
    const restored = document.querySelector('#wechatSearchInput')
    if (restored) {
      restored.focus()
      restored.setSelectionRange(caret, caret)
    }
  }
})
function openImageLightbox(src) {
  const existing = document.querySelector('.cs-lightbox')
  if (existing) existing.remove()
  const overlay = document.createElement('div')
  overlay.className = 'cs-lightbox'
  const image = document.createElement('img')
  image.src = src
  image.alt = 'preview'
  overlay.appendChild(image)
  overlay.addEventListener('click', () => overlay.remove())
  document.body.appendChild(overlay)
}

els.wechatMockPage.addEventListener('click', (event) => {
  const zoomImage = event.target.closest('.cs-quote-thumbs img, .quote-reference-strip img, .wechat-message-images img')
  if (zoomImage) {
    openImageLightbox(zoomImage.src)
    return
  }
  const filterButton = event.target.closest('[data-wechat-filter]')
  if (filterButton) {
    owner.wechatFilter = filterButton.dataset.wechatFilter
    renderWechatMock()
    return
  }
  const openCustomerFile = event.target.closest('[data-open-customer-file]')
  if (openCustomerFile) {
    owner.selectedCustomerId = openCustomerFile.dataset.openCustomerFile
    owner.selectedBookingId = ''
    owner.adminPage = 'customers'
    render()
    return
  }
  const linkMember = event.target.closest('[data-link-member]')
  if (linkMember) {
    const userId = els.wechatMockPage.querySelector('[data-link-member-select]')?.value
    if (!userId) return
    request(`/admin/wechat/conversations/${encodeURIComponent(linkMember.dataset.linkMember)}/link-member`, {
      method: 'POST',
      body: JSON.stringify({ userId })
    }).then(async () => {
      toast(owner.lang === 'zh' ? '已绑定会员,会话与客户档案已互通' : 'Member linked')
      await loadAll()
    }).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-wechat-chat-send]')) {
    sendWechatChatMessage(false).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-wechat-chat-force-ai]')) {
    sendWechatChatMessage(true).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-wechat-chat-new-customer]')) {
    owner.wechatChatCustomerId = `mock-customer-${Date.now().toString().slice(-5)}`
    localStorage.setItem('lucky-wechat-chat-customer-id', owner.wechatChatCustomerId)
    owner.wechatMockReferenceImages = []
    owner.wechatMockSessionId = `live:wecom:${owner.wechatChatCustomerId}`
    renderWechatMock()
    return
  }
  const manualReplyButton = event.target.closest('[data-wechat-manual-reply]')
  if (manualReplyButton) {
    sendWechatManualReply(
      manualReplyButton.dataset.wechatManualReply,
      manualReplyButton.dataset.releaseToAi === 'true'
    ).catch((error) => toast(error.message))
    return
  }
  const takeOverButton = event.target.closest('[data-wechat-take-over]')
  if (takeOverButton) {
    setWechatHandoffOwner(takeOverButton.dataset.wechatTakeOver, 'take-over').catch((error) => toast(error.message))
    return
  }
  const releaseAiButton = event.target.closest('[data-wechat-release-ai]')
  if (releaseAiButton) {
    setWechatHandoffOwner(releaseAiButton.dataset.wechatReleaseAi, 'release-to-ai').catch((error) => toast(error.message))
    return
  }
  const feedbackButton = event.target.closest('[data-ai-feedback-save]')
  if (feedbackButton) {
    saveAiReplyFeedback(feedbackButton).catch((error) => toast(error.message))
    return
  }
  const manualDraftButton = event.target.closest('[data-manual-draft-create]')
  if (manualDraftButton) {
    createManualBookingDraft(manualDraftButton.dataset.manualDraftCreate).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-wechat-inject-mock]')) {
    injectWechatMockMessage().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-clear-mock-images]')) {
    owner.wechatMockReferenceImages = []
    renderWechatMock()
    return
  }
  const backendQuoteButton = event.target.closest('[data-backend-quote-send], [data-backend-quote-respond]')
  if (backendQuoteButton) {
    respondBackendQuote(backendQuoteButton.dataset.backendQuoteSend || backendQuoteButton.dataset.backendQuoteRespond).catch((error) => toast(error.message))
    return
  }
  const backendDraftButton = event.target.closest('[data-backend-quote-draft]')
  if (backendDraftButton) {
    createBackendQuoteDraft(backendDraftButton.dataset.backendQuoteDraft).catch((error) => toast(error.message))
    return
  }
  const backendReminderButton = event.target.closest('[data-backend-reminder-sent]')
  if (backendReminderButton) {
    markBackendReminderSent(backendReminderButton.dataset.backendReminderSent).catch((error) => toast(error.message))
    return
  }
  const liveButton = event.target.closest('[data-wechat-live]')
  if (liveButton) {
    owner.wechatMockSessionId = `live:${liveButton.dataset.wechatLive}`
    renderWechatMock()
    return
  }
  const sessionButton = event.target.closest('[data-wechat-session]')
  if (sessionButton) {
    owner.wechatMockSessionId = sessionButton.dataset.wechatSession
    renderWechatMock()
    return
  }
  const quoteButton = event.target.closest('[data-mock-quote-return]')
  if (quoteButton) {
    updateWechatMock(quoteButton.dataset.mockQuoteReturn, {
      quoteStatus: 'quoted',
      artistReply: currentWechatQuoteForm()
    })
    toast(t('quoteReturned'))
    return
  }
  const draftButton = event.target.closest('[data-mock-draft-create]')
  if (draftButton) {
    updateWechatMock(draftButton.dataset.mockDraftCreate, { quoteStatus: 'quoted', draftStatus: 'created' })
    toast(t('draftCreated'))
    return
  }
  const reminderButton = event.target.closest('[data-mock-reminder]')
  if (reminderButton) {
    updateWechatMock(reminderButton.dataset.mockReminder, { draftStatus: 'reminded' })
    toast(t('reminderSent'))
    return
  }
  const releaseButton = event.target.closest('[data-mock-release]')
  if (releaseButton) {
    updateWechatMock(releaseButton.dataset.mockRelease, { draftStatus: 'released' })
    toast(t('draftReleased'))
  }
})

els.wechatMockPage.addEventListener('change', (event) => {
  if (event.target.matches('#wechatMockReferenceImages')) {
    readMockReferenceImages(event.target.files).catch((error) => toast(error.message))
  }
})

function readMockReferenceImages(files) {
  const selected = [...(files || [])].slice(0, 4)
  return Promise.all(selected.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({
      name: file.name,
      url: reader.result,
      type: file.type,
      size: file.size,
      uploadedAt: new Date().toISOString()
    })
    reader.onerror = () => reject(new Error(owner.lang === 'zh' ? '图片读取失败' : 'Failed to read image'))
    reader.readAsDataURL(file)
  }))).then((images) => {
    owner.wechatMockReferenceImages = images
    renderWechatMock()
  })
}

async function loadWechatWorkflowTasks() {
  const [quotes, reminders] = await Promise.allSettled([
    request('/admin/quote-requests'),
    request('/admin/reminder-tasks')
  ])
  owner.quoteRequests = quotes.status === 'fulfilled' ? quotes.value.quoteRequests : owner.quoteRequests
  owner.reminderTasks = reminders.status === 'fulfilled' ? reminders.value.reminderTasks : owner.reminderTasks
}

async function refreshWechatConversations() {
  const list = await request('/admin/wechat/conversations')
  owner.wechatConversations = list.conversations || []
  await loadWechatWorkflowTasks()
}

// 工作台每 30 秒自动刷新会话列表：需人工角标、超时高亮、等待分钟数保持实时
setInterval(() => {
  if (owner.adminPage !== 'wechatMock' || document.hidden || !owner.wechatConversations.length) return
  refreshWechatConversations().then(() => renderWechatMock()).catch(() => {})
}, 30000)

function syncWechatChatFormState() {
  const customerId = document.querySelector('#wechatChatCustomerId')?.value.trim()
  const source = document.querySelector('#wechatMockInboundSource')?.value.trim()
  const stage = document.querySelector('#wechatMockCustomerStage')?.value || 'new_quote'
  if (customerId) {
    owner.wechatChatCustomerId = customerId
    localStorage.setItem('lucky-wechat-chat-customer-id', customerId)
  }
  if (source) {
    owner.wechatChatSource = source
    localStorage.setItem('lucky-wechat-chat-source', source)
  }
  owner.wechatChatStage = stage
  localStorage.setItem('lucky-wechat-chat-stage', stage)
}

async function sendWechatChatMessage(forceAi = false) {
  syncWechatChatFormState()
  const message = document.querySelector('#wechatChatMessage')?.value.trim()
  if (!message && !forceAi) return
  const data = await request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({
      message: message || (owner.lang === 'zh' ? '请继续用 AI 接待这位顾客。' : 'Please let AI continue assisting this customer.'),
      sourceChannel: owner.wechatChatSource,
      customerStage: owner.wechatChatStage,
      referenceImages: owner.wechatMockReferenceImages,
      lang: owner.lang,
      forceAi,
      externalUserId: owner.wechatChatCustomerId
    })
  })
  await refreshWechatConversations()
  owner.wechatMockSessionId = `live:${data.conversationId}`
  owner.wechatMockReferenceImages = []
  renderWechatMock()
}

async function setWechatHandoffOwner(conversationId, action) {
  await request(`/admin/wechat/conversations/${encodeURIComponent(conversationId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({})
  })
  await refreshWechatConversations()
  owner.wechatMockSessionId = `live:${conversationId}`
  renderWechatMock()
  toast(action === 'take-over' ? t('takenOverToast') : t('releasedToAiToast'))
}

async function sendWechatManualReply(conversationId, releaseToAi = false) {
  const message = document.querySelector('#wechatManualReplyText')?.value.trim()
  if (!message) return
  await request(`/admin/wechat/conversations/${encodeURIComponent(conversationId)}/manual-reply`, {
    method: 'POST',
    body: JSON.stringify({ message, releaseToAi })
  })
  await refreshWechatConversations()
  owner.wechatMockSessionId = `live:${conversationId}`
  renderWechatMock()
  toast(releaseToAi
    ? (owner.lang === 'zh' ? '人工回复已发送，并交回 AI' : 'Manual reply sent and returned to AI')
    : (owner.lang === 'zh' ? '人工回复已发送，并保持人工接管' : 'Manual reply sent and kept human'))
}

async function saveAiReplyFeedback(button) {
  const messageIndex = Number(button.dataset.aiFeedbackSave)
  const conversationId = button.dataset.conversationId || ''
  const correctedReply = document.querySelector(`[data-ai-feedback-reply="${messageIndex}"]`)?.value.trim()
  const notes = document.querySelector(`[data-ai-feedback-notes="${messageIndex}"]`)?.value.trim()
  if (!conversationId || !correctedReply) return
  const data = await request('/admin/ai/customer-service/feedback', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      messageIndex,
      correctedReply,
      notes,
      customerMessage: button.dataset.customerMessage || '',
      originalReply: button.dataset.originalReply || '',
      lang: owner.lang,
      status: 'approved'
    })
  })
  await refreshWechatConversations()
  owner.wechatMockSessionId = `live:${data.conversation?.id || conversationId}`
  renderWechatMock()
  toast(owner.lang === 'zh' ? '已保存为满意样本，后续 AI 会参考这条回复' : 'Saved as approved sample for future AI replies')
}

async function createManualBookingDraft(conversationId = '') {
  const serviceId = document.querySelector('#manualDraftService')?.value || ''
  const technicianId = document.querySelector('#manualDraftTechnician')?.value || ''
  const date = document.querySelector('#manualDraftDate')?.value || ''
  const time = document.querySelector('#manualDraftTime')?.value || ''
  const notes = document.querySelector('#manualDraftNotes')?.value.trim() || ''
  if (!serviceId) {
    toast(owner.lang === 'zh' ? '请先选择服务' : 'Please select a service')
    return
  }
  const data = await request('/admin/booking-drafts', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      serviceId,
      technicianId,
      date,
      time,
      notes,
      sourceChannel: 'admin_manual'
    })
  })
  owner.manualDraftLink = data.bookingDraft?.linkUrl || ''
  await refreshWechatConversations()
  if (conversationId) owner.wechatMockSessionId = `live:${conversationId}`
  renderWechatMock()
  toast(owner.lang === 'zh' ? '已生成可支付预约草稿链接' : 'Booking draft link created')
}

async function respondBackendQuote(id) {
  const staffMessage = document.querySelector(`[data-quote-id="${id}"][data-backend-quote-field="message"]`)?.value.trim() || ''
  if (!staffMessage) {
    toast(owner.lang === 'zh' ? '请先写下技师给 AI 的回价/判断内容' : 'Please enter the technician message for AI')
    return
  }
  const data = await request(`/admin/quote-requests/${id}/respond`, {
    method: 'PATCH',
    body: JSON.stringify({ staffMessage })
  })
  await refreshWechatConversations()
  if (data.quoteRequest?.conversationId) owner.wechatMockSessionId = `live:${data.quoteRequest.conversationId}`
  renderWechatMock()
  toast(owner.lang === 'zh' ? '已把技师回价交给 AI 润色并发送给顾客' : 'Quote polished by AI and sent to customer')
}

async function createBackendQuoteDraft(id) {
  const data = await request(`/admin/quote-requests/${id}/draft`, {
    method: 'POST',
    body: JSON.stringify({})
  })
  await refreshWechatConversations()
  if (data.quoteRequest?.conversationId) owner.wechatMockSessionId = `live:${data.quoteRequest.conversationId}`
  renderWechatMock()
  toast(owner.lang === 'zh' ? '已向顾客发送 30 分钟草稿链接' : '30-min draft link sent to customer')
}

async function markBackendReminderSent(id) {
  await request(`/admin/reminder-tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'SENT' })
  })
  await loadWechatWorkflowTasks()
  renderWechatMock()
  toast(owner.lang === 'zh' ? '提醒已标记发送' : 'Reminder marked sent')
}

function currentWechatQuoteForm() {
  return {
    canDo: document.querySelector('#wechatQuoteCanDo')?.value || 'yes',
    price: document.querySelector('#wechatQuotePrice')?.value.trim() || '',
    duration: document.querySelector('#wechatQuoteDuration')?.value.trim() || '',
    notes: document.querySelector('#wechatQuoteNotes')?.value.trim() || ''
  }
}

function updateWechatMock(sessionId, patch) {
  owner.wechatMockOverrides[sessionId] = {
    ...(owner.wechatMockOverrides[sessionId] || {}),
    ...patch
  }
  writeJson('lucky-wechat-mock-overrides', owner.wechatMockOverrides)
  renderWechatMock()
}

async function injectWechatMockMessage() {
  const message = document.querySelector('#wechatMockInboundMessage')?.value.trim()
  if (!message) return
  const sourceChannel = document.querySelector('#wechatMockInboundSource')?.value.trim()
  const customerStage = document.querySelector('#wechatMockCustomerStage')?.value || 'new_quote'
  const data = await request('/admin/wechat/mock-message', {
    method: 'POST',
    body: JSON.stringify({
      message,
      sourceChannel,
      customerStage,
      referenceImages: owner.wechatMockReferenceImages,
      lang: owner.lang,
      externalUserId: `mock-wechat-${Date.now().toString().slice(-6)}`
    })
  })
  const list = await request('/admin/wechat/conversations')
  owner.wechatConversations = list.conversations || []
  await loadWechatWorkflowTasks()
  owner.wechatMockSessionId = `live:${data.conversationId}`
  renderWechatMock()
}
els.financePanel.addEventListener('submit', (event) => {
  if (!event.target.matches('#financeForm')) return
  unlockFinance(event).catch((error) => toast(error.message))
})
els.customerSort.addEventListener('change', renderCustomers)
els.adminTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    owner.adminView = tab.dataset.adminView
    if (owner.adminView === 'today') {
      els.filterDate.value = storeToday()
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
els.schedulePage.addEventListener('click', (event) => {
  const weekNav = event.target.closest('[data-week-nav]')
  if (weekNav) {
    const step = Number(weekNav.dataset.weekNav)
    const from = step === 0 ? mondayOf(new Date(`${storeToday()}T12:00:00`)) : (() => {
      const d = new Date(`${owner.scheduleWeekFrom || mondayOf(new Date(`${storeToday()}T12:00:00`))}T12:00:00`)
      d.setDate(d.getDate() + step * 7)
      return formatDate(d)
    })()
    loadScheduleWeek(from).catch((error) => toast(error.message))
    return
  }
  const cell = event.target.closest('[data-swg-tech]')
  if (cell) {
    toggleScheduleCell(cell.dataset.swgTech, cell.dataset.swgDate).catch((error) => toast(error.message))
    return
  }
  const requestCell = event.target.closest('[data-swg-request-date]')
  if (requestCell) {
    submitScheduleRequest(requestCell.dataset.swgRequestDate).catch((error) => toast(error.message))
    return
  }
  const schreqButton = event.target.closest('[data-schreq-action]')
  if (schreqButton) {
    resolveScheduleRequest(schreqButton.dataset.schreqId, schreqButton.dataset.schreqAction).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('#applyWeekPattern')) {
    applyWeekPatternForward().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('#addTechnicianButton')) {
    addTechnicianPrompt().catch((error) => toast(error.message))
    return
  }
  const staffTab = event.target.closest('[data-staff-tab]')
  if (staffTab) {
    owner.staffTab = staffTab.dataset.staffTab
    applyStaffTab()
    if (owner.staffTab === 'performance' && isOwnerRole()) renderAttendanceBoard() // 切到业绩板块时拉最新考勤
    if (owner.staffTab === 'performance' && isOwnerRole()) loadPerfRanking().catch((error) => toast(error.message))
    if (owner.staffTab === 'targets' && isOwnerRole()) loadPerfTargets().catch((error) => toast(error.message))
    if (owner.staffTab === 'salary' && isOwnerRole()) loadSalaryPlansPanel().catch((error) => toast(error.message))
    if (owner.staffTab === 'accounts' && isOwnerRole()) loadStaffAccountsPanel().catch((error) => toast(error.message))
    return
  }
  // 业绩排行:维度 / 周期两组段选(屏 V1)
  const rankMetric = event.target.closest('[data-rank-metric]')
  if (rankMetric) {
    perfRankState.metric = rankMetric.dataset.rankMetric
    loadPerfRanking().catch((error) => toast(error.message))
    return
  }
  const rankPeriod = event.target.closest('[data-rank-period]')
  if (rankPeriod) {
    perfRankState.period = rankPeriod.dataset.rankPeriod
    loadPerfRanking().catch((error) => toast(error.message))
    return
  }
  // 业绩目标:两组段选(设置/显示)+ 月份切换 + 保存
  const segBtn = event.target.closest('.seg2 [data-seg-value]')
  if (segBtn) {
    const group = segBtn.closest('.seg2')
    for (const b of group.querySelectorAll('[data-seg-value]')) b.classList.toggle('on', b === segBtn)
    if (group.dataset.segGroup === 'mode') {
      // 「总目标」时把卡耗/单量两格收起来 —— 目标怎么定与员工端看什么是两回事,别混在一起
      const fields = group.closest('[data-target-row]')?.querySelector('.tgt-fields')
      if (fields) fields.dataset.mode = segBtn.dataset.segValue
    }
    return
  }
  const targetMonth = event.target.closest('[data-target-month]')
  if (targetMonth) {
    loadPerfTargets(shiftMonthKey(perfTargetsState.month, Number(targetMonth.dataset.targetMonth))).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('#perfTargetsSave')) {
    request('/admin/perf-targets', {
      method: 'PUT',
      body: JSON.stringify({ month: perfTargetsState.month, targets: collectPerfTargets() })
    }).then(() => {
      toast(owner.lang === 'zh' ? '业绩目标已保存,员工端立即生效' : 'Saved')
      return loadPerfTargets(perfTargetsState.month)
    }).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('#salaryPlanButton')) {
    openSalaryPlanPanel(null) // 列表总览:全店默认 + 每技师
    return
  }
  const spPlan = event.target.closest('[data-sp-plan]')
  if (spPlan) {
    openSalaryPlanPanel(spPlan.dataset.spPlan, spPlan.dataset.spName) // 直接编辑该技师
    return
  }
  const techEdit = event.target.closest('[data-tech-edit]')
  if (techEdit) {
    editTechnicianPrompt(techEdit.dataset.techEdit).catch((error) => toast(error.message))
    return
  }
  const techToggle = event.target.closest('[data-tech-toggle]')
  if (techToggle) {
    toggleTechnicianActive(techToggle.dataset.techToggle).catch((error) => toast(error.message))
    return
  }
  const acctCreate = event.target.closest('[data-acct-create]')
  if (acctCreate) {
    request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: acctCreate.dataset.acctCreate }) })
      .then(async (data) => { showCredentialsOnce(data.username, data.initialPassword); await refreshStaffAccounts() })
      .catch((error) => toast(error.message))
    return
  }
  const acctReset = event.target.closest('[data-acct-reset]')
  if (acctReset) {
    if (!window.confirm(owner.lang === 'zh' ? '重置该员工的登录密码?旧密码立即失效。' : 'Reset this password?')) return
    request(`/admin/staff-accounts/${acctReset.dataset.acctReset}/reset-password`, { method: 'POST' })
      .then(async (data) => { showCredentialsOnce(data.username, data.initialPassword); await refreshStaffAccounts() })
      .catch((error) => toast(error.message))
    return
  }
  const acctToggle = event.target.closest('[data-acct-toggle]')
  if (acctToggle) {
    request(`/admin/staff-accounts/${acctToggle.dataset.acctToggle}/toggle`, { method: 'POST' })
      .then(async (data) => {
        toast(owner.lang === 'zh' ? (data.status === 'disabled' ? '账号已停用,该员工立即无法登录' : '账号已启用') : `Account ${data.status}`)
        await refreshStaffAccounts()
      })
      .catch((error) => toast(error.message))
  }
})
els.saveBusinessHours.addEventListener('click', () => saveBusinessHoursSettings().catch((error) => toast(error.message)))
els.financePage.addEventListener('click', (event) => {
  if (event.target.closest('[data-goal-setup]')) {
    openGoalSetupModal().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-submit]')) {
    submitFinanceEntry().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-lock-retry]')) {
    owner.financeLedger.lockConfigured = undefined
    renderFinanceLock()
    return
  }
  if (event.target.closest('#financeExportCsv')) {
    exportFinanceCsv()
    return
  }
  const reverseButton = event.target.closest('[data-fin-reverse]')
  if (reverseButton) {
    request(`/admin/finance/transactions/${encodeURIComponent(reverseButton.dataset.finReverse)}/reverse`, { method: 'POST' })
      .then(loadFinancePage)
      .then(() => toast(owner.lang === 'zh' ? '已生成冲销单' : 'Reversal created'))
      .catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-rule-add]')) {
    const name = document.querySelector('#finRuleName')?.value.trim()
    const amount = Number(document.querySelector('#finRuleAmount')?.value || 0)
    if (!name || !amount) {
      toast(owner.lang === 'zh' ? '规则名称和金额必填' : 'Name and amount required')
      return
    }
    request('/admin/finance/recurring', {
      method: 'POST',
      body: JSON.stringify({
        name,
        category: document.querySelector('#finRuleCategory')?.value || '其他支出',
        amount,
        dayOfMonth: Number(document.querySelector('#finRuleDay')?.value || 1)
      })
    }).then(loadFinancePage)
      .then(() => toast(owner.lang === 'zh' ? '规则已添加，本月应入账部分已自动生成' : 'Rule added'))
      .catch((error) => toast(error.message))
    return
  }
  const ruleToggle = event.target.closest('[data-fin-rule-toggle]')
  if (ruleToggle) {
    request(`/admin/finance/recurring/${encodeURIComponent(ruleToggle.dataset.finRuleToggle)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: ruleToggle.dataset.finRuleNext === '1' })
    }).then(loadFinancePage).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-verify]')) {
    loadFinancePage().then(() => toast(owner.lang === 'zh' ? '校验完成' : 'Verified')).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-targets-save]')) {
    request('/admin/finance/targets', {
      method: 'PUT',
      body: JSON.stringify({
        targetMode: document.querySelector('#finTargetMode')?.value || 'net_profit',
        monthTarget: Number(document.querySelector('#finTargetMonth')?.value || 0),
        variableCostRate: Number(document.querySelector('#finTargetRate')?.value || 25) / 100,
        yearTarget: document.querySelector('#finTargetYear')?.value ? Number(document.querySelector('#finTargetYear').value) : null
      })
    }).then(loadFinancePage)
      .then(() => toast(owner.lang === 'zh' ? '目标已保存，进度实时生效' : 'Targets saved'))
      .catch((error) => toast(error.message))
    return
  }
  const compSave = event.target.closest('[data-fin-comp-save]')
  if (compSave) {
    const row = compSave.closest('[data-comp-tech]')
    request('/admin/finance/compensation', {
      method: 'PUT',
      body: JSON.stringify({
        technicianId: compSave.dataset.finCompSave,
        baseSalary: Number(row?.querySelector('[data-comp-base]')?.value || 0),
        commissionRate: Number(row?.querySelector('[data-comp-rate]')?.value || 0) / 100,
        active: Boolean(row?.querySelector('[data-comp-active]')?.checked)
      })
    }).then(loadFinancePage)
      .then(() => toast(owner.lang === 'zh' ? '薪酬配置已保存' : 'Compensation saved'))
      .catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-payroll-confirm]')) {
    request('/admin/finance/payroll/confirm', { method: 'POST', body: JSON.stringify({ month: owner.financeLedger.month }) })
      .then(loadFinancePage)
      .then(() => toast(owner.lang === 'zh' ? '工资已结算入账（账本只追加）' : 'Payroll settled'))
      .catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-unlock]')) {
    submitFinanceUnlock().catch((error) => toast(error.message))
    return
  }
  const tabButton = event.target.closest('[data-fin-tab]')
  if (tabButton) {
    owner.financeLedger.tab = tabButton.dataset.finTab
    applyFinanceTab()
    if (owner.financeLedger.tab === 'dailyClose') loadDailyClose().catch((error) => toast(error.message))
    if (owner.financeLedger.tab === 'trend') loadFinanceTrend().catch((error) => toast(error.message))
    return
  }
  // ===== 日结板块(屏 1)=====
  const dcDay = event.target.closest('[data-dc-day]')
  if (dcDay) {
    const delta = Number(dcDay.dataset.dcDay)
    loadDailyClose(delta === 0 ? storeToday() : shiftDate(dailyCloseState.date || storeToday(), delta))
      .catch((error) => toast(error.message))
    return
  }
  const allocToggle = event.target.closest('[data-alloc-toggle]')
  if (allocToggle) {
    const id = allocToggle.dataset.allocToggle
    dailyCloseState.open[id] = dailyCloseState.open[id] === false
    renderDailyClose()
    return
  }
  const allocSave = event.target.closest('[data-dc-allocate]')
  if (allocSave) {
    const box = allocSave.closest('[data-alloc]')
    const shares = [...box.querySelectorAll('[data-share-tech]')].map((input) => ({
      technicianId: input.dataset.shareTech,
      pct: Number(input.value) || 0
    }))
    request(`/admin/settlements/${encodeURIComponent(allocSave.dataset.dcAllocate)}/allocate`, {
      method: 'POST', body: JSON.stringify({ shares })
    }).then(() => {
      toast(owner.lang === 'zh' ? '业绩已分配' : 'Allocated')
      return loadDailyClose(dailyCloseState.date)
    }).catch((error) => toast(error.message))
    return
  }
  const dcSnapshot = event.target.closest('[data-dc-snapshot]')
  if (dcSnapshot) {
    window.open(`/settlements/${encodeURIComponent(dcSnapshot.dataset.dcSnapshot)}/snapshot`, '_blank')
    return
  }
  // ===== 屏 1b 金额更正 =====
  const dcCorrect = event.target.closest('[data-dc-correct]')
  if (dcCorrect) {
    const id = dcCorrect.dataset.dcCorrect
    const row = (dailyCloseState.view?.settlements || []).find((x) => x.settlementId === id)
    request(`/settlements/${encodeURIComponent(row.code)}`, { public: true })
      .then((data) => { dailyCloseState.correcting = data.settlement; renderDailyClose() })
      .catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('#dcCorrectCancel')) {
    dailyCloseState.correcting = null
    renderDailyClose()
    return
  }
  if (event.target.closest('#dcCorrectSubmit')) {
    const reason = document.querySelector('#dcReason')?.value.trim()
    if (!reason) { toast(owner.lang === 'zh' ? '原因必填' : 'Reason is required'); return }
    const row = dailyCloseState.correcting
    request(`/admin/settlements/${encodeURIComponent(row.id)}/amend`, {
      method: 'POST',
      body: JSON.stringify({ totalCents: yuanToCents(document.querySelector('#dcNewTotal')?.value), reason })
    }).then((r) => {
      toast(owner.lang === 'zh'
        ? (r.autoBalanceAdjustCents ? '已更正,储值差额已自动补配' : '已更正,原签署单未改动')
        : 'Amended')
      dailyCloseState.correcting = null
      return loadDailyClose(dailyCloseState.date)
    }).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('#dcConfirm')) {
    request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: dailyCloseState.date }) })
      .then(() => { toast(owner.lang === 'zh' ? '日结已确认,业绩定格' : 'Day closed'); return loadDailyClose(dailyCloseState.date) })
      .catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('#dcReopen')) {
    const reason = window.prompt(owner.lang === 'zh' ? '重开日结必须写原因(会留痕):' : 'Reason (recorded):')
    if (!reason || !reason.trim()) return
    request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: dailyCloseState.date, reason: reason.trim() }) })
      .then(() => { toast(owner.lang === 'zh' ? '已重开,可以改分成了' : 'Reopened'); return loadDailyClose(dailyCloseState.date) })
      .catch((error) => toast(error.message))
    return
  }
  // ===== 财务密码卡(屏 V4,商家自助)=====
  if (event.target.closest('#finLockSw')) {
    const sw = event.target.closest('#finLockSw')
    const next = sw.getAttribute('aria-checked') !== 'true'
    sw.setAttribute('aria-checked', next ? 'true' : 'false')
    document.querySelector('#finLockPwd')?.classList.toggle('hidden', !next)
    return
  }
  if (event.target.closest('#finLockSave')) {
    const enabled = document.querySelector('#finLockSw')?.getAttribute('aria-checked') === 'true'
    request('/admin/finance/lock-settings', {
      method: 'PUT',
      body: JSON.stringify({
        enabled,
        currentPassword: document.querySelector('#finLockCurrent')?.value || '',
        password: document.querySelector('#finLockPass')?.value || '',
        confirmPassword: document.querySelector('#finLockPass2')?.value || ''
      })
    }).then((res) => {
      // 刚开启时后端直接给一把钥匙,免得老板保存完把自己关在门外
      if (res.financeKey) { owner.financeKey = res.financeKey; sessionStorage.setItem('lucky-finance-key', res.financeKey) }
      if (!enabled) { owner.financeKey = ''; sessionStorage.removeItem('lucky-finance-key'); clearFinanceLock() }
      toast(owner.lang === 'zh' ? (enabled ? '财务密码已保存' : '财务密码已关闭,财务区不再锁') : 'Saved')
      return loadFinanceLockSettings()
    }).catch((error) => toast(error.message))
    return
  }
  // ===== 财务趋势 =====
  const trendG = event.target.closest('[data-trend-g]')
  if (trendG) {
    loadFinanceTrend(trendG.dataset.trendG).catch((error) => toast(error.message))
    return
  }
  // 工资试算页的「去日结」:切到日结板块并定位到那一天
  const goClose = event.target.closest('[data-go-close]')
  if (goClose) {
    owner.financeLedger.tab = 'dailyClose'
    applyFinanceTab()
    loadDailyClose(goClose.dataset.goClose).catch((error) => toast(error.message))
    return
  }
  const guideButton = event.target.closest('[data-fin-guide]')
  if (guideButton) {
    event.preventDefault()
    showFinanceGuide(guideButton.dataset.finGuide || 'all')
    return
  }
  if (event.target.closest('[data-fin-demo-seed]')) {
    request('/admin/demo/finance-seed', { method: 'POST', body: '{}' })
      .then((data) => {
        toast(data.message || '完成')
        return loadFinancePage()
      })
      .catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-insights]')) {
    showFinanceInsights()
    return
  }
  if (event.target.closest('[data-sv-recharge]') || event.target.closest('[data-sv-consume]')) {
    const isRecharge = Boolean(event.target.closest('[data-sv-recharge]'))
    const userId = document.querySelector('#svMember')?.value
    const amount = Number(document.querySelector('#svAmount')?.value || 0)
    if (!userId || !amount || amount <= 0) {
      toast(owner.lang === 'zh' ? '请选择会员并填写金额' : 'Select a member and amount')
      return
    }
    const svTech = document.querySelector('#svTech')?.value || ''
    request(`/admin/stored-value/${isRecharge ? 'recharge' : 'consume'}`, {
      method: 'POST',
      body: JSON.stringify({ userId, amount, payChannel: document.querySelector('#svChannel')?.value || 'unknown', ...(svTech ? { technicianId: svTech } : {}) })
    }).then(loadFinancePage)
      .then(() => toast(isRecharge
        ? (owner.lang === 'zh' ? '充值成功（记为储值负债）' : 'Recharged')
        : (owner.lang === 'zh' ? '耗卡成功，已确认为收入' : 'Consumed and recognized as income')))
      .catch((error) => toast(error.message))
  }
})
els.financePage.addEventListener('change', (event) => {
  if (event.target.id === 'financeMonth') {
    owner.financeLedger.month = event.target.value
    loadFinancePage().catch((error) => toast(error.message))
    return
  }
  if (event.target.id === 'finType') {
    const category = document.querySelector('#finCategory')
    if (category) {
      const list = event.target.value === 'income' ? FINANCE_INCOME_CATEGORIES : financeExpenseCategories()
      category.innerHTML = list.map((cat) => `<option value="${cat}">${cat}</option>`).join('')
    }
    return
  }
  if (event.target.id === 'finFilterType') {
    owner.financeLedger.filterType = event.target.value
    renderFinancePage()
    return
  }
  if (event.target.id === 'finFilterCategory') {
    owner.financeLedger.filterCategory = event.target.value
    renderFinancePage()
  }
})
els.storeSettingsPage.addEventListener('click', (event) => {
  if (event.target.closest('[data-store-profile-save]')) {
    saveStoreProfile().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-special-date-add]')) {
    addSpecialDate().catch((error) => toast(error.message))
    return
  }
  const specialDelete = event.target.closest('[data-special-date-delete]')
  if (specialDelete) {
    deleteSpecialDate(specialDelete.dataset.specialDateDelete).catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-kb-save-facts]')) {
    saveKbFacts().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-kb-add-entry]')) {
    addKbEntry().catch((error) => toast(error.message))
    return
  }
  const toggleButton = event.target.closest('[data-kb-toggle-entry]')
  if (toggleButton) {
    request(`/admin/kb/entries/${encodeURIComponent(toggleButton.dataset.kbToggleEntry)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: toggleButton.dataset.kbNext === '1' })
    }).then(refreshTenantKb).catch((error) => toast(error.message))
    return
  }
  const deleteButton = event.target.closest('[data-kb-delete-entry]')
  if (deleteButton) {
    request(`/admin/kb/entries/${encodeURIComponent(deleteButton.dataset.kbDeleteEntry)}`, { method: 'DELETE' })
      .then(refreshTenantKb).catch((error) => toast(error.message))
    return
  }
  const deleteDocButton = event.target.closest('[data-kb-delete-doc]')
  if (deleteDocButton) {
    request(`/admin/kb/documents/${encodeURIComponent(deleteDocButton.dataset.kbDeleteDoc)}`, { method: 'DELETE' })
      .then(refreshTenantKb).catch((error) => toast(error.message))
    return
  }
  const copyButton = event.target.closest('[data-copy-value]')
  if (copyButton) {
    navigator.clipboard?.writeText(copyButton.dataset.copyValue || '')
      .then(() => toast(owner.lang === 'zh' ? '已复制' : 'Copied'))
      .catch(() => toast(owner.lang === 'zh' ? '复制失败，请手动选择' : 'Copy failed'))
  }
})
els.storeSettingsPage.addEventListener('change', (event) => {
  if (event.target.id !== 'kbImportFile') return
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const result = await request('/admin/kb/import', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content: String(reader.result || '') })
      })
      await refreshTenantKb()
      if (result.mode === 'document') {
        toast(owner.lang === 'zh' ? '已存为知识文档，AI 回答时会参考它。' : 'Stored as knowledge document for AI reference.')
      } else {
        toast(owner.lang === 'zh' ? `已导入 ${result.imported} 条 FAQ，AI 即刻可用。` : `Imported ${result.imported} FAQ entries.`)
      }
    } catch (error) {
      toast(error.message)
    }
  }
  reader.readAsText(file)
  event.target.value = ''
})
els.businessHoursEditor.addEventListener('change', (event) => {
  if (event.target.id === 'specialDateMode') {
    const showHours = event.target.value === 'hours'
    document.querySelector('#specialDateOpen')?.classList.toggle('hidden', !showHours)
    document.querySelector('#specialDateClose')?.classList.toggle('hidden', !showHours)
    return
  }
  const closedBox = event.target.closest('[data-hours-closed]')
  if (!closedBox) return
  const weekday = closedBox.dataset.hoursClosed
  const disabled = closedBox.checked
  const openInput = document.querySelector(`[data-hours-open="${weekday}"]`)
  const closeInput = document.querySelector(`[data-hours-close="${weekday}"]`)
  if (openInput) openInput.disabled = disabled
  if (closeInput) closeInput.disabled = disabled
  closedBox.closest('.business-hours-row')?.classList.toggle('closed', disabled)
})
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
  // 取消是破坏性动作:二次确认防误点
  if (button.dataset.status === 'CANCELLED') {
    const booking = owner.bookings.find((item) => item.id === button.dataset.booking)
    const label = booking ? `${booking.appointmentDate} ${booking.appointmentTime} ${booking.service?.name || ''}` : ''
    const confirmed = window.confirm(owner.lang === 'zh'
      ? `确定取消这个预约吗?\n${label}\n取消后时段将释放,已入账收入会自动冲销。`
      : `Cancel this booking?\n${label}`)
    if (!confirmed) return
  }
  updateBookingStatus(button.dataset.booking, button.dataset.status).catch((error) => toast(error.message))
})
document.querySelector('#customerSearch')?.addEventListener('input', (event) => {
  owner.customerSearch = event.target.value
  renderCustomers()
})
document.querySelector('#bookingSearch')?.addEventListener('input', (event) => {
  owner.bookingSearch = event.target.value
  const caret = event.target.selectionStart
  renderBookings()
  const restored = document.querySelector('#bookingSearch')
  if (restored && document.activeElement !== restored) {
    restored.focus()
    restored.setSelectionRange(caret, caret)
  }
})
els.bookingList.addEventListener('change', (event) => {
  if (!event.target.matches('[data-work-image-input]')) return
  handleWorkImageFiles(event.target.dataset.workImageInput, event.target.files).catch((error) => toast(error.message))
})
els.customerList.addEventListener('click', (event) => {
  const back = event.target.closest('[data-customer-back]')
  if (back) {
    owner.selectedCustomerId = ''
    owner.selectedBookingId = ''
    renderCustomers()
    return
  }
  const customerDetail = event.target.closest('[data-customer-detail]')
  if (customerDetail) {
    owner.selectedCustomerId = customerDetail.dataset.customerDetail
    owner.selectedBookingId = ''
    renderCustomers()
    return
  }
  const profileSave = event.target.closest('[data-customer-profile-save]')
  if (profileSave) {
    saveCustomerProfile(profileSave.dataset.customerProfileSave).catch((error) => toast(error.message))
    return
  }
  const openChat = event.target.closest('[data-customer-open-chat]')
  if (openChat) {
    owner.wechatMockSessionId = `live:${openChat.dataset.customerOpenChat}`
    owner.adminPage = 'wechatMock'
    render()
    return
  }
  const viewBooking = event.target.closest('[data-view-booking]')
  if (viewBooking) {
    owner.selectedBookingId = owner.selectedBookingId === viewBooking.dataset.viewBooking ? '' : viewBooking.dataset.viewBooking
    renderCustomers()
    return
  }
  if (event.target.closest('[data-close-booking-detail]')) {
    owner.selectedBookingId = ''
    renderCustomers()
    return
  }
  const aiBooking = event.target.closest('[data-ai-booking]')
  if (aiBooking) {
    generateBookingSummary(aiBooking.dataset.aiBooking).catch((error) => toast(error.message))
    return
  }
  const recallBtn = event.target.closest('[data-recall-copy]')
  if (recallBtn) {
    generateRecallCopy(recallBtn.dataset.recallCopy, recallBtn).catch((error) => toast(error.message))
    return
  }
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
els.serviceAdminList.addEventListener('change', (event) => {
  const activeToggle = event.target.closest('[data-service-active]')
  if (activeToggle) toggleServiceActive(activeToggle.dataset.serviceActive, activeToggle.checked).catch((error) => toast(error.message))
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
  const versionTag = document.querySelector('#sidebarVersion')
  if (versionTag) versionTag.textContent = `v${ADMIN_BUILD}`
  applyLanguage()
  setLocked(true)
  if (!owner.auth?.accessToken) return
  try {
    await request('/admin/auth/me')
    await loadAll()
    if (owner.auth?.admin?.mustChangePassword) renderForcePasswordChange()
  } catch (error) {
    ownerLogout()
    toast(error.message)
  }
}

// ===== 会员套餐 / 次卡 / 优惠券(网页老板端,与小程序同后端 /admin/packages、/admin/coupons)=====
let membershipData = { packages: [], coupons: [], prizes: [] }
function mCents(v) { const n = Number(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : 0 }
function mMoney(cents) { return '$' + (Math.round(cents || 0) / 100) }
async function loadMembershipPage() {
  const [p, c, z, cat] = await Promise.all([
    request('/admin/packages'),
    request('/admin/coupons'),
    request('/admin/points-prizes').catch(() => ({ prizes: [] })), // 2026-08-02 积分商城奖品(owner-only,失败不拖垮整页)
    request('/admin/pricing/categories').catch(() => ({ categories: [] })) // C3 发券的「适用范围」要按本店大类选
  ])
  membershipData = { packages: p.packages || [], coupons: c.coupons || [], prizes: z.prizes || [], categories: cat.categories || [] }
  // 屏 C3 自定义发放:整区仅老板;员工端连请求都不发(后端同样 403,不靠前端自觉)
  couponGrantState.grants = isOwnerRole()
    ? (await request('/admin/coupon-grants').catch(() => ({ grants: [] }))).grants || []
    : []
  renderMembership()
  renderCouponGrantSection()
}

/* ===== 屏 C3「自定义发放」(2026-08-09)=====
   搜顾客 → 选中 → 填券(自定义金额 或 指定券模板)→ 原因必填 → 发放;下方即发放记录(审计)。
   金额红线:本区只把「元」换算成「分」传给后端一次,券能抵多少、月度让利多少一律后端算。 */
const couponGrantState = {
  grants: [],
  query: '',
  results: [],
  picked: null,
  mode: 'custom',      // custom 自定义金额 | template 指定券模板
  templateId: '',
  amount: '',
  minSpend: '',
  scope: [],           // 空 = 全部大类
  validDays: '30',
  reason: '',
  filterKind: '',
  filterStatus: ''
}

function renderCouponGrantSection() {
  if (!els.couponGrantCard) return
  // 员工登录整区隐藏(设计图规则⓪:首版仅老板可见可发)
  els.couponGrantCard.classList.toggle('hidden', !isOwnerRole())
  if (!isOwnerRole()) return
  const st = couponGrantState
  const cats = membershipData.categories || []
  const tpls = membershipData.coupons.filter((c) => c.isActive)
  els.couponGrantForm.innerHTML = `
    <div class="cpn-grant-grid">
      <label class="cpn-field"><span>搜索顾客</span>
        <input id="cpnGrantSearch" placeholder="姓名或手机号" value="${escapeHtml(st.query)}" autocomplete="off">
      </label>
      <div id="cpnGrantResults" class="cpn-results">${
        st.picked
          ? `<div class="cpn-hit on"><b>${escapeHtml(st.picked.displayName || '')}</b><span class="subtle">${escapeHtml(st.picked.phone || '')}</span><button class="ghost slim" data-cpn-unpick type="button">换一位</button></div>`
          : (st.results.length
            ? st.results.map((c) => `<div class="cpn-hit" data-cpn-pick="${escapeHtml(c.id)}"><b>${escapeHtml(c.displayName || '')}</b><span class="subtle">${escapeHtml(c.phone || '')}</span></div>`).join('')
            : (st.query ? '<div class="subtle">没搜到这位顾客</div>' : '<div class="subtle">输入姓名或手机号找顾客</div>'))
      }</div>
      <div class="cpn-field"><span>发什么</span>
        <div class="seg-toggle">
          <button type="button" class="${st.mode === 'template' ? '' : 'on'}" data-cpn-mode="custom">自定义金额</button>
          <button type="button" class="${st.mode === 'template' ? 'on' : ''}" data-cpn-mode="template">选券模板</button>
        </div>
      </div>
      ${st.mode === 'template'
        ? `<label class="cpn-field"><span>券模板</span>
             <select id="cpnGrantTemplate">
               <option value="">选择一张券模板</option>
               ${tpls.map((c) => `<option value="${escapeHtml(c.id)}"${st.templateId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
             </select>
           </label>`
        : `<label class="cpn-field"><span>券面额</span><input id="cpnGrantAmount" placeholder="例:50" value="${escapeHtml(st.amount)}"></label>
           <label class="cpn-field"><span>使用门槛(留空=无门槛)</span><input id="cpnGrantMin" placeholder="例:300" value="${escapeHtml(st.minSpend)}"></label>
           <label class="cpn-field"><span>适用范围</span>
             <select id="cpnGrantScope">
               <option value="">全部大类</option>
               ${cats.map((c) => `<option value="${escapeHtml(c.id)}"${st.scope[0] === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
             </select>
           </label>`}
      <label class="cpn-field"><span>有效期(天)</span><input id="cpnGrantDays" value="${escapeHtml(st.validDays)}"></label>
      <label class="cpn-field wide"><span>发放原因(必填)</span><input id="cpnGrantReason" placeholder="例:上次服务补偿" value="${escapeHtml(st.reason)}"></label>
    </div>
    <button class="primary" data-cpn-grant-submit type="button"${st.picked ? '' : ' disabled'}>确认发放${st.picked ? ` 给 ${escapeHtml(st.picked.displayName || '')}` : ''}</button>`

  els.couponGrantFilters.innerHTML = `
    ${[['', '全部'], ['custom', '特批'], ['template', '模板/系统']].map(([v, label]) =>
      `<button class="ghost slim${st.filterKind === v ? ' active' : ''}" data-cpn-filter-kind="${v}" type="button">${label}</button>`).join('')}
    ${[['', '全部状态'], ['active', '未使用'], ['used', '已核销'], ['revoked', '已作废'], ['expired', '已过期']].map(([v, label]) =>
      `<button class="ghost slim${st.filterStatus === v ? ' active' : ''}" data-cpn-filter-status="${v}" type="button">${label}</button>`).join('')}`

  const rows = st.grants.filter((g) => (!st.filterKind || g.grantKind === st.filterKind) && (!st.filterStatus || g.status === st.filterStatus))
  const statusText = { active: '未使用', used: '已核销', revoked: '已作废', expired: '已过期' }
  els.couponGrantList.innerHTML = rows.length ? rows.map((g) => `
    <div class="service-admin-item">
      <div>
        <strong>${escapeHtml(g.name)}</strong>
        <span class="subtle">${g.grantKind === 'custom' ? '特批' : '模板'} · ${escapeHtml(g.valueText)} · ${escapeHtml(g.thresholdText)} · ${escapeHtml(g.scopeText)}</span>
        <div class="subtle">发给 ${escapeHtml(g.userName || g.userId)} · 发放人 ${escapeHtml(g.grantedBy)}${g.grantReason ? ` · ${escapeHtml(g.grantReason)}` : ''}</div>
        <div class="subtle">${statusText[g.status] || g.status}${g.settlementCode ? ` · ${escapeHtml(g.settlementCode)}` : ''}${g.expiresAt ? ` · ${String(g.expiresAt).slice(0, 10)} 到期` : ''}${g.revokeReason ? ` · 作废原因:${escapeHtml(g.revokeReason)}` : ''}</div>
      </div>
      <div class="row-actions">
        ${g.status === 'active' ? `<button class="ghost slim" data-cpn-revoke="${escapeHtml(g.id)}" type="button">作废</button>` : ''}
      </div>
    </div>`).join('') : '<div class="empty-state">还没有发放记录</div>'
}

// 元 → 分只在这一处换算(不是计价);后端拿到的就是分
function cpnCents(value) {
  const n = Number(String(value || '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

async function searchCouponCustomers(q) {
  couponGrantState.query = q
  if (!q.trim()) { couponGrantState.results = []; return renderCouponGrantSection() }
  try {
    const data = await request(`/admin/customers?q=${encodeURIComponent(q.trim())}`)
    couponGrantState.results = data.customers || []
  } catch { couponGrantState.results = [] }
  renderCouponGrantSection()
}

async function submitCouponGrant() {
  const st = couponGrantState
  if (!st.picked) return toast('先选一位顾客')
  if (!st.reason.trim()) return toast('发放原因必填')
  const body = {
    userId: st.picked.id,
    reason: st.reason.trim(),
    validDays: Number(st.validDays) || 30
  }
  if (st.mode === 'template') {
    if (!st.templateId) return toast('先选一张券模板')
    body.mode = 'template'
    body.couponId = st.templateId
  } else {
    body.amountCents = cpnCents(st.amount)
    if (!body.amountCents) return toast('填一个大于 0 的券面额')
    body.minSpendCents = cpnCents(st.minSpend)
    body.scopeCategoryIds = st.scope.filter(Boolean)
  }
  try {
    const res = await request('/admin/coupon-grants/custom', { method: 'POST', body: JSON.stringify(body) })
    toast(`已发放:${res.granted.couponName} → ${res.granted.userName}`)
    Object.assign(st, { amount: '', minSpend: '', reason: '', templateId: '', scope: [] })
    await loadMembershipPage()
  } catch (error) {
    toast(error.message)
  }
}
function renderMembership() {
  if (!els.packageAdminList) return
  const pkgs = membershipData.packages
  els.packageAdminList.innerHTML = pkgs.length ? pkgs.map((p) => `
    <div class="service-admin-item${p.isActive ? '' : ' inactive'}">
      <div><strong>${escapeHtml(p.name)}</strong> <span class="subtle">${p.kind === 'times' ? '次卡' : '充值套餐'}${p.isActive ? '' : ' · 已下架'}</span>
        <div class="subtle">${p.kind === 'times'
          ? `售价 ${mMoney(p.priceCents)} · ${p.timesCount} 次${p.scope ? ' · ' + escapeHtml(p.scope) : ''}`
          : `售价 ${mMoney(p.priceCents)}${p.bonusCents ? ' · 送 ' + mMoney(p.bonusCents) : ''}`}${p.benefits ? ' · ' + escapeHtml(p.benefits) : ''}</div>
      </div>
      <div class="row-actions">
        <button class="ghost slim" data-pkg-edit="${p.id}" type="button">编辑</button>
        <button class="ghost slim" data-pkg-toggle="${p.id}" type="button">${p.isActive ? '下架' : '上架'}</button>
      </div>
    </div>`).join('') : '<div class="empty-state">还没有套餐,点右上角新增</div>'
  const cs = membershipData.coupons
  els.couponAdminList.innerHTML = cs.length ? cs.map((c) => `
    <div class="service-admin-item${c.isActive ? '' : ' inactive'}">
      <div><strong>${escapeHtml(c.name)}</strong> <span class="subtle">${c.isActive ? '' : '已停用'}</span>
        <div class="subtle">${c.discountType === 'percent' ? `立减 ${c.percentOff}%` : `减 ${mMoney(c.amountCents)}`} · ${c.minSpendCents ? '满 ' + mMoney(c.minSpendCents) : '无门槛'} · ${c.validDays}天${c.totalQty ? ' · 限 ' + c.totalQty + ' 张' : ''}</div>
      </div>
      <div class="row-actions">
        <button class="ghost slim" data-cpn-edit="${c.id}" type="button">编辑</button>
        <button class="ghost slim" data-cpn-toggle="${c.id}" type="button">${c.isActive ? '停用' : '启用'}</button>
      </div>
    </div>`).join('') : '<div class="empty-state">还没有优惠券,点右上角新增</div>'
  // 2026-08-02 积分商城奖品(奖品=券;与小程序积分商城同后端 /admin/points-prizes)
  const przs = membershipData.prizes || []
  if (els.pointsPrizeList) els.pointsPrizeList.innerHTML = przs.length ? przs.map((z) => `
    <div class="service-admin-item${z.isActive ? '' : ' inactive'}">
      <div><strong>${escapeHtml(z.name || '奖品')}</strong> <span class="subtle">${z.discountType === 'percent' ? `立减 ${z.percentOff}%` : `减 ${mMoney(z.amountCents)}`}${z.minSpendCents ? ` · 满 ${mMoney(z.minSpendCents)}` : ''}${z.isActive ? '' : ' · 已下架'}</span>
        <div class="subtle">${z.costPoints} 积分 · 库存 ${z.stock}${z.redeemedQty ? ` · 已兑 ${z.redeemedQty}` : ''}${z.perUserLimit ? ` · 每人限 ${z.perUserLimit}` : ''}${z.validDays ? ` · 兑后 ${z.validDays} 天有效` : ''}</div>
      </div>
      <div class="row-actions">
        <button class="ghost slim" data-prz-edit="${z.id}" type="button">编辑</button>
        <button class="ghost slim" data-prz-toggle="${z.id}" type="button">${z.isActive ? '下架' : '上架'}</button>
      </div>
    </div>`).join('') : '<div class="empty-state">还没有奖品。点「+ 新增奖品」,可选现有券或当场建一张新券。</div>'
}
async function savePackage(kind, existing) {
  kind = kind || (existing && existing.kind) || 'recharge'
  const name = window.prompt('套餐名称', existing ? existing.name : (kind === 'times' ? '纯色×5次卡' : '充1000送50'))
  if (!name) return
  const price = window.prompt('售价(加元)', existing ? String(existing.priceCents / 100) : '')
  if (price === null) return
  const body = { kind, name: name.trim(), priceCents: mCents(price) }
  if (kind === 'recharge') {
    const bonus = window.prompt('额外赠送(加元,可留空)', existing && existing.bonusCents ? String(existing.bonusCents / 100) : '')
    body.bonusCents = mCents(bonus || 0)
  } else {
    const times = window.prompt('包含次数', existing && existing.timesCount ? String(existing.timesCount) : '5')
    body.timesCount = Math.round(Number(times) || 0)
    const scope = window.prompt('适用范围(可留空)', existing ? existing.scope || '' : '')
    body.scope = (scope || '').trim()
  }
  const benefits = window.prompt('权益说明(可留空)', existing ? existing.benefits || '' : '')
  body.benefits = (benefits || '').trim()
  try {
    if (existing) await request(`/admin/packages/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    else await request('/admin/packages', { method: 'POST', body: JSON.stringify(body) })
    toast('已保存')
    await loadMembershipPage()
  } catch (error) { toast(error.message) }
}
async function saveCoupon(existing) {
  const name = window.prompt('优惠券名称', existing ? existing.name : '满200减30')
  if (!name) return
  const typeIn = window.prompt('类型:输入 1=满减券,2=折扣券', existing ? (existing.discountType === 'percent' ? '2' : '1') : '1')
  if (typeIn === null) return
  const discountType = String(typeIn).trim() === '2' ? 'percent' : 'amount'
  const body = { name: name.trim(), discountType }
  if (discountType === 'amount') {
    const amt = window.prompt('面额(减多少加元)', existing ? String(existing.amountCents / 100) : '30')
    body.amountCents = mCents(amt)
  } else {
    const pct = window.prompt('立减折扣(%,如 10 表示立减10%)', existing ? String(existing.percentOff) : '10')
    body.percentOff = Math.round(Number(pct) || 0)
  }
  const min = window.prompt('使用门槛(加元,0=无门槛)', existing ? String(existing.minSpendCents / 100) : '0')
  body.minSpendCents = mCents(min || 0)
  const days = window.prompt('有效天数', existing ? String(existing.validDays) : '30')
  body.validDays = Math.round(Number(days) || 30)
  const qty = window.prompt('发放总量(0=不限量)', existing && existing.totalQty ? String(existing.totalQty) : '0')
  body.totalQty = Math.round(Number(qty) || 0)
  try {
    if (existing) await request(`/admin/coupons/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    else await request('/admin/coupons', { method: 'POST', body: JSON.stringify(body) })
    toast('已保存')
    await loadMembershipPage()
  } catch (error) { toast(error.message) }
}
// 2026-08-02 积分商城:奖品增改(奖品=券,可当场建券,流程参考小程序 points-mall 的 save())
async function savePrize(existing) {
  let couponId = existing ? existing.couponId : ''
  if (!existing) {
    const actives = membershipData.coupons.filter((c) => c.isActive)
    const menu = actives.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
    const pick = window.prompt(`奖品对应哪张券?输入序号;输入 0 当场建一张新券:\n${menu || '(还没有券,输入 0 新建)'}`, actives.length ? '1' : '0')
    if (pick === null) return
    const idx = Math.round(Number(pick))
    if (idx === 0) {
      const before = new Set(membershipData.coupons.map((c) => c.id))
      await saveCoupon() // 内部保存成功后会刷新 membershipData
      const created = membershipData.coupons.find((c) => !before.has(c.id))
      if (!created) return // 建券被取消/失败,不继续
      couponId = created.id
    } else if (idx >= 1 && idx <= actives.length) {
      couponId = actives[idx - 1].id
    } else { toast('无效选择'); return }
  }
  const cost = window.prompt('兑换所需积分($1消费=1积分)', existing ? String(existing.costPoints) : '500')
  if (cost === null) return
  const stock = window.prompt('库存(可兑换份数)', existing ? String(existing.stock) : '10')
  if (stock === null) return
  const limit = window.prompt('每人限兑(0=不限)', existing ? String(existing.perUserLimit || 0) : '1')
  if (limit === null) return
  const days = window.prompt('兑换后有效天数(0=按券默认)', existing && existing.validDays ? String(existing.validDays) : '0')
  if (days === null) return
  const body = {
    couponId,
    costPoints: Math.round(Number(cost) || 0),
    stock: Math.round(Number(stock) || 0),
    perUserLimit: Math.round(Number(limit) || 0),
    validDays: Math.round(Number(days) || 0)
  }
  try {
    if (existing) await request(`/admin/points-prizes/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    else await request('/admin/points-prizes', { method: 'POST', body: JSON.stringify(body) })
    toast('已保存,小程序积分商城立即可见')
    await loadMembershipPage()
  } catch (error) { toast(error.message) }
}
// 撤销误兑:券未核销才可撤;券作废+积分冲正退回+库存回补(后端事务)
async function revokeRedeem() {
  const code = window.prompt('输入要撤销的兑换券码(如 LL-XXXX-XXXX;仅未核销的可撤):')
  if (!code || !code.trim()) return
  if (!window.confirm(`确认撤销 ${code.trim().toUpperCase()}?券将作废,积分退回顾客,库存+1。`)) return
  try {
    const r = await request('/admin/points-mall/revoke', { method: 'POST', body: JSON.stringify({ code: code.trim() }) })
    toast(`已撤销,退回 ${r.refundedPoints} 积分`)
    await loadMembershipPage()
  } catch (error) { toast(error.message) }
}
if (els.membershipPage) {
  els.membershipPage.addEventListener('click', async (event) => {
    const addR = event.target.closest('#addRechargeButton')
    const addT = event.target.closest('#addTimesButton')
    const addC = event.target.closest('#addCouponButton')
    const addZ = event.target.closest('#addPrizeButton')
    const revZ = event.target.closest('#revokeRedeemButton')
    const pkgEdit = event.target.closest('[data-pkg-edit]')
    const pkgTog = event.target.closest('[data-pkg-toggle]')
    const cpnEdit = event.target.closest('[data-cpn-edit]')
    const cpnTog = event.target.closest('[data-cpn-toggle]')
    const przEdit = event.target.closest('[data-prz-edit]')
    const przTog = event.target.closest('[data-prz-toggle]')
    if (addR) return savePackage('recharge')
    if (addT) return savePackage('times')
    if (addC) return saveCoupon()
    if (addZ) return savePrize().catch((error) => toast(error.message))
    if (revZ) return revokeRedeem()
    if (przEdit) return savePrize(membershipData.prizes.find((z) => z.id === przEdit.dataset.przEdit)).catch((error) => toast(error.message))
    if (przTog) {
      const z = membershipData.prizes.find((x) => x.id === przTog.dataset.przToggle)
      try { await request(`/admin/points-prizes/${z.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !z.isActive }) }); await loadMembershipPage() } catch (error) { toast(error.message) }
      return
    }
    if (pkgEdit) return savePackage(undefined, membershipData.packages.find((p) => p.id === pkgEdit.dataset.pkgEdit))
    if (cpnEdit) return saveCoupon(membershipData.coupons.find((c) => c.id === cpnEdit.dataset.cpnEdit))
    if (pkgTog) {
      const p = membershipData.packages.find((x) => x.id === pkgTog.dataset.pkgToggle)
      try { await request(`/admin/packages/${p.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !p.isActive }) }); await loadMembershipPage() } catch (error) { toast(error.message) }
      return
    }
    if (cpnTog) {
      const c = membershipData.coupons.find((x) => x.id === cpnTog.dataset.cpnToggle)
      try { await request(`/admin/coupons/${c.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !c.isActive }) }); await loadMembershipPage() } catch (error) { toast(error.message) }
      return
    }

    // ===== 屏 C3 自定义发放 =====
    const cpnPick = event.target.closest('[data-cpn-pick]')
    if (cpnPick) {
      couponGrantState.picked = couponGrantState.results.find((c) => c.id === cpnPick.dataset.cpnPick) || null
      return renderCouponGrantSection()
    }
    if (event.target.closest('[data-cpn-unpick]')) {
      couponGrantState.picked = null
      return renderCouponGrantSection()
    }
    const cpnMode = event.target.closest('[data-cpn-mode]')
    if (cpnMode) {
      couponGrantState.mode = cpnMode.dataset.cpnMode
      return renderCouponGrantSection()
    }
    const cpnKind = event.target.closest('[data-cpn-filter-kind]')
    if (cpnKind) {
      couponGrantState.filterKind = cpnKind.dataset.cpnFilterKind
      return renderCouponGrantSection()
    }
    const cpnStatus = event.target.closest('[data-cpn-filter-status]')
    if (cpnStatus) {
      couponGrantState.filterStatus = cpnStatus.dataset.cpnFilterStatus
      return renderCouponGrantSection()
    }
    if (event.target.closest('[data-cpn-grant-submit]')) return submitCouponGrant()
    const cpnRevoke = event.target.closest('[data-cpn-revoke]')
    if (cpnRevoke) {
      const reason = window.prompt('作废原因(必填,记录只追加不可删)')
      if (!reason || !reason.trim()) return
      try {
        await request(`/admin/coupon-grants/${cpnRevoke.dataset.cpnRevoke}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) })
        await loadMembershipPage()
      } catch (error) { toast(error.message) }
    }
  })

  // 发券表单是每次重画的,所以输入用事件委托记进 state,不然重画一次就清空
  els.membershipPage?.addEventListener('input', (event) => {
    const st = couponGrantState
    const id = event.target.id
    if (id === 'cpnGrantSearch') {
      clearTimeout(couponSearchTimer)
      const value = event.target.value
      couponSearchTimer = setTimeout(() => searchCouponCustomers(value), 250)
      st.query = value
      return
    }
    if (id === 'cpnGrantAmount') st.amount = event.target.value
    if (id === 'cpnGrantMin') st.minSpend = event.target.value
    if (id === 'cpnGrantDays') st.validDays = event.target.value
    if (id === 'cpnGrantReason') st.reason = event.target.value
  })
  els.membershipPage?.addEventListener('change', (event) => {
    if (event.target.id === 'cpnGrantTemplate') couponGrantState.templateId = event.target.value
    if (event.target.id === 'cpnGrantScope') couponGrantState.scope = event.target.value ? [event.target.value] : []
  })
}
let couponSearchTimer = null
initAdmin().catch((error) => toast(error.message))

/* ===== 套餐与续费(网页版,2026-08-03;2026-08-04 并入「门店设置 → 当前套餐」)=====
   与小程序 pages/merchant/subscription 同一套后端接口(/admin/subscription*),
   档位名称与价格一律由后端 PLAN_PRICING 下发(Youji Pricing 口径),前端不写死任何价格。
   注:subState / SUB_STATUS 声明在文件上方(renderTenantPlan 会用到,避免 const 暂时性死区)。 */

function subMoney(cents) {
  return '¥' + Math.round((cents || 0) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function subDate(value) {
  return value ? String(value).slice(0, 10) : ''
}

async function loadSubscriptionPage() {
  subState.data = await request('/admin/subscription')
  renderTenantPlan() // 订阅 UI 挂在「门店设置 → 当前套餐」展开区里
}

// 只重画订阅那一块(切换年付/月付、开关自动续费时用),不动上面的功能清单
function renderSubscription() {
  const box = els.planDetailBody?.querySelector('.sub-wrap')
  if (!box) return renderTenantPlan()
  box.innerHTML = subscriptionMarkup()
  playSubscriptionAnimation()
}

function playSubscriptionAnimation() {
  // 进度条动效:插入后下一帧再赋宽度,CSS transition 才会跑
  requestAnimationFrame(() => {
    const bar = els.planDetailBody?.querySelector('[data-sub-bar]')
    if (bar) bar.style.width = `${bar.dataset.subBar || 0}%`
  })
  const d = subState.data
  const needsAttention = Boolean(d) && ['expiring', 'grace', 'suspended'].includes(d.status)
  els.subscriptionBadge?.classList.toggle('hidden', !needsAttention)
  if (needsAttention && els.subscriptionBadge) els.subscriptionBadge.textContent = '!'
}

function subscriptionMarkup() {
  const d = subState.data
  if (!d) return '<p class="subtle">订阅信息加载中…</p>'
  const st = SUB_STATUS[d.status] || SUB_STATUS.active
  // 到期提醒:只有真到了临界点才出现,平时不打扰
  const alertText = d.status === 'expiring' ? `套餐还有 ${d.daysLeft} 天到期。续费后到期日从原到期日顺延，不浪费已付的天数。`
    : d.status === 'grace' ? '套餐已到期，目前处于宽限期。续费即恢复全部功能，数据不会丢失。'
      : d.status === 'suspended' ? '套餐已停用，数据保留 90 天。续费后立即全量恢复。'
        : ''
  const noPrice = !d.prices || !d.prices.yearCents // 免费版与定制版都不走自助续费
  const canRenew = !noPrice && d.status !== 'unlimited'
  const req = d.latestPlanRequest
  const pendingReq = req && req.status === 'PENDING'
    ? `已提交${req.requestType === 'renew' ? '续费' : '档位变更'}申请（${subDate(req.createdAt)}），平台会尽快联系你。`
    : ''
  const barPct = d.daysLeft == null ? 100 : Math.max(2, Math.min(100, Math.round((d.daysLeft / 365) * 100)))
  const payCents = d.prices ? (subState.period === 'month' ? d.prices.monthCents : d.prices.yearCents) : 0

  return `
    <div class="sub-grid">
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="sub-hero">
          <p class="sub-eyebrow">当前套餐</p>
          <h2>${escapeHtml(d.planName || '')}<span class="sub-tag ${st.cls}">${st.tag}</span></h2>
          <p class="sub-exp">${d.expiresAt ? `有效期至 ${subDate(d.expiresAt)}${d.daysLeft != null ? `　·　剩余 ${d.daysLeft} 天` : ''}` : '长期授权，无需续费'}</p>
          <div class="sub-bar"><i data-sub-bar="${barPct}" style="width:0"></i></div>
        </div>
        ${alertText ? `<div class="sub-alert">${alertText}</div>` : ''}
        ${pendingReq ? `<div class="sub-alert info">${pendingReq}</div>` : ''}

        ${canRenew ? `
        <div class="sub-card">
          <div class="sub-row">
            <div><h3>续费</h3><p class="sub-note">年付更划算；续费按当前档位定价。</p></div>
            <div class="sub-seg">
              <button type="button" data-sub-period="year" class="${subState.period === 'year' ? 'on' : ''}">年付</button>
              <button type="button" data-sub-period="month" class="${subState.period === 'month' ? 'on' : ''}">月付</button>
            </div>
          </div>
          <button class="primary sub-pay" type="button" data-sub-renew>立即续费 ${subMoney(payCents)}</button>
          <p class="sub-note" style="margin-top:10px">${d.mockPay ? '当前为本地沙盘模式，可模拟支付联调。' : '支付通道开通前，下单后由平台确认收款并顺延到期日。'}</p>
        </div>` : `
        <div class="sub-card">
          <h3>续费</h3>
          <p class="sub-note">${d.status === 'unlimited' ? '本店为长期授权，无需续费。' : '免费版永久免费；定制版为按需报价，续费请直接联系我们。'}</p>
        </div>`}

        <div class="sub-card">
          <h3>AI 智能包（单独订阅）</h3>
          <p class="sub-note">基础订阅功能齐全，但不含 AI。</p>
          ${renderSubAi(d.aiAddon || {})}
        </div>

        ${(d.orders || []).length ? `
        <div class="sub-card">
          <h3>续费记录</h3>
          <table class="sub-hist">
            <thead><tr><th>项目</th><th>日期</th><th>金额</th><th>状态</th></tr></thead>
            <tbody>${d.orders.map((o) => `<tr>
              <td>${o.plan === 'ai_addon' ? 'AI 智能包' : '套餐续费'}　${o.period === 'month' ? '月付' : '年付'}</td>
              <td>${subDate(o.paidAt || o.createdAt)}</td>
              <td>${subMoney(o.amountCents)}</td>
              <td class="${o.status === 'paid' ? '' : 'pend'}">${o.status === 'paid' ? '已支付' : '待支付'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="sub-card">
          <div class="sub-row">
            <div><h3>自动续费</h3><p class="sub-note">开启后到期前自动生成续费单并提醒；不会在未确认的情况下扣款。</p></div>
            <button class="sub-switch" type="button" data-sub-auto aria-checked="${d.autoRenew ? 'true' : 'false'}"><i></i></button>
          </div>
        </div>
        <div class="sub-card">
          <h3>全部档位</h3>
          <p class="sub-note" style="margin-bottom:12px">需要升级或降级，可直接提交申请，我们会联系你确认功能与费用，确认前现有服务不受影响。</p>
          <div class="sub-tiers">
            ${(d.tiers || []).map((tier) => `
              <div class="sub-tier ${tier.current ? 'cur' : ''}">
                ${tier.note ? `<span class="tbadge">${escapeHtml(tier.note)}</span>` : ''}
                <div class="tname">${escapeHtml(tier.name)}</div>
                <div class="tprice">${tier.yearCents ? `${subMoney(tier.yearCents)}/年` : (tier.monthCents === 0 ? '¥0' : '面议')}</div>
                <div class="tsub">${tier.yearCents ? `或 ${subMoney(tier.monthCents)}/月` : '按需求报价'}</div>
                <div class="tfit">${escapeHtml(tier.fit || '')}</div>
                ${tier.current ? '<span class="tcur">✓ 当前档位</span>'
                  : `<button class="ghost slim" type="button" data-sub-tier="${escapeHtml(tier.id)}" data-sub-tier-name="${escapeHtml(tier.name)}">申请变更</button>`}
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`
}

// AI 智能包卡片:套餐自带 / 试用中 / 已订阅 / 待开通(申请已提交) / 未开通
function renderSubAi(a) {
  const exp = subDate(a.expiresAt)
  let badge = '未开通'
  let badgeCls = ''
  let expText = ''
  if (a.includedInPlan) { badge = '套餐已含'; badgeCls = 'on'; expText = '当前套餐已包含 AI，无需单独订阅。' }
  else if (a.enabled && a.unlimited) { badge = '长期开通'; badgeCls = 'on'; expText = 'AI 智能包长期有效，无到期时间。' }
  else if (a.enabled && a.source === 'trial') { badge = '试用中'; badgeCls = 'trial'; expText = `免费试用至 ${exp}，到期后可续订。` }
  else if (a.enabled) { badge = '已订阅'; badgeCls = 'on'; expText = `AI 有效期至 ${exp}。` }
  else if (a.trialPending) { badge = '待开通'; badgeCls = 'trial'; expText = `试用申请已提交（${subDate(a.trialPendingAt)}），我们会联系你确认门店信息后开通。` }
  else if (exp) { expText = `已于 ${exp} 到期，续订后立即恢复。` }
  const monthY = Math.round((a.monthCents || 9900) / 100)
  const yearY = Math.round((a.yearCents || 99000) / 100)
  return `
    <div class="sub-ai-top" style="margin-top:12px">
      <div>
        <h3>AI 智能包<span class="sub-ai-badge ${badgeCls}">${badge}</span></h3>
        <p class="sub-ai-desc">AI 接待 · 自动报价 · 话术生成</p>
        ${expText ? `<p class="sub-ai-exp">${expText}</p>` : ''}
      </div>
      ${a.includedInPlan ? '' : `<div class="sub-ai-price">¥${monthY}/月<span>¥${yearY}/年</span></div>`}
    </div>
    ${a.includedInPlan ? '' : `<div class="sub-ai-btns">
      ${a.trialPending ? '<div class="waiting">申请处理中</div>'
        : (a.trialAvailable ? '<button class="primary slim" type="button" data-sub-ai-trial>申请免费试用 3 个月</button>' : '')}
      <button class="ghost slim" type="button" data-sub-ai-sub="year">订阅一年 ¥${yearY}</button>
      <button class="ghost slim" type="button" data-sub-ai-sub="month">按月 ¥${monthY}</button>
    </div>`}`
}

// 订阅相关交互挂在门店设置页上(「当前套餐」展开区在这里面)
if (els.storeSettingsPage) {
  els.storeSettingsPage.addEventListener('click', async (event) => {
    const periodBtn = event.target.closest('[data-sub-period]')
    if (periodBtn) {
      subState.period = periodBtn.dataset.subPeriod === 'month' ? 'month' : 'year'
      renderSubscription()
      return
    }
    const autoBtn = event.target.closest('[data-sub-auto]')
    if (autoBtn) {
      const next = !subState.data.autoRenew
      try {
        await request('/admin/subscription/auto-renew', { method: 'PATCH', body: JSON.stringify({ enabled: next }) })
        subState.data.autoRenew = next
        renderSubscription()
        toast(next ? '已开启：到期前自动生成续费单并提醒' : '已关闭：到期仅提醒')
      } catch (error) { toast(error.message) }
      return
    }
    const tierBtn = event.target.closest('[data-sub-tier]')
    if (tierBtn) {
      const name = tierBtn.dataset.subTierName
      if (!window.confirm(`申请把套餐变更为「${name}」？\n提交后我们会联系你确认功能与费用，确认前现有服务不受影响。`)) return
      try {
        await request('/admin/tenant/plan/change-request', { method: 'POST', body: JSON.stringify({ targetPlan: tierBtn.dataset.subTier, note: '网页端申请' }) })
        toast('已提交，我们会尽快联系你')
        await loadSubscriptionPage()
      } catch (error) { toast(error.message) }
      return
    }
    // 试用为申请制:不即时开通,生成申请落到平台后台,由我们联系商家配置后发放
    if (event.target.closest('[data-sub-ai-trial]')) {
      if (!window.confirm('AI 智能包需要按你门店的项目、价格和话术做一次配置。\n提交申请后我们会尽快联系你，配置完成即开通，试用期 3 个月不收费。')) return
      try {
        await request('/admin/subscription/ai-trial', { method: 'POST', body: '{}' })
        toast('申请已提交，我们会尽快联系你')
        await loadSubscriptionPage()
      } catch (error) { toast(error.message) }
      return
    }
    const aiSubBtn = event.target.closest('[data-sub-ai-sub]')
    if (aiSubBtn) {
      const period = aiSubBtn.dataset.subAiSub === 'month' ? 'month' : 'year'
      try {
        const r = await request('/admin/subscription/ai-subscribe', { method: 'POST', body: JSON.stringify({ period }) })
        await settleSubOrder(r, 'ai')
      } catch (error) { toast(error.message) }
      return
    }
    if (event.target.closest('[data-sub-renew]')) {
      if (subState.paying) return
      subState.paying = true
      try {
        const r = await request('/admin/subscription/renew', { method: 'POST', body: JSON.stringify({ period: subState.period }) })
        await settleSubOrder(r, 'plan')
      } catch (error) { toast(error.message) } finally { subState.paying = false }
    }
  })
}

// 下单后的收尾:沙盘模式可模拟支付;生产未接支付则提示走平台确认收款
async function settleSubOrder(r, kind) {
  if (r.payment === 'mock') {
    if (window.confirm(`模拟支付 ${subMoney(r.order.amountCents)}${kind === 'ai' ? ' 开通 AI 智能包' : ' 并顺延到期日'}？\n（本地沙盘，生产环境此处为微信支付）`)) {
      const p = await request(`/admin/subscription/orders/${r.order.id}/mock-pay`, { method: 'POST', body: '{}' })
      toast(kind === 'ai' ? `已开通至 ${subDate(p.aiExpiresAt)}` : `续费成功，有效期至 ${subDate(p.expiresAt)}`)
    }
  } else {
    window.alert(`订单 ${subMoney(r.order.amountCents)} 已创建，平台确认收款后自动${kind === 'ai' ? '开通' : '顺延到期日'}。\n请联系我们完成付款，订单号：${r.order.id.slice(-8)}。`)
  }
  await loadSubscriptionPage()
}

/* ===== 价目表管理(2026-08-06 P0)=====
   三个 tab:大类 / 项目与加项(原价·分享价·会员价·疗程价) / 计价规则(四条 + 试算器)。
   与后端 /admin/pricing/* 一一对应;list 档就是 services.price_cents(后端双写),所以「服务管理」页看到的价格 = 这里的原价。 */
let pricingState = { tab: 'categories', categories: [], items: [], rules: {}, editing: null, preview: null }

const pzh = () => owner.lang === 'zh'
function pMoney(c) { return (c === null || c === undefined) ? '—' : `${Math.round(c) / 100}` }
function pCents(v) {
  const text = String(v ?? '').trim()
  if (!text) return null
  const n = Number(text.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
const PRICING_UNITS = [['once', '单次 / once'], ['per_finger', '按指 / per finger'], ['per_session', '按次 / per session']]
const PRICING_RULE_META = {
  foot_surcharge: { zh: '足部加收', en: 'Foot surcharge', descZh: '足部项目在最终金额上整单加收(各价格档算完后加,不分档)', field: 'amountCents', fieldZh: '加收金额', money: true },
  single_finger: { zh: '单指计费', en: 'Single finger', descZh: '单指价 = 该单所用价格档的延长类主项目价 × 百分比 × 指数', field: 'pct', fieldZh: '百分比(%)', money: false },
  tip_reuse: { zh: '甲片重利用', en: 'Tip reuse', descZh: '固定金额,不分价格档', field: 'amountCents', fieldZh: '固定金额', money: true }
}

async function loadPricingPage() {
  const [c, i, r] = await Promise.all([
    request('/admin/pricing/categories'),
    request('/admin/pricing/items'),
    request('/admin/pricing/rules')
  ])
  pricingState.categories = c.categories || []
  pricingState.items = i.items || []
  pricingState.rules = r.rules || {}
  renderPricing()
}

function renderPricing() {
  if (!els.pricingPage) return
  document.querySelectorAll('[data-pricing-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.pricingTab === pricingState.tab))
  els.pricingCategoriesPanel?.classList.toggle('hidden', pricingState.tab !== 'categories')
  els.pricingItemsPanel?.classList.toggle('hidden', pricingState.tab !== 'items')
  els.pricingRulesPanel?.classList.toggle('hidden', pricingState.tab !== 'rules')
  renderPricingCategories()
  renderPricingItems()
  renderPricingRules()
}

function renderPricingCategories() {
  if (!els.pricingCategoryList) return
  const rows = pricingState.categories
  els.pricingCategoryList.innerHTML = rows.length ? rows.map((cat) => `
    <div class="service-admin-item">
      <div>
        <strong>${escapeHtml(cat.name)}</strong>
        <span class="subtle">${escapeHtml(cat.key)} · ${pzh() ? `${cat.itemCount} 个项目` : `${cat.itemCount} items`}${cat.isBookable ? '' : (pzh() ? ' · 不可预约' : ' · not bookable')}</span>
        ${cat.note ? `<div class="subtle">${escapeHtml(cat.note)}</div>` : ''}
      </div>
      <div class="row-actions">
        <label class="subtle"><input type="checkbox" data-cat-bookable="${cat.id}" ${cat.isBookable ? 'checked' : ''}> ${pzh() ? '可预约' : 'Bookable'}</label>
        <input class="pricing-sort" type="number" value="${cat.sortOrder}" data-cat-sort="${cat.id}" title="${pzh() ? '排序' : 'Sort'}">
        <button class="ghost slim" data-cat-rename="${cat.id}" type="button">${pzh() ? '改名' : 'Rename'}</button>
        <button class="ghost slim" data-cat-delete="${cat.id}" type="button">${pzh() ? '删除' : 'Delete'}</button>
      </div>
    </div>`).join('') : `<div class="empty-state">${pzh() ? '还没有大类。先建「美甲单色 / 美睫 / 卸甲」这类大类,再往里放项目。' : 'No categories yet.'}</div>`
}

function renderPricingItems() {
  if (!els.pricingItemList) return
  const catName = (id) => pricingState.categories.find((c) => c.id === id)?.name || (pzh() ? '未分类' : 'Uncategorized')
  const group = (kind) => pricingState.items.filter((i) => i.itemKind === kind)
  const rowHtml = (item) => `
    <div class="service-admin-item${item.isActive ? '' : ' inactive'}">
      <div>
        <strong>${escapeHtml(item.nameZh)}</strong>
        <span class="subtle">${escapeHtml(catName(item.categoryId))}${item.unit === 'per_finger' ? (pzh() ? ' · 按指' : ' · per finger') : ''}${item.isActive ? '' : (pzh() ? ' · 已下架' : ' · hidden')}</span>
        <div class="subtle">${pzh() ? '原价' : 'List'} ${pMoney(item.listPriceCents)}
          · ${pzh() ? '分享价' : 'Share'} ${pMoney(item.sharePriceCents)}
          · ${pzh() ? '会员价' : 'Member'} ${pMoney(item.memberPriceCents)}
          ${item.coursePriceCents ? ` · ${pzh() ? '疗程' : 'Course'} ${pMoney(item.coursePriceCents)}/${item.courseTimes}${pzh() ? '次' : 'x'}` : ''}
          ${item.baseDurationMin ? ` · ${item.baseDurationMin}min` : ''}
          ${item.priceRule === 'pct_of_tier_price' ? ` · ${pzh() ? '按主项目比例' : 'pct of main'} ${item.priceRuleValue || '默认'}%` : ''}</div>
      </div>
      <div class="row-actions">
        <button class="ghost slim" data-item-edit="${item.id}" type="button">${pzh() ? '编辑' : 'Edit'}</button>
        <button class="ghost slim" data-item-toggle="${item.id}" type="button">${item.isActive ? (pzh() ? '下架' : 'Hide') : (pzh() ? '上架' : 'Show')}</button>
        <button class="ghost slim" data-item-delete="${item.id}" type="button">${pzh() ? '删除' : 'Delete'}</button>
      </div>
    </div>`
  const mains = group('main')
  const addons = group('addon')
  els.pricingItemList.innerHTML = `
    <h3 class="pricing-group-title">${pzh() ? `主项目(${mains.length})` : `Main items (${mains.length})`}</h3>
    ${mains.length ? mains.map(rowHtml).join('') : `<div class="empty-state">${pzh() ? '还没有主项目' : 'No main items'}</div>`}
    <h3 class="pricing-group-title">${pzh() ? `加项(${addons.length})` : `Add-ons (${addons.length})`}</h3>
    ${addons.length ? addons.map(rowHtml).join('') : `<div class="empty-state">${pzh() ? '还没有加项(卸甲、贴片、单指补甲都算加项)' : 'No add-ons'}</div>`}`
  renderPricingItemEditor()
}

function renderPricingItemEditor() {
  if (!els.pricingItemEditor) return
  const draft = pricingState.editing
  if (!draft) { els.pricingItemEditor.innerHTML = ''; return }
  const isAddon = draft.itemKind === 'addon'
  els.pricingItemEditor.innerHTML = `
    <div class="pricing-editor">
      <div class="kb-facts-grid">
        <label><span>${pzh() ? '项目名称' : 'Name'}</span><input id="piName" value="${escapeHtml(draft.nameZh || '')}"></label>
        <label><span>${pzh() ? '英文名(选填)' : 'English name'}</span><input id="piNameEn" value="${escapeHtml(draft.nameEn || '')}"></label>
        <label><span>${pzh() ? '大类' : 'Category'}</span><select id="piCategory">
          ${pricingState.categories.map((c) => `<option value="${c.id}" ${c.id === draft.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select></label>
        <label><span>${pzh() ? '计费单位' : 'Unit'}</span><select id="piUnit">
          ${PRICING_UNITS.map(([v, label]) => `<option value="${v}" ${v === (draft.unit || 'once') ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label><span>${pzh() ? '原价' : 'List price'}</span><input id="piList" inputmode="decimal" value="${draft.listPriceCents ? draft.listPriceCents / 100 : ''}"></label>
        <label><span>${pzh() ? '分享价' : 'Share price'}</span><input id="piShare" inputmode="decimal" value="${draft.sharePriceCents ? draft.sharePriceCents / 100 : ''}"></label>
        <label><span>${pzh() ? '会员价' : 'Member price'}</span><input id="piMember" inputmode="decimal" value="${draft.memberPriceCents ? draft.memberPriceCents / 100 : ''}"></label>
        <label><span>${pzh() ? '疗程价(选填)' : 'Course price'}</span><input id="piCourse" inputmode="decimal" value="${draft.coursePriceCents ? draft.coursePriceCents / 100 : ''}"></label>
        <label><span>${pzh() ? '疗程次数' : 'Course times'}</span><input id="piCourseTimes" inputmode="numeric" value="${draft.courseTimes || ''}"></label>
        <label><span>${pzh() ? '时长(分钟)' : 'Duration (min)'}</span><input id="piDuration" inputmode="numeric" value="${draft.baseDurationMin ?? (isAddon ? 0 : 60)}"></label>
      </div>
      ${isAddon ? `
      <div class="pricing-addon-block">
        <label class="subtle"><input type="checkbox" id="piPctRule" ${draft.priceRule === 'pct_of_tier_price' ? 'checked' : ''}>
          ${pzh() ? '单指价按主项目该档价的百分比算(留空用规则默认 10%)' : 'Derive per-finger price from main item price'}</label>
        <input id="piPct" class="pricing-sort" inputmode="decimal" placeholder="%" value="${draft.priceRuleValue || ''}">
        <div class="subtle" style="margin-top:8px">${pzh() ? '适用大类(这个加项能配在哪些大类的项目上)' : 'Applies to categories'}</div>
        <div class="pricing-scope">
          ${pricingState.categories.map((c) => `<label class="subtle"><input type="checkbox" data-scope="${c.id}" ${(draft.addonScope || []).includes(c.id) ? 'checked' : ''}> ${escapeHtml(c.name)}</label>`).join('')}
        </div>
      </div>` : ''}
      <div class="action-row wrap">
        <button class="primary slim" id="piSave" type="button">${pzh() ? '保存' : 'Save'}</button>
        <button class="ghost slim" id="piCancel" type="button">${pzh() ? '取消' : 'Cancel'}</button>
        <span class="subtle">${pzh() ? '原价会同步写回「服务管理」的价格,小程序与 AI 报价立即一致。' : 'List price syncs to the service catalogue used by the mini program and AI.'}</span>
      </div>
    </div>`
}

function collectPricingItemForm() {
  const body = {
    nameZh: document.querySelector('#piName')?.value.trim(),
    nameEn: document.querySelector('#piNameEn')?.value.trim(),
    categoryId: document.querySelector('#piCategory')?.value || null,
    unit: document.querySelector('#piUnit')?.value || 'once',
    itemKind: pricingState.editing.itemKind,
    type: pricingState.editing.type || 'OTHER',
    listPriceCents: pCents(document.querySelector('#piList')?.value) ?? 0,
    sharePriceCents: pCents(document.querySelector('#piShare')?.value),
    memberPriceCents: pCents(document.querySelector('#piMember')?.value),
    coursePriceCents: pCents(document.querySelector('#piCourse')?.value),
    courseTimes: Number(document.querySelector('#piCourseTimes')?.value || 0) || null,
    baseDurationMin: Number(document.querySelector('#piDuration')?.value || 0)
  }
  if (pricingState.editing.itemKind === 'addon') {
    body.priceRule = document.querySelector('#piPctRule')?.checked ? 'pct_of_tier_price' : 'fixed'
    body.priceRuleValue = Number(document.querySelector('#piPct')?.value || 0) || 0
    body.addonScope = Array.from(document.querySelectorAll('[data-scope]')).filter((el) => el.checked).map((el) => el.dataset.scope)
  }
  return body
}

function renderPricingRules() {
  if (!els.pricingRuleList) return
  els.pricingRuleList.innerHTML = Object.entries(PRICING_RULE_META).map(([key, meta]) => {
    const rule = pricingState.rules[key] || { isActive: false, config: {} }
    const value = meta.field ? rule.config[meta.field] : null
    return `
      <div class="service-admin-item${rule.isActive ? '' : ' inactive'}">
        <div>
          <strong>${pzh() ? meta.zh : meta.en}</strong>
          <div class="subtle">${escapeHtml(meta.descZh)}</div>
        </div>
        <div class="row-actions">
          ${meta.field ? `<label class="subtle">${meta.fieldZh}<input class="pricing-sort" data-rule-value="${key}" inputmode="decimal" value="${meta.money ? (value || 0) / 100 : (value ?? '')}"></label>` : ''}
          <label class="subtle"><input type="checkbox" data-rule-active="${key}" ${rule.isActive ? 'checked' : ''}> ${pzh() ? '启用' : 'On'}</label>
        </div>
      </div>`
  }).join('') + `<div class="action-row wrap"><button class="primary slim" id="pricingRulesSave" type="button">${pzh() ? '保存规则' : 'Save rules'}</button></div>`

  // 试算器:选主项目 + 价格档 + 加项,直接调后端 preview,所见即所得
  const mains = pricingState.items.filter((i) => i.itemKind === 'main' && i.isActive)
  const addons = pricingState.items.filter((i) => i.itemKind === 'addon' && i.isActive)
  const q = pricingState.preview
  els.pricingPreviewBox.innerHTML = `
    <h3 class="pricing-group-title">${pzh() ? '试算器(和技师现场报价同一套引擎)' : 'Quote preview'}</h3>
    <div class="kb-facts-grid">
      <label><span>${pzh() ? '主项目' : 'Main item'}</span><select id="pvService">${mains.map((i) => `<option value="${i.id}">${escapeHtml(i.nameZh)}</option>`).join('')}</select></label>
      <label><span>${pzh() ? '价格档' : 'Tier'}</span><select id="pvTier">
        <option value="list">${pzh() ? '原价' : 'List'}</option>
        <option value="share">${pzh() ? '分享价' : 'Share'}</option>
        <option value="member">${pzh() ? '会员价' : 'Member'}</option>
        <option value="course">${pzh() ? '疗程价' : 'Course'}</option>
      </select></label>
      <label><span>${pzh() ? '加项' : 'Add-on'}</span><select id="pvAddon"><option value="">${pzh() ? '(不加)' : '(none)'}</option>${addons.map((i) => `<option value="${i.id}">${escapeHtml(i.nameZh)}</option>`).join('')}</select></label>
      <label><span>${pzh() ? '指数(按指加项用)' : 'Fingers'}</span><input id="pvFingers" inputmode="numeric" value="1"></label>
    </div>
    <div class="action-row wrap">
      <label class="subtle"><input type="checkbox" id="pvFoot"> ${pzh() ? '足部' : 'Foot'}</label>
      <label class="subtle"><input type="checkbox" id="pvTip"> ${pzh() ? '甲片重利用' : 'Tip reuse'}</label>
      <label class="subtle"><input type="checkbox" id="pvManualFree"> ${pzh() ? '技师手动免卸' : 'Manual free removal'}</label>
      <button class="primary slim" id="pvRun" type="button">${pzh() ? '试算' : 'Preview'}</button>
    </div>
    ${q ? `
      <div class="pricing-quote">
        ${q.lines.map((line) => `<div class="pricing-quote-line"><span>${escapeHtml(line.name)}${line.fingers ? ` × ${line.fingers}${pzh() ? '指' : 'f'}` : ''}${line.freeReason ? (pzh() ? `(免:${line.freeReason === 'system' ? '本店做的' : '技师手动'})` : ' (free)') : ''}</span><b>${pMoney(line.amountCents)}</b></div>`).join('')}
        ${q.rulesApplied.filter((r) => r.key === 'foot_surcharge').map((r) => `<div class="pricing-quote-line"><span>${escapeHtml(r.label)}</span><b>+${pMoney(r.amountCents)}</b></div>`).join('')}
        <div class="pricing-quote-line total"><span>${pzh() ? '合计' : 'Total'}</span><b>${pMoney(q.totalCents)}</b></div>
        ${q.courseTimes ? `<div class="subtle">${pzh() ? `疗程包含 ${q.courseTimes} 次` : `${q.courseTimes} sessions`}</div>` : ''}
      </div>` : ''}`
}

async function savePricingRules() {
  const rules = {}
  for (const [key, meta] of Object.entries(PRICING_RULE_META)) {
    const isActive = document.querySelector(`[data-rule-active="${key}"]`)?.checked || false
    const config = {}
    if (meta.field) {
      const raw = document.querySelector(`[data-rule-value="${key}"]`)?.value
      config[meta.field] = meta.money ? (pCents(raw) ?? 0) : (Number(raw) || 0)
    } else {
      config.enabled = isActive
    }
    rules[key] = { isActive, config }
  }
  const res = await request('/admin/pricing/rules', { method: 'PUT', body: JSON.stringify({ rules }) })
  pricingState.rules = res.rules || {}
  renderPricingRules()
  toast(pzh() ? '计价规则已保存,AI 与技师报价同步生效' : 'Pricing rules saved')
}

async function runPricingPreview() {
  const addonId = document.querySelector('#pvAddon')?.value
  const body = {
    serviceId: document.querySelector('#pvService')?.value,
    tierKey: document.querySelector('#pvTier')?.value || 'list',
    addons: addonId ? [{ serviceId: addonId, fingers: Number(document.querySelector('#pvFingers')?.value || 1) }] : [],
    applyFootSurcharge: document.querySelector('#pvFoot')?.checked || false,
    applyTipReuse: document.querySelector('#pvTip')?.checked || false,
    manualFreeRemoval: document.querySelector('#pvManualFree')?.checked || false
  }
  if (!body.serviceId) { toast(pzh() ? '先建一个主项目' : 'Add a main item first'); return }
  const res = await request('/admin/pricing/preview', { method: 'POST', body: JSON.stringify(body) })
  pricingState.preview = res.quote
  renderPricingRules()
}

if (els.pricingPage) {
  els.pricingPage.addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-pricing-tab]')
    if (tab) { pricingState.tab = tab.dataset.pricingTab; renderPricing(); return }
    try {
      if (event.target.closest('#addPricingCategory')) {
        const name = window.prompt(pzh() ? '大类名称(如:美甲单色)' : 'Category name')
        if (!name) return
        const key = window.prompt(pzh() ? '英文标识(小写字母/数字/短横,如 nail_solid;卸甲类请用 removal)' : 'Key', '')
        await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ name: name.trim(), key: (key || '').trim() }) })
        await loadPricingPage()
        toast(pzh() ? '大类已新增' : 'Category added')
        return
      }
      const rename = event.target.closest('[data-cat-rename]')
      if (rename) {
        const cat = pricingState.categories.find((c) => c.id === rename.dataset.catRename)
        const name = window.prompt(pzh() ? '大类名称' : 'Category name', cat.name)
        if (!name) return
        await request(`/admin/pricing/categories/${cat.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) })
        await loadPricingPage()
        return
      }
      const delCat = event.target.closest('[data-cat-delete]')
      if (delCat) {
        const cat = pricingState.categories.find((c) => c.id === delCat.dataset.catDelete)
        if (!window.confirm(pzh() ? `删除大类「${cat.name}」?` : `Delete ${cat.name}?`)) return
        await request(`/admin/pricing/categories/${cat.id}`, { method: 'DELETE' })
        await loadPricingPage()
        toast(pzh() ? '已删除' : 'Deleted')
        return
      }
      if (event.target.closest('#addPricingMain') || event.target.closest('#addPricingAddon')) {
        const isAddon = Boolean(event.target.closest('#addPricingAddon'))
        if (!pricingState.categories.length) { toast(pzh() ? '先建至少一个大类' : 'Create a category first'); return }
        pricingState.editing = { itemKind: isAddon ? 'addon' : 'main', categoryId: pricingState.categories[0].id, unit: 'once', type: 'OTHER', addonScope: [] }
        pricingState.tab = 'items'
        renderPricing()
        return
      }
      const editItem = event.target.closest('[data-item-edit]')
      if (editItem) {
        pricingState.editing = { ...pricingState.items.find((i) => i.id === editItem.dataset.itemEdit) }
        renderPricingItemEditor()
        return
      }
      if (event.target.closest('#piCancel')) { pricingState.editing = null; renderPricingItemEditor(); return }
      if (event.target.closest('#piSave')) {
        const body = collectPricingItemForm()
        if (!body.nameZh) { toast(pzh() ? '项目名称必填' : 'Name required'); return }
        const editingId = pricingState.editing.id
        if (editingId) await request(`/admin/pricing/items/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) })
        else await request('/admin/pricing/items', { method: 'POST', body: JSON.stringify(body) })
        pricingState.editing = null
        await loadPricingPage()
        toast(pzh() ? '已保存,AI 报价立即生效' : 'Saved')
        return
      }
      const togItem = event.target.closest('[data-item-toggle]')
      if (togItem) {
        const item = pricingState.items.find((i) => i.id === togItem.dataset.itemToggle)
        await request(`/admin/pricing/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) })
        await loadPricingPage()
        return
      }
      const delItem = event.target.closest('[data-item-delete]')
      if (delItem) {
        const item = pricingState.items.find((i) => i.id === delItem.dataset.itemDelete)
        if (!window.confirm(pzh() ? `删除「${item.nameZh}」?有历史订单的项目会自动改为下架。` : `Delete ${item.nameZh}?`)) return
        const res = await request(`/admin/pricing/items/${item.id}`, { method: 'DELETE' })
        await loadPricingPage()
        toast(res.deleted ? (pzh() ? '已删除' : 'Deleted') : (res.reason || (pzh() ? '已下架' : 'Hidden')))
        return
      }
      if (event.target.closest('#pricingRulesSave')) return savePricingRules()
      if (event.target.closest('#pvRun')) return runPricingPreview()
    } catch (error) { toast(error.message) }
  })
  els.pricingPage.addEventListener('change', async (event) => {
    const bookable = event.target.closest('[data-cat-bookable]')
    const sort = event.target.closest('[data-cat-sort]')
    try {
      if (bookable) {
        await request(`/admin/pricing/categories/${bookable.dataset.catBookable}`, { method: 'PATCH', body: JSON.stringify({ isBookable: bookable.checked }) })
        await loadPricingPage()
      } else if (sort) {
        await request(`/admin/pricing/categories/${sort.dataset.catSort}`, { method: 'PATCH', body: JSON.stringify({ sortOrder: Number(sort.value) || 0 }) })
        await loadPricingPage()
      }
    } catch (error) { toast(error.message) }
  })
}

/* ===== 门店设置 → 会员与储值设置(2026-08-06 P0)===== */
let membershipSettings = { config: null, tiers: [] }
const MEMBER_QUALIFY_LABELS = {
  any_recharge: { zh: '充过值就是会员', en: 'Any recharge' },
  balance_gt_0: { zh: '余额大于 0 才是会员', en: 'Balance > 0' },
  total_spend: { zh: '累计消费达到门槛', en: 'Total spend threshold' },
  manual: { zh: '老板手动打「会员」标签', en: 'Manual tag' }
}

async function loadMembershipSettings() {
  const [c, t] = await Promise.all([
    request('/admin/membership/config'),
    request('/admin/recharge-tiers').catch(() => ({ tiers: [] }))
  ])
  membershipSettings = { config: c.config, tiers: t.tiers || [], readOnly: c.readOnly !== false, readOnlyNote: c.readOnlyNote }
  renderMembershipSettings()
}

function renderMembershipSettings() {
  if (!els.membershipSettingsBody) return
  const config = membershipSettings.config
  if (!config) { els.membershipSettingsBody.innerHTML = ''; return }
  const label = MEMBER_QUALIFY_LABELS[config.memberQualify] || MEMBER_QUALIFY_LABELS.any_recharge
  if (els.membershipSettingsSummary) {
    els.membershipSettingsSummary.textContent = `${pzh() ? label.zh : label.en} · ${pzh() ? `${membershipSettings.tiers.length} 个充值档位` : `${membershipSettings.tiers.length} tiers`}`
  }
  const msReadOnly = membershipSettings.readOnly !== false // 2026-08-08:会员资格与等级收归平台,商家端只读
  els.membershipSettingsBody.innerHTML = `
    ${msReadOnly ? `<p class="subtle">🔒 ${pzh() ? (membershipSettings.readOnlyNote || '会员资格与等级由平台统一配置,如需调整请联系平台。充值档位与赠送项仍可自助设置。') : 'Member qualification and tiers are managed by the platform.'}</p>` : ''}
    <div class="kb-facts-grid">
      <label><span>${pzh() ? '会员资格' : 'Member qualification'}</span><select id="msQualify" ${msReadOnly ? 'disabled' : ''}>
        ${Object.entries(MEMBER_QUALIFY_LABELS).map(([key, l]) => `<option value="${key}" ${key === config.memberQualify ? 'selected' : ''}>${pzh() ? l.zh : l.en}</option>`).join('')}
      </select></label>
      <label><span>${pzh() ? '消费门槛(仅「累计消费」模式)' : 'Spend threshold'}</span><input id="msQualifyValue" inputmode="decimal" value="${config.qualifyValueCents ? config.qualifyValueCents / 100 : ''}" ${msReadOnly ? 'disabled' : ''}></label>
      <label><span>${pzh() ? '会员有效期(天,留空=永久)' : 'Expiry (days)'}</span><input id="msExpire" inputmode="numeric" value="${config.expireDays ?? ''}" ${msReadOnly ? 'disabled' : ''}></label>
      <label><span>${pzh() ? '启用会员等级' : 'Enable tiers'}</span><select id="msTiersEnabled" ${msReadOnly ? 'disabled' : ''}>
        <option value="0" ${config.tiersEnabled ? '' : 'selected'}>${pzh() ? '不分等级' : 'Off'}</option>
        <option value="1" ${config.tiersEnabled ? 'selected' : ''}>${pzh() ? '分等级' : 'On'}</option>
      </select></label>
    </div>
    ${config.tiersEnabled ? `
      <div class="pricing-scope">
        <textarea id="msTiers" rows="3" placeholder='[{"key":"silver","name":"银卡","minSpendCents":100000}]'>${escapeHtml(JSON.stringify(config.tiers || [], null, 0))}</textarea>
        <p class="subtle">${pzh() ? '等级表用 JSON 描述(key / name / minSpendCents),暂由平台侧协助配置。' : 'Tier table as JSON.'}</p>
      </div>` : ''}
    ${msReadOnly ? '' : `<button class="primary slim" id="msSave" type="button">${pzh() ? '保存会员设置' : 'Save membership settings'}</button>`}
    <p class="subtle">${pzh() ? '会员价在「价目表」里逐项设置;这里决定「谁算会员」。' : 'Member prices are set per item in the price list; this decides who counts as a member.'}</p>
    <div class="kb-entry-list">
      <strong class="kb-entry-list-title">${pzh() ? '充值档位(顾客充值时可选的金额与赠送)' : 'Recharge tiers'}</strong>
      ${membershipSettings.tiers.length ? membershipSettings.tiers.map((tier) => `
        <div class="service-admin-item${tier.isActive ? '' : ' inactive'}">
          <div><strong>${pMoney(tier.amountCents)}</strong>
            <span class="subtle">${describeGift(tier.gift)}${tier.isActive ? '' : (pzh() ? ' · 已停用' : ' · off')}</span></div>
          <div class="row-actions">
            <button class="ghost slim" data-tier-toggle="${tier.id}" type="button">${tier.isActive ? (pzh() ? '停用' : 'Off') : (pzh() ? '启用' : 'On')}</button>
            <button class="ghost slim" data-tier-delete="${tier.id}" type="button">${pzh() ? '删除' : 'Delete'}</button>
          </div>
        </div>`).join('') : `<p class="subtle">${pzh() ? '还没有充值档位。' : 'No recharge tiers yet.'}</p>`}
      <button class="ghost slim" id="msAddTier" type="button">${pzh() ? '+ 新增充值档位' : '+ Add tier'}</button>
    </div>`
}

function describeGift(gift = {}) {
  if (!gift || !gift.type) return pzh() ? '无赠送' : 'No gift'
  if (gift.type === 'percent') return pzh() ? `赠 ${gift.value}% 金额` : `+${gift.value}%`
  if (gift.type === 'amount') return pzh() ? `赠 ${pMoney(gift.value)}` : `+${pMoney(gift.value)}`
  if (gift.type === 'coupon') return pzh() ? `赠券 ${gift.couponId || ''}` : `Coupon ${gift.couponId || ''}`
  if (gift.type === 'service') return pzh() ? `赠项目券 ${gift.serviceId || ''}` : `Service ${gift.serviceId || ''}`
  return pzh() ? '自定义赠送' : 'Custom gift'
}

if (els.storeSettingsPage) {
  els.storeSettingsPage.addEventListener('click', async (event) => {
    try {
      if (event.target.closest('#msSave')) {
        let tiers
        if (document.querySelector('#msTiers')) {
          try { tiers = JSON.parse(document.querySelector('#msTiers').value || '[]') } catch { toast(pzh() ? '等级表 JSON 格式不对' : 'Invalid tier JSON'); return }
        }
        await request('/admin/membership/config', {
          method: 'PUT',
          body: JSON.stringify({
            config: {
              memberQualify: document.querySelector('#msQualify').value,
              qualifyValueCents: pCents(document.querySelector('#msQualifyValue').value) ?? 0,
              expireDays: document.querySelector('#msExpire').value.trim() === '' ? null : Number(document.querySelector('#msExpire').value),
              tiersEnabled: document.querySelector('#msTiersEnabled').value === '1',
              ...(tiers ? { tiers } : {})
            }
          })
        })
        await loadMembershipSettings()
        toast(pzh() ? '会员设置已保存' : 'Saved')
        return
      }
      if (event.target.closest('#msAddTier')) {
        const amount = window.prompt(pzh() ? '充值金额' : 'Recharge amount', '1000')
        if (!amount) return
        const giftPct = window.prompt(pzh() ? '赠送比例(%,留空=不送)' : 'Gift percent', '')
        const gift = giftPct && Number(giftPct) ? { type: 'percent', value: Number(giftPct) } : {}
        await request('/admin/recharge-tiers', { method: 'POST', body: JSON.stringify({ amountCents: pCents(amount) ?? 0, gift }) })
        await loadMembershipSettings()
        return
      }
      const tog = event.target.closest('[data-tier-toggle]')
      if (tog) {
        const tier = membershipSettings.tiers.find((x) => x.id === tog.dataset.tierToggle)
        await request(`/admin/recharge-tiers/${tier.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !tier.isActive }) })
        await loadMembershipSettings()
        return
      }
      const del = event.target.closest('[data-tier-delete]')
      if (del) {
        if (!window.confirm(pzh() ? '删除这个充值档位?' : 'Delete this tier?')) return
        await request(`/admin/recharge-tiers/${del.dataset.tierDelete}`, { method: 'DELETE' })
        await loadMembershipSettings()
      }
    } catch (error) { toast(error.message) }
  })
}

/* ===== 门店设置 → 定金与取消规则(2026-08-08 P1.2)=====
   参数进 tenant_settings.deposit_config;默认值与旗舰店现状等价,所以不动它就等于什么都没变。 */
let depositSettings = { config: null, text: null, keyFacts: null, onlinePaymentReady: false }

async function loadDepositSettings() {
  const res = await request('/admin/deposit-config')
  depositSettings = { config: res.config, text: res.text, keyFacts: res.keyFacts, onlinePaymentReady: res.onlinePaymentReady }
  renderDepositSettings()
}

function renderDepositSettings() {
  if (!els.depositSettingsBody) return
  const c = depositSettings.config
  if (!c) { els.depositSettingsBody.innerHTML = ''; return }
  const cp = c.cancelPolicy
  const zh = pzh()
  const modeLabel = { per_service: zh ? '按项目' : 'Per service', fixed: zh ? '固定金额' : 'Fixed', pct: zh ? '按比例' : 'Percent' }
  if (els.depositSettingsSummary) {
    els.depositSettingsSummary.textContent = c.enabled
      ? `${modeLabel[c.mode]}${c.mode === 'fixed' ? ` ${money(c.fixedAmountCents, 2)}` : (c.mode === 'pct' ? ` ${c.pct}%` : '')} · ${cp.refundable ? (zh ? '可退' : 'refundable') : (zh ? '不可退' : 'non-refundable')}`
      : (zh ? '不收定金' : 'No deposit')
  }
  const sw = (id, on, label) => `
    <div class="dep-sw"><span>${label}</span>
      <button class="sw" type="button" id="${id}" role="switch" aria-checked="${on ? 'true' : 'false'}"><i></i></button></div>`
  const seg = (id, options, current) => `
    <div class="dep-seg" id="${id}">${options.map(([v, l]) => `<button type="button" data-seg="${v}" class="${v === current ? 'on' : ''}">${l}</button>`).join('')}</div>`

  const previewText = (zh ? depositSettings.text?.zh : depositSettings.text?.en) || depositSettings.text?.zh || ''
  const keyFacts = (zh ? depositSettings.keyFacts?.zh : depositSettings.keyFacts?.en) || depositSettings.keyFacts?.zh || []
  els.depositSettingsBody.innerHTML = `
    <div class="dep-grid">
      <div>
        <div class="dep-block">
          <h4>${zh ? '收取定金' : 'Deposit'}</h4>
          <div class="dep-inline" style="margin-top:0">
            ${sw('dpEnabledSw', c.enabled, zh ? '本店收取预约定金' : 'Charge a booking deposit')}
          </div>
          <div style="margin-top:10px">${seg('dpModeSeg', [['per_service', modeLabel.per_service], ['fixed', modeLabel.fixed], ['pct', modeLabel.pct]], c.mode)}</div>
          <div class="dep-inline">
            <label>${zh ? '固定金额' : 'Fixed'}<input id="dpFixed" inputmode="decimal" value="${c.fixedAmountCents / 100}"></label>
            <label>${zh ? '百分比 %' : 'Percent %'}<input id="dpPct" inputmode="decimal" value="${c.pct}"></label>
            <label>${zh ? '兜底金额' : 'Fallback'}<input id="dpFallback" inputmode="decimal" value="${c.fallbackAmountCents / 100}"></label>
          </div>
        </div>

        <div class="dep-block">
          <h4>${zh ? '定金用法' : 'Deposit behaviour'}</h4>
          <div class="dep-switches">
            ${sw('dpDeductibleSw', c.deductible, zh ? '定金抵扣尾款' : 'Deduct from final balance')}
            ${sw('dpWaiveSw', c.memberWaive !== 'none', zh ? '会员免定金' : 'Members exempt')}
            ${sw('dpRetainSw', (cp.depositRetainTimes || 0) > 0, zh ? '合规改期定金可保留' : 'Keep deposit on compliant reschedule')}
          </div>
        </div>

        <div class="dep-block">
          <h4>${zh ? '退改与爽约' : 'Cancellation & no-show'}</h4>
          <div class="dep-inline" style="margin-top:0">
            ${sw('dpRefundableSw', cp.refundable, zh ? '定金可退' : 'Refundable')}
          </div>
          <div class="dep-quad" style="margin-top:12px">
            <label>${zh ? '提前几小时全退' : 'Free cancel (h)'}<input id="dpFreeHours" inputmode="numeric" value="${cp.freeCancelHours ?? ''}"></label>
            <label>${zh ? '迟到宽限(分钟)' : 'Late grace (min)'}<input id="dpGrace" inputmode="numeric" value="${cp.lateArrivalGraceMin ?? ''}"></label>
            <label>${zh ? '改期需提前(小时)' : 'Reschedule notice (h)'}<input id="dpNotice" inputmode="numeric" value="${cp.rescheduleNoticeHours ?? ''}"></label>
            <label>${zh ? '定金可保留次数' : 'Retain times'}<input id="dpRetain" inputmode="numeric" value="${cp.depositRetainTimes}"></label>
            <label>${zh ? '临期取消扣 %' : 'Late forfeit %'}<input id="dpLatePct" inputmode="numeric" value="${cp.lateForfeitPct}"></label>
            <label>${zh ? '爽约扣 %' : 'No-show forfeit %'}<input id="dpNoShowPct" inputmode="numeric" value="${cp.noShowForfeitPct}"></label>
          </div>
        </div>

        <div class="dep-block">
          <h4>${zh ? '规则展示文案' : 'Policy text'}</h4>
          ${seg('dpDisplaySeg', [['auto', zh ? '参数自动生成' : 'Auto'], ['custom', zh ? '自定义全文' : 'Custom']], c.displayMode)}
          <textarea class="dep-text" id="dpCustomText" style="margin-top:10px" placeholder="${zh ? '按你自己的说法写,顾客看到的就是这段原文(支持换行与 emoji)' : 'Custom policy text'}">${escapeHtml(c.customText || '')}</textarea>
        </div>

        <button class="primary slim" id="dpSave" type="button">${zh ? '保存并生效' : 'Save'}</button>
        <p class="subtle">${depositSettings.onlinePaymentReady
          ? (zh ? '线上支付通道已接通。' : 'Online payment is live.')
          : (zh ? '线上支付通道未接通,文案里不会出现「在线支付定金」;接通后自动切换。' : 'Online payment is not live yet.')}</p>
      </div>

      <div class="dep-preview">
        <div class="dep-prev-title">${zh ? '顾客端实时预览' : 'Customer preview'}</div>
        <div class="dep-phone"><div class="dep-screen">
          ${c.enabled ? `
            <div class="dep-card">
              <div class="l">${zh ? '预约定金(订位费)' : 'Booking deposit'}</div>
              <div class="v">${money(c.mode === 'fixed' ? c.fixedAmountCents : (c.mode === 'pct' ? 0 : c.fallbackAmountCents), 2)}</div>
              <div class="n">${c.deductible ? (zh ? '可抵扣本次消费' : 'Deducted from the bill') : (zh ? '不抵扣尾款' : 'Not deducted')}${c.mode === 'pct' ? (zh ? ` · 按项目价 ${c.pct}%` : ` · ${c.pct}% of price`) : ''}</div>
            </div>
            <div class="dep-keys">
              ${keyFacts.map((f) => `<div class="dep-key"><b>${escapeHtml(f.value)}</b><span>${escapeHtml(f.label)}</span></div>`).join('')}
            </div>` : `<div class="dep-card"><div class="l">${zh ? '本店无需定金' : 'No deposit'}</div><div class="n">${zh ? '确认时段即锁位,费用到店支付' : 'Slot locked on confirmation'}</div></div>`}
          <div class="dep-rules">${escapeHtml(previewText)}</div>
        </div></div>
      </div>
    </div>`
}

// 把屏4 的表单读成 deposit_config。开关读 aria-checked,段选读 .on,输入框读值。
function collectDepositForm() {
  const val = (id) => document.querySelector(id)?.value
  const on = (id) => document.querySelector(id)?.getAttribute('aria-checked') === 'true'
  const seg = (id) => document.querySelector(`${id} [data-seg].on`)?.dataset.seg
  const numOrNull = (v) => (String(v ?? '').trim() === '' ? null : Number(v))
  return {
    enabled: on('#dpEnabledSw'),
    mode: seg('#dpModeSeg') || 'per_service',
    fixedAmountCents: pCents(val('#dpFixed')) ?? 0,
    pct: Number(val('#dpPct')) || 0,
    fallbackAmountCents: pCents(val('#dpFallback')) ?? 0,
    deductible: on('#dpDeductibleSw'),
    // 「会员免定金」开关映射回三态:开=按等级免(by_tier,已选 all 的保持 all),关=都不免
    memberWaive: on('#dpWaiveSw') ? (depositSettings.config?.memberWaive === 'all' ? 'all' : 'by_tier') : 'none',
    displayMode: seg('#dpDisplaySeg') || 'auto',
    customText: val('#dpCustomText') || '',
    cancelPolicy: {
      refundable: on('#dpRefundableSw'),
      freeCancelHours: numOrNull(val('#dpFreeHours')),
      lateForfeitPct: Number(val('#dpLatePct')) || 0,
      noShowForfeitPct: Number(val('#dpNoShowPct')) || 0,
      lateArrivalGraceMin: numOrNull(val('#dpGrace')),
      rescheduleNoticeHours: numOrNull(val('#dpNotice')),
      // 「可保留」开关只管开关;次数以输入框为准,开了但填 0 就按 1 次
      depositRetainTimes: on('#dpRetainSw') ? (Number(val('#dpRetain')) || 1) : 0
    }
  }
}

/* 预览里的规则文案由后端按同一套逻辑生成 —— 前端不自己拼一版,免得预览和真实下发的不一致。
   所以这里只即时刷新「金额卡 + 三个要点」,文案那块等保存后回读。 */
function applyDepositFormToPreview() {
  if (!depositSettings.config) return
  depositSettings.config = { ...depositSettings.config, ...collectDepositForm() }
  renderDepositSettings()
}

/* ===== 门店设置 → AI 智能包 Tab(2026-08-08 P1.2 建壳)=====
   ① 自动消息话术:模板列表 / 编辑 / 变量说明 / 预览(发送引擎归后续批次)
   ② 状态区:开通状态与本月用量(读现有 /admin/subscription 的 aiAddon,没有的字段留占位) */
let aiPackState = { templates: [], scenes: [], ai: null, editing: null }

async function loadAiPackSettings() {
  const [tpl, sub] = await Promise.all([
    request('/admin/message-templates').catch(() => ({ templates: [], scenes: [] })),
    request('/admin/subscription').catch(() => ({}))
  ])
  aiPackState = { ...aiPackState, templates: tpl.templates || [], scenes: tpl.scenes || [], ai: sub.aiAddon || null }
  renderAiPackSettings()
}

function renderAiPackSettings() {
  if (!els.aiPackBody) return
  const zh = pzh()
  const ai = aiPackState.ai
  const usage = ai?.usage
  const draft = aiPackState.editing
  // 三态:套餐自带 / 已开通(含长期)/ 未开通
  const statusText = !ai ? '—'
    : (ai.includedInPlan ? (zh ? '套餐已含' : 'In plan')
      : (ai.enabled ? (zh ? '已开通' : 'On') : (zh ? '未开通' : 'Off')))
  const statusNote = ai?.unlimited ? (zh ? '· 不限期' : '· unlimited')
    : (ai?.expiresAt ? `· ${zh ? '至' : 'until'} ${String(ai.expiresAt).slice(0, 10)}` : '')
  if (els.aiPackSummary) els.aiPackSummary.textContent = `${statusText} ${statusNote}`.trim()

  // 六个场景一行一条:名称 / 预览 / 状态 / 编辑。没配的场景显示「使用系统默认」
  // 展示顺序按设计图(顾客旅程:约上 → 到店 → 售前中后 → 券临期),与后端返回顺序无关
  const SCENE_ORDER = ['booking_confirmed_invite', 'arrival_reminder', 'pre_sale', 'in_service', 'post_sale', 'coupon_expiry']
  const SCENES = (aiPackState.scenes || []).slice()
    .sort((a, b) => SCENE_ORDER.indexOf(a.scene) - SCENE_ORDER.indexOf(b.scene))
  const byScene = {}
  for (const t of aiPackState.templates) if (!byScene[t.scene]) byScene[t.scene] = t
  const VARS = ['{customerName}', '{bookingTime}', '{storeName}', '{storeAddress}', '{couponExpiry}']

  els.aiPackBody.innerHTML = `
    <p class="subtle">${zh ? '系统参数由平台配置 · 如需调整请联系平台' : 'System parameters are managed by the platform'}</p>
    <div class="ai-cards">
      <div class="ai-card">
        <div class="lab">${zh ? '开通状态' : 'Status'}<span class="ro">${zh ? '只读' : 'read-only'}</span></div>
        <div class="val ${ai?.enabled ? 'on' : ''}">${escapeHtml(statusText)} <small>${escapeHtml(statusNote)}</small></div>
      </div>
      <div class="ai-card">
        <div class="lab">${zh ? '本月用量' : 'Usage'}<span class="ro">${zh ? '只读' : 'read-only'}</span></div>
        <div class="val">${usage ? usage.used : '—'} <small>/ ${usage ? usage.quota : '—'} ${zh ? '次' : ''}</small></div>
      </div>
      <div class="ai-card">
        <div class="lab">${zh ? '接待状态' : 'Reception'}</div>
        <div class="val ${ai?.enabled ? 'on' : ''}">${ai?.enabled ? (zh ? '正常接待' : 'Active') : (zh ? '未开通' : 'Off')}</div>
      </div>
    </div>

    <div class="dep-block">
      <h4>${zh ? '自动消息话术' : 'Message templates'}</h4>
      <p class="subtle" style="margin:-4px 0 6px">${zh
        ? '按场景配置自动发送的文案模板。发送时机与通道由系统按提醒规则执行(到店提醒 / 券临期等),本批只做模板管理。'
        : 'Per-scene templates; the sending engine arrives in a later batch.'}</p>
      ${SCENES.map((sc) => {
        const t = byScene[sc.scene]
        const preview = t && t.content
          ? escapeHtml(t.content.replace(/\s+/g, ' ').slice(0, 46)) + (t.content.length > 46 ? '…' : '')
          : `<em>${zh ? '(未配置,使用系统默认)' : '(not configured)'}</em>`
        return `<div class="ai-scene">
          <div class="nm">${escapeHtml(sc.label)}</div>
          <div class="pv">${preview}</div>
          <span class="st ${t && t.isActive ? 'on' : 'off'}">${t && t.isActive ? (zh ? '启用中' : 'On') : (zh ? '未启用' : 'Off')}</span>
          <button class="ghost slim" data-scene-edit="${escapeHtml(sc.scene)}" type="button">${zh ? '编辑' : 'Edit'}</button>
        </div>`
      }).join('')}
      <div class="ai-vars">${zh ? '可用变量:' : 'Variables: '}${VARS.map((v) => `<code>${escapeHtml(v)}</code>`).join('')}—— ${zh ? '发送时自动替换为真实内容' : 'replaced at send time'}</div>
    </div>

    ${draft ? `
    <div class="pricing-editor">
      <div class="kb-facts-grid">
        <label><span>${zh ? '场景' : 'Scene'}</span><select id="tplScene">
          ${SCENES.map((sc) => `<option value="${sc.scene}" ${sc.scene === draft.scene ? 'selected' : ''}>${escapeHtml(sc.label)}</option>`).join('')}
        </select></label>
        <label><span>${zh ? '标题' : 'Title'}</span><input id="tplTitle" value="${escapeHtml(draft.title || '')}"></label>
      </div>
      <div class="pricing-scope">
        <textarea id="tplContent" rows="4" placeholder="${zh ? '话术正文,可用上面列出的变量' : 'Template content'}">${escapeHtml(draft.content || '')}</textarea>
      </div>
      <div class="action-row wrap">
        <button class="primary slim" id="tplSave" type="button">${zh ? '保存' : 'Save'}</button>
        <button class="ghost slim" id="tplCancel" type="button">${zh ? '取消' : 'Cancel'}</button>
        ${draft.id ? `<button class="ghost slim" id="tplToggle" type="button">${draft.isActive === false ? (zh ? '启用' : 'Enable') : (zh ? '停用' : 'Disable')}</button>` : ''}
      </div>
    </div>` : ''}

    <div class="dep-block">
      <h4>${zh ? '店铺专属知识库' : 'Store knowledge base'}</h4>
      <p class="subtle" style="margin:0">${zh ? 'FAQ · 店内规则 · 话术偏好(价目表自动同步,无需重复维护)' : 'FAQ, store rules, tone preferences'}</p>
      <button class="ghost slim" id="aiKbEntry" type="button" style="margin-top:8px">${zh ? '进入管理 ›' : 'Manage ›'}</button>
    </div>`
}

if (els.storeSettingsPage) {
  els.storeSettingsPage.addEventListener('click', async (event) => {
    try {
      // 屏4:开关与段选都是纯展示态,点一下改 DOM 再回灌预览,保存时统一从 DOM 读
      const swBtn = event.target.closest('.dep-sw .sw')
      if (swBtn) {
        swBtn.setAttribute('aria-checked', swBtn.getAttribute('aria-checked') === 'true' ? 'false' : 'true')
        applyDepositFormToPreview()
        return
      }
      const segBtn = event.target.closest('.dep-seg [data-seg]')
      if (segBtn) {
        for (const b of segBtn.parentElement.querySelectorAll('[data-seg]')) b.classList.toggle('on', b === segBtn)
        applyDepositFormToPreview()
        return
      }
      if (event.target.closest('#dpSave')) {
        await request('/admin/deposit-config', {
          method: 'PUT',
          body: JSON.stringify({ config: collectDepositForm() })
        })
        await loadDepositSettings()
        toast(pzh() ? '定金规则已保存,顾客端与 AI 立即生效' : 'Saved')
        return
      }
      if (event.target.closest('#aiKbEntry')) {
        const kb = document.querySelector('#kbTitle')?.closest('details')
        if (kb) { kb.open = true; kb.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
        return
      }
      // 屏5:六个场景行点「编辑」——已有模板就编辑,没有就以该场景新建
      const sceneEdit = event.target.closest('[data-scene-edit]')
      if (sceneEdit) {
        const scene = sceneEdit.dataset.sceneEdit
        const exist = aiPackState.templates.find((t) => t.scene === scene)
        aiPackState.editing = exist ? { ...exist } : { scene, title: '', content: '' }
        renderAiPackSettings()
        return
      }
      if (event.target.closest('#tplCancel')) { aiPackState.editing = null; renderAiPackSettings(); return }
      if (event.target.closest('#tplSave')) {
        const body = {
          scene: document.querySelector('#tplScene')?.value,
          title: document.querySelector('#tplTitle')?.value.trim(),
          content: document.querySelector('#tplContent')?.value || ''
        }
        if (!body.title) { toast(pzh() ? '标题必填' : 'Title required'); return }
        const id = aiPackState.editing?.id
        if (id) await request(`/admin/message-templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
        else await request('/admin/message-templates', { method: 'POST', body: JSON.stringify(body) })
        aiPackState.editing = null
        await loadAiPackSettings()
        toast(pzh() ? '已保存' : 'Saved')
        return
      }
      if (event.target.closest('#tplToggle')) {
        const t = aiPackState.templates.find((x) => x.id === aiPackState.editing?.id)
        if (!t) return
        await request(`/admin/message-templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !t.isActive }) })
        aiPackState.editing = null
        await loadAiPackSettings()
      }
    } catch (error) { toast(error.message) }
  })
}
