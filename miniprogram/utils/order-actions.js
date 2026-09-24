const api = require('./api')
module.exports = {
  async openReschedule(id) {
    let b=(this.data.raw||[]).find(x=>x.id===id)
    if(!b){try{b=((await api.adminGet('/admin/bookings')).bookings||[]).find(x=>x.id===id)}catch(e){wx.showToast({title:e.message||'订单加载失败',icon:'none'});return}}
    if(!b){wx.showToast({title:'请刷新订单后重试',icon:'none'});return}
    this.setData({rescheduleSheet:{id,date:b.appointmentDate,time:b.appointmentTime,expectedStart:b.appointmentStart},rescheduleBusy:false})
  },
  changeRescheduleDate(e){this.setData({'rescheduleSheet.date':e.detail.value})},
  changeRescheduleTime(e){this.setData({'rescheduleSheet.time':e.detail.value})},
  closeReschedule(){if(!this.data.rescheduleBusy)this.setData({rescheduleSheet:null})},
  async submitReschedule(){
    if(this.data.rescheduleBusy||!this.data.rescheduleSheet)return
    const b=this.data.rescheduleSheet;this.setData({rescheduleBusy:true})
    try{await api.adminPost(`/admin/bookings/${encodeURIComponent(b.id)}/reschedule`,{date:b.date,time:b.time,expectedStart:b.expectedStart});this.setData({rescheduleSheet:null});wx.showToast({title:'预约已改期',icon:'none'});this.loadList();this.loadDayView(this.data.selDate)}
    catch(e){wx.showModal({title:'未能改期',content:e.message||'请重试，原预约未改变',showCancel:false,fail:err=>console.warn('[改期提示失败]',err)})}
    finally{this.setData({rescheduleBusy:false})}
  },

  tapGridAct(o) {
    const b = this._panelCtx
    const sheets = this._panelSheets || []
    if (o.act === 'reschedule') return this.openReschedule(b.id)
    if (o.act === 'arrive') this.setArrival(b.id, true)
    else if (o.act === 'unarrive') this.setArrival(b.id, false)
    else if (o.act === 'settle') this.goSettle(b)
    else if (o.act === 'preview') this.openPreview((sheets.find((x) => x.status !== 'voided') || {}).id)
    else if (o.act === 'sheets') this.showSheets(sheets)
    else if (o.act === 'note') this.goNote(b)
    else if (o.act === 'void') this.voidSheets(sheets.filter((x) => x.status === 'pending_sign'), b)
    else if (o.act === 'paid') this.markDepositPaid(b)
  },

}
