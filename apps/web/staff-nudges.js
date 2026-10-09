// Employee inbox: same API as mini-program; updates without reloading the page.
window.StaffNudges = (() => {
  let timer, scope, host, pending = false
  function mount(before, deps) {
    if (!before || !deps.scope) return
    if (scope === deps.scope && host?.isConnected) return
    clearInterval(timer); host?.remove(); scope = deps.scope
    const mine = scope
    host = document.createElement('section'); host.className = 'card'; host.hidden = true
    before.before(host)
    const panel = host
    async function refresh() {
      if (pending || document.hidden || !panel.isConnected) return
      pending = true
      try {
        const data = await deps.request('/admin/staff-nudges/mine')
        if (mine !== scope) return
        const list = data.nudges || []
        panel.hidden = !list.length
        panel.innerHTML = '<h3>站内提醒</h3>' + list.map(n=>`<div class="section-row"><p>${deps.escapeHtml(n.message)}</p><button type="button" class="ghost slim" data-read="${deps.escapeHtml(n.id)}">知道了</button></div>`).join('')
        panel.querySelectorAll('[data-read]').forEach(button => button.addEventListener('click', async () => {
          button.disabled = true
          try { await deps.request('/admin/staff-nudges/'+encodeURIComponent(button.dataset.read)+'/read',{method:'POST',body:'{}'}); await refresh() }
          catch(e) { deps.toast(e.message || '操作失败，请重试'); button.disabled=false }
        }))
      } catch (e) { /* Retain already received messages on transient failure. */ }
      finally { pending = false }
    }
    refresh(); timer = setInterval(refresh,30000)
  }
  function clear() { clearInterval(timer); host?.remove(); scope=''; host=null }
  return {mount,clear}
})()
