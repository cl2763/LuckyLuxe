/* 单据预览弹层(D28 图 v1,图=合同):排单台面与日结共用的同一组件(规则②)。
   内容=签署快照排版件,只读,storeMoney 出口,数据全由后端 /preview-card 拼好(前端零运算)。
   关闭三法:✕ /「关闭」/ 点卡外空白;「查看签署原图」只在已签署单出现(规则④)。 */
const api = require('../../utils/api')
const { storeMoney } = require('../../utils/storeclock')

Component({
  properties: {
    // 传结算单 id 或单号都行(后端两头认);置空=关闭
    sheetId: { type: String, value: '', observer(v) { if (v) this.load(v); else this.setData({ card: null }) } }
  },
  data: { card: null, loading: false },
  methods: {
    async load(idOrCode) {
      this.setData({ loading: true, card: null })
      try {
        const r = await api.adminGet(`/admin/settlements/${encodeURIComponent(idOrCode)}/preview-card`)
        const c = r.card
        const m = (cents) => storeMoney(cents, cents % 100 ? 2 : 0)
        this.setData({
          loading: false,
          card: Object.assign({}, c, {
            groups: c.groups.map((g) => Object.assign({}, g, {
              lines: g.lines.map((l) => Object.assign({}, l, {
                amountText: l.isFree || l.amountCents === 0 ? '免收' : m(l.amountCents),
                listText: l.strike ? m(l.listAmountCents) : ''
              }))
            })),
            sheetRows: (c.sheetRows || []).map((s) => Object.assign({}, s, { totalText: m(s.totalCents) })),
            t: {
              listTotal: m(c.totals.listTotalCents),
              subtotal: m(c.totals.subtotalCents),
              discount: m(c.totals.discountTotalCents),
              discountLabel: c.totals.couponDiscountCents > 0 ? '共优惠(含券)' : '较原价共优惠',
              hasDeposit: c.totals.depositDeductCents > 0,
              deposit: m(c.totals.depositDeductCents),
              hasStored: c.totals.storedDeductCents > 0,
              stored: m(c.totals.storedDeductCents),
              hasCover: (c.totals.timecardCoverCents || 0) > 0,
              cover: m(c.totals.timecardCoverCents || 0),
              /* D60 自证行:购卡款/充值实收显式;应收 label 由后端定(组卡=「组合计应收(N 张)」) */
              hasPurchase: (c.totals.purchaseCents || 0) > 0,
              purchase: m(c.totals.purchaseCents || 0),
              hasRecharge: (c.totals.rechargeCents || 0) > 0,
              recharge: m(c.totals.rechargeCents || 0),
              dueLabel: c.totals.dueLabel || '到店应收',
              due: m(c.totals.dueCents)
            }
          })
        })
      } catch (e) {
        this.setData({ loading: false })
        wx.showToast({ title: (e && e.message) || '单据加载失败', icon: 'none' })
        this.triggerEvent('close')
      }
    },
    close() { this.triggerEvent('close') },
    noop() { /* 卡内点击不穿透 */ },
    viewOriginal() {
      const c = this.data.card
      if (!c || c.statusKey !== 'signed') return
      // 全屏可缩放的签署原图 = 既有快照页(web-view),排版弹层是默认、原图是补充(规则④)
      wx.navigateTo({ url: `/pages/sign/index?snapshot=${encodeURIComponent(c.code)}` })
    }
  }
})
