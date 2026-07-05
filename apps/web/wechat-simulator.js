const state = {
  auth: readJson('lucky-owner-auth'),
  token: new URLSearchParams(location.search).get('token') || localStorage.getItem('lucky-simulator-token') || 'owner-demo-token',
  conversations: [],
  images: [],
  selectedConversationId: localStorage.getItem('lucky-simulator-conversation-id') || '',
  customerId: localStorage.getItem('lucky-simulator-customer-id') || 'sim-customer-001',
  sourceChannel: localStorage.getItem('lucky-simulator-source') || '小红书',
  customerStage: 'unified_test',
  customerType: localStorage.getItem('lucky-simulator-customer-type') || 'new',
  memberTier: localStorage.getItem('lucky-simulator-member-tier') || 'silver',
  pendingByConversation: {},
  delayedBuffers: {},
  delayedTimers: {},
  sendingConversationId: ''
}

const els = {
  customerId: document.querySelector('#simCustomerId'),
  sourceChannel: document.querySelector('#simSourceChannel'),
  customerStage: document.querySelector('#simCustomerStage'),
  customerType: document.querySelector('#simCustomerType'),
  memberTier: document.querySelector('#simMemberTier'),
  referenceImages: document.querySelector('#simReferenceImages'),
  imagePreview: document.querySelector('#simImagePreview'),
  message: document.querySelector('#simMessage'),
  send: document.querySelector('#sendSimMessage'),
  forceAi: document.querySelector('#forceSimAi'),
  autoAiReply: document.querySelector('#simAutoAiReply'),
  newCustomer: document.querySelector('#newSimCustomer'),
  refresh: document.querySelector('#refreshSimulator'),
  transcript: document.querySelector('#simTranscript'),
  conversationStrip: document.querySelector('#simConversationStrip'),
  statePanel: document.querySelector('#simStatePanel'),
  title: document.querySelector('#simConversationTitle'),
  meta: document.querySelector('#simConversationMeta'),
  status: document.querySelector('#simulatorStatus'),
  toast: document.querySelector('#simToast'),
  logicNote: document.querySelector('#simLogicNote'),
  saveLogicNote: document.querySelector('#saveSimLogicNote')
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function bearer() {
  return state.auth?.accessToken || state.token
}

function toast(message) {
  els.toast.textContent = message
  els.toast.classList.add('show')
  setTimeout(() => els.toast.classList.remove('show'), 2400)
}

async function request(path, options = {}) {
  const doFetch = (token) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    return fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    }).finally(() => clearTimeout(timer))
  }
  let response
  try {
    response = await doFetch(bearer())
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? '请求超时（30秒）：服务器没有响应，请查看服务器终端窗口' : (error.message || '网络错误：连不上服务器'))
  }
  if (response.status === 401 && state.auth) {
    // admin 登录凭证过期时自动降级到演示 token 重试，避免模拟器直接瘫痪
    state.auth = null
    response = await doFetch(state.token)
  }
  let data = null
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok) throw new Error(data.error?.message || `请求失败（HTTP ${response.status}）`)
  return data
}

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.name === 'AbortError') {
    toast('请求超时（30秒）：服务器没有响应，请查看服务器终端窗口的报错')
  }
})

function syncFormState() {
  state.customerId = els.customerId.value.trim() || 'sim-customer-001'
  state.sourceChannel = els.sourceChannel.value || '小红书'
  state.customerStage = 'unified_test'
  state.customerType = els.customerType?.value || 'new'
  state.memberTier = els.memberTier?.value || 'silver'
  localStorage.setItem('lucky-simulator-customer-id', state.customerId)
  localStorage.setItem('lucky-simulator-source', state.sourceChannel)
  localStorage.removeItem('lucky-simulator-stage')
  localStorage.setItem('lucky-simulator-customer-type', state.customerType)
  localStorage.setItem('lucky-simulator-member-tier', state.memberTier)
}

function currentConversation() {
  const expected = `wecom:${state.customerId}`
  return state.conversations.find((item) => item.id === state.selectedConversationId)
    || state.conversations.find((item) => item.id === expected)
    || null
}

function currentConversationId() {
  return `wecom:${state.customerId}`
}

function conversationHasTranscript(conversationId) {
  const conversation = state.conversations.find((item) => item.id === conversationId)
  return Boolean(conversation?.transcript?.length)
}

function sentMarkerKey(conversationId) {
  return `lucky-simulator-sent-${conversationId}`
}

function hasSentInConversation(conversationId) {
  return conversationHasTranscript(conversationId) || localStorage.getItem(sentMarkerKey(conversationId)) === '1'
}

function markSentInConversation(conversationId) {
  localStorage.setItem(sentMarkerKey(conversationId), '1')
}

function setComposerSending(isSending = false, conversationId = currentConversationId()) {
  state.sendingConversationId = isSending ? conversationId : ''
  els.send.disabled = Boolean(isSending)
  els.send.textContent = isSending ? '发送中' : '发送'
}

function syncComposerState() {
  if (!state.sendingConversationId) {
    setComposerSending(false)
    return
  }
  const sendingId = state.sendingConversationId
  if (!state.pendingByConversation[sendingId] && !state.delayedBuffers[sendingId]) {
    setComposerSending(false, sendingId)
    return
  }
  els.send.disabled = true
  els.send.textContent = '发送中'
}

function clearConversationDraftState(conversationId) {
  clearTimeout(state.delayedTimers[conversationId])
  delete state.delayedTimers[conversationId]
  delete state.delayedBuffers[conversationId]
  delete state.pendingByConversation[conversationId]
  if (state.sendingConversationId === conversationId) setComposerSending(false, conversationId)
}

function previousCustomerInTranscript(transcript = [], index = 0) {
  for (let i = Number(index) - 1; i >= 0; i -= 1) {
    if (transcript[i]?.role === 'customer') return transcript[i]?.content || ''
  }
  return ''
}

function imageUrl(image = {}) {
  if (typeof image === 'string') return image
  return image.url || image.dataUrl || image.src || ''
}

function renderMessageImages(message = {}) {
  const images = [
    ...(Array.isArray(message.referenceImages) ? message.referenceImages : []),
    ...(Array.isArray(message.images) ? message.images : [])
  ].filter(Boolean)
  if (!images.length) return ''
  return `
    <div class="wechat-message-images">
      ${images.map((image, index) => {
        const src = imageUrl(image)
        if (!src) return ''
        return `
          <figure>
            <img src="${escapeHtml(src)}" alt="${escapeHtml(image.name || `reference ${index + 1}`)}">
            <figcaption>${escapeHtml(image.name || `参考图 ${index + 1}`)}</figcaption>
          </figure>
        `
      }).join('')}
    </div>
  `
}

function userIsEditing() {
  const active = document.activeElement
  if (active && active.closest?.('.ai-feedback-editor, .simulator-control-card')) return true
  return Boolean(document.querySelector('.simulator-feedback[open]'))
}

function renderFeedbackEditor(message, index, transcript = [], conversation = {}) {
  conversation = conversation || {}
  if ((message.role || 'assistant') !== 'assistant') return ''
  const corrected = Boolean(message.correctedByOwner)
  const customerMessage = previousCustomerInTranscript(transcript, index)
  const original = message.originalContent || message.content || ''
  return `
    <details class="ai-feedback-editor simulator-feedback" ${corrected ? 'open' : ''}>
      <summary>${corrected ? '已保存为满意样本' : 'AI 这条不满意，改成满意版本'}</summary>
      <div class="ai-feedback-body">
        <label>
          <span>顾客原话</span>
          <textarea rows="2" readonly>${escapeHtml(customerMessage)}</textarea>
        </label>
        <label>
          <span>你希望 AI 这样回复</span>
          <textarea rows="5" data-sim-feedback-reply="${index}">${escapeHtml(message.content || '')}</textarea>
        </label>
        <label>
          <span>备注（可选）</span>
          <textarea rows="2" data-sim-feedback-notes="${index}" placeholder="例如：更温柔；不要直接报价；先确认是否需要延长。">${escapeHtml(message.feedbackNotes || '')}</textarea>
        </label>
        <button class="primary slim" data-sim-feedback-save="${index}" data-conversation-id="${escapeHtml(conversation.id || '')}" data-customer-message="${escapeHtml(customerMessage)}" data-original-reply="${escapeHtml(original)}" type="button">保存并让 AI 学习</button>
      </div>
    </details>
  `
}

function roleLabel(message = {}, conversation = {}) {
  conversation = conversation || {}
  const role = message.role || 'assistant'
  if (role === 'customer') return conversation.externalUserId || state.customerId || 'Customer'
  if (role === 'staff') return message.staffName || '后台人工'
  return 'Lucky Luxe 预约助手'
}

function renderTranscript() {
  const conversation = currentConversation()
  const pendingKey = conversation?.id || `wecom:${state.customerId}`
  const transcript = [
    ...(conversation?.transcript || []),
    ...(state.pendingByConversation[pendingKey] || [])
  ]
  els.title.textContent = conversation?.externalUserId || state.customerId
  els.status.textContent = conversation?.status || 'new'
  els.meta.textContent = conversation
    ? `${conversation.sourceChannel || conversation.provider || 'mock'} · ${conversation.lastIntent || 'unknown'}`
    : '等待发送第一条消息'
  if (!transcript.length) {
    els.transcript.innerHTML = `
      <div class="simulator-empty">
        <strong>还没有对话</strong>
        <p>在底部输入顾客消息，上传参考图后发送给 AI。图片会保留在顾客气泡中。</p>
      </div>
    `
    return
  }
  els.transcript.innerHTML = transcript.map((message, index) => {
    const role = message.role || 'assistant'
    const contentHtml = escapeHtml(message.content || '')
      .replace(/(https?:\/\/[^\s<，。；、！？")）】]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')
    return `
      <div class="wechat-bubble simulator-bubble ${role === 'customer' ? 'customer' : role === 'staff' ? 'staff' : 'assistant'} ${message.pending ? 'pending' : ''}">
        <span>${escapeHtml(roleLabel(message, conversation))}${message.correctedByOwner ? ' · 店主已修正' : ''}</span>
        <p>${contentHtml}</p>
        ${renderMessageImages(message)}
        ${renderFeedbackEditor(message, index, transcript, conversation)}
      </div>
    `
  }).join('')
  els.transcript.scrollTop = els.transcript.scrollHeight
}

function renderImagePreview() {
  if (!state.images.length) {
    els.imagePreview.innerHTML = ''
    return
  }
  els.imagePreview.innerHTML = `
    <div class="mock-image-preview-grid simulator-upload-grid">
      ${state.images.map((image, index) => `
        <figure>
          <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name || `reference ${index + 1}`)}">
          <figcaption>${escapeHtml(image.name || `Image ${index + 1}`)}</figcaption>
        </figure>
      `).join('')}
      <button class="ghost slim" data-sim-clear-images type="button">清空图片</button>
    </div>
  `
}

function renderConversationStrip() {
  const conversations = state.conversations.slice(0, 10)
  if (!conversations.length) {
    els.conversationStrip.innerHTML = ''
    return
  }
  els.conversationStrip.innerHTML = conversations.map((conversation) => `
    <button class="sim-conversation-chip ${conversation.id === state.selectedConversationId ? 'active' : ''}" data-sim-conversation="${escapeHtml(conversation.id)}" type="button">
      <strong>${escapeHtml(conversation.externalUserId || conversation.id)}</strong>
      <span>${escapeHtml(conversation.status || 'open')}</span>
    </button>
  `).join('')
}

function stateFlagText(value) {
  const map = {
    yes: '是',
    no: '否',
    partial: '部分',
    unknown: '未知',
    '': '未知'
  }
  return map[String(value || 'unknown')] || value
}

function renderStatePanel() {
  const conversation = currentConversation()
  const conversationState = conversation?.conversationState
  if (!conversationState) {
    els.statePanel.innerHTML = `
      <div class="sim-state-empty">
        <strong>AI 当前理解</strong>
        <span>还没有状态。发送第一条消息后，这里会显示系统记住的服务类型、参考图、报价阶段和下一步动作。</span>
      </div>
    `
    return
  }
  const stateData = conversationState.state || {}
  const memory = stateData.workingMemory || {}
  const quote = memory.quote || {}
  const displayState = {
    ...stateData,
    ...quote,
    customerType: stateData.customerType || memory.customerType || state.customerType,
    memberTier: stateData.memberTier || memory.memberTier || state.memberTier
  }
  const images = conversationState.referenceImages || stateData.referenceImages || memory.referenceImages || quote.referenceImages || []
  const fields = [
    ['服务', conversationState.serviceType === 'lash' ? '美睫' : conversationState.serviceType === 'nail' ? '美甲' : '未确定'],
    ['来源', conversationState.sourceChannel || conversation?.sourceChannel || '-'],
    ['顾客类型', (displayState.customerType || state.customerType) === 'returning' ? '老客' : '新客'],
    ['会员等级', displayState.memberTier || state.memberTier || '-'],
    ['报价阶段', conversationState.quoteStage || 'idle'],
    ['下一步', conversationState.nextAction || '-'],
    ['参考图', `${images.length || 0} 张`],
    ['延长', stateFlagText(displayState.extensionNeeded)],
    ['卸甲', stateFlagText(displayState.removalNeeded)],
    ['断甲修补', stateFlagText(displayState.repairNeeded)],
    ['下睫毛', stateFlagText(displayState.lowerLashRequested)],
    ['卸睫', stateFlagText(displayState.lashRemovalNeeded)],
    ['预约时间', [displayState.bookingDate, displayState.bookingTime].filter(Boolean).join(' ') || '-'],
    ['最近人工', memory.lastStaffMessage || displayState.lastStaffReply || '-']
  ]
  els.statePanel.innerHTML = `
    <section class="sim-state-card">
      <div>
        <strong>AI 当前理解</strong>
        <span>${escapeHtml(conversationState.summaryText || '还未形成明确需求')}</span>
      </div>
      <dl>
        ${fields.map(([label, value]) => `<p><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></p>`).join('')}
      </dl>
    </section>
  `
}

function render() {
  els.customerId.value = state.customerId
  els.sourceChannel.value = state.sourceChannel
  if (els.customerStage) els.customerStage.value = state.customerStage
  if (els.customerType) els.customerType.value = state.customerType
  if (els.memberTier) els.memberTier.value = state.memberTier
  renderImagePreview()
  renderTranscript()
  renderConversationStrip()
  renderStatePanel()
  syncComposerState()
}

async function refreshConversations(options = {}) {
  if (!options.force && userIsEditing()) return
  const data = await request('/admin/wechat/conversations')
  state.conversations = data.conversations || []
  if (!state.selectedConversationId) {
    const expected = `wecom:${state.customerId}`
    state.selectedConversationId = state.conversations.find((item) => item.id === expected)?.id || state.conversations[0]?.id || ''
  }
  render()
}

async function readImages(files) {
  const selected = [...(files || [])].slice(0, 6)
  state.images = await Promise.all(selected.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({
      name: file.name,
      url: reader.result,
      type: file.type,
      size: file.size,
      uploadedAt: new Date().toISOString()
    })
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })))
  renderImagePreview()
}

async function sendMessage(forceAi = false) {
  syncFormState()
  const content = els.message.value.trim()
  const conversationId = currentConversationId()
  if (forceAi && state.delayedBuffers[conversationId]?.messages?.length && !content && !state.images.length) {
    await flushDelayedMessages(conversationId)
    return
  }
  if (!content && !state.images.length && !forceAi) return
  const outgoingMessage = content || (state.images.length ? '我发了参考图，想让你帮我看一下。' : '请继续用 AI 接待这位顾客。')
  const outgoingImages = [...state.images]
  const firstMessage = !hasSentInConversation(conversationId) && !state.delayedBuffers[conversationId]?.messages?.length
  els.message.value = ''
  state.images = []
  els.referenceImages.value = ''
  state.selectedConversationId = conversationId
  localStorage.setItem('lucky-simulator-conversation-id', state.selectedConversationId)
  if (!firstMessage && !forceAi) {
    queueDelayedMessage(conversationId, outgoingMessage, outgoingImages)
    return
  }
  await sendImmediateMessage(conversationId, outgoingMessage, outgoingImages, forceAi)
}

function queueDelayedMessage(conversationId, content, images = []) {
  const buffer = state.delayedBuffers[conversationId] || {
    messages: [],
    images: [],
    forceAi: false
  }
  buffer.messages.push({
    role: 'customer',
    content,
    referenceImages: images,
    pending: true,
    at: new Date().toISOString()
  })
  buffer.images = [...buffer.images, ...images]
  buffer.forceAi = false
  state.delayedBuffers[conversationId] = buffer
  renderDelayedBuffer(conversationId, 'AI 会等 20 秒，把顾客连续补充的话一起理解后再回复。')
  clearTimeout(state.delayedTimers[conversationId])
  state.delayedTimers[conversationId] = setTimeout(() => {
    flushDelayedMessages(conversationId).catch(handleSendError)
  }, 20000)
  toast('已收到，会等 20 秒聚合连续消息再交给 AI')
}

function renderDelayedBuffer(conversationId, note = '等待继续输入...') {
  const buffer = state.delayedBuffers[conversationId]
  if (!buffer) return
  state.pendingByConversation[conversationId] = [
    ...buffer.messages,
    {
      role: 'assistant',
      content: note,
      pending: true,
      at: new Date().toISOString()
    }
  ]
  render()
}

async function flushDelayedMessages(conversationId) {
  const buffer = state.delayedBuffers[conversationId]
  if (!buffer?.messages?.length) {
    delete state.pendingByConversation[conversationId]
    setComposerSending(false, conversationId)
    render()
    return
  }
  clearTimeout(state.delayedTimers[conversationId])
  delete state.delayedTimers[conversationId]
  const message = buffer.messages.map((item) => item.content).filter(Boolean).join('\n')
  const images = buffer.images || []
  delete state.delayedBuffers[conversationId]
  await sendImmediateMessage(conversationId, message || '请继续用 AI 接待这位顾客。', images, buffer.forceAi)
}

async function sendImmediateMessage(conversationId, outgoingMessage, outgoingImages = [], forceAi = false) {
  state.selectedConversationId = conversationId
  markSentInConversation(conversationId)
  state.pendingByConversation[conversationId] = [
    {
      role: 'customer',
      content: outgoingMessage,
      referenceImages: outgoingImages,
      pending: true,
      at: new Date().toISOString()
    },
    {
      role: 'assistant',
      content: 'AI 正在读取当前对话和知识库，请稍等...',
      pending: true,
      at: new Date().toISOString()
    }
  ]
  setComposerSending(true, conversationId)
  render()
  try {
    const data = await request('/admin/wechat/mock-chat-message', {
      method: 'POST',
      body: JSON.stringify({
        externalUserId: state.customerId,
        message: outgoingMessage,
        sourceChannel: state.sourceChannel,
        customerStage: 'unified_test',
        customerType: state.customerType,
        memberTier: state.memberTier,
        points: state.customerType === 'returning' ? 100 : 0,
        referenceImages: outgoingImages,
        lang: 'zh',
        forceAi
      })
    })
    delete state.pendingByConversation[conversationId]
    state.selectedConversationId = data.conversationId
    localStorage.setItem('lucky-simulator-conversation-id', state.selectedConversationId)
    await refreshConversations({ force: true })
  } catch (error) {
    delete state.pendingByConversation[conversationId]
    throw error
  } finally {
    setComposerSending(false, conversationId)
  }
}

async function saveLogicNote() {
  const note = els.logicNote?.value.trim()
  if (!note) return
  syncFormState()
  const conversation = currentConversation()
  await request('/admin/ai/customer-service/logic-notes', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: conversation?.id || currentConversationId(),
      note,
      sourceChannel: state.sourceChannel,
      customerStage: 'unified_test',
      customerType: state.customerType,
      memberTier: state.memberTier,
      status: 'pending_review'
    })
  })
  els.logicNote.value = ''
  toast('已记录为规则/逻辑缺口，后续可固化进知识库')
}

async function saveFeedback(button) {
  const messageIndex = Number(button.dataset.simFeedbackSave)
  const conversationId = button.dataset.conversationId || ''
  const correctedReply = document.querySelector(`[data-sim-feedback-reply="${messageIndex}"]`)?.value.trim()
  const notes = document.querySelector(`[data-sim-feedback-notes="${messageIndex}"]`)?.value.trim()
  if (!conversationId || !correctedReply) return
  const data = await request('/admin/ai/customer-service/feedback', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      messageIndex,
      correctedReply,
      notes,
      customerMessage: button.dataset.customerMessage || '',
      originalReply: button.dataset.originalReply || '',
      lang: 'zh',
      status: 'approved'
    })
  })
  state.selectedConversationId = data.conversation?.id || conversationId
  await refreshConversations({ force: true })
  toast('已保存为满意样本，下一次相似问题会参考这条回复')
}

function createNewCustomer() {
  const previousConversationId = currentConversationId()
  clearConversationDraftState(previousConversationId)
  const next = Number(localStorage.getItem('lucky-simulator-customer-seq') || '1')
  state.customerId = `sim-customer-${String(next).padStart(3, '0')}`
  localStorage.setItem('lucky-simulator-customer-seq', String(next + 1))
  state.selectedConversationId = `wecom:${state.customerId}`
  state.images = []
  els.message.value = ''
  els.referenceImages.value = ''
  els.customerId.value = state.customerId
  if (els.customerType) els.customerType.value = state.customerType
  if (els.memberTier) els.memberTier.value = state.memberTier
  localStorage.setItem('lucky-simulator-customer-id', state.customerId)
  localStorage.setItem('lucky-simulator-conversation-id', state.selectedConversationId)
  setComposerSending(false)
  render()
}

function handleSendError(error) {
  const conversationId = currentConversationId()
  clearConversationDraftState(conversationId)
  setComposerSending(false, conversationId)
  render()
  toast(error.message)
}

els.send.addEventListener('click', () => sendMessage(false).catch(handleSendError))
els.forceAi.addEventListener('click', () => sendMessage(true).catch(handleSendError))
els.saveLogicNote?.addEventListener('click', () => saveLogicNote().catch((error) => toast(error.message)))
els.newCustomer.addEventListener('click', createNewCustomer)
els.refresh.addEventListener('click', () => refreshConversations({ force: true }).catch((error) => toast(error.message)))
els.referenceImages.addEventListener('change', (event) => readImages(event.target.files).catch((error) => toast(error.message)))
els.message.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    sendMessage(false).catch((error) => toast(error.message))
  }
})
els.conversationStrip.addEventListener('click', (event) => {
  const button = event.target.closest('[data-sim-conversation]')
  if (!button) return
  state.selectedConversationId = button.dataset.simConversation
  localStorage.setItem('lucky-simulator-conversation-id', state.selectedConversationId)
  const conversation = state.conversations.find((item) => item.id === state.selectedConversationId)
  if (conversation?.externalUserId) state.customerId = conversation.externalUserId
  setComposerSending(false)
  render()
})
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-sim-clear-images]')) {
    state.images = []
    els.referenceImages.value = ''
    renderImagePreview()
  }
  const feedbackButton = event.target.closest('[data-sim-feedback-save]')
  if (feedbackButton) saveFeedback(feedbackButton).catch((error) => toast(error.message))
})

els.customerId.value = state.customerId
els.sourceChannel.value = state.sourceChannel
if (els.customerStage) els.customerStage.value = state.customerStage
if (els.customerType) els.customerType.value = state.customerType
if (els.memberTier) els.memberTier.value = state.memberTier
;[els.customerId, els.sourceChannel, els.customerStage, els.customerType, els.memberTier]
  .filter(Boolean)
  .forEach((el) => el.addEventListener('change', syncFormState))
render()
refreshConversations({ force: true }).catch((error) => toast(error.message))
setInterval(() => refreshConversations().catch(() => {}), 5000)
