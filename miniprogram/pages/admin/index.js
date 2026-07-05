const api = require('../../utils/api')
const i18n = require('../../utils/i18n')

function isToday(dateText) {
  const today = new Date()
  const value = new Date(`${dateText}T00:00:00`)
  return value.getFullYear() === today.getFullYear() && value.getMonth() === today.getMonth() && value.getDate() === today.getDate()
}

Page({
  data: {
    lang: 'zh',
    panel: 'today',
    panelTitle: '订单管理',
    roleLabel: 'OWNER',
    isOwner: false,
    metrics: { today: 0, active: 0, galleryReview: 0, services: 0 },
    bookings: [],
    visibleBookings: [],
    technicians: [],
    technicianRows: [],
    services: [],
    customers: []
  },

  onShow() {
    const lang = i18n.getLang()
    this.setData({ lang })
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Lucky Luxe Admin' : 'Lucky Luxe 后台' })
    this.refresh()
  },

  async refresh() {
    if (!api.getAdminAuth()) {
      wx.redirectTo({ url: '/pages/admin-login/index' })
      return
    }
    try {
      const data = await api.getAdminDashboardData()
      const role = data.admin.role || 'staff'
      const bookings = (data.bookings || []).map((item) => Object.assign({}, item, {
        appointmentDate: item.appointmentDate || (item.appointmentStart || '').slice(0, 10),
        appointmentTime: item.appointmentTime || (item.appointmentStart || '').slice(11, 16),
        service: item.service || {},
        technician: item.technician || {},
        user: item.user || {}
      }))
      const active = bookings.filter((item) => ['PENDING_PAYMENT', 'CONFIRMED'].indexOf(item.status) >= 0)
      const galleryReview = bookings.filter((item) => item.galleryStatus && item.galleryStatus !== 'approved')
      const technicianRows = (data.technicians || []).map((tech) => {
        const techBookings = bookings.filter((item) => item.technician && item.technician.id === tech.id)
        const revenue = techBookings.reduce((total, item) => total + Math.round((item.servicePriceCents || item.servicePrice || 0) / (item.servicePriceCents ? 100 : 1)), 0)
        return Object.assign({}, tech, { count: techBookings.length, revenue })
      })
      this.setData({
        roleLabel: role === 'owner' ? 'OWNER' : 'STAFF',
        isOwner: role === 'owner',
        bookings,
        technicians: data.technicians || [],
        technicianRows,
        services: data.services || [],
        customers: data.customers || [],
        metrics: {
          today: bookings.filter((item) => isToday(item.appointmentDate)).length,
          active: active.length,
          galleryReview: galleryReview.length,
          services: data.services ? data.services.length : active.length
        }
      })
      this.updateVisible()
    } catch (error) {
      api.clearAdminAuth()
      wx.showToast({ title: error.message || '后台登录已失效', icon: 'none' })
      wx.redirectTo({ url: '/pages/admin-login/index' })
    }
  },

  switchPanel(event) {
    this.setData({ panel: event.currentTarget.dataset.panel || 'today' })
    this.updateVisible()
  },

  updateVisible() {
    const lang = this.data.lang
    const titles = {
      today: lang === 'en' ? 'Today Orders' : '今日订单',
      active: lang === 'en' ? 'Active Orders' : '待处理订单',
      gallery: lang === 'en' ? 'Gallery Review' : '图库待确认',
      schedule: lang === 'en' ? 'Technician Performance' : '技师业绩',
      services: lang === 'en' ? 'Service Management' : '服务管理',
      customers: lang === 'en' ? 'Customer Profiles' : '客户档案'
    }
    let visibleBookings = []
    if (this.data.panel === 'today') visibleBookings = this.data.bookings.filter((item) => isToday(item.appointmentDate))
    if (this.data.panel === 'active') visibleBookings = this.data.bookings.filter((item) => ['PENDING_PAYMENT', 'CONFIRMED'].indexOf(item.status) >= 0)
    if (this.data.panel === 'gallery') visibleBookings = this.data.bookings.filter((item) => item.galleryStatus && item.galleryStatus !== 'approved')
    this.setData({
      panelTitle: titles[this.data.panel] || titles.today,
      visibleBookings
    })
  },

  logout() {
    api.clearAdminAuth()
    wx.redirectTo({ url: '/pages/admin-login/index' })
  }
})
