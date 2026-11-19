const api=require('../../../utils/api')
const {storeToday}=require('../../../utils/storeclock')
Page({
 data:{isOwner:false,loading:true,error:'',services:[],technicians:[],techEmptyReason:'',stores:[],si:0,ti:0,oi:0,date:'',time:'',notes:'',busy:false,draft:null,qrUrl:''},
 async onShow(){if(await api.guardMerchant()){this.setData({isOwner:api.getAdminAuth()?.admin?.role==='owner'});if(this.loadedOnce)await this.load()}},
 onLoad(){this.setData({date:storeToday()});this.load()},
 async load(){this.setData({loading:true,error:''});try{const o=await api.adminGet('/admin/booking-draft-options');this.allTechs=o.technicians||[];this.setData({services:o.services||[],stores:o.stores||[]});this.filterTechs()}catch(e){this.setData({error:e.message||'加载失败，请重试。'})}finally{this.loadedOnce=true;this.setData({loading:false})}},
 filterTechs(){
  const s=this.data.services[this.data.si],o=this.data.stores[this.data.oi]
  const storeTechs=(this.allTechs||[]).filter(t=>t.store_id===o?.id)
  const technicians=storeTechs.filter(t=>Array.isArray(t.serviceIds)&&t.serviceIds.includes(s?.id))
  const techEmptyReason=!o?'请先配置营业门店。':!s?'请先配置服务项目。':!storeTechs.length?'当前账号没有可选的本店在职技师，请老板检查技师状态及员工账号关联。':'此项目尚未关联可选的在职技师，请老板在技师服务分工中配置。'
  this.setData({ti:0,technicians,techEmptyReason:technicians.length?'':techEmptyReason,draft:null})
 },
 choose(e){this.setData({[e.currentTarget.dataset.key]:Number(e.detail.value),draft:null});this.filterTechs()},
 chooseTech(e){this.setData({ti:Number(e.detail.value),draft:null})},
 input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value,draft:null})},
 async generate(){if(this.data.busy)return;this.setData({busy:true,error:''});try{const d=this.data;const out=await api.adminPost('/admin/booking-drafts',{sourceChannel:'admin_manual',storeId:d.stores[d.oi]?.id,serviceId:d.services[d.si]?.id,technicianId:d.technicians[d.ti]?.id,date:d.date,time:d.time,notes:d.notes});this.setData({draft:out.bookingDraft});wx.showToast({title:'草稿已生成',icon:'success'})}catch(e){this.setData({error:e.message||'生成失败，请重试。'})}finally{this.setData({busy:false})}},
 onShareAppMessage(){const d=this.data.draft;return d?{title:'请确认您的预约：'+d.service.name,path:`/pages/booking-draft/index?id=${encodeURIComponent(d.id)}&tenant=${encodeURIComponent(d.tenantId)}`}:{title:'有迹',path:'/pages/entry/index'}},
 copyLink(){const d=this.data.draft;if(d)wx.setClipboardData({data:d.linkUrl,fail:e=>this.setData({error:e.errMsg||'复制失败，请重试。'})})}
})
