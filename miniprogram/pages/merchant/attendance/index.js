const api = require('../../../utils/api')

function fmtDur(min) {
  if (!min || min <= 0) return '0m'
  const h = Math.floor(min / 60); const m = min % 60
  return h ? `${h}h${m ? m + 'm' : ''}` : `${m}m`
}
function pad(n) { return `${n}`.padStart(2, '0') }

Page({
  data: {
    role: '',
    isOwner: false,
    dateText: '',
    nowText: '',
    // WiFi 状态(员工打卡校验;开发者工具拿不到 WiFi 属正常)
    wifi: { ssid: '', bssid: '', got: false },
    wifiTip: '',
    // 员工
    today: null, scheduledEnd: '', week: [],
    clocking: false,
    // 老板看板
    board: { working: 0, done: 0, overtime: 0, rows: [] },
    // 老板修正弹层
    fixSheet: false, fixRow: null, fixIn: '', fixOut: ''
  },

  onShow() {
    const d = new Date()
    this.setData({
      dateText: `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`,
      nowText: `${pad(d.getHours())}:${pad(d.getMinutes())}`
    })
    this.load()
    this.getWifi()
  },

  async load() {
    try {
      const me = await api.adminMe()
      const isOwner = me && me.role === 'owner'
      this.setData({ role: me.role || '', isOwner })
      const r = await api.adminGet('/admin/attendance/today')
      // 时间一律显示门店时区(多伦多),避免店主/员工设备时区不同造成困惑
      if (r.storeNow) this.setData({ nowText: r.storeNow })
      const sd = r.storeDate || r.date
      if (sd) this.setData({ dateText: `${Number(sd.slice(5, 7))}月${Number(sd.slice(8, 10))}日 周${'日一二三四五六'[new Date(`${sd}T12:00:00`).getDay()]}` })
      if (isOwner) {
        const rows = (r.rows || []).map((x) => ({
          ...x, av: (x.name || '技')[0],
          workedText: fmtDur(x.workedMin), overText: fmtDur(x.overtimeMin),
          stateLabel: x.state === 'working' ? '在岗' : x.state === 'overtime' ? '超时未走' : x.state === 'done' ? '已下班' : x.state === 'rest' ? '休息' : '未上班'
        }))
        this.setData({ board: { working: r.working || 0, done: r.done || 0, overtime: r.overtime || 0, rows } })
      } else {
        const week = (r.week || []).map((w) => ({
          ...w,
          dayText: `${Number(w.date.slice(5, 7))}/${Number(w.date.slice(8, 10))} 周${'日一二三四五六'[new Date(`${w.date}T12:00:00`).getDay()]}`,
          workedText: w.abnormal ? '异常' : (w.clockOut ? `工时 ${fmtDur(w.workedMin)}` : (w.clockIn ? '进行中' : '—')),
          overText: w.overtimeMin ? ` 加班${fmtDur(w.overtimeMin)}` : ''
        }))
        const today = r.today ? {
          ...r.today,
          workedText: r.today.abnormal ? '' : fmtDur(r.today.workedMin),
          overText: r.today.overtimeMin ? fmtDur(r.today.overtimeMin) : ''
        } : null
        this.setData({ today, scheduledEnd: r.scheduledEnd || '', week })
      }
    } catch (e) { wx.showToast({ title: '加载考勤失败', icon: 'none' }) }
  },

  // 取当前 WiFi(iOS 需定位授权;开发者工具通常拿不到,属正常,打卡仍可发起由后端按白名单判)
  getWifi() {
    const done = (ssid, bssid) => this.setData({ wifi: { ssid, bssid, got: Boolean(bssid) }, wifiTip: bssid ? `已连接 WiFi · ${ssid || '未知名称'}` : '未获取到 WiFi(真机需定位授权;开发工具拿不到属正常)' })
    try {
      wx.startWifi({
        success: () => wx.getConnectedWifi({
          success: (r) => done((r.wifi && r.wifi.SSID) || '', (r.wifi && r.wifi.BSSID) || ''),
          fail: () => done('', '')
        }),
        fail: () => done('', '')
      })
    } catch (e) { done('', '') }
  },

  async clock(e) {
    if (this.data.clocking) return
    const action = e.currentTarget.dataset.a
    this.setData({ clocking: true })
    try {
      await api.adminPost('/admin/attendance/clock', { action, wifi: { ssid: this.data.wifi.ssid, bssid: this.data.wifi.bssid } })
      wx.showToast({ title: action === 'in' ? '上班打卡成功' : '下班打卡成功', icon: 'success' })
      this.load()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '打卡失败', icon: 'none', duration: 2500 })
    }
    this.setData({ clocking: false })
  },

  // 老板:点行修正/补卡
  openFix(e) {
    const tid = e.currentTarget.dataset.tid
    const row = this.data.board.rows.find((x) => x.technicianId === tid)
    if (!row) return
    this.setData({ fixSheet: true, fixRow: row, fixIn: row.clockIn || '10:00', fixOut: row.clockOut || '' })
  },
  closeFix() { this.setData({ fixSheet: false }) },
  onFixIn(e) { this.setData({ fixIn: e.detail.value }) },
  onFixOut(e) { this.setData({ fixOut: e.detail.value }) },
  async saveFix() {
    const r = this.data.fixRow
    if (!r) return
    const body = { clockIn: this.data.fixIn }
    if (this.data.fixOut) body.clockOut = this.data.fixOut
    if (!r.recordId) { body.technicianId = r.technicianId; body.date = this.data.boardDate || undefined }
    try {
      // 无记录时走补卡:PATCH /admin/attendance/new(id 占位),后端按 technicianId+date 新建
      const today = new Date(); const dstr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
      if (!r.recordId) { body.technicianId = r.technicianId; body.date = dstr }
      await api.adminPatch(`/admin/attendance/${encodeURIComponent(r.recordId || 'new')}`, body)
      wx.showToast({ title: '已修正', icon: 'success' })
      this.setData({ fixSheet: false })
      this.load()
    } catch (err) { wx.showToast({ title: (err && err.message) || '修正失败', icon: 'none' }) }
  },

  // 老板:把当前 WiFi 设为打卡 WiFi
  async setWifi() {
    if (!this.data.wifi.bssid) { wx.showToast({ title: '未获取到当前 WiFi,请真机连店内 WiFi 后再设', icon: 'none', duration: 2500 }); return }
    try {
      await api.adminPost('/admin/store-wifi', { ssid: this.data.wifi.ssid, bssid: this.data.wifi.bssid })
      wx.showToast({ title: '已设为打卡 WiFi', icon: 'success' })
    } catch (err) { wx.showToast({ title: (err && err.message) || '设置失败', icon: 'none' }) }
  }
})
