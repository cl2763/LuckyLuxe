/* ② 事实闸常驻套件(图 §三;Cowork 05g §二 定的四条判据)

   门(①)管「该不该答」,事实闸管「**答的内容是不是编的**」。
   四条判据按 05g 原文:
   ① 造病:夹具注入槽外数字 → 必须拦下
   ② **D136 并排表为锚**:金额 / 可否抵扣 / 三档比例,三项逐项一致
   ③ 租户隔离:A 店地址不得出现在 B 店回复
   ④ 价目:需报价项目只说「需技师确认」,不出数字 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTestTarget } from './test-guard.mjs'
import { collectFactSlots, verifyReplyFacts, passFactGate, FACT_GATE_REPLY } from './ai-fact-gate.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const srcMain = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const RUN = Date.now().toString(36)
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const api = async (p, tid, o = {}) => {
  const r = await fetch(`${BASE_URL}${p}`, {
    ...o,
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token',
      ...(tid ? { 'x-admin-tenant-id': tid, 'x-tenant-id': tid } : {}), ...(o.headers || {}) },
  })
  try { return await r.json() } catch { return null }
}
const chat = (tid, ext, message) => api('/admin/wechat/mock-chat-message', tid,
  { method: 'POST', body: JSON.stringify({ externalUserId: ext, message }) })

// 两个真实存在的独立租户；未知租户必须拒绝，不能借默认店来冒充隔离通过。
const FACT_TENANTS = [`fact-cad-${RUN}`, `fact-cny-${RUN}`]
for (const [i, tid] of FACT_TENANTS.entries()) {
  const created = await api('/platform/tenants', null, {method:'POST',body:JSON.stringify({id:tid,name:tid,plan:'chain',currency:i?'CNY':'CAD',timezone:i?'Asia/Shanghai':'America/Toronto'})})
  if (!created?.tenant) throw new Error('事实闸租户夹具创建失败')
  const configured=await api('/admin/deposit-config',tid,{method:'PUT',body:JSON.stringify({enabled:true,mode:'fixed',fixedAmountCents:i?6000:5000,fallbackAmountCents:i?6000:5000,deductible:!i,cancelPolicy:{lateForfeitPct:i?0:50,noShowForfeitPct:100}})})
  if(configured?.error) throw new Error('事实闸定金夹具配置失败')
}

/* ── 夹具:拿真店数据造槽,不自己编 ────────────────────────── */
const SLOTS = collectFactSlots(
  { depositAmount: 50, priceList: [{ price: 'CAD $168', deposit: 'CAD $50' }, { price: 'CAD $88' }] },
  { mode: 'fixed', fixedAmountCents: 5000, fallbackAmountCents: 5000, deductible: true,
    cancelPolicy: { lateForfeitPct: 50, noShowForfeitPct: 100 } },
)

/* ── 判据①:造病 —— 槽外数字必须拦下,槽内的必须放行 ────────── */
const MUST_BLOCK = [
  ['编了个金额', '美甲定金 CAD $80,可抵扣尾款。'],
  ['编了个比例', '不足 24 小时取消扣除 30%。'],
  ['抵扣说反了', '定金 CAD $50,不可抵扣尾款哦。'],
  ['编了个会员卡面额', '充值 CAD $3000 送 $500。'],
]
const MUST_PASS = [
  ['D136 原文', '美甲定金 CAD $50,可抵扣尾款。提前 24 小时以上取消全额退还;不足 24 小时扣除 50%;爽约扣 100%。'],
  ['营业时间(数字不是钱)', '我们周一休息,周二至周日 10:00-19:00 营业。'],
  ['价目内的数', '经典奶油法式 CAD $168 起,手部基础护理 CAD $88。'],
  ['七项收集表(全是序号)', '1. 项目类型 2. 日期 3. 是否卸甲 4. 是否延长 5. 断甲 6. 参考图 7. 备注'],
]
check(`① 造病:${MUST_BLOCK.length} 句槽外事实**全部拦下**`,
  MUST_BLOCK.every(([, t]) => !verifyReplyFacts(t, SLOTS).ok),
  `漏放:${MUST_BLOCK.filter(([, t]) => verifyReplyFacts(t, SLOTS).ok).map(([k]) => k).join(' | ')}`)
check(`①b 🔴 反向守:${MUST_PASS.length} 句**槽内**事实一句都不许拦 —— 判据太紧会变成误报机器`,
  MUST_PASS.every(([, t]) => verifyReplyFacts(t, SLOTS).ok),
  `误拦:${MUST_PASS.filter(([, t]) => !verifyReplyFacts(t, SLOTS).ok)
    .map(([k, t]) => `${k}(${verifyReplyFacts(t, SLOTS).offenders.map((o) => o.kind + '=' + o.value).join(',')})`).join(' | ')}`)
check('①c 拦下之后出的是「我帮您问一下」+ 转人工(3b),不是静默、也不是把错数字说出去',
  (() => {
    const r = passFactGate({ data: { answerZh: '定金 CAD $80' } }, SLOTS)
    return r.blocked?.length > 0 && r.reply.data.gate === 'fact_gate'
      && r.reply.data.tier === '3b' && r.reply.data.handoffRequired === true
      && /帮您问一下/.test(r.reply.data.answerZh)
  })(), '')

/* ── 判据②:D136 并排表为锚 ────────────────────────────────
   04e 那份逐项对照写明「留作闭环批『事实只从店数据取』判据的锚,
   锚三项:金额 / 可否抵扣 / 三档退款比例」。这里就按三项逐项验,
   而且**两店各验一遍** —— D136 的要害正是两店配置相反。 */
for (const tid of FACT_TENANTS) {
  const cfg = await api('/admin/deposit-config', tid)
  const c = cfg?.config || cfg || {}
  const d = await chat(tid, `fact-dep-${RUN}-${tid}`, '定金要多少?能退吗?')
  const say = `${d?.reply?.data?.answerZh || ''}${d?.reply?.data?.answerEn || ''}`
  const cp = c.cancelPolicy || {}
  const wantDeduct = Boolean(c.deductible)
  const saysNotDeduct = /不(可以|能)?抵扣|不抵扣|not\s+deduct/i.test(say)
  const saysDeduct = !saysNotDeduct && /抵扣|deduct/i.test(say)
  check(`② D136 锚·${tid}·**可否抵扣**:店数据 ${wantDeduct} ↔ 回复说的一致`,
    !say || (wantDeduct ? saysDeduct : (saysNotDeduct || !saysDeduct)),
    `店=${wantDeduct} 回复=${saysDeduct ? '可抵扣' : (saysNotDeduct ? '不可抵扣' : '没提')} | ${say.slice(0, 70)}`)
  check(`② D136 锚·${tid}·**三档比例**:临期 ${cp.lateForfeitPct}% / 爽约 ${cp.noShowForfeitPct}% —— 回复里的百分比不许有第三个数`,
    [...say.matchAll(/(\d{1,3})\s*%/g)].every((m) => [0, 100, Number(cp.lateForfeitPct), Number(cp.noShowForfeitPct)].includes(Number(m[1]))),
    say.slice(0, 90))
  check(`② D136 锚·${tid}·**金额**:回复里的钱数必须过事实闸`,
    !d?.reply || d.reply.data?.gate !== 'fact_gate',
    `被事实闸拦下了 → 说明回复里的金额不在槽内:${say.slice(0, 70)}`)
}

/* ── 判据③:租户隔离 —— A 店地址不得出现在 B 店回复 ────────────
   🔴 **景是这套件自己造的**(《造景律》:谁出走查单,谁先把景造好)。
   CI 库里只有一个真租户,所以现建两家店、各设一个不同地址,再问 B 店要地址。
   05g 现测踩过一坑:`x-admin-tenant-id` **不是**管理路由的换店开关
   (闸门取的是 `admin.tenantId`,来自令牌),所以建店与设地址都要走 `/platform/*`。 */
const PLAT = process.env.OWNER_TOKEN || requireOwnerToken()
const plat = async (p, o = {}) => {
  const r = await fetch(`${BASE_URL}${p}`, {
    ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${PLAT}`, ...(o.headers || {}) },
  })
  let d = null
  try { d = await r.json() } catch { d = null }
  return { status: r.status, data: d }
}
const TA = `fga-${RUN}`
const TB = `fgb-${RUN}`
const ADDR = { [TA]: `A街 ${RUN} 号,多伦多`, [TB]: `B路 ${RUN} 号,多伦多` }
let isoFixtureOk = true
for (const tid of [TA, TB]) {
  const made = await plat('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `事实闸${tid}`, plan: 'chain' }) })
  if (made.status !== 201) { isoFixtureOk = false; break }
  const set = await plat(`/platform/tenants/${tid}/store`, { method: 'PUT', body: JSON.stringify({ address: ADDR[tid] }) })
  if (![200, 201].includes(set.status)) { isoFixtureOk = false; break }
}
if (!isoFixtureOk) {
  check('③ 🔴 租户隔离:造景失败 —— 判据没验到东西,按红处理(不许「造不出来就当过了」)', false, '建店或设地址没成功')
} else {
  /* 🔴 零命中先证刀能咬(店主 05l 现修):
     这一组比的是「问 B 店地址,回复里不许出现 A 店地址」。
     可**万一换店压根没换成**,那两边就是同一家店,A 的地址当然不会出现 ——
     判据绿得毫无意义。所以先证:同一个请求换个店,**读到的地址确实变了**。
     (`x-admin-tenant-id` 才是后台换店开关;只发 `x-tenant-id` 换不动 —— ③④ 两批都栽过。) */
  const kbA = await api('/admin/kb', TA)
  const kbB = await api('/admin/kb', TB)
  const addrA = String(kbA?.liveFacts?.storeAddress || kbA?.facts?.storeAddress || '')
  const addrB = String(kbB?.liveFacts?.storeAddress || kbB?.facts?.storeAddress || '')
  check('③0 先证换店真的换了:A/B 两店读到的 storeAddress 不同(否则底下是自己跟自己比)',
    Boolean(addrA) && Boolean(addrB) && addrA !== addrB, `A=${addrA} | B=${addrB}`)
  check('③0b 且分别等于夹具写进去的那两个地址', addrA === ADDR[TA] && addrB === ADDR[TB],
    `期望 A=${ADDR[TA]} B=${ADDR[TB]}`)

  const d = await chat(TB, `fact-addr-${RUN}`, '门店地址在哪里?')
  const say = `${d?.reply?.data?.answerZh || ''}${d?.reply?.data?.answerEn || ''}`
  check('③ 🔴 租户隔离:问 B 店地址,回复里**不许出现** A 店地址',
    !say.includes(ADDR[TA]), `A=${ADDR[TA]} | 回复=${say.slice(0, 90)}`)
  check('③b 反向守:B 店自己的地址**应当**能答出来(拦串味不等于把功能拦没)',
    !say || say.includes(ADDR[TB]) || Boolean(d?.reply?.data?.handoffRequired) || d?.reply?.data?.gate === 'fact_gate',
    `B=${ADDR[TB]} | 回复=${say.slice(0, 90)}`)
}

/* ── 判据④:需报价项目只说「需技师确认」,不出数字 ────────────
   价目里 `price_rule` 需技师确认的项目,AI 不许自己给一个数。 */
const d4 = await chat('lucky-luxe', `fact-quote-${RUN}`, '复杂的手绘款多少钱?')
const say4 = `${d4?.reply?.data?.answerZh || ''}${d4?.reply?.data?.answerEn || ''}`
check('④ 需报价项目:要么走采集/转人工,要么说「需技师确认」—— 不许自己报一个数',
  !d4?.reply || d4.reply.data?.gate === 'fact_gate' || d4.reply.source
  || /技师确认|确认后|需要技师|帮您问|artist will confirm|confirmed by/i.test(say4)
  || ![...say4.matchAll(/(?:CAD|\$)\s?\d/g)].length,
  say4.slice(0, 110))

/* ── 判据⑤ J-20:定金金额**只有一处真相** ─────────────────────────
   Cowork 05h §一 裁「合并」:`deposit_config` 是唯一真相(钱按它算,话也按它说),
   知识库那个 `depositAmount` 降为**派生只读**,写口关掉。

   静态判据写成**白名单式**(判据三:数「我列的都对」永远漏没列的):
   把全仓 `depositAmount` 的出现处**逐个归类**,落不进白名单的自动红。 */
const SRC = ['ai-fact-gate.mjs', 'ai-utils.mjs', 'kb-routes.mjs', 'kb-utils.mjs', 'local-server.mjs']
const CATS = [
  { name: '钱的算法(唯一真相)', re: /depositAmountForService/ },
  { name: '派生口 / 派生结果透传',
    re: /depositFactFromConfig|depositAmountNote|live\.depositAmount|depositFactsAll\.depositAmount|rawDepositAll|\{ depositAmount: amount|kbFacts\?\.depositAmount/ },
  /* 「已撤走的键」指路表:商家再传它时,400 里要说清去哪改。
     这一类**必须单列**,不能混进注释 —— 它是真代码,而且它的存在本身就是 J-20 的一部分。 */
  /* 「已撤走的键」指路表:现在是多行对象,每个键各占一行,所以按键名认 */
  { name: '已撤走键的指路表', re: /const retired = \{|^\s*(depositAmount|currency): '/ },
]
/* 🔴 注释不能靠「这一行以 // 或 * 开头」来认 —— 块注释里换行后的**续行**没有任何标记
   (05h 现测:我自己写的两行说明就落进了「未归类」)。所以逐行**跟踪块注释状态**,
   在注释里的行整行跳过。判据自己也要分得清代码和说明,否则每次写注释都要红一次。 */
const scanFile = (src) => {
  const out = []
  let inBlock = false
  src.split('\n').forEach((ln, i) => {
    const line = ln
    const opens = inBlock
    if (!inBlock && /\/\*/.test(line) && !/\*\//.test(line.slice(line.indexOf('/*') + 2))) inBlock = true
    else if (inBlock && /\*\//.test(line)) inBlock = false
    const isComment = opens || /^\s*(\/\/|\/\*|\*)/.test(line) || /^\s*\+ '/.test(line)
    if (!/depositAmount/.test(line) || isComment) return
    if (!CATS.some((c) => c.re.test(line))) out.push(`${i + 1} ${line.trim().slice(0, 70)}`)
  })
  return out
}
const homeless = []
for (const f of SRC) {
  for (const hit of scanFile(readFileSync(join(ROOT, 'apps/api', f), 'utf8'))) homeless.push(`${f}:${hit}`)
}
check('⑤ J-20 静态白名单:全仓 `depositAmount` 每一处(注释除外)都必须落进「钱的算法/派生口」两类之一',
  homeless.length === 0, homeless.join(' | '))

/* 四个「必须是 0」的口 —— 写口关了没有、种子清了没有、槽还认不认它 */
const kbRoutesSrc = readFileSync(join(ROOT, 'apps/api/kb-routes.mjs'), 'utf8')
const factGateSrc = readFileSync(join(ROOT, 'apps/api/ai-fact-gate.mjs'), 'utf8')
check('⑤b J-20 四个口全关:商家写口 0 · 平台写口 0 · 种子 0 · 事实槽 0',
  !/allowed = \[[^\]]*'depositAmount'/.test(kbRoutesSrc)
  && !/allowed = \[[^\]]*'depositAmount'/.test(srcMain)
  && !/\['depositAmount', '\d+'\]/.test(srcMain)
  && !/if \(facts\.depositAmount\) addMoney/.test(factGateSrc),
  JSON.stringify({
    商家写口: /allowed = \[[^\]]*'depositAmount'/.test(kbRoutesSrc),
    平台写口: /allowed = \[[^\]]*'depositAmount'/.test(srcMain),
    种子: /\['depositAmount', '\d+'\]/.test(srcMain),
    事实槽: /if \(facts\.depositAmount\) addMoney/.test(factGateSrc),
  }))

/* 行为层:改配置 → AI 说新数;写知识库那个键 → 400。两店各跑一遍。 */
for (const tid of FACT_TENANTS) {
  const before = await api('/admin/deposit-config', tid)
  const cfg0 = before?.config || before || {}
  const NEW = 7700
  await api('/admin/deposit-config', tid, { method: 'PUT', body: JSON.stringify({
    ...cfg0, enabled: true, mode: 'fixed', fixedAmountCents: NEW, fallbackAmountCents: NEW }) })
  const d = await chat(tid, `j20-${RUN}-${tid}`, '定金要多少?')
  const say = `${d?.reply?.data?.answerZh || ''}${d?.reply?.data?.answerEn || ''}`
  check(`⑤c J-20 行为·${tid}:改配置 → AI 说新数(77)且**不被事实闸拦**`,
    /77/.test(say) && d?.reply?.data?.gate !== 'fact_gate', say.slice(0, 90))
  const put = await api('/admin/kb/facts', tid, { method: 'PUT', body: JSON.stringify({ facts: { depositAmount: '60' } }) })
  check(`⑤d J-20 行为·${tid}:写知识库 depositAmount → 拒绝(写口已关)`,
    Boolean(put?.error) && put.error.code === 'UNKNOWN_KB_KEY'
    && /门店设置|定金规则/.test(put.error.message || ''),
    JSON.stringify(put?.error || put).slice(0, 130))
  await api('/admin/deposit-config', tid, { method: 'PUT', body: JSON.stringify(cfg0) })   // 还原
}

/* ── 判据⑥ D140:币种**只有一处真相** = `stores.currency` ────────────────
   和 J-20 同一形状,但错的是**钱的单位** —— 小婕店是人民币,币种说错等于差一个汇率。
   静态判据同样白名单式:全仓 `'CAD'` 字面量逐处归类,落不进白名单的自动红。 */
const CUR_SRC = ['ai-utils.mjs', 'business-hours-routes.mjs', 'kb-routes.mjs', 'kb-utils.mjs',
  'local-server.mjs', 'store-matrix.mjs', 'tenant-currency.mjs']
const CUR_CATS = [
  { name: '建店/种子写入(写进唯一真相那张表)', re: /INSERT .*INTO stores|body\.currency|store\.currency \?\?/ },
  { name: '夹具生成器(store-matrix 造店矩阵)', re: /store-matrix/ },
]
const curHomeless = []
for (const f of CUR_SRC) {
  const src = readFileSync(join(ROOT, 'apps/api', f), 'utf8')
  let inBlock = false
  src.split('\n').forEach((ln, i) => {
    const opens = inBlock
    if (!inBlock && /\/\*/.test(ln) && !/\*\//.test(ln.slice(ln.indexOf('/*') + 2))) inBlock = true
    else if (inBlock && /\*\//.test(ln)) inBlock = false
    const isComment = opens || /^\s*(\/\/|\/\*|\*)/.test(ln)
    if (!/'CAD'/.test(ln) || isComment) return
    if (f === 'store-matrix.mjs') return                       // 整份是夹具生成器
    if (!CUR_CATS.some((c) => c.re.test(ln))) curHomeless.push(`${f}:${i + 1} ${ln.trim().slice(0, 66)}`)
  })
}
check('⑥ D140 静态白名单:全仓 `\'CAD\'` 字面量(注释除外)只许出现在「建店/种子写入」与「夹具生成器」',
  curHomeless.length === 0, curHomeless.join(' | '))

const curSrcMain = readFileSync(join(ROOT, 'apps/api/tenant-currency.mjs'), 'utf8')
/* 🔴 只看**函数体**,不看注释 —— 这个文件的注释里正写着「原来读 tenant_kb_facts、兜底 'CAD'」
   (那是在讲被删掉的旧写法)。把注释算进去,判据会因为**我把病史写清楚**而报红。 */
const curFnBody = (() => {
  const i = curSrcMain.indexOf('function tenantCurrencyCode(')
  const body = curSrcMain.slice(i, curSrcMain.indexOf('\n  }', i))
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
})()
check('⑥b D140 读侧零兜底:`tenantCurrencyCode` **函数体内**不许出现 `tenant_kb_facts`,也不许有 `\'CAD\'` 兜底',
  !/tenant_kb_facts/.test(curFnBody) && !/'CAD'/.test(curFnBody), curFnBody.slice(0, 220))

/* 行为:写知识库 currency → 400 指路;两店各跑 */
for (const tid of FACT_TENANTS) {
  const put = await api('/admin/kb/facts', tid, { method: 'PUT', body: JSON.stringify({ facts: { currency: 'USD' } }) })
  check(`⑥c D140 行为·${tid}:写知识库 currency → 拒绝并指到「门店设置 → 币种」`,
    put?.error?.code === 'UNKNOWN_KB_KEY' && /门店设置|币种/.test(put.error.message || ''),
    JSON.stringify(put?.error || put).slice(0, 120))
}

/* ── 判据⑦ 废弃键读口过滤(05i §三):库不动,但页面上不许再出现 ── */
for (const tid of FACT_TENANTS) {
  const kb = await api('/admin/kb', tid)
  const f = kb?.facts || {}
  const lf = kb?.liveFacts || {}
  const leaked = ['depositAmount', 'currency'].filter((k) => k in f || k in lf)
  check(`⑦ 废弃键读口过滤·${tid}:GET /admin/kb 里 depositAmount/currency 0 处`,
    leaked.length === 0, `残留:${leaked.join('、')}`)
}

console.log(`\n[事实闸] 造病 ${MUST_BLOCK.length} 拦 / ${MUST_PASS.length} 放 · D136 三锚 × 2 店 · 租户隔离 · 需报价不出数`)
if (fails.length) { console.error(`\n❌ test-ai-fact-gate ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-ai-fact-gate 通过 ${n} 项`)
