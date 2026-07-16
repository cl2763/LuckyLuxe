const ROUTES = {
  home: '/pages/merchant/home/index',
  orders: '/pages/merchant/orders/index',
  workbench: '/pages/merchant/workbench/index',
  gallery: '/pages/merchant/gallery/index',
  manage: '/pages/merchant/manage/index'
}
// 已实现的商家页(其余点了给"开发中"提示)
const BUILT = { home: true, orders: true, workbench: true, gallery: true, manage: true }

Component({
  properties: {
    active: { type: String, value: 'home' }
  },
  methods: {
    go(e) {
      const key = e.currentTarget.dataset.key
      if (key === this.data.active) return
      if (!BUILT[key]) {
        wx.showToast({ title: '该模块开发中', icon: 'none' })
        return
      }
      wx.redirectTo({ url: ROUTES[key] })
    }
  }
})
