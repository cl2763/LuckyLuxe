/* P3 通知与回访设置(店主 2026-08-30g 件3)—— 与网页端同两口:
   GET/PUT /admin/notify/rules · GET /admin/notify/queue(一份数据两端渲染;仅老板)。
   通道现阶段只有「站内/记录」:记录列表就是送达面(微信订阅/短信等 ICP,实装另批)。 */
const api = require('../../../utils/api')

const STATUS_ZH = { PENDING: '待发', SENT: '已发', FAILED: '失败', CANCELLED: '已撤' }
const FILTERS = [
  { v: '', t: '全部' }, { v: 'PENDING', t: '待发' }, { v: 'SENT', t: '已发' },
  { v: 'FAILED', t: '失败' }, { v: 'CANCELLED', t: '已撤' }
]

Page({
  data: { rules: [], tasks: [], filters: FILTERS, filter: '', loading: true, saving: false },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    try {
      const [r, q] = await Promise.all([api.adminGet('/admin/notify/rules'), this.fetchQueue()])
      this.setData({ rules: r.rules || [], tasks: q, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  async fetchQueue() {
    const f = this.data ? this.data.filter : ''
    const q = await api.adminGet(`/admin/notify/queue${f ? `?status=${f}` : ''}`)
    return (q.tasks || []).map((t) => ({
      ...t,
      statusZh: STATUS_ZH[t.status] || t.status,
      statusCls: String(t.status || '').toLowerCase(),
      whenText: String(t.scheduledAt || '').slice(0, 16).replace('T', ' ')
    }))
  },

  onToggle(e) {
    const { type } = e.currentTarget.dataset
    const rules = this.data.rules.map((r) => r.type === type ? { ...r, enabled: e.detail.value } : r)
    this.setData({ rules })
  },

  onNum(e) {
    const { type, field } = e.currentTarget.dataset
    const rules = this.data.rules.map((r) => r.type === type ? { ...r, [field]: e.detail.value } : r)
    this.setData({ rules })
  },

  async save() {
    if (this.data.saving) return   // 双击双发拦(D88 同族)
    this.setData({ saving: true })
    try {
      const rules = this.data.rules.map((r) => ({
        type: r.type, enabled: r.enabled !== false,
        offsetMinutes: Number(r.offsetMinutes), advanceDays: Number(r.advanceDays), revisitDays: Number(r.revisitDays)
      }))
      const resp = await api.adminPut('/admin/notify/rules', { rules })
      this.setData({ rules: resp.rules || [], saving: false })
      wx.showToast({ title: '通知设置已保存', icon: 'none' })
    } catch (e) {
      this.setData({ saving: false })
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
    }
  },

  async pickFilter(e) {
    this.setData({ filter: FILTERS[Number(e.detail.value)].v })
    try { this.setData({ tasks: await this.fetchQueue() }) } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  }
})
