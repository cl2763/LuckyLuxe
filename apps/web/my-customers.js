/* 员工端「我的客人」(2026-08-27,店主走查回执 ④)。

   两条道理写在这儿,免得下次有人往这页加东西:
   ①**看不到的东西不该出现在菜单里** —— 会员套餐/券那处「点了才报错」就是反面教材;
   ②但也不能全藏 —— 技师看自己服务过的客人是干活要用的,所以给这一页:
     只列他服务过的、**只读**、**零金额编辑入口**(改余额、退卡是老板的口)。
   判据里数的就是第 ② 条:这页上账户调整/充值类按钮数必须为 0。 */
window.MyCustomers = (function () {
  async function render(box, { zh, request, escapeHtml, dateOnly }) {
    if (!box) return
    box.innerHTML = `<h2>${zh ? '我的客人' : 'My clients'}</h2><p class="subtle">${zh ? '读取中…' : 'Loading…'}</p>`
    try {
      const d = await request('/admin/my-customers')
      const list = d.customers || []
      box.innerHTML = `
        <h2>${zh ? '我的客人' : 'My clients'}</h2>
        <p class="subtle">${escapeHtml(d.note || '')}</p>
        ${list.length ? list.map((c) => `
          <article class="customer-profile-card card">
            <div class="customer-avatar">${escapeHtml(String(c.displayName || '?').slice(0, 1).toUpperCase())}</div>
            <div>
              <h3>${escapeHtml(c.displayName)}</h3>
              <p class="subtle">${escapeHtml(c.memberCode || '')}${c.phoneMasked ? ` · ${escapeHtml(c.phoneMasked)}` : ''}</p>
            </div>
            <div class="customer-stats">
              <span>${zh ? '服务次数' : 'Visits'} <strong>${c.visits}</strong></span>
              <span>${zh ? '最近' : 'Last'} <strong>${escapeHtml(dateOnly(c.lastVisitAt))}</strong></span>
            </div>
          </article>`).join('')
        : `<div class="empty-state"><strong>${zh ? '还没有服务过的客人' : 'No clients yet'}</strong></div>`}`
    } catch (e) {
      box.innerHTML = `<h2>${zh ? '我的客人' : 'My clients'}</h2><div class="empty-state"><strong>${escapeHtml(e.message)}</strong></div>`
    }
  }
  return { render }
})()
