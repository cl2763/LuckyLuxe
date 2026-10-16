// Explicit test recipients use internal tenant/user IDs; an incomplete scope never opens sending.
export function subscriptionScope(env=process.env){
 const enabled=env.WECHAT_SUBSCRIBE_ENABLED==='true'
 const mode=env.WECHAT_SUBSCRIBE_MODE||'test'
 const recipients=String(env.WECHAT_SUBSCRIBE_TEST_TARGETS||'').split(',').map(s=>s.trim()).filter(Boolean)
 return {enabled,allowTarget:(tenant,user)=>enabled&&(mode==='all'||(mode==='test'&&recipients.includes(tenant+':'+user)))}
}
