/* 通知与回访 —— 照《通知与回访设置图 v1.0》重做(店主 08-31 退回件;图=合同,合同七条+N1-N6)。
   入口=门店设置独立行(N6;此前挂在营业时间抽屉体内被折叠吞掉 —— 挂载位错,已改);
   规则/记录两页签;八类两组;每卡四件套=开关(点即存)+参数+可编辑文案模板(变量芯片+实时预览
   〔POST /admin/notify/preview,与落库同一渲染出口〕+恢复默认)+保存;记录三色含失败原因。
   读写同两口+preview,与小程序同构同文案(一份数据两端渲染)。 */
(function () {
  'use strict'

  const NOTICE = '微信/短信通道开通前,所有通知先记录在「记录」页,一条不丢;通道开通后自动补发未来的、不补发历史的。'
  const GROUPS = [
    { key: 'booking', title: '预约通知', note: '建议开启:预约的创建/改期/取消与到店前提醒,自动生成通知。' },
    { key: 'care', title: '关怀回访', note: '默认关,开了才扫:次卡到期、生日、定期回访、优惠券临期。' }
  ]
  const STATUS = { SENT: ['d-ok', '已记'], PENDING: ['d-wait', '待发'], FAILED: ['d-fail', '失败'], CANCELLED: ['d-off', '已撤'] }

  let st = { tab: 'rules', rules: [], tasks: [], filter: '', deps: null, mount: null, draft: {}, preview: {} }

  function paramHtml(r) {
    if (r.type === 'arrival_reminder') return `提前 <input type="text" inputmode="numeric" class="nfy-num" data-nfy-num="offsetMinutes" data-type="${r.type}" value="${r.offsetMinutes}"> 分钟`
    if (r.type === 'revisit') return `上次到店后 <input type="text" inputmode="numeric" class="nfy-num" data-nfy-num="revisitDays" data-type="${r.type}" value="${r.revisitDays}"> 天`
    if (r.advanceDays != null) return `提前 <input type="text" inputmode="numeric" class="nfy-num" data-nfy-num="advanceDays" data-type="${r.type}" value="${r.advanceDays}"> 天`
    return ''
  }

  function cardHtml(r) {
    const { escapeHtml } = st.deps
    const tpl = st.draft[r.type] !== undefined ? st.draft[r.type] : r.templateText
    const prev = st.preview[r.type] || ''
    const head = `<div class="nfy-head"><b>${escapeHtml(r.label)}</b>
      <label class="nfy-sw"><input type="checkbox" data-nfy-on="${r.type}" ${r.enabled ? 'checked' : ''}><span></span></label></div>`
    if (!r.enabled) return `<div class="nfy-card off">${head}</div>`
    const param = paramHtml(r)
    return `<div class="nfy-card">
      ${head}
      ${param ? `<div class="nfy-param">${param}</div>` : ''}
      <textarea class="nfy-tpl" data-nfy-tpl="${r.type}" rows="2">${escapeHtml(tpl)}</textarea>
      <div class="nfy-chips">${r.vars.map((v) => `<button type="button" data-nfy-chip="${r.type}" data-var="${escapeHtml(v)}">{${escapeHtml(v)}}</button>`).join('')}</div>
      <div class="nfy-prev">预览:<em data-nfy-prev="${r.type}">${escapeHtml(prev)}</em></div>
      <div class="nfy-btnrow">
        <button class="primary slim" data-nfy-save="${r.type}" type="button">保存</button>
        <button class="ghost slim nfy-reset" data-nfy-reset="${r.type}" type="button">恢复默认</button>
      </div>
    </div>`
  }

  function render() {
    const { escapeHtml } = st.deps
    const el = st.mount
    if (!el) return
    const rulesTab = `
      <div class="nfy-notice">${NOTICE}</div>
      ${GROUPS.map((g) => `
        <div class="nfy-grp">${g.title}<span class="subtle small"> · ${g.note}</span></div>
        ${st.rules.filter((r) => r.group === g.key).map(cardHtml).join('')}`).join('')}`
    const shown = st.filter ? st.tasks.filter((t) => t.type === st.filter) : st.tasks
    const recordsTab = `
      <div class="nfy-queue-head">
        <select data-nfy-filter>
          <option value="">全部类型</option>
          ${st.rules.map((r) => `<option value="${r.type}" ${st.filter === r.type ? 'selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}
        </select>
      </div>
      ${shown.length ? shown.map((t) => {
        const [cls, zh] = STATUS[t.status] || ['d-off', t.status]
        return `<div class="nfy-rec"><span class="nfy-dot ${cls}"></span>
          <div><b>${escapeHtml(t.typeLabel)}</b> · ${escapeHtml(t.customerName || '—')} · ${zh} ${escapeHtml(String(t.scheduledAt || '').slice(5, 16).replace('T', ' '))}
          ${t.status === 'FAILED' || t.status === 'CANCELLED' ? `<details class="nfy-why"><summary>${t.status === 'FAILED' ? '失败原因' : '撤销原因'}</summary>${escapeHtml(t.failReason || '')}</details>` : ''}
          <div class="nfy-rec-text">${escapeHtml(t.text || '—')}</div></div>
        </div>`
      }).join('') : '<div class="empty-state small-empty">还没有通知记录 —— 打开规则页的开关后,系统会按事件与每日扫描生成。</div>'}`
    el.innerHTML = `
      <div class="nfy2">
        <div class="nfy-tabs">
          <button type="button" class="nfy-tab ${st.tab === 'rules' ? 'on' : ''}" data-nfy-tab="rules">规则</button>
          <button type="button" class="nfy-tab ${st.tab === 'records' ? 'on' : ''}" data-nfy-tab="records">记录</button>
        </div>
        ${st.tab === 'rules' ? rulesTab : recordsTab}
      </div>`
    bind()
  }

  async function refreshPreview(type) {
    const { request } = st.deps
    const tpl = st.draft[type] !== undefined ? st.draft[type] : (st.rules.find((r) => r.type === type) || {}).templateText
    try {
      const r = await request('/admin/notify/preview', { method: 'POST', body: JSON.stringify({ type, templateText: tpl }) })
      st.preview[type] = r.preview
      const em = st.mount.querySelector(`[data-nfy-prev="${type}"]`)
      if (em) em.textContent = r.preview
    } catch (e) {
      st.preview[type] = `⚠ ${e.message || '预览失败'}`
      const em = st.mount.querySelector(`[data-nfy-prev="${type}"]`)
      if (em) em.textContent = st.preview[type]
    }
  }

  function bind() {
    const { request, toast } = st.deps
    const el = st.mount
    el.querySelectorAll('[data-nfy-tab]').forEach((b) => b.addEventListener('click', async () => {
      st.tab = b.dataset.nfyTab
      if (st.tab === 'records') await loadQueue()
      render()
    }))
    el.querySelector('[data-nfy-filter]')?.addEventListener('change', async (ev) => { st.filter = ev.target.value; render() })
    /* 开关:点即存(图合同三①)—— 只发 enabled,后端按已存值保参数 */
    el.querySelectorAll('[data-nfy-on]').forEach((cb) => cb.addEventListener('change', async () => {
      try {
        const resp = await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type: cb.dataset.nfyOn, enabled: cb.checked }] }) })
        st.rules = resp.rules
        toast(cb.checked ? '已开启' : '已关闭')
      } catch (e) { toast(e.message || '保存失败') }
      render()
    }))
    el.querySelectorAll('[data-nfy-tpl]').forEach((ta) => ta.addEventListener('input', () => {
      st.draft[ta.dataset.nfyTpl] = ta.value
      clearTimeout(st['_t' + ta.dataset.nfyTpl])
      st['_t' + ta.dataset.nfyTpl] = setTimeout(() => refreshPreview(ta.dataset.nfyTpl), 350)
    }))
    el.querySelectorAll('[data-nfy-chip]').forEach((b) => b.addEventListener('click', () => {
      const type = b.dataset.nfyChip
      const ta = el.querySelector(`[data-nfy-tpl="${type}"]`)
      const ins = `{${b.dataset.var}}`
      const pos = ta.selectionStart ?? ta.value.length
      ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(ta.selectionEnd ?? pos)
      ta.focus(); ta.selectionStart = ta.selectionEnd = pos + ins.length
      ta.dispatchEvent(new Event('input'))
    }))
    el.querySelectorAll('[data-nfy-save]').forEach((b) => b.addEventListener('click', async () => {
      const type = b.dataset.nfySave
      const patch = { type, enabled: el.querySelector(`[data-nfy-on="${type}"]`)?.checked !== false, templateText: el.querySelector(`[data-nfy-tpl="${type}"]`)?.value ?? '' }
      el.querySelectorAll(`[data-nfy-num][data-type="${type}"]`).forEach((inp) => { patch[inp.dataset.nfyNum] = Number(inp.value) })
      try {
        const resp = await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [patch] }) })
        st.rules = resp.rules
        delete st.draft[type]
        toast('已保存,之后生成的通知用新文案')
        render()
        refreshPreview(type)
      } catch (e) { toast(e.message || '保存失败') }
    }))
    el.querySelectorAll('[data-nfy-reset]').forEach((b) => b.addEventListener('click', async () => {
      const type = b.dataset.nfyReset
      try {
        const resp = await request('/admin/notify/rules', { method: 'PUT', body: JSON.stringify({ rules: [{ type, templateText: '' }] }) })
        st.rules = resp.rules
        delete st.draft[type]
        toast('已恢复默认文案')
        render()
        refreshPreview(type)
      } catch (e) { toast(e.message || '操作失败') }
    }))
  }

  async function loadQueue() {
    const { request } = st.deps
    const resp = await request('/admin/notify/queue')
    st.tasks = resp.tasks || []
  }

  window.NotifySettings = {
    async mount(el, deps) {
      if (!el) return
      st = { ...st, deps, mount: el, draft: {}, preview: {} }
      try {
        st.rules = (await deps.request('/admin/notify/rules')).rules || []
      } catch (e) {
        el.innerHTML = `<div class="empty-state small-empty">通知设置加载失败:${deps.escapeHtml(e.message || '')}</div>`
        return
      }
      render()
      st.rules.filter((r) => r.enabled).forEach((r) => refreshPreview(r.type))
    }
  }
})()
