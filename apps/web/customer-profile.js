/* Profile photo editor shared with the mini-program /my/profile endpoint. */
window.LLCustomerProfile = { bind({ request, onSaved, toast, isEnglish }) {
  document.addEventListener('click',event=>{
    if(!event.target.closest('[data-profile-name]'))return
    if(document.querySelector('[data-profile-name-dialog]'))return
    const en=isEnglish(),d=document.createElement('dialog');d.className='card';d.dataset.profileNameDialog=''
    d.innerHTML=`<form><h2>${en?'Edit nickname':'修改昵称'}</h2><label>${en?'Nickname (1–40 characters)':'昵称（1–40字）'}<input name="nickname" maxlength="40" required></label><p role="status"></p><button type="submit">${en?'Save':'保存'}</button><button type="button" data-cancel>${en?'Cancel':'取消'}</button></form>`
    d.querySelector('input').value=event.target.closest('[data-profile-name]').dataset.currentName||''
    document.body.append(d);d.showModal();d.oncancel=e=>e.preventDefault();d.onclose=()=>d.remove()
    d.querySelector('[data-cancel]').onclick=()=>{if(!d.dataset.busy)d.close()}
    d.querySelector('form').onsubmit=async e=>{e.preventDefault();if(d.dataset.busy)return;d.dataset.busy='1';const buttons=[...d.querySelectorAll('button,input')];buttons.forEach(b=>b.disabled=true)
      try{const out=await request('/my/profile',{method:'PATCH',body:JSON.stringify({displayName:d.querySelector('input').value.trim()})});onSaved(out.user);d.close();toast(en?'Nickname saved':'昵称已保存')}
      catch(err){d.querySelector('[role=status]').textContent=err.message}
      finally{delete d.dataset.busy;buttons.forEach(b=>b.disabled=false)}
    }
  })
  document.addEventListener('change' , async event => {
    const input = event.target.closest('[data-profile-avatar]')
    if (!input || !input.files?.[0]) return
    const en = isEnglish(), file = input.files[0]
    input.disabled = true
    const status = input.parentElement.querySelector('[data-avatar-status]')
    status.textContent = en ? 'Saving…' : '正在保存…'
    let url
    try {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10000000) throw new Error(en ? 'Choose a JPG, PNG or WebP under 10 MB.' : '请选择小于 10 MB 的 JPG、PNG 或 WebP 图片。')
      url = URL.createObjectURL(file)
      const img = await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error(en?'Image cannot be read':'图片无法读取'));i.src=url})
      const canvas=document.createElement('canvas'),scale=Math.min(1,320/Math.max(img.width,img.height))
      canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale))
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height)
      const avatarData=canvas.toDataURL('image/jpeg',0.8)
      const out=await request('/my/profile',{method:'PATCH',body:JSON.stringify({avatarData})})
      onSaved(out.user);toast(en?'Photo saved':'头像已保存')
    } catch(error) { toast(error.message);status.textContent=en?'Retry photo upload':'重新上传头像' }
    finally { if(url)URL.revokeObjectURL(url);input.disabled=false;input.value='' }
  })
} }
