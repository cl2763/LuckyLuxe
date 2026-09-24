/* 网页商家后台 · 门店内容域(2026-08-28 D78 批,公约②「边改边拆」)。

   两件事住在这里:
     ① **搬**:门店信息三件(renderStoreInfo / renderStoreProfile / saveStoreProfile)整块从 admin.js 搬出,
        **只搬不改行为**,依赖(owner / els / t / request / escapeHtml / toast 等全局)在运行期解析,
        admin.html 里本文件排在 admin.js 之前加载 —— 与 ai-desk.js 同一套做法。
     ② **加**:D78 顾客首页轮播的商家自管面板(上传 / 排序 / 文案 / 启停)。

   为什么新面板不写进 admin.js:《棘轮律》—— 那两个巨型文件只许降不许升;
   而且轮播这件事本来就属于"门店内容",与门店信息同域。

   ⚠️ 这一屏**没有设计图**(L3 无图不结案律):结构与样式一律照抄同页现有的
   settings-item / kb-facts-grid 写法,不另起一套;像素级验收挂 ⬜ 等 Cowork 补图。 */

function renderStoreInfo() {
  if (!els.storeInfoSummary || !els.storeInfoBody) return
  // 🔴 永久律(店主 08-23):拿不到就显示「—」,绝不回落成旗舰店 id ——
  // 非旗舰商家会在自己的后台看到别人家的商户 ID。
  const tenantId = owner.tenantPlan?.tenantId || ''
  const store = (owner.businessHoursStores || [])[0]
  els.storeInfoSummary.textContent = tenantId || '—'
  const rows = [
    [owner.lang === 'zh' ? '商户 ID' : 'Tenant ID', tenantId || '—'],
    [owner.lang === 'zh' ? '门店 ID' : 'Store ID', store?.id || '-'],
    [owner.lang === 'zh' ? '门店名称' : 'Store name', store?.name || '-'],
    [owner.lang === 'zh' ? '当前套餐' : 'Plan', owner.tenantPlan?.plan || '-']
  ]
  els.storeInfoBody.innerHTML = `
    <table class="store-info-table">
      ${rows.map(([label, value]) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td><code>${escapeHtml(String(value))}</code></td>
          <td><button class="ghost slim" data-copy-value="${escapeHtml(String(value))}" type="button">${owner.lang === 'zh' ? '复制' : 'Copy'}</button></td>
        </tr>`).join('')}
    </table>
    <p class="subtle">${owner.lang === 'zh' ? '联系技术支持或反馈问题时，提供商户 ID 和门店 ID 可以快速定位你的数据。' : 'Share the tenant and store IDs with support to locate your data quickly.'}</p>
  `
}

function renderStoreProfile() {
  const body = document.querySelector('#storeProfileBody')
  const summary = document.querySelector('#storeProfileSummary')
  if (!body || !summary) return
  const store = (owner.businessHoursStores || [])[0]
  if (!store) {
    summary.textContent = '-'
    body.innerHTML = ''
    return
  }
  /* 🔴 11k 出口普查抓到的第 11、12 处:这两行原来各手写一份 `/tbd/i` —— 只认三个字母。
     而这里是**输入框**:「待补充」这类值会被预填进去,商家一点保存就**存成了真地址**。
     换成两端同源的词表出口(placeholder-words.js),admin.html 里已排在本文件之前加载。 */
  const addressUsable = window.LLPlaceholder.realValue(store.address)
  summary.textContent = addressUsable || (owner.lang === 'zh' ? '⚠ 地址未设置' : '⚠ Address not set')
  summary.classList.toggle('plan-expired', !addressUsable)
  body.innerHTML = `
    <div class="kb-facts-grid">
      <label><span>${owner.lang === 'zh' ? '门店名称' : 'Store name'}</span><input id="storeProfileName" value="${escapeHtml(store.name || '')}"></label>
      <label><span>${owner.lang === 'zh' ? '门店地址' : 'Address'}</span><input id="storeProfileAddress" value="${escapeHtml(addressUsable)}"></label>
      <label><span>${owner.lang === 'zh' ? '联系电话' : 'Phone'}</span><input id="storeProfilePhone" value="${escapeHtml(window.LLPlaceholder.realValue(store.phone))}"></label>
    </div>
    <button class="primary slim" data-store-profile-save type="button">${owner.lang === 'zh' ? '保存门店信息' : 'Save store info'}</button>
    <p class="subtle">${owner.lang === 'zh' ? '保存后同步到订单系统和 AI 知识库——顾客问路、预约确认、AI 回答三处永远一致。' : 'Saved info syncs to bookings and the AI knowledge base so all three stay consistent.'}</p>
  `
}

async function saveStoreProfile() {
  const store = (owner.businessHoursStores || [])[0]
  if (!store) return
  await request('/admin/store-info', {
    method: 'PUT',
    body: JSON.stringify({
      storeId: store.id,
      name: document.querySelector('#storeProfileName')?.value.trim(),
      address: document.querySelector('#storeProfileAddress')?.value.trim(),
      phone: document.querySelector('#storeProfilePhone')?.value.trim()
    })
  })
  const refreshed = await request('/admin/business-hours')
  owner.businessHoursStores = refreshed.stores || []
  await refreshTenantKb().catch(() => {})
  renderStoreSettings()
  toast(owner.lang === 'zh' ? '门店信息已保存并同步到 AI 知识库' : 'Store info saved and synced')
}

/* Approved v1: drafts are never called live; reads and writes are serialized per session. */
let heroSlidesDraft=null
let heroSession='',heroGeneration=0,heroSaved=[],heroPublicCount=null,heroBusy='',heroMessage='',heroError=false,heroDirty=false
const heroKey=()=>String(owner.tenantPlan?.tenantId||'')+'|'+ownerBearer()
const heroCurrent=(key,g)=>key===heroKey()&&key===heroSession&&g===heroGeneration
const heroCopy=slides=>(slides||[]).map(s=>({image:s.image,labelZh:s.labelZh||'',labelEn:s.labelEn||'',isActive:s.isActive!==false,imageView:window.ImageFraming.clone(s.imageView)}))
function heroChanged(){heroDirty=true;heroMessage=owner.lang==='zh'?'有修改待保存，顾客暂时看不到':'Unsaved changes are not visible to customers';heroError=false;heroStatus()}
function heroStatus(){const summary=document.querySelector('#heroSlidesSummary'),status=document.querySelector('[data-hero-status]');const zh=owner.lang==='zh';if(summary)summary.textContent=zh?`已保存 ${heroSaved.length} 张 / 顾客当前 ${heroPublicCount===null?'待核对':heroPublicCount+' 张'} / 草稿 ${heroSlidesDraft?.length||0} 张${heroDirty?' · 待保存':''}`:`Saved ${heroSaved.length} / Public ${heroPublicCount??'checking'} / Draft ${heroSlidesDraft?.length||0}${heroDirty?' · Unsaved':''}`;if(status){status.textContent=heroMessage;status.classList.toggle('is-error',heroError)}}
async function heroReadPublic(){const data=await request('/stores',{public:true,headers:{'x-tenant-id':owner.tenantPlan.tenantId}});return data.heroSlides||[]}
async function loadHeroSlides(){
  const key=heroSession,g=heroGeneration;heroBusy='load'
  try{const data=await request('/admin/hero-slides');if(!heroCurrent(key,g))return;heroSaved=heroCopy(data.slides);heroSlidesDraft=heroCopy(data.slides);const pub=await heroReadPublic();if(!heroCurrent(key,g))return;heroPublicCount=pub.length;heroMessage=owner.lang==='zh'?'已读取保存内容；改完请保存到顾客首页':'Loaded saved images. Save changes to publish.';heroError=false}
  catch(e){if(!heroCurrent(key,g))return;heroMessage=e.message;heroError=true}
  finally{if(heroCurrent(key,g)){heroBusy='';renderHeroSlidesPanel()}}
}
function renderHeroSlidesPanel(){
  const body=document.querySelector('#heroSlidesBody');if(!body)return
  const key=heroKey();if(key!==heroSession){heroSession=key;heroGeneration++;heroSlidesDraft=null;heroSaved=[];heroPublicCount=null;heroBusy='';heroMessage='';heroError=false;heroDirty=false}
  const zh=owner.lang==='zh'
  if(heroSlidesDraft===null){body.innerHTML=`<p role="status">${escapeHtml(heroMessage||(zh?'正在读取轮播图…':'Loading images…'))}</p>${heroError?`<button class="ghost" data-hero-retry>${zh?'重新读取':'Retry'}</button>`:''}`;body.querySelector('[data-hero-retry]')?.addEventListener('click',loadHeroSlides);if(!heroBusy&&!heroError)loadHeroSlides();heroStatus();return}
  body.innerHTML=`<div class="image-panel-heading"><div><h3>${zh?'顾客首页轮播图':'Customer home carousel'}</h3><p class="subtle">${zh?'最多 6 张，按顺序展示。上传后可拖拽调整显示范围。':'Up to 6 images in order. Drag to adjust the visible area.'}</p></div><button class="ghost" type="button" data-hero-preview ${heroBusy?'disabled':''}>${zh?'预览顾客首页':'Preview customer home'}</button></div><fieldset class="hero-edit-fields" ${heroBusy?'disabled':''}>${heroSlidesDraft.length?heroSlidesDraft.map((slide,i)=>`<article class="hero-slide-admin-row card"><div class="hero-image-preview">${window.ImageFraming.image(slide.image,slide.imageView,'desktop','','')}</div><div class="hero-slide-fields"><strong>${zh?'第':'Image '}${i+1}${zh?' 张':''} · ${slide.isActive?(zh?'启用':'Enabled'):(zh?'已隐藏':'Hidden')}</strong><button class="ghost slim" type="button" data-hero-crop="${i}">${zh?'调整显示范围':'Adjust visible area'}</button><label>${zh?'中文文案（可选）':'Chinese caption (optional)'}<input maxlength="40" data-hero-label-zh="${i}" value="${escapeHtml(slide.labelZh)}"></label><label>${zh?'英文文案（可选）':'English caption (optional)'}<input maxlength="40" data-hero-label-en="${i}" value="${escapeHtml(slide.labelEn)}"></label><div class="hero-row-actions"><button class="ghost slim" type="button" data-hero-up="${i}" ${i===0?'disabled':''}>${zh?'上移':'Up'}</button><button class="ghost slim" type="button" data-hero-down="${i}" ${i===heroSlidesDraft.length-1?'disabled':''}>${zh?'下移':'Down'}</button><button class="ghost slim" type="button" data-hero-toggle="${i}">${slide.isActive?(zh?'隐藏':'Hide'):(zh?'启用':'Show')}</button><button class="ghost slim" type="button" data-hero-remove="${i}">${zh?'删除':'Remove'}</button></div></div></article>`).join(''):`<p class="subtle">${zh?'还没有轮播图。上传本店照片后保存，顾客才能看到。':'No carousel images yet. Upload your store photos and save.'}</p>`}<label class="hero-upload-label">${zh?'添加照片':'Add photos'}<input id="heroSlideFile" type="file" accept="image/*" multiple ${heroSlidesDraft.length>=6?'disabled':''}></label><small>${zh?'原图最多 30MB；大图自动压缩，完整画面保留。':'Originals up to 30MB; large images are resized without cropping.'}</small></fieldset><div class="hero-save-bar"><p data-hero-status role="status"></p><button class="primary" type="button" data-hero-save ${heroBusy?'disabled':''}>${heroBusy?(zh?(heroBusy==='read'?'正在读取照片…':'正在保存并核对…'):'Working…'):(zh?'保存到顾客首页':'Save to customer home')}</button></div>`
  heroStatus();bindHeroSlidesPanel(body)
}
function bindHeroSlidesPanel(body){
  const key=heroSession,g=heroGeneration,valid=()=>heroCurrent(key,g)
  for(const action of ['up','down','toggle','remove'])body.querySelectorAll(`[data-hero-${action}]`).forEach(btn=>btn.onclick=()=>{if(!valid()||heroBusy)return;const i=Number(btn.dataset['hero'+action[0].toUpperCase()+action.slice(1)]);if(action==='remove')heroSlidesDraft.splice(i,1);else if(action==='toggle')heroSlidesDraft[i].isActive=!heroSlidesDraft[i].isActive;else{const j=i+(action==='up'?-1:1);[heroSlidesDraft[i],heroSlidesDraft[j]]=[heroSlidesDraft[j],heroSlidesDraft[i]]}heroChanged();renderHeroSlidesPanel()})
  for(const lang of ['Zh','En'])body.querySelectorAll(`[data-hero-label-${lang.toLowerCase()}]`).forEach(input=>input.oninput=()=>{if(!valid())return;heroSlidesDraft[Number(input.dataset['heroLabel'+lang])]['label'+lang]=input.value;heroChanged()})
  body.querySelectorAll('[data-hero-crop]').forEach(btn=>btn.onclick=()=>{const s=heroSlidesDraft[Number(btn.dataset.heroCrop)];window.ImageFraming.edit({src:s.image,views:s.imageView,zh:owner.lang==='zh',onApply:v=>{if(!valid())return;s.imageView=v;heroChanged();renderHeroSlidesPanel()}})})
  body.querySelector('[data-hero-preview]').onclick=()=>window.HomeImagePreview.open({name:owner.businessHoursStores?.[0]?.name||'',draft:heroCopy(heroSlidesDraft),saved:heroCopy(heroSaved),zh:owner.lang==='zh'})
  body.querySelector('#heroSlideFile').onchange=async event=>{
    const picked=Array.from(event.target.files||[]);if(!picked.length||!valid()||heroBusy)return
    if(heroSlidesDraft.length+picked.length>6){heroMessage=owner.lang==='zh'?'最多 6 张：本次未添加，请减少选择数量。':'Up to 6 images. No images added; select fewer.';heroError=true;heroStatus();event.target.value='';return}
    heroBusy='read';heroMessage=owner.lang==='zh'?`正在读取 ${picked.length} 张照片，请稍候…`:`Reading ${picked.length} images…`;renderHeroSlidesPanel()
    const results=await Promise.allSettled(picked.map(f=>window.ImageFraming.read(f)))
    if(!valid())return
    const failed=results.map((r,i)=>r.status==='rejected'?`${picked[i].name}: ${r.reason.message}`:'').filter(Boolean)
    heroBusy='';if(failed.length){heroError=true;heroMessage=(owner.lang==='zh'?'本批未添加，原草稿已保留：':'Batch not added; draft kept: ')+failed.join(' / ')}else{heroSlidesDraft.push(...results.map(r=>({image:r.value,labelZh:'',labelEn:'',isActive:true,imageView:{}})));heroChanged()}renderHeroSlidesPanel()
  }
  body.querySelector('[data-hero-save]').onclick=async()=>{
    if(!valid()||heroBusy)return;const snapshot=heroCopy(heroSlidesDraft);heroBusy='save';heroMessage=owner.lang==='zh'?'正在保存并核对顾客首页…':'Saving and checking customer home…';heroError=false;renderHeroSlidesPanel()
    try{await request('/admin/hero-slides', { method: 'PUT',body:JSON.stringify({slides:snapshot})});if(!valid())return;const saved=await request('/admin/hero-slides');if(!valid())return;const pub=await heroReadPublic();if(!valid())return;const active=snapshot.filter(s=>s.isActive);if(JSON.stringify(heroCopy(saved.slides))!==JSON.stringify(snapshot)||pub.length!==active.length||pub.some((s,i)=>s.image!==active[i].image||JSON.stringify(s.imageView)!==JSON.stringify(active[i].imageView)))throw Error(owner.lang==='zh'?'保存读回不一致，请重试核对':'Saved/public data mismatch; retry');heroSaved=heroCopy(saved.slides);heroSlidesDraft=heroCopy(saved.slides);heroPublicCount=pub.length;heroDirty=false;heroMessage=owner.lang==='zh'?`保存成功，顾客首页当前展示 ${pub.length} 张。`:`Saved. Customer home now shows ${pub.length} images.`}
    catch(e){if(!valid())return;heroError=true;heroMessage=e.message+(owner.lang==='zh'?'；草稿已保留，请重试。':'; draft kept. Please retry.')}
    finally{if(valid()){heroBusy='';renderHeroSlidesPanel()}}
  }
}
addEventListener('beforeunload',e=>{if(heroDirty||heroBusy==='read'||heroBusy==='save'){e.preventDefault();e.returnValue=''}})
