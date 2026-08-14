/* 屏 4a/4a-2 排班重设计(小程序)
   按「天」做行:每天一行列出所有技师的时段胶囊 —— 全天/半天/休息一眼分清
   (半天胶囊半填色),行尾当日在岗数。点任意胶囊弹时段编辑(4a-2):
   全天 / 上午 / 下午 / 自定义起止 / 休息,底部可勾「应用到之后每个周 N」。
   上下午分界默认 14:30,店铺可在这页顶部改 —— 后端 /admin/schedule-settings。
   时段与冲突判定都在后端:改时段撞上已有预约会回一份冲突单列表,这里只负责显示,不硬拦。 */
const api = require('../../../utils/api')
const { storeToday, refreshStoreClock } = require('../../../utils/storeclock')

const WK = ['日', '一', '二', '三', '四', '五', '六']
function shift(d, n) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
function wdOf(d) { return WK[new Date(`${d}T12:00:00Z`).getUTCDay()] }

Page({
  data: {
    from: '', days: [], techs: [], afternoonStart: '14:30', loading: true,
    isOwner: true, readOnly: false, myTechId: '', isThisWeek: true,
    sheet: null, conflicts: []
  },

  /* 🟠 D11(店主 2026-08-10 开检:「员工进我的排班显示『仅老板可见』一片空白」)。
     根因是**前端权限判断错了** —— 这页开头就 guardOwner(),员工一进来直接被弹走;
     而后端 /admin/schedule-week、schedule-day、schedule-settings 对员工**本来就是放行的**(实测全 200)。
     口径(店主原话):员工必须能看到自己的班表。所以改成:
     任何已登录的商家账号都进得来,**员工进来是只读、且只看自己那一列**;
     排班、改分界、批量上下班这些写操作仍然只有老板(后端写接口也照旧 owner-only)。
     「申请调休」入口属后续功能,没图不做(L3)。 */
  async onShow() {
    if (!(await api.guardMerchant())) return
    let isOwner = true
    let myTechId = ''
    try {
      const me = await api.adminMe()
      isOwner = !me || me.role === 'owner'
      myTechId = (me && me.technicianId) || ''
    } catch (e) { return }
    this.setData({ isOwner, myTechId, readOnly: !isOwner })
    await refreshStoreClock().catch(() => {})
    this.load(this.data.from || storeToday())
  },

  async load(from) {
    this.setData({ from, loading: true })
    try {
      const [week, settings] = await Promise.all([
        api.adminGet(`/admin/schedule-week?from=${encodeURIComponent(from)}`),
        api.adminGet('/admin/schedule-settings').catch(() => ({ afternoonStart: '14:30' }))
      ])
      let techs = (week.technicians || []).filter((t) => t.isActive !== false)
      // D11:员工只看自己那一列(看不到同事的班表)
      if (this.data.readOnly && this.data.myTechId) techs = techs.filter((t) => t.id === this.data.myTechId)
      const byKey = {}
      ;(week.schedules || []).forEach((s) => { byKey[`${s.date}|${s.technicianId}`] = s })
      const counts = {}
      ;(week.bookingCounts || []).forEach((c) => { counts[`${c.date}|${c.technicianId}`] = c.count })
      const split = settings.afternoonStart || '14:30'
      const today = storeToday()
      const days = (week.days || []).map((d) => {
        const caps = techs.map((t) => {
          const s = byKey[`${d.date}|${t.id}`]
          // 没排过班 = 跟随门店营业时间(视作全天),与后端 assertBookable 的兜底一致
          if (!s) return { techId: t.id, name: t.name, kind: 'full', label: '全天', working: true, count: counts[`${d.date}|${t.id}`] || 0 }
          if (!s.isWorking) return { techId: t.id, name: t.name, kind: 'off', label: '休息', working: false, count: 0 }
          const isAm = s.endTime === split
          const isPm = s.startTime === split
          const isFull = s.startTime === d.openTime && s.endTime === d.closeTime
          return {
            techId: t.id, name: t.name, working: true,
            kind: isFull ? 'full' : (isAm ? 'am' : (isPm ? 'pm' : 'custom')),
            label: isFull ? '全天' : (isAm ? '上午' : (isPm ? '下午' : `${s.startTime}-${s.endTime}`)),
            count: counts[`${d.date}|${t.id}`] || 0
          }
        })
        return {
          date: d.date,
          // D5:日期条上直接标出今天,翻页时一眼定位
          isToday: d.date === today,
          title: `${Number(d.date.slice(5, 7))}月${Number(d.date.slice(8))}日 周${wdOf(d.date)}`,
          isClosed: d.isClosed,
          openTime: d.openTime,
          closeTime: d.closeTime,
          onDuty: caps.filter((c) => c.working).length,
          caps
        }
      })
      // D4:本周才叫「本周」,翻走了叫「返回本周」
      this.setData({ loading: false, days, techs, afternoonStart: split, isThisWeek: days.some((x) => x.isToday) })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载排班失败', icon: 'none' })
    }
  },

  prevWeek() { this.load(shift(this.data.from, -7)) },
  nextWeek() { this.load(shift(this.data.from, 7)) },
  thisWeek() { this.load(storeToday()) },

  // ===== 屏 4a-2 时段编辑弹层 =====
  openSheet(e) {
    // D11:员工是只读态,点格子不开排班面板(写操作后端也仍然只有老板)
    if (this.data.readOnly) { wx.showToast({ title: '排班由店长安排,这里只看不改', icon: 'none' }); return }
    const { date, tech, name, kind } = e.currentTarget.dataset
    const day = this.data.days.find((d) => d.date === date)
    this.setData({
      conflicts: [],
      sheet: {
        date, tech, name, kind,
        weekday: wdOf(date),
        start: day ? day.openTime : '10:00',
        end: day ? day.closeTime : '19:00',
        repeat: false
      }
    })
  },
  closeSheet() { this.setData({ sheet: null, conflicts: [] }) },
  pickKind(e) { this.setData({ 'sheet.kind': e.currentTarget.dataset.k }) },
  onStart(e) { this.setData({ 'sheet.start': e.detail.value }) },
  onEnd(e) { this.setData({ 'sheet.end': e.detail.value }) },
  toggleRepeat() { this.setData({ 'sheet.repeat': !this.data.sheet.repeat }) },

  async saveShift() {
    if (this.data.readOnly) return
    const s = this.data.sheet
    const body = { date: s.date, applyToFollowingWeeks: s.repeat ? 8 : 0 }
    if (s.kind === 'custom') { body.startTime = s.start; body.endTime = s.end; body.isWorking = true }
    else body.shift = s.kind
    try {
      const r = await api.adminPatch(`/admin/technicians/${encodeURIComponent(s.tech)}/schedule`, body)
      const conflicts = r.conflicts || []
      if (conflicts.length) {
        // 只报不拦(后端已经写进去了),把撞上的单列出来让老板自己判断
        this.setData({ conflicts })
        wx.showToast({ title: `已保存,但有 ${conflicts.length} 单落在时段外`, icon: 'none', duration: 2600 })
      } else {
        this.setData({ sheet: null })
        wx.showToast({ title: s.repeat ? `已应用到之后每个周${s.weekday}` : '已保存', icon: 'none' })
      }
      this.load(this.data.from)
    } catch (e) { wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' }) }
  },

  editSplit() {
    if (this.data.readOnly) return
    wx.showModal({
      title: '上下午分界', editable: true, placeholderText: '如 14:30',
      content: '',
      success: async (r) => {
        if (!r.confirm || !/^\d{2}:\d{2}$/.test((r.content || '').trim())) return
        try {
          await api.adminPut('/admin/schedule-settings', { afternoonStart: r.content.trim() })
          wx.showToast({ title: '已保存,半天班边界跟着走', icon: 'none' })
          this.load(this.data.from)
        } catch (e) { wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  }
})
