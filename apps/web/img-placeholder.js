/* 图片占位 · 唯一出口(店主 2026-08-28 六立律)。

   **她的原话就是规格**:「只要没有上传过的图片,在图片占位的地方都应该显示一个图片占位,
   或者就是那种有一个小相机的那种空白页面,让人感受到这里应该是有图片的,只是他没有上传而已。」

   三态:**有图** / **没配图=占位(空框+相机+一句话)** / **不该有图=整块不出现**。
   🔴 不许回落到别的租户的图,也不许什么都不显示 —— 后者是「空态看起来像坏了」,
   前者是《假数回落红线》。

   为什么做成唯一出口:91 个图片位如果每处各写一套占位,三个月后就有三种占位长相。
   网页两端(customer.js / admin.js 及其模块)都从这里拿。 */
window.ImgPlaceholder = (function () {
  const CAMERA_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">'
    + '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" '
    + 'd="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1 1 0 0 1 8.7 4.7h6.6a1 1 0 0 1 .9.5L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>'
    + '<circle cx="12" cy="12.8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'

  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  /* 有图出 <img>,没图出占位块。className 原样带过去,布局与原来一致(占位不许把版面挤歪)。 */
  function tag(src, { className = '', alt = '', text = '', zh = true } = {}) {
    const s = String(src || '').trim()
    if (s) return `<img class="${esc(className)}" src="${esc(s)}" alt="${esc(alt)}">`
    const label = text || (zh ? '还没有图片' : 'No image yet')
    return `<div class="${esc(className)} img-placeholder" role="img" aria-label="${esc(label)}">`
      + `${CAMERA_SVG}<span>${esc(label)}</span></div>`
  }

  return { tag }
})()
