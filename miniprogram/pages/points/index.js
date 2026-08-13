const api = require('../../utils/api')
const { money, ensureCurrencyCached } = require('../../utils/storecurrency')

Page({
  data: { balance: 0, prizes: [], history: [], loading: true, redeeming: false, loggedIn: true },

  async onShow() {
    ensureCurrencyCached()
    await api.refreshMember()
    this.load()
  },

  async load() {
    try {
      const r = await api.getPointsMall()
      this.setData({
        loading: false, loggedIn: true,
        balance: r.balance || 0,
        prizes: (r.prizes || []).map((p) => ({
          ...p,
          desc: p.discountType === 'percent' ? `${p.percentOff}% off` : `减 ${money(p.amountCents || 0)}`,
          minText: p.minSpendCents > 0 ? ` · 满 ${money(p.minSpendCents)} 可用` : '',
          stockText: p.soldOut ? '已兑完' : `剩 ${p.stock} 份`,
          btnText: p.soldOut ? '已兑完' : (p.limitReached ? '已达限兑' : (p.canRedeem ? '兑换' : '积分不足'))
        })),
        history: (r.history || []).map((h) => ({ ...h, deltaText: (h.delta > 0 ? '+' : '') + h.delta, up: h.delta > 0 }))
      })
    } catch (e) {
      this.setData({ loading: false, loggedIn: false })
    }
  },

  async redeem(e) {
    if (this.data.redeeming) return
    const id = e.currentTarget.dataset.id
    const p = this.data.prizes.find((x) => x.id === id)
    if (!p || !p.canRedeem) {
      if (p && p.soldOut) wx.showToast({ title: '已兑完', icon: 'none' })
      else if (p && p.limitReached) wx.showToast({ title: '该奖品每人限兑,已达上限', icon: 'none' })
      else wx.showToast({ title: '积分不足', icon: 'none' })
      return
    }
    wx.showModal({
      title: `兑换「${p.name}」`,
      content: `将扣除 ${p.costPoints} 积分;兑换后券直接进「我的券包」,有效期 ${p.validDays} 天。确认?`,
      confirmText: '确认兑换',
      success: async (m) => {
        if (!m.confirm) return
        this.setData({ redeeming: true })
        try {
          const r = await api.redeemPrize(id)
          this.setData({ redeeming: false })
          wx.showModal({
            title: '兑换成功 🎉',
            content: `「${r.couponName}」已放入你的券包。当前剩余 ${r.balance} 积分。`,
            confirmText: '看券包', cancelText: '好',
            success: (x) => { if (x.confirm) wx.navigateTo({ url: '/pages/coupons/index' }) }
          })
          this.load()
        } catch (err) {
          this.setData({ redeeming: false })
          wx.showToast({ title: (err && err.message) || '兑换失败', icon: 'none', duration: 2500 })
        }
      }
    })
  }
})
