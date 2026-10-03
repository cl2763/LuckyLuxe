const catalog=require('../catalog')
const access=require('../access')
const draft=require('../draft')
const nav=require('../../../utils/nav')
Page({data:{card:null,sections:[],busy:false,error:'',imageError:false},
 onLoad(q){const c=catalog.find(q.id);if(!c){this.setData({error:'未找到这张姿势卡，请返回重新选择。'});return}this.setData({card:c,sections:[['手怎么摆',c.pose],['机位',c.cam],['光线',c.light],['背景',c.bg],['避坑',c.avoid],['适合',c.length+'甲 · '+c.shot+' · '+c.style]].map(([title,text])=>({title,text}))})},
 onShow(){access.guard()},
 failedImage(){this.setData({imageError:true})},
 choose(e){if(this.data.busy||!this.data.card||!access.guard())return;const source=e.currentTarget.dataset.source;if(!['camera','album'].includes(source))return;this.setData({busy:true,error:''});const tenant=access.tenant();wx.chooseMedia({count:4,mediaType:['image'],sourceType:[source],sizeType:['original'],success:r=>{if(tenant!==access.tenant())return;const files=(r.tempFiles||[]).map(f=>f.tempFilePath).filter(Boolean).slice(0,4);if(!files.length)return;draft.put(tenant,this.data.card.id,files);nav.to('/pages/pose/retouch/index')},fail:e=>{if(!/cancel/i.test(e.errMsg||''))this.setData({error:'无法打开相机或相册，请检查微信权限后重试。'})},complete:()=>this.setData({busy:false})})}
})
