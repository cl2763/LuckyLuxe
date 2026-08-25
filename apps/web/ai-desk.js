/* 网页商家后台 · AI/客服域(从 admin.js 搬出,2026-08-25 甲线第一刀)

   公约①新模块 ②边改边拆 ③文件上限;S11 红旗 01。
   **只搬不改行为** —— 整段原样搬,依赖(owner / els / t / escapeHtml / render 等全局)在运行期解析,
   admin.html 里本文件排在 admin.js **之前**加载。

   按店主要求分三段:取数 / 状态 / 渲染。同一域的函数以后加在对应段里,不再往 admin.js 堆。

   ⚠️ 口径更正(2026-08-25):上一份《网页端结构体检》说 `updateWechatMock` 892 行 ——
   那是我用「到下一个 function 声明的距离」量出来的,不是函数长度。实测 **8 行**
   (写覆盖 → 存本地 → 重渲染,本来就是取数/状态/渲染各一步)。同一份报告里
   `readStoredAuth 781 行` 同样是这个量法的产物。真正最长的是 renderSalaryPlanEditor 213 行(薪资域,不在本刀范围)。 */


/* ===== 取数 ===== */

function wechatMockSessions() {
  const zhGreeting = `您好欢迎来到${storeDisplayName() || '本店'}，我是您的预约助手，您有任何问题可以随时向我咨询，可以帮您了解美甲/美睫服务、价格规则、预约时间、定金和护理说明。如果是复杂美甲款式，也可以先发参考图，我会帮您整理需求并转给技师确认报价。`
  const enGreeting = `Hi, welcome to ${storeDisplayName() || 'our studio'}. I am your booking assistant. I can help with nail and lash services, price rules, booking time, deposit policy, and after-care. For custom nail designs, you can send a reference image and I will organize the request for a technician quote.`
  return [
    {
      id: 'wechat-quote-01',
      customer: owner.lang === 'zh' ? 'Mia · 微信新客' : 'Mia · WeChat New Guest',
      source: owner.lang === 'zh' ? '小红书' : 'RED',
      intent: owner.lang === 'zh' ? '复杂美甲参考图报价' : 'Custom nail reference quote',
      serviceType: 'nail',
      status: 'waiting_quote',
      draftStatus: '',
      route: owner.lang === 'zh' ? '美甲师 Lina Zhou' : 'Nail artist Lina Zhou',
      expected: t('expectedReplyTime'),
      elements: owner.lang === 'zh'
        ? ['需要延长：是', '卸甲：不确定，需追问', '断甲修补：否', '饰品：珍珠与小钻', '复杂度：中高']
        : ['Extension: yes', 'Removal: unclear, ask follow-up', 'Repair: no', 'Decor: pearls and small rhinestones', 'Complexity: medium-high'],
      messages: [
        ['assistant', zhGreeting, enGreeting],
        ['assistant', '请问您是从哪个渠道关注到我们的？可以选择：小红书、抖音、大众点评/美团、朋友推荐、其他。', 'May I ask where you found us? Options: Google, Instagram, WeChat, TikTok, Friend referral, or Other.'],
        ['customer', '小红书。我想做这个法式加珍珠，可以帮我看价格吗？我也想预约周五下午。', 'I found you on RED. I want this French style with pearls. Could you check the price? I also want Friday afternoon.'],
        ['assistant', '可以的。我会先帮您整理参考图要素并转给技师确认报价。正常 10 分钟内给您回复，确认后我可以帮您创建预约草稿。', 'Of course. I will organize the reference details and send them to a technician for a quote. Usually we reply within 10 minutes, then I can create a booking draft for you.']
      ],
      defaultReply: {
        canDo: 'yes',
        price: '228',
        duration: '150',
        notes: owner.lang === 'zh' ? '可做，建议预留 2.5 小时。珍珠数量如果很多需现场微调，卸甲另算。' : 'Can do. Reserve about 2.5 hours. Heavy pearls may be adjusted on site. Removal is extra.'
      }
    },
    {
      id: 'wechat-lash-02',
      customer: owner.lang === 'zh' ? 'Olivia · 英文咨询' : 'Olivia · English inquiry',
      source: owner.lang === 'zh' ? 'Instagram' : 'Instagram',
      intent: owner.lang === 'zh' ? '美睫固定价预约' : 'Fixed-price lash booking',
      serviceType: 'lash',
      status: 'draft_created',
      draftStatus: 'created',
      route: owner.lang === 'zh' ? 'AI 自动处理' : 'AI handled',
      expected: owner.lang === 'zh' ? '无需人工报价' : 'No manual quote needed',
      elements: owner.lang === 'zh'
        ? ['自然款美睫', `固定价格 ${money(19800, 0)}`, '时长 120 分钟', `定金 ${money(5000, 0)}`]
        : ['Natural lash set', `Fixed price ${money(19800, 0)}`, 'Duration 120 min', `Deposit ${money(5000, 0)}`],
      messages: [
        ['assistant', zhGreeting, enGreeting],
        ['customer', 'Hi, how much is a natural lash set?', 'Hi, how much is a natural lash set?'],
        ['assistant', `自然款美睫是固定价格 ${money(19800, 0)}，时长约 120 分钟，预约定金 ${money(5000, 0)}。价格已包含基础嫁接服务，不需要人工报价。`, `A natural lash set is ${money(19800, 0)}, about 120 minutes, with a ${money(5000, 0)} booking deposit. This is a fixed lash price and does not need a manual quote.`],
        ['assistant', '我已为您生成预约草稿，请在小程序中确认时间并支付定金。', 'I created a booking draft for you. Please confirm the time and pay the deposit in the Mini Program.']
      ],
      defaultReply: {
        canDo: 'yes',
        price: '198',
        duration: '120',
        notes: owner.lang === 'zh' ? '固定价美睫项目，价格无需人工确认。' : 'Fixed-price lash service. No manual quote required.'
      }
    },
    {
      id: 'wechat-reschedule-03',
      customer: owner.lang === 'zh' ? 'Nina · 已预约客户' : 'Nina · Existing guest',
      source: owner.lang === 'zh' ? '朋友推荐' : 'Friend referral',
      intent: owner.lang === 'zh' ? '改期请求' : 'Reschedule request',
      serviceType: 'nail',
      status: 'handoff',
      draftStatus: '',
      route: owner.lang === 'zh' ? '转给对应技师' : 'Route to assigned technician',
      expected: owner.lang === 'zh' ? 'AI 停止自动回复，等待人工接管' : 'AI paused until human returns control',
      elements: owner.lang === 'zh'
        ? ['取消/改期属于人工接管范围', '需确认 24 小时规则', '需查看原预约技师排班']
        : ['Cancellation/reschedule requires human takeover', 'Check 24-hour policy', 'Confirm original technician schedule'],
      messages: [
        ['assistant', zhGreeting, enGreeting],
        ['customer', '我明天的预约想改到周末，可以吗？', 'Can I move my appointment tomorrow to the weekend?'],
        ['assistant', '改期需要帮您转给对应技师确认排班与定金规则。我会先暂停自动回复，技师接管后会继续处理。', 'Rescheduling needs the assigned technician to confirm schedule and deposit policy. I will pause automatic replies and route this to staff.']
      ],
      defaultReply: {
        canDo: 'no',
        price: '',
        duration: '',
        notes: owner.lang === 'zh' ? '改期请求，需人工接管。' : 'Reschedule request, human takeover required.'
      }
    }
  ]
}

function selectedWechatSession() {
  if (String(owner.wechatMockSessionId || '').startsWith('live:')) {
    const id = owner.wechatMockSessionId.slice(5)
    const found = owner.wechatConversations.find((conversation) => conversation.id === id)
    if (found) return found
  }
  return filteredWechatConversations()[0] || (owner.wechatConversations || [])[0] || null
}

function filteredWechatConversations() {
  const search = owner.wechatSearch.trim().toLowerCase()
  let list = [...(owner.wechatConversations || [])].sort((a, b) => wechatConversationRank(a) - wechatConversationRank(b))
  if (owner.wechatFilter === 'needsHuman') list = list.filter((item) => ['needs_human', 'human_active'].includes(item.status))
  if (owner.wechatFilter === 'aiActive') list = list.filter((item) => !['needs_human', 'human_active'].includes(item.status))
  if (search) {
    list = list.filter((item) => `${item.externalUserId || ''} ${item.lastMessage || ''}`.toLowerCase().includes(search))
  }
  return list
}

function currentWechatQuoteForm() {
  return {
    canDo: document.querySelector('#wechatQuoteCanDo')?.value || 'yes',
    price: document.querySelector('#wechatQuotePrice')?.value.trim() || '',
    duration: document.querySelector('#wechatQuoteDuration')?.value.trim() || '',
    notes: document.querySelector('#wechatQuoteNotes')?.value.trim() || ''
  }
}

function wechatConversationRank(conversation) {
  if (conversation.status === 'needs_human') return 0
  if (conversation.status === 'human_active') return 1
  return 2
}

/* ===== 状态 ===== */

function wechatMockState(session) {
  const override = owner.wechatMockOverrides[session.id] || {}
  return {
    quoteStatus: session.status,
    draftStatus: session.draftStatus,
    artistReply: session.defaultReply,
    ...override
  }
}

function wechatStatusLabel(session, state = wechatMockState(session)) {
  if (session.status === 'handoff') return t('handoffRoute')
  if (state.draftStatus === 'paid') return t('paidConfirmed')
  if (state.draftStatus === 'released') return t('draftReleased')
  if (state.draftStatus === 'reminded') return t('reminderSent')
  if (state.draftStatus === 'created') return t('draftCreated')
  if (state.quoteStatus === 'quoted') return t('quoteReturned')
  return t('waitingArtistQuote')
}

function updateWechatMock(sessionId, patch) {
  owner.wechatMockOverrides[sessionId] = {
    ...(owner.wechatMockOverrides[sessionId] || {}),
    ...patch
  }
  writeJson('lucky-wechat-mock-overrides', owner.wechatMockOverrides)
  renderWechatMock()
}

function syncWechatChatFormState() {
  const customerId = document.querySelector('#wechatChatCustomerId')?.value.trim()
  const source = document.querySelector('#wechatMockInboundSource')?.value.trim()
  const stage = document.querySelector('#wechatMockCustomerStage')?.value || 'new_quote'
  if (customerId) {
    owner.wechatChatCustomerId = customerId
    localStorage.setItem('lucky-wechat-chat-customer-id', customerId)
  }
  if (source) {
    owner.wechatChatSource = source
    localStorage.setItem('lucky-wechat-chat-source', source)
  }
  owner.wechatChatStage = stage
  localStorage.setItem('lucky-wechat-chat-stage', stage)
}

/* ===== 渲染 ===== */

function renderAiBrief() {
  const data = owner.aiBrief?.data || owner.aiBrief
  els.aiBriefPanel.innerHTML = `
    <div class="section-row compact-row">
      <div>
        <p class="eyebrow">${t('aiDailyBrief')}</p>
        <h2>${data ? escapeHtml(owner.lang === 'en' ? data.headlineEn : data.headlineZh) : t('aiDailyBrief')}</h2>
      </div>
      <button class="ghost slim" data-ai-brief type="button">${owner.aiLoading === 'brief' ? t('aiProcessing') : t('generateBrief')}</button>
    </div>
    ${data ? `
      <div class="ai-brief-grid">
        ${renderAiList(owner.lang === 'en' ? 'Actions' : '建议行动', owner.lang === 'en' ? data.actionsEn : data.actionsZh)}
        ${renderAiList(owner.lang === 'en' ? 'Opportunities' : '机会', owner.lang === 'en' ? data.opportunitiesEn : data.opportunitiesZh)}
        ${renderAiList(owner.lang === 'en' ? 'Risks' : '风险', owner.lang === 'en' ? data.risksEn : data.risksZh)}
      </div>
    ` : `<p class="subtle">${owner.lang === 'zh' ? '点击生成后，AI 会根据预约、客户和服务数据给出今日运营建议。' : 'Generate an AI brief from bookings, customers, and services.'}</p>`}
  `
}

function renderAiList(title, items = []) {
  return `
    <div class="ai-list-card">
      <strong>${title}</strong>
      ${(items || []).map((item) => `<p>${escapeHtml(item)}</p>`).join('')}
    </div>
  `
}

function wechatStageOptions(selected = owner.wechatChatStage) {
  const options = [
    ['new_quote', owner.lang === 'zh' ? '新客询价 / 未预约' : 'New quote / no booking'],
    ['quote_waiting', owner.lang === 'zh' ? '已发参考图 / 等技师报价' : 'Image sent / waiting quote'],
    ['draft_unpaid', owner.lang === 'zh' ? '已有预约草稿 / 未付定金' : 'Draft created / unpaid'],
    ['confirmed_visit', owner.lang === 'zh' ? '已预约 / 即将到店' : 'Confirmed / visiting soon'],
    ['in_store', owner.lang === 'zh' ? '已到店 / 正在服务' : 'In store / service in progress'],
    ['completed_aftercare', owner.lang === 'zh' ? '已完成 / 售后护理' : 'Completed / after-care'],
    ['refund_dispute', owner.lang === 'zh' ? '取消改期 / 退款争议' : 'Cancel/reschedule dispute']
  ]
  return options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')
}

function renderAiFeedbackEditor(message, index, transcript = [], conversation = {}) {
  if ((message.role || 'assistant') !== 'assistant') return ''
  const corrected = Boolean(message.correctedByOwner)
  const customerMessage = previousCustomerInTranscript(transcript, index)
  const original = message.originalContent || message.content || ''
  return `
    <details class="ai-feedback-editor" ${corrected ? 'open' : ''}>
      <summary>${corrected ? (owner.lang === 'zh' ? '已保存为满意样本' : 'Saved as approved sample') : (owner.lang === 'zh' ? '这条不满意，改成满意版本' : 'Improve this AI reply')}</summary>
      <div class="ai-feedback-body">
        <label>
          <span>${owner.lang === 'zh' ? '顾客原话' : 'Customer message'}</span>
          <textarea rows="2" readonly>${escapeHtml(customerMessage)}</textarea>
        </label>
        <label>
          <span>${owner.lang === 'zh' ? '你希望 AI 这样回复' : 'Owner-approved reply'}</span>
          <textarea rows="5" data-ai-feedback-reply="${index}">${escapeHtml(message.content || '')}</textarea>
        </label>
        <label>
          <span>${owner.lang === 'zh' ? '备注：为什么这样改（可选）' : 'Notes: why this is better (optional)'}</span>
          <textarea rows="2" data-ai-feedback-notes="${index}" placeholder="${owner.lang === 'zh' ? '例如：语气更像真人；复杂款必须先转技师报价；不要承诺最终价格。' : 'Example: warmer tone; custom nails need technician quote; do not promise final price.'}">${escapeHtml(message.feedbackNotes || '')}</textarea>
        </label>
        <div class="action-row wrap">
          <button class="primary slim" data-ai-feedback-save="${index}" data-conversation-id="${escapeHtml(conversation.id || '')}" data-customer-message="${escapeHtml(customerMessage)}" data-original-reply="${escapeHtml(original)}" type="button">${owner.lang === 'zh' ? '保存并让 AI 学习' : 'Save as training sample'}</button>
        </div>
      </div>
    </details>
  `
}

function renderWechatTranscript(transcript = [], conversation = {}) {
  if (!transcript.length) {
    return `<div class="empty-state small-empty">${owner.lang === 'zh' ? '还没有对话。请先在左侧以顾客身份发送一条消息。' : 'No chat yet. Send a message as the customer on the left.'}</div>`
  }
  return transcript.map((message, index) => {
    const role = message.role || 'assistant'
    const label = role === 'customer'
      ? (conversation.externalUserId || owner.wechatChatCustomerId || 'Customer')
      : role === 'staff'
        ? (message.staffName || (owner.lang === 'zh' ? '后台人工' : 'Admin Staff'))
        : `${storeDisplayName() ? storeDisplayName() + ' ' : ''}预约助手`
    return `
      <div class="wechat-bubble ${role === 'customer' ? 'customer' : role === 'staff' ? 'staff' : 'assistant'}">
        <span>${escapeHtml(label)}${message.correctedByOwner ? ` · ${owner.lang === 'zh' ? '店主已修正' : 'Owner corrected'}` : ''}</span>
        <p>${linkifyEscapedText(message.content || '')}</p>
        ${renderMessageImages(message)}
        ${renderAiFeedbackEditor(message, index, transcript, conversation)}
      </div>
    `
  }).join('')
}

function renderWechatCustomerChatPanel() {
  const conversation = currentCustomerChatConversation()
  const status = conversation?.status || 'new'
  return `
    ${renderWechatConnectionStatus()}
    <div class="wechat-customer-simulator">
      <div class="section-row compact-row">
        <div>
          <strong>${t('customerChatSimulator')}</strong>
          <p>${t('customerChatHint')}</p>
        </div>
        <span class="mock-state-pill">${escapeHtml(status)}</span>
      </div>
      <label>
        <span>${t('customerId')}</span>
        <input id="wechatChatCustomerId" value="${escapeHtml(owner.wechatChatCustomerId)}">
      </label>
      <div class="form-grid tight">
        <label>
          <span>${owner.lang === 'zh' ? '顾客阶段' : 'Customer stage'}</span>
          <select id="wechatMockCustomerStage">${wechatStageOptions()}</select>
        </label>
        <label>
          <span>${t('mockSource')}</span>
          <input id="wechatMockInboundSource" value="${escapeHtml(owner.wechatChatSource)}">
        </label>
      </div>
      <label>
        <span>${owner.lang === 'zh' ? '参考图上传（测试）' : 'Reference images (test)'}</span>
        <input id="wechatMockReferenceImages" type="file" accept="image/*" multiple>
      </label>
      ${owner.wechatMockReferenceImages.length ? `
        <div class="mock-image-preview-grid">
          ${owner.wechatMockReferenceImages.map((image, index) => `
            <figure>
              <img src="${escapeHtml(image.url)}" alt="reference ${index + 1}">
              <figcaption>${escapeHtml(image.name || `Image ${index + 1}`)}</figcaption>
            </figure>
          `).join('')}
          <button class="ghost slim" data-clear-mock-images type="button">${owner.lang === 'zh' ? '清空图片' : 'Clear images'}</button>
        </div>
      ` : ''}
      <div class="wechat-phone-preview">
        <div class="wechat-phone-head">
          <strong>${escapeHtml(storeDisplayName() || '—')}</strong>
          <span>${status === 'needs_human' || status === 'human_active' ? t('waitingHuman') : t('aiAutoReplied')}</span>
        </div>
        <div class="wechat-phone-timeline">
          ${renderWechatTranscript(conversation?.transcript || [], conversation || {})}
        </div>
      </div>
      <label>
        <span>${t('mockCustomerMessage')}</span>
        <textarea id="wechatChatMessage" rows="3" placeholder="${owner.lang === 'zh' ? '例如：我想做带珍珠的法式，可以帮我看价格吗？' : 'Example: Can you help quote a French set with pearls?'}"></textarea>
      </label>
      <div class="action-row wrap">
        <a class="ghost slim" href="/wechat-simulator" target="_blank" rel="noreferrer">${owner.lang === 'zh' ? '打开独立模拟器' : 'Open simulator'}</a>
        <button class="primary slim" data-wechat-chat-send type="button">${t('sendAsCustomer')}</button>
        <button class="ghost slim" data-wechat-chat-force-ai type="button">${t('forceAiReply')}</button>
        <button class="ghost slim" data-wechat-chat-new-customer type="button">${t('newMockCustomer')}</button>
      </div>
    </div>
  `
}

function renderWechatFilterBar() {
  if (!els.wechatFilterBar) return
  const all = owner.wechatConversations || []
  const needsHumanCount = all.filter((item) => ['needs_human', 'human_active'].includes(item.status)).length
  const filters = [
    ['all', t('filterAll'), all.length],
    ['needsHuman', t('filterNeedsHuman'), needsHumanCount],
    ['aiActive', t('filterAiActive'), all.length - needsHumanCount]
  ]
  els.wechatFilterBar.innerHTML = filters.map(([key, label, count]) => `
    <button class="cs-filter-pill ${owner.wechatFilter === key ? 'active' : ''}" data-wechat-filter="${key}" type="button">
      ${escapeHtml(label)}${key === 'needsHuman' && count ? ` <b>${count}</b>` : ` (${count})`}
    </button>`).join('')
}

function renderWechatMock() {
  if (!els.wechatSessionList || !els.wechatMockDetail) return
  const liveConversations = filteredWechatConversations()
  const needsHumanConversations = liveConversations.filter((conversation) => ['needs_human', 'human_active'].includes(conversation.status))
  const normalConversations = liveConversations.filter((conversation) => !['needs_human', 'human_active'].includes(conversation.status))
  const needsHumanCount = (owner.wechatConversations || []).filter((conversation) => conversation.status === 'needs_human').length
  if (els.wechatNeedsHumanBadge) {
    els.wechatNeedsHumanBadge.textContent = String(needsHumanCount)
    els.wechatNeedsHumanBadge.classList.toggle('hidden', !needsHumanCount)
  }
  renderWechatFilterBar()
  const selected = selectedWechatSession()
  els.wechatSessionList.innerHTML = `
    <input class="cs-search" id="wechatSearchInput" placeholder="${t('searchCustomers')}" value="${escapeHtml(owner.wechatSearch)}">
    ${needsHumanConversations.length ? `
      <div class="wechat-session-group-title needs-human-title">${t('needsHumanQueue')} (${needsHumanConversations.length})</div>
      ${needsHumanConversations.map(renderLiveConversationRow).join('')}
    ` : ''}
    ${(() => {
      // 员工端:与我相关的会话置顶(我的报价任务所属会话),其余照常可见
      if (isOwnerRole()) return ''
      const myTechId = (owner.technicians || [])[0]?.id
      const mineIds = new Set((owner.quoteRequests || []).filter((item) => item.technicianId === myTechId).map((item) => item.conversationId).filter(Boolean))
      const mine = normalConversations.filter((conversation) => mineIds.has(conversation.id))
      if (!mine.length) return ''
      mine.forEach((conversation) => normalConversations.splice(normalConversations.indexOf(conversation), 1))
      return `
        <div class="wechat-session-group-title mine-title">${owner.lang === 'zh' ? '与我相关' : 'Mine'} (${mine.length})</div>
        ${mine.map(renderLiveConversationRow).join('')}`
    })()}
    <div class="wechat-session-group-title">${t('liveConversations')}</div>
    ${normalConversations.length ? normalConversations.map(renderLiveConversationRow).join('') : `<div class="empty-state small-empty">${t('noLiveConversations')}</div>`}
  `
  if (selected) {
    renderWechatLiveDetail(selected)
    renderWechatContextPanel(selected)
  } else {
    els.wechatMockDetail.innerHTML = `<div class="empty-state">${t('noLiveConversations')}</div>`
    if (els.wechatContextPanel) els.wechatContextPanel.innerHTML = ''
    if (els.wechatWorkflowPanel) els.wechatWorkflowPanel.innerHTML = ''
  }
}

function renderWechatContextPanel(conversation) {
  if (!els.wechatContextPanel) return
  const state = conversation.conversationState || {}
  const stateData = state.state || {}
  const memory = stateData.workingMemory || {}
  const memoryCustomer = memory.customer || {}
  const quoteTasks = (owner.quoteRequests || []).filter((item) => item.conversationId === conversation.id && !['COMPLETED', 'CANCELLED', 'SENT'].includes(String(item.status || '').toUpperCase()))
  const conversationReminders = (owner.reminderTasks || []).filter((item) => item.conversationId === conversation.id && String(item.status || '') === 'PENDING')
  const memberTier = memoryCustomer.memberTier || stateData.memberTier || '-'
  const customerType = memoryCustomer.customerType || stateData.customerType || '-'
  els.wechatContextPanel.innerHTML = `
    <div class="cs-context-card">
      <div class="cs-context-card-head"><span>${t('customerProfileCard')}</span></div>
      <strong class="cs-context-name">${escapeHtml(conversationDisplayName(conversation))}</strong>
      <p class="subtle">${escapeHtml(conversation.sourceChannel || conversation.provider || '-')} · ${escapeHtml(String(memberTier))} · ${escapeHtml(String(customerType))}</p>
      ${conversation.linkedUserId && isOwnerRole() ? `<button class="ghost slim" data-open-customer-file="${escapeHtml(conversation.linkedUserId)}" type="button">${owner.lang === 'zh' ? '查看客户档案 →' : 'Customer file →'}</button>` : ''}
      ${!conversation.linkedUserId && isOwnerRole() && (owner.customers || []).length ? `
      <details class="cs-inline-details">
        <summary>${owner.lang === 'zh' ? '绑定会员' : 'Link member'}</summary>
        <div class="cs-link-member-row">
          <select data-link-member-select>
            ${owner.customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customerName(customer))} · ${escapeHtml(customer.memberCode || '')}</option>`).join('')}
          </select>
          <button class="ghost slim" data-link-member="${escapeHtml(conversation.id)}" type="button">${owner.lang === 'zh' ? '绑定' : 'Link'}</button>
        </div>
      </details>` : ''}
    </div>
    <div class="cs-context-card">
      <div class="cs-context-card-head"><span>${t('aiMemoryCard')}</span></div>
      <p class="subtle">${t('intentLabel')}: ${escapeHtml(state.intent || conversation.lastIntent || '-')}<br>
      ${t('stageLabel')}: ${escapeHtml(state.quoteStage || '-')} / ${escapeHtml(state.nextAction || '-')}<br>
      ${t('refImagesLabel')}: ${(stateData.referenceImages || []).length}</p>
      <details class="cs-inline-details">
        <summary>${t('knowledgePanelGroup')}</summary>
        ${renderKnowledgeMatchPanel(conversation.aiReply)}
      </details>
    </div>
    <div class="cs-context-card">
      <div class="cs-context-card-head"><span>${t('quoteTasksCard')}</span>${quoteTasks.length ? `<span class="cs-count-badge">${quoteTasks.length}</span>` : ''}</div>
      ${quoteTasks.length ? quoteTasks.map((item) => `
        <div class="cs-task-item cs-quote-task">
          <strong>${escapeHtml(item.serviceType || '-')}</strong> · ${escapeHtml(quoteStatusText(item.status))}
          <small>${escapeHtml((item.customerMessage || '').slice(0, 60))}</small>
          ${(item.referenceImages || []).length ? `
            <div class="cs-quote-thumbs">
              ${(item.referenceImages || []).slice(0, 4).map((src, index) => `<img src="${escapeHtml(src)}" alt="ref ${index + 1}">`).join('')}
            </div>` : ''}
          ${String(item.status || '').toUpperCase() === 'PENDING_STAFF' ? `
            <textarea rows="3" data-quote-id="${escapeHtml(item.id)}" data-backend-quote-field="message" placeholder="${owner.lang === 'zh' ? '技师回价/判断，例如：可以做，本甲120，延长200，大概3小时以内' : 'Technician reply, e.g.: can do, natural 120, extension 200, within 3 hours'}">${escapeHtml(item.staffNotes || '')}</textarea>
            <div class="action-row wrap cs-quote-actions">
              <button class="primary slim" data-backend-quote-send="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '润色并发送' : 'Polish and send'}</button>
              <button class="ghost slim" data-backend-quote-draft="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '建草稿链接' : 'Draft link'}</button>
            </div>` : ''}
        </div>`).join('') : `<p class="subtle">${t('noTasks')}</p>`}
    </div>
    <div class="cs-context-card cs-context-card-last">
      <div class="cs-context-card-head"><span>${t('backendTasksCard')}</span>${conversationReminders.length ? `<span class="cs-count-badge">${conversationReminders.length}</span>` : ''}</div>
      ${conversationReminders.length ? conversationReminders.map((item) => `
        <div class="cs-task-item">
          <strong>${escapeHtml(reminderTypeText(item.type))}</strong>
          <small>${escapeHtml(String(item.scheduledAt || '').slice(0, 16).replace('T', ' '))}</small>
        </div>`).join('') : `<p class="subtle">${t('noTasks')}</p>`}
    </div>
  `
  if (els.wechatWorkflowPanel) {
    els.wechatWorkflowPanel.innerHTML = renderManualBookingDraftPanel(conversation.id)
  }
}

function renderWechatConnectionStatus() {
  const status = owner.wechatStatus
  if (!status) return `<div class="wechat-status-card"><strong>${t('wechatConnectionStatus')}</strong><span>${t('wechatConfigPending')}</span></div>`
  return `
    <div class="wechat-status-card">
      <div class="section-row compact-row">
        <strong>${t('wechatConnectionStatus')}</strong>
        <span class="mock-state-pill">${status.mode === 'ready' ? t('wechatConfigReady') : t('wechatConfigPending')}</span>
      </div>
      <label>
        <span>${t('wechatWebhookUrl')}</span>
        <input readonly value="${escapeHtml(status.webhookUrl || '')}">
      </label>
      <div class="wechat-check-grid">
        ${(status.checks || []).map((item) => `<span class="${item.ok ? 'ok' : 'missing'}">${escapeHtml(item.label)} · ${item.ok ? t('configured') : t('missingCredentials')}</span>`).join('')}
      </div>
    </div>
  `
}

function renderWechatBackendWorkflow(conversationId = '') {
  const quotes = (owner.quoteRequests || [])
    .filter((item) => !conversationId || item.conversationId === conversationId)
    .filter((item) => ['PENDING_STAFF'].includes(String(item.status || '').toUpperCase()))
  const reminders = (owner.reminderTasks || []).filter((item) => !conversationId || item.conversationId === conversationId)
  const hasData = quotes.length || reminders.length
  return `
    <section class="quote-workbench live-workflow-panel">
      <div class="section-row compact-row">
        <div>
          <h3>${owner.lang === 'zh' ? '后端任务池' : 'Backend Workflow Queue'}</h3>
          <p class="subtle">${owner.lang === 'zh' ? '真实接口生成的报价、草稿和提醒任务。' : 'Quote, draft, and reminder tasks generated by real API endpoints.'}</p>
        </div>
        <span class="pill muted">${quotes.length} / ${reminders.length}</span>
      </div>
      <div class="workflow-list manual-draft-list">
        ${renderManualBookingDraftPanel(conversationId)}
      </div>
      ${hasData ? `
        <div class="workflow-list">
          ${quotes.slice(0, 6).map((item) => `
            <article class="workflow-card quote-card">
              <div class="workflow-summary">
                <span class="pill muted">${escapeHtml(quoteStatusText(item.status))}</span>
                <strong>${escapeHtml(item.customerName || item.customerExternalId || 'Guest')}</strong>
                <small>${escapeHtml(quoteRequestMeta(item))}</small>
                <p>${escapeHtml(quoteRequestBrief(item).slice(0, 140))}</p>
              </div>
              ${renderQuoteReferenceImages(item)}
              <div class="quote-response-grid">
                <label class="quote-notes-field">
                  <span>${owner.lang === 'zh' ? '技师留言给 AI' : 'Technician message for AI'}</span>
                  <textarea rows="4" data-quote-id="${escapeHtml(item.id)}" data-backend-quote-field="message" placeholder="${owner.lang === 'zh' ? '例如：可做，基础 $238，约 150 分钟。珍珠数量到店确认，建议提前预留延长时间。' : 'Example: Can do, base $238, about 150 min. Pearls confirmed in store; recommend reserving extension time.'}">${escapeHtml(item.staffNotes || '')}</textarea>
                </label>
              </div>
              <div class="workflow-actions">
                <button class="primary slim" data-backend-quote-send="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '交给 AI 润色并发送' : 'Polish and send'}</button>
                <button class="ghost slim" data-backend-quote-draft="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '建 30 分钟草稿链接' : 'Create draft link'}</button>
              </div>
            </article>
          `).join('')}
          ${reminders.slice(0, 8).map((item) => `
            <article class="workflow-card reminder">
              <div>
                <span class="pill muted">${escapeHtml(item.status || '-')}</span>
                <strong>${escapeHtml(reminderTypeText(item.type))}</strong>
                <small>${compactDateTime(item.scheduledAt)} · ${escapeHtml(item.channel || '-')}</small>
              </div>
              <div class="workflow-actions">
                <button class="ghost slim" data-backend-reminder-sent="${escapeHtml(item.id)}" type="button">${owner.lang === 'zh' ? '标记已发' : 'Mark sent'}</button>
              </div>
            </article>
          `).join('')}
        </div>
      ` : `<div class="empty-state small-empty">${owner.lang === 'zh' ? '暂无真实任务。可以先在左侧发送一条 mock 进线消息生成报价任务。' : 'No real tasks yet. Send a mock inbound message on the left to generate a quote task.'}</div>`}
    </section>
  `
}

function renderWechatLiveDetail(conversation) {
  const transcript = conversation.transcript || []
  const needsHuman = ['needs_human', 'human_active'].includes(conversation.status)
  els.wechatMockDetail.innerHTML = `
    <div class="cs-chat-head">
      <div class="cs-chat-head-main">
        <strong>${escapeHtml(conversationDisplayName(conversation))}</strong>
        <span class="pill muted">${escapeHtml(conversation.sourceChannel || conversation.provider || '-')}</span>
        <span class="pill ${needsHuman ? 'cs-pill-danger' : 'muted'}">${needsHuman ? t('waitingHuman') : t('aiAutoReplied')}</span>
      </div>
      <div class="action-row">
        ${needsHuman
          ? `<button class="ghost slim" data-wechat-release-ai="${escapeHtml(conversation.id)}" type="button">${t('releaseChatToAi')}</button>`
          : `<button class="ghost slim" data-wechat-take-over="${escapeHtml(conversation.id)}" type="button">${t('takeOverChat')}</button>`}
      </div>
    </div>
    <div class="wechat-timeline cs-chat-timeline">
      ${renderWechatTranscript(transcript, conversation)}
    </div>
    <div class="cs-reply-box ${needsHuman ? 'needs-human' : ''}">
      <textarea id="wechatManualReplyText" rows="2" placeholder="${owner.lang === 'zh' ? '输入人工回复…' : 'Type a manual reply…'}"></textarea>
      <div class="action-row cs-reply-actions">
        <button class="ghost slim" data-wechat-manual-reply="${escapeHtml(conversation.id)}" data-release-to-ai="false" type="button">${t('sendKeepHuman')}</button>
        <button class="primary slim" data-wechat-manual-reply="${escapeHtml(conversation.id)}" data-release-to-ai="true" type="button">${t('sendReleaseAi')}</button>
      </div>
    </div>
  `
  requestAnimationFrame(() => {
    const timeline = els.wechatMockDetail.querySelector('.cs-chat-timeline')
    if (timeline) timeline.scrollTop = timeline.scrollHeight
  })
}

function renderWechatMockDetail(session) {
  const state = wechatMockState(session)
  const reply = state.artistReply || session.defaultReply
  const canDo = reply.canDo !== 'no'
  const aiReply = canDo
    ? (owner.lang === 'zh'
      ? `技师确认这款可以做，预估价格 ${reply.price ? money(Math.round(Number(reply.price) * 100), 0) : '待确认'}，预计 ${reply.duration || '待确认'} 分钟。${reply.notes || ''} 如果您想继续，我可以先为您创建预约草稿，最后需要您在小程序里确认时间并支付 ${money(5000, 0)} 定金。`
      : `The technician confirmed this style can be done. Estimated price is ${reply.price ? money(Math.round(Number(reply.price) * 100), 0) : 'TBD'} and estimated duration is ${reply.duration || 'TBD'} minutes. ${reply.notes || ''} If you would like to continue, I can create a booking draft for you. Final confirmation and ${money(5000, 0)} deposit payment happen in the Mini Program.`)
    : (owner.lang === 'zh'
      ? `技师看过后认为这次需要人工进一步确认：${reply.notes || '目前信息不足。'} 我会先为您转人工处理。`
      : `The technician needs human follow-up for this request: ${reply.notes || 'More information is needed.'} I will route this to a staff member.`)
  els.wechatMockDetail.innerHTML = `
    <div class="wechat-detail-head">
      <div>
        <p class="eyebrow">${t('aiReception')}</p>
        <h2>${escapeHtml(session.customer)}</h2>
        <p class="subtle">${escapeHtml(session.intent)} · ${escapeHtml(session.source)}</p>
      </div>
      <span class="mock-state-pill">${escapeHtml(wechatStatusLabel(session, state))}</span>
    </div>
    <div class="wechat-info-grid">
      <div>
        <strong>${t('quoteElements')}</strong>
        ${session.elements.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
      <div>
        <strong>${t('handoffRoute')}</strong>
        <span>${escapeHtml(session.route)}</span>
        <span>${escapeHtml(session.expected)}</span>
      </div>
    </div>
    <section class="wechat-timeline-section">
      <h3>${t('customerTimeline')}</h3>
      <div class="wechat-timeline">
        ${session.messages.map(([speaker, zh, en]) => `
          <div class="wechat-bubble ${speaker}">
            <span>${speaker === 'assistant' ? escapeHtml(`${storeDisplayName() ? storeDisplayName() + ' ' : ''}预约助手`) : escapeHtml(session.customer)}</span>
            <p>${escapeHtml(owner.lang === 'zh' ? zh : en)}</p>
          </div>
        `).join('')}
        ${state.quoteStatus === 'quoted' ? `
          <div class="wechat-bubble assistant">
            <span>${t('aiPolishReply')}</span>
            <p>${escapeHtml(aiReply)}</p>
          </div>
        ` : ''}
        ${state.draftStatus ? `
          <div class="wechat-bubble assistant">
            <span>${t('miniProgramLink')}</span>
            <p>${escapeHtml(owner.lang === 'zh' ? `预约草稿：${draftMockLink(session)}。状态：${wechatStatusLabel(session, state)}。` : `Booking draft: ${draftMockLink(session)}. Status: ${wechatStatusLabel(session, state)}.`)}</p>
          </div>
        ` : ''}
      </div>
    </section>
    <section class="quote-workbench">
      <div class="section-row compact-row">
        <h3>${t('staffQuoteWorkbench')}</h3>
        <span class="pill muted">${t('mockOnly')}</span>
      </div>
      <div class="form-grid tight">
        <label>
          <span>${t('artistReply')}</span>
          <select id="wechatQuoteCanDo">
            <option value="yes" ${reply.canDo !== 'no' ? 'selected' : ''}>${t('canDo')}</option>
            <option value="no" ${reply.canDo === 'no' ? 'selected' : ''}>${t('cannotDo')}</option>
          </select>
        </label>
        <label>
          <span>${t('quotePriceCad')}</span>
          <input id="wechatQuotePrice" inputmode="decimal" value="${escapeHtml(reply.price || '')}">
        </label>
        <label>
          <span>${t('quoteDurationMin')}</span>
          <input id="wechatQuoteDuration" inputmode="numeric" value="${escapeHtml(reply.duration || '')}">
        </label>
      </div>
      <label>
        <span>${t('quoteNotes')}</span>
        <textarea id="wechatQuoteNotes" rows="3">${escapeHtml(reply.notes || '')}</textarea>
      </label>
      <div class="action-row wrap">
        <button class="primary slim" data-mock-quote-return="${session.id}" type="button">${t('aiPolishReply')}</button>
        <button class="ghost slim" data-mock-draft-create="${session.id}" type="button">${t('createDraft')}</button>
        <button class="ghost slim" data-mock-reminder="${session.id}" type="button">${t('sendPaymentReminder')}</button>
        <button class="ghost slim" data-mock-release="${session.id}" type="button">${t('releaseDraft')}</button>
      </div>
      <p class="subtle">${t('miniProgramLink')}: ${escapeHtml(draftMockLink(session))}</p>
    </section>
    ${renderWechatBackendWorkflow()}
  `
}
