/* 通知与回访 —— 照《通知与回访设置图 v1.0》重做(店主 08-31 退回件;图=合同)。
   入口=门店设置页行(与网页统一);规则/记录两页签;八类两组;
   每卡四件套=开关(点即存)+参数+文案模板(变量芯片+实时预览+恢复默认)+保存;
   记录三色含失败原因。读写与网页同两口+preview(一份数据两端渲染;规则仅老板=后端闸)。 */
const api = require('../../../utils/api')

const NOTICE = '微信/短信通道开通前,所有通知先记录在「记录」页,一条不丢;通道开通后自动补发未来的、不补发历史的。'
const GROUPS = [
  { key: 'booking', title: '预约通知', note: '建议开启:预约的创建/改期/取消与到店前提醒,自动生成通知。' },
  { key: 'care', title: '关怀回访', note: '默认关,开了才扫:次卡到期、生日、定期回访、优惠券临期。' }
]
const STATUS_ZH = { SENT: '已记', PENDING: '待发', FAILED: '失败', CANCELLED: '已撤' }

Page({
  data: { tab: 'rules', notice: NOTICE, groups: GROUPS, rules: [], tasks: [], filters: [], filterIdx: 0, loading: true },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    try {
      const r = await api.adminGet('/admin/notify/rules')
      const rules = (r.rules || []).map((x) => ({ ...x, preview: '' }))
      this.setData({
        rules, loading: false,
        filters: [{ v: '', t: '全部类型' }].concat(rules.map((x) => ({ v: x.type, t: x.label })))
      })
      rules.forEach((x) => { if (x.enabled) this.refreshPreview(x.type) })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  async switchTab(e) {
    const tab = e.currentTarget.dataset.k
    if (tab === 'records') await this.loadQueue()
    this.setData({ tab })
  },

  async loadQueue() {
    try {
      const f = (this.data.filters[this.data.filterIdx] || {}).v || ''
      const q = await api.adminGet('/admin/notify/queue')
      const tasks = (q.tasks || []).filter((t) => !f || t.type === f).map((t) => ({
        ...t,
        statusZh: STATUS_ZH[t.status] || t.status,
        statusCls: String(t.status || '').toLowerCase(),
        whenText: String(t.scheduledAt || '').slice(5, 16).replace('T', ' ')
      }))
      this.setData({ tasks })
    } catch (e) { wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' }) }
  },

  async pickFilter(e) { this.setData({ filterIdx: Number(e.detail.value) }); this.loadQueue() },

  _rule(type) { return this.data.rules.find((r) => r.type === type) },
  _patchRule(type, patch) {
    this.setData({ rules: this.data.rules.map((r) => r.type === type ? { ...r, ...patch } : r) })
  },

  /* 开关:点即存 —— 只发 enabled,后端按已存值保参数 */
  async onToggle(e) {
    const type = e.currentTarget.dataset.type
    try {
      const resp = await api.adminPut('/admin/notify/rules', { rules: [{ type, enabled: e.detail.value }] })
      const nr = resp.rules.find((r) => r.type === type)
      this._patchRule(type, nr)
      wx.showToast({ title: e.detail.value ? '已开启' : '已关闭', icon: 'none' })
      if (e.detail.value) this.refreshPreview(type)
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }); this.load() }
  },

  onNum(e) { this._patchRule(e.currentTarget.dataset.type, { [e.currentTarget.dataset.field]: e.detail.value }) },
  onTpl(e) {
    const type = e.currentTarget.dataset.type
    this._patchRule(type, { templateText: e.detail.value })
    clearTimeout(this['_t' + type])
    this['_t' + type] = setTimeout(() => this.refreshPreview(type), 400)
  },
  /* 变量芯片:wx textarea 拿不到光标 —— 追加到末尾(与图意一致:点击插入) */
  addChip(e) {
    const { type, v } = e.currentTarget.dataset
    const r = this._rule(type)
    this._patchRule(type, { templateText: (r.templateText || '') + `{${v}}` })
    this.refreshPreview(type)
  },

  async refreshPreview(type) {
    const r = this._rule(type)
    try {
      const resp = await api.adminPost('/admin/notify/preview', { type, templateText: r.templateText })
      this._patchRule(type, { preview: resp.preview })
    } catch (e) { this._patchRule(type, { preview: `⚠ ${(e && e.message) || '预览失败'}` }) }
  },

  async saveCard(e) {
    if (this._saving) return   // 双击双发拦(D88 同族)
    this._saving = true
    const type = e.currentTarget.dataset.type
    const r = this._rule(type)
    try {
      const resp = await api.adminPut('/admin/notify/rules', { rules: [{
        type, enabled: r.enabled, templateText: r.templateText,
        offsetMinutes: Number(r.offsetMinutes), advanceDays: Number(r.advanceDays), revisitDays: Number(r.revisitDays)
      }] })
      this._patchRule(type, resp.rules.find((x) => x.type === type))
      wx.showToast({ title: '已保存,之后生成的通知用新文案', icon: 'none' })
      this.refreshPreview(type)
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
    this._saving = false
  },

  async resetTpl(e) {
    const type = e.currentTarget.dataset.type
    try {
      const resp = await api.adminPut('/admin/notify/rules', { rules: [{ type, templateText: '' }] })
      this._patchRule(type, resp.rules.find((x) => x.type === type))
      wx.showToast({ title: '已恢复默认文案', icon: 'none' })
      this.refreshPreview(type)
    } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  }
})
