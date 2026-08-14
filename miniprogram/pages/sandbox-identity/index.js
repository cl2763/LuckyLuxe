/* 沙盒专用:切换演示身份(店主 2026-08-12 提出,补强批建)。
   列出当前店演示2阵容,一键按人登录(服务端 mini-login asUserId,同 ALLOW_DEMO 闸门)。
   仅沙盒:入口由 USE_LOCAL_SANDBOX 控制,服务端路由生产关闭 —— 双闸;发版清单有核查项。 */
const api = require('../../utils/api')
const nav = require('../../utils/nav')

Page({
  data: { roster: [], loading: true, current: '' },
  async onShow() {
    const member = wx.getStorageSync('lucky_member') || {}
    this.setData({ current: member.nickname || '' })
    try {
      const r = await api.getSandboxRoster()
      this.setData({ roster: r.roster || [], loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '名册拉取失败(仅沙盒可用)', icon: 'none' })
    }
  },
  async pick(e) {
    const { id, name } = e.currentTarget.dataset
    try {
      await api.sandboxLoginAs(id)
      wx.showToast({ title: '已切换:' + name, icon: 'none' })
      setTimeout(() => nav.relaunch('/pages/me/index'), 600)
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '切换失败', icon: 'none' })
    }
  }
})
