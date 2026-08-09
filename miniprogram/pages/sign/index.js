/* 屏 C2｜顾客签署页(小程序侧)。
   裁决③(店主 2026-08-09):**用 web-view 包住网页版 /sign/<单号>**,两端同构一份实现 ——
   签名板、选券面板、金额、快照都只有一套代码,不会出现「网页改了小程序没跟上」。

   沙箱验证:开发者工具勾「不校验合法域名」即可;
   正式发版前要把 API_BASE 的域名加进小程序后台的 **业务域名(web-view)** 白名单
   —— 已记进 handoff/小程序发版清单.md。 */
const api = require('../../utils/api')

Page({
  data: { url: '', code: '' },

  onLoad(q) {
    const code = decodeURIComponent(q.code || '')
    if (!code) { wx.showToast({ title: '缺少服务单号', icon: 'none' }); return }
    // 单号进 URL 前先编码,别让特殊字符把链接拼坏
    this.setData({ code, url: `${api.API_BASE}/sign/${encodeURIComponent(code)}` })
    wx.setNavigationBarTitle({ title: '服务确认单' })
  },

  // web-view 里签完会 postMessage 过来(小程序只在页面卸载/分享时才收得到),这里只做兜底提示
  onMessage(e) {
    const list = (e.detail && e.detail.data) || []
    if (list.some((m) => m && m.signed)) wx.showToast({ title: '已签署', icon: 'none' })
  }
})
