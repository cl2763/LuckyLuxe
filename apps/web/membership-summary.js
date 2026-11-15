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
        const [result,pricing] = await Promise.all([request('/admin/membership/config'),request('/admin/member-pricing/config')]);const personal=pricing.config.active && pricing.config.membershipEnabled
        if (current !== sequence) return
        if (!Array.isArray(result.summaryRows) || !result.summaryRows.length) throw new Error('未能读取会员规则，请重试')
        host.innerHTML = '<h2>会员体系</h2><dl class="membership-summary-list">' + result.summaryRows.map(row =>
          '<div><dt>' + escapeHtml(row.label) + '</dt><dd>' + escapeHtml(personal?String(row.value).replace('不分级 · 只要是会员就一个待遇','不分级 · 个人折扣按会员分别设置'):row.value) + '</dd></div>'
        ).join('') + '</dl><p class="subtle">' + escapeHtml(result.editHint || '') + '</p>'+(personal?'<section class="mp-member"><h3>个人折扣说明</h3><p>结算折扣：会员本人当前有效折扣。</p><p>有有效会员资格，可使用本人绑定折扣；资格取消时暂停使用，保留会员身份则继续有效。</p><p>未设置个人折扣时沿用门店默认会员价。具体折扣在客户档案查看；老板可以调整，员工仅在办理充值时调整。</p></section>':'')
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
