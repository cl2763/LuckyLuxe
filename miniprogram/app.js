const i18n = require('./utils/i18n')

App({
  globalData: {
    appName: 'Lucky Luxe',
    version: '0.1.0-demo'
  },

  onLaunch() {
    i18n.applyTabBar()

    const member = wx.getStorageSync('lucky_member') || {}
    wx.setStorageSync('lucky_member', Object.assign({}, member, {
      avatarUrl: '',
      nickname: 'Sophia Chen',
      memberLevel: 'Gold Member',
      growthValue: 2680,
      nextLevelValue: 5000,
      visits: 8,
      totalSpent: 1868,
      points: 1280,
      couponCount: 3,
      balance: 300
    }))

    const orders = wx.getStorageSync('lucky_orders') || []
    const now = Date.now()
    const demoOrders = [
      {
        _id: 'demo_pending_order',
        orderNo: 'LLDEMO2026052001',
        items: [{ type: 'service', serviceId: 'nail-luxe-01', name: '柔金贝母设计', price: 238, quantity: 1 }],
        serviceInfo: { serviceId: 'nail-luxe-01', serviceName: '柔金贝母设计', serviceType: 'nail', duration: 120, depositAmount: 50, technicianName: 'Mia Chen' },
        appointment: { date: '2026-05-20', time: '14:30', addOns: ['senior'], referenceImages: [], remark: '偏自然一点，想要柔和金色。' },
        store: { storeName: 'Lucky Luxe', address: '门店地址待补充', phone: '门店电话待补充', businessHours: '营业时间待补充' },
        couponId: 'demo_coupon_20',
        couponDiscount: 0,
        balanceDeduction: 0,
        payableAmount: 50,
        remark: '',
        status: 'pending_service',
        paymentStatus: 'paid',
        transactionId: 'mock_demo_pending',
        createdAt: now - 86400000,
        updatedAt: now - 86400000
      },
      {
        _id: 'demo_completed_order',
        orderNo: 'LLDEMO2026041801',
        items: [{ type: 'service', serviceId: 'lash-natural-01', name: '裸感自然睫', price: 198, quantity: 1 }],
        serviceInfo: { serviceId: 'lash-natural-01', serviceName: '裸感自然睫', serviceType: 'lash', duration: 90, depositAmount: 50, technicianName: 'Ava Lin' },
        appointment: { date: '2026-04-18', time: '11:00', addOns: [], referenceImages: [], remark: '第一次尝试，想要自然款。' },
        store: { storeName: 'Lucky Luxe', address: '门店地址待补充', phone: '门店电话待补充', businessHours: '营业时间待补充' },
        couponId: '',
        couponDiscount: 0,
        balanceDeduction: 0,
        payableAmount: 50,
        remark: '',
        status: 'completed',
        paymentStatus: 'paid',
        transactionId: 'mock_demo_completed',
        createdAt: now - 2592000000,
        updatedAt: now - 2592000000
      }
    ]
    const normalizedOrders = orders.map((item) => Object.assign({}, item, {
      serviceInfo: Object.assign({}, item.serviceInfo, { depositAmount: 50 }),
      couponDiscount: 0,
      balanceDeduction: 0,
      payableAmount: 50
    }))
    const existingIds = normalizedOrders.map((item) => item._id)
    const missingDemoOrders = demoOrders.filter((item) => existingIds.indexOf(item._id) < 0)
    wx.setStorageSync('lucky_orders', missingDemoOrders.concat(normalizedOrders))
  }
})
