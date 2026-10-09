const api = require('../../utils/api')
const i18n = require('../../utils/i18n')
const { albumsOf, moveAlbum, previewOf } = require('./navigation')

// 品类展示名(未知类型回退原始值,后端将来加新品类这里不改也能显示)
const TYPE_LABELS = {
  NAIL: { zh: '美甲', en: 'Nail' },
  LASH: { zh: '美睫', en: 'Lash' },
  FACIAL: { zh: '美容', en: 'Facial' },
  BROW: { zh: '纹绣', en: 'Brow' },
  SPA: { zh: '水疗', en: 'Spa' }, CARE: { zh: '护理', en: 'Care' }
}

function typeLabel(type, lang) {
  const hit = TYPE_LABELS[String(type || '').toUpperCase()]
  if (hit) return lang === 'en' ? hit.en : hit.zh
  return String(type || '')
}

Page({
  data: {
    loading: true, loadError: '', preview: null, previewLoading: false, previewError: false,
    lang: 'zh',
    works: [],          // 全量作品(平铺,带品类+技师)
    techs: [],          // 顶部技师头像条
    chips: [],          // 品类筛选(该店实际有作品的品类;<2 个时整栏隐藏)
    activeTech: '',     // '' = 全店
    activeType: '',     // '' = 全部品类
    albums: [], previewIndex: 0, previewTotal: 0,
    empty: false,
    t: { title: '本店作品', all: '全部', allShop: '全店', emptyText: '暂无该筛选下的作品' }
  },

  onLoad() {},

  onShow() {
    this.refresh()
  },

  async refresh() {
    if (this._loading) return
    this._loading = true
    this.setData({ loading: true, loadError: '' })
    const lang = i18n.getLang()
    const t = lang === 'en'
      ? { title: 'Our Work', all: 'All', allShop: 'All', emptyText: 'No works under this filter yet' }
      : { title: '本店作品', all: '全部', allShop: '全店', emptyText: '暂无该筛选下的作品' }
    wx.setNavigationBarTitle({ title: t.title })
    let works, categories
    try { ({ works, categories } = await api.getPortfolioWall()) }
    catch (error) { this.setData({ loading: false, loadError: lang === 'en' ? 'Could not load work. Tap to retry.' : '作品加载失败，点击重试' }); this._loading = false; return }
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
    this._loading = false
    this.setData({ loading: false, lang, t, works: decorated, techs, chips, activeTech: '', activeType: '' })
    this.applyFilter()
  },

  applyFilter() {
    const { works, activeTech, activeType } = this.data
    const filtered = works.filter((w) =>
      (!activeTech || (w.technician && w.technician.id === activeTech)) &&
      (!activeType || w.serviceType === activeType)
    )
    this._filtered = filtered
    this.setData({ albums: albumsOf(filtered), empty: !filtered.length })
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
    wx.showActionSheet({
      itemList: [
        lang === 'en' ? 'View photo' : '查看大图',
        lang === 'en' ? 'Book this style' : '预约同款(带图给技师)'
      ],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.openPreview(work)
        } else if (res.tapIndex === 1) {
          this.savePresetAndGo(work)
        }
      }
    })
  },

  moveThumbnails(event) {
    this.setData({ albums: moveAlbum(this.data.albums, event.currentTarget.dataset.id, Number(event.currentTarget.dataset.step)) })
  },
  movePreview(event) {
    const next = previewOf(this._filtered || [], this.data.preview, Number(event.currentTarget.dataset.step))
    if (next.work) this.setData({ preview: null }, () => this.openPreview(next.work))
  },
  openPreview(work) {
    const position = previewOf(this._filtered || [], work, 0)
    this.setData({ preview: work, previewIndex: position.index, previewTotal: position.total, previewLoading: true, previewError: false })
    clearTimeout(this._previewTimer)
    this._previewTimer = setTimeout(() => { if (this.data.previewLoading) this.setData({ previewLoading: false, previewError: true }) }, 15000)
  },
  previewLoaded() { clearTimeout(this._previewTimer); this.setData({ previewLoading: false, previewError: false }) },
  previewFailed() { clearTimeout(this._previewTimer); this.setData({ previewLoading: false, previewError: true }) },
  closePreview() { clearTimeout(this._previewTimer); this.setData({ preview: null }) },
  retryPreview() { const work = this.data.preview; this.setData({ preview: null }, () => this.openPreview(work)) },
  onUnload() { clearTimeout(this._previewTimer) },
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
