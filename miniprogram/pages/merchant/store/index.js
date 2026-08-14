const api = require('../../../utils/api')

const DAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const ORDER = [1, 2, 3, 4, 5, 6, 0] // 周一→周日

Page({
  data: {
    storeId: '', name: '', address: '', phone: '',
    hours: [], // [{weekday,label,isClosed,openTime,closeTime}]
    specials: [],
    onlineDeposit: true,
    depositSummary: '',
    loading: true
  },

  async onShow() { if (!(await api.guardOwner())) return; this.load(); this.loadRules() },

  async loadRules() {
    try {
      const r = await api.adminGet('/admin/booking-rules')
      this.setData({ onlineDeposit: r.rules ? r.rules.onlineDeposit !== false : true })
      // 定金一律看 deposit_config(唯一口径),这里只做一行摘要
      api.adminGet('/admin/deposit-config').then((d) => {
        const c = (d && d.config) || {}
        this.setData({
          depositSummary: c.enabled === false
            ? '当前:不收定金'
            : `当前:收定金${d.amountText ? ' ' + d.amountText : ''}${c.deductible ? ' · 可抵尾款' : ' · 不抵尾款'}`
        })
      }).catch(() => {})
    } catch (e) { /* 默认开 */ }
  },

  // 线上定金开关:关=顾客自约免定金直接确认(适配无支付商户号的商家)
  // 定金细项在网页后台的「定金规则卡」里配(左配置右预览);小程序这边给个说明,避免两处开关打架
  goDepositRule() {
    wx.showModal({
      title: '定金与取消规则', showCancel: false, confirmText: '知道了',
      content: '定金收不收、多少钱、能不能抵尾款、迟到宽限与改期时限,都在网页后台「门店设置 → 定金与取消规则」里配,配完顾客预约页与 AI 话术自动跟上。',
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },


  async load() {
    try {
      const r = await api.adminGet('/admin/business-hours')
      const s = (r.stores || [])[0]
      if (!s) { this.setData({ loading: false }); return }
      const byDay = {}
      ;(s.hours || []).forEach((h) => { byDay[h.weekday] = h })
      const hours = ORDER.map((wd) => {
        const h = byDay[wd] || {}
        return {
          weekday: wd, label: DAY[wd],
          isClosed: h.isClosed === undefined ? (wd === 1 ? true : false) : h.isClosed,
          openTime: h.openTime || '10:00',
          closeTime: h.closeTime || '19:00'
        }
      })
      const specials = (s.specialDates || []).map((d) => ({
        date: d.date,
        text: d.isClosed ? '休息' : `${d.openTime}-${d.closeTime}`,
        note: d.note || ''
      }))
      this.setData({ storeId: s.id, name: s.name || '', address: s.address || '', phone: s.phone || '', hours, specials, loading: false })
    } catch (e) { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  editField(e) {
    const key = e.currentTarget.dataset.key
    const labelMap = { name: '门店名称', address: '门店地址', phone: '联系电话' }
    wx.showModal({
      title: '修改' + labelMap[key], editable: true, content: this.data[key] || '',
      placeholderText: '输入' + labelMap[key],
      success: async (r) => {
        if (!r.confirm) return
        const v = (r.content || '').trim()
        try {
          await api.adminRequest('/admin/store-info', 'PUT', { storeId: this.data.storeId, [key]: v })
          this.setData({ [key]: v }); wx.showToast({ title: '已保存', icon: 'none' })
        } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },

  toggleDay(e) {
    const i = Number(e.currentTarget.dataset.i)
    const hours = this.data.hours.slice()
    hours[i].isClosed = !hours[i].isClosed
    this.setData({ hours })
    this.saveHours()
  },

  onOpen(e) {
    const i = Number(e.currentTarget.dataset.i)
    const hours = this.data.hours.slice()
    hours[i].openTime = e.detail.value
    this.setData({ hours }); this.saveHours()
  },

  onClose(e) {
    const i = Number(e.currentTarget.dataset.i)
    const hours = this.data.hours.slice()
    hours[i].closeTime = e.detail.value
    this.setData({ hours }); this.saveHours()
  },

  async saveHours() {
    const hours = this.data.hours.map((h) => ({
      weekday: h.weekday, isClosed: h.isClosed, openTime: h.openTime, closeTime: h.closeTime
    }))
    try { await api.adminRequest('/admin/business-hours', 'PUT', { storeId: this.data.storeId, hours }) }
    catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
  },

  addSpecial() {
    wx.showModal({
      title: '新增特殊日期(休息)', editable: true, placeholderText: '格式 2026-12-25',
      success: async (r) => {
        if (!r.confirm) return
        const date = (r.content || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { wx.showToast({ title: '日期格式不对', icon: 'none' }); return }
        try {
          await api.adminPost('/admin/special-dates', { storeId: this.data.storeId, date, isClosed: true })
          wx.showToast({ title: '已添加', icon: 'none' }); this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '添加失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },

  delSpecial(e) {
    const date = e.currentTarget.dataset.date
    wx.showModal({
      title: '删除', content: `删除 ${date} 的特殊安排,恢复每周固定?`,
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.adminRequest(`/admin/special-dates/${date}?storeId=${encodeURIComponent(this.data.storeId)}`, 'DELETE')
          wx.showToast({ title: '已删除', icon: 'none' }); this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  }
})
