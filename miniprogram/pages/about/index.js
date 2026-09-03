/* 「关于」页 —— 三端版本指纹(店主 04f §一.3)
   指纹**只从后端 /health 取**,不在小程序里手写常量:
   三端同号才算同一版本,手写的那个改不动(2026-08-30 退回件②的教训)。
   ⚠️ 新开一页而不是加进「我的」:`pages/me/index.js` 638 行已超 600 行红线、现状冻结,不许再加。 */
const { getHealth } = require('../../utils/api.js')

Page({
  data: { build: '', commit: '', builtAt: '', loaded: false, failed: '' },
  onLoad() { this.load() },
  onPullDownRefresh() { this.load(() => wx.stopPullDownRefresh()) },
  load(done) {
    getHealth()
      .then((res) => {
        const v = (res && res.version) || {}
        this.setData({ build: v.build || '', commit: v.commit || '', builtAt: v.builtAt || '', loaded: true, failed: '' })
      })
      .catch((err) => {
        /* wx.* 异步一律有 fail 处理(四之八⑤);拿不到就如实说,不显示一个假版本号 */
        this.setData({ loaded: true, failed: (err && err.message) || '版本信息暂时取不到' })
      })
      .then(() => { if (done) done() })
  },
})
