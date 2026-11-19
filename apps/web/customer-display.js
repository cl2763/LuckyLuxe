(function(){
function customerName(customer) {
  return customer.merchantDisplayName || customer.displayName || customer.email || 'Lucky Member'
}

function dateOnly(value) {
  if (!value) return '-'
  return new Date(value).toISOString().slice(0, 10)
}

function bind({request,escapeHtml,loadAll,toast,isEnglish}) {
  document.addEventListener('click', async event => {
    if(event.target.closest('[data-tech-services]')) {
      try { const m=await import('/web/technician-services.mjs?v=20261119-consent-customer1');await m.openTechnicianServices({request,escapeHtml}) } catch(e) {toast(e.message)}
      return
    }
    const button=event.target.closest('[data-customer-remark-save]')
    if(!button||button.disabled)return
    button.disabled=true
    let saved=false
    try {
      await request('/admin/customers/'+encodeURIComponent(button.dataset.customerRemarkSave)+'/remark-name',{method:'PATCH',body:JSON.stringify({remarkName:document.querySelector('#customerRemarkNameInput').value})})
      saved=true
      await loadAll()
      toast(isEnglish()?'Remark saved':'备注名已保存')
    } catch(e) {toast(saved?(isEnglish()?'Saved. Refresh to view the update.':'备注已保存，请刷新查看。'):e.message)}
    finally {button.disabled=false}
  })
}
window.CustomerDisplay={customerName,dateOnly,bind}
})()
