/* 旧书签/订单入口先通过本人或商家会话换单据凭据。两种角色不互相回落。 */
window.resolveSignEntry = async function(code,merchant) {
  const read=(storage,key)=>{try{return JSON.parse(storage.getItem(key)||'null')}catch{return null}}
  const tenant=localStorage.getItem('lucky-web-tenant')||''
  const stored=read(localStorage,'lucky-web-auth')
  const auth=merchant ? read(localStorage,'lucky-owner-auth')||read(sessionStorage,'lucky-owner-auth') : stored?.__tenant===tenant?stored.__value:null
  if(!auth?.accessToken)throw Error('请从已登录的订单进入，或向商家获取最新签署链接。')
  const path=merchant?`/admin/settlements/${encodeURIComponent(code)}/sign-token`:`/my/settlements/${encodeURIComponent(code)}/sign-link`
  const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.accessToken,...(!merchant?{'x-tenant-id':tenant}:{})},body:'{}'})
  const result=await response.json()
  if(!response.ok)throw Error(result.error?.message||'无法打开签署单，请返回订单重试。')
  const target=new URL(result.url,location.origin)
  return ['localhost','127.0.0.1'].includes(location.hostname)?target.pathname+target.search:target.href
}
