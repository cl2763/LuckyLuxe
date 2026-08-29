/* 订单管理 ·「今天」界面(2026-08-30,店主:「把订单管理的今天界面也做成跟小程序里排单
   那个界面一样」—— 小程序排单(今日台面)屏 = 设计合同)。

   骨(全部与小程序同源,零第二口径):
     · 数据源 = **同一条** GET /admin/schedule-day?date=(小程序 loadDayView 调的就是它);
     · 口径字段全部后端给:块颜色组 group、到店态 arrivalState、售后蓝徽标 afterSalesTag(后端句)、
       休息日 isClosed/specialNote、营业时段 openTime/closeTime;
     · 布局几何与小程序 loadDayView **同构同参**(PX_PER_HOUR=96 → 网页 px;空档 ≥30 分钟才显示;
       网格范围 = 营业时段 ∪ 当天全部预约,营业时段外整点行淡色 —— 店主 08-09 拍的口径,一条不少)。
   ⚠️ 已知分叉登记:这段几何组装小程序端也有一份(pages/merchant/orders loadDayView)——
   与 wxml/wxss 同属「皮」,口径字段都在后端;schedule-day 与 schedule-week 的路由收敛在判定表块 4。

   皮:日期条(‹ 日期 › + 今天/返回今天)· 汇总 pills · 技师列网格(表头 名/角色/忙空)·
   空档块「+ 直接排单」· 订单块(时间/顾客/服务 + 状态点 ●/✓ + 徽标)· 图例两行。
   「待日结」pill 直达财务日结页(小程序是同屏下半块;网页日结住财务页 —— 一次点击到达,动作数同)。 */
window.TodayBoard = (function () {
  const PX_PER_HOUR = 48                       // 小程序 96rpx/h ≈ 48px/h,同一比例
  const WK = ['日', '一', '二', '三', '四', '五', '六']
  const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0) }
  const pad = (n) => String(n).padStart(2, '0')
  const m2t = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

  let stateT = { date: '', dv: null, deps: null, free: null }   // free = 空档直排面板 { techId, time, q, hits, userId, name, newName, serviceId }

  async function load(date, deps) {
    stateT.deps = deps
    stateT.date = date
    const { request, toast } = deps
    try {
      const r = await request(`/admin/schedule-day?date=${date}`)
      stateT.dv = assemble(date, r, deps)
    } catch (e) {
      stateT.dv = null
      toast((e && e.message) || '加载今日台面失败')
    }
    render()
  }

  /* 与小程序 loadDayView 同构:网格范围 = 营业时段 ∪ 预约跨度;空档 ≥30 分才显示 */
  function assemble(date, r, deps) {
    const bizOpen = toMin(r.openTime || '10:00'); const bizClose = toMin(r.closeTime || '19:00')
    let openMin = bizOpen; let closeMin = bizClose
    for (const b of (r.bookings || [])) {
      openMin = Math.min(openMin, toMin(b.startTime))
      closeMin = Math.max(closeMin, toMin(b.endTime))
    }
    openMin = Math.floor(openMin / 60) * 60
    closeMin = Math.ceil(closeMin / 60) * 60
    const gridH = Math.round(Math.max(60, closeMin - openMin) / 60 * PX_PER_HOUR)
    const hours = []
    for (let m = openMin; m < closeMin; m += 60) hours.push({ label: `${pad(Math.floor(m / 60))}:00`, off: m < bizOpen || m >= bizClose })
    const byTech = {}
    ;(r.bookings || []).forEach((b) => { (byTech[b.technicianId] = byTech[b.technicianId] || []).push(b) })
    let freeTotal = 0
    const cols = (r.technicians || []).map((t) => {
      const list = (byTech[t.id] || []).slice().sort((a, b) => toMin(a.startTime) - toMin(b.startTime))
      const blocks = list.map((b) => {
        const s = toMin(b.startTime); const e = Math.max(s + 20, toMin(b.endTime))
        const state = b.arrivalState || 'pending'
        return {
          id: b.id, cls: `${b.group || 'hand'} ${state}`, state,
          stateGlyph: state === 'active' ? '●' : (state === 'done' ? '✓' : ''),
          top: Math.round((s - openMin) / 60 * PX_PER_HOUR), height: Math.max(20, Math.round((e - s) / 60 * PX_PER_HOUR)),
          startTime: b.startTime, endTime: b.endTime, customerName: b.customerName, serviceName: b.serviceName,
          isNewCustomer: b.isNewCustomer, isDesignated: b.isDesignated, ownerDirect: b.ownerDirect,
          depositUnpaid: b.depositUnpaid, afterSalesTag: b.afterSalesTag || ''
        }
      })
      const frees = []; let cursor = openMin
      list.forEach((b) => {
        const s = toMin(b.startTime)
        if (s - cursor >= 30) { frees.push({ startTime: m2t(cursor), top: Math.round((cursor - openMin) / 60 * PX_PER_HOUR), height: Math.round((s - cursor) / 60 * PX_PER_HOUR) }); freeTotal += (s - cursor) }
        cursor = Math.max(cursor, toMin(b.endTime))
      })
      if (closeMin - cursor >= 30) { frees.push({ startTime: m2t(cursor), top: Math.round((cursor - openMin) / 60 * PX_PER_HOUR), height: Math.round((closeMin - cursor) / 60 * PX_PER_HOUR) }); freeTotal += (closeMin - cursor) }
      return { id: t.id, name: t.name, role: t.title || '', busy: t.bookingCount > 0, blocks, frees }
    })
    const d = new Date(`${date}T00:00:00`)
    const todayStr = deps.storeToday()
    return {
      date, dateText: `${d.getMonth() + 1}月${d.getDate()}日 周${WK[d.getDay()]}`,
      isToday: date === todayStr,
      hoursUnset: Boolean(r.hoursUnset),   // D84 三态:未设置 ≠ 休息
      isClosed: r.isClosed, specialNote: r.specialNote || '',
      gridH, hours, cols,
      total: (r.bookings || []).length, working: cols.length,
      freeHours: Math.round(freeTotal / 60 * 10) / 10, activeCount: r.activeCount || 0
    }
  }

  function render() {
    const mount = document.querySelector('#todayBoard')
    if (!mount) return
    const { escapeHtml, pendingCloseCount } = stateT.deps
    const dv = stateT.dv
    if (!dv) { mount.innerHTML = '<div class="empty-state">加载中…</div>'; return }
    mount.innerHTML = `
      <div class="tb-datebar">
        <button class="tb-nav" data-tb-prev type="button">‹</button>
        <span class="tb-date">${escapeHtml(dv.dateText)}</span>
        <button class="tb-nav" data-tb-next type="button">›</button>
        <button class="tb-today ${dv.isToday ? 'cur' : ''}" data-tb-today type="button">${dv.isToday ? '今天' : '返回今天'}</button>
      </div>
      ${dv.hoursUnset ? `
      <div class="tb-setup-wall">
        <strong>还没设置营业时间</strong>
        <p>设置营业时间后,今天台面、排班表和顾客可约时段才会亮起来 —— 没设置不等于休息。</p>
        <button class="primary slim" data-tb-setup type="button">去设置营业时间</button>
      </div>` : dv.isClosed ? `<div class="tb-closed">本日休息${dv.specialNote ? ' · ' + escapeHtml(dv.specialNote) : ''}</div>` : `
      <div class="tb-summary">
        <span class="tb-pill">今日 <b>${dv.total}</b> 单</span>
        ${dv.activeCount ? `<span class="tb-pill live">在做 <b>${dv.activeCount}</b> 人</span>` : ''}
        <span class="tb-pill">在岗 <b>${dv.working}</b> 人</span>
        <span class="tb-pill">空档 <b>${dv.freeHours}</b> h</span>
        ${pendingCloseCount ? `<button class="tb-pill hot" data-tb-close type="button">待日结 <b>${pendingCloseCount}</b></button>` : ''}
      </div>
      ${dv.cols.length ? `
      <div class="tb-grid">
        <div class="tb-left">
          <div class="tb-corner"></div>
          <div class="tb-gutter" style="height:${dv.gridH}px">
            ${dv.hours.map((h) => `<div class="tb-hr ${h.off ? 'off' : ''}">${h.label}</div>`).join('')}
          </div>
        </div>
        <div class="tb-right">
          <div class="tb-rin">
            <div class="tb-heads">
              ${dv.cols.map((c) => `<div class="tb-th"><div class="tb-nm">${escapeHtml(c.name)}</div><div class="tb-rl">${escapeHtml(c.role)}</div><div class="tb-st ${c.busy ? 'busy' : 'free'}">${c.busy ? '忙' : '空'}</div></div>`).join('')}
            </div>
            <div class="tb-cols" style="height:${dv.gridH}px">
              ${dv.cols.map((col) => `
                <div class="tb-col">
                  ${dv.hours.map((h) => `<div class="tb-line ${h.off ? 'off' : ''}"></div>`).join('')}
                  ${col.frees.map((f) => `<button class="tb-blk free" style="top:${f.top}px;height:${f.height}px" data-tb-free="${col.id}" data-time="${f.startTime}" type="button"><span>+ 直接排单</span></button>`).join('')}
                  ${col.blocks.map((b) => `
                    <button class="tb-blk ${b.cls}" style="top:${b.top}px;height:${b.height}px" data-tb-block="${b.id}" type="button">
                      <span class="tb-bt">${b.stateGlyph ? `<i class="tb-sdot ${b.state}">${b.stateGlyph}</i>` : ''}${b.startTime}–${b.endTime}</span>
                      <span class="tb-bn">${escapeHtml(b.customerName || '')}</span>
                      <span class="tb-bs">${escapeHtml(b.serviceName || '')}</span>
                      <span class="tb-tags">
                        ${b.afterSalesTag ? `<em class="tb-tag as-blue">${escapeHtml(b.afterSalesTag)}</em>`
                          : b.ownerDirect ? '<em class="tb-tag owner">老板排</em>'
                          : b.isDesignated ? '<em class="tb-tag zhi">指定</em>'
                          : b.isNewCustomer ? '<em class="tb-tag xin">新客</em>' : ''}
                        ${b.depositUnpaid ? '<em class="tb-unpaid">未付定金</em>' : ''}
                      </span>
                    </button>`).join('')}
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="tb-legend top"><span class="tb-legend-hd">图例 · 平时不用看</span>
        <span><i class="lg hand"></i>手部美甲</span><span><i class="lg foot"></i>足部美甲</span>
        <span><i class="lg lash"></i>美睫</span><span><i class="lg care"></i>护理</span><span><i class="lg free"></i>空档·点排</span></div>
      <div class="tb-legend">淡色=未到 · <i class="tb-sdot active">●</i>进行中 · <i class="tb-sdot done">✓</i>完成 · 点空档=直接排单</div>
      ` : '<div class="empty-state">本日无在岗技师</div>'}`}
    `
    if (stateT.free) mount.insertAdjacentHTML('beforeend', renderFreePanel(escapeHtml))
    bind(mount)
  }

  /* 空档「+ 直接排单」= 小程序 tapFree 的直排面板同功能(死口清剿三.1:不再指小程序)。
     同一条后端路由 POST /admin/bookings/direct;技师与时间就是点的那个空档。 */
  function renderFreePanel(escapeHtml) {
    const f = stateT.free
    const tech = (stateT.dv.cols.find(function (c) { return c.id === f.techId }) || {})
    const services = (stateT._services || []).filter(function (i) { return (i.itemKind || 'main') === 'main' })
    return `
      <div class="sw-cpnmask" data-tbf-close></div>
      <div class="sw-cpnsheet">
        <div class="sw-ch">直接排单 · ${escapeHtml(tech.name || '')} · ${escapeHtml(stateT.date)} ${escapeHtml(f.time)}</div>
        <div class="sw-sec">顾客(搜现有,或直接填新客姓名)</div>
        <input class="sw-in full" data-tbf-q placeholder="搜姓名 / 手机号,或直接填新客姓名" value="${escapeHtml(f.q || '')}">
        ${(f.hits || []).map(function (h) { return `<button class="sw-cpn ${f.userId === h.id ? 'on' : ''}" data-tbf-pick="${escapeHtml(h.id)}" data-name="${escapeHtml(h.displayName)}" type="button"><span class="l"><span class="n">${escapeHtml(h.displayName)}</span><span class="s">${escapeHtml(h.phoneMasked || '')}</span></span></button>` }).join('')}
        ${f.userId ? `<p class="sw-grppicked">已选:${escapeHtml(f.name)}(再点搜索结果可换)</p>` : (f.q ? `<p class="sw-hint-line">没选中现有顾客时,「${escapeHtml(f.q)}」将按**新客**建档排单</p>` : '')}
        <div class="sw-sec">服务项目</div>
        <div class="sw-chiprow">
          ${services.map(function (i) { return `<button class="sw-chip ${f.serviceId === i.id ? 'on' : ''}" data-tbf-svc="${escapeHtml(i.id)}" type="button">${escapeHtml(i.nameZh || i.name)}</button>` }).join('')}
        </div>
        <button class="sw-cta" data-tbf-submit type="button">排进 ${escapeHtml(f.time)} 这个空档</button>
      </div>`
  }

  function bind(mount) {
    const deps = stateT.deps
    mount.querySelector('[data-tb-prev]')?.addEventListener('click', function () { load(shift(stateT.date, -1), deps) })
    mount.querySelector('[data-tb-next]')?.addEventListener('click', function () { load(shift(stateT.date, 1), deps) })
    mount.querySelector('[data-tb-today]')?.addEventListener('click', function () { load(deps.storeToday(), deps) })
    mount.querySelector('[data-tb-close]')?.addEventListener('click', function () { deps.goDailyClose() })
    mount.querySelector('[data-tb-setup]')?.addEventListener('click', function () { deps.goHoursSetup() })
    mount.querySelectorAll('[data-tb-block]').forEach(function (el) {
      /* 点块 = 打开该单(与小程序 tapBlock 出操作面板同一动作数:1 下)——
         去结算按钮仍在展开的订单卡上原位(后端 settleAction 出,店主刚学会的那个位置) */
      el.addEventListener('click', function () { deps.openBooking(el.dataset.tbBlock) })
    })
    mount.querySelectorAll('[data-tb-free]').forEach(function (el) {
      el.addEventListener('click', function () { deps.onFreeSlot(el.dataset.tbFree, el.dataset.time, stateT.date) })
    })
    mount.querySelector('[data-tbf-close]')?.addEventListener('click', function () { stateT.free = null; render() })
    mount.querySelector('[data-tbf-q]')?.addEventListener('input', function (e2) {
      const f = stateT.free
      f.q = e2.target.value; f.userId = ''
      clearTimeout(stateT._ft)
      stateT._ft = setTimeout(async function () {
        const q = f.q.trim()
        if (!q) { f.hits = []; render(); return }
        const r = await deps.request(`/admin/customers?q=${encodeURIComponent(q)}`).catch(function () { return { customers: [] } })
        f.hits = (r.customers || []).slice(0, 5).map(function (c) { return { id: c.id, displayName: c.displayName, phoneMasked: c.phoneMasked || '' } })
        render()
        const box = mount.ownerDocument.querySelector('[data-tbf-q]')
        if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length) }
      }, 300)
    })
    mount.querySelectorAll('[data-tbf-pick]').forEach(function (el) {
      el.addEventListener('click', function () { stateT.free.userId = el.dataset.tbfPick; stateT.free.name = el.dataset.name; render() })
    })
    mount.querySelectorAll('[data-tbf-svc]').forEach(function (el) {
      el.addEventListener('click', function () { stateT.free.serviceId = el.dataset.tbfSvc; render() })
    })
    mount.querySelector('[data-tbf-submit]')?.addEventListener('click', async function () {
      const f = stateT.free
      if (!f.serviceId) { deps.toast('先选服务项目'); return }
      if (!f.userId && !f.q.trim()) { deps.toast('选一位顾客,或填新客姓名'); return }
      try {
        const body = { serviceId: f.serviceId, technicianId: f.techId, date: stateT.date, time: f.time }
        if (f.userId) body.userId = f.userId
        else body.newCustomerName = f.q.trim()
        await deps.request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify(body) })
        deps.toast('已排进空档 —— 点这个块可去结算')
        stateT.free = null
        load(stateT.date, deps)
      } catch (e2) { deps.toast((e2 && e2.message) || '排单失败') }
    })
  }

  function shift(date, days) {
    const d = new Date(`${date}T00:00:00`)
    d.setDate(d.getDate() + days)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  /* 接线收在模块里(棘轮:admin.js 只留 4 行转发):容器 + 缺省 deps 一次装配。
     「待日结」不重复出 pill —— 订单页顶的直达条(dcJumpBar)本来就在;空档点排=本端直排面板(renderFreePanel)。 */
  function mountInto(listEl, deps) {
    listEl.innerHTML = '<div id="todayBoard"></div>'
    load(deps.storeToday(), Object.assign({
      pendingCloseCount: 0,
      goHoursSetup: function () {
        const btn = [].slice.call(document.querySelectorAll('button')).find(function (x) { return x.dataset.adminPage === 'storeSettings' || x.textContent.trim() === '门店设置' })
        if (btn) btn.click()
      },
      goDailyClose: function () { document.querySelector('#dcJumpGo')?.click() },
      onFreeSlot: async function (techId, time) {
        if (!stateT._services) {
          const r = await deps.request('/admin/pricing/items').catch(function () { return { items: [] } })
          stateT._services = (r.items || []).filter(function (i) { return i.isActive !== false })
        }
        stateT.free = { techId, time, q: '', hits: [], userId: '', name: '', serviceId: '' }
        render()
      }
    }, deps))
  }

  return { load, render, mountInto, _state: stateT }
})()
