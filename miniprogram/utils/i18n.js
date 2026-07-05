const LANG_KEY = 'lucky_lang'

const copy = {
  common: {
    zh: {
      appName: 'Lucky Luxe',
      nail: '美甲 Nail',
      lash: '美睫 Lash',
      minutes: '分钟',
      deposit: '定金',
      servicePrice: '服务价',
      bookNow: '立即预约',
      addToCart: '加入购物车',
      checkout: '去结算',
      save: '保存预约',
      statusPendingService: '待服务',
      statusCompleted: '已完成',
      statusCancelled: '已取消',
      statusAfterSales: '售后',
      statusPendingPayment: '待支付',
      all: '全部',
      paid: '已支付',
      none: '无'
    },
    en: {
      appName: 'Lucky Luxe',
      nail: 'Nails',
      lash: 'Lashes',
      minutes: 'min',
      deposit: 'Deposit',
      servicePrice: 'Service',
      bookNow: 'Book Now',
      addToCart: 'Add to Cart',
      checkout: 'Checkout',
      save: 'Save',
      statusPendingService: 'Upcoming',
      statusCompleted: 'Completed',
      statusCancelled: 'Cancelled',
      statusAfterSales: 'After-sales',
      statusPendingPayment: 'To Pay',
      all: 'All',
      paid: 'Paid',
      none: 'None'
    }
  },
  home: {
    zh: {
      heroText: '从一次体验，到长期关系。',
      storeAction: '门店信息',
      quickNail: '美甲',
      quickLash: '美睫',
      quickStore: '店铺地址',
      quickMember: '会员中心',
      popularNail: '人气美甲',
      popularLash: '人气美睫',
      storeTitle: '门店展示',
      hours: '营业时间',
      phone: '电话',
      address: '地址',
      viewStore: '查看门店'
    },
    en: {
      heroText: 'From one visit to a lasting beauty ritual.',
      storeAction: 'Store Info',
      quickNail: 'Nails',
      quickLash: 'Lashes',
      quickStore: 'Location',
      quickMember: 'Member',
      popularNail: 'Popular Nails',
      popularLash: 'Popular Lashes',
      storeTitle: 'Store',
      hours: 'Hours',
      phone: 'Phone',
      address: 'Address',
      viewStore: 'View Store'
    }
  },
  services: {
    zh: { title: '服务', empty: '该分类暂无服务' },
    en: { title: 'Services', empty: 'No services in this category' }
  },
  detail: {
    zh: { title: '服务详情', process: '服务流程', notice: '注意事项', reference: '款式参考' },
    en: { title: 'Service Details', process: 'Process', notice: 'Notes', reference: 'Style References' }
  },
  booking: {
    zh: {
      title: '预约填写',
      time: '预约时间',
      date: '到店日期',
      addOns: '附加服务',
      optional: '可选',
      reference: '参考图',
      upload: '上传',
      remark: '备注',
      remarkPlaceholder: '可填写款式偏好、过敏情况或到店说明',
      requiredDeposit: '需付定金',
      imageLimit: '最多上传 3 张参考图',
      chooseDate: '请选择预约日期',
      chooseTime: '请选择预约时间',
      remarkLimit: '备注最多 100 字',
      saved: '已保存',
      added: '已加入购物车',
      missing: '服务不存在'
    },
    en: {
      title: 'Booking',
      time: 'Appointment Time',
      date: 'Date',
      addOns: 'Add-ons',
      optional: 'Optional',
      reference: 'Reference Images',
      upload: 'Upload',
      remark: 'Notes',
      remarkPlaceholder: 'Style preferences, allergies, or arrival notes',
      requiredDeposit: 'Deposit Due',
      imageLimit: 'Up to 3 reference images',
      chooseDate: 'Please choose a date',
      chooseTime: 'Please choose a time',
      remarkLimit: 'Notes can be up to 100 characters',
      saved: 'Saved',
      added: 'Added to cart',
      missing: 'Service not found'
    }
  },
  cart: {
    zh: {
      title: '购物车',
      pendingCheckout: '待结算',
      edit: '重新填写',
      remove: '删除',
      emptyTitle: '购物车还是空的',
      emptyText: '先挑选一个喜欢的服务，再完成预约。',
      chooseService: '去选服务',
      selectAll: '全选',
      totalDeposit: '合计定金',
      deleteTitle: '删除服务',
      deleteContent: '确认从购物车删除该预约服务吗？',
      chooseCheckout: '请选择要结算的服务'
    },
    en: {
      title: 'Cart',
      pendingCheckout: 'Ready',
      edit: 'Edit',
      remove: 'Remove',
      emptyTitle: 'Your cart is empty',
      emptyText: 'Choose a service to start your booking.',
      chooseService: 'Choose Service',
      selectAll: 'Select All',
      totalDeposit: 'Total Deposit',
      deleteTitle: 'Remove Service',
      deleteContent: 'Remove this booking from cart?',
      chooseCheckout: 'Please select a service to checkout'
    }
  },
  checkout: {
    zh: {
      title: '结算',
      confirm: '确认预约',
      mockPay: '模拟支付',
      coupon: '新人体验券',
      discount: '优惠与抵扣',
      appointmentDeposit: '预约定金',
      balance: '储值余额抵扣',
      balanceHint: '定金固定为 CAD $50，不支持抵扣',
      balanceDeduction: '余额抵扣',
      store: '到店信息',
      depositPolicyTitle: '定金退改规则',
      depositPolicyText: '预约定金用于锁定技师时间。到店前 24 小时以上取消或改期，定金可退或可转；24 小时内取消或临时改期，定金会扣除一半；临时爽约定金不退。',
      orderRemark: '订单备注',
      remarkPlaceholder: '可补充给门店的说明',
      payable: '应付',
      payAction: '模拟支付并预约',
      noItems: '没有可结算的服务'
    },
    en: {
      title: 'Checkout',
      confirm: 'Confirm Booking',
      mockPay: 'Demo Payment',
      coupon: 'New Guest Coupon',
      discount: 'Discounts',
      appointmentDeposit: 'Appointment Deposit',
      balance: 'Balance Deduction',
      balanceHint: 'Deposit is fixed at CAD $50 and cannot be deducted',
      balanceDeduction: 'Balance',
      store: 'Store Info',
      depositPolicyTitle: 'Deposit Cancellation Policy',
      depositPolicyText: 'The deposit holds your technician time. Cancellations or rescheduling more than 24 hours before the appointment can be refunded or transferred. Within 24 hours, half of the deposit is kept. No-shows are non-refundable.',
      orderRemark: 'Order Notes',
      remarkPlaceholder: 'Add any note for the store',
      payable: 'Payable',
      payAction: 'Demo Pay & Book',
      noItems: 'No service to checkout'
    }
  },
  success: {
    zh: {
      title: '预约成功',
      subtitle: '演示版已完成模拟支付，订单已保存到本地。',
      orderNo: '订单编号',
      service: '服务项目',
      arrival: '到店时间',
      address: '门店地址',
      paidDeposit: '实付定金',
      viewOrders: '查看订单',
      home: '回到首页'
    },
    en: {
      title: 'Booked',
      subtitle: 'Demo payment completed. Your order is saved locally.',
      orderNo: 'Order No.',
      service: 'Service',
      arrival: 'Arrival',
      address: 'Store Address',
      paidDeposit: 'Paid Deposit',
      viewOrders: 'View Orders',
      home: 'Home'
    }
  },
  me: {
    zh: {
      title: '我的',
      growth: '会员成长值',
      growthNote: '会员等级进度',
      points: '积分',
      coupons: '优惠券',
      balance: '储值余额',
      totalSpent: '累计消费',
      visits: '到店',
      times: '次',
      orders: '我的订单',
      recent: '最近消费',
      functions: '常用功能',
      assets: '我的资产',
      assetsDesc: '优惠券、积分、储值卡',
      store: '门店与客服',
      storeDesc: '地址、电话、营业时间',
      couponsDesc: '3 张可用',
      giftCard: '礼品卡',
      later: '后续功能',
      pointsMall: '积分商城',
      comingSoon: '即将开放',
      settings: '设置',
      demoOnly: '演示版占位',
      paidDeposit: '实付定金'
    },
    en: {
      title: 'Me',
      growth: 'Growth Value',
      growthNote: 'Member tier progress',
      points: 'Points',
      coupons: 'Coupons',
      balance: 'Balance',
      totalSpent: 'Total Spent',
      visits: 'Visits',
      times: 'times',
      orders: 'My Orders',
      recent: 'Recent Visits',
      functions: 'Tools',
      assets: 'Assets',
      assetsDesc: 'Coupons, points, stored card',
      store: 'Store & Support',
      storeDesc: 'Address, phone, hours',
      couponsDesc: '3 available',
      giftCard: 'Gift Card',
      later: 'Later',
      pointsMall: 'Points Mall',
      comingSoon: 'Coming Soon',
      settings: 'Settings',
      demoOnly: 'Demo placeholder',
      paidDeposit: 'Paid Deposit'
    }
  },
  orders: {
    zh: { title: '我的订单', paidDeposit: '实付定金', emptyTitle: '暂无订单', emptyText: '预约完成后会在这里看到记录。', book: '去预约' },
    en: { title: 'My Orders', paidDeposit: 'Paid Deposit', emptyTitle: 'No orders yet', emptyText: 'Your bookings will appear here.', book: 'Book Now' }
  },
  orderDetail: {
    zh: {
      title: '订单详情',
      orderNo: '订单编号',
      bookingInfo: '预约信息',
      arrival: '到店时间',
      duration: '服务时长',
      technician: '服务人员',
      store: '门店',
      address: '地址',
      remark: '备注',
      payment: '支付信息',
      paymentStatus: '支付状态',
      coupon: '优惠券',
      balance: '余额抵扣',
      paidDeposit: '实付定金',
      support: '联系客服',
      nav: '到店导航',
      cancel: '取消预约',
      cancelTitle: '取消预约',
      cancelContent: '确认取消该预约吗？定金规则以门店说明为准。',
      cancelled: '已取消',
      phoneMissing: '门店电话待补充',
      addressMissing: '门店地址待补充'
    },
    en: {
      title: 'Order Details',
      orderNo: 'Order No.',
      bookingInfo: 'Booking Info',
      arrival: 'Arrival',
      duration: 'Duration',
      technician: 'Technician',
      store: 'Store',
      address: 'Address',
      remark: 'Notes',
      payment: 'Payment',
      paymentStatus: 'Payment Status',
      coupon: 'Coupon',
      balance: 'Balance',
      paidDeposit: 'Paid Deposit',
      support: 'Support',
      nav: 'Navigate',
      cancel: 'Cancel',
      cancelTitle: 'Cancel Booking',
      cancelContent: 'Cancel this booking? Deposit rules follow store policy.',
      cancelled: 'Cancelled',
      phoneMissing: 'Store phone pending',
      addressMissing: 'Store address pending'
    }
  },
  assets: {
    zh: { title: '我的资产', balance: '储值余额', points: '积分', pointsHint: '积分商城后续接入', coupons: '优惠券', couponsHint: '含新人体验券', giftCard: '礼品卡', later: '后续功能', noGift: '暂无礼品卡', giftHint: '真实售卖功能可在下一阶段接入。' },
    en: { title: 'Assets', balance: 'Stored Balance', points: 'Points', pointsHint: 'Points mall later', coupons: 'Coupons', couponsHint: 'Includes new guest coupon', giftCard: 'Gift Card', later: 'Later', noGift: 'No gift card', giftHint: 'Gift card sales can be added later.' }
  },
  store: {
    zh: { title: '门店信息', address: '地址', phone: '电话', hours: '营业时间', nav: '一键导航', call: '拨打电话', copy: '复制地址', map: '地图占位', mapHint: '补充真实经纬度后可替换为 map 组件', copied: '已复制地址', phoneMissing: '门店电话待补充', addressMissing: '门店地址待补充' },
    en: { title: 'Store Info', address: 'Address', phone: 'Phone', hours: 'Hours', nav: 'Navigate', call: 'Call', copy: 'Copy Address', map: 'Map Placeholder', mapHint: 'Add coordinates later to enable map component', copied: 'Address copied', phoneMissing: 'Store phone pending', addressMissing: 'Store address pending' }
  }
}

const serviceText = {
  'nail-french-01': {
    en: { category: 'French', name: 'Classic Cream French', description: 'Soft cream base with fine French tips for daily elegance.', suitableFor: 'Guests who prefer clean, refined, lengthening styles.', process: ['Shape refinement', 'Basic care', 'Base color', 'French linework', 'Top coat'], notice: ['Avoid trimming nails too short before service', 'Select removal add-on if needed'], imageLabel: 'Nail · French' }
  },
  'nail-luxe-01': {
    en: { category: 'Luxe Design', name: 'Soft Gold Shell Design', description: 'Shell accents and soft gold lines with a polished luxe feel.', suitableFor: 'Guests wanting subtle highlights without heavy decoration.', process: ['Nail care', 'Base color', 'Shell placement', 'Gold accents', 'Strengthening top coat'], notice: ['Detailed designs require more service time'], imageLabel: 'Nail · Luxe' }
  },
  'nail-jp-01': {
    en: { category: 'Japanese', name: 'Japanese Shimmer Gradient', description: 'Fine shimmer gradient with a gentle brightening effect.', suitableFor: 'Guests who like natural, clean, complexion-friendly styles.', process: ['Hand cleansing', 'Shape adjustment', 'Gradient color', 'Fine shimmer', 'Top coat'], notice: ['Gradient shade can be adjusted in store'], imageLabel: 'Nail · Japanese' }
  },
  'nail-care-01': {
    en: { category: 'Basic Care', name: 'Basic Hand Care', description: 'Shape, cuticle care, and nourishing finish for regular maintenance.', suitableFor: 'Guests who need a quick hand and nail refresh.', process: ['Cleanse', 'Shape', 'Softening care', 'Cuticle care', 'Nourishing oil'], notice: ['This service does not include gel color'], imageLabel: 'Nail · Care' }
  },
  'nail-addon-01': {
    en: { category: 'Add-ons', name: 'Removal & Nail Repair', description: 'Gentle removal with basic nail surface repair.', suitableFor: 'Guests with existing gel or extensions.', process: ['Assess old set', 'Gentle removal', 'Surface buffing', 'Nourishing care'], notice: ['Thick extensions may require extra time'], imageLabel: 'Nail · Add-on' }
  },
  'lash-natural-01': {
    en: { category: 'Natural', name: 'Bare Natural Lashes', description: 'Light and natural lashes that enhance the eyes softly.', suitableFor: 'First-time lash guests or natural makeup lovers.', process: ['Eye shape consultation', 'Cleanse and isolate', 'Lash application', 'Comb and set', 'Care guide'], notice: ['Avoid water and steam for 6 hours after service'], imageLabel: 'Lash · Natural' }
  },
  'lash-volume-01': {
    en: { category: 'Volume', name: 'Light Volume Lashes', description: 'Comfortable volume with more presence for photos and events.', suitableFor: 'Guests wanting a stronger eye look without heaviness.', process: ['Eye design', 'Layered application', 'Density adjustment', 'Final check', 'Care guide'], notice: ['Please note sensitivity before service'], imageLabel: 'Lash · Volume' }
  },
  'lash-lower-01': {
    en: { category: 'Lower Lash', name: 'Lower Lash Detail', description: 'Adds lower-eye definition for a more complete look.', suitableFor: 'Guests wanting more eye dimension and makeup finish.', process: ['Lower lash assessment', 'Cleanse', 'Detailed application', 'Set and comb'], notice: ['Lower lashes usually have a shorter retention cycle'], imageLabel: 'Lash · Lower' }
  },
  'lash-remove-01': {
    en: { category: 'Removal Care', name: 'Lash Removal Care', description: 'Gentle removal of old lashes with cleansing care.', suitableFor: 'Guests who need removal or redesign.', process: ['Check old lashes', 'Removal', 'Eye-area cleanse', 'Care suggestions'], notice: ['Do not pull old lashes by yourself'], imageLabel: 'Lash · Removal' }
  }
}

const categoryMap = {
  zh: {
    '热门推荐': '热门推荐',
    '法式系列': '法式系列',
    '轻奢设计': '轻奢设计',
    '日式款': '日式款',
    '基础护理': '基础护理',
    '加项服务': '加项服务',
    '自然款': '自然款',
    '浓密款': '浓密款',
    '下睫毛': '下睫毛',
    '卸除护理': '卸除护理'
  },
  en: {
    '热门推荐': 'Popular',
    '法式系列': 'French',
    '轻奢设计': 'Luxe',
    '日式款': 'Japanese',
    '基础护理': 'Care',
    '加项服务': 'Add-ons',
    '自然款': 'Natural',
    '浓密款': 'Volume',
    '下睫毛': 'Lower Lash',
    '卸除护理': 'Removal'
  }
}

const addOnText = {
  remove: { en: 'Removal' },
  reinforce: { en: 'Nail Strengthening' },
  senior: { en: 'Senior Technician' },
  extend: { en: 'Extra Time' }
}

function getLang() {
  return wx.getStorageSync(LANG_KEY) || 'zh'
}

function setLang(lang) {
  wx.setStorageSync(LANG_KEY, lang)
  applyTabBar(lang)
}

function pageCopy(page, lang) {
  return Object.assign({}, copy.common[lang], copy[page] ? copy[page][lang] : {})
}

function applyTabBar(lang = getLang()) {
  const labels = lang === 'en'
    ? ['Home', 'Services', 'Cart', 'Me']
    : ['首页', '服务', '购物车', '我的']
  labels.forEach((text, index) => {
    try {
      wx.setTabBarItem({ index, text })
    } catch (error) {
      // Some tool states call this before the tab bar is ready.
    }
  })
}

function setTitle(title) {
  wx.setNavigationBarTitle({ title })
}

function statusText(status, lang = getLang()) {
  const t = copy.common[lang]
  const map = {
    pending_service: t.statusPendingService,
    completed: t.statusCompleted,
    cancelled: t.statusCancelled,
    after_sales: t.statusAfterSales,
    pending_payment: t.statusPendingPayment
  }
  return map[status] || t.statusPendingPayment
}

function localizeService(service, lang = getLang()) {
  if (!service) return service
  if (lang === 'zh') return Object.assign({}, service)
  const localized = serviceText[service._id] && serviceText[service._id].en
  if (!localized) return Object.assign({}, service)
  return Object.assign({}, service, localized)
}

function localizeServices(services, lang = getLang()) {
  return services.map((item) => localizeService(item, lang))
}

function categories(categoryKeys, lang = getLang()) {
  return categoryKeys.map((key) => ({
    key,
    label: categoryMap[lang][key] || key
  }))
}

function localizeAddOns(addOns, lang = getLang()) {
  return addOns.map((item) => Object.assign({}, item, {
    name: lang === 'en' && addOnText[item.id] ? addOnText[item.id].en : item.name
  }))
}

function localizeStore(store, lang = getLang()) {
  if (lang === 'zh') return store
  return Object.assign({}, store, {
    address: store.address === '门店地址待补充' ? 'Store address pending' : store.address,
    phone: store.phone === '门店电话待补充' ? 'Store phone pending' : store.phone,
    businessHours: store.businessHours === '营业时间待补充' ? 'Business hours pending' : store.businessHours,
    description: 'A refined nail and lash atelier. Store details are placeholders in this demo.'
  })
}

module.exports = {
  getLang,
  setLang,
  pageCopy,
  applyTabBar,
  setTitle,
  statusText,
  localizeService,
  localizeServices,
  categories,
  localizeAddOns,
  localizeStore
}
