const ROUTES = {
  home: '/pages/merchant/home/index',
  orders: '/pages/merchant/orders/index',
  workbench: '/pages/merchant/workbench/index',
  gallery: '/pages/merchant/gallery/index',
  manage: '/pages/merchant/manage/index'
}
// 已实现的商家页(其余点了给"开发中"提示)
const BUILT = { home: true, orders: true, workbench: true, gallery: true, manage: true }

/* 档位从同一个出口取(utils/theme.js),组件不自己读 storage */
const { themeClass } = require('../../utils/theme')

Component({
  properties: {
    active: { type: String, value: 'home' }
  },
  data: { themeClass: '' },
  /* 组件不走 `Page`,所以 app.js 那层包不到它 —— 自己在 attached / 每次显示时取一次。
     `pageLifetimes.show` 保证「从『我的』改完档位切回来」这一条也跟着变。 */
  lifetimes: { attached() { this.setData({ themeClass: themeClass() }) } },
  pageLifetimes: {
    show() {
      const cls = themeClass()
      if (this.data.themeClass !== cls) this.setData({ themeClass: cls })
    },
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
