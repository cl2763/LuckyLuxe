const api = require('../../../utils/api')
Page({
  data: { userId: '', customerName: '', profile: null, notes: [], loading: true,
    /* 签署文件留档(10b 第一步 · 双端同批律:网页商家端有,这儿就得同一批有)。
       🔴 `docsEmptyText`/`docsEmptyHint`/每行的 `statusText` 全部由后端下发,页面一句都不拼。 */
    docs: [], docsEmptyText: '', docsEmptyHint: '', docsMoreText: '', docTypes: [],
    uploading: false, pickedType: 'rights', pickedTitle: '', pickedVisible: true, shots: [] },
  onLoad(q) {
    this.setData({ userId: q.userId || '', customerName: q.name ? decodeURIComponent(q.name) : '顾客' })
  },
  async onShow() {
    if (!api.guardMerchant()) return // 门禁:未登录/会话失效不渲染空壳,直接回登录页
    if (this.data.userId) this.load()
  },
  async load() {
    try {
      const r = await api.getCustomerNotes(this.data.userId)
      const p = r.profile || {}
      this.setData({
        loading: false,
        customerName: r.customerName || this.data.customerName,
        profile: {
          visitCount: p.visitCount || 0,
          avgIntervalDays: p.avgIntervalDays,
          topService: p.topService || '—',
          styles: p.styles || [], personality: p.personality || [], preferences: p.preferences || [],
          companions: p.companions || [], safetyFlags: p.safetyFlags || []
        },
        notes: r.notes || []
      })
    } catch (e) { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }) }
  },
  /* ── 签署文件:读 ─────────────────────────────────────────── */
  async loadDocs() {
    try {
      const r = await api.getSignedDocs(this.data.userId)
      this.setData({
        docs: r.docs || [], docTypes: r.types || [],
        docsEmptyText: r.emptyText || '', docsEmptyHint: r.emptyHint || '', docsMoreText: r.moreText || ''
      })
    } catch (e) { wx.showToast({ title: (e && e.message) || '签署文件加载失败', icon: 'none' }) }
  },
  /* ── 签署文件:传(屏2 先定类型,屏3 再拍;一份可多页)───────── */
  openUpload() { this.setData({ uploading: true, pickedType: 'rights', pickedTitle: '', pickedVisible: true, shots: [] }) },
  closeUpload() { this.setData({ uploading: false }) },
  pickType(e) {
    const key = e.currentTarget.dataset.key
    const t = (this.data.docTypes || []).find((x) => x.key === key)
    /* 图 v2:换类型,「给顾客看」回到该类型的默认值(其他 = 默认不给看) */
    this.setData({ pickedType: key, pickedVisible: t ? !!t.customerVisible : key !== 'other' })
  },
  onTitle(e) { this.setData({ pickedTitle: e.detail.value }) },
  onVisible(e) { this.setData({ pickedVisible: !!e.detail.value }) },
  addShots() {
    const left = 20 - this.data.shots.length
    if (left <= 0) { wx.showToast({ title: '一份最多 20 页', icon: 'none' }); return }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: async (res) => {
        const fs = wx.getFileSystemManager()
        const datas = await Promise.all(res.tempFiles.map((f) => new Promise((resolve) => {
          fs.readFile({ filePath: f.tempFilePath, encoding: 'base64', success: (r) => resolve('data:image/jpeg;base64,' + r.data), fail: () => resolve('') })
        })))
        this.setData({ shots: this.data.shots.concat(datas.filter(Boolean)).slice(0, 20) })
      },
      fail: (e) => { if (!/cancel/.test(String(e && e.errMsg))) wx.showToast({ title: '选图失败', icon: 'none' }) }
    })
  },
  /* 图屏3 标题栏的「重拍」:点哪一页撤哪一页,重新拍进来
     (两端都把屏2/屏3 合成了一个半屏,差异已写进本批差异说明) */
  redoShot(e) {
    const i = Number(e.currentTarget.dataset.i)
    const shots = this.data.shots.slice(); shots.splice(i, 1)
    this.setData({ shots })
  },
  async saveDoc() {
    if (!this.data.shots.length) { wx.showToast({ title: '至少要拍一页', icon: 'none' }); return }
    /* 前端问一句只是体验 —— 后端才是最终闸(判据五),那边同样拦 */
    if (this.data.pickedType === 'other' && !String(this.data.pickedTitle).trim()) {
      wx.showToast({ title: '「其他」要自己写个名字', icon: 'none' }); return
    }
    try {
      await api.createSignedDoc(this.data.userId, {
        docType: this.data.pickedType, title: String(this.data.pickedTitle).trim(),
        pages: this.data.shots, customerVisible: this.data.pickedVisible
      })
      this.setData({ uploading: false, shots: [] })
      wx.showToast({ title: '存好了' })
      this.loadDocs()
    } catch (e) { wx.showToast({ title: (e && e.message) || '没存上', icon: 'none' }) }
  },
  /* ── 签署文件:作废(🔴 没有删除,一个都没有)────────────── */
  openDoc(e) {
    const id = e.currentTarget.dataset.id
    const doc = (this.data.docs || []).find((d) => d.id === id)
    if (!doc || doc.status === 'voided') return
    wx.showModal({
      title: '标为作废', editable: true, placeholderText: '为什么作废?(必填,会连同你的名字一起记下来)',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.voidSignedDoc(id, String(r.content || '').trim())
          wx.showToast({ title: '已标为作废,原件还在' })
          this.loadDocs()
        } catch (err) { wx.showToast({ title: (err && err.message) || '没作废成', icon: 'none' }) }
      },
      fail: () => wx.showToast({ title: '打不开对话框', icon: 'none' })   // 波及面回归律④:wx.* 一律有 fail
    })
  },
  addNote() {
    wx.navigateTo({ url: `/pages/merchant/service-note/index?userId=${this.data.userId}&name=${encodeURIComponent(this.data.customerName)}` })
  }
})
