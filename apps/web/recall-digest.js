/* 沉睡召回周报横条(店主 2026-08-31 裁清单#13:设计初衷就是老板首页横条,网页补上)。
   读与小程序同一条 GET /admin/recall-digest(后端懒生成,当周缓存;仅老板 403 闸在后端)。
   句/名单全后端;本条零金额运算。 */
window.RecallDigest = (function () {
  'use strict'
  let cache = null
  async function mount(el, { request, escapeHtml, toast }) {
    if (!el) return
    if (!cache) {
      try { cache = (await request('/admin/recall-digest')).digest } catch (e) { el.innerHTML = ''; return }
    }
    const d = cache
    if (!d || !d.count) { el.innerHTML = '' ; return }
    el.innerHTML = `
      <div class="recall-strip card">
        <strong>沉睡召回 · 本周 ${d.count} 位</strong>
        <span class="subtle">${escapeHtml((d.items || []).map((i) => i.name).slice(0, 5).join('、'))}</span>
        <button class="ghost slim" data-rcd-toggle type="button">看话术</button>
        <div class="recall-items hidden">
          ${(d.items || []).map((i) => `
            <div class="recall-item"><strong>${escapeHtml(i.name || '')}</strong> <span class="subtle">${i.lastVisitDays != null ? `${i.lastVisitDays} 天没来` : ''}</span>
              <p>${escapeHtml(i.message || '')}</p>
              <button class="ghost slim" data-rcd-copy="${escapeHtml(i.message || '')}" type="button">复制</button></div>`).join('')}
        </div>
      </div>`
    el.querySelector('[data-rcd-toggle]')?.addEventListener('click', () => el.querySelector('.recall-items').classList.toggle('hidden'))
    el.querySelectorAll('[data-rcd-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.rcdCopy); toast('话术已复制') } catch (e) { toast('复制失败') }
    }))
  }
  return { mount }
})()
