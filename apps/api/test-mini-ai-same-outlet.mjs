/* D155 · 小程序问 AI 与企微/模拟器**是同一个出口**(店主 09-08:「就像网页一样」)

   案由(Cowork 05r §二 现查):`/ai/customer-service` 自己拼 knowledgeContext 后**直接**调
   `createCustomerServiceReply` —— 全仓第二个调用点。于是 `handleWecomInbound` 里的东西一个都没走:
   预约采集、报价采集、事实闸、转人工、会话流水、待审、D147 未开通话术、D148 口吻。
   **同一句话,顾客在小程序问和在企微问,答得不是一回事。**

   本刀两层:
   ① **静态白名单式**:出口只剩一个;进这个出口的门逐个登记,多一处少一处都红。
      (判据三:数「全部必须落进白名单」,不数「我列的都对」。)
   ② **行为层同答**:同一店同一句,两条路各发一次(各自新会话),
      `intent` 与**回复文本**必须一模一样,并且两边**各自都在会话流水里留下两行**
      —— 「答得一样」还不够,得证明两条路都真的走了那套记账。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget, isTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || requireOwnerToken()
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ═══ ① 静态:一个出口,几道门 ═══ */
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const bare = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const replyCalls = (bare.match(/createCustomerServiceReply\(/g) || []).length
check('① 🔴 出口唯一:全仓 `createCustomerServiceReply(` 只剩 1 处(在 handleWecomInbound 里)',
  replyCalls === 1, `现有 ${replyCalls} 处`)

/* 进这个出口的门:逐个登记 + 条数上棘轮。
   多一处 = 有人又开了一条没登记的进线路;少一处 = 某条进线被摘了(小程序那条正是这么漏的)。 */
const GATES = [
  ['企微回调(加密进线)', /const inbound = normalizeWecomInbound\(body, query, decryptedBody\)/],
  ['企微 sync_msg 拉取', /syncAndProcessWecomKfMessages|sourceChannel: 'wecom_kf'/],
  ['模拟器 mock-chat-message', /path === '\/admin\/wechat\/mock-chat-message'/],
  ['模拟器 mock-message', /path === '\/admin\/wechat\/mock-message'/],
  ['顾客端 /ai/customer-service(D155 并进来的那条)', /path === '\/ai\/customer-service'/],
]
for (const [zh, re] of GATES) check(`①b 进线口在册:${zh}`, re.test(bare))
const gateCalls = (bare.match(/await handleWecomInbound\(/g) || []).length
check(`①c 🔴 进线口条数 = ${GATES.length}(多一处 = 又开了条没登记的路;少一处 = 某条被摘了)`,
  gateCalls === GATES.length, `现有 ${gateCalls} 处`)
check('①d 顾客端那条是**薄壳**:自己不拼 knowledgeContext,只装 inbound 后交出去',
  /path === '\/ai\/customer-service'[\s\S]{0,900}?await handleWecomInbound\(inbound, req\)/.test(bare)
  && !/path === '\/ai\/customer-service'[\s\S]{0,900}?buildKnowledgeContext/.test(bare))
check('①e 只回 `reply`,不把整份会话记录吐给公开接口(读那道闸)',
  /path === '\/ai\/customer-service'[\s\S]{0,1200}?json\(res, 200, \{ reply: result\.reply \}\)/.test(bare))

/* 客户端不再带 history —— 记忆的唯一真相是会话流水 */
const mpApi = readFileSync(join(ROOT, 'miniprogram/utils/api.js'), 'utf8')
const mpChat = readFileSync(join(ROOT, 'miniprogram/pages/ai-chat/index.js'), 'utf8')
/* 🔴 只看这个函数**自己的函数体**:第一版写成 `split(...)[1]` 取了文件后半截,
   于是别处出现的 history 也算到它头上 —— 判据在没病时也红,和有病时也绿一样废。 */
const aiFnBody = (mpApi.match(/function aiCustomerService\([\s\S]*?\n\}/) || [''])[0]
check('②a 小程序不再把 history 带上来(第二处记忆 = 第二处真相,而且必然对不上)',
  /function aiCustomerService\(message\)/.test(mpApi) && Boolean(aiFnBody) && !/history/.test(aiFnBody), aiFnBody.slice(0, 120))
check('②b 聊天页不再自己攒 history', !/this\.hist/.test(mpChat))
check('②c 没登录时带**存住的** clientId(后端靠它把同一个人的几句话归到同一通)',
  /wx\.setStorageSync\('lucky_client_id'/.test(mpApi) && /clientId: clientChatId\(\)/.test(mpApi))
const identity = readFileSync(join(ROOT, 'apps/api/customer-chat.mjs'), 'utf8')
check('②d 🔴 身份优先取**服务端解出来的**登录用户,访客走独立前缀(客户端伪造不到真实顾客头上)',
  /requireCustomer\(req\)/.test(identity) && /`mp:\$\{customer\.id\}`/.test(identity)
  && /`mp-guest:\$\{clientId\}`/.test(identity))

/* ═══ ② 行为层:两条路同答 ═══ */
const onTest = await isTestTarget(BASE_URL)
if (!onTest) {
  console.log(`⚠️  [mini-ai-same-outlet] ${BASE_URL} 不是测试库 —— **行为层本轮未跑**(不是通过)`)
  console.log('   正确跑法:bash apps/api/run-all-tests.sh mini-ai-same-outlet')
} else {
  await assertTestTarget(BASE_URL)
  const DB = process.env.TEST_DB_PATH
  const db = new DatabaseSync(DB, { readOnly: true })
  // 本套件自建三家已开通 AI 的店，不能随机抽中其他套件故意关闭 AI 的夹具。
  const fixtureTag=Date.now().toString(36),tenants=[]
  for(let i=0;i<3;i++){
    const id=`ai-same-${fixtureTag}-${i}`
    const r=await fetch(`${BASE_URL}/platform/tenants`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({id,name:id,plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'})})
    if(r.status!==201)throw new Error('AI 同出口夹具建店失败')
    tenants.push(id)
  }
  /* 🔴 执行随机段(J-31):会话 id 里必须带这一跑独有的串,
     否则两跑之间会接上同一通对话,答案跟着上下文变,「同答」就成了随机数。 */
  const RUN = `d155-${Date.now().toString(36)}`
  /* 日期不写死(判据不许锚在会变的字面量上;夹具硬编码日期以前坑过四处) */
  const tomorrow = new Date(Date.now() + 86400000)
  const ASKS = [
    ['通一 · 疼不疼', '做美睫疼不疼呀?'],
    ['通三 · 能约吗', `${tomorrow.getMonth() + 1}月${tomorrow.getDate()}日能约吗?`],
    ['通六 · 多少钱', '做个法式多少钱?'],
  ]
  const post = (path, body, headers) => fetch(`${BASE_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
  const textOf = (reply) => {
    const d = reply?.data || {}
    return String(d.answerZh || d.answer || d.answerEn || '')
  }
  const rowsOf = (cid) => (cid ? db.prepare('SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ?').get(cid)?.n ?? -1 : -1)
  /* 顾客端那条**不回 conversationId**(公开接口不吐会话内容),所以按「外部用户」反查。
     它的外部用户就是 `customer-chat.mjs` 定的那个:没登录 = `mp-guest:<clientId>`。 */
  const cidOf = (externalUserId, tenant) => db.prepare(
    'SELECT id FROM wechat_conversations WHERE tenant_id = ? AND external_user_id = ? LIMIT 1',
  ).get(tenant, externalUserId)?.id || ''

  check('③ 造景自证:测试库里取得到三家店(取不到就没验到任何东西)', tenants.length === 3, `${tenants.length} 家`)
  let answered = 0
  for (let ti = 0; ti < 3; ti += 1) {
    const tenant = tenants[ti]
    for (const [label, ask] of ASKS) {
      const tag = `${RUN}-${ti}-${label.slice(0, 2)}`
      /* 顾客端那条:身份靠 clientId(没登录);模拟器那条:身份靠 externalUserId。
         两边各给一个**只属于这一格**的串 —— 两通全新对话,起点一样。 */
      const mp = await post('/ai/customer-service', { message: ask, lang: 'zh', clientId: `${tag}-mp` },
        { 'x-tenant-id': tenant })
      const sim = await post('/admin/wechat/mock-chat-message', { message: ask, lang: 'zh', externalUserId: `${tag}-sim` },
        { authorization: `Bearer ${TOKEN}`, 'x-admin-tenant-id': tenant })
      const mpText = textOf(mp.json?.reply)
      const simText = textOf(sim.json?.reply)
      check(`③ ${tenant} · ${label}:两条路**同一句**(intent 与文本都相同)`,
        mp.status === 200 && sim.status === 201 && Boolean(mpText) && mpText === simText
        && (mp.json?.reply?.data?.intent || '') === (sim.json?.reply?.data?.intent || ''),
        JSON.stringify({ 小程序: mpText.slice(0, 40), 模拟器: simText.slice(0, 40), 状态: [mp.status, sim.status] }))
      if (mpText && mp.json?.reply?.data?.intent !== 'entitlement_disabled') answered += 1
      /* 「答得一样」还不够 —— 两条路都得真的记账,顾客端那条以前一行都不落。
         🔴 这里**不猜行数**:第一版写死「问一句+答一句=2 行」,现测是 3 行(引擎还会补一行),
         于是判据在功能完全正常时红。改成比**两条路记的账一模一样**(角色序列逐个相同),
         再加一条「不是两条都不记」的反向守 —— 这才是要证的事。 */
      const rolesOf = (cid) => (cid ? db.prepare(
        'SELECT role FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC',
      ).all(cid).map((r) => r.role).join('>') : '')
      const mpRoles = rolesOf(cidOf(`mp-guest:${tag}-mp`, tenant))
      const simRoles = rolesOf(sim.json?.conversationId || '')
      check(`③b ${tenant} · ${label}:两条路在会话流水里记的账**一模一样**(角色序列逐个相同)`,
        Boolean(mpRoles) && mpRoles === simRoles, JSON.stringify({ 小程序: mpRoles, 模拟器: simRoles }))
      check(`③c ${tenant} · ${label}:反向守 —— 确实记了账(不是两条都不记所以"一样")`,
        mpRoles.split('>').filter(Boolean).length >= 2, `小程序落了 ${mpRoles.split('>').filter(Boolean).length} 行`)
    }
  }
  check('③d 反向守:至少有一格真的走到了 AI(全是「未开通」的话,上面只证明了闸门一致,没证明答案一致)',
    answered > 0, `${answered} 格走到了 AI`)
  db.close()
}

console.log(`\n[D155 同一出口] 出口 1 处 · 进线口 ${GATES.length} 道 · 三店 × 三句两条路对答`)
if (fails.length) { console.error(`\n❌ test-mini-ai-same-outlet ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-mini-ai-same-outlet 通过 ${n} 项`)
