#!/usr/bin/env node
/* 「**所有判据至少跑一遍演示门关掉的环境**」(店主 07g/夜10 段一①,2026-09-12)
 *
 * ══ 案由(D190,最贵的一课)══
 * 本机与沙箱都开着 `ALLOW_DEMO_ADMIN_LOGIN=true`,于是**所有顾客端判据都站在一扇
 * 生产上不存在的门后面测** —— 全绿,而生产上顾客一条能用的登录路都没有。
 * 绿得毫无道理:不是代码对,是**判据从来没在那个环境里跑过**。
 *
 * ══ 这把刀守什么 ══
 * 守「**那一档有没有真跑**」,不是守「那一档绿不绿」——
 * 那一档现在就会红一片,**红是真相**,不许为了绿去松门槛(店主令里写死)。
 *
 * 两层:
 *   ① **静态**:回归脚本必须声明 `DEMO_GATE_MODES` 含 `false`,且顾客端清单非空、只许变长;
 *   ② **运行时**:回归跑完会写下它**实际跑过哪几档**;两档都在才算数。
 *      (只验声明 = 验中间产物;只验运行时 = 没跑过的时候看不出是漏了还是没跑。两层都要。)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const runner = readFileSync(join(ROOT, 'apps/api/run-all-tests.sh'), 'utf8')
const modes = (runner.match(/DEMO_GATE_MODES="\$\{DEMO_GATE_MODES:-([^"}]+)\}"/) || [])[1] || ''
const suites = ((runner.match(/DEMO_GATE_SUITES="([^"]+)"/) || [])[1] || '').trim().split(/\s+/).filter(Boolean)
const SUITE_MIN = 8   /* 只许变长(判据三推论:覆盖面本身要有判据) */

/* ═══ 🔴 裁 #72:门关档**只跑 8 套 = 「不是绿,是没扫」** ═══
   令里写的是「顾客端相关判据在这一档下**必须全部跑一遍**」—— 8/115 不是「全部」。
   店主的话:**这 8 套之外的那些,在生产口径下是「没跑」,不是「没红」。**

   所以「该跑哪些」**不许我手列**,要由判据**按机制算**(J-51:选择口径要具名冻结):
     该跑 = 源码里出现顾客侧取/用 token 的形态(AUTH)
            **且** 它真的起服务打接口(LIVE)
     纯静态判据只是**提到**那些字样(扫描类的刀),不取 token —— 具名排除,写理由。
   三个数分开报(J-48:**不许混进同一个数**):该跑 / 跑了 / 该跑没跑。 */
/* 🔴 09-14 补正门形态(夜11 段B):原来这串**只认演示/邮箱登录**那几种写法。
   后果很反直觉 —— 我们正在做的事(裁 #60:把夹具一套套改成走微信正门)每推进一套,
   那一套就从「该跑」名单里**掉出去一个**,覆盖数一路变小,而判据全程绿。
   「判据的覆盖面本身要有判据」说的就是这个。补上 `/auth/wechat/mini-` 与 `ViaFrontDoor`
   之后:该跑 12 → 13(新认出来的是 mini-phone),该跑没跑仍是 0。 */
const AUTH_PAT = /\/auth\/email\/(login|register)|demoLogin|demo-cust|customerToken|requireCustomer|\/my\/|\/auth\/wechat\/mini-|ViaFrontDoor/
const LIVE_PAT = /BASE_URL|TEST_BASE_URL|await fetch\(/
/* 排除自己:本文件里就写着那些形态串(AUTH_PAT/LIVE_PAT 的字面量),不排掉会扫到自己 */
const allSuites = readdirSync(join(ROOT, 'apps/api'))
  .filter((b) => /^test-.*\.mjs$/.test(b) && b !== 'test-demo-gate-coverage.mjs')
const nameOf = (b) => b.replace(/^test-|\.mjs$/g, '')
const SHOULD = []
const STATIC_ONLY = []
for (const b of allSuites) {
  const src = readFileSync(join(ROOT, 'apps/api', b), 'utf8')
  if (!AUTH_PAT.test(src)) continue
  ;(LIVE_PAT.test(src) ? SHOULD : STATIC_ONLY).push(nameOf(b))
}
/* 具名排除:每一条写清**为什么它不该进这一档**。
   「它压根不碰顾客登录态/不取 token」是理由;「跑起来太慢」不是(店主 07h 明令)。 */
const GATE_EXCLUDE = {
  'credential-scan': '纯静态判据:扫源码里的凭据形态,**不起服务、不取 token**;它提到那些字样是因为它在扫它们',
  'frontend-routes': '纯静态判据:前端路径 vs 后端路由对表,**不起服务**',
  'login-entries': '纯静态判据:读 customer.js 的登录区源码,**不起服务**',
  'demo-mark': '纯静态判据:扫演示数据标记,**不起服务、不取 token**',
}
const GATE_EXCLUDE_CAP = 4   /* 只许变短(J-51) */

const shouldRun = SHOULD.filter((n) => !GATE_EXCLUDE[n])
const ran = suites
const didRun = shouldRun.filter((n) => ran.includes(n))
const notRun = shouldRun.filter((n) => !ran.includes(n))
const extra = ran.filter((n) => !shouldRun.includes(n))

check(`①a 🔴 底数闭合(J-48,三个数分开):**该跑 ${shouldRun.length} 套 · 跑了 ${didRun.length} 套 · 该跑没跑 ${notRun.length} 套**`
  + ` —— 没跑的是「没扫」,不是「没红」${notRun.length ? `:${notRun.join(' ')}` : ''}`,
notRun.length === 0, notRun.join(' '))

check(`①b 选择口径**具名冻结**:纯静态、不取 token 的 ${Object.keys(GATE_EXCLUDE).length} 套逐条写了理由`
  + `(<= ${GATE_EXCLUDE_CAP},只许变短);「跑起来太慢」不算理由`,
  Object.keys(GATE_EXCLUDE).length <= GATE_EXCLUDE_CAP
  && Object.values(GATE_EXCLUDE).every((v) => /不起服务|不取 token/.test(v) && String(v).length > 15),
  Object.keys(GATE_EXCLUDE).join(' '))

check(`①c 反向守:机制算出来的「碰登录态」共 ${SHOULD.length + STATIC_ONLY.length} 套(其中纯静态 ${STATIC_ONLY.length})`
  + ' —— 算成 0 说明口径瞎了,这条判据在空转(J-58)',
(SHOULD.length + STATIC_ONLY.length) >= 10, `${SHOULD.length}/${STATIC_ONLY.length}`)

/* ①d 造病(店主点名):把一套明明碰登录态的挪出名单 → 必须红在「该跑没跑」上 */
const probeRan = ran.filter((n) => n !== 'auth-surface')
const probeNotRun = shouldRun.filter((n) => !probeRan.includes(n))
check('①d 造病:把 `auth-surface`(明明碰登录态)挪出名单 → 「该跑没跑」必须当场把它点出来',
  probeNotRun.includes('auth-surface'), JSON.stringify(probeNotRun))

/* ①i 造病(09-14 立):**只走微信正门**的夹具必须被认成「该跑」——
   这条是上面那个盲区的看守。构造一段只有正门形态的源码,机制必须认得出它。 */
const frontDoorProbe = "const r = await fetch(`${BASE}/auth/wechat/mini-login`, { method: 'POST' })"
const legacyProbe = "const r = await fetch(`${BASE}/health`)"
check('①i 🔴 造病:一套**只走微信正门**(没有任何演示/邮箱登录形态)的夹具,机制必须认成「该跑」—— '
  + '不认的话,「改走正门」这件事每做一套就悄悄少扫一套(旧口径 12 → 补上正门形态后 13)',
  AUTH_PAT.test(frontDoorProbe) && LIVE_PAT.test(frontDoorProbe) && !AUTH_PAT.test(legacyProbe),
  `正门=${AUTH_PAT.test(frontDoorProbe)} 反向(无登录形态)=${!AUTH_PAT.test(legacyProbe)}`)

console.log(`   [多跑] 名单里但不在机制判据内的 ${extra.length} 套(多跑不算错,如实列):${extra.join(' ') || '无'}`)

/* ═══ 🔴 裁 #85:「夹具只留一条路」**不许靠红来发现** ═══
   店主点破的:第 7 套走着旧路,**而且门关档里不会红** —— 靠「门关档会红」来发现旧路,
   是一把**只能抓到一半**的刀(抓不到那些不在名单里、或压根不取 token 的)。
   所以改成**白名单式**:算出来,不等它红。

   ⚠️ 口径要认「**真的调它**」,不认「提及」——
   `login-entries` 把 `/auth/email/register` 当**数据**写在它的入口映射表里(那正是它的工作:
   枚举登录入口并检查每个通不通);`customer-profile`/`stored-value` 里那一处是**我自己的注释**。
   我上一轮报的「7 套」就是按「文件里出现这个串」数的 —— **那个数的口径本身就松**。 */
const OLD_DOOR_CALL = /(?:request|jreq|fetch|api)\w*\(\s*[`'"][^`'"]*\/auth\/email\/(register|login)/
/* 排除自己:①h 的探针字符串里就写着那一行真调用的样子 */
const suiteFiles = readdirSync(join(ROOT, 'apps/api')).filter((b) => /^test-.*\.mjs$/.test(b) && b !== 'test-demo-gate-coverage.mjs')
const callsOldDoor = suiteFiles.filter((b) => readFileSync(join(ROOT, 'apps/api', b), 'utf8').split('\n')
  .some((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln) && OLD_DOOR_CALL.test(ln))).map((b) => b.replace(/^test-|\.mjs$/g, ''))

/* 具名冻结(J-51):还没转正门的,逐条列名。**只许变短** —— 转一套删一条,归零即清账。 */
const OLD_DOOR_FROZEN = {
  'booking-intake': '未转:日班令2 段A 剩余,排队中',
  'card-refund': '未转:它还要按裁 #83 三条硬条件重排(开关是被测对象那一格),连同一起做',
  'deposit-config': '未转:日班令2 段A 剩余,排队中',
  'identity-links': '未转:日班令2 段A 剩余,排队中',
  'schedule-v2': '未转:它是员工端那三套之一,连同员工正门夹具一起转',
}
const OLD_DOOR_CAP = 5
const oldDoorBad = callsOldDoor.filter((n) => !OLD_DOOR_FROZEN[n])
check(`①e 🔴 白名单式(不靠红发现):**真调用**旧路(\`/auth/email/register|login\`)的套件 ${callsOldDoor.length} 个,`
  + `逐个落进具名冻结;新出现一个当场红点名`,
oldDoorBad.length === 0, oldDoorBad.join(' '))
check(`①f 冻结清单**只许变短**:${Object.keys(OLD_DOOR_FROZEN).length} 条 <= ${OLD_DOOR_CAP};`
  + '每条写明为什么还没转 —— 归零那天就是「夹具只留一条路」真做到那天',
  Object.keys(OLD_DOOR_FROZEN).length <= OLD_DOOR_CAP
  && Object.values(OLD_DOOR_FROZEN).every((v) => String(v).length > 6), '')

/* ①g 夹具建顾客的出口:全仓只许 1 处 */
const fixtureExits = readdirSync(join(ROOT, 'apps/api'))
  .filter((b) => b.endsWith('.mjs'))
  .filter((b) => /export (async )?function loginCustomerViaFrontDoor/.test(readFileSync(join(ROOT, 'apps/api', b), 'utf8')))
check(`①g 夹具建顾客的**出口全仓只许 1 处**(现测 ${fixtureExits.length}:${fixtureExits.join(' ')})`
  + ' —— 两处出口就是两条路,分叉会藏在参数顺序里(07d 栽过)',
fixtureExits.length === 1, fixtureExits.join(' '))

/* ①h 自守:构造一行「真调用旧路」,必须被认出来;构造一行「只是提及」,不许被认出来 */
const probeCall = "  const reg = await request('/auth/email/register', { method: 'POST' })"
const probeMention = "  /* 原来用 /auth/email/register —— 已换正门 */"
check('①h 自守:**真调用**那一行必须被认出来,**注释里提及**那一行不许被认出来'
  + '(认调用不认提及 —— 否则我自己的注释会把判据顶红)',
OLD_DOOR_CALL.test(probeCall) && !OLD_DOOR_CALL.test(probeMention), '')

check('① 回归脚本声明了**演示门关掉**那一档(`DEMO_GATE_MODES` 里有 `false`)—— '
  + '去掉它就是「少跑了一档」,这一条当场红',
/\bfalse\b/.test(modes), `现读 DEMO_GATE_MODES="${modes}"`)

check(`② 那一档要跑的顾客端判据清单 ${suites.length} 条 >= ${SUITE_MIN}(**只许变长**):`
  + `${suites.slice(0, 4).join(' ')}…`,
suites.length >= SUITE_MIN, suites.join(' '))

check('③ 那一档起的是**不设 `ALLOW_DEMO_ADMIN_LOGIN`** 的实例,并且**当场自证门真关着**'
  + '(读它自己的 `/health` 的 `guestIdUnsigned`,不是靠「我以为我没设」)',
  /env -u ALLOW_DEMO_ADMIN_LOGIN/.test(runner) && /guestIdUnsigned/.test(runner)
  && /这一档白跑了/.test(runner), '')

check('④ 那一档的红**单独列、不并进主档** —— 它现在就会红一片,那是真相,'
  + '不许为了绿去松门槛(店主令里写死的那句写在脚本注释里)',
  /不许为了绿去松门槛|不许为了让它变绿/.test(runner) && /门关档小结/.test(runner), '')

/* ⑤ 运行时那一半**不住在这里** —— 记下为什么(我造过一次死锁):
   这支套件跑在**主档**里,而写「实际跑过哪几档」那份记录的是**门关那一档**,它排在主档之后。
   把运行时断言放在这里 ⇒ 第一轮必红 ⇒ 套件退 1 ⇒ 回归中止 ⇒ 门关那一档**永远跑不到** ⇒
   记录永远不会有 —— **自己把自己锁死了**。
   正确落点是回归**收尾自证**(两档都跑完之后),与「4128/4310 还回去了没有」同一处。
   见 `apps/api/run-all-tests.sh` 末尾「[收尾自证] 演示门那两档」那一段。
   这支套件只守**声明**那一层:少声明一档,①当场红。 */

/* ⑥ 自守:把 false 从声明里拿掉,必须被 ① 咬到 */
const probe = 'DEMO_GATE_MODES="${DEMO_GATE_MODES:-true}"'
const probeModes = (probe.match(/DEMO_GATE_MODES="\$\{DEMO_GATE_MODES:-([^"}]+)\}"/) || [])[1] || ''
check('⑥ 自守:构造一份「只剩 true」的声明,①那条**必须**认出它少了一档',
  !/\bfalse\b/.test(probeModes), `probe="${probeModes}"`)

console.log(`\n[底数闭合] 声明的档 [${modes}] · 那一档要跑的顾客端判据 ${suites.length} 条`
  + ' · 运行时那一半在回归收尾自证里(见本文件 ⑤ 那段注释)')
if (fails.length) { console.error(`\n❌ test-demo-gate-coverage ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-demo-gate-coverage 通过 ${checks} 项`)
