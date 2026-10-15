function navigate(store = {}, en = false) {
 const n=store.navigation
 if(n && n.coordinateSystem==='gcj02' && Number.isFinite(n.latitude) && Number.isFinite(n.longitude) && Math.abs(n.latitude)<=90 && Math.abs(n.longitude)<=180 && typeof wx.openLocation==='function') {
  wx.openLocation({latitude:n.latitude,longitude:n.longitude,name:store.storeName||store.name||'',address:store.address||'',scale:18,
   fail:e=>{if(/cancel/.test(e.errMsg||''))return;wx.showModal({title:en?'Map unavailable':'地图暂时无法打开',content:en?'Copy a map link or address instead?':'是否改用地图链接或复制地址？',success:r=>{if(r.confirm)fallback(store,en)},fail:()=>wx.showToast({title:en?'Please retry':'导航暂不可用，请重试',icon:'none'})})}})
  return
 }
 fallback(store,en)
}
function fallback(store = {}, en = false) {
 const toast = title => wx.showToast({title,icon:'none'})
 const address=store.address
 if(!address)return toast(en?'Address not available':'门店地址待补充')
 const url=store.navigation && store.navigation.url
 const ready=typeof url==='string' && /^https:\/\/surl\.amap\.com\/[A-Za-z0-9]+$/.test(url)
 wx.showActionSheet({itemList:ready?(en?['Copy Amap link','Copy address']:['复制高德地图链接','复制地址']):[en?'Copy address':'复制地址'],
  success:res=>{
   const link=ready&&res.tapIndex===0
   wx.setClipboardData({data:link?url:address,
    success:()=>{if(link)wx.showModal({title:en?'Map link copied':'地图链接已复制',content:en?'Paste into your browser to open Amap. Check the unit and floor in the store address.':'请粘贴到手机浏览器打开高德地图，再选择路线导航。到达楼栋后，请按门店地址中的单元、楼层和房号进店。',showCancel:false,fail:()=>toast(en?'Link copied':'链接已复制')})},
    fail:()=>toast(en?'Copy failed, please retry':'复制失败，请重试')})
  },fail:e=>{if(!/cancel/.test(e.errMsg||''))toast(en?'Please retry':'打开导航菜单失败，请重试')}})
}
function call(store = {}, en = false) {
 const phone=String(store.phone||'').replace(/[^\d+]/g,'')
 if(!phone)return wx.showToast({title:en?'Phone not available':'门店电话待补充',icon:'none'})
 wx.makePhoneCall({phoneNumber:phone,fail:e=>{if(!/cancel/.test(e.errMsg||''))wx.showToast({title:en?'Call failed':'拨号失败，请重试',icon:'none'})}})
}
module.exports={navigate,call}
