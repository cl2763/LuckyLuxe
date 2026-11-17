const api=require('./api')
exports.methods=key=>({
 fillBusinessHours(){if(this.data.saving||this.data.shiftReviewLoading||this.data[key]?.isClosed)return;this._shiftReviewed=null;this.setData({[key+'.kind']:'full',shiftPreview:null,shiftReviewError:''})},
 shiftDuration(e){this._shiftReviewed=null;this.setData({shiftDuration:e.detail.value,shiftPreview:null})},
 shiftPreviewPayload(){const s=this.data[key];if(!s)return null;return {technicianId:s.tech,date:s.date,durationMin:Number(this.data.shiftDuration||120),applyToFollowingWeeks:s.repeat?8:0,...(s.kind==='custom'?{startTime:s.start,endTime:s.end,isWorking:true}:{shift:s.kind})}},
 async previewShift(){const body=this.shiftPreviewPayload();if(!body||this.data.shiftReviewLoading)return;this.setData({shiftReviewLoading:true,shiftReviewError:''});const hash=JSON.stringify(body);try{const r=await api.adminPost('/admin/schedule-preview',body);if(hash!==JSON.stringify(this.shiftPreviewPayload()))return;this._shiftReviewed=hash;this.setData({shiftPreview:r})}catch(e){this._shiftReviewed=null;this.setData({shiftPreview:null,shiftReviewError:e.message||'无法核对，请重试'})}finally{this.setData({shiftReviewLoading:false})}},
 async ensureShiftReviewed(){const body=this.shiftPreviewPayload();if(!body)return false;if(this._shiftReviewed===JSON.stringify(body))return true;await this.previewShift();return false}
})
