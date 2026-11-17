// Normal merchant authentication remains unchanged. Preview credentials stay in memory.
function readStoredAuth() {
  if (window.SetupPreview) return window.SetupPreview.auth
  try { return readJson('lucky-owner-auth') || JSON.parse(sessionStorage.getItem('lucky-owner-auth') || 'null') }
  catch { return readJson('lucky-owner-auth') }
}
;(function(){
  const params=new URLSearchParams(location.hash.slice(1)),token=params.get('setupPreview')
  if(!token)return
  const pages=new Set(['pricing','membership','storeSettings','schedule','salary','targets','accounts','recurring','customers']),page=pages.has(params.get('page'))?params.get('page'):'pricing'
  addEventListener('hashchange',()=>location.reload())
  let banner
  function message(text){if(banner)banner.textContent=text}
  window.SetupPreview={
    auth:{accessToken:token,admin:{role:'owner',provider:'platform-preview'}},
    async load({owner,request,setLocked,render,renderBrandSubtitle,loadMembershipPage,loadPricingPage,loadMembershipSettings,loadDepositSettings,loadSalaryPlansPanel,loadPerfTargets,loadStaffAccountsPanel}){
      const me=await request('/admin/auth/me')
      owner.role=me.admin.role;owner.storeName=me.admin.storeName;owner.auth.admin=me.admin;owner.financeKey='';owner.token=''
      if(me.admin.role!=='owner'){setLocked(true);message('本页属于老板配置功能，员工无权查看。平台预览不会提升员工权限。');return}
      const [services,techs,hours,plan]=await Promise.all([request('/admin/services'),request('/admin/technicians'),request('/admin/business-hours'),request('/admin/tenant/plan')])
      owner.services=services.services;owner.technicians=techs.technicians;owner.businessHoursStores=hours.stores;owner.tenantPlan=plan.entitlements
      if(page==='customers')window.CustomerTags.setRules((await request('/admin/segment-rules')).rules)
      owner.adminPage=page==='recurring'?'finance':['salary','targets','accounts','recurring'].includes(page)?'schedule':page;owner.staffTab=page==='accounts'?'accounts':page==='salary'?'salary':page==='targets'?'performance':'schedule';owner.hoursUnset=false;owner.bookings=[];owner.customers=[]
      renderBrandSubtitle();setLocked(false);render()
      if(page==='customers'){window.SetupPreview.customers({owner,els:{customerList:document.getElementById('customerList')},request,renderCustomers:()=>render()})}else if(page==='recurring'){owner.financeLedger.rules=(await request('/admin/finance/recurring')).rules;render()}else if(page==='membership')await loadMembershipPage();else if(page==='pricing')await loadPricingPage();else if(['schedule','salary','targets','accounts','recurring'].includes(page)){owner.scheduleWeek=await request('/admin/schedule-week');owner.scheduleRequests=[];render();if(page==='accounts')await loadStaffAccountsPanel();if(page==='salary')await loadSalaryPlansPanel();if(page==='targets')await loadPerfTargets()}else {owner.tenantKb=await request('/admin/kb');await loadMembershipSettings();await loadDepositSettings();render()}
      const section=params.get('section'),memberTab={recharge:'recharge',times:'times',coupons:'coupon',points:'mall',membership:'tiers'}[section]
      if(page==='membership'&&memberTab)document.querySelector('[data-member-tab="'+memberTab+'"]')?.click()
      if(page==='pricing'){document.querySelector('[data-pricing-module="'+(section==='bookingAddons'?'bookingAddons':['settlement','pricingRules'].includes(section)?'catalog':'storefront')+'"]')?.click();if(section==='pricingRules')document.querySelector('[data-pricing-tab="rules"]')?.click()}
      const panel={store:'storeProfileBody',guide:'storeProfileBody',hours:'businessHoursEditor',specialDates:'businessHoursEditor',hero:'heroSlidesBody',booking:'bookingRulesBody',deposit:'depositSettingsBody',notifications:'notifySettingsBody',knowledge:'kbDetailBody',quote:'quoteSettingsBody'}[section]
      if(page==='storeSettings'&&panel){const node=document.getElementById(panel);if(node){node.closest('details').open=true;node.scrollIntoView({block:'start'})}}
      message(`${owner.storeName} · ${me.admin.previewSource==='draft'?'配置草稿（尚未应用）':'当前正式配置'} · 商家真实网页 · 只读 · v${typeof ADMIN_BUILD==='string'?ADMIN_BUILD:'local'}。经营记录未加载，保存与业务操作不可执行。`)
    },
    draw({applyLanguage,renderAdminPages,renderServices,renderStoreSettings,renderScheduleWeek,applyStaffTab,renderRecurringRules}){applyLanguage();renderAdminPages();renderServices();if(page==='recurring'){renderRecurringRules();const f=document.getElementById('financePage');if(f){[...f.children].forEach(el=>el.classList.toggle('hidden',!el.querySelector('[data-fin-panel="settings"]')));f.querySelector('.fin-layout-grid').style.gridTemplateColumns='minmax(0,1fr)';f.querySelector('#financeNav').classList.add('hidden');f.querySelectorAll('[data-fin-panel]').forEach(el=>el.classList.toggle('hidden',el.dataset.finPanel!=='settings'));f.querySelectorAll('[data-fin-panel="settings"] details').forEach(el=>{const show=!!el.querySelector('#financeRecurringBody');el.classList.toggle('hidden',!show);if(show)el.open=true})}}if(['schedule','salary','targets','accounts','recurring'].includes(page)){applyStaffTab();renderScheduleWeek();for(const id of ['perfRankCard','attendanceCard'])document.getElementById(id)?.classList.add('hidden')}if(page==='storeSettings'){renderStoreSettings();document.getElementById('setupOwnerReview')?.classList.add('hidden');for(const id of ['aiPackBody','planDetailBody']){const el=document.getElementById(id);if(el)el.innerHTML='<p class="subtle">订阅及用量不在本次配置预览范围内。</p>'}}},
    customers({owner,els,request,renderCustomers}){els.customerList.innerHTML=window.CustomerTags.tierBar([],{lang:owner.lang,request,rerender:renderCustomers})+'<p class="subtle">本次只预览分层规则，顾客名单与人数未加载。</p>';els.customerList.querySelectorAll('[data-rfm-filter],.rfm-bar>.small').forEach(e=>e.hidden=true);const host=document.getElementById('customersPage');if(host)[...host.children].forEach(e=>{if(e.id!=='customerList')e.classList.add('hidden')})},
    failed(messageText){message(messageText)}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    banner=document.createElement('div');banner.setAttribute('role','status');banner.style.cssText='position:sticky;top:0;z-index:9999;background:var(--tagmbg);color:var(--tagm);padding:12px 20px;border-bottom:1px solid var(--line);font:14px/1.6 -apple-system,sans-serif';document.body.prepend(banner)
    message('正在读取商家当前正式配置；使用商家网页原有组件。')
  })
  document.addEventListener('click',e=>{
    const target=e.target.closest('[data-admin-page],#ownerLogout,#ownerLoginButton,a')
    if(!target)return
    const next=target.dataset.adminPage==='finance'?'recurring':target.dataset.adminPage;const allowed=next&&pages.has(next)
    if(allowed){e.preventDefault();e.stopImmediatePropagation();if(next!==page){params.set('page',next);params.delete('section');location.hash=params.toString()}return}
    if(!allowed){e.preventDefault();e.stopImmediatePropagation();message('当前预览仅开放配置页面，业务记录和账号操作不在预览范围内。')}
  },true)
})()
