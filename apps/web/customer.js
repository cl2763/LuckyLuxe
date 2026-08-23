/* D45(复核二轮 2026-08-15):网页顾客端按店寻址 —— 「每店专属链接」模型(商家把自己店的链接发给顾客)。
   ?store=<租户ID> 进入该店并记住(localStorage),刷新/跳页保持;无参=上次的店;首次=旗舰店。
   所有请求统一带 x-tenant-id;storeId 不再写死,由本店 /stores 下发覆盖。 */
const TENANT_ID = (() => {
  const q = new URLSearchParams(location.search)
  const t = (q.get('store') || q.get('tenant') || '').trim()
  if (t) { try { localStorage.setItem('lucky-web-tenant', t) } catch (e) {} return t }
  try { return localStorage.getItem('lucky-web-tenant') || 'lucky-luxe' } catch (e) { return 'lucky-luxe' }
})()
let storeId = 'store-ontario-01' // 兜底;boot 时 loadStores() 用本店真实门店覆盖

/* 门店币种(店主 2026-08-10 红线修复)。原来币符写死在代码里 —— 境内 ¥ 店的顾客
   在网页端看到的每个价格币种都是错的,和小程序顾客端同一个病。
   现在跟 /stores 下发的 currencyDisplay 走,与小程序两端、网页老板端同一套映射表。
   金额红线不变:这里一分钱都不算,只拼字符串。 */
const CUR = { prefix: '', symbol: '', code: '', trimZeroDecimals: false }
function curPrefix() {
  return `${String(CUR.prefix || '').replace('<CODE>', CUR.code || '')}${CUR.symbol || ''}`
}
function money(cents, decimals) {
  const n = Number(cents || 0) / 100
  const d = decimals === undefined ? (CUR.trimZeroDecimals ? 0 : 0) : decimals
  return `${curPrefix()}${n.toFixed(d)}`
}
// 已经是「元」的数字(会员门槛、定金这类文案里是元不是分)
function moneyY(amount) { return `${curPrefix()}${Number(amount || 0)}` }

const copy = {
  zh: {
    registerTitle: '创建账号',
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
    aiMockBadge: '演示分析',
    aiMockNotice: '当前是 mock 价格建议，仅用于流程测试；复杂款式和最终报价仍需人工确认。',
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
    memberBenefits: '会员权益',
    viewMemberBenefits: '查看会员权益',
    memberBenefitsIntro: '查看不同会员等级的升级门槛、定金规则与可享权益。',
    lifetimeSpend: '累计消费',
    depositRule: '定金规则',
    depositWaived: '预约免定金',
    depositRequired: `预约需支付 ${moneyY(50)} 定金`,
    upgradeGift: '升级礼包',
    currentTier: '当前等级',
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
    sessionExpired: '登录已过期，请重新登录后继续支付。',
    draftLoaded: '已载入预约草稿，请确认后支付定金。',
    draftUnavailable: '预约草稿暂不可用',
    depositPolicyTitle: '定金退改规则',
    depositPolicyText: '预约定金用于锁定技师时间。到店前 24 小时以上取消或改期，定金可退或可转；24 小时内取消或临时改期，定金会扣除一半；临时爽约定金不退。',
    aiAssistant: 'AI 客服',
    aiAssistantIntro: '我可以回答预约、价格、定金、取消改期和订单相关问题。',
    aiAssistantPlaceholder: '输入你的问题...',
    aiSend: '发送',
    aiHandoff: '建议转人工',
    aiHandoffHint: '这个问题需要人工确认，我可以先帮你整理要问的信息。',
    aiQuickPrice: '美甲复杂款怎么报价？',
    aiQuickBooking: '怎么预约？',
    aiQuickPolicy: '取消改期规则？'
  },
  en: {
    registerTitle: 'Create your account',
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
    aiMockBadge: 'Demo Analysis',
    aiMockNotice: 'This is a mock pricing suggestion for flow testing only. Complex designs and final quotes still require staff confirmation.',
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
    memberBenefits: 'Member Benefits',
    viewMemberBenefits: 'View Benefits',
    memberBenefitsIntro: 'See tier thresholds, booking deposit rules, and member perks.',
    lifetimeSpend: 'Lifetime spend',
    depositRule: 'Deposit rule',
    depositWaived: 'Deposit waived',
    depositRequired: `${moneyY(50)} booking deposit required`,
    upgradeGift: 'Upgrade gift',
    currentTier: 'Current tier',
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
    sessionExpired: 'Your session expired. Please sign in again to continue payment.',
    draftLoaded: 'Booking draft loaded. Please confirm and pay the deposit.',
    draftUnavailable: 'Booking draft is unavailable.',
    depositPolicyTitle: 'Deposit Cancellation Policy',
    depositPolicyText: 'The deposit holds your technician time. Cancellations or rescheduling more than 24 hours before the appointment can be refunded or transferred. Within 24 hours, half of the deposit is kept. No-shows are non-refundable.',
    aiAssistant: 'AI Concierge',
    aiAssistantIntro: 'I can help with booking, pricing, deposits, cancellation policy, and order questions.',
    aiAssistantPlaceholder: 'Type your question...',
    aiSend: 'Send',
    aiHandoff: 'Staff recommended',
    aiHandoffHint: 'This needs staff confirmation. I can help organize the question first.',
    aiQuickPrice: 'How are custom nails quoted?',
    aiQuickBooking: 'How do I book?',
    aiQuickPolicy: 'Cancellation policy?'
  }
}

const state = {
  lang: localStorage.getItem('lucky-web-lang') || 'zh',
  user: readJson('lucky-web-user'),
  auth: readJson('lucky-web-auth'),
  // 批③次段:卡包/商城视图数据(后端唯一出口下发,前端不缓存计算)
  cardPack: null,
  assets: null,
  mall: null,
  mallNoteFor: '',
  mallFilter: 'all',
  view: 'home',
  type: 'nail',
  category: 'all',
  services: [],
  stores: [],
  service: null,
  technicians: [],
  portfolios: [],
  heroSlide: 0,
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
  cart: readJson(`lucky-web-cart:${TENANT_ID}`) || [], // 购物车按店分仓(切店不带上家店的商品,D39 同族)
  orders: readJson('lucky-web-orders') || [],
  orderFilter: 'all',
  selectedOrderId: '',
  shareOrderId: '',
  sharePlatform: 'xiaohongshu',
  shareCopyByOrder: {},
  shareCopyHistory: readJson('lucky-social-copy-history') || {},
  memberCodeOpen: false,
  aiAssistantOpen: false,
  aiAssistantLoading: false,
  aiAssistantDraft: '',
  aiAssistantMessages: readJson('lucky-ai-assistant-messages') || [],
  pendingAuth: readJson('lucky-web-pending-auth')
}

let heroTimer = null

const els = {
  authView: document.querySelector('#authView'),
  appView: document.querySelector('#appView'),
  screen: document.querySelector('#screen'),
  tabs: [...document.querySelectorAll('.web-tab')],
  cartBadge: document.querySelector('#cartBadge'),
  langZh: document.querySelector('#langZh'),
  langEn: document.querySelector('#langEn'),
  aiAssistantWidget: document.querySelector('#aiAssistantWidget'),
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

/* (复核-2 生产白屏根因修复)CUR/money 块已提到文件头:copy 文案字面量在顶层立即执行 moneyY(50),
   原声明在 copy 之后 → TDZ ReferenceError,整个顾客页 SPA 崩死(3c948e0 引入,生产白屏 5 天)。 */

function isNailService(service) {
  return String(service?.type || '').toLowerCase() === 'nail'
}

function priceLabel(service) {
  /* D49:详情价格与列表同源同口径 —— 后端 priceDetailLabel(多档=「¥xxx 起(档说明)」,单档才是固定价/基础价);
     旧 label 只作老后端兜底。 */
  if (state.lang === 'en') return service.priceDetailLabelEn || service.priceLabelEn || `${isNailService(service) ? t('basePrice') : t('fixedPrice')} ${money(service.priceCents)}`
  return service.priceDetailLabelZh || service.priceLabelZh || `${isNailService(service) ? t('basePrice') : t('fixedPrice')} ${money(service.priceCents)}`
}

// S1:列表卡片「¥xxx 起」=最低可用价档(与小程序顾客端同句同源);详情页仍用 priceLabel(基础价/固定价语义)
function fromPriceLabel(service) {
  if (state.lang === 'en') return service.priceFromLabelEn || priceLabel(service)
  return service.priceFromLabelZh || priceLabel(service)
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

function userWaivesDeposit(user = state.user) {
  // F3 单源:免定金只认后端 depositWaived(租户梯子推导);本地键名/标签名单兜底已删
  return Boolean(user?.depositWaived)
}

/* F3 收敛(店主 2026-08-12 拍板②):等级梯子单源=后端 user.memberTiers(租户配置推导),
   网页顾客端本地梯子副本已删。不分级店(membershipTiersEnabled=false)与小程序同口径三减法:
   成长条不渲染 / 称谓只写「会员」/ 权益卡留空。 */
function tiersDisabled(user = state.user) {
  return user?.membershipTiersEnabled === false || !(Array.isArray(user?.memberTiers) && user.memberTiers.length)
}

function memberTierInfo(user = state.user) {
  const spend = Math.round(Number(user?.growthValue ?? ((user?.totalSpentCents || 0) / 100)) || 0)
  if (tiersDisabled(user)) {
    // D41+店主追加:不分级店 非会员=「成为会员」CTA(点进权益页看入会权益);会员=「会员」
    const svLabel = user?.memberLevel === '会员' ? (state.lang === 'zh' ? '会员' : 'Member') : (state.lang === 'zh' ? '成为会员' : 'Become a member')
    const plain = { key: user?.memberTier || 'member', label: svLabel, minSpend: 0, nextSpend: null, depositWaived: Boolean(user?.depositWaived) }
    return { tier: plain, nextTier: null, spend, nextValue: spend, amountToNext: 0, progress: 100, note: '' }
  }
  const tiersLadder = user.memberTiers
  const tierKey = String(user?.memberTier || '').toLowerCase()
  const index = Math.max(0, tiersLadder.findIndex((item) => item.key === tierKey))
  const tier = tiersLadder[index] || tiersLadder[0]
  const nextTier = tiersLadder[index + 1] || null
  const nextValue = user?.nextLevelValue || tier.nextSpend || spend
  const amountToNext = user?.amountToNextLevel === undefined
    ? (nextTier ? Math.max(0, nextTier.minSpend - spend) : 0)
    : user.amountToNextLevel
  return {
    tier,
    nextTier,
    spend,
    nextValue,
    amountToNext,
    progress: nextValue ? Math.min(100, Math.round((spend / nextValue) * 100)) : 100,
    note: nextTier
      ? (state.lang === 'zh' ? `距离 ${nextTier.label} 还差 ${moneyY(amountToNext)}` : `${moneyY(amountToNext)} to ${nextTier.label}`)
      : (state.lang === 'zh' ? '已达到最高等级，预约定金减免已生效。' : 'Highest tier reached. Deposit waiver is active.')
  }
}

function tierBenefits(tier) {
  const benefits = {
    zh: {
      silver: ['会员档案与订单留存', '服务后护理提醒', '累计消费计入成长值', `预约需支付 ${moneyY(50)} 定金`],
      gold: ['预约免定金', '生日月权益', '护理与复购提醒', '推荐奖励追踪'],
      platinum: ['预约免定金', '热门时段优先提醒', '完整作品留档', '季节护理建议'],
      diamond: ['预约免定金', '最高等级标识', '优先排班提醒', '专属复购跟进']
    },
    en: {
      silver: ['Member file and order archive', 'After-care reminders', 'Spend counts toward growth', `${moneyY(50)} booking deposit required`],
      gold: ['Deposit waived', 'Birthday-month perks', 'Care and rebooking reminders', 'Referral reward tracking'],
      platinum: ['Deposit waived', 'Priority reminders for popular slots', 'Full work archive', 'Seasonal care suggestions'],
      diamond: ['Deposit waived', 'Highest-tier badge', 'Priority scheduling reminders', 'Dedicated rebooking follow-up']
    }
  }
  return benefits[state.lang]?.[tier.key] || benefits.en[tier.key] || []
}

function tierShortName(tier) {
  return tier.label.replace(' Member', '')
}

function payableDepositFor(item, user = state.user) {
  return userWaivesDeposit(user) ? 0 : Number(item.depositCents || 0)
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
      'x-tenant-id': TENANT_ID,
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
  // 卡包=私有(自己的卡券);商城=公开(没登录也能看有什么套餐,与小程序同口径)
  return new Set(['booking', 'cart', 'checkout', 'me', 'orders', 'orderDetail', 'assets', 'memberBenefits', 'coupons', 'giftCard', 'pointsMall', 'settings', 'cardPack', 'storedValue'])
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

function categoryKeyOf(service) {
  if (service.platformCategory) return service.platformCategory
  const t = String(service.type || '').toLowerCase()
  return t === 'nail' || t === 'lash' ? t : 'care'
}
function visibleCategories() {
  // 平台字典驱动;本店没有条目的大类不显示(v1.4:空大类不显示)
  const cats = state.platformCategories || []
  return cats.filter((cat) => state.services.some((svc) => categoryKeyOf(svc) === cat.key))
}
function servicesByType() {
  return state.services.filter((service) => categoryKeyOf(service) === state.type)
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
  await handleBookingDraftParam()
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

async function handleBookingDraftParam() {
  const params = new URLSearchParams(window.location.search)
  const draftId = params.get('bookingDraft')
  if (!draftId) return
  try {
    const data = await request(`/booking-drafts/${encodeURIComponent(draftId)}?lang=${state.lang}`)
    const draft = data.bookingDraft
    if (!draft?.service || !draft?.technician) {
      toast(t('draftUnavailable'))
      return
    }
    const item = {
      id: `draft_${draft.id}`,
      bookingDraftId: draft.id,
      selected: true,
      service: draft.service,
      technician: draft.technician,
      date: draft.date,
      time: draft.time,
      addOns: draft.addOns || [],
      referenceImages: draft.referenceImages || [],
      remark: draft.notes || '',
      sourceChannel: draft.sourceChannel || 'ai_booking_draft',
      servicePriceCents: Number(draft.service.priceCents ?? draft.service.price_cents ?? 0),
      depositCents: Number(draft.service.depositCents ?? draft.service.deposit_cents ?? 5000)
    }
    state.cart = [item, ...state.cart.filter((cartItem) => cartItem.bookingDraftId !== draft.id)]
    writeJson(`lucky-web-cart:${TENANT_ID}`, state.cart)
    state.view = 'checkout'
    toast(t('draftLoaded'))
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('bookingDraft')
    history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
  } catch (error) {
    toast(error.message || t('draftUnavailable'))
  }
}

async function loadServices() {
  /* v1.4 大类改造:一次拉全量(此前只拉 nail+lash,护理类服务网页顾客端根本看不到)。
     platformCategories=平台字典随响应下发,左栏据此渲染,空类不显示。 */
  const data = await request(`/services?lang=${state.lang}`)
  state.services = data.services || []
  state.platformCategories = data.platformCategories || []
}

async function loadStores() {
  const data = await request('/stores')
  state.stores = data.stores
  // D45:本店真实门店 id 覆盖兜底值(预约/技师/时段接口都用它)
  if (Array.isArray(data.stores) && data.stores[0] && data.stores[0].id) storeId = data.stores[0].id
  // 店主 08-16 定稿:左上角=平台品牌「有迹」固定(多商家平台),只有标签页标题随店;店名显示在 hero 横幅
  const sname = (data.stores && data.stores[0] && data.stores[0].name) || ''
  if (sname) document.title = sname
  // 币种跟门店走(公开接口下发,与商家端同源)
  if (data.currencyDisplay) Object.assign(CUR, data.currencyDisplay, { code: data.currency || '' })
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
  // C4(批③首件):网页顾客端待签单列表(D57 同构)——拉不到不挡订单列表
  try { state.pendingSign = (await request('/my/pending-sign')).pendingSign || [] } catch { state.pendingSign = [] }
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
  els.aiAssistantWidget.addEventListener('click', handleAssistantClick)
  els.aiAssistantWidget.addEventListener('submit', handleAssistantSubmit)
  els.aiAssistantWidget.addEventListener('input', (event) => {
    if (event.target.matches('[data-ai-assistant-input]')) state.aiAssistantDraft = event.target.value
  })
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
        <p class="eyebrow">${brandName()}</p>
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
      <img src="/assets/images/store-cover.jpg" alt="${brandName()}">
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
  if (requiresAuth(state.view) && !state.user && !(state.view === 'checkout' && state.cart.length)) state.view = 'home'
  render()
}

function render() {
  els.cartBadge.textContent = state.cart.length
  els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.view))
  if (state.view !== 'home') stopHeroCarousel()
  if (state.view === 'home') renderHome()
  if (state.view === 'services') renderServices()
  if (state.view === 'detail') renderDetail()
  if (state.view === 'booking') renderBookingForm()
  if (state.view === 'cart') renderCart()
  if (state.view === 'checkout') renderCheckout()
  if (state.view === 'me') {
    renderMe()
    // 黑卡「卡包」格的数字唯一出口 = /my/card-pack;没拿到先显示「—」,拿到再重绘(不拿恒 0 字段冒充)
    if (state.user && !state.cardPack) loadCardPack().then(() => { if (state.view === 'me') render() })
  }
  if (state.view === 'orders') renderOrdersWeb()
  if (state.view === 'orderDetail') renderOrderDetailWeb()
  if (state.view === 'assets') renderAssetsWeb()
  if (state.view === 'memberBenefits') renderMemberBenefitsWeb()
  if (state.view === 'store') renderStoreWeb()
  if (state.view === 'portfolio') renderPortfolio()
  if (state.view === 'cardPack') renderCardPackWeb()
  // 网页顾客端暂无独立储值明细页:储值行落卡包(卡包里有储值余额与去充值入口),不造半成品页
  if (state.view === 'storedValue') renderCardPackWeb()
  if (state.view === 'mall') renderMallWeb()
  if (state.view === 'coupons') renderPlaceholderWeb(t('coupons'), state.lang === 'zh' ? '优惠券列表和使用规则将在真实会员系统接入后同步。' : 'Coupon list and rules will sync after the real member system is connected.')
  if (state.view === 'giftCard') renderPlaceholderWeb(t('giftCard'), state.lang === 'zh' ? '礼品卡售卖与兑换功能保留为下一阶段。' : 'Gift card purchase and redemption is reserved for the next phase.')
  if (state.view === 'pointsMall') renderPlaceholderWeb(t('pointsMall'), state.lang === 'zh' ? '积分商城规则目前使用占位，后续可按会员规则兑换。' : 'The points mall currently uses placeholder rules.')
  if (state.view === 'settings') renderPlaceholderWeb(t('settings'), state.lang === 'zh' ? '语言、通知、账号安全等设置将在真实登录后接入。' : 'Language, notifications, and account security settings will connect after real auth.')
  renderAiAssistantWidget()
}

function heroSlides() {
  return [
    { image: '/assets/images/hero-carousel-interior.jpg', label: state.lang === 'zh' ? '店内氛围' : 'Studio mood' },
    { image: '/assets/images/hero-carousel-nail.jpg', label: state.lang === 'zh' ? '精致美甲细节' : 'Premium nail detail' },
    { image: '/assets/images/hero-carousel-lash.jpg', label: state.lang === 'zh' ? '美睫服务细节' : 'Lash service detail' }
  ]
}

function renderHome() {
  const slides = heroSlides()
  const activeSlide = ((state.heroSlide % slides.length) + slides.length) % slides.length
  state.heroSlide = activeSlide
  els.screen.innerHTML = `
    <section class="web-hero">
      <div class="web-hero-copy">
        <h1>${brandName()}</h1>
        <div class="hero-actions">
          <button class="primary" data-go-services="nail" type="button">${t('bookNow')}</button>
          <button class="ghost" data-view-target="me" type="button">${t('quickMember')}</button>
        </div>
      </div>
      <div class="hero-carousel" aria-label="${brandName()}">
        <div class="hero-slide-track">
          ${slides.map((slide, index) => `
            <img class="hero-slide ${index === activeSlide ? 'active' : ''}" src="${slide.image}" alt="${slide.label}">
          `).join('')}
        </div>
        <button class="hero-carousel-btn prev" data-hero-slide-prev type="button" aria-label="Previous">‹</button>
        <button class="hero-carousel-btn next" data-hero-slide-next type="button" aria-label="Next">›</button>
        <div class="hero-carousel-dots">
          ${slides.map((slide, index) => `<button class="${index === activeSlide ? 'active' : ''}" data-hero-slide="${index}" type="button" aria-label="${slide.label}"></button>`).join('')}
        </div>
      </div>
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
      <div class="section-row"><h2>${t('store')}</h2><span class="subtle">${CUR.code || ''}</span></div>
      <div class="store-card-wide card">
        <img src="/assets/images/store-cover.jpg" alt="${currentStore().name || 'Store'}">
        <div>
          <h3>${currentStore().name || ''}</h3>
          ${storeHoursSummary(currentStore()) ? `<p>${storeHoursSummary(currentStore())}</p>` : ''}
          ${storeContactLine(currentStore()) ? `<p>${storeContactLine(currentStore())}</p>` : ''}
        </div>
      </div>
    </section>
  `
  startHeroCarousel()
}

// 2026-08-04 店主定:顾客端两个 AI 入口暂不上线。
// ① AI 客服 —— 之后走企业微信外部客服,小程序/网页里这一环不需要了;
// ② 参考图 AI 分析 —— 待升级后再放出,正式版先不显示。
// 代码整段保留(改这两个开关即可复活),只是入口不渲染。
const CUSTOMER_AI_CHAT_ENABLED = false
const CUSTOMER_AI_REFERENCE_ENABLED = false

function renderAiAssistantWidget() {
  if (!els.aiAssistantWidget) return
  if (!CUSTOMER_AI_CHAT_ENABLED) { els.aiAssistantWidget.classList.add('hidden'); els.aiAssistantWidget.innerHTML = ''; return }
  els.aiAssistantWidget.classList.remove('hidden')
  if (!state.aiAssistantOpen) {
    els.aiAssistantWidget.innerHTML = `
      <button class="ai-assistant-fab" data-ai-assistant-toggle type="button">
        <span>AI</span>
        <strong>${t('aiAssistant')}</strong>
      </button>
    `
    return
  }
  const messages = state.aiAssistantMessages.length ? state.aiAssistantMessages : [{
    role: 'assistant',
    content: t('aiAssistantIntro'),
    meta: ''
  }]
  els.aiAssistantWidget.innerHTML = `
    <section class="ai-assistant-panel">
      <div class="ai-assistant-head">
        <div>
          <p class="eyebrow">${brandName()}</p>
          <h2>${t('aiAssistant')}</h2>
        </div>
        <button class="ghost slim" data-ai-assistant-toggle type="button">×</button>
      </div>
      <div class="ai-assistant-messages">
        ${messages.map((message) => `
          <article class="ai-message ${message.role}">
            <p>${escapeHtml(message.content)}</p>
            ${message.handoffRequired ? `<small>${t('aiHandoff')} · ${escapeHtml(message.handoffReason || t('aiHandoffHint'))}</small>` : ''}
          </article>
        `).join('')}
      </div>
      <div class="ai-assistant-quick">
        <button type="button" data-ai-quick="${t('aiQuickPrice')}">${t('aiQuickPrice')}</button>
        <button type="button" data-ai-quick="${t('aiQuickBooking')}">${t('aiQuickBooking')}</button>
        <button type="button" data-ai-quick="${t('aiQuickPolicy')}">${t('aiQuickPolicy')}</button>
      </div>
      <form class="ai-assistant-form">
        <input data-ai-assistant-input value="${escapeHtml(state.aiAssistantDraft)}" placeholder="${t('aiAssistantPlaceholder')}" ${state.aiAssistantLoading ? 'disabled' : ''}>
        <button class="primary slim" type="submit" ${state.aiAssistantLoading ? 'disabled' : ''}>${state.aiAssistantLoading ? '...' : t('aiSend')}</button>
      </form>
    </section>
  `
}

function handleAssistantClick(event) {
  if (event.target.closest('[data-ai-assistant-toggle]')) {
    state.aiAssistantOpen = !state.aiAssistantOpen
    renderAiAssistantWidget()
    return
  }
  const quick = event.target.closest('[data-ai-quick]')
  if (quick) {
    state.aiAssistantDraft = quick.dataset.aiQuick
    sendAiAssistantMessage().catch((error) => toast(error.message))
  }
}

function handleAssistantSubmit(event) {
  event.preventDefault()
  sendAiAssistantMessage().catch((error) => toast(error.message))
}

async function sendAiAssistantMessage() {
  const message = state.aiAssistantDraft.trim()
  if (!message || state.aiAssistantLoading) return
  state.aiAssistantMessages.push({ role: 'user', content: message })
  state.aiAssistantDraft = ''
  state.aiAssistantLoading = true
  renderAiAssistantWidget()
  try {
    const data = await request('/ai/customer-service', {
      method: 'POST',
      body: JSON.stringify({
        lang: state.lang,
        message,
        history: state.aiAssistantMessages.slice(-10)
      })
    })
    const reply = data.reply?.data || data.reply || {}
    state.aiAssistantMessages.push({
      role: 'assistant',
      content: state.lang === 'en' ? reply.answerEn : reply.answerZh,
      handoffRequired: Boolean(reply.handoffRequired),
      handoffReason: state.lang === 'en' ? reply.handoffReasonEn : reply.handoffReasonZh
    })
    state.aiAssistantMessages = state.aiAssistantMessages.slice(-12)
    writeJson('lucky-ai-assistant-messages', state.aiAssistantMessages)
  } finally {
    state.aiAssistantLoading = false
    renderAiAssistantWidget()
  }
}

function startHeroCarousel() {
  stopHeroCarousel()
  heroTimer = window.setInterval(() => {
    state.heroSlide = (state.heroSlide + 1) % heroSlides().length
    if (state.view === 'home') renderHome()
  }, 5200)
}

function stopHeroCarousel() {
  if (!heroTimer) return
  window.clearInterval(heroTimer)
  heroTimer = null
}


/* D46:店铺事实单源渲染件 —— 首页门店块/结算页店块/门店详情页全走这里。
   字段全部来自 /stores(随 ?store= 租户走);空字段不显示,不许再出现 Address TBD 这类假占位。 */
function currentStore() { return (state.stores && state.stores[0]) || {} }
function brandName() { return currentStore().name || 'Lucky Luxe' }

/* 切换门店(店主 08-16 拍板翻案:不能只靠每店专属链接)。参照物=小程序 shop-select 屏:
   同一 /shops 公开数据源(演示店同口径隐藏);选中即以 ?store= 整页进店——
   与 D45 直达链接同一机制,整页加载=天然全清场(三跳零残留已验的那套)。 */
async function openStoreSwitcher() {
  let shops = []
  try {
    const data = await request('/shops')
    shops = data.shops || []
  } catch (e) {
    toast(state.lang === 'en' ? 'Failed to load stores' : '加载门店失败')
    return
  }
  const overlay = document.createElement('div')
  overlay.className = 'store-switch-overlay'
  overlay.innerHTML = `
    <div class="store-switch-panel card">
      <div class="section-row"><h2>${state.lang === 'en' ? 'Choose a store' : '切换门店'}</h2><button class="ghost slim" data-switch-close type="button">✕</button></div>
      ${shops.map((shop) => `
        <button class="store-switch-row ${shop.tenantId === TENANT_ID ? 'current' : ''}" data-switch-tenant="${shop.tenantId}" type="button">
          <strong>${shop.storeName || shop.name}</strong>
          ${shop.address ? `<span>${shop.address}</span>` : ''}
          ${shop.tenantId === TENANT_ID ? `<em>${state.lang === 'en' ? 'Current' : '当前门店'}</em>` : ''}
        </button>`).join('')}
    </div>`
  overlay.addEventListener('click', (event) => {
    const row = event.target.closest('[data-switch-tenant]')
    if (row) {
      const tid = row.dataset.switchTenant
      if (tid && tid !== TENANT_ID) { window.location.href = `/?store=${encodeURIComponent(tid)}`; return }
      overlay.remove()
      return
    }
    if (event.target.closest('[data-switch-close]') || event.target === overlay) overlay.remove()
  })
  document.body.appendChild(overlay)
}
document.querySelector('#storeSwitchBtn')?.addEventListener('click', () => { openStoreSwitcher() })
function storeHoursSummary(store) {
  const hs = Array.isArray(store.hours) ? store.hours : []
  const open = hs.filter((h) => !h.is_closed)
  if (!open.length) return ''
  const names = state.lang === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const closed = hs.filter((h) => h.is_closed).map((h) => names[h.weekday])
  const sameTime = open.every((h) => h.open_time === open[0].open_time && h.close_time === open[0].close_time)
  const time = sameTime ? `${open[0].open_time}-${open[0].close_time}` : (state.lang === 'en' ? 'Hours vary by day' : '各日时段不同')
  const closedText = closed.length ? (state.lang === 'en' ? ` · Closed ${closed.join('/')}` : ` · ${closed.join('/')}休`) : ''
  return `${time}${closedText}`
}
function storeContactLine(store) {
  // 种子占位值(Address TBD/Phone TBD)不算数据:显示给顾客=假信息;店主在门店设置填真值后自动出现
  const real = (v) => (v && !/TBD/i.test(String(v)) ? v : '')
  return [real(store.address), real(store.phone)].filter(Boolean).join(' · ')
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
            <span>${fromPriceLabel(service)} · ${service.durationMin}${t('minutes')}</span>
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
      images: ['/assets/images/nail-french.jpg', '/assets/images/nail-luxe.jpg', '/assets/images/nail-jp.jpg', '/assets/images/nail-addon.jpg']
    },
    {
      technician: { id: 'tech-mia-demo', name: 'Mia Chen', title: state.lang === 'zh' ? '自然美睫 / 裸感款 / 轻盈浓密' : 'Natural Lash / Bare Look / Soft Volume' },
      images: ['/assets/images/lash-natural.jpg', '/assets/images/lash-volume.jpg', '/assets/images/lash-lower.jpg', '/assets/images/lash-remove.jpg']
    },
    {
      technician: { id: 'tech-ava-demo', name: 'Ava Lin', title: state.lang === 'zh' ? '基础护理 / 短甲显白 / 日常维护' : 'Care / Short Nails / Daily Maintenance' },
      images: ['/assets/images/nail-care.jpg', '/assets/images/nail-jp.jpg', '/assets/images/nail-french.jpg']
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
          <p class="eyebrow">${brandName()}</p>
          <h1>${selected ? selected.technician?.name : t('technicianPortfolio')}</h1>
          <span class="subtle">${selected ? selected.technician?.title : t('portfolioIntro')}</span>
        </div>
      </div>
      ${selected ? `
        <div class="technician-work-grid">
          ${(selected.images || []).map((image, index) => `
            <a href="${image}" target="_blank" rel="noreferrer">
              <img src="${image}" alt="${selected.technician?.name || brandName()} ${index + 1}">
            </a>
          `).join('')}
        </div>
      ` : portfolios.map((portfolio) => `
        <section class="technician-portfolio-section card">
          <div class="section-row compact-row">
            <div>
              <h2>${portfolio.technician?.name || brandName()}</h2>
              <p>${portfolio.technician?.title || (state.lang === 'zh' ? '美甲 / 美睫技师' : 'Nail / Lash Artist')}</p>
            </div>
            <button class="ghost slim" data-portfolio-tech="${portfolio.technician?.id || ''}" type="button">${t('viewWork')}</button>
          </div>
          <div class="portfolio-preview-grid">
            ${(portfolio.images || []).slice(0, 4).map((image, index) => `
              <button class="portfolio-preview-card" data-portfolio-tech="${portfolio.technician?.id || ''}" type="button">
                <img src="${image}" alt="${portfolio.technician?.name || brandName()} ${index + 1}">
              </button>
            `).join('')}
          </div>
        </section>
      `).join('')}
    </section>
  `
}

function renderServices() {
  const list = servicesByType()
  els.screen.innerHTML = `
    <section class="service-web-page">
      <div class="service-toolbar">
        <h1>${brandName()}</h1>
      </div>
      <div class="service-layout-web">
        <aside class="category-rail">
          ${visibleCategories().map((cat) => `<button class="${state.type === cat.key ? 'active' : ''}" data-type="${cat.key}" type="button">${state.lang === 'en' ? cat.nameEn : cat.nameZh}</button>`).join('')}
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
          <span class="price">${fromPriceLabel(service)}</span>
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
        ${CUSTOMER_AI_REFERENCE_ENABLED ? `<div class="ai-reference-panel card">
          <div>
            <strong>${t('aiReferenceTitle')}</strong>
            <p>${state.lang === 'zh' ? '上传参考图后，可让 AI 初步判断款式复杂度和加项建议。' : 'After uploading references, AI can estimate complexity and add-on suggestions.'}</p>
          </div>
          <button class="ghost slim" data-ai-reference type="button" ${state.referenceImages.length ? '' : 'disabled'}>${state.isAnalyzingReference ? t('aiAnalyzing') : t('aiAnalyze')}</button>
          ${state.referenceAnalysis ? renderReferenceAnalysis() : ''}
        </div>` : ''}
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
  const provider = state.referenceAnalysis?.provider || ''
  const isMock = !provider || provider.includes('mock') || String(state.referenceAnalysis?.model || '').includes('mock')
  const clientMessage = state.lang === 'en' ? result.clientMessageEn : result.clientMessageZh
  const techNote = state.lang === 'en' ? result.technicianNotesEn : result.technicianNotesZh
  return `
    <div class="ai-result-box">
      ${isMock ? `<div class="ai-mock-banner"><strong>${t('aiMockBadge')}</strong><span>${t('aiMockNotice')}</span></div>` : ''}
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
  writeJson(`lucky-web-cart:${TENANT_ID}`, state.cart)
  toast(t('created'))
  state.view = goCheckout ? 'checkout' : 'cart'
  render()
}

function renderCart() {
  const total = state.cart.filter((item) => item.selected).reduce((sum, item) => sum + payableDepositFor(item), 0)
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
        <p><strong>${t('deposit')} ${money(payableDepositFor(item))}</strong> · ${t('servicePrice')} ${money(item.servicePriceCents)}</p>
        ${userWaivesDeposit() ? `<p class="subtle">${state.lang === 'zh' ? '会员等级已减免预约定金' : 'Member tier deposit waiver applied'}</p>` : ''}
        ${item.referenceImages?.length ? `<div class="cart-reference-row">${item.referenceImages.map((image, index) => `<img src="${image}" alt="${t('reference')} ${index + 1}">`).join('')}</div>` : ''}
      </div>
      <img src="${item.service.imageUrl}" alt="${item.service.name}">
      <button class="ghost" data-remove-cart="${item.id}" type="button">Remove</button>
    </article>
  `
}

function renderCheckout() {
  const selected = state.cart.filter((item) => item.selected)
  const requiredDeposit = selected.reduce((sum, item) => sum + item.depositCents, 0)
  const deposit = selected.reduce((sum, item) => sum + payableDepositFor(item), 0)
  const waivedDeposit = Math.max(0, requiredDeposit - deposit)
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
            <p><strong>${t('deposit')} ${money(payableDepositFor(item))}</strong><span>${t('servicePrice')} ${money(item.servicePriceCents)}</span></p>
            ${item.referenceImages?.length ? `<div class="cart-reference-row">${item.referenceImages.map((image, index) => `<img src="${image}" alt="${t('reference')} ${index + 1}">`).join('')}</div>` : ''}
          </div>
        </article>
      `).join('') : `<div class="empty-state">${t('emptyCart')}</div>`}
      <section class="section">
        <div class="section-row"><h2>${t('discount')}</h2></div>
        <div class="cost-card card">
          <p><span>${t('appointment')}</span><strong>${money(deposit)}</strong></p>
          ${waivedDeposit ? `<p><span>${state.lang === 'zh' ? '会员定金减免' : 'Member deposit waiver'}</span><strong>-${money(waivedDeposit)}</strong></p>` : ''}
          <p><span>${t('coupon')}</span><strong>-${money(coupon)}</strong></p>
          <p><span>${t('balance')}</span><strong>${moneyY(300)}</strong></p>
        </div>
      </section>
      <section class="section">
        <div class="deposit-policy-card card">
          <h2>${t('depositPolicyTitle')}</h2>
          <p>${t('depositPolicyText')}</p>
        </div>
      </section>
      <section class="section">
        <div class="section-row"><h2>${t('store')}</h2></div>
        <div class="store-box card"><strong>${currentStore().name || ''}</strong><span>${[storeContactLine(currentStore()), storeHoursSummary(currentStore())].filter(Boolean).join(' · ')}</span></div>
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
        sourceChannel: item.sourceChannel || 'web',
        notes: item.remark || '',
        bookingDraftId: item.bookingDraftId || item.draftId || null
      })
    })
    if (bookingData.booking.status !== 'PENDING_PAYMENT' || bookingData.booking.depositCents <= 0) {
      completed.push(bookingData.booking)
      continue
    }
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
  writeJson(`lucky-web-cart:${TENANT_ID}`, state.cart)
  writeJson('lucky-web-orders', state.orders)
  toast(t('paidDone'))
  state.view = 'me'
  render()
}

function renderMe() {
  const user = state.user
  const tierInfo = memberTierInfo(user)
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
            <img class="avatar" src="/assets/images/member-profile.jpg" alt="${user.displayName}">
            <div class="member-copy">
              <h1>${user.displayName}</h1>
              <div class="member-level-line">
                <button class="web-level-pill" data-me-target="memberBenefits" type="button">
                  <span>${tierInfo.tier.label}</span>
                  <small>${t('viewMemberBenefits')}</small>
                </button>
                <span class="member-provider">${user.provider}</span>
              </div>
            </div>
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
        ${tiersDisabled(user) ? '' : `
        <div class="growth-block">
          <div class="growth-head"><span>${t('memberGrowth')}</span><span>${tierInfo.spend} / ${tierInfo.nextValue}</span></div>
          <div class="growth-track"><div class="growth-fill" style="width:${tierInfo.progress}%"></div></div>
          <p class="growth-note">${tierInfo.note}</p>
          <p class="deposit-rule-note">${userWaivesDeposit(user) ? (state.lang === 'zh' ? '当前会员等级：预约免定金' : 'Current tier: booking deposit waived') : (state.lang === 'zh' ? `当前会员等级：预约需支付 ${moneyY(50)} 定金` : `Current tier: ${moneyY(50)} booking deposit required`)}</p>
          <button class="member-benefits-link" data-me-target="memberBenefits" type="button">${t('memberBenefitsIntro')}</button>
        </div>`}
        <!-- 勘误(店主 08-23):会员卡三块=快捷区,**可点直达**(与小程序黑卡同构);
             券块改名「卡包」(券+次卡同页同名);网页暂无独立储值页,储值块落卡包的储值行 -->
        <div class="member-assets">
          <button data-me-target="pointsMall" type="button"><strong>${user.points}</strong><span>${t('points')}</span></button>
          <button data-me-target="cardPack" type="button"><strong>${state.cardPack ? state.cardPack.badgeCount : '—'}</strong><span>${state.lang === 'zh' ? '卡包' : 'Card pack'}</span></button>
          <button data-me-target="cardPack" type="button"><strong>${money(user.balanceCents)}</strong><span>${t('balance')}</span></button>
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
          ${/* 裁定A(店主 08-23):资产族只留「我的资产」一个入口——卡包/券/积分商城/会员权益
                全部收进资产分类总页(与小程序同构,四之九);商城=购买入口不属资产族,由储值页/资产页进 */''}
          ${[
            [state.lang === 'zh' ? '卡包' : 'Card pack', '/assets/images/nail-luxe.jpg', 'cardPack', true],
            [t('store'), '/assets/images/store-cover.jpg', 'store', false],
            [t('giftCard'), '/assets/images/lash-volume.jpg', 'giftCard', false],
            [t('settings'), '/assets/images/lash-natural.jpg', 'settings', false]
          ].map(([label, image, target, live]) => {
            const sub = live ? (state.lang === 'zh' ? '次卡 · 优惠券 · 储值' : 'Passes · Coupons · Balance') : t('comingSoon')
            return `<button class="menu-card card" data-me-target="${target}" type="button"><img src="${image}" alt="${label}"><strong>${label}</strong><span>${sub}</span></button>`
          }).join('')}
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
      ${(state.pendingSign || []).length ? `
      <div class="section-row compact"><h2 style="color:#8a3a33;font-size:15px">${state.lang === 'zh' ? `待你签字确认 · ${state.pendingSign.length} 单` : `Awaiting your signature · ${state.pendingSign.length}`}</h2></div>
      ${state.pendingSign.map((p) => `
        <a class="order-card-web card" style="display:flex;justify-content:space-between;align-items:center;text-decoration:none" href="/sign/${encodeURIComponent(p.code)}" target="_blank" rel="noreferrer">
          <span><strong>${escapeHtml(state.lang === 'zh' ? '服务确认单 ' : 'Sheet ')}${escapeHtml(p.code)}</strong><br><small class="subtle">${escapeHtml(p.at)} · ${state.lang === 'zh' ? '到店支付' : 'Pay in store'} ${escapeHtml(p.cashDueText)}</small></span>
          <span class="primary button-link" style="padding:8px 16px;border-radius:10px">${state.lang === 'zh' ? '去签字 ›' : 'Sign ›'}</span>
        </a>`).join('')}` : ''}
      <div class="order-list-web">
          ${orders.length ? orders.map((order) => `
          <button class="order-card-web card" data-order-id="${order.id}" type="button">
            <div class="order-head-web"><strong>${order.listTitleText ? escapeHtml(order.listTitleText) : order.service.name}</strong><span>${order.listBadgeText ? escapeHtml(order.listBadgeText) : statusLabel(order.status)}</span></div>
            <div class="order-body-web">
              <img src="${order.status === 'COMPLETED' && customerVisibleWorkImages(order)[0] ? customerVisibleWorkImages(order)[0] : order.service.imageUrl}" alt="${order.service.name}">
              <div>
                <p>${order.appointmentDate} ${order.appointmentTime}</p>
                <p>${order.technician.name} · ${order.store.name}</p>
                <p class="price">${order.actualDueText ? escapeHtml(order.actualDueText) : (order.listAmountText ? escapeHtml(order.listAmountText) : `${t('paidDeposit')} ${money(order.depositCents)}`)}</p>
                ${order.status === 'COMPLETED' && customerVisibleWorkImages(order).length ? `<p>${t('finalPhotos')} · ${customerVisibleWorkImages(order).length}</p>` : ''}
              </div>
            </div>
          </button>
        `).join('') : `<div class="empty-state tall"><strong>${state.lang === 'zh' ? '暂无订单' : 'No orders yet'}</strong><span>${state.lang === 'zh' ? '预约完成后会在这里看到记录。' : 'Your bookings will appear here.'}</span><button class="primary" data-view-target="services" type="button">${t('chooseService')}</button></div>`}
      </div>
    </section>
  `
}

/* D68③:网页端浮层查看器搬去 apps/web/snapshot-viewer.js(admin 与 customer 共用一份实现);
   本文件只负责把 items 备好后调 window.openSnapViewer(items, startIndex)。 */

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
          ${order.store.address && !/TBD/i.test(order.store.address) ? `<p><span>${t('address')}</span><strong>${order.store.address}</strong></p>` : ''}
          <p><span>${t('remark')}</span><strong>${order.notes || t('none')}</strong></p>
        </div>
      </section>
      ${workImages.length ? `
      <section class="section">
        <div class="section-row"><h2>${t('workArchive')}</h2><span class="subtle">${order.technician.name}</span></div>
        <div class="archive-card-web card">
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
        </div>
      </section>` : ''}
      <section class="section">
        <div class="section-row"><h2>${state.lang === 'zh' ? '服务签署单' : 'Signed sheet'}</h2>${order.payment ? `<span class="subtle">${state.lang === 'zh' ? '已签署' : 'Signed'} ${escapeHtml(String(order.payment.signedAt || '').slice(0, 16).replace('T', ' '))}</span>` : ''}</div>
        <div class="info-card-web card">
          ${order.payment && (order.payment.sheets || []).length > 1 ? `
            <p style="border-bottom:2px solid #e7ddd4;padding-bottom:8px"><span><strong>${escapeHtml(order.payment.groupCashLabel)}</strong></span><strong class="price">${escapeHtml(order.payment.groupCashDueText)}</strong></p>
            ${order.payment.sheets.map((sh) => `
              <p style="margin-top:10px"><span><strong>${state.lang === 'zh' ? escapeHtml(sh.label || '') : `Sheet ${sh.n}/${sh.total}`}</strong></span><span class="subtle">${escapeHtml(String(sh.signedAt || '').slice(0, 16).replace('T', ' '))}</span></p>
              ${((sh.flow && sh.flow.lines) || []).map((fl) => `<p><span>${escapeHtml(fl.label)}</span><strong>${escapeHtml(fl.amountText)}</strong></p>`).join('')}
              <p style="border-top:1px solid #e7ddd4;padding-top:6px"><span><strong>${escapeHtml((sh.flow && sh.flow.heroLabel) || '本单到店支付')}</strong></span><strong class="price">${escapeHtml((sh.flow && sh.flow.cashDueText) || '')}</strong></p>
              <p>${sh.snapshotUrl
                ? `<a href="#" data-snap-open="${escapeHtml(sh.code)}">${state.lang === 'zh' ? '查看原件 ›' : 'View ›'}</a>`
                : `<a href="/sign/${encodeURIComponent(sh.code)}" target="_blank" rel="noreferrer">${state.lang === 'zh' ? '去签字 ›' : 'Sign ›'}</a>`}</p>`).join('')}
          ` : ''}
          ${order.payment && order.payment.flow && !((order.payment.sheets || []).length > 1) ? `
            ${order.payment.flow.lines.map((fl) => `<p><span>${escapeHtml(fl.label)}</span><strong>${escapeHtml(fl.amountText)}</strong></p>`).join('')}
            <p style="border-top:1px solid #e7ddd4;padding-top:8px"><span><strong>${escapeHtml(order.payment.flow.heroLabel)}</strong></span><strong class="price">${escapeHtml(order.payment.flow.cashDueText)}</strong></p>
            <p style="margin-top:8px"><a href="#" data-snap-open="${escapeHtml(order.payment.code)}">${state.lang === 'zh' ? '查看服务确认单原件 ›' : 'View original ›'}</a></p>
          ` : (order.payment ? '' : (order.status === 'COMPLETED' || order.status === 'AFTER_SALES'
    ? `<div class="empty-state small-empty">${state.lang === 'zh' ? '本单未产生结算单' : 'No settlement sheet for this booking'}</div>`
    : `
            <p><span>${t('paidDeposit')}</span><strong class="price">${money(order.depositCents)}</strong></p>
            <p><span>${t('finalDue')}</span><strong>${money(order.finalDueCents)}</strong></p>
            <p><span>${t('servicePrice')}</span><strong>${money(order.servicePriceCents)}</strong></p>`))}
        </div>
      </section>
      ${order.afterSalesAction ? `
      <section class="section">
        <div class="info-card-web card">
          <button class="primary" data-as-action="${order.id}" type="button" style="width:100%">${escapeHtml(order.afterSalesActionText)}</button>
          ${state.asPanelOpen && order.afterSalesAction === 'start' ? `
            <textarea id="asDescWeb" placeholder="${state.lang === 'zh' ? '问题描述(必填):哪里不满意/出了什么状况' : 'Describe the issue (required)'}" style="width:100%;min-height:90px;margin-top:10px;border:1px solid #e7ddd4;border-radius:10px;padding:10px;box-sizing:border-box">${escapeHtml(state.asDesc || '')}</textarea>
            <button class="primary slim" data-as-submit="${order.id}" type="button" style="margin-top:8px">${state.lang === 'zh' ? '提交,转人工跟进' : 'Submit'}</button>
            <p class="subtle" style="margin-top:6px">${state.lang === 'zh' ? '提交后门店会跟进处理;涉及退款/补差走门店更正单,这里只记录过程与结论。' : 'The store will follow up; refunds go through correction sheets.'}</p>
          ` : ''}
        </div>
      </section>` : ''}
      ${order.afterSales ? `
      <section class="section">
        <div class="section-row"><h2>${escapeHtml(order.afterSales.title)}</h2></div>
        <div class="info-card-web card">
          ${order.afterSales.steps.map((st) => `<p><span>${st.done ? '●' : '○'} ${escapeHtml(st.label)}</span><strong class="subtle">${escapeHtml(st.at || '')}</strong></p>`).join('')}
          ${order.afterSalesAction === 'progress' ? `<p style="margin-top:8px"><a href="#" data-as-withdraw="${order.id}">${state.lang === 'zh' ? '撤回本次售后(记录保留)' : 'Withdraw'}</a></p>` : ''}
        </div>
      </section>` : ''}
    </section>
  `
}

/* 批③次段 D2/D3(网页顾客端同构,四之九):卡包与商城两页与小程序**同句同结构**——
   句子全部来自后端唯一出口(/my/card-pack、/my/mall),这里只渲染,不拼话不算钱。 */
function renderCardPackWeb() {
  const pack = state.cardPack
  if (!pack) {
    els.screen.innerHTML = `<section class="view-web"><div class="empty-state tall"><strong>${state.lang === 'zh' ? '加载中…' : 'Loading…'}</strong></div></section>`
    loadCardPack().then(() => { if (state.view === 'cardPack') render() })
    return
  }
  const zh = state.lang === 'zh'
  els.screen.innerHTML = `
    <section class="view-web">
      <button class="ghost back-btn" data-me-target="me" type="button">← ${zh ? '我的' : 'Me'}</button>
      <h1>${zh ? '卡包' : 'Card pack'}</h1>
      ${pack.emptyText ? `<div class="empty-state tall"><strong>${escapeHtml(pack.emptyText)}</strong>
        <button class="primary" data-me-target="mall" type="button">${zh ? '去看看充值套餐' : 'See packages'}</button></div>` : ''}
      ${pack.timecards.length ? `<div class="section-row compact"><h2>${zh ? '次卡' : 'Passes'}</h2><button class="section-note-btn" data-mall-focus="timecard" type="button">${zh ? '去商城 ›' : 'Shop ›'}</button></div>
        ${pack.timecards.map((c) => `
          <div class="info-card-web card">
            <p><span><strong>${escapeHtml(c.name)}</strong></span><strong>${zh ? '剩' : 'Left'} ${c.remaining}/${c.totalTimes}</strong></p>
            <p class="subtle">${c.expiresAt ? `${escapeHtml(c.expiresAt)} ${zh ? '到期' : 'expires'}` : (zh ? '长期有效' : 'No expiry')}</p>
            ${c.sourceLabel ? `<p class="subtle">${escapeHtml(c.sourceLabel)}</p>` : ''}
          </div>`).join('')}` : ''}
      ${pack.coupons.length ? `<div class="section-row compact"><h2>${zh ? '优惠券' : 'Coupons'}</h2></div>
        ${pack.coupons.map((q) => `
          <div class="info-card-web card">
            <p><span><strong>${escapeHtml(q.name)}</strong></span><strong class="price">${escapeHtml(q.faceText)}</strong></p>
            <p class="subtle">${escapeHtml(q.subtitle)}</p>
            ${q.sourceLabel ? `<p class="subtle">${escapeHtml(q.sourceLabel)}</p>` : ''}
          </div>`).join('')}` : ''}
      ${/* 裁定①(店主 08-23):卡包=券+次卡两类,储值不进卡包(会员卡已直达+自有页,重复即乱) */''}
    </section>`
}

function renderMallWeb() {
  const mall = state.mall
  if (!mall) {
    els.screen.innerHTML = `<section class="view-web"><div class="empty-state tall"><strong>${state.lang === 'zh' ? '加载中…' : 'Loading…'}</strong></div></section>`
    loadMall().then(() => { if (state.view === 'mall') render() })
    return
  }
  const zh = state.lang === 'zh'
  els.screen.innerHTML = `
    <section class="view-web">
      <button class="ghost back-btn" data-me-target="me" type="button">← ${zh ? '我的' : 'Me'}</button>
      <h1>${zh ? '充值 · 次卡' : 'Recharge & passes'}</h1>
      ${mall.emptyText ? `<div class="empty-state tall"><strong>${escapeHtml(mall.emptyText)}</strong></div>` : ''}
      ${(mall.filters || []).length > 1 ? `<div class="mall-filters">${mall.filters.map((f) => `<button class="mall-filter${(state.mallFilter || 'all') === f.key ? ' on' : ''}" data-mall-filter="${escapeHtml(f.key)}" type="button">${escapeHtml(f.label)}</button>`).join(' ')}</div>` : ''}
      ${(mall.sections || []).filter((sec) => (state.mallFilter || 'all') === 'all' || (state.mallFilter || 'all') === sec.kind).map((sec) => `
        <div class="section-row compact"><h2>${escapeHtml(sec.kind === 'timecard' ? `${sec.label} · 次卡` : sec.label)}</h2></div>
        ${mall.items.filter((it) => it.section === sec.key).map((it) => `
        <div class="info-card-web card">
          <p><span><strong>${escapeHtml(it.titleText)}</strong></span>${it.bonusText ? `<strong class="price">${escapeHtml(it.bonusText)}</strong>` : ''}</p>
          ${it.unitText ? `<p class="subtle">${escapeHtml(it.unitText)}</p>` : ''}
          ${it.projectGroupText ? `<p class="subtle">${zh ? '适用项目组:' : 'Scope: '}${escapeHtml(it.projectGroupText)}</p>` : ''}
          ${it.validText ? `<p class="subtle">${escapeHtml(it.validText)}</p>` : ''}
          <p style="margin-top:10px"><button class="primary" data-mall-buy="${escapeHtml(it.id)}" type="button" style="width:100%">${escapeHtml(it.buyButtonText)}</button></p>
          ${state.mallNoteFor === it.id ? `<p class="subtle">${escapeHtml(it.offlineNote)}</p>` : ''}
        </div>`).join('')}`).join('')}
    </section>`
}

async function loadCardPack() {
  try { state.cardPack = (await request('/my/card-pack')).cardPack } catch (error) { state.cardPack = null; toast(error.message) }
}
async function loadMall() {
  try { state.mall = await request('/my/mall') } catch (error) { state.mall = null; toast(error.message) }
}

/* 裁定A(店主 08-23):我的资产=**分类总页**(与小程序同构)。四类各一行,数字全部来自
   后端唯一出口 /my/assets(卡包与卡包页同源同数、储值与卡包储值行同源、积分与积分页同源);
   本函数零计算、零拼数。今后新资产类型一律加在这一页,不许回「我的」页并列。 */
/* 裁定A 勘误(店主 08-23 推翻重做):不再有「我的资产」分类总页——
   同一类资产只留一个页一个名字(卡包),高频资产允许从会员卡直达。
   本函数保留只是为了老路由不 404,直接落卡包页(名字与页都归一)。 */
function renderAssetsWeb() { renderCardPackWeb() }

function renderAssetsWebRetired() {
  const a = state.assets
  const zh = state.lang === 'zh'
  if (!a) {
    els.screen.innerHTML = `<section class="assets-web-page"><div class="empty-state tall"><strong>${zh ? '加载中…' : 'Loading…'}</strong></div></section>`
    loadAssets().then(() => { if (state.view === 'assets') render() })
    return
  }
  const row = (title, sub, right, target) => `
    <button class="menu-card card" data-me-target="${target}" type="button" style="display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left">
      <span><strong>${escapeHtml(title)}</strong><br><small class="subtle">${escapeHtml(sub)}</small></span>
      <strong class="price">${escapeHtml(right)} ›</strong>
    </button>`
  els.screen.innerHTML = `
    <section class="assets-web-page">
      <button class="ghost back-btn" data-view-target="me" type="button">← ${t('me')}</button>
      <h1>${t('assets')}</h1>
      ${row(zh ? '卡包' : 'Card pack', a.cardPack.summaryText, a.cardPack.count ? String(a.cardPack.count) : '', 'cardPack')}
      ${row(zh ? '储值' : 'Balance', zh ? '余额与流水明细' : 'Balance & history', a.stored.balanceText, 'storedValue')}
      ${row(zh ? '积分' : 'Points', zh ? '明细与积分商城' : 'History & points mall', String(a.points.balance), 'pointsMall')}
      ${row(zh ? '会员权益' : 'Benefits', a.membership.level || '', '', 'memberBenefits')}
    </section>
  `
}

async function loadAssets() {
  try { state.assets = (await request('/my/assets')).assets } catch (error) { state.assets = null; toast(error.message) }
}

function renderMemberBenefitsWeb() {
  const user = state.user
  const tierInfo = memberTierInfo(user)
  els.screen.innerHTML = `
    <section class="member-benefits-web">
      <button class="ghost back-btn" data-view-target="me" type="button">← ${t('me')}</button>
      <section class="member-benefits-hero-web">
        <div>
          <p class="eyebrow">${t('memberBenefits')}</p>
          <h1>${tierInfo.tier.label}</h1>
          <p>${t('memberBenefitsIntro')}</p>
        </div>
        <div class="benefits-progress-card">
          <span>${t('lifetimeSpend')}</span>
          <strong>${money(user.totalSpentCents || 0)}</strong>
          <small>${tierInfo.note}</small>
          <div class="growth-track"><div class="growth-fill" style="width:${tierInfo.progress}%"></div></div>
        </div>
      </section>
      ${tiersDisabled(user) ? `
      <section class="card" style="padding:18px;margin:12px 0">
        <h2 style="margin:0 0 6px">${user.memberLevel === '会员' ? (state.lang === 'zh' ? '我的会员' : 'My membership') : (state.lang === 'zh' ? '成为会员' : 'Become a member')}</h2>
        <p class="subtle">${user.memberLevel === '会员' ? (state.lang === 'zh' ? '您已是本店会员(充值即入会)。' : 'You are a member (join by recharging).') : (state.lang === 'zh' ? '在本店充值即可成为会员。' : 'Recharge at this store to become a member.')}</p>
        ${(user.memberPerks || []).length ? `<p style="font-weight:600;margin:10px 0 4px">${state.lang === 'zh' ? '本店会员专属权益' : 'Member perks'}</p>${user.memberPerks.map((x) => `<p class="subtle">· ${x}</p>`).join('')}` : ''}
      </section>` : ''}
      <section class="tier-grid-web">
        ${(tiersDisabled(user) ? [] : user.memberTiers).map((tier) => {
          const active = tier.key === tierInfo.tier.key
          return `
            <article class="tier-card-web ${active ? 'active' : ''}">
              <div class="tier-card-head">
                <span>${tierShortName(tier)}</span>
                ${active ? `<strong>${t('currentTier')}</strong>` : ''}
              </div>
              <h2>${tier.label}</h2>
              <p class="tier-threshold">${t('lifetimeSpend')} ${tier.minSpend ? `${moneyY(tier.minSpend)}+` : `${moneyY(0)}+`}</p>
              <p class="tier-deposit">${t('depositRule')}: <strong>${tier.depositWaived ? t('depositWaived') : t('depositRequired')}</strong></p>
              <ul class="tier-benefit-list">
                ${tierBenefits(tier).map((benefit) => `<li>${benefit}</li>`).join('')}
              </ul>
            </article>
          `
        }).join('')}
      </section>
      <section class="upgrade-gifts-web card">
        <div>
          <h2>${t('upgradeGift')}</h2>
          <p>${state.lang === 'zh' ? '升级权益可用于后续优惠券、护理提醒、复购回访和会员专属活动。具体礼遇会在正式上线前由店主确认。' : 'Upgrade perks can later connect coupons, after-care reminders, rebooking follow-ups, and member-only events. Final benefits will be confirmed before launch.'}</p>
        </div>
        <button class="primary slim" data-view-target="services" type="button">${t('bookNow')}</button>
      </section>
    </section>
  `
}

function renderStoreWeb() {
  const store = state.stores[0] || {}
  els.screen.innerHTML = `
    <section class="store-web-page">
      <button class="ghost back-btn" data-view-target="me" type="button">← ${t('me')}</button>
      <img class="store-hero-web" src="/assets/images/store-cover.jpg" alt="${store.name || 'Store'}">
      <div class="store-info-web card">
        <h1>${store.name || ''}</h1>
        ${storeContactLine(store) ? `<p>${storeContactLine(store)}</p>` : ''}
        ${storeHoursSummary(store) ? `<p>${storeHoursSummary(store)}</p>` : ''}
      </div>
    </section>
  `
}

function renderPlaceholderWeb(title, text) {
  els.screen.innerHTML = `
    <section class="placeholder-web">
      <button class="ghost back-btn" data-view-target="me" type="button">← ${t('me')}</button>
      <div class="placeholder-card card">
        <img src="/assets/images/store-cover.jpg" alt="${title}">
        <h1>${title}</h1>
        <p>${text}</p>
      </div>
    </section>
  `
}

async function handleScreenClick(event) {
  const heroSlide = event.target.closest('[data-hero-slide]')
  if (heroSlide) {
    state.heroSlide = Number(heroSlide.dataset.heroSlide || 0)
    renderHome()
    return
  }
  if (event.target.closest('[data-hero-slide-prev]')) {
    state.heroSlide = (state.heroSlide - 1 + heroSlides().length) % heroSlides().length
    renderHome()
    return
  }
  if (event.target.closest('[data-hero-slide-next]')) {
    state.heroSlide = (state.heroSlide + 1) % heroSlides().length
    renderHome()
    return
  }
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
  /* D68②(店主 08-23):签署原件=悬浮 lightbox(多张左右切换/滑动),
     与小程序浮层同构——不再 target=_blank 开新页(新页/新栈=D68① 要治的病)。 */
  const snapOpen = event.target.closest('[data-snap-open]')
  if (snapOpen) {
    event.preventDefault()
    const order = selectedOrder()
    const sheets = ((order && order.payment && order.payment.sheets) || []).filter((sh) => sh.snapshotUrl)
    const items = sheets.length
      ? sheets.map((sh) => ({ code: sh.code, label: sh.label || '服务确认单', url: sh.snapshotUrl }))
      : (order && order.payment ? [{ code: order.payment.code, label: '服务确认单', url: `/settlements/${encodeURIComponent(order.payment.code)}/snapshot` }] : [])
    if (!items.length) return
    const idx = Math.max(0, items.findIndex((it) => it.code === snapOpen.dataset.snapOpen))
    openSnapViewer(items, idx)
    return
  }
  /* 批③首件 C3:售后发起/撤回(同一状态机,句与前置全由后端;涉钱零新径) */
  const asAction = event.target.closest('[data-as-action]')
  if (asAction) {
    const order = selectedOrder()
    if (!order) return
    if (order.afterSalesAction === 'start') { state.asPanelOpen = !state.asPanelOpen; render() }
    return
  }
  const asSubmit = event.target.closest('[data-as-submit]')
  if (asSubmit) {
    const order = selectedOrder()
    const desc = String(document.getElementById('asDescWeb')?.value || '').trim()
    if (!order) return
    if (!desc) { toast(state.lang === 'zh' ? '问题描述必填' : 'Description required'); return }
    try {
      await request(`/my/bookings/${encodeURIComponent(order.id)}/after-sales`, { method: 'POST', body: JSON.stringify({ description: desc }) })
      state.asPanelOpen = false; state.asDesc = ''
      await loadUserOrders(); render()
      toast(state.lang === 'zh' ? '已发起售后,门店会尽快跟进' : 'After-sales started')
    } catch (error) { toast(error.message) }
    return
  }
  const asWithdraw = event.target.closest('[data-as-withdraw]')
  if (asWithdraw) {
    event.preventDefault()
    const order = selectedOrder()
    if (!order) return
    try {
      await request(`/my/bookings/${encodeURIComponent(order.id)}/after-sales/withdraw`, { method: 'POST', body: '{}' })
      await loadUserOrders(); render()
      toast(state.lang === 'zh' ? '已撤回(记录保留)' : 'Withdrawn')
    } catch (error) { toast(error.message) }
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
  const mallFocus = event.target.closest('[data-mall-focus]')
  if (mallFocus) {
    event.preventDefault()
    state.mallFilter = mallFocus.dataset.mallFocus   // 裁定②:去统一商城并定位次卡分区(不新建页)
    setView('mall')
    return
  }
  const mallFilter = event.target.closest('[data-mall-filter]')
  if (mallFilter) {
    event.preventDefault()
    state.mallFilter = mallFilter.dataset.mallFilter
    render()
    return
  }
  const mallBuy = event.target.closest('[data-mall-buy]')
  if (mallBuy) {
    event.preventDefault()
    state.mallNoteFor = state.mallNoteFor === mallBuy.dataset.mallBuy ? '' : mallBuy.dataset.mallBuy
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
    writeJson(`lucky-web-cart:${TENANT_ID}`, state.cart)
    renderCart()
    return
  }
  const remove = event.target.closest('[data-remove-cart]')
  if (remove) {
    state.cart = state.cart.filter((item) => item.id !== remove.dataset.removeCart)
    writeJson(`lucky-web-cart:${TENANT_ID}`, state.cart)
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
