/* 网页老板侧「写服务小记」弹层(店主 08-31 走查反馈三:对齐小程序客户档案四按钮)。
   同一后端口 POST /admin/service-notes、同一存储(images ≤9 张 data:image,与小记图片小合同同栈);
   员工端网页「我的客人」的写口不动(那是 my-customers.js 自己的)。 */
window.ServiceNoteModal = (function () {
  'use strict'
  let st = { open: false, userId: '', name: '', text: '', images: [], busy: false, deps: null, bookingId: '' } // D97:订单场景的小记必须挂单

  function render() {
    const { escapeHtml } = st.deps
    let host = document.querySelector('#snModalHost')
    if (!host) {
      host = document.createElement('div')
      host.id = 'snModalHost'
      document.body.appendChild(host)
    }
    if (!st.open) { host.innerHTML = ''; return }
    host.innerHTML = `
      <div class="sw-cpnmask" data-sn-close></div>
      <div class="sw-cpnsheet sn-sheet">
        <div class="sw-ch">写服务小记 · ${escapeHtml(st.name)}</div>
        ${st.bookingId ? '<p class="subtle small" style="margin:0">本条挂在这张订单上;点「取消」=先跳过,这单会进「待写小记」清单,随时可补。</p>' : ''}
        <textarea class="sn-ta" data-sn-text placeholder="做了什么 / 用色 / 甲型 / 下次注意…" rows="4">${escapeHtml(st.text)}</textarea>
        <div class="mn-thumbs">
          ${st.images.map((img, i) => `<span class="mn-thumb"><img src="${img}" alt=""><button type="button" data-sn-rm="${i}">✕</button></span>`).join('')}
          ${st.images.length < 9 ? '<button class="mn-addimg" data-sn-add type="button">＋ 图片</button>' : ''}
        </div>
        <input type="file" id="snImgFile" accept="image/*" multiple class="hidden">
        <div class="sw-btnrow">
          <button class="sw-cta" data-sn-save type="button">保存小记</button>
          <button class="ghost slim" data-sn-close type="button">取消</button>
        </div>
      </div>`
    bind(host)
  }

  function bind(host) {
    const { toast } = st.deps
    host.querySelectorAll('[data-sn-close]').forEach((b) => b.addEventListener('click', () => { st.open = false; render() }))
    host.querySelector('[data-sn-text]')?.addEventListener('input', (e) => { st.text = e.target.value })
    host.querySelector('[data-sn-add]')?.addEventListener('click', () => host.querySelector('#snImgFile').click())
    host.querySelectorAll('[data-sn-rm]').forEach((b) => b.addEventListener('click', () => { st.images.splice(Number(b.dataset.snRm), 1); render() }))
    host.querySelector('#snImgFile')?.addEventListener('change', (e) => {
      const files = [...(e.target.files || [])].slice(0, 9 - st.images.length)
      files.forEach((f) => {
        const rd = new FileReader()
        rd.onload = () => { st.images.push(String(rd.result)); render() }
        rd.onerror = () => toast('读图失败,换一张试试')
        rd.readAsDataURL(f)
      })
    })
    host.querySelector('[data-sn-save]')?.addEventListener('click', async () => {
      if (st.busy) return
      if (!st.text.trim() && !st.images.length) { toast('写一句,或加一张图'); return }
      st.busy = true
      try {
        await st.deps.request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: st.userId, rawText: st.text.trim(), images: st.images, bookingId: st.bookingId || undefined }) })
        toast('小记已保存(技师与老板可见)')
        st.open = false
        render()
      } catch (e) { toast(e.message || '保存失败') }
      st.busy = false
    })
  }

  return {
    open(userId, name, deps, bookingId) {
      /* D97 自走查咬出的雷:原先先赋 st.bookingId 再整对象重建 —— 赋值被冲掉,落库恒 null */
      st = { open: true, userId, name: name || '顾客', text: '', images: [], busy: false, deps, bookingId: bookingId || '' }
      render()
    }
  }
})()
