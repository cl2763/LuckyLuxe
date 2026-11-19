const api=require('../../../utils/api')
Page({
 data:{loading:true,error:'',technicians:[],services:[],ti:0,choices:[],saving:false,dirty:false},
 async onShow(){if(await api.guardOwner())await this.load()},
 async load(){this.setData({loading:true,error:''});try{const r=await api.adminGet('/admin/technician-services');this.setData({technicians:r.technicians,services:r.services});this.select(0)}catch(e){this.setData({error:e.message||'加载失败'})}finally{this.setData({loading:false})}},
 select(i){const t=this.data.technicians[i];this.setData({ti:i,dirty:false,choices:this.data.services.map(s=>({...s,checked:!!t&&t.serviceIds.includes(s.id)}))})},
 chooseTech(e){if(this.data.saving)return;const i=Number(e.detail.value);if(this.data.dirty){wx.showModal({title:'切换技师？',content:'尚未保存的服务选择将被放弃。',success:r=>{if(r.confirm)this.select(i)},fail:()=>wx.showToast({title:'请先保存当前选择',icon:'none'})})}else this.select(i)},
 toggle(e){if(this.data.saving)return;const id=e.currentTarget.dataset.id;this.setData({dirty:true,choices:this.data.choices.map(s=>s.id===id?{...s,checked:!s.checked}:s)})},
 async save(){const tech=this.data.technicians[this.data.ti];if(!tech||this.data.saving)return;this.setData({saving:true,error:''});try{await api.adminPatch('/admin/technicians/'+encodeURIComponent(tech.id),{serviceIds:this.data.choices.filter(s=>s.checked).map(s=>s.id)});this.setData({['technicians['+this.data.ti+'].serviceIds']:this.data.choices.filter(s=>s.checked).map(s=>s.id),dirty:false});wx.showToast({title:'服务分工已保存',icon:'success'})}catch(e){this.setData({error:e.message||'保存失败，选择已保留'})}finally{this.setData({saving:false})}}
})
