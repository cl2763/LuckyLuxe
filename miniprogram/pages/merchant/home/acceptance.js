const api=require('../../../utils/api')
module.exports={
  async loadAcceptances() {
    try { const r=await api.adminGet('/admin/booking-acceptances'); this.setData({pendingBookings:r.items||[],acceptanceError:''}) }
    catch(e) { this.setData({acceptanceError:'待确认预约加载失败，请重试'}) }
  },
  async confirmBooking(e) {
    const id=e.currentTarget.dataset.id
    if(!id||this.data.acceptingId)return
    this.setData({acceptingId:id})
    try { await api.adminPost('/admin/bookings/'+encodeURIComponent(id)+'/accept',{}); await this.loadAcceptances(); wx.showToast({title:'预约已确认',icon:'success'}) }
    catch(e) { wx.showToast({title:e.message||'确认失败，请重试',icon:'none'}) }
    finally { this.setData({acceptingId:''}) }
  },

}
