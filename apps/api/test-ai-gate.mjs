/* ① 门 + 三档(大批05 图 v1.1 §一 · 判据 1–3、12)

   ══ 病(D133)══
   门开在模型**前面**,用几十个关键词判「这句话是不是本店业务」——
   顾客说「多少米」「明儿下午有空位吗」「手上想弄点花样」一律不理;
   而且**一轮没命中就整通哑掉**:进了 `needs_human` 之后,连命中关键词的话也不答。
   评测集实测(关键词门 · 真模型):同义不含那 80 句 **72 句静默**,范围内被答率 **38%**。

   ══ 图裁 ══
   门挪到模型后面(`inScope/confidence/slots` 与回复**同一次请求**出),规则层分三档:
   ≥0.7 且 inScope → 答 · 0.4–0.7 → 反问一句 · <0.4 或范围外 → 礼貌一句 + 转人工(**不静默**)。
   **只有人工真正接管(`human_active`)才静默**;关键词表降级为快速通道。

   ⚠️ standalone:CI_SUITES="ai-gate" bash apps/api/run-all-tests.sh */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTestTarget } from './test-guard.mjs'
import { ALL_200, A_WITH_KEYWORD, B_SYNONYM_NO_KEYWORD, C_OUT_OF_SCOPE, EDGE_80 } from './ai-eval-set.mjs'

/* 🔴 本套件必须打在**模型门**的实例上。
   门的默认档由评测结果决定(见回执 §二「四个数并排」),默认档可能是关键词门;
   而三档的行为断言只有模型门下才成立 —— 打在默认实例上会红得莫名其妙。
   所以照 `test-schema-consistency` 的先例:**自带一份实例**(独立 DATA_DIR + 端口),
   `AI_GATE=model` 显式写死,与默认档是什么无关。
   这也顺带满足「判据不许锚在会变的配置上」:默认档以后怎么调,这套件都照样在验三档。 */
const OWN_PORT = process.env.AI_GATE_TEST_PORT || '4179'
let child = null
let ownDir = null
if (!process.env.TEST_BASE_URL) {
  /* 🔴 目录名必须是 `ll-ci-data.` 开头 —— 服务端就是靠这个前缀把 `dataScope` 判成 `test`,
     测试护栏只认 `dataScope==='test'`。第一版用了 `ll-aigate-`,护栏当场拒跑,**拒得对**:
     它问的是「服务器往哪个库写」,不是「我记不记得设环境变量」。 */
  /* 🔴 先确认端口是空的。不确认的话:端口上若已有别人的服务(上一轮残留、或店主手工起的),
     `spawn` 会因 EADDRINUSE 悄悄死掉,而下面的 /health 轮询**照样连得上那台旧的** ——
     于是这套件测的是别人的服务、还可能是别的门档,红绿都不作数。归族「静默失败器」。 */
  try {
    const probe = await fetch(`http://127.0.0.1:${OWN_PORT}/health`, { signal: AbortSignal.timeout(1500) })
    if (probe.ok) {
      console.error(`\n🔴 [ai-gate] 端口 ${OWN_PORT} 上已经有服务在跑 —— 本套件要自带一份模型门实例,`)
      console.error(`   连上别人的实例等于测了个不相干的东西。先腾出端口,或指定 AI_GATE_TEST_PORT=<别的端口>。\n`)
      process.exit(2)
    }
  } catch { /* 连不上 = 端口是空的,正是我们要的 */ }
  ownDir = mkdtempSync(join(tmpdir(), 'll-ci-data.aigate'))
  child = spawn(process.execPath, [join(fileURLToPath(new URL('.', import.meta.url)), 'local-server.mjs')], {
    env: { ...process.env, DATA_DIR: ownDir, PORT: OWN_PORT, AI_GATE: 'model', ALLOW_DEMO_ADMIN_LOGIN: 'true' },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${OWN_PORT}/health`)).ok) break } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
}
const BASE_URL = process.env.TEST_BASE_URL || `http://127.0.0.1:${OWN_PORT}`
const cleanupOwn = () => {
  if (child) { try { child.kill() } catch { /* 已经没了 */ } }
  if (ownDir) { try { rmSync(ownDir, { recursive: true, force: true }) } catch { /* 清不掉不致命 */ } }
}
/* ⚠️ 只挂 `process.on('exit')` 是**挂不住的**:活着的子进程会把父进程的事件循环 ref 住,
   于是主流程跑完也不退出、`exit` 事件永远不来 —— 套件挂死在最后一行(现测挂了 9 分钟)。
   两手都要:①`unref()` 让子进程不再拖住事件循环 ②收尾处**显式**调一次清理。 */
if (child) child.unref()
process.on('exit', cleanupOwn)
await assertTestTarget(BASE_URL)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const RUN = Date.now().toString(36)
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const chat = async (ext, message, extra = {}) => {
  const r = await fetch(`${BASE_URL}/admin/wechat/mock-chat-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token' },
    body: JSON.stringify({ externalUserId: ext, message, ...extra }),
  })
  let d = null
  try { d = await r.json() } catch { d = null }
  return d
}

/* ══ 判据 12 · 评测集本身要在,且形状对得上图 §五 ══ */
check(`⑫ 评测集在册且分份对得上图 §五:A 含关键词 ${A_WITH_KEYWORD.length}=80 · `
  + `B 同义不含 ${B_SYNONYM_NO_KEYWORD.length}=80 · C 无关 ${C_OUT_OF_SCOPE.length}=40 · `
  + `边角 ${EDGE_80.length}=80 —— 换门的门槛就锚在这份集子上,集子缩水判据就空转`,
A_WITH_KEYWORD.length === 80 && B_SYNONYM_NO_KEYWORD.length === 80
&& C_OUT_OF_SCOPE.length === 40 && EDGE_80.length === 80 && ALL_200.length === 200, '')

const groups = EDGE_80.reduce((a, e) => ({ ...a, [e.group]: (a[e.group] || 0) + 1 }), {})
check('⑫b 边角六组齐(图片 20 / 语音转文字 15 / 一句多问 10 / 边角 20 / 打断改口 10 / 像人 5)',
  groups['图片'] === 20 && groups['语音转文字'] === 15 && groups['一句多问'] === 10
  && groups['边角'] === 20 && groups['打断改口'] === 10 && groups['像人'] === 5, JSON.stringify(groups))

/* ══ 判据 2 · D133 反面:范围外一句 → 转人工;同一会话下一句范围内 → **必须得到回复** ══ */
const ext = `gate-d133-${RUN}`
const out1 = await chat(ext, '你觉得今天天气怎么样')
const in2 = await chat(ext, '你们营业时间几点到几点?')
check('② 🔴 D133 反面:范围外一句之后,**同一会话**下一句「营业时间?」必须得到回复 —— '
  + '原来一轮没命中就整通哑掉(对照实验四步为证:顾客第二句「周日开吗」就触发)',
  Boolean(in2?.reply), `第1句 reply=${Boolean(out1?.reply)} · 第2句 reply=${Boolean(in2?.reply)}`)

/* ══ 判据 3 · 只有 human_active 静默 ══ */
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*\/\/.*$/gm, '')
/* ③ 🔴 这条判据原来锚的是一个**具体代码形状**(`['needs_human','human_active'].includes` 不许出现),
   而那个形状来自我第一版的错解法 —— 那一版把整条分支限成 `human_active`,
   连「把顾客补的图并进在办报价单」那一半也一起绕过去了,`working-memory` 当场红。
   **外层分支必须照样接住 `needs_human`**(要做维护),只是不再从那里静默返回。
   所以判据改成守真正的不变量,写成**白名单式**:
   全文件每一处「静默返回」(`waitingForHuman: true`)都必须被 `human_active` 守卫包着,
   新写一处忘了包 → 立刻红。这比数某个字符串在不在耐得住重构。 */
/* ⚠️ 这把判据自己被修了**三**回,三回都是判据的缺陷,留着当案底(J 族:判据也是代码,也会坏):
   ① 第一版拿 `waitingForHuman: true` 当「静默」—— 4 处里 2 处其实带回复,分母就是错的;
   ② 第二版按「往前 1500 字符」找守卫 —— 合法那处离函数头 55 行,窗口够不着,
      于是**守卫明明在、判据说不在**。魔法窗口就是这么骗人的;
   ③ 第三版按「所在函数」找守卫 —— **造病验红时当场露馅**:往 `needs_human` 分支里
      新塞一处静默返回,判据照样绿。因为 `handleWecomInbound` 是个几百行的大函数,
      **函数体里更早的那个合法守卫,把后面新塞的违规洗白了**。
      作用域取粗一格,白名单就退化成「这个函数里有过守卫就算数」。
   现在按**所在代码块**定位:从静默点往上做花括号配平,找到真正包着它的那个 `if`,
   守卫必须写在**那一个** `if` 上。粒度对了,洗白就不成立。 */
const lines = srv.split('\n')
const SILENT = /reply: null, waitingForHuman: true/
/* 往上花括号配平:遇到的 `}` 比 `{` 多一个时,那一行就是开这个块的行 */
const openerOf = (idx) => {
  let depth = 0
  for (let i = idx - 1; i >= 0; i--) {
    const l = lines[i].replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '')
    depth += (l.match(/\}/g) || []).length - (l.match(/\{/g) || []).length
    if (depth < 0) return i
  }
  return 0
}
const SILENT_OK = [
  { why: '人工接管中 —— 守卫必须写在**直接包着它的那个 if** 上,不许靠函数里别处的守卫洗白',
    hit: (op) => /existing\.status === 'human_active'/.test(lines[op]) },
  { why: '旧关键词门的静默口 —— 只在 `AI_GATE=keyword` 下可达,留着是为了跑对照;新门下走不到',
    hit: (op, i) => lines.slice(Math.max(0, op - 60), i).some((l) => /^function silentHandoffUnknown/.test(l)) },
]
const silentSites = lines.map((l, i) => (SILENT.test(l) ? i : -1)).filter((i) => i >= 0)
const homeless = silentSites.filter((i) => !SILENT_OK.some((c) => c.hit(openerOf(i), i)))
check('③ 🔴 白名单:每一处**静默返回**都必须落进「人工接管中」或「旧门静默口」两类之一 —— '
  + '新写一处忘了包守卫立刻红(D133:`needs_human` 不许静默,顾客下一句仍按第 1 档走)',
  silentSites.length >= 2 && homeless.length === 0,
  `静默返回 ${silentSites.length} 处(行 ${silentSites.map((i) => i + 1).join('/')}),无家可归 ${homeless.length} 处${
    homeless.length ? ':行 ' + homeless.map((i) => i + 1).join('/') : ''}`)

const ext2 = `gate-human-${RUN}`
await chat(ext2, '你们营业时间几点到几点?')
const conv = await (await fetch(`${BASE_URL}/admin/wechat/conversations`, { headers: { authorization: 'Bearer owner-demo-token' } })).json()
const c = (conv.conversations || []).find((x) => x.externalUserId === ext2)
await fetch(`${BASE_URL}/admin/wechat/conversations/${encodeURIComponent(c.id)}/take-over`,
  { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner-demo-token' }, body: '{}' })
const duringHuman = await chat(ext2, '你们营业时间几点到几点?')
check('③b 🔴 反向守:人工接管中(`human_active`)**必须静默** —— '
  + '一把「什么时候都答」的门跟没有人工接管一样',
  !duringHuman?.reply, `human_active 时 reply=${Boolean(duringHuman?.reply)}`)

/* ══ 判据 1 · 三档在代码里都有出口,且关键词表已降级为快速通道 ══

   🔴 **扫描面跟着文件走**(判据律「判据覆盖面本身要有判据」):
   门这一批从 `local-server.mjs` 搬进了 `apps/api/ai-gate.mjs`。若判据还盯着旧文件,
   代码一搬它就**照样绿而什么都没看** —— 这正是「路由搬进新模块、扫描器还读老文件」那条案底。
   所以下面先断言「门确实住在 ai-gate.mjs」并给**条数下限**,扫描面缩水立刻红。 */
const gateSrc = readFileSync(join(ROOT, 'apps/api/ai-gate.mjs'), 'utf8')
check('①⁰ 🔴 扫描面自检:门住在 `ai-gate.mjs`,且这份源码有料(不是空文件顶包)',
  gateSrc.length > 2000 && /export function createAiGate/.test(gateSrc), `ai-gate.mjs ${gateSrc.length} 字节`)
check('①⁰b 🔴 巨型文件里不许再留一份门 —— 两处真相必然漂(同族:一件事两处真相)',
  !/gate: 'ask_back'/.test(srv) && !/function shouldSilentHandoffBeforeAi/.test(srv),
  'local-server.mjs 里还留着门的实现')
/* ① 图 v1.2 把第 3 档拆成 3a/3b —— 判据锚 `tier` 字段,不锚文案。
   **两者的分界就是转不转人工**,所以这条断言必须把「3a 不转、3b 转」钉死:
   合成一档的后果 09-04 实测过 ——「你叫什么名字」被转人工,既打扰同事,
   又让顾客觉得问一句闲话就被推走了。 */
check('① 各档各有出口且 tier 标记齐:2 反问 / 3a 范围外**不转人工** / 3b 范围内不该答**转人工**',
  /tier: '2'/.test(gateSrc)
  && /handoffRequired: false, gate: 'out_of_scope', tier: '3a'/.test(gateSrc)
  && /handoffRequired: true, gate: 'needs_human_in_scope', tier: '3b'/.test(gateSrc), '')

/* ①a/①b 行为层:静态看得见写法,看不见它真跑成什么样 */
const ext3a = `gate-3a-${RUN}`
const r3a = await chat(ext3a, '宠物店在哪', { forceAi: true })
check('①a 🔴 3a 行为:范围外 → 有回复 · tier=3a · **不转人工**(转人工要占同事时间,顾客问宠物店转过去没有意义)',
  Boolean(r3a?.reply) && r3a.reply.data?.tier === '3a' && r3a.reply.data?.handoffRequired === false,
  `tier=${r3a?.reply?.data?.tier} handoff=${r3a?.reply?.data?.handoffRequired}`)
const ext3b = `gate-3b-${RUN}`
const r3b = await chat(ext3b, '我卡里还剩多少?', { forceAi: true })
check('①b 🔴 3b 行为:问自己账户余额 → 有回复 · tier=3b · **转人工**',
  Boolean(r3b?.reply) && r3b.reply.data?.tier === '3b' && r3b.reply.data?.handoffRequired === true,
  `tier=${r3b?.reply?.data?.tier} handoff=${r3b?.reply?.data?.handoffRequired}`)
/* ①c 反向守:政策类问法**不许**掉进 3b —— 「取消要提前多久」store facts 里有答案,该答 */
const extPol = `gate-pol-${RUN}`
const rPol = await chat(extPol, '取消要提前多久?', { forceAi: true })
check('①c 🔴 反向守:政策类(取消要提前多久)**不许**落 3b —— 分界是「政策 vs 动作」,不是关键词',
  rPol?.reply?.data?.tier !== '3b', `tier=${rPol?.reply?.data?.tier}`)

/* ①d 🔴 **模型明说范围外时,谁也不许盖过它**(05e 实测两处栽在这上面,详见回执 §五):
   · `Where is the pet store` 里有 `store` → 撞上关键词快速通道,`inScope` 被拉成 true,3a 轮不到;
   · `Book me a flight` → 规则层抢先接管,出了美甲预约收集表。
   两处都不是「模型判错了」,是**下游把模型判对的结果盖掉了**。
   这条判据守的是代码里那两行让位逻辑 —— 它们一旦被改回去,这里立刻红。 */
check('①d 🔴 模型显式 inScope=false 时,关键词快速通道与规则层接管**都要让位给 3a**',
  /const modelSaysOutOfScope = gate\.inScope === false/.test(gateSrc)
  && /if \(ruleTookOver && !modelSaysOutOfScope\) return null/.test(gateSrc)
  && /modelSaysOutOfScope \? false : \(keywordFastPath/.test(gateSrc), '')

check('①b 关键词表降级为**快速通道**:命中直接放行(省一次判断),没命中不再等于「不是业务」—— '
  + '旧门只在 `AI_GATE=keyword` 下才走(留着是为了两个数并排)',
  /keywordFastPath = aiGate\.hasCustomerServiceBusinessSignal/.test(srv)
  && /aiGate\.gateMode === 'keyword' && !bypassSilentHandoff/.test(srv), '')

check('①c 🔴 门与答**同一次请求**:`inScope/confidence/slots` 跟回复一起出,不多打一次模型',
  /inScope: true,/.test(readFileSync(join(ROOT, 'apps/api/ai-utils.mjs'), 'utf8'))
  && /confidence: 0\.0,/.test(readFileSync(join(ROOT, 'apps/api/ai-utils.mjs'), 'utf8')), '')

/* ①d 守卫本身:规则层接管的判断必须看 `source`,不能看 `quoteWorkflow.reply` 有没有值 */
check('①d 🔴 三档的守卫判的是「规则层**自己出了句子**」(有 `source`),不是「reply 有没有值」—— '
  + '`resolveQuoteWorkflow` 没接管时会把 baseReply **原样透传**,拿它当条件永远为真,三档一次都不会跑'
  + '(现测栽过一次:qwReply=true 而 source 为空)',
  (() => {
    /* ⚠️ 这条原来锚的是**一整串字面量**;05j 给 ③ 预约采集加了一个合法的接管方(`bookingStep`),
       表达式多了一层括号,判据就红了 —— 而它要守的那件事**一点没变**。
       判据律:不许锚在会变的字面量上。改成守语义,并且**顺手把坏形状显式禁掉**(比原来更严):
       ① `ruleTookOver` 这一行必须出现 `.source`;② 不许出现裸的 `Boolean(quoteWorkflow.reply)`。 */
    const line = srv.match(/ruleTookOver:[^\n]*/)?.[0] || ''
    return /quoteWorkflow\.reply\.source/.test(line)
      && !/Boolean\(\s*quoteWorkflow\.reply\s*\)/.test(line)
  })(), '')

console.log('\n[门+三档] 评测集在册 · D133 反面 · 只有 human_active 静默 · 三档各有出口 · 关键词降级为快速通道')
cleanupOwn()
if (fails.length) { console.error(`\n❌ test-ai-gate ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-ai-gate 通过 ${checks} 项`)
