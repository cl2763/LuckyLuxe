/* 值日表开关(店主 31l 小合同一:门店设置每店开关,默认关;关=台面零渲染)。
   读写 GET/PUT /admin/duty-setting(与小程序同口)。 */
window.DutySetting = (function () {
  'use strict'
  async function mount(el, { request, toast }) {
    if (!el) return
    const render = async () => {
      let on = false
      try { on = Boolean((await request('/admin/duty-setting')).enabled) } catch (e) { el.innerHTML = ''; return }
      /* D98(01t):原来是页中巨方框(checkbox+大段 label)——改与其他设置行同形制:说明句行内小字 + 行右标准开关 */
      el.innerHTML = `
        <div class="duty-row">
          <span class="note">开启后,今天台面底部出现「值日」行,点技师名勾选当日值日;员工端两端台面同位只读可见。</span>
          <button class="ui-sw ${on ? 'on' : ''}" data-duty-on type="button" aria-label="值日表开关"></button>
        </div>`
      el.querySelector('[data-duty-on]').addEventListener('click', async (ev) => {
        const next = !on
        try {
          await request('/admin/duty-setting', { method: 'PUT', body: JSON.stringify({ enabled: next }) })
          toast(next ? '值日表已开启' : '值日表已关闭(台面不再显示值日行)')
          render()
        } catch (e) { toast(e.message || '保存失败'); render() }
      })
    }
    render()
  }
  return { mount }
})()
