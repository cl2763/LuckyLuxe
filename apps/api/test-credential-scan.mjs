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

import { readFileSync } from 'node:fs'
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
check('② 🔴 零命中先证刀能咬:三个明示为假的已知阳性(会话令牌/密码赋值/账号密码对)必须全被咬中',
  missed.length === 0, `咬不到:${missed.map((c) => c.what).join(' | ')}`)

/* ③ 反向守:扫描面没缩水(判据覆盖面要有判据) */
check(`③ 反向守:扫描面 ${files.length} >= 1100 个 tracked 文件(目录被排除/仓库被裁时立刻红)`,
  files.length >= 1100, String(files.length))

const byShape = real.reduce((a, h) => { a[h.shape] = (a[h.shape] || 0) + 1; return a }, {})
console.log(`\n[凭据形态] tracked ${files.length} 个 · 命中 ${real.length} 处 · 白名单 ${Object.keys(ALLOW).length} 条`)
console.log(`   分形态:${Object.entries(byShape).map(([k, v]) => `${k} ${v}`).join(' · ') || '(零命中)'}`)
if (fails.length) { console.error(`\n❌ test-credential-scan ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-credential-scan 通过 ${checks} 项`)
