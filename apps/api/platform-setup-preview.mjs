import {getMiniCode} from './wechat-mini-code.mjs'
import {randomBytes,createHash} from 'node:crypto'

// Only audited, side-effect-free configuration reads. A GET verb alone is not sufficient.
export const PREVIEW_READS=Object.freeze([
  '/admin/finance/recurring','/admin/staff-accounts','/admin/staff-accounts/suggest','/admin/schedule-week','/admin/schedule-settings','/admin/staff-visibility','/admin/perf-targets','/admin/segment-rules','/admin/salary-plans','/admin/salary-plans/effective','/admin/auth/me','/admin/store-clock','/admin/tenant/plan','/admin/tenant/entitlements','/admin/services','/admin/technicians',
  '/admin/business-hours','/admin/store-info','/admin/pricing/categories','/admin/pricing/items','/admin/pricing/rules',
  '/admin/gift-entitlements/config','/admin/booking-addons','/admin/packages','/admin/coupons','/admin/points-prizes','/admin/timecard-settings','/admin/mall/self-purchase',
  '/admin/membership/config','/admin/member-pricing/config','/admin/deposit-config','/admin/booking-rules',
  '/admin/store-guide','/admin/hero-slides','/admin/notify/rules','/admin/duty-setting','/admin/quote-settings','/admin/kb','/admin/notification-settings','/admin/message-templates'
])
const miniPages={pricing:'pages/merchant/services/index',membership:'pages/merchant/member/index',storeSettings:'pages/merchant/store/index',recurring:null,accounts:'pages/merchant/staff/index?tab=accounts',schedule:'pages/merchant/staff/index',salary:'pages/merchant/salary-plan/index',targets:'pages/merchant/staff/index?tab=targets',customers:'pages/merchant/customers/index'}
const detailPages={bookingAddons:'pricing',services:'pricing',settlement:'pricing',pricingRules:'pricing',priceTypes:'pricing',recharge:'membership',times:'membership',coupons:'membership',points:'membership',membership:'membership',store:'storeSettings',hours:'storeSettings',specialDates:'storeSettings',guide:'storeSettings',hero:'storeSettings',booking:'storeSettings',deposit:'storeSettings',notifications:'storeSettings',knowledge:'storeSettings',quote:'storeSettings',staff:'schedule',schedule:'schedule',accounts:'accounts',salary:'salary',visibility:'targets',targets:'targets',recurring:'recurring',segments:'customers'}
const digest=t=>createHash('sha256').update(t).digest('hex')
export function createSetupPreview({db,apiError,json,getEntitlements,workflow,previewWechat={}}){
  const grants=new Map(),tickets=new Map(),contexts=new WeakMap()
  function authorize(req,path){
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'')
    if(!token.startsWith('setup_preview_'))return null
    const grant=grants.get(digest(token))
    if(!grant||grant.expiresAt<=Date.now())throw apiError(401,'PREVIEW_EXPIRED','预览已过期，请从平台重新打开。')
    if(!db.prepare("SELECT id FROM tenants WHERE id=? AND status='active'").get(grant.tenantId))throw apiError(403,'PREVIEW_UNAVAILABLE','门店已停用，不能继续预览。')
    if(req.headers['x-tenant-id']&&req.headers['x-tenant-id']!==grant.tenantId||req.headers['x-admin-tenant-id']&&req.headers['x-admin-tenant-id']!==grant.tenantId)throw apiError(403,'PREVIEW_SCOPE','预览不能切换到其他门店。')
    const priceRead=/^\/admin\/member-pricing\/(services\/[^/]+\/(display|settlement)|packages\/[^/]+)$/.test(path)
    const templatePreview=req.method==='POST'&&['/admin/notify/preview','/admin/salary-plans/preview'].includes(path)
    if(!templatePreview&&(req.method!=='GET'||!PREVIEW_READS.includes(path)&&!priceRead))throw apiError(403,'PREVIEW_READ_ONLY','这是配置只读预览，不能办理业务或读取顾客与账务记录。')
    if(grant.role==='staff'&&!['/admin/auth/me','/admin/tenant/plan','/admin/tenant/entitlements','/admin/technicians','/admin/business-hours'].includes(path))throw apiError(403,'FORBIDDEN','员工没有这个配置模块的查看权限。')
    if(grant.draftId)workflow.preview(grant.tenantId,grant.draftId)
    const actor=Object.freeze({role:grant.role,provider:'platform-preview',tenantId:grant.tenantId,technicianId:null,displayName:'配置只读预览',email:'platform-preview',preview:true,previewSource:grant.draftId?'draft':'current',draftId:grant.draftId||null})
    contexts.set(req,actor);return actor
  }
  async function route({req,res,path,isPlatform}){
    if(path==='/setup-preview/claim'){
      if(req.method!=='POST')throw apiError(405,'METHOD_NOT_ALLOWED','请重新扫码。')
      const ticket=String(req.headers['x-preview-ticket']||''),claim=tickets.get(digest(ticket))
      if(!claim||claim.expiresAt<=Date.now())throw apiError(401,'PREVIEW_EXPIRED','预览码已过期，请从平台重新打开。')
      if(!claim.page)throw apiError(400,'WEB_ONLY','此模块请使用商家网页预览。')
      const probe={headers:{authorization:'Bearer '+claim.token},method:'GET'};authorize(probe,'/admin/auth/me')
      json(res,200,{...claim,readOnly:true},{'cache-control':'private, no-store'});return true
    }
    const codeMatch=path.match(/^\/platform\/tenants\/([^/]+)\/setup-preview-code$/)
    if(codeMatch){
      if(!isPlatform())throw apiError(401,'UNAUTHORIZED','请先登录平台。')
      if(req.method!=='POST')throw apiError(405,'METHOD_NOT_ALLOWED','请重新生成预览码。')
      const ticket=String(req.headers['x-preview-ticket']||''),claim=tickets.get(digest(ticket))
      if(!claim||claim.tenantId!==codeMatch[1]||claim.expiresAt<=Date.now())throw apiError(401,'PREVIEW_EXPIRED','预览已过期。')
      if(!claim.page)throw apiError(400,'WEB_ONLY','此模块当前仅有商家网页编辑界面，请选择真实网页预览。')
      authorize({headers:{authorization:'Bearer '+claim.token},method:'GET'},'/admin/auth/me')
      const code=await getMiniCode({...previewWechat,scene:'v'+ticket,page:'pages/setup-preview/index',envVersion:'trial'})
      json(res,200,{image:'data:'+code.mimeType+';base64,'+code.bytes.toString('base64'),envVersion:'trial'},{'cache-control':'private, no-store'});return true
    }
    const m=path.match(/^\/platform\/tenants\/([^/]+)\/setup-preview$/)
    if(!m)return false
    if(!isPlatform())throw apiError(401,'UNAUTHORIZED','请先登录平台。')
    if(req.method!=='POST')throw apiError(405,'METHOD_NOT_ALLOWED','请重新打开预览。')
    const tenantId=m[1]
    if(!db.prepare("SELECT id FROM tenants WHERE id=? AND status='active'").get(tenantId))throw apiError(404,'NOT_FOUND','门店不存在或已停用。')
    const role=String(req.headers['x-preview-role']||'owner')
    if(!['owner','staff'].includes(role))throw apiError(400,'BAD_REQUEST','预览身份无效。')
    const draftId=String(req.headers['x-setup-draft-id']||'')
    if(draftId){if(role!=='owner')throw apiError(403,'FORBIDDEN','员工没有配置草稿的查看权限。');workflow.preview(tenantId,draftId)}
    for(const [key,t] of tickets)if(t.expiresAt<=Date.now())tickets.delete(key)
    for(const [key,g] of grants)if(g.expiresAt<=Date.now())grants.delete(key)
    if(grants.size>=500)throw apiError(429,'TOO_MANY_PREVIEWS','打开的预览过多，请稍后重试。')
    const page=String(req.headers['x-preview-page']||'pricing');if(!Object.hasOwn(miniPages,page))throw apiError(400,'BAD_REQUEST','预览页面无效。')
    const detail=String(req.headers['x-preview-detail']||'');if(detail&&detailPages[detail]!==page)throw apiError(400,'BAD_PREVIEW_DETAIL','预览模块与页面不匹配。')
    let miniPage=miniPages[page]
    if(detail==='guide'){const store=db.prepare('SELECT id FROM stores WHERE tenant_id=? AND is_active=1 ORDER BY name').get(tenantId);if(!store)throw apiError(404,'NOT_FOUND','本店没有门店资料。');miniPage='pages/merchant/store-guide/index?storeId='+encodeURIComponent(store.id)}
    if(detail==='bookingAddons')miniPage='pages/merchant/booking-addons/index'
    if(detail==='notifications')miniPage='pages/merchant/notify-settings/index'
    if(['hero','knowledge','quote','pricingRules'].includes(detail))miniPage=null
    const token='setup_preview_'+randomBytes(32).toString('hex'),expiresAt=Date.now()+30*60000
    grants.set(digest(token),{tenantId,role,expiresAt,draftId})
    const ticket=randomBytes(12).toString('hex');tickets.set(digest(ticket),{token,tenantId,role,expiresAt,page:miniPage,detail,source:draftId?'draft':'current',entitlements:getEntitlements(tenantId)})
    json(res,201,{ticket,miniPage:'pages/setup-preview/index?scene=v'+ticket,token,tenantId,role,expiresAt:new Date(expiresAt).toISOString(),issuedAt:new Date().toISOString(),draftRevision:draftId?workflow.preview(tenantId,draftId).draft.revision:null,source:draftId?'draft':'current',draftId:draftId||null,readOnly:true,entitlements:getEntitlements(tenantId)},{'cache-control':'private, no-store'})
    return true
  }
  function respond(req,res,path){
    const actor=authorize(req,path)
    if(actor?.draftId){const query=Object.fromEntries(new URL(req.url,'http://preview.local').searchParams);const p=workflow.preview(actor.tenantId,actor.draftId,{path,query});if(Object.hasOwn(p.responses,path)){json(res,200,p.responses[path],{'cache-control':'private, no-store'});return true}}
    if(actor&&path==='/admin/finance/recurring'){json(res,200,workflow.currentPreview(actor.tenantId,'recurring'),{'cache-control':'private, no-store'});return true}
    return false
  }
  return {route,authorize,respond,actor:req=>contexts.get(req)||null}
}
