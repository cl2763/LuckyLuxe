/* 屏 C2｜顾客签署页(小程序侧)。
   裁决③(店主 2026-08-09):**用 web-view 包住网页版 /sign/<单号>**,两端同构一份实现 ——
   签名板、选券面板、金额、快照都只有一套代码,不会出现「网页改了小程序没跟上」。

   沙箱验证:开发者工具勾「不校验合法域名」即可;
   正式发版前核对后端签署链接的门店域名，以及快照的 API_BASE 域名，均须加入业务域名白名单
   —— 已记进 handoff/小程序发版清单.md。 */
const api = require('../../utils/api')

Page({
  data: { url: '', code: '' },

  async onLoad(q) {
    const code = decodeURIComponent(q.code || q.snapshot || '')
    if (!code) { wx.showToast({ title: '缺少服务单号', icon: 'none' }); return }
    /* 店主 2026-08-10 拍板:所有「查看签署单」入口点了**直接出快照本体**,
       不再弹"去网页后台看"的提示框。快照就是顾客签字那一刻的 SVG 凭证,
       同一个 web-view 壳子,只是换个地址 —— 不为它单开一个页面。 */
    const isSnap = Boolean(q.snapshot)
    // 单号进 URL 前先编码,别让特殊字符把链接拼坏
    try {
      const target=isSnap ? await api.getDocumentLink(code) : q.merchant==='1' ? await api.adminPost('/admin/settlements/'+encodeURIComponent(code)+'/sign-token',{}) : await api.getSignLink(code)
      // 仅短时单据链接进入 web-view，不传播顾客长期登录令牌。
      this.setData({code,url:target.url.startsWith('/') ? api.API_BASE+target.url : api.SANDBOX ? api.API_BASE+target.url.replace(/^https?:\/\/[^/]+/, '') : target.url})
    } catch(e) {
      wx.showModal({title:'暂时无法打开',content:e.message||'请刷新订单后重试',showCancel:false,fail:()=>wx.showToast({title:'签署页暂时打不开，请重试',icon:'none'})})
      return
    }
    wx.setNavigationBarTitle({ title: isSnap ? '签署单凭证' : '服务确认单' })
  },

  // web-view 里签完会 postMessage 过来(小程序只在页面卸载/分享时才收得到),这里只做兜底提示
  onMessage(e) {
    const list = (e.detail && e.detail.data) || []
    if (list.some((m) => m && m.signed)) wx.showToast({ title: '已签署', icon: 'none' })
  }
})
