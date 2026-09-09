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

/* 裁 #25 之三:组件也要吃档位。页面那边由 app.js 包 `Page` 统一挂,
   组件不走 `Page`,所以这里在 attached 时自己取一次;`update()` 每次切页也会被调,顺手再取一次。
   取的是**同一个出口** `utils/theme.js`(一件事一处真相),不自己读 storage。 */
const { themeClass } = require('../utils/theme')

Component({
  data: {
    selected: 0,
    list: labels.zh,
    themeClass: ''
  },

  lifetimes: {
    attached() {
      this.setData({ themeClass: themeClass() })
      this.update(this.data.selected)
    }
  },

  methods: {
    update(selected = 0) {
      /* 每次切页都重取档位:从「我的」改完档位切回来,这一条要立刻跟着变 */
      const cls = themeClass()
      if (this.data.themeClass !== cls) this.setData({ themeClass: cls })
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
