/* 顾客档案页 ·「服务小记 + 自动画像」面板 —— 从 `admin.js` **原样搬出**(10b,公约②「边改边拆」)
 *
 * 为什么这一批搬它:10b §二 裁了「`admin.js` 只留挂载点,净变化 ≤ 0」。
 * 签署文件那一块新挂了六行,得有地方还 —— 而**同一个页面的邻居面板**就是该跟着走的那一段
 * (公约②:动哪个领域就把该领域搬出去,不专门开重构批)。
 *
 * 🔴 **一个字都没改**,只是从 `admin.js` 搬到这里;它用的 `request` / `escapeHtml` / `owner`
 * 仍是 `admin.js` 的全局,在**运行时**才取,所以脚本先后顺序不影响。
 */
// 2026-08-02 服务小记+画像(只读;与小程序画像页同一 /admin/customers/:id/notes 口径)
window.loadCustomerNotes = function loadCustomerNotes(customerId) {
  if (!document.querySelector('#customerNotesBody')) return
  const zh = owner.lang === 'zh'
  request(`/admin/customers/${customerId}/notes`)
    .then((data) => {
      const target = document.querySelector('#customerNotesBody')
      if (!target || owner.selectedCustomerId !== customerId) return // 用户已切走,丢弃
      const p = data.profile || {}
      const tag = (text, danger) => `<span class="customer-tag"${danger ? ' style="background:var(--bad);color:var(--heroink);font-weight:700"' : ''}>${escapeHtml(text)}</span>`
      const groups = [
        [zh ? '⚠ 安全' : '⚠ Safety', p.safetyFlags || [], true],
        [zh ? '款式' : 'Styles', p.styles || [], false],
        [zh ? '偏好' : 'Prefers', p.preferences || [], false],
        [zh ? '性格' : 'Personality', p.personality || [], false],
        [zh ? '同行' : 'Companions', p.companions || [], false]
      ].filter((g) => g[1].length)
      const stats = []
      if (p.visitCount) stats.push(`${zh ? '到店' : 'visits'} ${p.visitCount}${zh ? ' 次' : ''}`)
      if (p.avgIntervalDays) stats.push(`${zh ? '平均间隔' : 'avg interval'} ${p.avgIntervalDays}${zh ? ' 天' : 'd'}`)
      if (p.topService) stats.push(`${zh ? '常做' : 'top'} ${escapeHtml(p.topService)}`)
      const notes = data.notes || []
      target.innerHTML = `
        ${groups.length
          ? `<div class="customer-tags" style="flex-wrap:wrap;gap:6px;margin-bottom:6px">${groups.map(([label, items, danger]) =>
              `<span class="subtle" style="margin:0 2px 0 6px${danger ? ';color:var(--bad);font-weight:700' : ''}">${label}</span>${items.map((x) => tag(x, danger)).join('')}`).join('')}</div>`
          : `<p class="subtle">${zh ? '还没有画像标签。技师写服务小记(小程序或网页「我的客人」)后,画像会自动生成。' : 'No profile yet — technicians add service notes (mini app, or "My Customers" on web) when completing orders.'}</p>`}
        ${stats.length ? `<p class="subtle">${stats.join(' · ')}</p>` : ''}
        ${notes.length ? notes.map((n) => `
          <div class="finance-rule-row" style="align-items:flex-start">
            <span>
              <strong>${escapeHtml(n.date || '')}</strong> · ${escapeHtml(n.serviceName || '-')}${n.technicianName ? ` · ${escapeHtml(n.technicianName)}` : ''}
              <br><span>${escapeHtml(n.rawText || '')}</span>
            </span>
          </div>`).join('') : `<p class="subtle">${zh ? '暂无服务小记。' : 'No notes yet.'}</p>`}
      `
    })
    .catch((error) => {
      const target = document.querySelector('#customerNotesBody')
      if (target) target.innerHTML = `<p class="subtle">${escapeHtml(error.message || '加载失败')}</p>`
    })
}
