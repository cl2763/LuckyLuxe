/* 值日表开关(店主 31l 小合同一:门店设置每店开关,默认关;关=台面零渲染)。
   读写 GET/PUT /admin/duty-setting(与小程序同口)。 */
window.DutySetting = (function () {
  'use strict'
  async function mount(el, { request, toast }) {
    if (!el) return
    const render = async () => {
      let on = false
      try { on = Boolean((await request('/admin/duty-setting')).enabled) } catch (e) { el.innerHTML = ''; return }
      el.innerHTML = `
        <label class="br-row"><input type="checkbox" data-duty-on ${on ? 'checked' : ''}>
          开启值日表(开启后,今天台面底部出现「值日」行,点技师名勾选当日值日;员工端同位置只读可见)</label>`
      el.querySelector('[data-duty-on]').addEventListener('change', async (ev) => {
        try {
          await request('/admin/duty-setting', { method: 'PUT', body: JSON.stringify({ enabled: ev.target.checked }) })
          toast(ev.target.checked ? '值日表已开启' : '值日表已关闭(台面不再显示值日行)')
        } catch (e) { toast(e.message || '保存失败'); render() }
      })
    }
    render()
  }
  return { mount }
})()
