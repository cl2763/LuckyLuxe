// Only list screens reload automatically. Editors keep their inputs and show a review notice.
const refreshers={
 'pages/home/index':async p=>{await p.refreshLanguage();await p.loadShopName()},
 'pages/services/index':p=>p.refresh(),
 'pages/mall/index':p=>p.load(),
 'pages/merchant/member/index':async p=>{await p.loadAll();await p.loadMembershipView()},
 'pages/merchant/services/index':p=>p.load()
}
const watched=new Set([...Object.keys(refreshers),'pages/booking/index','pages/merchant/store/index','pages/merchant/package-edit/index','pages/merchant/service-edit/index','pages/merchant/booking-addons/index'])
function stop(p){clearTimeout(p._configSyncTimer);p._configSyncGeneration=(p._configSyncGeneration||0)+1}
function start(p){stop(p);if(!watched.has(p.route)||require('./setup-preview').active())return;require('./public-catalog-cache').clear();const g=p._configSyncGeneration,api=require('./api'),merchant=p.route.startsWith('pages/merchant/');let revision=null,busy=false
 const tick=async()=>{if(g!==p._configSyncGeneration||busy)return;busy=true;try{
  const context=()=>merchant?(api.getAdminAuth()?.accessToken||'')+'|'+(api.getAdminAuth()?.tenantId||''):api.currentTenantId(),tid=context();if(!tid||merchant&&!api.getAdminAuth()?.accessToken)return
  const r=await(merchant?api.adminGet('/admin/config-revision'):api.getConfigRevision());if(g!==p._configSyncGeneration||tid!==context())return
  if(revision!==null&&revision!==r.revision){require('./public-catalog-cache').clear();const reload=refreshers[p.route];if(reload){await reload(p);if(g!==p._configSyncGeneration)return;p.setData({configSyncChanged:false})}else p.setData({configSyncChanged:true})}
  revision=r.revision;const d=new Date();p.setData({configSyncError:'',configSyncChecked:[d.getHours(),d.getMinutes(),d.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':')})
 }catch(e){if(g===p._configSyncGeneration)p.setData({configSyncError:'暂时无法核对最新配置，当前内容和输入已保留。'})}finally{busy=false;if(g===p._configSyncGeneration)p._configSyncTimer=setTimeout(tick,5000)}}
 p.configSyncRetry=tick;tick()
}
module.exports={start,stop}
