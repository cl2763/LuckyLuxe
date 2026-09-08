/* ② 事实闸 —— **出口校验**:AI 说出去的事实,必须在店数据里找得到(图 §三)

   ══ 这一闸解决什么 ══
   门(①)管的是「该不该答」,事实闸管的是「**答的内容是不是编的**」。
   模型很会说话,顾客问定金它一定给得出一个数 —— 给的是不是**这家店的**那个数,
   模型自己不知道,提示词也保证不了。所以出口再验一道:
   **回复里出现的数字与「可否抵扣」,必须能在事实槽里找到;找不到就不放出去。**

   ══ 锚哪三项(D136 并排表定的)══
   04e 那份逐项对照(后端 `/store/deposit-policy` 原文 vs 模型两次回答)明确写着:
   「留作闭环批『事实只从店数据取』判据的锚,锚三项:**金额 / 可否抵扣 / 三档退款比例**」。
   本闸就按这三项验,不自行扩大 —— 扩大到「所有数字」会把营业时间、日期、项目数量全卷进来,
   变成一台误报机器(判据太紧淹掉真的,J-06/J-07 已经栽过两次)。

   ══ 拦下之后做什么 ══
   图 §三:换成「这个我帮您问一下」并**转人工(3b)**,不放出去。
   —— 不是静默,也不是让它把错数字说出来再道歉。 */

/* 定金金额的**唯一派生口**(J-20):fixed → 固定额;per_service → 兜底额 + 注明「按项目不同」。
   注明那句要进提示词 —— 不注明的话,per_service 店的 AI 会把兜底额说成所有项目的定金。 */
export function depositFactFromConfig(config = {}) {
  if (!config.enabled) return {}
  const cents = config.mode === 'fixed' ? config.fixedAmountCents : config.fallbackAmountCents
  const amount = Math.round(Number(cents || 0) / 100)
  if (!Number.isFinite(amount) || amount <= 0) return {}
  return config.mode === 'fixed'
    ? { depositAmount: amount }
    : { depositAmount: amount, depositAmountNote: '按项目不同,以预约页显示为准' }
}


/* ── 事实槽:六个,只从**唯一来源**取 ────────────────────────────
   来源就是 `tenantKbFacts(tenantId)` 那一份(它已经是全仓唯一的店数据出口)。
   这里不另开数据库查询 —— 再查一次就是「一件事两处真相」,两份迟早漂。 */
export function collectFactSlots(facts = {}, deposit = {}) {
  const money = new Set()
  const pct = new Set()
  const addMoney = (v) => {
    const n = Math.round(Number(v))
    if (Number.isFinite(n) && n > 0) money.add(n)
  }
  /* 槽③ 定金三项:金额 / 可否抵扣 / 三档比例 */
  if (deposit.mode === 'fixed') addMoney((deposit.fixedAmountCents || 0) / 100)
  addMoney((deposit.fallbackAmountCents || 0) / 100)
  /* 🔴 J-20:这里原来把**知识库那个 `depositAmount`** 也算进槽 ——
     于是「知识库 60」与「配置 50」两个数**都被放行**,等于给漂移开了后门:
     闸本来是防「说的和收的不一样」,结果它把两个都认了。
     裁定后定金金额只有一处真相(`deposit_config`),槽③只认下面那几行配置来的数。 */
  const cp = deposit.cancelPolicy || {}
  for (const v of [cp.lateForfeitPct, cp.noShowForfeitPct]) {
    const n = Number(v)
    if (Number.isFinite(n)) pct.add(n)
  }
  pct.add(100)   // 「全额退」= 100%,是三档里的第一档
  pct.add(0)     // 「不扣」= 0%
  /* 槽④ 价目:服务价、加项价、会员卡面额与赠额 */
  for (const s of facts.priceList?.items || facts.priceList || []) {
    addMoney(String(s.price || '').replace(/[^\d.]/g, ''))
    addMoney(String(s.deposit || '').replace(/[^\d.]/g, ''))
  }
  for (const a of facts.addonList?.items || []) addMoney(String(a.price || '').replace(/[^\d.]/g, ''))
  for (const m of facts.memberLevels || []) {
    addMoney(String(m.price || '').replace(/[^\d.]/g, ''))
    addMoney(String(m.bonus || '').replace(/[^\d.]/g, ''))
  }
  return {
    money,                                   // 允许出现的钱数(整数元)
    pct,                                     // 允许出现的百分比
    deductible: Boolean(deposit.deductible), // 可否抵扣:唯一真相
    /* 槽①②⑤⑥ 以文本形式注入模型(营业时间/地址电话停车/可约时段/顾客历史),
       出口校验只管数字与抵扣 —— 地址是否串店由**租户隔离判据**单独守(见套件④)。 */
    address: facts.storeAddress || null,
    phone: facts.storePhone || null,
  }
}

/* ── 出口校验 ──────────────────────────────────────────────
   只看**带币符的钱**与**百分比**,不看裸数字:
   「周二至周日 10:00-19:00」「7 项」「24 小时」里的数字都不是事实断言,
   把它们卷进来会天天误报(判据太紧 = 淹掉真的)。 */
const MONEY_RE = /(?:CAD|USD|RMB|¥|\$)\s?(\d{1,5}(?:\.\d{1,2})?)|(\d{1,5}(?:\.\d{1,2})?)\s*(?:元|块|刀)/gi
const PCT_RE = /(\d{1,3})\s*%|百分之\s*(\d{1,3})/g
/* 「可否抵扣」的两种说法,各自的正反面 */
const SAYS_DEDUCTIBLE = /可(以)?抵扣|能抵扣|抵扣尾款|抵作|deduct(ed|ible)?\s+(from|against)?\s*(the\s+)?(final|balance|total)?|counts? toward/i
const SAYS_NOT_DEDUCTIBLE = /不(可以|能)?抵扣|不抵扣|不可抵|not\s+deduct|non-?deductible|cannot be deducted/i

export function verifyReplyFacts(text = '', slots = {}) {
  const s = String(text || '')
  const offenders = []
  for (const m of s.matchAll(MONEY_RE)) {
    const n = Math.round(Number(m[1] || m[2]))
    if (!Number.isFinite(n) || n <= 0) continue
    if (!slots.money?.has(n)) offenders.push({ kind: '金额', value: n, snippet: m[0] })
  }
  for (const m of s.matchAll(PCT_RE)) {
    const n = Number(m[1] || m[2])
    if (!Number.isFinite(n)) continue
    if (!slots.pct?.has(n)) offenders.push({ kind: '比例', value: n, snippet: m[0] })
  }
  /* 🔴 D152 的反面那一半(店主 05q §二):**没折扣就不许提折扣**。
     这一条以前只写在喂给模型的那句事实里 —— 那是「请你别说」,不是「说了会被拦下来」。
     模型照样说得出「券后 ¥348」,而顾客真的会照着这个价来付钱(零编造红线)。
     所以搬到闸上:店里没有任何可用券时,回复里出现这几个字就是编事实,按同一档拦。
     只在 `noDiscount === true` 时生效 —— 有券的店照常说券,一个字都不拦。 */
  if (slots.noDiscount === true) {
    const m = s.match(/券后|折后|优惠券|打折|折扣|优惠价/)
    if (m) offenders.push({ kind: '编折扣', value: m[0], snippet: '本店当前没有任何可用券' })
  }
  /* 可否抵扣:说反了也是编事实 —— D136 里两店配置正相反,这一项最容易串 */
  const saysNo = SAYS_NOT_DEDUCTIBLE.test(s)
  const saysYes = !saysNo && SAYS_DEDUCTIBLE.test(s)
  if (saysYes && slots.deductible === false) offenders.push({ kind: '可否抵扣', value: '说可抵扣', snippet: '店数据是不可抵扣' })
  if (saysNo && slots.deductible === true) offenders.push({ kind: '可否抵扣', value: '说不可抵扣', snippet: '店数据是可抵扣' })
  return { ok: offenders.length === 0, offenders }
}

/* ── 拦下后的出句(后端唯一出口;图 §三「换成『这个我帮您问一下』并转人工」)── */
export const FACT_GATE_REPLY = {
  intent: 'handoff',
  answerZh: '这个我帮您问一下,确认清楚再回复您 —— 免得我说错了让您白跑一趟。',
  answerEn: "Let me check this with the store and get back to you — I'd rather confirm than give you the wrong number.",
  handoffRequired: true,
  gate: 'fact_gate',
  tier: '3b',
}

/* 单一入口:回复过闸。过了原样返回;没过就换成上面那句 + 3b。 */
export function passFactGate(reply, slots) {
  const data = reply?.data
  if (!data) return { reply, blocked: null }
  const zh = verifyReplyFacts(data.answerZh || '', slots)
  const en = verifyReplyFacts(data.answerEn || '', slots)
  const offenders = [...zh.offenders, ...en.offenders]
  if (!offenders.length) return { reply, blocked: null }
  return { reply: { ...reply, source: 'fact_gate', data: { ...FACT_GATE_REPLY } }, blocked: offenders }
}

/* 单一入口(工厂式,与 `createAiGate` 同姿态)——
   调用方只剩一行 `factGate.check(...)`,事实槽怎么取、拦下出什么句子都在这个文件里。
   `tenantKbFacts` / `getDepositConfig` 仍在 `local-server.mjs`,按公约②下批一起搬。 */
export function createFactGate(deps) {
  const { tenantKbFacts, getDepositConfig, currentTenantId, hasAnyDiscount } = deps
  for (const [name, fn] of Object.entries(deps)) {
    if (typeof fn !== 'function') throw new Error(`createFactGate 缺依赖或类型不对:${name}`)
  }
  return {
    /* `ruleSource` 有值 = 规则层自己出的句子,它本来就是从店数据拼的,不必再验
       (再验一遍是拿尺子量尺子;而且规则层的措辞里有「7 项」这类数字,验了只会误报)。 */
    check(reply, ruleSource) {
      if (ruleSource) return reply
      const tid = currentTenantId()
      const slots = collectFactSlots(tenantKbFacts(tid), getDepositConfig(tid))
      slots.noDiscount = hasAnyDiscount(tid) === false   // D152:这家店有没有真折扣,现取
      const r = passFactGate(reply, slots)
      if (r.blocked) console.warn(`[事实闸] 拦下一句:${r.blocked.map((o) => `${o.kind}=${o.value}`).join(' · ')}`)
      return r.reply
    },
  }
}
