// 租户知识库回归(阶段2-4):
// 1. 事实种子存在;商家改定金/地址后 AI 回答立即使用新值
// 2. 商家 FAQ 命中直答(替代静默转人工);带服务意图的混合消息不被 FAQ 抢答
// 3. 停用条目后恢复静默转人工;删除、权限保护
/* D132 口径④(店主 04d §一):顾客侧公开路由**必须带门店标识**,不再回落旗舰店。
   夹具同批补头 —— 补的是「请求带不带 x-tenant-id」,判据一个字没放宽。
   per-call 的 headers 仍然后到先得(跨租户用例照旧覆盖它)。 */
const TENANT_HEADER = process.env.TEST_TENANT_ID || 'lucky-luxe'
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
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
    headers: { 'x-tenant-id': TENANT_HEADER, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
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
    /* 🔴 J-20(Cowork 05h §一 裁「合并成一处真相」,2026-09-05):
       定金金额**不再是知识库事实** —— 唯一真相是「门店设置 → 定金规则」(`deposit_config`),
       知识库那个键降为**派生只读**、写口已关。所以种子里不再有这一行,
       断言改成:它现在是**由配置派生**出来的数(拿公开政策口对一遍)。 */
    /* ⚠️ 库里**旧的 `depositAmount` 行不删**(05h §一 第 5 条:删行要走 4128 写,不值得;
       读口全断开后它就是死数据,写进两库对照表「废弃键」栏,上线批清)。
       所以 `/admin/kb` 这个原始视图**可能还看得见它**。
       🔴 这条要守的不是「行没了」,而是「**它已经不起作用**」——
       而「不起作用」必须**验得出来**:先记下原始行的值,等下面改完配置,
       再确认①AI 说的是**配置**的数 ②那一行**原封没动**(证明 AI 没在读它)。
       (第一版我在这里写了 `check(..., true, ...)` —— 恒真兜底,`test-delivery-evidence`
        的「判据自述自守②」当场把它咬出来:**一条永远不会红的断言不是断言**。) */
    const staleDepositRow = kb.data.facts?.depositAmount
    check('facts seeded (storeAddress)', Boolean(kb.data.facts?.storeAddress))

    // 2. 改定金 → AI 定金回答立即用新值
    /* ══ 🔴 D134(店主 04f §一.1 裁现修):`allowed` 之外的键必须 400 点名,且**库一个字不许动** ══
       原来是**静默丢弃还回 200** —— 商家看到「保存成功」而库里没有,从响应上分不出「存了」和「没存」。
       归族**静默失败器族**。裁法是 400 点名,不做 ignoredKeys:
       「保存成功」这四个字不许在没存的时候出现。 */
    const kbBefore = (await request('/admin/kb')).data.facts
    const bad1 = await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { parkingInfo: '门口有车位' } }) })
    const bad2 = await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { storeAddress: '不该被写进去 1 号', kidsPolicy: 'x' } }) })
    const kbAfter = (await request('/admin/kb')).data.facts
    check('🔴 D134:陌生键 → 400 UNKNOWN_KB_KEY 并**点名是哪几个键**',
      bad1.status === 400 && bad1.data?.error?.code === 'UNKNOWN_KB_KEY'
      && String(bad1.data?.error?.message || '').includes('parkingInfo'), JSON.stringify(bad1.data).slice(0, 150))
    check('🔴 D134b:认识的键与陌生键**混在一起也整体 400**,库一个字不许动 —— '
      + '半存半不存比全不存更糟(商家以为都存了)',
    bad2.status === 400 && JSON.stringify(kbBefore) === JSON.stringify(kbAfter),
    `前 ${JSON.stringify(kbBefore)}\n后 ${JSON.stringify(kbAfter)}`)
    const okKey = await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { storeAddress: '合法地址 9 号' } }) })
    check('🔴 D134c 反向守:只传认识的键必须 200 且真的存进去 —— '
      + '一把「谁来都 400」的闸跟关掉这个口一样',
    okKey.status === 200 && (await request('/admin/kb')).data.facts?.storeAddress === '合法地址 9 号',
    JSON.stringify(okKey.data).slice(0, 120))

    /* 🔴 J-20 改造景:原来是「改知识库 depositAmount → AI 说新数」——
       那条路已经关了(写口 400)。改成**改配置 → AI 说新数**,并顺手验写口确实关着。 */
    const putRetired = await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { depositAmount: '60' } }) })
    check('J-20 写口已关:知识库改定金金额 → 400 且指路到门店设置',
      putRetired.status === 400 && putRetired.data?.error?.code === 'UNKNOWN_KB_KEY'
      && /门店设置|定金规则/.test(putRetired.data?.error?.message || ''),
      JSON.stringify(putRetired.data).slice(0, 130))
    const cfg0 = (await request('/admin/deposit-config')).data
    const baseCfg = cfg0?.config || cfg0 || {}
    await request('/admin/deposit-config', { method: 'PUT', body: JSON.stringify({
      ...baseCfg, enabled: true, mode: 'fixed', fixedAmountCents: 6000, fallbackAmountCents: 6000 }) })
    const depositReply = await request('/ai/customer-service', { method: 'POST', body: JSON.stringify({ lang: 'zh', message: '预约需要付定金吗？定金多少？' }) })
    const depositText = depositReply.data?.reply?.data?.answerZh || ''
    check('J-20 改配置 → AI 定金回答立即用新数(60)', /60/.test(depositText), depositText.slice(0, 120))
    const kbAfterJ20 = await request('/admin/kb')
    check('J-20 残留旧行是**死数据**:AI 用的是配置的数,而那一行原封没动(证明没人读它)',
      String(kbAfterJ20.data.facts?.depositAmount) === String(staleDepositRow),
      JSON.stringify({ 改配置前: staleDepositRow, 改配置后: kbAfterJ20.data.facts?.depositAmount }))
    await request('/admin/deposit-config', { method: 'PUT', body: JSON.stringify(baseCfg) })   // 还原配置

    // 3. 改地址 → AI 门店回答立即用新值
    await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { storeAddress: '888 Test Ave Unit 5' } }) })
    const storeReply = await request('/ai/customer-service', { method: 'POST', body: JSON.stringify({ lang: 'zh', message: '你们店地址在哪里？' }) })
    const storeText = storeReply.data?.reply?.data?.answerZh || ''
    check('AI store answer uses updated address', /888 Test Ave/.test(storeText), storeText.slice(0, 120))

    // 4. FAQ 直答:先确认停车问题原本是静默(无回复),添加条目后直答
    const beforeUser = `kb-before-${RUN_ID}`
    const before = await chat(beforeUser, '你们店附近好停车吗？')
    /* 🔴 口径已换(05f 换门):没有 KB 条目时,旧门是**静默**,新门是**礼貌拒绝/转人工**。
       这条断言真正要守的从来不是「静默」,而是「**不瞎编**」—— 没这条知识就别现编停车位。
       所以改成:要么没回复,要么回复里**不许出现具体的停车细节**(层数/车位数/免费时长)。 */
    const beforeText = `${before.data?.reply?.data?.answerZh || ''}${before.data?.reply?.data?.answerEn || ''}`
    check('没有 FAQ 条目时不许瞎编停车细节(旧门静默 / 新门礼貌拒绝,都不许现编)',
      !before.data?.reply || !/地下|车位|层|免费停|小时|parking lot|spaces|floor/.test(beforeText),
      JSON.stringify(beforeText).slice(0, 160))

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
    /* 同上:停用条目后回到「没有这条知识」的状态 —— 守的是**不瞎编**,不是「静默」。
       这条与上面那条是一对:①还没加条目 ②加了又停用,两种都不许现编停车细节。 */
    const disabledText = `${disabled.data?.reply?.data?.answerZh || ''}${disabled.data?.reply?.data?.answerEn || ''}`
    check('条目停用后回到「不瞎编」:不许再出现具体停车细节',
      !disabled.data?.reply || !/地下|车位|层|免费停|小时|parking lot|spaces|floor/.test(disabledText),
      JSON.stringify(disabledText).slice(0, 160))

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
      body: JSON.stringify({ facts: { unknownKeyForTest: '999' } })
    })
    check('bad token rejected', badAuth.status === 401, String(badAuth.status))

    console.log(`[tenant-kb] all ${checks} checks passed`)
  } finally {
    // 恢复种子事实,清理测试条目,不影响其他测试
    await request('/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { storeAddress: '136 veterans place' } }) }).catch(() => {})
    if (entryId) await request(`/admin/kb/entries/${entryId}`, { method: 'DELETE' }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('[tenant-kb] failed:', error.message)
  process.exit(1)
})
