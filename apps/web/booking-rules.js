/* 预约规则(线上定金开关)—— 店主 2026-08-31 裁清单#9:配置类「网页=总和」,网页补编辑面。
   读写与小程序门店设置页同一条 GET/PUT /admin/booking-rules(一份数据两端渲染);
   语义:onlineDeposit=false → 顾客线上预约不收定金、直接确认(后端建单逻辑既有)。 */
window.BookingRules = (function () {
  'use strict'
  async function mount(el, { request, toast }) {
    if (!el) return
    const render = async () => {
      let on = true
      try { const r = await request('/admin/booking-rules'); on = r.rules ? r.rules.onlineDeposit !== false : true } catch (e) {
        el.innerHTML = `<p class="subtle">预约规则加载失败:${(e.message || '')}</p>`
        return
      }
      el.innerHTML = `
        <div class="booking-rules-block">
          <h4>预约规则</h4>
          <label class="br-row"><input type="checkbox" data-br-online ${on ? 'checked' : ''}>
            线上预约收定金(关掉后顾客线上预约不付定金、直接确认;金额与减免按「定金与取消规则」)</label>
        </div>`
      el.querySelector('[data-br-online]').addEventListener('change', async (ev) => {
        try {
          await request('/admin/booking-rules', { method: 'PUT', body: JSON.stringify({ onlineDeposit: ev.target.checked }) })
          toast('预约规则已保存,两端同时生效')
        } catch (e) { toast(e.message || '保存失败'); render() }
      })
    }
    render()
  }
  return { mount }
})()
