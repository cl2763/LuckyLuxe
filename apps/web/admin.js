// 构建号:每次交付递增。侧栏可见,排查"改了没生效"时先对版本。
const ADMIN_BUILD = '20260706-walk3'
console.log(`[admin] build ${ADMIN_BUILD}`)

// "今天"必须按门店时区算(服务器同样钉在此时区),否则老板人在别的时区时全站日期错位一天。
// TODO(多租户): 时区改为从租户配置读取。
const STORE_TZ = 'America/Toronto'
function storeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
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
  financeLedger: { month: '', data: null, rules: [], ledger: null, filterType: 'all', filterCategory: 'all', lockConfigured: undefined, tab: 'quick' },
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
  financePayrollItem: document.querySelector('#financePayrollItem'),
  financePayrollBody: document.querySelector('#financePayrollBody'),
  financePayrollSummary: document.querySelector('#financePayrollSummary'),
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
    adminTitle: 'Lucky Luxe 后台',
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
    navSchedule: '排班管理',
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
    adminTitle: 'Lucky Luxe Admin',
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
    navSchedule: 'Schedule',
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
  if (!response.ok) throw new Error(data.error?.message || `请求失败（HTTP ${response.status}）`)
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
  const finPassLabels = [
    ['#financePasswordTitle', owner.lang === 'zh' ? '修改财务密码' : 'Change finance password'],
    ['#finOldPassLabel', owner.lang === 'zh' ? '旧密码（忘记时填 Owner Token）' : 'Current password (or Owner Token)'],
    ['#finNewPassLabel', owner.lang === 'zh' ? '新密码（至少 4 位）' : 'New password (min 4 chars)'],
    ['#finNewPass2Label', owner.lang === 'zh' ? '再输入一次新密码' : 'Confirm new password'],
    ['#finChangePassButton', owner.lang === 'zh' ? '确认修改' : 'Change password']
  ]
  for (const [selector, text] of finPassLabels) {
    const node = document.querySelector(selector)
    if (node) node.textContent = text
  }
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
    if (!owner.financeKey) renderFinanceLock()
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
  const revenueDisplay = owner.financeKey && ledgerIncome !== undefined ? money(ledgerIncome) : '🔒'
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
  const financeLocked = !owner.financeKey
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
  if (!isOwnerRole() && ['dashboard', 'dashboardDetail', 'services', 'customers', 'storeSettings', 'finance'].includes(owner.adminPage)) owner.adminPage = 'bookings'
  const pages = {
    dashboard: els.adminDashboard,
    dashboardDetail: els.dashboardDetailPage,
    bookings: els.bookingsPage,
    schedule: els.schedulePage,
    services: els.servicesPage,
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
  const planOptions = [
    ['solo', owner.lang === 'zh' ? '个人美甲师版' : 'Solo Artist'],
    ['studio', owner.lang === 'zh' ? '小型工作室版' : 'Studio'],
    ['chain', owner.lang === 'zh' ? '连锁门店版' : 'Chain'],
    ['custom', owner.lang === 'zh' ? '定制企业版' : 'Custom Enterprise']
  ]
  const pendingRequest = plan.latestPlanRequest && plan.latestPlanRequest.status === 'PENDING' ? plan.latestPlanRequest : null
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
    <div class="plan-renew-row">
      <select id="planChangeTarget">
        ${planOptions.map(([id, label]) => `<option value="${id}" ${id === plan.plan ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
      </select>
      <button class="primary slim" id="planChangeSubmit" type="button">${owner.lang === 'zh' ? '续费 / 升级' : 'Renew / Upgrade'}</button>
    </div>
    ${pendingRequest
      ? `<p class="subtle">${owner.lang === 'zh'
          ? `已提交${pendingRequest.requestType === 'renew' ? '续费' : '升级'}申请（${escapeHtml(pendingRequest.targetPlan)}），等待处理。商户版上线后此处接在线支付。`
          : `${pendingRequest.requestType === 'renew' ? 'Renewal' : 'Upgrade'} request submitted (${escapeHtml(pendingRequest.targetPlan)}), pending. Online billing arrives with the merchant release.`}</p>`
      : `<p class="subtle">${owner.lang === 'zh' ? '提交后申请会进入待处理队列；商户版上线后此入口直接接在线支付。' : 'Requests enter a pending queue; this entry will connect to online billing in the merchant release.'}</p>`}
  `
}

async function submitPlanChangeRequest() {
  const targetPlan = document.querySelector('#planChangeTarget')?.value || ''
  const data = await request('/admin/tenant/plan/change-request', {
    method: 'POST',
    body: JSON.stringify({ targetPlan })
  })
  owner.tenantPlan = data.entitlements
  renderTenantPlan()
  toast(owner.lang === 'zh' ? '申请已提交，等待处理。' : 'Request submitted.')
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
      ${!setup ? `<p class="subtle fin-lock-hint">${owner.lang === 'zh' ? '忘记密码?输入启动服务器窗口里显示的 Owner Token 也可解锁,进入后在「财务设置 → 修改财务密码」重设。' : 'Forgot it? The Owner Token from the server window also unlocks; reset it under Finance Settings.'}</p>` : ''}
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

async function changeFinancePassword() {
  const zh = owner.lang === 'zh'
  const data = await request('/admin/finance/change-password', {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: document.querySelector('#finOldPass')?.value || '',
      newPassword: document.querySelector('#finNewPass')?.value || '',
      confirmPassword: document.querySelector('#finNewPass2')?.value || ''
    })
  })
  owner.financeKey = data.financeKey || owner.financeKey
  if (owner.financeKey) sessionStorage.setItem('lucky-finance-key', owner.financeKey)
  owner.financeLedger.lockConfigured = true
  for (const id of ['#finOldPass', '#finNewPass', '#finNewPass2']) {
    const input = document.querySelector(id)
    if (input) input.value = ''
  }
  toast(zh ? '财务密码已修改,下次进入用新密码' : 'Finance password changed')
}

async function loadFinancePage() {
  const month = owner.financeLedger.month || new Date().toISOString().slice(0, 7)
  owner.financeLedger.month = month
  const lockStatus = await request('/admin/finance/lock-status').catch(() => ({ configured: owner.financeLedger.lockConfigured }))
  owner.financeLedger.lockConfigured = Boolean(lockStatus.configured)
  if (!owner.financeKey) {
    renderFinanceLock()
    return
  }
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

function financeRing(label, currentCents, targetCents, subText = '') {
  const rawPct = targetCents > 0 ? Math.round((currentCents / targetCents) * 100) : 0
  const shownPct = Math.max(0, Math.min(rawPct, 100))
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - shownPct / 100)
  return `
    <div class="finance-ring ${rawPct >= 100 ? 'done' : ''}">
      <svg viewBox="0 0 84 84" width="88" height="88" aria-hidden="true">
        <circle cx="42" cy="42" r="${radius}" class="ring-track"></circle>
        <circle cx="42" cy="42" r="${radius}" class="ring-fill" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 42 42)"></circle>
        <text x="42" y="47" text-anchor="middle" class="ring-pct">${rawPct}%</text>
      </svg>
      <strong>${label}</strong>
      <span>${cadText(currentCents)}</span>
      <span class="ring-target">/ ${cadText(targetCents)}</span>
      ${subText ? `<small>${subText}</small>` : ''}
    </div>`
}

function renderFinanceProgress() {
  if (!els.financeProgress) return
  const progress = owner.financeLedger.progress
  if (!progress || !progress.monthRevenueTargetCents) {
    els.financeProgress.innerHTML = `<div class="finance-progress-card"><p class="subtle">${owner.lang === 'zh' ? '还没有设定目标。在下方"目标设置"里填一个月净利润目标，这里会出现每日/每月/年度进度。' : 'Set a target below to see daily/monthly/yearly progress here.'}</p></div>`
    return
  }
  const alertHtml = (progress.alerts || []).map((alert) => {
    const texts = {
      break_even_crossed: owner.lang === 'zh' ? '本月已越过收支平衡线 🎉' : 'Break-even crossed this month 🎉',
      month_target_hit: owner.lang === 'zh' ? '月目标已达成！' : 'Monthly target hit!',
      month_target_80: owner.lang === 'zh' ? '月目标已完成 80%+' : '80%+ of monthly target',
      pace_behind: owner.lang === 'zh' ? `按当前节奏,月底预计差 ${cadText(alert.shortfallCents || 0)}` : `On current pace, projected shortfall ${cadText(alert.shortfallCents || 0)}`,
      payroll_pending: owner.lang === 'zh' ? `有 ${alert.count} 位员工的工资待月结确认` : `${alert.count} payroll drafts pending`
    }
    return `<span class="finance-alert ${alert.level}">${texts[alert.code] || alert.code}</span>`
  }).join('')
  const pendingNote = progress.pendingPayrollCents > 0
    ? `<span class="subtle">${owner.lang === 'zh' ? `预估净利(计提待结工资后): ${cadText(progress.estimatedNetCents)}` : `Estimated net after pending payroll: ${cadText(progress.estimatedNetCents)}`}</span>`
    : ''
  els.financeProgress.innerHTML = `
    <div class="finance-progress-card">
      ${alertHtml ? `<div class="finance-alerts">${alertHtml}</div>` : ''}
      <div class="finance-ring-grid">
        ${financeRing(owner.lang === 'zh' ? '今日' : 'Today', progress.todayRevenueCents, progress.dailyTargetCents)}
        ${financeRing(owner.lang === 'zh' ? '本月' : 'Month', progress.revenueCents, progress.monthRevenueTargetCents, owner.lang === 'zh' ? `按节奏预计 ${cadText(progress.paceProjectionCents)}` : `pace ${cadText(progress.paceProjectionCents)}`)}
        ${financeRing(owner.lang === 'zh' ? '收支平衡' : 'Break-even', progress.revenueCents, progress.breakEvenRevenueCents)}
        ${financeRing(owner.lang === 'zh' ? '年度' : 'Year', progress.yearRevenueCents, progress.yearTargetCents)}
      </div>
      ${pendingNote}
    </div>`
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
      <label><span>${owner.lang === 'zh' ? '变动成本率 %' : 'Variable cost %'}</span><input id="finTargetRate" type="number" min="0" max="95" value="${Math.round((targets.variableCostRate || 0.25) * 100)}"></label>
      <label><span>${owner.lang === 'zh' ? '年营收目标 (可选)' : 'Yearly target (optional)'}</span><input id="finTargetYear" type="number" min="0" step="1000" value="${targets.yearTargetCents ? targets.yearTargetCents / 100 : ''}"></label>
    </div>
    <button class="primary slim" data-fin-targets-save type="button">${owner.lang === 'zh' ? '保存目标' : 'Save targets'}</button>
    <p class="subtle">${owner.lang === 'zh' ? '变动成本率=耗材+提成约占收入的比例,不确定就先用 25%,跑出流水后可随时调。系统据此反推:需要的月营收=(固定支出+目标净利)÷(1−变动成本率)。' : 'Required revenue = (fixed costs + target net) ÷ (1 − variable cost rate).'}</p>
  `
}

function renderFinancePayroll() {
  if (!els.financePayrollBody || !els.financePayrollItem) return
  const hasStaffPlan = Boolean(owner.tenantPlan?.features?.staff_schedule?.enabled)
  els.financePayrollItem.classList.toggle('hidden', !hasStaffPlan)
  if (!hasStaffPlan) return
  const comp = owner.financeLedger.compensation || []
  const payroll = owner.financeLedger.payroll
  const pending = (payroll?.drafts || []).filter((item) => !item.settled)
  els.financePayrollSummary.textContent = pending.length
    ? (owner.lang === 'zh' ? `${pending.length} 人待结算 · ${cadText(pending.reduce((sum, item) => sum + item.totalCents, 0))}` : `${pending.length} pending`)
    : (owner.lang === 'zh' ? '本月已结清' : 'Settled')
  els.financePayrollBody.innerHTML = `
    <strong class="kb-entry-list-title">${owner.lang === 'zh' ? '薪酬配置(底薪 + 业绩提成比例)' : 'Compensation config'}</strong>
    ${comp.map((item) => `
      <div class="finance-comp-row" data-comp-tech="${escapeHtml(item.technicianId)}">
        <span class="finance-comp-name">${escapeHtml(item.technicianName)}</span>
        <label><span>${owner.lang === 'zh' ? '底薪' : 'Base'}</span><input type="number" min="0" data-comp-base value="${item.baseSalaryCents / 100 || ''}"></label>
        <label><span>${owner.lang === 'zh' ? '提成 %' : 'Rate %'}</span><input type="number" min="0" max="90" data-comp-rate value="${Math.round(item.commissionRate * 100) || ''}"></label>
        <label class="check-row slim-check"><input type="checkbox" data-comp-active ${item.active ? 'checked' : ''}><span>${owner.lang === 'zh' ? '在职' : 'Active'}</span></label>
        <button class="ghost slim" data-fin-comp-save="${escapeHtml(item.technicianId)}" type="button">${owner.lang === 'zh' ? '保存' : 'Save'}</button>
      </div>`).join('')}
    <strong class="kb-entry-list-title">${owner.lang === 'zh' ? `${payroll?.month || ''} 月结草稿(月底确认后才正式入账)` : 'Monthly settlement drafts'}</strong>
    ${(payroll?.drafts || []).length ? (payroll.drafts || []).map((draft) => `
      <div class="finance-rule-row ${draft.settled ? 'disabled' : ''}">
        <span><strong>${escapeHtml(draft.technicianName)}</strong> · ${owner.lang === 'zh' ? '业绩' : 'Revenue'} ${cadText(draft.monthRevenueCents)} · ${owner.lang === 'zh' ? '底薪' : 'base'} ${cadText(draft.baseSalaryCents)} + ${owner.lang === 'zh' ? '提成' : 'comm.'} ${cadText(draft.commissionCents)} = <strong>${cadText(draft.totalCents)}</strong></span>
        <span class="finance-txn-flag">${draft.settled ? (owner.lang === 'zh' ? '已入账' : 'settled') : (owner.lang === 'zh' ? '待确认' : 'pending')}</span>
      </div>`).join('') : `<p class="subtle">${owner.lang === 'zh' ? '先在上方配置员工薪酬,这里会自动生成月结草稿。' : 'Configure compensation above to generate drafts.'}</p>`}
    ${pending.length ? `<button class="primary slim" data-fin-payroll-confirm type="button">${owner.lang === 'zh' ? `确认结算本月工资(${pending.length} 人)` : 'Confirm payroll'}</button>` : ''}
    <p class="subtle">${owner.lang === 'zh' ? '未确认的工资会以"预估净利"口径体现在上方进度区,确认后正式计入账本(不可修改,只能冲销)。' : 'Pending payroll shows as estimated net; confirming posts append-only ledger entries.'}</p>
  `
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
  const summary = fin.data?.summary || { incomeCents: 0, expenseCents: 0, netCents: 0 }
  const marginText = summary.incomeCents > 0 ? `${Math.round((summary.netCents / summary.incomeCents) * 1000) / 10}%` : '-'
  els.financeMetrics.innerHTML = [
    [owner.lang === 'zh' ? '本月收入' : 'Income', cadText(summary.incomeCents), ''],
    [owner.lang === 'zh' ? '本月支出' : 'Expense', cadText(summary.expenseCents), ''],
    [owner.lang === 'zh' ? '净利润' : 'Net profit', cadText(summary.netCents), summary.netCents >= 0 ? 'good' : 'bad'],
    [owner.lang === 'zh' ? '净利率' : 'Net margin', marginText, '']
  ].map(([label, value, tone]) => `
    <div class="finance-metric ${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>`).join('')
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
        <span>${t('monthPeople')} <strong>${tech.people}</strong></span>
        <span>${t('monthServices')} <strong>${tech.completed}</strong></span>
        <span>${t('monthAmount')} <strong>${money(tech.amount)}</strong></span>
        <span>${zh ? '好评率' : 'Rating'} <strong class="rating-placeholder" title="${zh ? '顾客点评功能上线后自动统计,不做估算值' : 'Shown once customer reviews launch; we do not fabricate estimates'}">${zh ? '待点评功能' : 'Pending reviews'}</strong></span>
        ${!isOwnerRole() && owner.myCompEstimate ? `
        <span>${zh ? '预计本月薪酬' : 'Est. pay'} <strong title="${zh ? `底薪 ${money(owner.myCompEstimate.baseSalaryCents)} + 提成 ${Math.round(owner.myCompEstimate.commissionRate * 100)}% × 业绩` : ''}">${money(owner.myCompEstimate.totalCents)}</strong></span>` : ''}
      </div>
      ${!isOwnerRole() && owner.myCompEstimate ? `<p class="subtle comp-estimate-note">${zh ? `底薪 ${money(owner.myCompEstimate.baseSalaryCents)} + 提成 ${money(owner.myCompEstimate.commissionCents)}(${Math.round(owner.myCompEstimate.commissionRate * 100)}%),以老板月结确认为准。` : 'Base + commission; final amount confirmed at monthly settlement.'}</p>` : ''}
      ${isOwnerRole() ? `
      <div class="tech-manage-row">
        <button class="ghost slim" data-tech-edit="${escapeHtml(tech.id)}" type="button">${zh ? '编辑' : 'Edit'}</button>
        <button class="ghost slim ${inactive ? '' : 'danger-ghost'}" data-tech-toggle="${escapeHtml(tech.id)}" type="button">${inactive ? (zh ? '恢复在职' : 'Reactivate') : (zh ? '停用' : 'Deactivate')}</button>
        ${renderTechAccountControls(tech.id, zh)}
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
    <span class="tech-account-name" title="${zh ? '登录用户名' : 'Username'}">👤 ${escapeHtml(account.username)}${disabled ? (zh ? '(已停用)' : ' (disabled)') : ''}</span>
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
  els.customerList.innerHTML = customers.map((customer) => `
    <article class="customer-profile-card card">
      <div class="customer-avatar">${customerName(customer).slice(0, 1).toUpperCase()}</div>
      <div>
        <h3>${escapeHtml(customerName(customer))} ${memberTierBadge(customer)}</h3>
        <p class="subtle">${escapeHtml(customer.memberCode || '')}${customer.birthday ? ` · 🎂 ${escapeHtml(customer.birthday)}` : ''}</p>
        <p class="customer-contact">${escapeHtml([customer.phone, customer.email].filter(Boolean).join(' · ') || '-')}</p>
        ${(customer.tags || []).length ? `<div class="customer-tags">${customer.tags.slice(0, 3).map((tag) => `<span class="customer-tag">${escapeHtml(tag)}</span>`).join('')}${customer.tags.length > 3 ? `<span class="customer-tag">+${customer.tags.length - 3}</span>` : ''}</div>` : ''}
        <div class="inline-actions compact-actions customer-card-actions">
          <button class="ghost slim" data-customer-detail="${customer.id}" type="button">${t('viewCustomerFile')}</button>
          <button class="ghost slim" data-ai-customer="${customer.id}" type="button">${owner.aiLoading === `customer:${customer.id}` ? t('aiProcessing') : t('aiCustomerInsight')}</button>
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
    if (owner.adminPage === 'bookings') owner.adminView = 'today'
    if (owner.adminPage === 'finance') loadFinancePage().catch((error) => toast(error.message))
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
  if (event.target.closest('[data-fin-submit]')) {
    submitFinanceEntry().catch((error) => toast(error.message))
    return
  }
  if (event.target.closest('[data-fin-lock-retry]')) {
    owner.financeLedger.lockConfigured = undefined
    renderFinanceLock()
    return
  }
  if (event.target.closest('[data-fin-change-password]')) {
    changeFinancePassword().catch((error) => toast(error.message))
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
    request(`/admin/stored-value/${isRecharge ? 'recharge' : 'consume'}`, {
      method: 'POST',
      body: JSON.stringify({ userId, amount, payChannel: document.querySelector('#svChannel')?.value || 'unknown' })
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
  if (event.target.closest('#planChangeSubmit')) {
    submitPlanChangeRequest().catch((error) => toast(error.message))
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

initAdmin().catch((error) => toast(error.message))
