/* 图片占位组件(店主 2026-08-28 六立律)。
   小程序这一侧的唯一出口 —— 43 个图片位如果每处各写一套占位,三个月后就有三种长相。 */
Component({
  properties: {
    src: { type: String, value: '' },
    mode: { type: String, value: 'aspectFill' },
    imgClass: { type: String, value: '' },
    text: { type: String, value: '' }
  }
})
