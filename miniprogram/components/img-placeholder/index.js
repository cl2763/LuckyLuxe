const imageViewCore = require('../../utils/image-view-core')
/* 图片占位组件(店主 2026-08-28 六立律)。
   小程序这一侧的唯一出口 —— 43 个图片位如果每处各写一套占位,三个月后就有三种长相。 */
Component({
  /* 🔴 D120(店主 02j 逐寸读三态截图咬出):**占位框不守原位尺寸** ——
     有图时轮播是横幅(500rpx),占位时却成了近正方形大块,把整页撑开,
     价格行被下节标题压得更狠(D120 与文字重叠是因果,不是两件事)。
     ——注释里不写具体币符金额:币种红线扫描把注释也算产品面,我上一版在这儿踩了。
     根因:小程序组件**默认样式隔离**,页面里 .shop-card-visual{height:500rpx} /
     .recommend-visual{height:170rpx} 这些尺寸类根本进不到组件内部,
     .ph-box 只好用自己的 height:100% 对着没高度的根节点 → 尺寸失控。
     修:apply-shared 让页面样式作用到组件内(占位=它替代的那张图的形状)。 */
  options: { styleIsolation: 'apply-shared' },
  properties: {
    src: { type: String, value: '' },
    mode: { type: String, value: 'aspectFill' },
    imgClass: { type: String, value: '' },
    text: { type: String, value: '' },
    imageView: { type: Object, value: null },
    profile: { type: String, value: 'card' }
  },
  data: { frameStyle: '' },
  observers: { 'imageView, profile, src': function () { this._frameImage() } },
  lifetimes: { ready() { this._frameImage() } },
  pageLifetimes: { resize() { this._frameImage() } },
  methods: {
    imageLoaded(e) { this._natural={width:e.detail.width,height:e.detail.height};this._frameImage() },
    _frameImage() {
      if (!this._natural || !this.data.imageView) return
      this.createSelectorQuery().select('.ph-frame').boundingClientRect(r => {
        if (!r || !r.width || !r.height) return
        const g=imageViewCore.geometry(this._natural.width,this._natural.height,r.width,r.height,this.data.imageView[this.data.profile])
        this.setData({frameStyle:`width:${g.width}px;height:${g.height}px;left:${g.left}px;top:${g.top}px;`})
      }).exec()
    }
  }
})
