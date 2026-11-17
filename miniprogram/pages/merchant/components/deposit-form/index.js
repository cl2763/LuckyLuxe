const api=require('../../../../utils/api')
const {storeMoney}=require('../../../../utils/storeclock')
Component({
 options:{styleIsolation:'apply-shared'},
 data:{loading:true,saving:false,error:'',config:null,modes:['按项目','固定金额','按比例'],waivers:['按会员等级设置','所有会员免定金','会员不减免']},
 lifetimes:{attached(){this.load()},detached(){this._version=(this._version||0)+1}},
 methods:{
  async load(){const v=this._version=(this._version||0)+1;this.setData({loading:true,error:''});try{
   const r=await api.adminGet('/admin/deposit-config');if(v!==this._version)return
   if(!r.config)throw Error('定金规则读取失败')
   const c=r.config;this._original=c
   this.setData({config:c,mode:['per_service','fixed','pct'].indexOf(c.mode),waiver:['by_tier','all','none'].indexOf(c.memberWaive),fixed:String(c.fixedAmountCents/100),fallback:String(c.fallbackAmountCents/100),pct:String(c.pct),hours:c.cancelPolicy.freeCancelHours==null?'':String(c.cancelPolicy.freeCancelHours),late:String(c.cancelPolicy.lateForfeitPct),noShow:String(c.cancelPolicy.noShowForfeitPct),grace:c.cancelPolicy.lateArrivalGraceMin==null?'':String(c.cancelPolicy.lateArrivalGraceMin),reschedule:c.cancelPolicy.rescheduleNoticeHours==null?'':String(c.cancelPolicy.rescheduleNoticeHours),retainTimes:String(c.cancelPolicy.depositRetainTimes),retainDays:c.retainValidDays==null?'':String(c.retainValidDays),currencyHint:storeMoney(0),summary:r.summaryRows?.zh||[]})
  }catch(e){if(v===this._version)this.setData({error:e.message||'读取失败，请重试'})}finally{if(v===this._version)this.setData({loading:false})}},
  enabled(e){if(!this.data.saving)this.setData({'config.enabled':e.detail.value})},
  flag(e){if(this.data.saving)return;const k=e.currentTarget.dataset.key;if(k==='deductible'||k==='cancelPolicy.refundable')this.setData({['config.'+k]:e.detail.value})},
  input(e){if(this.data.saving)return;const key=e.currentTarget.dataset.key;if(['fixed','fallback','pct','hours','late','noShow','grace','reschedule','retainTimes','retainDays'].includes(key))this.setData({[key]:e.detail.value})},
  select(e){if(this.data.saving)return;const key=e.currentTarget.dataset.key;if(['mode','waiver'].includes(key))this.setData({[key]:Number(e.detail.value)})},
  async save(){if(this.data.saving||!this.data.config)return;const d=this.data
   const cents=(v,label)=>{if(!/^\d+(\.\d{1,2})?$/.test(v)||Number(v)>1000000)throw Error(label+'须为有效非负金额，最多两位小数');return Math.round(Number(v)*100)}
   try{const body={expectedConfigRevision:d.config.configRevision,enabled:d.config.enabled,mode:['per_service','fixed','pct'][d.mode],memberWaive:['by_tier','all','none'][d.waiver]}
    if(d.mode===0)body.fallbackAmountCents=cents(d.fallback,'兜底金额')
    if(d.mode===1)body.fixedAmountCents=cents(d.fixed,'固定金额')
    if(d.mode===2){if(!/^\d+(\.\d{1,2})?$/.test(d.pct)||Number(d.pct)>100)throw Error('比例须为0至100');body.pct=Number(d.pct)}
    if(d.hours!==''&&(!/^\d+$/.test(d.hours)||Number(d.hours)>8760))throw Error('取消时限须为0至8760小时，留空不限')
    const integer=(v,label,max,nullable=false)=>{if(nullable&&v==='')return null;if(!/^\d+$/.test(v)||Number(v)>max)throw Error(label+'须为0至'+max+'的整数');return Number(v)}
    body.deductible=d.config.deductible;body.retainValidDays=integer(d.retainDays,'留存有效天数',3650,true)
    body.cancelPolicy={refundable:d.config.cancelPolicy.refundable,freeCancelHours:d.hours===''?null:Number(d.hours),lateForfeitPct:integer(d.late,'临时取消扣除比例',100),noShowForfeitPct:integer(d.noShow,'爽约扣除比例',100),lateArrivalGraceMin:integer(d.grace,'迟到宽限分钟',1440,true),rescheduleNoticeHours:integer(d.reschedule,'改期提前小时',8760,true),depositRetainTimes:integer(d.retainTimes,'可留存次数',100)}
    this.setData({saving:true,error:''});await api.adminPut('/admin/deposit-config',{config:body});await this.load();wx.showToast({title:'规则已保存',icon:'none'});this.triggerEvent('saved')
   }catch(e){this.setData({error:e.message||'保存失败，输入已保留'})}finally{this.setData({saving:false})}
  }
 }
})
