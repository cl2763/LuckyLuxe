const api=require('../../utils/api')
const nav=require('../../utils/nav')
Page({
 data:{loading:true,error:'',draft:null,busy:false,done:false,bookingId:''},
 onLoad(q){this.id=q.id||''; if(q.tenant&&q.tenant!==api.currentTenantId()){api.onStoreSwitched();wx.setStorageSync('lucky_tenant',q.tenant)}this.load()},
 async load(){this.setData({loading:true,error:''});try{const d=await api.getBookingDraft(this.id);const draft=d.bookingDraft;this.setData({draft,done:draft.status==='BOOKING_CREATED',error:draft.status!=='BOOKING_CREATED'&&(draft.status!=='DRAFT'||Date.parse(draft.expiresAt)<=Date.now())?'草稿已过期，请让店员重新生成。':''})}catch(e){this.setData({error:e.message||'加载失败，请重试。'})}finally{this.setData({loading:false})}},
 async confirm(){if(this.data.busy)return;this.setData({busy:true,error:''});try{await api.loginWithWechat();const d=this.data.draft;const b=await api.createBooking({storeId:d.storeId,serviceId:d.serviceId,bookingDraftId:d.id,appointmentInfo:{technicianId:d.technicianId,date:d.date,time:d.time,referenceImages:d.referenceImages||[],sourceChannel:'admin_manual',remark:d.notes||''}},d.notes||'');this.setData({done:true,bookingId:b.id});wx.showToast({title:'预约已确认',icon:'success'})}catch(e){this.setData({error:e.message||'确认未完成，请重试。'})}finally{this.setData({busy:false})}},
 orders(){nav.redirect('/pages/orders/index')},
 home(){nav.tab('/pages/me/index')}
})
