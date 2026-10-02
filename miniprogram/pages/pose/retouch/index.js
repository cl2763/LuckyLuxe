const access=require('../access')
const draft=require('../draft')
Page({data:{files:[],sourceCardId:'',busy:false,error:''},
 onLoad(){this.tenant=access.tenant();const d=draft.take(this.tenant);if(d)this.setData({files:d.files,sourceCardId:d.sourceCardId})},
 onShow(){if(!access.guard())return;if(this.tenant!==access.tenant()){this.setData({files:[],sourceCardId:''});this.tenant=access.tenant();draft.clear()}},
 onUnload(){draft.clear();this.setData({files:[],sourceCardId:''})},
 choose(){if(this.data.busy||!access.guard())return;const tenant=access.tenant();this.setData({busy:true,error:''});wx.chooseMedia({count:4,mediaType:['image'],sourceType:['album'],sizeType:['original'],success:r=>{if(tenant===access.tenant())this.setData({files:(r.tempFiles||[]).map(f=>f.tempFilePath).filter(Boolean).slice(0,4),sourceCardId:''})},fail:e=>{if(!/cancel/i.test(e.errMsg||''))this.setData({error:'无法读取相册，请检查微信权限后重试。'})},complete:()=>this.setData({busy:false})})},
 preview(e){if(!access.guard()||this.tenant!==access.tenant())return;const current=this.data.files[Number(e.currentTarget.dataset.index)];if(current)wx.previewImage({current,urls:this.data.files,fail:()=>this.setData({error:'图片预览失败，请重新选择。'})})},
 clear(){this.setData({files:[],sourceCardId:'',error:''});draft.clear()}
})
