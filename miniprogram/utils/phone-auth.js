// Phone requirements come only from the server. Native WeChat credentials are never logged.
const api = require('./api')
function message(page, text) { page.setData({'authProfile.phoneMessage':text}) }
async function finish(page) {
  page.setData({authModalVisible:false,phoneStep:false})
  wx.showToast({title:page.data.lang==='en'?'Signed in':'登录成功',icon:'success'})
  await page.onShow()
  if(page.offerSubscription)await page.offerSubscription()
}
async function beginLogin(page) {
  if (page.data.phoneBusy) return
  page.setData({phoneBusy:true})
  try {
    const profile=page.data.authProfile
    await api.loginWithWechat({nickname:profile.nickname||'',avatarUrl:profile.avatarUrl||''})
    if (api.phoneBindingRequired()) {
      page.setData({phoneStep:true})
      message(page,page.data.lang==='en'?'Authorize your phone number to complete sign-in.':'请点击下方按钮，通过微信授权绑定手机号。')
    } else await finish(page)
  } catch(e) { wx.showToast({title:e.message||'登录失败，请重试',icon:'none'}) }
  finally { page.setData({phoneBusy:false}) }
}
async function handlePhoneAuthResult(page,event) {
  if(page.data.phoneBusy)return
  const detail=event?.detail||{},en=page.data.lang==='en'
  if(detail.errno===112 || /api scope is not declared/.test(detail.errMsg||'')) {
    message(page,en?'Phone authorization is not available. Please contact support.':'手机号授权暂不可用，请联系平台核对隐私配置。');return
  }
  if(!detail.code && !(detail.encryptedData&&detail.iv)) {
    message(page,en?'Phone authorization was not completed. You can retry or close this panel to browse.':'尚未完成手机号授权，可重新授权，或关闭窗口继续浏览。');return
  }
  page.setData({phoneBusy:true})
  try {
    const bound=await api.bindWechatPhone(detail.code?{phoneCode:detail.code}:{encryptedData:detail.encryptedData,iv:detail.iv})
    if(bound.needPhone!==false)throw new Error(en?'Binding was not confirmed. Please retry.':'未收到绑定成功确认，请重试。')
    await finish(page)
  }catch(e){page.setData({'authProfile.phoneAuthorized': false, 'authProfile.phoneAuthFailed': true});message(page,e.message||(en?'Binding failed. Please retry.':'绑定失败，请重试。'))}
  finally {page.setData({phoneBusy:false})}
}
module.exports={beginLogin,handlePhoneAuthResult}
