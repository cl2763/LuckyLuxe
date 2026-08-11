// 2026-08-02 记一笔(店主设计稿定稿):日常收支随手记,三秒入账。
// 与网页「记一笔」同一端点 POST /admin/finance/transactions;服务收入完成单自动入账,不在这里记;
// 账本只追加:记错了去「本月流水」用红字冲销,不能改不能删。
const api = require('../../../utils/api')

const EXPENSE_CATS = ['耗材采购', '房租', '水电网', '设备', '营销推广', '平台软件费', '员工工资', '提成', '其他支出']
const INCOME_CATS = ['产品销售', '礼品卡', '其他收入']
const CHANNELS = [
  { id: 'card', name: '刷卡 POS' },
  { id: 'cash', name: '现金' },
  { id: 'wechat', name: '微信' },
  { id: 'alipay', name: '支付宝' },
  { id: 'stored_value', name: '储值卡' },
  { id: 'unknown', name: '其他' }
]

function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

Page({
  data: {
    type: 'expense',
    cats: EXPENSE_CATS,
    cat: EXPENSE_CATS[0],
    amount: '',
    channels: CHANNELS,
    channelNames: CHANNELS.map((c) => c.name),
    channelIdx: 0,
    date: '',
    note: '',
    saving: false
  },

  async onShow() {
    if (!(await api.guardOwner())) return
    if (!api.getFinanceKey()) {
      /* D27(店主 2026-08-12 实测,🔴):没开财务门禁的店**不需要钥匙** —— 原来这里不问门禁
         直接 toast+400ms 回退,回退撞上还没走完的进场转场动画,导航栈卡死、
         转场透明层残留顶层吃掉全 App 点击(含返回键)。先问门禁再拦;要拦也等转场走完(700ms)。 */
      let lockEnabled = false
      try { lockEnabled = Boolean((await api.adminGet('/admin/finance/lock-status')).enabled) } catch (e) { lockEnabled = false }
      if (lockEnabled) {
        wx.showToast({ title: '请先在财务页解锁', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 700)
        return
      }
    }
    if (!this.data.date) this.setData({ date: localToday() })
  },

  setType(e) {
    const type = e.currentTarget.dataset.type
    const cats = type === 'income' ? INCOME_CATS : EXPENSE_CATS
    this.setData({ type, cats, cat: cats[0] })
  },
  setCat(e) { this.setData({ cat: e.currentTarget.dataset.cat }) },
  onAmount(e) { this.setData({ amount: e.detail.value }) },
  onChannel(e) { this.setData({ channelIdx: Number(e.detail.value) }) },
  onDate(e) { this.setData({ date: e.detail.value }) },
  onNote(e) { this.setData({ note: e.detail.value }) },

  async submit() {
    if (this.data.saving) return
    const amount = Number(this.data.amount)
    if (!amount || amount <= 0) { wx.showToast({ title: '请填写正确的金额', icon: 'none' }); return }
    this.setData({ saving: true })
    try {
      await api.adminPost('/admin/finance/transactions', {
        type: this.data.type,
        category: this.data.cat,
        amount,
        payChannel: CHANNELS[this.data.channelIdx].id,
        occurredOn: this.data.date,
        tags: '',
        note: this.data.note.trim()
      })
      wx.showToast({ title: '已入账', icon: 'success' })
      this.setData({ amount: '', note: '' })
    } catch (err) {
      if (err && err.code === 'FINANCE_LOCKED') {
        api.clearFinanceKey()
        wx.showToast({ title: '财务会话过期,请回财务页解锁', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 600)
      } else {
        wx.showToast({ title: (err && err.message) || '入账失败', icon: 'none' })
      }
    } finally {
      this.setData({ saving: false })
    }
  },

  toTxns() { wx.redirectTo({ url: '/pages/merchant/finance-txns/index' }) }
})
