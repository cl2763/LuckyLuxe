/* 09-24 已确认合同：首次设置/门店设置共用；批量应用只改草稿。 */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const clone = v => JSON.parse(JSON.stringify(v))
Component({
  properties: {
    initial: { type: null, value: null },
    txt: { type: Object, value: {} },
    saving: { type: Boolean, value: false },
    saveLabel: { type: String, value: '' },
    saveError: { type: String, value: '' }
  },
  data: { days: [], anyOpen: false, canSave: false, batchStart: '', batchEnd: '', scopeIndex: 0, message: '', error: false, canUndo: false, scopeLabels: [] },
  observers: {
    initial() { this.rebuild() },
    txt(txt) { this.setData({ scopeLabels: [txt.scopeAll || '', txt.scopeOpen || ''] }); this.relabel() },
    saveError(value) { if (value) this.setData({ message: this.data.txt.failed || value, error: true }) }
  },
  lifetimes: { attached() { this.rebuild() } },
  methods: {
    rebuild() {
      const byDay = {}; (this.data.initial || []).forEach(h => { byDay[h.weekday] = h })
      const days = DAY_ORDER.map(w => {
        const h = byDay[w], open = h ? !h.isClosed : false
        return { weekday: w, name: (this.data.txt.dayNames || DAY_NAMES)[w], open, openTime: open ? (h.openTime || '') : '', closeTime: open ? (h.closeTime || '') : '' }
      })
      this._undo = null
      this.setData({ batchStart: '', batchEnd: '', scopeIndex: 0, message: '', error: false, canUndo: false, scopeLabels: [this.data.txt.scopeAll || '', this.data.txt.scopeOpen || ''] })
      this.updateDays(days)
    },
    relabel() { if (this.data.days) this.updateDays(this.data.days.map(d => Object.assign({}, d, { name: (this.data.txt.dayNames || DAY_NAMES)[d.weekday] }))) },
    updateDays(days) { const anyOpen = days.some(d => d.open); this.setData({ days, anyOpen, canSave: anyOpen && days.every(d => !d.open || /^([01]\d|2[0-3]):[0-5]\d$/.test(d.openTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.closeTime) && d.openTime < d.closeTime) }) },
    toggleDay(e) { if (this.data.saving) return; const i = Number(e.currentTarget.dataset.i), days = clone(this.data.days); days[i].open = !days[i].open; this.updateDays(days) },
    pickOpen(e) { this.pickDay(e, 'openTime') },
    pickClose(e) { this.pickDay(e, 'closeTime') },
    pickDay(e, key) { if (this.data.saving) return; const days = clone(this.data.days); days[Number(e.currentTarget.dataset.i)][key] = e.detail.value; this.updateDays(days) },
    pickBatchStart(e) { if (!this.data.saving) this.setData({ batchStart: e.detail.value }) },
    pickBatchEnd(e) { if (!this.data.saving) this.setData({ batchEnd: e.detail.value }) },
    pickScope(e) { if (!this.data.saving) this.setData({ scopeIndex: Number(e.detail.value) }) },
    applyBatch() {
      if (this.data.saving) return
      const { batchStart, batchEnd, scopeIndex, txt } = this.data
      const count = this.data.days.filter(d => scopeIndex === 0 || d.open).length
      let error = ''
      if (!batchStart || !batchEnd) error = txt.missing
      else if (batchStart >= batchEnd) error = txt.order
      else if (!count) error = txt.noTargets
      if (error) { this.setData({ error: true, message: error }); return }
      this._undo = clone(this.data.days)
      this.updateDays(this.data.days.map(d => scopeIndex === 0 || d.open ? Object.assign({}, d, { open: true, openTime: batchStart, closeTime: batchEnd }) : d))
      this.setData({ error: false, canUndo: true, message: (txt.applied || '').replace('{count}', count) })
    },
    undoBatch() { if (this.data.saving || !this._undo) return; this.updateDays(clone(this._undo)); this._undo = null; this.setData({ canUndo: false, message: this.data.txt.undone, error: false }) },
    save() {
      if (this.data.saving || !this.data.canSave) return
      this.triggerEvent('save', { hours: this.data.days.map(d => d.open ? { weekday: d.weekday, openTime: d.openTime, closeTime: d.closeTime, isClosed: false } : { weekday: d.weekday, isClosed: true }) })
    }
  }
})
