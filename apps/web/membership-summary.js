/* 会员与营销的只读规则，与小程序读取同一份服务端说明。 */
;(function (root) {
  let sequence = 0
  function show({ host, request, escapeHtml, visible }) {
    const current = ++sequence
    if (!visible) return
    host.innerHTML = '<h2>会员体系</h2><p class="subtle" role="status">正在读取会员规则…</p>'
    async function load() {
      host.innerHTML = '<h2>会员体系</h2><p class="subtle" role="status">正在读取会员规则…</p>'
      try {
        const result = await request('/admin/membership/config')
        if (current !== sequence) return
        if (!Array.isArray(result.summaryRows) || !result.summaryRows.length) throw new Error('未能读取会员规则，请重试')
        host.innerHTML = '<h2>会员体系</h2><dl class="membership-summary-list">' + result.summaryRows.map(row =>
          '<div><dt>' + escapeHtml(row.label) + '</dt><dd>' + escapeHtml(row.value) + '</dd></div>'
        ).join('') + '</dl><p class="subtle">' + escapeHtml(result.editHint || '') + '</p>'
      } catch (_) {
        if (current !== sequence) return
        host.innerHTML = '<h2>会员体系</h2><p class="subtle" role="alert">会员规则读取失败，请重试。</p><button type="button" class="ghost slim">重新加载</button>'
        host.querySelector('button').addEventListener('click', load, { once: true })
      }
    }
    return load()
  }
  root.LLMembershipSummary = { show }
})(window)
