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
    const code = decodeURIComponent(q.code || q.snapshot || '')
    if (!code) { wx.showToast({ title: '缺少服务单号', icon: 'none' }); return }
    /* 店主 2026-08-10 拍板:所有「查看签署单」入口点了**直接出快照本体**,
       不再弹"去网页后台看"的提示框。快照就是顾客签字那一刻的 SVG 凭证,
       同一个 web-view 壳子,只是换个地址 —— 不为它单开一个页面。 */
    const isSnap = Boolean(q.snapshot)
    // 单号进 URL 前先编码,别让特殊字符把链接拼坏
    this.setData({
      code,
      url: isSnap
        ? `${api.API_BASE}/settlements/${encodeURIComponent(code)}/snapshot`
        : `${api.API_BASE}/sign/${encodeURIComponent(code)}`
    })
    wx.setNavigationBarTitle({ title: isSnap ? '签署单凭证' : '服务确认单' })
  },

  // web-view 里签完会 postMessage 过来(小程序只在页面卸载/分享时才收得到),这里只做兜底提示
  onMessage(e) {
    const list = (e.detail && e.detail.data) || []
    if (list.some((m) => m && m.signed)) wx.showToast({ title: '已签署', icon: 'none' })
  }
})
