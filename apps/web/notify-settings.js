/* P3 通知与回访设置 + 通知记录(店主 2026-08-30g 开工令件3)
   挂载:门店设置页 #notifySettingsMount(admin.js renderStoreSettings 调 mountSettings,与营业时间同手法)。
   一份数据两端渲染:读写只走 /admin/notify/rules · /admin/notify/queue,小程序同两口。
   发送通道现阶段只有「站内/记录」:记录列表就是送达面(微信/短信等 ICP,实装另批)。 */
(function () {
  'use strict'

  let stateN = { rules: [], tasks: [], filter: '', deps: null, mount: null }

  const STATUS_ZH = { PENDING: '待发', SENT: '已发', FAILED: '失败', CANCELLED: '已撤' }

  function fieldHtml(r) {
    if (r.type === 'arrival_reminder') {
      return `提前 <input type="number" min="5" max="10080" step="5" class="nfy-num" data-nfy-num="offsetMinutes" data-type="${r.type}" value="${r.offsetMinutes ?? 120}"> 分钟`
    }
    if (r.type === 'revisit') {
      return `间隔 <input type="number" min="3" max="365" class="nfy-num" data-nfy-num="revisitDays" data-type="${r.type}" value="${r.revisitDays ?? 30}"> 天`
    }
    if (r.advanceDays != null) {
      return `提前 <input type="number" min="1" max="60" class="nfy-num" data-nfy-num="advanceDays" data-type="${r.type}" value="${r.advanceDays}"> 天`
    }
    return ''
  }

  function render() {
    const { escapeHtml } = stateN.deps
    const el = stateN.mount
    if (!el) return
    el.innerHTML = `
      <div class="notify-settings-block">
        <h4>通知与回访</h4>
        <p class="muted small">开关与提前量按本店生效;现阶段通知落在下方「通知记录」里(站内记录通道),微信/短信通道等资质开通后另批接入。</p>
        <div class="nfy-rules">
          ${stateN.rules.map((r) => `
            <label class="nfy-rule">
              <input type="checkbox" data-nfy-on="${r.type}" ${r.enabled ? 'checked' : ''}>
              <span class="nfy-label">${escapeHtml(r.label)}</span>
              <span class="nfy-field">${fieldHtml(r)}</span>
            </label>`).join('')}
        </div>
        <button class="primary slim" data-nfy-save type="button">保存通知设置</button>
        <div class="nfy-queue">
          <div class="nfy-queue-head">
            <h4>通知记录</h4>
            <select data-nfy-filter>
              <option value="">全部状态</option>
              ${Object.entries(STATUS_ZH).map(([k, v]) => `<option value="${k}" ${stateN.filter === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          ${stateN.tasks.length ? `
          <table class="nfy-table">
            <thead><tr><th>类型</th><th>内容</th><th>计划时刻</th><th>状态</th><th>说明</th></tr></thead>
            <tbody>
              ${stateN.tasks.map((t2) => `
                <tr class="nfy-row ${t2.status.toLowerCase()}">
                  <td>${escapeHtml(t2.typeLabel)}</td>
                  <td>${escapeHtml(t2.text || '—')}</td>
                  <td>${escapeHtml(String(t2.scheduledAt || '').slice(0, 16).replace('T', ' '))}</td>
                  <td>${STATUS_ZH[t2.status] || t2.status}</td>
                  <td>${escapeHtml(t2.failReason || '')}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '<div class="empty-state small-empty">还没有通知记录 —— 打开上面的开关后,系统会按事件与每日扫描生成。</div>'}
        </div>
      </div>`
    bind()
  }

  function bind() {
    const { request, toast } = stateN.deps
    const el = stateN.mount
    el.querySelector('[data-nfy-save]')?.addEventListener('click', async () => {
      const rules = stateN.rules.map((r) => {
        const patch = { type: r.type, enabled: el.querySelector(`[data-nfy-on="${r.type}"]`)?.checked !== false }
        el.querySelectorAll(`[data-nfy-num][data-type="${r.type}"]`).forEach((inp) => { patch[inp.dataset.nfyNum] = Number(inp.value) })
        return patch
      })
      try {
        const resp = await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules }) })
        stateN.rules = resp.rules || []
        toast('通知设置已保存')
        render()
      } catch (error) { toast(error.message || '保存失败') }
    })
    el.querySelector('[data-nfy-filter]')?.addEventListener('change', async (ev) => {
      stateN.filter = ev.target.value
      await loadQueue()
      render()
    })
  }

  async function loadQueue() {
    const { request } = stateN.deps
    const q = stateN.filter ? `?status=${stateN.filter}` : ''
    const resp = await request(`/admin/notify/queue${q}`)
    stateN.tasks = resp.tasks || []
  }

  window.NotifySettings = {
    async mountSettings(el, deps) {
      if (!el) return
      stateN = { ...stateN, deps, mount: el }
      try {
        const resp = await deps.request('/admin/notify/rules')
        stateN.rules = resp.rules || []
        await loadQueue()
      } catch (error) {
        el.innerHTML = `<div class="empty-state small-empty">通知设置加载失败:${deps.escapeHtml(error.message || '')}</div>`
        return
      }
      render()
    }
  }
})()
