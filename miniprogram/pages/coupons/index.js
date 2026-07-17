function genQr(seed) {
  const N = 21
  let s = 0
  for (let i = 0; i < seed.length; i += 1) s = (s * 31 + seed.charCodeAt(i)) >>> 0
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 16) / 65536 }
  const finder = (r, c, br, bc) => {
    const rr = r - br, cc = c - bc
    if (rr < 0 || rr > 6 || cc < 0 || cc > 6) return null
    const edge = rr === 0 || rr === 6 || cc === 0 || cc === 6
    const center = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4
    return edge || center ? 1 : 0
  }
  const cells = []
  for (let r = 0; r < N; r += 1) {
    for (let c = 0; c < N; c += 1) {
      let v = finder(r, c, 0, 0)
      if (v === null) v = finder(r, c, 0, N - 7)
      if (v === null) v = finder(r, c, N - 7, 0)
      cells.push(v === null ? (rnd() > 0.5 ? 1 : 0) : v)
    }
  }
  return cells
}

Page({
  data: { seg: 0, count: 0, groups: [[], [], []], qr: null },
  onShow() {
    const m = wx.getStorageSync('lucky_member') || {}
    // 演示数据:正式版由后端"我的券包"返回,券码由后端签发
    const groups = [
      [
        { id: 1, amt: '$30', unit: '满$200', name: '满200减30', exp: '有效期至 08-15', code: 'LL-A3K9-2200' },
        { id: 2, amt: '9折', unit: '', name: '会员9折券', exp: '积分兑换 · 至 07-31', code: 'LL-9F31-VIP0' },
        { id: 3, amt: '免', unit: '卸甲', name: '免费卸甲券', exp: 'VIP年卡赠 · 至 12-31', code: 'LL-RM12-GIFT' }
      ],
      [ { id: 4, amt: '$20', unit: '满$150', name: '满150减20', exp: '已于 06-30 使用', code: 'LL-USED-0630' } ],
      [ { id: 5, amt: '9折', unit: '', name: '新客9折券', exp: '已于 05-31 过期', code: 'LL-EXP-0531' } ]
    ]
    this.setData({ count: m.couponCount || groups[0].length, groups })
  },
  onSeg(e) { this.setData({ seg: Number(e.currentTarget.dataset.i) }) },
  showQr(e) {
    const c = this.data.groups[0].find((x) => x.id === Number(e.currentTarget.dataset.id))
    if (!c) return
    this.setData({ qr: { name: c.name, code: c.code, cells: genQr(c.code) } })
  },
  closeQr() { this.setData({ qr: null }) },
  noop() {}
})
