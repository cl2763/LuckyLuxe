/* 微信授权手机号:拿到授权结果 → 送后端**真解密** → 落到这家店的档案上
 * (店主 夜11 段 B2,2026-09-14;整段从 pages/me/index.js 摘出来 —— 裁 #89)
 *
 * ══ 这个文件存在的理由 ══
 * 这个按钮**早就有**,但后端一直没接 —— 老代码自己写着「正式上线前需要后端换取并绑定手机号」。
 * 于是顾客点了「允许」、看到「手机号已授权」的绿勾,而**库里那一格还是空的**。
 * 店主要的「只问一次」在这个状态下是句空话:问了也没存住,下次还得问。
 *
 * ══ 微信给的其实是两样东西,能用的只有一样 ══
 *   · `encryptedData` + `iv` —— 老路。用 `session_key` 解,**我们自己算得出来**,已接(`/auth/wechat/mini-phone`)。
 *   · `code`              —— 新路。要拿 `access_token` 去问腾讯换,**需要真 appid/secret 且要出网**。
 * D228 新路交后端换取；回归只替微信网络跳，绑定与错误处理仍真实执行。
 */
const api = require('./api')

/* 🔴 裁 #92(店主 07l §五,2026-09-14):**这里原来自己判过一次「要不要问手机号」,已撤。**
   两份条件会分叉,而分叉的两种后果都不会红:
     · 前端判松了 → 顾客**每次都被要求授权**(而且每次收 0.03);
     · 前端判严了 → **该问的时候没问**,这个人永远没有手机号。
   两边各自「按自己那份」都是对的,所以谁也不报错。
   **后端是真相源**:登录返回里带 `needPhone`,前端照着做,不许自己算。
   判据 `test-mini-phone.mjs ㋐12/㋐12b` 守着「全仓只许 1 处」,前端自己再加一份当场红。 */

function setPhoneState(page, patch) {
  const next = {}
  Object.keys(patch).forEach((k) => { next[`authProfile.${k}`] = patch[k] })
  page.setData(next)
  if (typeof page.syncAuthReady === 'function') page.syncAuthReady()
}

/** `<button open-type="getPhoneNumber">` 的回调总入口 */
async function handlePhoneAuthResult(page, event) {
  const en = page.data.lang === 'en'
  const detail = (event && event.detail) || {}
  const errMsg = detail.errMsg || ''
  if (typeof page.debugAuth === 'function') page.debugAuth('phone auth result', detail)

  /* 隐私协议没声明手机号接口:微信压根不给数据 —— 这不是顾客取消,措辞要分开 */
  if (detail.errno === 112 || errMsg.indexOf('api scope is not declared in the privacy agreement') >= 0) {
    setPhoneState(page, { phoneAuthorized: false, phoneAuthFailed: true, phoneMode: 'manual',
      phoneMessage: en ? 'WeChat phone authorization is blocked because the phone API is not declared in the Mini Program privacy agreement. Please use manual verification for now.'
        : '微信后台隐私协议暂未声明手机号接口，请先使用手动手机号验证。后台配置完成后可使用微信一键授权。' })
    return
  }
  if (errMsg && errMsg.indexOf('ok') < 0) {
    setPhoneState(page, { phoneAuthorized: false, phoneAuthFailed: true, phoneMode: 'manual',
      phoneMessage: en ? 'WeChat phone authorization was cancelled. Please verify manually.' : '微信手机号授权未完成，请使用手动验证。' })
    return
  }

  /* 新旧路都由后端确认绑定成功，前端才显示绿勾。 */
  if (detail.code || (detail.encryptedData && detail.iv)) {
    try {
      const bound = await api.bindWechatPhone(detail.code ? { phoneCode: detail.code } : { encryptedData: detail.encryptedData, iv: detail.iv })
      setPhoneState(page, { phoneAuthorized: true, phoneAuthFailed: false, phoneMode: 'wechat',
        phoneCode: '', manualPhoneVerified: false,
        phoneMessage: en ? `Phone bound: ${bound.phone}` : `手机号已绑定：${bound.phone}` })
      wx.showToast({ title: en ? 'Phone bound' : '手机号已绑定', icon: 'success' })
      return
    } catch (e) {
      /* 🔴 解密/绑定失败**不许当成功**(静默失败器族):绿勾一打,顾客以为存住了,
         而后台永远认不出这个人。如实报错,让她再点一次。 */
      setPhoneState(page, { phoneAuthorized: false, phoneAuthFailed: true, phoneMode: 'manual',
        phoneMessage: en ? 'Phone binding failed, please try again or verify manually.' : '手机号绑定失败，请重试或改用手动验证。' })
      wx.showToast({ title: en ? 'Binding failed' : '绑定失败', icon: 'none' })
      return
    }
  }

  /* 微信没有返回可用的凭证，不能伪装授权成功。 */
  setPhoneState(page, { phoneAuthorized: false, phoneAuthFailed: false, phoneMode: 'manual',
    phoneCode: detail.code || '', manualPhoneVerified: false,
    phoneMessage: en ? 'No phone authorization credential was returned. Please try again.'
      : '未收到微信手机号授权凭证，请重新授权。' })
}

module.exports = { handlePhoneAuthResult }
