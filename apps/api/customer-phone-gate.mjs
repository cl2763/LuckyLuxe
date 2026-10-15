import { needsPhone } from './mini-phone.mjs'
import { DEV_SCOPES } from './secret-gate.mjs'
// The provisional WeChat session may complete phone binding, but cannot perform customer business actions.
export function requireBoundCustomer(req, user, scope, apiError, enabled = false) {
  const path=new URL(req.url,'http://local').pathname
  const binding=(req.method==='POST'&&path==='/auth/wechat/mini-phone') || (req.method==='GET'&&path==='/auth/wechat/mini-phone-status')
  if(enabled && !DEV_SCOPES.has(scope) && !binding && needsPhone(user)) throw apiError(403,'PHONE_BINDING_REQUIRED','请先通过微信授权绑定手机号，再使用顾客服务。')
  return user
}
