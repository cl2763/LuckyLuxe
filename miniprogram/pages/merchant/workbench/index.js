const api = require('../../../utils/api')

function stinfo(s) {
  if (s === 'needs_human') return { label: '待人工', cls: 'd' }
  if (s === 'human_active') return { label: '人工中', cls: 's' }
  if (s === 'ai_replied') return { label: 'AI 已答', cls: 'g' }
  return { label: 'AI 处理中', cls: 'g' }
}
function hhmm(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
}

Page({
  data: { all: [], list: [], kw: '', stat: { total: 0, human: 0 } },

  onShow() { this.load() },

  async load() {
    try {
      const r = await api.adminGet('/admin/wechat/conversations')
      const all = (r.conversations || []).map((c) => {
        const s = stinfo(c.status)
        return {
          id: c.id,
          name: c.linkedUserName || c.externalUserId || '顾客',
          msg: c.lastMessage || '',
          status: c.status,
          label: s.label,
          cls: s.cls,
          time: hhmm(c.updatedAt),
          rank: c.status === 'needs_human' ? 0 : 1
        }
      }).sort((a, b) => a.rank - b.rank)
      this.setData({
        all,
        list: this.filtered(all, this.data.kw),
        stat: { total: all.length, human: all.filter((x) => x.status === 'needs_human').length }
      })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  filtered(all, kw) {
    const k = (kw || '').trim()
    if (!k) return all
    return all.filter((x) => (x.name && x.name.indexOf(k) >= 0) || (x.msg && x.msg.indexOf(k) >= 0))
  },

  onKw(e) {
    const kw = e.detail.value
    this.setData({ kw, list: this.filtered(this.data.all, kw) })
  },

  open(e) {
    wx.navigateTo({ url: `/pages/merchant/conversation/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` })
  }
})
