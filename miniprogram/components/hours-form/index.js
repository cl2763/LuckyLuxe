/* 营业时间表单组件(《营业时间强制设置图 v1.1》· 裁定2 收敛:一份组件两处挂载 ——
   强制页 pages/merchant/hours-setup 与 门店设置 pages/merchant/store,不许再各写一份。
   合同二:七天开关+起止;至少一天营业才可存(前端灰=体验,A2 后端终闸在 PUT 里)。
   合同三:无 initial(强制页)= 七天全不勾零预填;有 initial(门店设置)= 只回填真实行,
   缺行=不勾+时间空(这天没配过,不编 10:00-19:00)。 */
const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

Component({
  properties: {
    /* 真实行数组 [{weekday,isClosed,openTime,closeTime}] 或 null(强制页零预填) */
    initial: { type: null, value: null },
    txt: { type: Object, value: {} },
    saving: { type: Boolean, value: false },
    saveLabel: { type: String, value: '' }
  },
  data: { days: [], anyOpen: false },
  observers: {
    initial() { this.rebuild() }
  },
  lifetimes: { attached() { this.rebuild() } },
  methods: {
    rebuild() {
      const byDay = {}
      ;(this.data.initial || []).forEach((h) => { byDay[h.weekday] = h })
      const days = DAY_ORDER.map((w) => {
        const h = byDay[w]
        const open = h ? !h.isClosed : false
        return {
          weekday: w, name: DAY_NAMES[w], open,
          /* 哨兵不回显:休息行存的 00:00 只是占位,读口先看 is_closed(零回落) */
          openTime: open ? (h.openTime || '') : '',
          closeTime: open ? (h.closeTime || '') : ''
        }
      })
      this.setData({ days, anyOpen: days.some((d) => d.open) })
    },
    toggleDay(e) {
      const i = Number(e.currentTarget.dataset.i)
      const days = this.data.days.slice()
      days[i] = Object.assign({}, days[i], { open: !days[i].open })
      this.setData({ days, anyOpen: days.some((d) => d.open) })
    },
    pickOpen(e) {
      const i = Number(e.currentTarget.dataset.i)
      const days = this.data.days.slice()
      days[i] = Object.assign({}, days[i], { openTime: e.detail.value })
      this.setData({ days })
    },
    pickClose(e) {
      const i = Number(e.currentTarget.dataset.i)
      const days = this.data.days.slice()
      days[i] = Object.assign({}, days[i], { closeTime: e.detail.value })
      this.setData({ days })
    },
    save() {
      const { days, anyOpen } = this.data
      if (!anyOpen || this.data.saving) return
      for (const d of days) {
        if (d.open && (!d.openTime || !d.closeTime)) { wx.showToast({ title: `${d.name}还没选时间`, icon: 'none' }); return }
        if (d.open && d.openTime >= d.closeTime) { wx.showToast({ title: `${d.name}的开始时间要早于结束时间`, icon: 'none' }); return }
      }
      this.triggerEvent('save', {
        hours: days.map((d) => (d.open
          ? { weekday: d.weekday, openTime: d.openTime, closeTime: d.closeTime, isClosed: false }
          : { weekday: d.weekday, isClosed: true }))
      })
    }
  }
})
