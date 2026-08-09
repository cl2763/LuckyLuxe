/* 日结深链落地页(工资试算的「去日结」跳这里)。
   设计图屏 1 把日结画在「订单页 · 今日台面」网格下方 —— 那才是主入口;
   这一页只是同一份 mixin 的第二个落点,渲染完全一致,不会两边分叉。 */
const api = require('../../../utils/api')
const { storeToday, refreshStoreClock } = require('../../../utils/storeclock')
const { dailyCloseData, dailyCloseMixin } = require('../../../utils/dailyclose')

Page(Object.assign({
  data: Object.assign({}, dailyCloseData),

  async onShow() {
    if (!(await api.guardOwner())) return
    await refreshStoreClock().catch(() => {})
    this.loadClose(this.data.date || storeToday())
  },

  onLoad(q) { if (q && /^\d{4}-\d{2}-\d{2}$/.test(q.date || '')) this.setData({ date: q.date }) }
}, dailyCloseMixin))
