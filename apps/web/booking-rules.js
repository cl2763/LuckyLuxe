/* 单一定金入口：此处仅引导，不再维护第二个开关。 */
window.BookingRules = {
  mount(el) {
    if(!el)return
    el.innerHTML='<p class="subtle">预约定金统一在“定金与取消规则”设置。</p><button class="ghost slim" type="button" data-deposit-settings>查看定金与取消规则</button>'
    el.querySelector('[data-deposit-settings]').addEventListener('click',()=>{
      const title=document.querySelector('#depositSettingsTitle')
      const panel=title?.closest('details')
      if(panel)panel.open=true
      else title?.click()
      title?.scrollIntoView({behavior:'smooth',block:'start'})
    })
  }
}
