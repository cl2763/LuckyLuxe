/* 网页商家后台 · 订单状态与动作表达域(从 admin.js 搬出,2026-08-24)
   公约②「边改边拆」:D70 这一刀改的就是这块(按钮显隐改由状态机、售后分组改按售后轨道),
   按约定顺手把域搬出来 —— admin.js 只许瘦不许胖(棘轮律)。

   这里只放**判定与表达**,不放取数与交互绑定(那两件仍在 admin.js):
   · 状态筛选的唯一判定(订单列表 / 台面 / 日历共用一份,四之九)
   · 售后只读区的 HTML(合同④:售后中详情=售后详情+订单详情同屏)
   全局函数,admin.js 之前加载;依赖 escapeHtml 在运行时解析(同为全局)。 */

function activeStatuses() {
  return ['PENDING_PAYMENT', 'CONFIRMED']
}

/* D51:售后是否仍开着(pending/processing)。resolved/closed=售后完成。
   afterSales 只随 AFTER_SALES 状态下发;对象缺失时按「开着」算(宁可多进需关注,不许漏)。 */
/* 🔴 D70 合同⑤(店主 08-24):**售后不改写主状态**,分组改按售后字段筛。
   原来判据是 `status === 'AFTER_SALES'` —— 主状态一被改走(比如误点「已完成」),
   单子就从售后分组消失、再也找不到(D70 现象④)。现在只看售后轨道字段,与主状态无关。
   判据同源:后端 booking-state.mjs 的 isAfterSalesOpen 是同一套(pending/processing=售后中)。 */
function isAfterSalesOpen(booking) {
  return ['pending', 'processing'].includes(booking.afterSalesStatus || booking.afterSales?.status || '')
}
function hasAfterSalesTrack(booking) {
  return Boolean(booking.afterSalesStatus || booking.afterSales?.status)
}

/* D51:状态筛选唯一判定 —— 订单列表/台面/日历同一实现,不许各写一份(四之九)。
   「需关注」含售后中(店主 08-18 立 D51 点名)。 */
function matchesStatusFilter(booking, status) {
  if (status === 'all') return true
  if (status === 'active') return activeStatuses().includes(booking.status) || isAfterSalesOpen(booking)
  if (status === 'AFTER_SALES_OPEN') return isAfterSalesOpen(booking)
  if (status === 'AFTER_SALES_DONE') return hasAfterSalesTrack(booking) && !isAfterSalesOpen(booking)
  return booking.status === status
}

function statusLabel(status, booking) {
  const labels = {
    PENDING_PAYMENT: t('pending'),
    CONFIRMED: t('confirmed'),
    COMPLETED: t('completed'),
    CANCELLED: t('cancelled'),
    EXPIRED: t('expired'),
    /* D51:原映射「需关注」——售后单在任何列表里都不自报身份,店主根本找不到(根因之一)。
       细分文案(售后中/售后已解决/售后已关闭)由后端 listBadgeText 唯一持有,三端同句。 */
    AFTER_SALES: booking?.listBadgeText || t('afterSalesWord')
  }
  return labels[status] || status
}

/* 🔴 D70 合同④(店主 08-24):售后中的单,详情页要**同时**看得到售后处理详情。
   句子与小程序售后面板同源(后端 afterSalesProgress 唯一出口),这里只渲染不拼话。
   结案后照样看得到 —— 售后是留痕,不是临时弹窗。 */
function renderAfterSalesReadonly(as) {
  if (!as) return ''
  return `
      <div class="section-row compact-row"><h3>${escapeHtml(as.title || '售后')}</h3><span class="subtle">${escapeHtml(as.statusText || '')}</span></div>
      <div class="detail-grid">
        ${as.reason ? `<div><span class="subtle">发起原因</span><p>${escapeHtml(as.reason)}</p></div>` : ''}
        ${(as.steps || []).map((st) => `<div><span class="subtle">${st.done ? '●' : '○'} ${escapeHtml(st.label)}</span><p>${escapeHtml(st.at || '')}</p></div>`).join('')}
        ${as.resultText ? `<div><span class="subtle">处理结果</span><p>${escapeHtml(as.resultText)}</p></div>` : ''}
      </div>
      ${as.footnote ? `<p class="subtle">${escapeHtml(as.footnote)}</p>` : ''}`
}

/* 🔴 D70:订单动作钮 = 后端 allowedActions 直渲。**页面里不许写 if 补按钮** ——
   D70 开检的根因就是「已完成」「已取消」两颗裸按钮从来没写过规则,任何状态都能点。 */
function bookingActionButtons(booking) {
  return (booking.allowedActions || [])
    .map((a) => `<button class="ghost" data-booking-action="${a.key}" data-booking="${booking.id}" type="button">${escapeHtml(a.label)}</button>`)
    .join('')
}

/* 🔴 D71 已修(店主 08-24 立案):这里原来在没有真来源时**按订单号哈希编一个渠道名**
   (美团/小红书/抖音…)给店主看 —— 店主可能据此判断渠道效果做投放决策。
   现在句子由后端唯一给(order-badges.mjs 的 bookingSourceText):有真值说真值,没有就说「未记录来源」。
   前端只渲染,零编造、零回落。 */
function bookingSource(booking) {
  return booking.sourceText || '未记录来源'
}

/* 员工「我的今天」卡(2026-08-30 从 admin.js 搬来,只搬不改;owner/galleryGroups 等全局运行期解析) */
function renderStaffTodayTimeline() {
  const zh = owner.lang === 'zh'
  const today = (owner.bookings || [])
    .filter((booking) => isToday(booking.appointmentDate) && booking.status !== 'CANCELLED' && booking.status !== 'EXPIRED')
    .sort((a, b) => String(a.appointmentTime).localeCompare(String(b.appointmentTime)))
  // 待传作品/待审核入口放在这里(员工端没有首页,这张卡是员工每天必看的地方)
  const missingWork = (owner.bookings || []).filter((booking) => booking.status === 'COMPLETED' && !(booking.workImages || []).length && booking.galleryStatus !== 'approved').length
  const reviewCount = galleryGroups().filter((group) => group.booking.galleryStatus !== 'approved' && (group.images || []).length).length
  return `
    <section class="staff-timeline-card card">
      <div class="section-row compact-row">
        <h2>${zh ? '我的今天' : 'My Day'}</h2>
        <div class="staff-day-chips">
          ${missingWork ? `<button class="staff-day-chip chip-warn" data-admin-page="aiGallery" type="button">📷 ${zh ? '待传作品' : 'Missing photos'} ${missingWork}</button>` : ''}
          ${reviewCount ? `<button class="staff-day-chip" data-admin-page="aiGallery" type="button">${zh ? '待审核图' : 'For review'} ${reviewCount}</button>` : ''}
          <span class="subtle">${today.length ? `${today.length} ${zh ? '单' : 'bookings'}` : (zh ? '今天没有预约' : 'No bookings today')}</span>
        </div>
      </div>
      ${today.length ? today.map((booking) => `
        <div class="staff-timeline-row ${booking.status === 'COMPLETED' ? 'is-done' : ''}">
          <strong class="stl-time">${booking.appointmentTime}<small>–${booking.appointmentEndTime}</small></strong>
          <div class="stl-main">
            <strong>${escapeHtml(booking.user?.displayName || booking.publicCode)}</strong>
            <span>${escapeHtml(booking.service?.name || '-')} · ${booking.totalDurationMin || ''}${zh ? ' 分钟' : ' min'}</span>
            ${renderCustomerCare(booking)}
          </div>
          <span class="status ${booking.status}">${statusLabel(booking.status, booking)}</span>
        </div>`).join('') : ''}
    </section>`
}

function openRescheduleBooking(id) {
  const b=owner.bookings.find(x=>x.id===id)
  if(!b)return
  openFormModal({title:'预约改期',hint:'按门店当地时间选择新时段。保留原服务、技师和价格；如不符合定金保留规则，系统会说明原因，原预约不会改变。',
    fields:[{key:'date',label:'新日期',type:'date',value:b.appointmentDate},{key:'time',label:'新时间',type:'time',value:b.appointmentTime},{key:'reason',label:'改期原因（选填）',value:''}],saveText:'确认改期',
    onSave:async v=>{await request(`/admin/bookings/${encodeURIComponent(id)}/reschedule`,{method:'POST',body:JSON.stringify({...v,expectedStart:b.appointmentStart})});const d=await request('/admin/bookings');owner.bookings=d.bookings;toast('预约已改期');render()}})
}
