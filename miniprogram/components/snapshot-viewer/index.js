/* D68③(店主 08-23 裁):签署原件悬浮查看器 —— **全仓唯一一份实现**。
   顾客端订单详情、商家端日结「查看签署单」、单据预览卡「查看签署原图」、财务流水回链
   一律用它:多份组全列、逐份页码 n/N、左右半透明箭头(首份隐左/末份隐右)、滑动手势并存。
   数据来自后端唯一出口(顾客端 payment.sheets / 商家端 GET /admin/settlements/:key/snapshots),
   组件自己不拼任何句子、不算任何份数。 */
Component({
  properties: {
    // [{ code, label, url }] —— url 已是绝对地址(调用方用 api.API_BASE 拼好)
    items: { type: Array, value: [] },
    index: { type: Number, value: 0 },
    open: { type: Boolean, value: false }
  },
  data: { cur: 0 },
  observers: {
    'index, open': function (index, open) { if (open) this.setData({ cur: Number(index) || 0 }) }
  },
  methods: {
    onSwipe(e) { this.setData({ cur: e.detail.current }) },
    go(step) {
      const items = this.data.items || []
      const cur = Math.max(0, Math.min(items.length - 1, this.data.cur + step))
      if (cur !== this.data.cur) this.setData({ cur })
    },
    prev() { this.go(-1) },
    next() { this.go(1) },
    close() { this.triggerEvent('close') },
    noop() { /* 浮层内点击不穿透到遮罩 */ }
  }
})
