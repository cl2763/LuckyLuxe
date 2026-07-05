const api = require('../../utils/api')
const i18n = require('../../utils/i18n')

Page({
  data: {
    lang: 'zh',
    title: '技师作品',
    intro: '浏览每位技师已确认入库的真实作品。',
    viewWork: '查看作品',
    portfolios: [],
    selected: null
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    const title = lang === 'en' ? 'Artist Work' : '技师作品'
    wx.setNavigationBarTitle({ title })
    const portfolios = await api.getPortfolio()
    this.setData({
      lang,
      title,
      intro: lang === 'en' ? 'Browse approved finished work by each artist.' : '浏览每位技师已确认入库的真实作品。',
      viewWork: lang === 'en' ? 'View Work' : '查看作品',
      portfolios
    })
  },

  openTech(event) {
    const id = event.currentTarget.dataset.id
    const selected = this.data.portfolios.find((item) => item.technician && item.technician.id === id)
    this.setData({ selected })
    if (selected && selected.technician) wx.setNavigationBarTitle({ title: selected.technician.name })
  },

  backToList() {
    this.setData({ selected: null })
    wx.setNavigationBarTitle({ title: this.data.title })
  },

  previewImage(event) {
    const url = event.currentTarget.dataset.url
    const urls = this.data.selected
      ? this.data.selected.images
      : this.data.portfolios.reduce((all, item) => all.concat(item.images || []), [])
    wx.previewImage({ current: url, urls })
  }
})
