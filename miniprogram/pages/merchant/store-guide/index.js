const api=require('../../../utils/api')
Page({
 behaviors:[require('../../../utils/media-privacy')],
 data:{steps:[],revision:0,loading:true,loaded:false,error:'',busy:false,preview:false,dirty:false,mediaPrivacyCopy:'选择你要展示的门店入口、停车或上楼路线照片。'},
 async onLoad(o){this.storeId=o.storeId;if(await api.guardOwner())this.load()},
 async load(){this.setData({loading:true,error:''});try{const r=await api.adminGet('/admin/store-guide?storeId='+encodeURIComponent(this.storeId));r.steps=r.steps.map(s=>({...s,image:s.image.startsWith('/')?api.API_BASE+s.image:s.image}));this.setData({...r,loaded:true,dirty:false})}catch(e){this.setData({error:e.message||'加载失败，请重试'})}finally{this.setData({loading:false})}},
 change(e){const i=Number(e.currentTarget.dataset.i);this.setData({['steps['+i+'].description']:e.detail.value,dirty:true});this.warnLeave()},
 warnLeave(){if(wx.enableAlertBeforeUnload)wx.enableAlertBeforeUnload({message:'到店指引尚未保存，确定离开？'})},
 pick(e){if(this.data.busy)return;const i=e.currentTarget.dataset.i;if(i===undefined&&this.data.steps.length>=6)return;this.withMediaPrivacy(()=>this.choose(i))},
 choose(index){wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success:async r=>{
  this.setData({busy:true,error:''});try{
   const path=r.tempFiles[0].tempFilePath
   let base64=''
   for(const width of [1200,900,600,400]){
    const compressed=await new Promise((resolve,reject)=>wx.compressImage({src:path,quality:60,compressedWidth:width,success:r=>resolve(r.tempFilePath),fail:reject}))
    base64=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:compressed,encoding:'base64',success:r=>resolve(r.data),fail:reject}))
    if(base64.length<=130000)break
   }
   const mime=base64.startsWith('/9j/')?'jpeg':base64.startsWith('iVBOR')?'png':base64.startsWith('UklGR')?'webp':''
   if(!mime||base64.length>130000)throw Error('图片过大或格式不支持，请换一张图片')
   const steps=this.data.steps.slice(),image='data:image/'+mime+';base64,'+base64
   if(index===undefined)steps.push({image,description:''});else steps[Number(index)]={...steps[Number(index)],image}
   this.setData({steps,dirty:true});this.warnLeave()
  }catch(e){this.setData({error:e.message||'图片读取失败，草稿已保留，请重试'})}finally{this.setData({busy:false})}
 },fail:e=>{if(!/cancel/.test(e.errMsg||''))this.setData({error:'无法打开选图，请重试并检查微信隐私授权'})}})},
 move(e){if(this.data.busy)return;const i=Number(e.currentTarget.dataset.i),j=i+Number(e.currentTarget.dataset.dir),steps=this.data.steps.slice();if(j<0||j>=steps.length)return;[steps[i],steps[j]]=[steps[j],steps[i]];this.setData({steps,dirty:true});this.warnLeave()},
 remove(e){if(this.data.busy)return;const i=Number(e.currentTarget.dataset.i);wx.showModal({title:'删除这一步？',content:'保存后顾客将不再看到这一步。',success:r=>{if(r.confirm){const steps=this.data.steps.slice();steps.splice(i,1);this.setData({steps,dirty:true});this.warnLeave()}},fail:()=>this.setData({error:'未能打开确认窗口，请重试'})})},
 preview(){this.setData({preview:!this.data.preview})},
 photo(e){require('../../../utils/guide-preview')(e.currentTarget.dataset.src)},
 async save(){if(this.data.busy)return;this.setData({busy:true,error:''});try{const r=await api.adminPut('/admin/store-guide',{storeId:this.storeId,revision:this.data.revision,steps:this.data.steps.map(s=>({...s,image:s.image.startsWith(api.API_BASE+'/store-guide/image?')?s.image.slice(api.API_BASE.length):s.image}))});r.steps=r.steps.map(s=>({...s,image:s.image.startsWith('/')?api.API_BASE+s.image:s.image}));this.setData({...r,loaded:true,dirty:false});if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload();wx.showToast({title:'已保存',icon:'success'})}catch(e){this.setData({error:(e.message||'保存失败')+'；草稿已保留'})}finally{this.setData({busy:false})}}
})
