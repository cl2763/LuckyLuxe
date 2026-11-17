// Preview credentials and caches are memory-only. Never overwrite a merchant session.
let session=null,clock=null
const allowed=new Set(['pages/merchant/customers/index','pages/setup-preview/index','pages/merchant/staff/index','pages/merchant/salary-plan/index','pages/merchant/member/index','pages/merchant/services/index','pages/merchant/booking-addons/index','pages/merchant/service-edit/index','pages/merchant/package-edit/index','pages/merchant/coupon-edit/index','pages/merchant/points-mall/index','pages/merchant/store/index','pages/merchant/store-guide/index','pages/merchant/notify-settings/index'])
function get(){return session}
function active(){return !!session}
function clear(){session=null;clock=null}
function raw(base,path,method,data,header){return new Promise((resolve,reject)=>wx.request({url:base+path,method,data,header,timeout:15000,success:r=>r.statusCode>=200&&r.statusCode<300?resolve(r.data):reject(Object.assign(Error(r.data?.error?.message||r.data?.error||'预览读取失败'),{code:r.data?.error?.code})),fail:reject}))}
async function claim(base,ticket){clear();const r=await raw(base,'/setup-preview/claim','POST',{}, {'x-preview-ticket':ticket});session=r;return r}
function request(base,path,method='GET',data){
 if(!session)return Promise.reject(Error('请重新打开预览'))
 if(Date.now()>=session.expiresAt)return Promise.reject(Error('预览已过期，请从平台重新打开'))
 if(method!=='GET'&&!(method==='POST'&&['/admin/notify/preview','/admin/salary-plans/preview'].includes(path)))return Promise.reject(Error('只读预览不能保存、充值、发券或办理业务'))
 return raw(base,path,method,data,{authorization:'Bearer '+session.token,'content-type':'application/json'})
}
function beforeShow(page){
 if(!session)return true
 if(!allowed.has(page.route)){wx.showToast({title:'这个页面不在配置预览范围内',icon:'none'});require('./nav').relaunch('/pages/setup-preview/index');return false}
 if(page._setupPreviewDetailApplied!==session.token){const seg={recharge:0,times:1,coupons:2,points:3,membership:4}[session.detail];if(page.route==='pages/merchant/member/index'&&seg!==undefined)page.setData({seg});if(page.route==='pages/merchant/services/index')page.setData({tab:session.detail==='settlement'?'catalog':'storefront'});page._setupPreviewDetailApplied=session.token}
 page.setData({setupPreviewActive:true,setupPreviewLabel:(session.source==='draft'?'配置草稿 · 未应用':'当前正式配置')+' · 只读预览'})
 return true
}
module.exports={get,active,clear,claim,request,beforeShow,clock:()=>clock,setClock:v=>{clock=v}}
