const api = require('../../utils/api')
const i18n = require('../../utils/i18n')

// 品类展示名(未知类型回退原始值,后端将来加新品类这里不改也能显示)
const TYPE_LABELS = {
  NAIL: { zh: '美甲', en: 'Nail' },
  LASH: { zh: '美睫', en: 'Lash' },
  FACIAL: { zh: '美容', en: 'Facial' },
  BROW: { zh: '纹绣', en: 'Brow' },
  SPA: { zh: 'SPA', en: 'Spa' }
}

function typeLabel(type, lang) {
  const hit = TYPE_LABELS[String(type || '').toUpperCase()]
  if (hit) return lang === 'en' ? hit.en : hit.zh
  return String(type || '')
}

Page({
  data: {
    lang: 'zh',
    works: [],          // 全量作品(平铺,带品类+技师)
    techs: [],          // 顶部技师头像条
    chips: [],          // 品类筛选(该店实际有作品的品类;<2 个时整栏隐藏)
    activeTech: '',     // '' = 全店
    activeType: '',     // '' = 全部品类
    col0: [],
    col1: [],
    empty: false,
    t: { title: '本店作品', all: '全部', allShop: '全店', emptyText: '暂无该筛选下的作品' }
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    const lang = i18n.getLang()
    const t = lang === 'en'
      ? { title: 'Our Work', all: 'All', allShop: 'All', emptyText: 'No works under this filter yet' }
      : { title: '本店作品', all: '全部', allShop: '全店', emptyText: '暂无该筛选下的作品' }
    wx.setNavigationBarTitle({ title: t.title })
    const { works, categories } = await api.getPortfolioWall()
    // 技师条:按作品数排序,徽标 = TA 的主品类 + 数量
    const byTech = new Map()
    works.forEach((w) => {
      const id = (w.technician && w.technician.id) || ''
      if (!byTech.has(id)) byTech.set(id, { id, name: (w.technician && w.technician.name) || '', count: 0, types: {} })
      const entry = byTech.get(id)
      entry.count += 1
      if (w.serviceType) entry.types[w.serviceType] = (entry.types[w.serviceType] || 0) + 1
    })
    const techs = [...byTech.values()]
      .sort((a, b) => b.count - a.count)
      .map((item) => {
        const main = Object.keys(item.types).sort((a, b) => item.types[b] - item.types[a])[0] || ''
        return {
          id: item.id,
          name: item.name,
          initial: (item.name || '?').slice(0, 1).toUpperCase(),
          count: item.count,
          badge: main ? typeLabel(main, lang) + ' ' + item.count : String(item.count)
        }
      })
    // 品类 chips:只列该店真实存在作品的品类;只有一类时整栏隐藏
    const chips = categories.length > 1
      ? categories.map((c) => ({ value: c, label: typeLabel(c, lang) }))
      : []
    const decorated = works.map((w) => Object.assign({}, w, { catLabel: typeLabel(w.serviceType, lang) }))
    this.setData({ lang, t, works: decorated, techs, chips, activeTech: '', activeType: '' })
    this.applyFilter()
  },

  applyFilter() {
    const { works, activeTech, activeType } = this.data
    const filtered = works.filter((w) =>
      (!activeTech || (w.technician && w.technician.id === activeTech)) &&
      (!activeType || w.serviceType === activeType)
    )
    const col0 = []
    const col1 = []
    filtered.forEach((w, i) => (i % 2 === 0 ? col0 : col1).push(w))
    this.setData({ col0, col1, empty: !filtered.length })
  },

  tapTech(event) {
    const id = event.currentTarget.dataset.id || ''
    this.setData({ activeTech: this.data.activeTech === id ? '' : id })
    this.applyFilter()
  },

  tapChip(event) {
    const value = event.currentTarget.dataset.value || ''
    this.setData({ activeType: this.data.activeType === value ? '' : value })
    this.applyFilter()
  },

  onWork(event) {
    const id = event.currentTarget.dataset.id
    const work = this.data.works.find((w) => w.id === id)
    if (!work) return
    const lang = this.data.lang
    const urls = this.data.col0.concat(this.data.col1).map((w) => w.image)
    wx.showActionSheet({
      itemList: [
        lang === 'en' ? 'View photo' : '查看大图',
        lang === 'en' ? 'Book this style' : '预约同款(带图给技师)'
      ],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.previewImage({ current: work.image, urls })
        } else if (res.tapIndex === 1) {
          this.savePresetAndGo(work)
        }
      }
    })
  },

  // 「同款 ›」直达:跳过动作单
  bookStyle(event) {
    const id = event.currentTarget.dataset.id
    const work = this.data.works.find((w) => w.id === id)
    if (work) this.savePresetAndGo(work)
  },

  savePresetAndGo(work) {
    wx.setStorageSync('lucky_style_preset', {
      image: work.image,
      technicianId: work.technician ? work.technician.id : '',
      technicianName: work.technician ? work.technician.name : ''
    })
    wx.showToast({ title: this.data.lang === 'en' ? 'Style saved, pick a service' : '已带上参考图,选个服务吧', icon: 'none' })
    setTimeout(() => wx.switchTab({ url: '/pages/services/index' }), 500)
  }
})
