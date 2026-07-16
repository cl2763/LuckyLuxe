const api = require('../../../utils/api')

const TIER = { Silver: '银卡', Gold: '金卡', Platinum: '铂金', Diamond: '钻石' }

function stinfo(s) {
  if (s === 'needs_human') return { label: '待人工', cls: 'd' }
  if (s === 'human_active') return { label: '人工中', cls: 's' }
  if (s === 'ai_replied') return { label: 'AI 已答', cls: 'g' }
  return { label: 'AI 处理中', cls: 'g' }
}

function lastVisitText(iso) {
  if (!iso) return '—'
  const then = new Date(iso)
  const now = new Date()
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86400000)
  if (days === 0) return '今天'
  if (days > 0) return `${days}天前`
  const m = `${then.getMonth() + 1}`.padStart(2, '0')
  const d = `${then.getDate()}`.padStart(2, '0')
  return `${m}-${d}`
}

function buildProfile(cust) {
  return {
    tier: TIER[cust.memberTier] || cust.memberTier || '会员',
    visits: cust.visitCount || 0,
    lastText: lastVisitText(cust.lastVisitAt),
    stored: ((cust.storedValueBalanceCents || 0) / 100),
    tags: Array.isArray(cust.tags) ? cust.tags : [],
    note: cust.notes || ''
  }
}

Page({
  data: {
    id: '', name: '', status: '', label: '', cls: '',
    linkedName: '', linkedUserId: '', profile: null,
    needsHuman: false, isHuman: false,
    transcript: [], reply: '', sending: false
  },

  onLoad(q) { this.setData({ id: decodeURIComponent((q && q.id) || '') }) },
  onShow() { this.load() },

  async load() {
    let r
    try { r = await api.adminGet('/admin/wechat/conversations') } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }); return }
    const c = (r.conversations || []).find((x) => x.id === this.data.id)
    if (!c) { wx.showToast({ title: '会话不存在', icon: 'none' }); return }
    const s = stinfo(c.status)
    const transcript = (c.transcript || []).map((m) => ({
      side: m.role === 'customer' ? 'c' : (m.role === 'staff' ? 'staff' : 'a'),
      content: m.content || ''
    }))
    const name = c.linkedUserName || c.externalUserId || '顾客'

    let profile = null
    if (c.linkedUserId) {
      try {
        const cr = await api.adminGet('/admin/customers')
        const list = cr.customers || cr.data || cr || []
        const cust = list.find((u) => u.id === c.linkedUserId)
        if (cust) profile = buildProfile(cust)
      } catch (e) { /* 忽略,退回名字 */ }
    }

    this.setData({
      name, status: c.status, label: s.label, cls: s.cls,
      linkedName: c.linkedUserName || '', linkedUserId: c.linkedUserId || '', profile,
      needsHuman: c.status === 'needs_human', isHuman: c.status === 'human_active',
      transcript
    })
    wx.setNavigationBarTitle({ title: name })
  },

  viewProfile() {
    if (!this.data.linkedUserId) { wx.showToast({ title: '未绑定会员', icon: 'none' }); return }
    wx.navigateTo({ url: '/pages/merchant/customer/index?id=' + encodeURIComponent(this.data.linkedUserId) })
  },

  onReply(e) { this.setData({ reply: e.detail.value }) },
  async takeOver() { await this.act('take-over', '已接管') },
  async release() { await this.act('release-to-ai', '已归还 AI') },

  async act(path, tip) {
    try {
      await api.adminPost(`/admin/wechat/conversations/${encodeURIComponent(this.data.id)}/${path}`, {})
      wx.showToast({ title: tip, icon: 'none' })
      this.load()
    } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  },

  async send() {
    const msg = this.data.reply.trim()
    if (!msg || this.data.sending) return
    this.setData({ sending: true })
    try {
      await api.adminPost(`/admin/wechat/conversations/${encodeURIComponent(this.data.id)}/manual-reply`, { message: msg })
      this.setData({ reply: '' })
      this.load()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '发送失败', icon: 'none' })
    } finally { this.setData({ sending: false }) }
  }
})
