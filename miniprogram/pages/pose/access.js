const api = require('../../utils/api')
const nav = require('../../utils/nav')
function guard() {
 if(!api.guardMerchant()) return false
 if(!['owner','staff'].includes(api.getCachedRole())) { wx.showToast({title:'仅店主和技师可使用',icon:'none'}); nav.back(); return false }
 return true
}
module.exports={guard,tenant:()=>wx.getStorageSync('lucky_tenant')||''}
