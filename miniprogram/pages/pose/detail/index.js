const catalog=require('../catalog')
const access=require('../access')
Page({data:{card:null,sections:[],busy:false,error:'',imageError:false},
 onLoad(q){const c=catalog.find(q.id);if(!c){this.setData({error:'未找到这张姿势卡，请返回重新选择。'});return}this.setData({card:c,sections:[['手怎么摆',c.pose],['机位',c.cam],['光线',c.light],['背景',c.bg],['避坑',c.avoid],['适合',c.length+'甲 · '+c.shot+' · '+c.style]].map(([title,text])=>({title,text}))})},
 onShow(){access.guard()},
 failedImage(){this.setData({imageError:true})}
})
