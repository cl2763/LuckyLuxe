/* 图片占位组件(店主 2026-08-28 六立律)。
   小程序这一侧的唯一出口 —— 43 个图片位如果每处各写一套占位,三个月后就有三种长相。 */
Component({
  /* 🔴 D120(店主 02j 逐寸读三态截图咬出):**占位框不守原位尺寸** ——
     有图时轮播是横幅(500rpx),占位时却成了近正方形大块,把整页撑开,
     「CAD $198」被下节标题压得更狠(D120 与文字重叠是因果,不是两件事)。
     根因:小程序组件**默认样式隔离**,页面里 .shop-card-visual{height:500rpx} /
     .recommend-visual{height:170rpx} 这些尺寸类根本进不到组件内部,
     .ph-box 只好用自己的 height:100% 对着没高度的根节点 → 尺寸失控。
     修:apply-shared 让页面样式作用到组件内(占位=它替代的那张图的形状)。 */
  options: { styleIsolation: 'apply-shared' },
  properties: {
    src: { type: String, value: '' },
    mode: { type: String, value: 'aspectFill' },
    imgClass: { type: String, value: '' },
    text: { type: String, value: '' }
  }
})
