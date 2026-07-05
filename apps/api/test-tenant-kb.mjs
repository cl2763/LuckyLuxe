// 租户知识库回归(阶段2-4):
// 1. 事实种子存在;商家改定金/地址后 AI 回答立即使用新值
// 2. 商家 FAQ 命中直答(替代静默转人工);带服务意图的混合消息不被 FAQ 抢答
// 3. 停用条目后恢复静默转人工;删除、权限保护
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function chat(externalUserId, message) {
  return request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId, message, customerType: 'new', memberTier: 'silver', lang: 'zh', forceAi: true })
  })
}

async function main() {
  let entryId = ''
  try {
    // 1. 事实种子
    const kb = await request('/admin/kb')
    check('kb endpoint 200', kb.status === 200)
    check('facts seeded (depositAmount)', kb.data.facts?.depositAmount === '50', kb.data.facts?.depositAmount)
    check('facts seeded (storeAddress)', Boolean(kb.data.facts?.storeAddress))

    // 2. 改定金 → AI 定金回答立即用新值
    await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { depositAmount: '60' } }) })
    const depositReply = await request('/ai/customer-service', { method: 'POST', body: JSON.stringify({ lang: 'zh', message: '预约需要付定金吗？定金多少？' }) })
    const depositText = depositReply.data?.reply?.data?.answerZh || ''
    check('AI deposit answer uses updated fact (60)', /60/.test(depositText), depositText.slice(0, 120))

    // 3. 改地址 → AI 门店回答立即用新值
    await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { storeAddress: '888 Test Ave Unit 5' } }) })
    const storeReply = await request('/ai/customer-service', { method: 'POST', body: JSON.stringify({ lang: 'zh', message: '你们店地址在哪里？' }) })
    const storeText = storeReply.data?.reply?.data?.answerZh || ''
    check('AI store answer uses updated address', /888 Test Ave/.test(storeText), storeText.slice(0, 120))

    // 4. FAQ 直答:先确认停车问题原本是静默(无回复),添加条目后直答
    const beforeUser = `kb-before-${RUN_ID}`
    const before = await chat(beforeUser, '你们店附近好停车吗？')
    check('parking question silent before FAQ entry', !before.data?.reply || before.data?.reply?.data?.intent === 'silent_unknown_handoff', JSON.stringify(before.data?.reply || null).slice(0, 120))

    const created = await request('/admin/kb/entries', {
      method: 'POST',
      body: JSON.stringify({ question: '停车', keywords: '停车,parking,车位', answerZh: '门口有免费停车位，共 6 个车位，停满时可以停对面 plaza。', answerEn: 'Free parking at the door (6 spots); overflow parking across the street.' })
    })
    entryId = created.data?.entry?.id || ''
    check('FAQ entry created', created.status === 201 && Boolean(entryId))

    const afterUser = `kb-after-${RUN_ID}`
    const after = await chat(afterUser, '你们店附近好停车吗？')
    check('FAQ entry answers directly', after.data?.reply?.data?.intent === 'tenant_kb_answer', JSON.stringify(after.data?.reply?.data || null).slice(0, 150))
    check('FAQ answer is merchant original text', /免费停车位/.test(after.data?.reply?.data?.answerZh || ''))

    // 5. 混合消息(带服务意图)不被 FAQ 抢答
    const mixedUser = `kb-mixed-${RUN_ID}`
    const mixed = await chat(mixedUser, '我想做美甲，顺便问下停车方便吗')
    check('mixed service message not hijacked by FAQ', mixed.data?.reply?.data?.intent !== 'tenant_kb_answer', mixed.data?.reply?.data?.intent)

    // 6. 停用条目 → 恢复静默
    await request(`/admin/kb/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })
    const disabledUser = `kb-disabled-${RUN_ID}`
    const disabled = await chat(disabledUser, '你们店附近好停车吗？')
    check('disabled entry restores silent handoff', !disabled.data?.reply || disabled.data?.reply?.data?.intent === 'silent_unknown_handoff', JSON.stringify(disabled.data?.reply || null).slice(0, 120))

    // 7. 文件导入:CSV → 拆条;问答体 → 拆条;自由文本 → 知识文档
    const csvImport = await request('/admin/kb/import', {
      method: 'POST',
      body: JSON.stringify({ filename: 'price.csv', content: '问题,关键词,回答\n可以带宠物吗,宠物,小型安静宠物可以，需要提前说一声\n有wifi吗,wifi,有免费wifi，密码问前台' })
    })
    check('csv import splits entries', csvImport.data?.mode === 'entries' && csvImport.data?.imported === 2, JSON.stringify(csvImport.data))
    const petUser = `kb-pet-${RUN_ID}`
    const petReply = await chat(petUser, '请问可以带宠物吗？')
    check('csv-imported FAQ answers directly', petReply.data?.reply?.data?.intent === 'tenant_kb_answer' && /宠物/.test(petReply.data?.reply?.data?.answerZh || ''), JSON.stringify(petReply.data?.reply?.data || null).slice(0, 120))

    const qaImport = await request('/admin/kb/import', {
      method: 'POST',
      body: JSON.stringify({ filename: 'rules.txt', content: '问：卫生间在哪里\n答：店内右侧走廊尽头。\n问：能刷卡吗\n答：支持刷卡、Apple Pay 和现金。' })
    })
    check('qa-format import splits entries', qaImport.data?.mode === 'entries' && qaImport.data?.imported === 2, JSON.stringify(qaImport.data))

    const docImport = await request('/admin/kb/import', {
      method: 'POST',
      body: JSON.stringify({ filename: 'notes.md', content: '本店创立于2020年，主打日式美甲风格。店内使用进口甲油胶品牌。夏季会推出限定款式系列。' })
    })
    check('freeform import stored as document (mock mode)', docImport.data?.mode === 'document', JSON.stringify(docImport.data))
    const kbAfterImport = await request('/admin/kb')
    check('document listed in kb', (kbAfterImport.data.documents || []).some((doc) => doc.title === 'notes.md'))

    // 清理导入产物
    for (const entry of (kbAfterImport.data.entries || []).filter((item) => /宠物|wifi|卫生间|能刷卡/.test(item.question))) {
      await request(`/admin/kb/entries/${entry.id}`, { method: 'DELETE' })
    }
    for (const doc of (kbAfterImport.data.documents || []).filter((item) => item.title === 'notes.md')) {
      await request(`/admin/kb/documents/${doc.id}`, { method: 'DELETE' })
    }
    const kbCleaned = await request('/admin/kb')
    check('import artifacts cleaned up', !(kbCleaned.data.documents || []).some((doc) => doc.title === 'notes.md'))

    // 8. 删除 + 权限保护
    const deleted = await request(`/admin/kb/entries/${entryId}`, { method: 'DELETE' })
    check('entry deleted', deleted.status === 200 && deleted.data.deleted === true)
    entryId = ''
    const badAuth = await fetch(`${BASE_URL}/admin/kb/facts`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ facts: { depositAmount: '999' } })
    })
    check('bad token rejected', badAuth.status === 401, String(badAuth.status))

    console.log(`[tenant-kb] all ${checks} checks passed`)
  } finally {
    // 恢复种子事实,清理测试条目,不影响其他测试
    await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { depositAmount: '50', storeAddress: '136 veterans place' } }) }).catch(() => {})
    if (entryId) await request(`/admin/kb/entries/${entryId}`, { method: 'DELETE' }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('[tenant-kb] failed:', error.message)
  process.exit(1)
})
