const api = require('../../utils/api')

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

function fmtCoupon(c) {
  const amt = c.discountType === 'percent' ? `${c.percentOff > 0 ? (100 - c.percentOff) / 10 : 9}折` : `$${(c.amountCents || 0) / 100}`
  return {
    id: c.id, code: c.code, status: c.status, name: c.name,
    amt: c.discountType === 'percent' ? `立减${c.percentOff}%` : `$${(c.amountCents || 0) / 100}`,
    unit: c.minSpendCents ? `满$${c.minSpendCents / 100}` : '',
    exp: c.status === 'used' ? `已于 ${String(c.usedAt || '').slice(0, 10)} 使用`
      : c.status === 'expired' ? `已于 ${String(c.expiresAt || '').slice(0, 10)} 过期`
        : `有效期至 ${String(c.expiresAt || '').slice(0, 10)}`
  }
}

Page({
  data: { seg: 0, count: 0, groups: [[], [], []], qr: null, loading: true },

  async onShow() {
    try {
      const r = await api.getMyCoupons()
      const all = (r.coupons || []).map(fmtCoupon)
      const groups = [
        all.filter((c) => c.status === 'active'),
        all.filter((c) => c.status === 'used'),
        all.filter((c) => c.status === 'expired')
      ]
      this.setData({ groups, count: groups[0].length, loading: false })
    } catch (e) {
      this.setData({ loading: false, groups: [[], [], []], count: 0 })
    }
  },

  onSeg(e) { this.setData({ seg: Number(e.currentTarget.dataset.i) }) },

  showQr(e) {
    const c = this.data.groups[0].find((x) => x.id === e.currentTarget.dataset.id)
    if (!c) return
    this.setData({ qr: { name: c.name, code: c.code, cells: genQr(c.code) } })
  },
  closeQr() { this.setData({ qr: null }) },
  noop() {}
})
