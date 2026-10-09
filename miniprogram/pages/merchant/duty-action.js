// Value assignment UI feedback shared separately from the large orders page.
module.exports = async function dutyAction(page, e, api) {
    const d = page.data.dv && page.data.dv.duty
    if (!d) return
    if (!d.canEdit) return wx.showToast({ title: d.note || '当前不可修改值日', icon: 'none' })
    if (page._savingDuty) return
    page._savingDuty = true
    const techId = e.currentTarget.dataset.id
    const on = !(d.techIds || []).includes(techId)
    try {
      await api.adminPost('/admin/duty/mark', { date: page.data.selDate, technicianId: techId, on })
      await page.loadDayView(page.data.selDate)
      wx.showToast({ title: on ? '已安排值日并发送站内提醒' : '已取消值日', icon: 'none' })
    } catch (err) { wx.showToast({ title: (err && err.message) || '值日保存失败', icon: 'none' }) }
    finally { page._savingDuty = false }
  }
