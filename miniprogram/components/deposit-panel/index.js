const api=require('../../utils/api'),P=require('../../utils/member-pricing'),{storeMoney}=require('../../utils/storeclock')
Component({
 properties:{workflow:{type:Object,value:null},bookingId:String,merchant:{type:Boolean,value:false},compact:{type:Boolean,value:false},editorOnly:{type:Boolean,value:false}},
 data:{form:null,historyOpen:false,busy:false,error:'',channels:['线下转账','现金','刷卡','其他'],channelKeys:['transfer','cash','card','unknown'],channelIndex:0,amount:'',note:'',operator:'',pending:false},
 lifetimes:{detached(){this._cancelResolve?.(null)}},
 methods:{
  async confirmCancel(id){try{const preview=await api.adminGet('/admin/bookings/'+encodeURIComponent(id)+'/deposit-cancel-preview');this.setData({cancelPreview:preview});return await new Promise(resolve=>{this._cancelResolve=resolve})}catch(e){wx.showToast({title:e.message||'取消信息加载失败',icon:'none'});return null}},
  cancelDecision(e){const result=e.currentTarget.dataset.confirm?this.data.cancelPreview:null;this.setData({cancelPreview:null});this._cancelResolve?.(result);this._cancelResolve=null},
  swallow(){},
  key(){return 'deposit:'+api.currentTenantId()+':'+this.data.bookingId},
  async openForm(e){if(!this.data.merchant||this.data.busy)return;try{const r=await api.adminGet('/admin/bookings/'+encodeURIComponent(this.data.bookingId)+'/deposit-receipt'),old=P.pending(this.key()),kind=old?(old.path.endsWith('deposit-refund')?'refund':'collect'):e.currentTarget.dataset.kind;this._workflow=r.workflow;this.setData({form:kind,workflow:r.workflow,operator:r.operator,bookingLabel:r.bookingLabel,amount:old?String(old.body.amountCents/100):kind==='refund'?r.workflow.display.refundAmountValue:r.workflow.display.collectAmountValue,collectConfirm:'确认已收到 '+storeMoney(old?old.body.amountCents:Math.round(Number(r.workflow.display.collectAmountValue)*100),2),note:old?.body.note||'',channelIndex:old?Math.max(0,this.data.channelKeys.indexOf(old.body.payChannel)):0,error:'',pending:!!old})}catch(e){wx.showToast({title:e.message||'定金信息加载失败',icon:'none'})}},
  closeForm(){if(!this.data.busy)this.setData({form:null})},
  amountInput(e){this.setData({amount:e.detail.value,collectConfirm:'确认已收到 '+storeMoney(Math.round(Number(e.detail.value||0)*100),2)})},
  noteInput(e){this.setData({note:e.detail.value})},
  channelChange(e){this.setData({channelIndex:Number(e.detail.value)})},
  async save(){if(this.data.busy)return;const old=P.pending(this.key());if(!old&&!/^\d+(\.\d{1,2})?$/.test(this.data.amount)){this.setData({error:'请输入大于零、最多两位小数的实际金额'});return}this.setData({busy:true,error:''});try{const out=await P.mutation(this.key(),'/admin/bookings/'+encodeURIComponent(this.data.bookingId)+(this.data.form==='refund'?'/deposit-refund':'/deposit-receipt'),{amountCents:Math.round(Number(this.data.amount)*100),payChannel:this.data.channelKeys[this.data.channelIndex],note:this.data.note},(u,b)=>api.adminPost(u,b),!!old);this.setData({workflow:out.workflow,form:null,pending:false});this.triggerEvent('updated',{booking:out.booking});wx.showToast({title:'已登记，记录已保存',icon:'none'})}catch(e){this.setData({error:e.message||'登记失败，请重试',pending:!!P.pending(this.key())})}finally{this.setData({busy:false})}},
  history(){this.setData({historyOpen:!this.data.historyOpen})}
 }
})