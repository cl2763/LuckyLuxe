const api=require('../../../utils/api')
Page({
 data:{ready:false,error:'',userId:'',name:'',grantId:'',eventId:'',isOwner:false},
 onLoad(q){this.setData({userId:q.userId||'',name:q.name?decodeURIComponent(q.name):'顾客',grantId:q.grantId||'',eventId:q.eventId||''})},
 async onShow(){if(!api.guardMerchant())return;try{const me=await api.adminMe();if(this.data.eventId&&me.role!=='owner')throw Error('更正领取需要老板操作');if(!this.data.userId||!this.data.grantId)throw Error('缺少领取信息，请返回客户档案重新打开');this.setData({ready:true,isOwner:me.role==='owner',error:''})}catch(e){this.setData({error:e.message||'读取失败，请重试'})}},
 retry(){this.onShow()}
})
