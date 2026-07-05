const labels = {
  zh: [
    { pagePath: '/pages/home/index', text: '首页' },
    { pagePath: '/pages/services/index', text: '服务' },
    { pagePath: '/pages/cart/index', text: '购物车' },
    { pagePath: '/pages/me/index', text: '我的' }
  ],
  en: [
    { pagePath: '/pages/home/index', text: 'Home' },
    { pagePath: '/pages/services/index', text: 'Services' },
    { pagePath: '/pages/cart/index', text: 'Cart' },
    { pagePath: '/pages/me/index', text: 'Me' }
  ]
}

Component({
  data: {
    selected: 0,
    list: labels.zh
  },

  lifetimes: {
    attached() {
      this.update(this.data.selected)
    }
  },

  methods: {
    update(selected = 0) {
      const lang = wx.getStorageSync('lucky_lang') || 'zh'
      const cart = wx.getStorageSync('lucky_cart') || []
      const list = labels[lang].map((item, index) => Object.assign({}, item, {
        badge: index === 2 && cart.length ? (cart.length > 99 ? '99+' : String(cart.length)) : ''
      }))
      this.setData({ selected, list })
    },

    switchTab(event) {
      const index = event.currentTarget.dataset.index
      const path = event.currentTarget.dataset.path
      this.setData({ selected: index })
      wx.switchTab({ url: path })
    }
  }
})
