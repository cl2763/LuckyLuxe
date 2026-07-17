const api = require('../../utils/api')

Page({
  data: { balance: 0, level: '', packages: [], txns: [] },
  async onShow() {
    await api.refreshMember()
    const m = wx.getStorageSync('lucky_member') || {}
    // 余额取真实会员数据;充值套餐为演示(待顾客端套餐接口);收支明细待顾客端储值流水接口
    const packages = [
      { id: 1, name: '充 1000 送 50', sub: '到账 $1,050' },
      { id: 2, name: '充 3000 送 300', sub: '到账 $3,300 · 最划算' }
    ]
    this.setData({ balance: m.balance || 0, level: m.memberLevel || '', packages, txns: [] })
  },
  soon() { wx.showToast({ title: '在线充值即将上线(微信支付)', icon: 'none' }) }
})
