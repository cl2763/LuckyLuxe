const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')
const tenant = () => wx.getStorageSync('lucky_tenant') || ''
Page({
  data: { profile: { acquisitionSource: '', originalJoinedDate: '' }, rows: [], pending: [], page: 0, hasMore: false, loading: true, saving: false, error: '' },
  onLoad(q) { this.userId = q.userId || ''; this.tenantId = tenant(); this.requestVersion = 0 },
  async onShow() { this.visible = true; this.setData({ saving: false }); if (await api.guardOwner()) this.load(this.data.page) },
  onHide() { this.visible = false; this.requestVersion++ },
  onUnload() { this.visible = false; this.requestVersion++ },
  valid(version) { return this.visible && version === this.requestVersion && tenant() === this.tenantId },
  async load(page) {
    if (!this.userId || tenant() !== this.tenantId) {
      this.setData({ profile: {}, rows: [], pending: [], loading: false, error: '顾客或门店已变化，请返回客户档案重新进入。' }); return
    }
    const version = ++this.requestVersion
    this.setData({ loading: true, error: '' })
    try {
      const d = await api.adminGet('/admin/customers/' + encodeURIComponent(this.userId) + '/migration-archive?page=' + page)
      if (!this.valid(version)) return
      const rows = [
        ...d.records.map(r => ({ id: 'record:' + r.id, title: '原系统资料 · ' + r.sourceRecordId, text: JSON.stringify(r.source, null, 2) })),
        ...d.transactions.map(r => ({ id: 'transaction:' + r.id, title: (r.date || '日期未知') + ' · ' + (r.summary || '历史消费'), text: JSON.stringify(r.details, null, 2) })),
        ...d.assets.map(r => ({ id: 'asset:' + r.id, giftId: r.kind === 'gift' ? r.id : '', title: (r.kind === 'gift' ? '旧赠品' : '旧资产') + ' · ' + (r.title || '未命名') + '（原始资料）', text: JSON.stringify(r.details, null, 2) }))
      ]
      this.setData({ ...(this.dirty ? {} : { profile: d.profile }), rows, pending: d.pendingBalances.map(b => ({ ...b, amountText: storeMoney(b.amountCents, 2) })), page, hasMore: d.hasMore })
    } catch (e) { if (this.valid(version)) this.setData({ error: e.message || '读取失败，请重试' }) }
    finally { if (this.valid(version)) this.setData({ loading: false }) }
  },
  source(e) { this.dirty = true; this.setData({ 'profile.acquisitionSource': e.detail.value }) },
  date(e) { this.dirty = true; this.setData({ 'profile.originalJoinedDate': e.detail.value }) },
  clearDate() { this.dirty = true; this.setData({ 'profile.originalJoinedDate': '' }) },
  async save() {
    if (this.data.saving || this.data.loading || !this.userId || tenant() !== this.tenantId) return
    const version = this.requestVersion, profile = { ...this.data.profile }
    this.setData({ saving: true, error: '' })
    try {
      await api.adminPatch('/admin/customers/' + encodeURIComponent(this.userId) + '/migration-profile', profile)
      if (!this.valid(version)) return
      if (JSON.stringify(profile) === JSON.stringify(this.data.profile)) this.dirty = false
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) { if (this.valid(version)) this.setData({ error: e.message || '保存失败' }) }
    finally { if (this.visible) this.setData({ saving: false }) }
  },
  reviewService(e) { require('../../../utils/nav').to('/pages/merchant/migration-service/index?userId='+encodeURIComponent(this.userId)+'&assetId='+encodeURIComponent(e.currentTarget.dataset.id)) },
  reviewGift(e) { require('../../../utils/nav').to('/pages/merchant/migration-gift/index?userId='+encodeURIComponent(this.userId)+'&assetId='+encodeURIComponent(e.currentTarget.dataset.id)) },
  reconcile(e) { require('../../../utils/nav').to('/pages/merchant/migration-reconciliation/index?userId='+encodeURIComponent(this.userId)+'&pendingId='+encodeURIComponent(e.currentTarget.dataset.id)) },
  review(e) { require('../../../utils/nav').to('/pages/merchant/migration-balance/index?userId='+encodeURIComponent(this.userId)+'&pendingId='+encodeURIComponent(e.currentTarget.dataset.id)) },
  toggle(e) { this.setData({ rows: this.data.rows.map(r => r.id === e.currentTarget.dataset.id ? { ...r, open: !r.open } : r) }) },
  prev() { if (this.data.page && !this.data.loading && !this.data.saving) this.load(this.data.page - 1) },
  next() { if (this.data.hasMore && !this.data.loading && !this.data.saving) this.load(this.data.page + 1) },
  retry() { if (!this.data.saving) this.load(this.data.page) }
})
