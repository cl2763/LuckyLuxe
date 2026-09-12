/* 凭据形态刀(D123,店主 03g/03i/03j 裁定,2026-09-02 落)

   案由:一枚**活的**会话令牌硬编码在 tools/sim/ 八个文件、随 6 次提交进了历史;
   同族扫又在交接文档里咬出两个真账号密码(其中一个是店主级)。
   定性是纪律事故不是泄露事故 —— 但「凭据不入库」看形态不看后果。

   ══ 三条钉死的原则(店主定)══
   ① **扫描面 = `git ls-files` 全量**,不分代码/文档/日志。
      想排除任何目录,走白名单逐条写理由,**不许在扫描面定义里直接减**。
   ② **刀认形态,人认活性。** 刀只判 tracked 文件里有没有凭据形态的字面量;
      活不活、要不要作废,是刀红了之后**人的处置分支**,不进判据。
      **「这个号已经不存在」永远不是豁免理由** —— 死号的密码照样会被复用,读者也分不清死活。
   ③ **零命中先证刀能咬**(店主 03j 立律):扫描类判据报零,必须先咬到一个已知阳性才算数。
      所以本刀自带三个**明示为假**的自守用例;咬不到它们,刀红。

   ══ 白名单 ══
   每条理由随码。负向测试的伪造值,理由**必须指向那条负向断言的行号** ——
   豁免的是「验它该被拒」这个用途,不是那串字符;字符换了地方用,豁免失效。 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* 凭据形态(三类)。认形态,不认具体值 —— 值会变,形态不会。 */
const SHAPES = {
  会话令牌: /sess_[a-z0-9]{6,}_[a-z0-9]{5,}_[a-z0-9]{6,}/g,
  密码赋值: /\b(password|passwd|pwd|secret|apikey|api_key)\b\s*[:=]\s*['"]([^'"\s]{6,})['"]/gi,
  Bearer字面量: /Bearer\s+['"]?([A-Za-z0-9_\-]{12,})/g,
  /* 🔴 落刀首跑现测:这条不带语境时捞出 11,310 处,前十全是**路径**(admin/… api/… pages/…)——
     「a/b」这个形状在代码库里就是路径的形状。凭据的分辨点不在形状,在**它出现在什么语境里**:
     同一行里得有「密码/凭据/登录/password」这类词。收窄后再看数。 */
  /* 🔴 两轮收窄的记录(判据校准靠已知阳性,不靠感觉):
     ① 不带语境:11,310 处,前十全是**路径**(admin/… api/… pages/…)——「a/b」在代码库里就是路径的形状;
     ② 语境放宽到同行 40 字内:43 处,逐条人读后 28/29 个值仍是**路径与接口名**
        (`/admin/stored-value/txns`、`/admin/auth/change-password`、`openid/unionid`…)——
        语境词离得远,句子里只要出现「登录」「密码」两字就把整行的路径捞了进来。
     ③ 现在:要求账号密码对**紧邻**密码词(中间不超过 12 字、且不含 `/` 与空格),
        并排除左侧是已知路径段的情况。真凭据长的是「凭据(a/b)」这个样子,不是「GET /admin/x/y」。 */
  账号密码对: /(?:密码|凭据|口令)[^\n\/\s]{0,12}?[((]?\b([a-z][a-z0-9_-]{2,})\/([A-Za-z0-9!@#$%^&*_.-]{6,})\b/gi,
  /* 🔴 04a §四 前置(店主点名):**env 文件那一行的形态** —— `AI_API_KEY=sk-…`。
     上面「密码赋值」那条要求带引号、且 `\bAPI_KEY\b` 在 `AI_API_KEY` 里因为前面是下划线而不成立,
     所以整整一类 `.env` 形态原来一处都咬不到。AI 复测要往仓边上放一个只装钥匙的 env 文件,
     这一类必须先能被咬住 —— 万一哪天有人把它 `git add` 了,是这把刀拦下来。 */
  env钥匙行: /^[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*\s*=\s*['"]?([A-Za-z0-9_-]{12,})['"]?\s*$/gm,
}

/* 白名单:key = `文件:命中值`,value = 理由(随码复核) */
const ALLOW = {
  'owner-demo-token': '明示演示主钥匙:服务启动日志公开打印它,文档与测试引用的就是这一个',
  'LuckyluxeStaff0312': '`STAFF_DEMO_PASSWORD` 的默认值。'
    + '该口令闸整个包在 `if (!DEMO_LOGIN_ALLOWED) throw 403`(local-server.mjs:11215)之内;'
    + '2026-09-03 生产只读核实:`ALLOW_DEMO_ADMIN_LOGIN` 未设 → 请求在比对口令**之前**即被 403 挡下。'
    + '**惰性成立的前提 = 生产永不设该 env**;这条前提由上线硬门槛批的「生产 env 核验清单」守(店主 03w 裁)',
  'demo-customer': '负向断言的伪造令牌:test-card-refund.mjs:772「伪造 customer 令牌必须被拒」——'
    + '豁免的是这条断言的用途,不是这串字符;换地方用则豁免失效',
  'not-the-key': '负向断言的错误平台钥匙:test-demo-seed-guard.mjs:230「错钥匙不许放行」',
  'abcd1234': '财务锁测试夹具口令:test-backend-gate.mjs:101 用它建锁再验解锁',
  'Fin-2026-n5': '财务密码测试夹具:test-card-refund.mjs:420 设密码再验门禁',
  'Hop2026demo#1': '脚本自建演示店的老板密码:tools/sim/r6_samples.mjs 同文件当场 change-password 设的,不是既有账号的密码',
  'Password': '误报:登录表单的**字段标签**(i18n 文案 admin.js/customer.js),不是密码',
  'hidePwd': '误报:wxml <input password="{{hidePwd}}"> 的属性绑定,不是密码',
  'fin0000': '财务锁测试夹具口令:test-finance-lock.mjs 用它开锁/改密/验旧密作废(负向断言同文件),不是任何真账号的密码',
  'fin1234': '财务锁测试夹具口令:test-finance-lock.mjs 用它开锁/改密/验旧密作废(负向断言同文件),不是任何真账号的密码',
  'fin5678': '财务锁测试夹具口令:test-finance-lock.mjs 用它开锁/改密/验旧密作废(负向断言同文件),不是任何真账号的密码',
  '{{hidePwd}}': '误报:wxml <input password="{{...}}"> 的属性绑定,不是密码值',
}
const ALLOW_CAP = 13   /* 店主 03m:棘轮不许留空隙 —— 上限=实际条数 */

/* 自守用例:三个**明示为假**的已知阳性。刀咬不到它们 = 刀是废的(店主 03j 律) */
const CANARY = [
  /* 用例必须与真值**同形态**(真值是纯小写数字)。明示为假靠的是它的语义(canary/fake),
     不是靠大写字母 —— 首跑就栽在这里:用例含大写,正则 [a-z0-9] 吃不下,自守自己没咬到。 */
  { what: '会话令牌', text: "const T = 'sess_fakecanary_zz9zz9_deadbeef'" },
  { what: '密码赋值', text: "login({ password: 'CANARY-not-a-real-pw' })" },
  { what: '账号密码对', text: '本地测试凭据(canaryuser/CanaryFake123)授权自动化' },
  /* 04a:env 文件那一行(店主点名)。值是明示为假的 canary,形态与真钥匙同形。 */
  { what: 'env钥匙行', text: 'AI_API_KEY=sk-canaryfake0000000000notreal' },
]

const files = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)

const hits = []
for (const f of files) {
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  if (src.includes('\0')) continue                       // 二进制跳过
  for (const [shape, rx] of Object.entries(SHAPES)) {
    rx.lastIndex = 0
    for (const m of src.matchAll(rx)) {
      const val = m[2] || m[1] || m[0]
      const line = src.slice(0, m.index).split('\n').length
      hits.push({ file: f, line, shape, val })
    }
  }
}
/* 本刀自己的白名单理由与自守用例必然含凭据形态 —— 自指,排除自身 */
const real = hits.filter((h) => h.file !== 'apps/api/test-credential-scan.mjs')
const bad = real.filter((h) => !ALLOW[h.val] && !/见 handoff\/本地自查账号|指针|<见/.test(h.val))

check(`① 凭据形态零入库:扫描面 ${files.length} 个 tracked 文件(git ls-files 全量,含文档与日志),`
  + `命中 ${real.length} 处,每处必须落进白名单(刀认形态,人认活性;"号已不存在"不是豁免理由)`,
  bad.length === 0, `${bad.length} 处未登记:${bad.slice(0, 8).map((h) => `${h.file}:${h.line}[${h.shape}]`).join(' | ')}`)

check(`①b 白名单棘轮 ≤ ${ALLOW_CAP}(只减不增;每条理由随码,负向测试类须指向断言行号)`,
  Object.keys(ALLOW).length <= ALLOW_CAP, String(Object.keys(ALLOW).length))

/* ② 自守:三个明示为假的已知阳性必须被咬到 —— 零命中先证刀能咬 */
const missed = CANARY.filter((c) => {
  const rx = SHAPES[c.what]; rx.lastIndex = 0
  return !rx.test(c.text)
})
check('② 🔴 零命中先证刀能咬:四个明示为假的已知阳性(会话令牌/密码赋值/账号密码对/**env 钥匙行**)必须全被咬中',
  missed.length === 0, `咬不到:${missed.map((c) => c.what).join(' | ')}`)

/* ③ 反向守:扫描面没缩水(判据覆盖面要有判据) */
check(`③ 反向守:扫描面 ${files.length} >= 1100 个 tracked 文件(目录被排除/仓库被裁时立刻红)`,
  files.length >= 1100, String(files.length))

const byShape = real.reduce((a, h) => { a[h.shape] = (a[h.shape] || 0) + 1; return a }, {})
/* ④h 同类扫尽(07c 裁 #54 落地时咬出来的):**凡自己 spawn 一台 local-server 的夹具**,
   它给的 `DATA_DIR` 必须落在 `ci` / `sandbox` 库域,或者**显式带一把测试密钥** ——
   否则 J-53 的闸会把它拦在门外,而现象是「30 秒内没起来」,看着像超时,其实是拒绝启动。
   现查踩到两处:`test-card-refund`(故意起生产模式 → 给显式密钥)、
   `test-schema-consistency`(临时目录叫 `ll-schema-` → 改名 `ll-ci-data.schema-`,本来就是回归临时库)。
   判法:找 `mkdtempSync(..., '<前缀>')` 与同一文件里的 spawn local-server —— 前缀必须是
   `ll-ci-data.`,或者那段上下文里带 `WECHAT_MINI_TOKEN_SECRET`。 */
/* 排除自己:本文件的注释与夹具里就写着这些前缀(这一批第 N 次踩自扫) */
const spawnFiles = readdirSync(join(ROOT, 'apps/api'))
  .filter((b) => /^test-.*\.mjs$/.test(b) && b !== 'test-credential-scan.mjs').map((b) => `apps/api/${b}`)
const spawnBad = []
for (const f of spawnFiles) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  if (!/local-server\.mjs/.test(src) || !/spawn/.test(src)) continue
  /* 🔴 头一版写的是 `mkdtempSync\([^)]*?['"]…` —— `[^)]` **跨不过 `tmpdir()` 那个右括号**,
     而真实写法就是 `mkdtempSync(join(tmpdir(), '前缀'))`,于是一处都匹配不到,判据**空转报绿**。
     造病刀(把前缀改回 `ll-schema-`)当场咬出来:该红没红 = 判据是废的,不是代码干净。 */
  for (const m of src.matchAll(/mkdtempSync\([\s\S]{0,90}?['"]([^'"]+)['"]\s*\)/g)) {
    const pre = m[1]
    if (pre.startsWith('ll-ci-data.')) continue
    const near = src.slice(Math.max(0, m.index - 600), m.index + 1400)
    /* 「带密钥」要认**真的赋值**,不能被 `delete env.WECHAT_MINI_TOKEN_SECRET` 那种写法蒙混过去 */
    if (/WECHAT_MINI_TOKEN_SECRET\s*:/.test(near)) continue
    /* 夹具自己在临时目录里再造 `local-data` / `sandbox-data` 子目录的(J-53 那块就是),
       真正决定库域的是子目录名,不是这个前缀 —— 放行,并要求它确实建了那两个名字 */
    if (/['"`]local-data['"`]|['"`]sandbox-data['"`]/.test(near)) continue
    spawnBad.push(`${f} 临时目录前缀 '${pre}'`)
  }
}
check('④h 同类扫尽:自己起 local-server 的夹具,临时库要么用 `ll-ci-data.` 前缀(⇒ci 库域),'
  + '要么显式带测试密钥 —— 否则 J-53 的闸会把它拦掉,而现象是「没起来」不是「被拒」',
spawnBad.length === 0, spawnBad.join(' | '))

console.log(`\n[凭据形态] tracked ${files.length} 个 · 命中 ${real.length} 处 · 白名单 ${Object.keys(ALLOW).length} 条`)

/* ═══ ④ J-53:**密钥类常量不许回落到字面量**(店主 07c 裁 #54 立)═══

   ══ 案由 ══
   `local-server.mjs:391` 原来是一条五段回落链,末端是写在仓库里的字面量:
     `WECHAT_MINI_TOKEN_SECRET || WX_MINI_TOKEN_SECRET || WECHAT_MINI_SECRET || OWNER_TOKEN || 'luckyluxe-mini-dev'`
   走一遍:生产两个变量没设 → AppSecret 是 `''` → 落到 `OWNER_TOKEN` → 它自己也没设
   → **落到 `'owner-demo-token'`**。**「服务端签发」签的是一把谁都知道的钥匙。**

   ══ 这一条与上面①②③的区别(类按机制定义,不按长相)══
   ①②③ 认的是「**文件里出现了一串长得像凭据的字符**」;
   ④ 认的是「**一个密钥常量的解析链末端是固定字面量**」——
   同一串字符在 ① 里可能被豁免(它是明示演示钥匙),在 ④ 里照样要问「**它当不当密钥用**」。
   两件事,两把尺子。

   ══ 判据形态(判据三:白名单 > 黑名单)══
   不是「列出已知的几个密钥去检查」,而是**全仓服务端模块现扫**,
   **每一处命中都必须落进具名白名单**(带理由 + 条数上限),新写一处自动红。
   收窄靠**机制**不靠长相:
     · 名字必须是 SCREAMING_CASE 且含 SECRET/TOKEN/PASSWORD/CREDENTIAL/API_KEY/_KEY;
     · 末段必须是**单双引号的固定字面量** —— 模板串(含 `${}`)是**算出来的键**,
       定义上就不是固定密钥(`objectKey` / `keyTime` / 缓存键那一片全在这里被排除)。 */
const credFiles = () => {
  const out = []
  for (const d of ['apps/api', 'tools']) {
    for (const b of readdirSync(join(ROOT, d))) {
      if (!b.endsWith('.mjs')) continue
      if (d === 'apps/api' && /^(test-|run-|probe-|e2e-)/.test(b)) continue
      out.push(`${d}/${b}`)
    }
  }
  return out
}
const CRED_NAME = /^[A-Z][A-Z0-9_]*$/
const CRED_WORD = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|_KEY$)/
const scanCredDefaults = (lines, file = '') => {
  const hits = []
  lines.forEach((ln, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return
    const m = ln.match(/(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/)
    if (!m) return
    const name = m[1]
    if (!CRED_NAME.test(name) || !CRED_WORD.test(name)) return
    const tail = m[2].split('||').pop().trim()
    const lit = tail.match(/^(['"])([^'"]*)\1/)
    if (lit && lit[2].length > 0 && !/\$\{/.test(lit[2])) hits.push({ file, line: i + 1, name, lit: lit[2] })
  })
  return hits
}

/* 具名白名单:key = `文件:常量名`,value = 理由(随码复核)。**只许变短。** */
const CRED_DEFAULT_ALLOW = {
  /* —— 不是密钥,是「名字里带 KEY/TOKEN」的东西 —— */
  'apps/api/dashboard-pulse.mjs:AI_LINE_KEY': '不是密钥:库里一行记录的**键名**(`ai_daily_line`),公开常量',
  'apps/api/ledger-guards.mjs:KIND_BACKFILL_KEY': '不是密钥:一次性迁移的**标记名**,靠它判「跑过没有」(幂等判据律)',
  'apps/api/legacy-demo-retire.mjs:DEMO_RETIRE_KEY': '不是密钥:一次性下线脚本的**标记名**(`demo_retire_backfill_v1`),同样是拿来判「跑过没有」的',
  'apps/api/web-head.mjs:TOKEN_HREF': '不是密钥:设计令牌 **CSS 的路径**(`/web/design-tokens.css`)',
  /* —— 是凭据,但有明写的闸 —— */
  'apps/api/mini-token-secret.mjs:DEV_ONLY_SECRET': '**J-53 的开发值本身**:只在 `ci`/`sandbox` 两个库域可达'
    + '(`DEV_SCOPES`),名字自带「NOT-A-SECRET」。它存在的理由就是让回归与沙箱不必配密钥;'
    + '`local`/`production`/`unknown` 拿不到它 —— 由本文件 ④c/④d 与 test-auth-surface ㊙⑪ 守',
  'apps/api/local-server.mjs:STAFF_DEMO_PASSWORD': '演示员工口令:整个包在 `if (!DEMO_LOGIN_ALLOWED) throw 403` 之内;'
    + '与上面 ALLOW 里那条同一个理由,前提是「生产永不设 ALLOW_DEMO_ADMIN_LOGIN」,由上线硬门槛守',
  /* —— 客户端拿演示主钥匙:它们是**发请求的一方**,不是签发的一方 —— */
  'tools/configure-jienail.mjs:OWNER_TOKEN': '客户端脚本:拿演示主钥匙当 Bearer 发请求,不是签发密钥',
  'tools/seed-jics-nail.mjs:OWNER_TOKEN': '客户端脚本:`tools/seed-jics-nail.mjs` 拿演示主钥匙当 Bearer 去调本机接口,它是**发请求的一方**,不签发任何令牌',
  'tools/seed-luvia-bj.mjs:OWNER_TOKEN': '客户端脚本:`tools/seed-luvia-bj.mjs` 拿演示主钥匙当 Bearer 去调本机接口,它是**发请求的一方**,不签发任何令牌',
  'tools/verify-jics-kb.mjs:OWNER_TOKEN': '客户端脚本:`tools/verify-jics-kb.mjs` 拿演示主钥匙当 Bearer 去调本机接口,它是**发请求的一方**,不签发任何令牌',
  'tools/seed-demo-today.mjs:TOKEN': '客户端脚本:铺演示数据时拿演示主钥匙当 Bearer,**发请求的一方**,不签发任何令牌',
  /* —— 🔴 同病未治,已报店主等裁 —— */
  'apps/api/local-server.mjs:OWNER_TOKEN': '🔴 **同一个病,本批没治,已在回执里点名请裁**:'
    + '平台最高信任根 `OWNER_TOKEN` 自己也回落到字面量 `owner-demo-token`。'
    + '按 J-53 它该跟顾客令牌密钥一样 fail closed;**没有当批就改,是因为全仓 90+ 个测试与工具'
    + '把这串值当管理员 Bearer 在用**,一改全红,且会让店主本机 4128 也起不来 —— '
    + '这属于「修复会改业务口径」那一类,按纪律**先报不自己判**。豁免有效期 = 到店主裁为止',
}
const CRED_DEFAULT_CAP = 12   /* 上限 = 实际条数,不留空隙(店主 03m) */

const credHits = credFiles().flatMap((f) => scanCredDefaults(readFileSync(join(ROOT, f), 'utf8').split('\n'), f))
const credBad = credHits.filter((h) => !CRED_DEFAULT_ALLOW[`${h.file}:${h.name}`])
check(`④a J-53:${credFiles().length} 个服务端模块现扫,「密钥类常量回落到固定字面量」`
  + `${credHits.length} 处**逐个落进具名白名单**(白名单式;新写一处当场红点名)`,
credBad.length === 0, credBad.map((h) => `${h.file}:${h.line} ${h.name}`).join(' | '))
check(`④b 白名单只许变短:${Object.keys(CRED_DEFAULT_ALLOW).length} 条 <= 上限 ${CRED_DEFAULT_CAP};每条都有理由`,
  Object.keys(CRED_DEFAULT_ALLOW).length <= CRED_DEFAULT_CAP
  && Object.values(CRED_DEFAULT_ALLOW).every((v) => String(v).length > 12),
  `${Object.keys(CRED_DEFAULT_ALLOW).length} 条`)
/* ④c 自守(本文件律③:零命中先证刀能咬)—— 造一行**真会发生的**违规 */
const credCanary = scanCredDefaults([
  "const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'pay-dev-secret'",
], 'canary.mjs')
check('④c 自守:构造一行「新密钥常量回落到字面量」**必须被咬到**(咬不到说明这把刀是废的)',
  credCanary.length === 1 && credCanary[0].name === 'PAYMENT_WEBHOOK_SECRET', JSON.stringify(credCanary))
/* ④d 反向守:算出来的键**不许**被当成密钥(否则白名单会被误报塞满,真的那条就埋没了) */
const credNeg = scanCredDefaults([
  'const objectKey = `settlements/${tenantId}/${code}.svg`',
  "const AI_LINE_KEY = 'ai_daily_line'",                       // 在白名单里,但这里验的是它确实被扫到
  'const KEY_TIME = `${now - 60};${now + 900}`',
], 'neg.mjs')
check('④d 反向守:模板串算出来的键(`objectKey` / `KEY_TIME`)**不许**被认成密钥 —— 只剩那个固定字面量的',
  credNeg.length === 1 && credNeg[0].name === 'AI_LINE_KEY', JSON.stringify(credNeg.map((h) => h.name)))

/* ④e/④f 口径单测:密钥解析器本身按**库域**判,不按 NODE_ENV(接 06h 裁 #37) */
const { resolveMiniTokenSecret, DEV_ONLY_SECRET } = await import('./mini-token-secret.mjs')
const devScopes = ['ci', 'sandbox'].map((s) => resolveMiniTokenSecret({ env: {}, scopeName: s }))
const hardScopes = ['local', 'production', 'unknown'].map((s) => resolveMiniTokenSecret({ env: {}, scopeName: s }))
check('④e 口径②:没显式设密钥时,只有 `ci`/`sandbox` 拿得到开发值;'
  + '`local`/`production`/`unknown` **一律 ok=false**(拿不到就拒绝启动,不换个值继续跑)',
devScopes.every((r) => r.ok && r.secret === DEV_ONLY_SECRET) && hardScopes.every((r) => !r.ok && r.secret === ''),
JSON.stringify([devScopes.map((r) => r.ok), hardScopes.map((r) => r.ok)]))
check('④f 口径③:显式设了、但设成跟 `OWNER_TOKEN` 一样 —— **照样拒绝**(密钥不复用);'
  + '设成别的值则放行',
  resolveMiniTokenSecret({ env: { WECHAT_MINI_TOKEN_SECRET: 'same' }, scopeName: 'production', ownerToken: 'same' }).ok === false
  && resolveMiniTokenSecret({ env: { WECHAT_MINI_TOKEN_SECRET: 'other' }, scopeName: 'production', ownerToken: 'same' }).ok === true,
  '')
check('④g 反向守:拒绝启动那段话里**一个字都不带密钥本身**(J-53 停线:密钥不进任何输出)',
  !(await import('./mini-token-secret.mjs')).refusalText(
    resolveMiniTokenSecret({ env: {}, scopeName: 'production' }), { scopeName: 'production' },
  ).includes(DEV_ONLY_SECRET), '')

console.log(`   分形态:${Object.entries(byShape).map(([k, v]) => `${k} ${v}`).join(' · ') || '(零命中)'}`)
if (fails.length) { console.error(`\n❌ test-credential-scan ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-credential-scan 通过 ${checks} 项`)
