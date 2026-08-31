/* 客服与报价设置(店主 31q 裁定1:主入口=门店设置行,店级参数归一处;网页编辑,两端读同一份;
   工作台横幅角=同端快捷入口(同一表单弹层)—— 同端捷径不算指路)。
   读写 GET/PUT /admin/quote-settings(后端闸 1~72 / 1~336)。 */
window.QuoteSettings = (function () {
  'use strict'
  async function form(el, { request, toast }, compact) {
    let st = null
    try { st = await request('/admin/quote-settings') } catch (e) { el.innerHTML = `<p class="subtle">加载失败:${e.message || ''}</p>`; return }
    el.innerHTML = `
      <div class="qset">
        ${compact ? '<div class="sw-ch">客服与报价设置</div>' : ''}
        <label class="br-row">顾客隔多久没消息算「新会话」:
          <input type="text" inputmode="numeric" class="nfy-num" data-qset="gapHours" value="${st.gapHours}"> 小时(1~72)</label>
        <label class="br-row">报价有效期:
          <input type="text" inputmode="numeric" class="nfy-num" data-qset="validHours" value="${st.validHours}"> 小时(1~336)</label>
        <p class="subtle small">改完立即生效:客服工作台的「本次会话已报价/已过期/历史参考」横幅按这两个数算。</p>
        <button class="primary slim" data-qset-save type="button">保存</button>
      </div>`
    el.querySelector('[data-qset-save]').addEventListener('click', async () => {
      try {
        await request('/admin/quote-settings', { method: 'PUT', body: JSON.stringify({
          gapHours: Number(el.querySelector('[data-qset="gapHours"]').value),
          validHours: Number(el.querySelector('[data-qset="validHours"]').value)
        }) })
        toast('已保存,横幅按新数即时生效')
        if (compact) el.closest('#qsetModalHost') && (el.closest('#qsetModalHost').innerHTML = '')
      } catch (e) { toast(e.message || '保存失败') }
    })
  }
  return {
    mount(el, deps) { if (el) form(el, deps, false) },
    openModal(deps) {
      let host = document.querySelector('#qsetModalHost')
      if (!host) { host = document.createElement('div'); host.id = 'qsetModalHost'; document.body.appendChild(host) }
      host.innerHTML = '<div class="sw-cpnmask" data-qset-close></div><div class="sw-cpnsheet qset-sheet"></div>'
      host.querySelector('[data-qset-close]').addEventListener('click', () => { host.innerHTML = '' })
      form(host.querySelector('.qset-sheet'), deps, true)
    }
  }
})()
