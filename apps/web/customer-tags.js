/* 客户标签(会员标 · RFM 分层)—— 2026-08-25 从 admin.js 搬出(公约②)。
   本批(N-5 退卡口)动的是会员这个域:退卡后还算不算会员由配置决定,
   而这枚标就是那条配置在店主眼里的样子,所以一并收进来。 */
window.CustomerTags = (function () {
  function memberTierBadge(customer, { lang, styles, escapeHtml }) {
    // D41:不分级店两态 —— member=会员 / guest=顾客(充值即会员,消费不算);分级店照旧梯子键
    const tier = customer.memberTier || 'Silver'
    if (tier === 'member') return `<span class="member-tier-badge tier-silver">${lang === 'zh' ? '会员' : 'Member'}</span>`
    if (tier === 'guest') return `<span class="member-tier-badge" style="background:#eee;color:#666">${lang === 'zh' ? '顾客' : 'Guest'}</span>`
    return `<span class="member-tier-badge ${(styles || {})[tier] || 'tier-silver'}">${escapeHtml(tier)}</span>`
  }

  // RFM 分层(与小程序客户库同口径,默认阈值;详细微调在小程序「⚙ 规则」)
  function rfmTierOf(c, lang) {
    const visits = c.completedCount || 0
    if (!visits) return null
    const days = (iso2) => iso2 ? Math.floor((Date.now() - new Date(iso2).getTime()) / 86400000) : 9999
    const lastD = days(c.lastCompletedAt)
    if (lastD > 60) return { k: 's', label: lang === 'zh' ? '沉睡S' : 'Dormant', color: '#8a5a52' }
    if (lastD <= 45 && visits >= 3 && (c.totalSpentCents || 0) >= 50000) return { k: 'a', label: lang === 'zh' ? '高价值A' : 'VIP', color: '#b5885d' }
    if (days(c.firstVisitAt) <= 30) return { k: 'n', label: lang === 'zh' ? '新客N' : 'New', color: '#3b6ea5' }
    return { k: 'b', label: lang === 'zh' ? '回头客B' : 'Repeat', color: '#3f6b52' }
  }

  return { memberTierBadge, rfmTierOf }
})()
