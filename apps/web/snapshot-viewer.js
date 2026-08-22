/* D68③(店主 08-23 裁):网页端签署原件悬浮查看器 —— **admin 与 customer 共用这一份**。
   与小程序 components/snapshot-viewer 同构:整组逐份、页码 n/N、左右半透明箭头
   (首份隐左/末份隐右)、触摸滑动、方向键、Esc 关闭。数据来自后端唯一出口,
   本模块不拼句子也不数份数(items 由调用方从接口取好)。 */
(function (global) {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const ARROW = 'position:absolute;top:50%;transform:translateY(-50%);width:38px;height:52px;border:0;border-radius:8px;background:rgba(20,16,14,.42);color:#fff;font-size:26px;line-height:1;cursor:pointer;z-index:2;'

  function openSnapViewer(items, startIndex) {
    if (!items || !items.length) return
    const existing = document.getElementById('snapViewer')
    if (existing) existing.remove()
    let i = Math.max(0, Math.min(Number(startIndex) || 0, items.length - 1))
    const box = document.createElement('div')
    box.id = 'snapViewer'
    box.style.cssText = 'position:fixed;inset:0;background:rgba(20,16,14,.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;box-sizing:border-box'
    const paint = () => {
      box.innerHTML = `
        <div style="width:min(760px,94vw);display:flex;align-items:center;justify-content:space-between;color:#fff;padding-bottom:10px">
          <strong style="font-size:15px">${esc(items[i].label)}</strong>
          <span style="opacity:.75;font-size:13px">${items.length > 1 ? `${i + 1}/${items.length}` : ''}</span>
          <button data-snap-close type="button" style="background:none;border:0;color:#fff;font-size:22px;cursor:pointer">✕</button>
        </div>
        <div style="width:min(760px,94vw);height:min(78vh,900px);position:relative">
          <div style="width:100%;height:100%;background:#fff;border-radius:14px;overflow:auto">
            <img src="${esc(items[i].url)}" alt="${esc(items[i].label)}" style="width:100%;display:block">
          </div>
          ${items.length > 1 && i > 0 ? `<button data-snap-prev type="button" aria-label="上一份" style="${ARROW}left:10px">‹</button>` : ''}
          ${items.length > 1 && i < items.length - 1 ? `<button data-snap-next type="button" aria-label="下一份" style="${ARROW}right:10px">›</button>` : ''}
        </div>
        ${items.length > 1 ? `<div style="width:min(760px,94vw);text-align:center;color:rgba(255,255,255,.7);font-size:12px;padding-top:10px">左右滑动、点两侧箭头或用方向键切换</div>` : ''}`
    }
    const go = (d) => { i = (i + d + items.length) % items.length; paint() }
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey) }
    const onKey = (e) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    box.addEventListener('click', (e) => {
      if (e.target === box || e.target.closest('[data-snap-close]')) { close(); return }
      if (e.target.closest('[data-snap-next]')) go(1)
      if (e.target.closest('[data-snap-prev]')) go(-1)
    })
    let touchX = 0
    box.addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].clientX }, { passive: true })
    box.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchX
      if (Math.abs(dx) > 48 && items.length > 1) go(dx < 0 ? 1 : -1)
    }, { passive: true })
    document.addEventListener('keydown', onKey)
    paint()
    document.body.appendChild(box)
  }

  global.openSnapViewer = openSnapViewer
})(window)
