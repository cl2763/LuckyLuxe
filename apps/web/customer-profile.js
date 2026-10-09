/* Profile photo editor shared with the mini-program /my/profile endpoint. */
window.LLCustomerProfile = { bind({ request, onSaved, toast, isEnglish }) {
  document.addEventListener('change', async event => {
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
