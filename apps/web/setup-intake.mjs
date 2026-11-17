import {ACCEPT,FILE_MAX,intakeProgress} from './setup-intake-schema.mjs'
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const bytes=n=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`
export async function mountIntake(root,{base,headers=()=>({}),request:customRequest,platform=false,onDirty=()=>{}}){
  let data,dirty=false,busy=false,disposed=false,urls=[]
  const request=customRequest||(async(path='',options={})=>{
    const response=await fetch(base+path,{...options,credentials:'same-origin',headers:{...headers(),...options.headers}})
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error?.message||'资料读取或保存失败，请重试。')}
    return options.blob?response.blob():response.json()
  })
  const mark=value=>{dirty=value;onDirty(value)}
  const revoke=()=>{urls.forEach(URL.revokeObjectURL);urls=[]}
  function status(message,error=false){const el=root.querySelector('#intakeStatus');if(el){el.textContent=message;el.className='intake-status'+(error?' error':'');el.hidden=false}}
  const value=(s,f)=>data.answers[s]?.[f]??''
  function field(s,f){
    const id=`intake-${s}-${f.id}`,v=value(s,f.id),attrs=`id="${id}" data-section="${s}" data-field="${f.id}"`,label=`${esc(f.label)}${f.required?' <span class="badge required">必填</span>':''}`
    let input
    if(['checks','days'].includes(f.type))input=`<div class="intake-checks" role="group" aria-label="${esc(f.label)}">${(f.type==='days'?['一','二','三','四','五','六','日']:f.options).map((o,i)=>`<label><input type="checkbox" ${attrs.replace(`id="${id}"`,`id="${id}-${i}"`)} value="${esc(o)}" ${Array.isArray(v)&&v.includes(o)?'checked':''}>${f.type==='days'?'周':''}${esc(o)}</label>`).join('')}</div>`
    else if(f.type==='select')input=`<select ${attrs}><option value="">请选择</option>${f.options.map(o=>`<option ${v===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`
    else if(f.type==='textarea')input=`<textarea ${attrs} maxlength="4000">${esc(v)}</textarea>`
    else input=`<input ${attrs} type="${f.type||'text'}" value="${esc(v)}" ${f.type==='number'?'min="0" max="999" step="1"':'maxlength="200"'} ${f.required?'aria-required="true"':''}>`
    return `<div class="intake-field ${['textarea','checks','days'].includes(f.type)?'wide':''}"><${['checks','days'].includes(f.type)?'span':'label'} ${['checks','days'].includes(f.type)?'':`for="${id}"`}>${label}</${['checks','days'].includes(f.type)?'span':'label'}>${input}${f.hint?`<small>${esc(f.hint)}</small>`:''}</div>`
  }
  function section(s){
    const a=data.answers[s.id]||{},f=data.files.filter(f=>f.section===s.id)
    const body=`<p>${esc(s.description)}</p>${s.id!=='basic'?`<label class="intake-field"><span>资料准备情况</span><select data-section="${s.id}" data-field="status" aria-label="${esc(s.title)}准备情况"><option value="provided" ${a.status==='provided'?'selected':''}>现在提供</option><option value="later" ${a.status==='later'?'selected':''}>稍后补充／请平台联系我</option>${s.level!=='required'?`<option value="unused" ${a.status==='unused'?'selected':''}>暂不使用</option>`:''}</select></label>`:''}
      <div class="intake-grid">${s.fields.map(f=>field(s.id,f)).join('')}</div>
      ${s.files?`<div class="intake-upload" data-drop="${s.id}"><label class="intake-field"><span>${s.images?'选择照片':'上传现成资料'} <span class="badge">可多选</span></span><input type="file" data-upload="${s.id}" multiple accept="${s.images?'.jpg,.jpeg,.png,.webp,.heic':ACCEPT}" aria-label="${esc(s.title)}上传文件"></label><p>${s.images?'照片':'图片、PDF、Excel、Word、CSV 或文字文件'} · 单份不超过10MB · 也可拖到这里</p><ul class="intake-files">${f.map(file=>`<li><span data-thumbnail="${file.id}"></span><div class="file-info">${esc(file.name)}<small>${bytes(file.size)} · 已上传</small></div><button type="button" data-download="${file.id}">下载</button><button type="button" data-remove="${file.id}" aria-label="移除${esc(file.name)}">移除</button></li>`).join('')}</ul></div>`:''}`
    const title=`${esc(s.title)}<span class="badge ${s.level==='required'?'required':''}">${s.level==='required'?'先提供':s.level==='conditional'?'按需填写':'可后补'}</span>`
    return `<section class="intake-card" data-intake-section="${s.id}">${s.level==='required'?`<h3>${title}</h3>${body}`:`<details ${f.length||Object.keys(a).length?'open':''}><summary>${title}</summary><div>${body}</div></details>`}</section>`
  }
  async function render(){
    if(disposed)return;revoke()
    const progress=intakeProgress(data.sections,data.answers,data.files),provided=progress.filter(p=>p.status==='provided').length
    root.innerHTML=`<div class="intake-topline">有迹 · 开店资料</div><h1>${esc(data.storeName)}，先把现成资料发给我们</h1><p>不用重新制作表格。先提供基本资料，其余按你的业务选择；平台整理后，会再与你核对配置。</p><div class="intake-progress"><span>${esc(data.planName)}</span><span>已提供 ${provided} / ${progress.length} 项资料</span><span>${data.status==='submitted'?'已提交给平台，可继续补充':'尚未提交'}</span></div><div id="intakeStatus" role="status" class="intake-status" hidden></div>
      ${platform?'<div class="intake-tools"><button id="intakeLink">生成／更新商家填写链接</button><button id="intakeRevoke">停用填写链接</button></div>':''}
      ${[['required','01 · 先提供这些','只收开店必需的信息；服务价格、营业安排可上传材料，也可标记稍后补充。'],['conditional','02 · 有这些业务再填写','只显示本店已开通的功能；没有的业务选“暂不使用”。'],['optional','03 · 这些可以以后补','照片、介绍等不影响先提交基本资料。']].map(([level,title,note])=>{const sections=data.sections.filter(s=>s.level===level);return sections.length?`<div class="intake-level"><h2>${title}</h2><p>${note}</p></div>${sections.map(section).join('')}`:''}).join('')}
      <p>材料仅用于本店配置核对。提交资料不会充值、发券、改余额，也不会自动发布或覆盖已有设置。</p>
      <div class="intake-savebar"><span id="intakeSaveNote">${dirty?'文字内容有未保存的修改。':data.updatedAt?`上次保存：${esc(new Date(data.updatedAt).toLocaleString())}`:'可先保存，准备好后继续补充。'}</span><button id="intakeSave" type="button">保存，稍后继续</button><button id="intakeSubmit" type="button" class="primary">提交现有资料</button></div>`
    for(const f of data.files.filter(f=>['image/jpeg','image/png','image/webp'].includes(f.mime))){
      try{const blob=await request(`/files/${f.id}`,{blob:true});if(disposed)return;const url=URL.createObjectURL(blob);urls.push(url);const target=root.querySelector(`[data-thumbnail="${f.id}"]`);if(target){const img=document.createElement('img');img.src=url;img.alt=f.name;target.append(img)}}catch{status('部分照片缩略图读取失败，原文件仍保留，可重试下载。',true)}
    }
  }
  function setBusy(value){busy=value;root.querySelectorAll('button,input[type=file]').forEach(b=>b.disabled=value)}
  async function save(submit){
    if(busy)return;setBusy(true)
    try{
      const revision=data.revision;data=await request('',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({answers:data.answers,revision,submit})})
      mark(false);await render();status(submit?'已提交现有资料。缺少的内容会由平台集中与你确认。':'已保存，可以稍后继续填写。')
    }catch(e){status(e.message,true);root.querySelector('#intakeStatus')?.scrollIntoView({block:'center'})}finally{setBusy(false)}
  }
  async function upload(section,list){
    if(busy)return;setBusy(true);let count=0,failures=[]
    try{
      for(const f of list){
        try{if(f.size>FILE_MAX)throw new Error('超过10MB');const result=await request('/files',{method:'POST',headers:{'x-file-name':encodeURIComponent(f.name),'x-setup-section':section,'content-type':'application/octet-stream'},body:f});if(!data.files.some(f=>f.id===result.file.id))data.files.push(result.file);count++}
        catch(e){failures.push(`${f.name}：${e.message}`)}
      }
      await render();status(`已接收 ${count} 份材料。${failures.length?'未上传成功：'+failures.join('；'):'文字填写内容请保存或提交。'}`,Boolean(failures.length))
    }finally{setBusy(false)}
  }
  root.oninput=e=>{
    const el=e.target,s=el.dataset.section,f=el.dataset.field;if(!s||!f)return
    const a=(data.answers[s] ||= {})
    a[f]=el.type==='checkbox'?[...root.querySelectorAll(`[data-section="${s}"][data-field="${f}"]:checked`)].map(x=>x.value):el.value
    mark(true);const note=root.querySelector('#intakeSaveNote');if(note)note.textContent='文字内容有未保存的修改。'
  }
  root.onchange=e=>{if(e.target.dataset.upload)upload(e.target.dataset.upload,[...e.target.files])}
  root.onclick=async e=>{
    const b=e.target.closest('button');if(!b||busy)return
    if(b.id==='intakeSave')return save(false)
    if(b.id==='intakeSubmit')return save(true)
    try{
      if(b.dataset.remove){await request(`/files/${b.dataset.remove}`,{method:'DELETE'});data.files=data.files.filter(f=>f.id!==b.dataset.remove);await render();status('已移除这份收集材料；正式门店配置不受影响。')}
      if(b.dataset.download){const f=data.files.find(f=>f.id===b.dataset.download),blob=await request(`/files/${f.id}`,{blob:true}),url=URL.createObjectURL(blob);urls.push(url);const a=document.createElement('a');a.href=url;a.download=f.name;a.click()}
      if(b.id==='intakeLink'){const r=await request('/link',{method:'POST'});status('新链接已生成，旧链接已停用。请复制下方完整链接交给商家。');const input=document.createElement('input');input.readOnly=true;input.value=new URL(r.url,location.href).href;input.setAttribute('aria-label','商家填写链接');root.querySelector('#intakeStatus').append(input);input.select()}
      if(b.id==='intakeRevoke'){await request('/link',{method:'DELETE'});status('填写链接已停用；已提交资料仍然保留。')}
    }catch(e){status(e.message,true)}
  }
  root.ondragover=e=>{const zone=e.target.closest('[data-drop]');if(zone){e.preventDefault();zone.classList.add('drag')}}
  root.ondragleave=e=>e.target.closest('[data-drop]')?.classList.remove('drag')
  root.ondrop=e=>{const zone=e.target.closest('[data-drop]');if(zone){e.preventDefault();zone.classList.remove('drag');upload(zone.dataset.drop,[...e.dataTransfer.files])}}
  const unload=e=>{if(dirty){e.preventDefault();e.returnValue=''}}
  window.addEventListener('beforeunload',unload)
  try{data=await request();await render()}catch(e){root.innerHTML=`<div class="intake-status error" role="alert">${esc(e.message)}</div><button id="intakeRetry">重新读取</button>`;root.querySelector('#intakeRetry').onclick=()=>{window.removeEventListener('beforeunload',unload);mountIntake(root,{base,headers,request:customRequest,platform,onDirty})}}
  return {isDirty:()=>dirty,dispose:()=>{disposed=true;revoke();window.removeEventListener('beforeunload',unload);root.oninput=root.onchange=root.onclick=root.ondrop=root.ondragover=root.ondragleave=null}}
}
