const { sceneFromScan, memberCodeFromScan } = require('./scan-code')
const api = require('./api')
const nav = require('./nav')
const alert = (title, content) => wx.showModal({title,content,showCancel:false,fail:(e)=>console.warn('[showModal fail]',e)})

function scanCustomerCode() {
  wx.scanCode({onlyFromCamera:false,
    success(result) {
      const scene = sceneFromScan(result)
      if (/^[sbp][0-9a-f]{24}$/.test(scene) || /^m[A-Z0-9]{8}$/.test(scene)) {
        nav.to(`/pages/scan-entry/index?scene=${encodeURIComponent(scene)}`)
      } else alert('未识别二维码','请扫描门店码、绑定码或签署码。')
    },
    fail(error) { if (!/cancel/i.test(String(error?.errMsg || ''))) wx.showToast({title:'扫码未完成，请重试',icon:'none'}) }
  })
}
function scanMerchantCode() {
  wx.scanCode({onlyFromCamera:false,
    async success(result) {
      const code = memberCodeFromScan(result)
      if (!code) { alert('未识别会员码','请扫描顾客「我的」页面的会员二维码。'); return }
      wx.showNavigationBarLoading({fail:()=>{}})
      try {
        const out = await api.adminGet(`/admin/customers/lookup?memberCode=${encodeURIComponent(code)}`)
        if (!out.hit) { alert('本店未找到档案',out.reason || '请核对顾客选择的门店。'); return }
        nav.to(`/pages/merchant/customer/index?id=${encodeURIComponent(out.hit.id)}`)
      } catch (error) { alert('查档失败',error.message || '请稍后重试。') }
      finally { wx.hideNavigationBarLoading({fail:()=>{}}) }
    },
    fail(error) { if (!/cancel/i.test(String(error?.errMsg || ''))) wx.showToast({title:'扫码未完成，请重试',icon:'none'}) }
  })
}
module.exports = { scanCustomerCode, scanMerchantCode }
