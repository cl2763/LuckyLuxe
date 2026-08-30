/* 营业时间强制设置(《营业时间强制设置图 v1.0》· D84 · 2026-08-30)。

   合同一:老板号登录进店,店铺处于未设置态 → 进任何管理页之前先见全屏本页,无 ×、无「稍后再说」。
   合同四:员工号只见提示墙,没有表单。
   接线:admin.js 的 render() 顶部一行 gate() —— render 是全部管理页的唯一渲染咽喉,
   gate 返回 true 即短路(A1:放行一条绕过路由=必红,由 test-hours-gate 守)。
   文案全部来自后端 hoursGateText(后端出句;本页零拼串、零金额、零时间运算)。 */
window.HoursSetup = (function () {
  const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  /* 图屏①排序:周一开头(weekday 1..6,0 最后) */
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

  const state = { days: null, saving: false }

  function blankDays() {
    /* 合同三(零回落):初始七天全不勾、时间空 —— 禁止任何预填默认 */
    const days = {}
    for (const w of DAY_ORDER) days[w] = { open: false, openTime: '', closeTime: '' }
    return days
  }

  function anyOpen(days) {
    return DAY_ORDER.some(function (w) { return days[w].open })
  }

  function mountEl() {
    let el = document.querySelector('#hoursSetupWall')
    if (!el) {
      el = document.createElement('div')
      el.id = 'hoursSetupWall'
      document.body.appendChild(el)
    }
    return el
  }

  /* gate:未设置态接管整屏。返回 true = 已接管,render() 短路。 */
  function gate(owner, deps) {
    const el = document.querySelector('#hoursSetupWall')
    if (!owner.hoursUnset) {
      if (el) el.remove()
      state.days = null
      return false
    }
    if (!state.days) state.days = blankDays()
    renderWall(owner, deps)
    return true
  }

  function renderWall(owner, deps) {
    const txt = owner.hoursGateText || {}
    const el = mountEl()
    const isOwner = (owner.role || 'owner') === 'owner'
    if (!isOwner) {
      /* 合同四 · 图屏②:员工墙 —— 只有提示,没有表单,没有按钮(A4:响应体里无表单元素) */
      el.innerHTML = `
        <div class="hsw-box hsw-staff">
          <div class="hsw-emoji">🕘</div>
          <div class="hsw-title">${deps.escapeHtml(txt.staffTitle || '')}</div>
          <div class="hsw-hint">${deps.escapeHtml(txt.staffHint || '')}</div>
        </div>`
      return
    }
    const days = state.days
    el.innerHTML = `
      <div class="hsw-box">
        <div class="hsw-title">${deps.escapeHtml(txt.ownerTitle || '')}</div>
        <div class="hsw-hint">${deps.escapeHtml(txt.ownerHint || '')}</div>
        ${DAY_ORDER.map(function (w) {
          const d = days[w]
          return `<div class="hsw-day">
            <button class="hsw-sw ${d.open ? 'on' : ''}" data-hsw-toggle="${w}" type="button" role="switch" aria-checked="${d.open}"></button>
            <span class="hsw-dn">${DAY_NAMES[w]}</span>
            ${d.open
              ? `<span class="hsw-times"><input type="time" data-hsw-open="${w}" value="${d.openTime}"> – <input type="time" data-hsw-close="${w}" value="${d.closeTime}"></span>`
              : `<span class="hsw-ph">${deps.escapeHtml(txt.timePlaceholder || '')}</span>`}
          </div>`
        }).join('')}
        <button class="hsw-save ${anyOpen(days) ? 'go' : 'dis'}" data-hsw-save type="button" ${anyOpen(days) && !state.saving ? '' : 'disabled'}>${state.saving ? '保存中…' : deps.escapeHtml(txt.saveButton || '')}</button>
        ${anyOpen(days) ? '' : `<div class="hsw-note">${deps.escapeHtml(txt.saveDisabledNote || '')}</div>`}
      </div>`
    bind(el, owner, deps)
  }

  function bind(el, owner, deps) {
    el.querySelectorAll('[data-hsw-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const w = Number(btn.dataset.hswToggle)
        state.days[w].open = !state.days[w].open
        renderWall(owner, deps)
      })
    })
    el.querySelectorAll('[data-hsw-open],[data-hsw-close]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        const w = Number(inp.dataset.hswOpen ?? inp.dataset.hswClose)
        if (inp.dataset.hswOpen !== undefined) state.days[w].openTime = inp.value
        else state.days[w].closeTime = inp.value
      })
    })
    el.querySelector('[data-hsw-save]')?.addEventListener('click', function () { save(owner, deps) })
  }

  async function save(owner, deps) {
    const days = state.days
    for (const w of DAY_ORDER) {
      const d = days[w]
      if (d.open && (!d.openTime || !d.closeTime)) { deps.toast(`${DAY_NAMES[w]}还没选时间`); return }
      if (d.open && d.openTime >= d.closeTime) { deps.toast(`${DAY_NAMES[w]}的开始时间要早于结束时间`); return }
    }
    state.saving = true
    renderWall(owner, deps)
    try {
      /* 七天整份提交(A2 后端终闸在 PUT 里守「至少一天营业」) */
      await deps.request('/admin/business-hours', {
        method: 'PUT',
        body: JSON.stringify({
          hours: DAY_ORDER.map(function (w) {
            const d = days[w]
            return d.open
              ? { weekday: w, openTime: d.openTime, closeTime: d.closeTime, isClosed: false }
              : { weekday: w, isClosed: true }
          })
        })
      })
      /* 合同五(A5):设完立即生效,不退出重进 —— 整份重拉,台面按三态渲染 */
      state.saving = false
      owner.hoursUnset = false
      await deps.reboot()
    } catch (e) {
      state.saving = false
      deps.toast((e && e.message) || '保存失败')
      renderWall(owner, deps)
    }
  }

  return { gate, _state: state }
})()
