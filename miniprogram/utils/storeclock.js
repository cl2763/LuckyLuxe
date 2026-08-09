/* 门店「今天」。
   小程序原来到处用 new Date() 取今天 —— 那是**设备时钟**。店在多伦多、老板人在国内时,
   设备已经跨到明天、店里还在今天,点「今天」会跳到一个还没发生的日子,看着像单全没了。
   CLAUDE.md 的纪律是「所有『今天』按门店时区算」,这里补上:
   /admin/store-clock 给的 today 就是门店时区的今天,拿到后缓存,页面同步读。 */
const api = require('./api')
const KEY = 'lucky_store_clock'

function cached() {
  const v = wx.getStorageSync(KEY)
  return v && v.today ? v : null
}

// 同步读:没缓存时退回设备日期(总比没有强),但会顺手去后台刷新
function storeToday() {
  const c = cached()
  if (!c) {
    refreshStoreClock().catch(() => {})
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return c.today
}

function storeMonth() { return storeToday().slice(0, 7) }

async function refreshStoreClock() {
  const r = await api.adminGet('/admin/store-clock')
  if (r && r.today) wx.setStorageSync(KEY, { today: r.today, timezone: r.timezone || '', at: Date.now() })
  return r
}

module.exports = { storeToday, storeMonth, refreshStoreClock }
