/* D203 常驻判据:**密钥不进任何输出。**
 *
 * 立案(店主 09o §一,硬挡推):开机把 `platform-admin` 的一次性口令**明文打进启动日志**。
 * 本机看着没事,生产不是 —— Railway 的部署日志留存、面板看得到、**事后删不掉**;
 * 而它是**平台级**凭据:一把钥匙,所有店。
 *
 * 这一套按**白名单判据**写(判据三:数「我列的都对」永远漏没列的):
 * 把全仓**所有**「输出语句里插了密钥类变量」的位置抠出来,**逐个必须落进白名单**,
 * 每条写明为什么它不是密钥值;新来的自动红。上限只许变短。
 *
 * 两层(判据四:同一把刀要分得出哪层在守):
 *   ① 静态层 —— 写法层面谁在念钥匙;
 *   ② 行为层 —— 真起一台服务,**在启动日志里搜口令形状的串**。
 * ①能证明写法对,证不了别处还有没有路把值漏出去;②反过来只看得见这一次开机的那几行。
 * 两层都要,且各自带自己的刀(突变自检条)。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const ROOT = new URL('../../', import.meta.url).pathname
let checks = 0
const fail = []
function check(name, cond, detail = '') {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { console.log(`not ok ${checks} - ${name}${detail ? `: ${detail}` : ''}`); fail.push(name) }
}

/* ── 扫描面(J-65③:一个 0 不带「扫了几个文件」不许写进报告)────────────────── */
function sources() {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(mjs|js)$/.test(e.name)) continue
      if (/(^|\/)test-/.test(relative(ROOT, p))) continue        // 判据自己不算被测面(J-61②)
      if (relative(ROOT, p).startsWith('tools/probe-samples/')) continue  // 夹具目录(J-61④)
      out.push(p)
    }
  }
  for (const d of ['apps', 'tools', 'miniprogram']) walk(join(ROOT, d))
  return out.sort()
}

/* ── ① 静态层:输出语句里插了密钥类变量的,逐个必须落进白名单 ───────────────── */
const SECRET_WORD = /(password|secret|token|passwd|apikey|privatekey|credential)/i
const OUTPUT_CALL = /(console\.(log|warn|error|info|debug)|logger\.(log|warn|error|info|debug)|throw new Error)\s*\(/

/** 一行里有没有「把密钥类变量插进输出」。
 *  只看 `${...}` 插值 —— 字面量里出现 "password" 是文案,不是值。 */
function secretInterpolations(line) {
  if (!OUTPUT_CALL.test(line)) return []
  const hits = []
  for (const m of line.matchAll(/\$\{([^{}]*)\}/g)) {
    const expr = m[1]
    if (!SECRET_WORD.test(expr)) continue
    /* 这些不是「值」:名字、长度、有没有、什么类型。
       🔴 判据自身的缺陷(本套件 ①g 那把刀当场咬出来的,记在案):
          上一版写成 `/\b(name|Name|…|\?\s*'|…)/` —— **那个 `\b` 管着整个括号组**,
          于是 `secretName`(N 前面是字母,没有词边界)和 `xxx ? '有' : '没有'`
          (`?` 前面是空格,两边都是非词字符,也没有词边界)**两条都漏掉了**。
          判据也是代码,也会坏 —— 拆成互不牵连的几条,各自不带 `\b`。 */
    if (/(name|length|kind|type|label|flag|has|had|is[A-Z])/i.test(expr)) continue
    if (/\?[^:]*['"`]/.test(expr)) continue          // 三元产出的是文案(「有」/「没有」),不是值
    if (/\.length\b|\bBoolean\(|!!/.test(expr)) continue
    if (/\bmask\s*\(/.test(expr)) continue           // 已打码的,见白名单
    hits.push(expr.trim())
  }
  return hits
}

/** 🔴 白名单:每条写明「为什么它不是密钥值」。**只许变短。**
 *  形状 = 文件相对路径 → 理由。 */
const OUTPUT_WHITELIST = new Map([
  ['apps/api/tools/wecom-probe.mjs', '企微探针打的是 mask(token)(只留头尾各几位),不是值本身;它是人工排障脚本,不在开机链上'],
  ['apps/api/local-server.mjs', '🔴 `OWNER_TOKEN.slice(0,8)` —— **已被 `if (IS_PRODUCTION)` 挡住**:生产那一支只打「已配置,不在日志中显示(长度 N)」,前 8 位只在本机开发打。放行的是这个**产品级判断**,不是这一行写法本身;哪天 IS_PRODUCTION 的判法变了,这条要重审'],
])

const files = sources()
check(
  `①a 扫描面:全仓非测试 .mjs/.js **${files.length}** 个(apps/ tools/ miniprogram/,排除 node_modules 与判据自身)`,
  files.length >= 350,
  `只扫到 ${files.length} 个 —— 扫描面缩水本身就是缺陷(判据三推论:判据的覆盖面也要有判据)`,
)

const violations = []
for (const f of files) {
  const rel = relative(ROOT, f)
  let text
  try { text = readFileSync(f, 'utf8') } catch { continue }
  if (!SECRET_WORD.test(text)) continue
  text.split('\n').forEach((line, i) => {
    const hits = secretInterpolations(line)
    if (hits.length) violations.push({ rel, line: i + 1, hits })
  })
}
const unlisted = violations.filter((v) => !OUTPUT_WHITELIST.has(v.rel))
check(
  `①b 🔴 输出语句里插密钥值的位置:现扫 **${violations.length}** 处,全部落进白名单(白名单 ${OUTPUT_WHITELIST.size} 条)`,
  unlisted.length === 0,
  unlisted.map((v) => `${v.rel}:${v.line} → ${v.hits.join(', ')}`).join(' | '),
)
check(
  `①c 白名单只许变短(现 ${OUTPUT_WHITELIST.size} ≤ 2,每条写明为什么不是密钥值)`,
  OUTPUT_WHITELIST.size <= 2,
  `白名单涨到 ${OUTPUT_WHITELIST.size} —— 放行一处要先报店主`,
)
/* 白名单里的条目必须**真的还在**:它对应的文件没了,这条就是残留(J-58③) */
const stale = [...OUTPUT_WHITELIST.keys()].filter((k) => !violations.some((v) => v.rel === k))
check(
  '①d 白名单零残留:每条都对应一个现存的命中(文件改好了就该把它从白名单删掉)',
  stale.length === 0,
  `这些白名单条目已经没有对应命中:${stale.join(', ')}`,
)

/* ①的刀(突变自检条):造一个真会发生的假违规,必须被咬中;打码的那种必须不被咬中。 */
check(
  '①e 🔴 造病:一行「把口令插进日志」必须被咬中(不咬中说明这一层在空守)',
  secretInterpolations('  console.log(`已建账号,一次性密码:${initialPassword}(抄走)`)').length === 1,
)
check(
  '①f 反向守:打了码的不许被咬中(否则这条会把正确写法一起判红)',
  secretInterpolations('  console.log(`access_token=${mask(token)}`)').length === 0,
)
check(
  '①g 反向守二:只说「缺哪一把」的不许被咬中(拒绝启动那段全是这种)',
  secretInterpolations('  console.error(`缺:${secretName} 没配置`)').length === 0,
)

/* ── ② 行为层:真起一台服务,在启动日志里搜口令形状的串 ─────────────────────
 * 判据律:能验渲染结果的就别验中间产物。静态层只看得见写法,
 * 看不见「别的地方把它 return 出去又被打了一遍」。 */
const PWD_SHAPE = /\b[abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789]{10,12}\b/
/* 🔴 用 `new RegExp(...)` 拼,**不写成正则字面量** ——
   写成字面量时,中文密码词会紧挨着结束斜杠和后面的方法名,
   而 `test-credential-scan` 的「账号密码对」尺子认的正是「密码词 + 斜杠 + 六位以上」这个形状,
   于是把这一行咬成一对账号密码。**是误报,但误报的根在我的写法上**,不在那把尺子 ——
   换个写法,比去松人家的判据对。
   ⚠️ 连**这段注释**都不能把那个形状原样抄出来:上一版注释里抄了一遍,刀照样咬中(本批亲历两回)。 */
const PWD_WORD = new RegExp(['密码', '口令', 'password'].join('|'), 'i')
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.'))   // ci 库域:密钥门禁放行开发值
const bootLog = await new Promise((resolve) => {
  const child = spawn(process.execPath, [join(ROOT, 'apps/api/local-server.mjs')], {
    /* 🔴 `PLATFORM_ADMIN_BOOTSTRAP=1` 是**故意打开**的:D203 甲支之后自举默认关,
       而这一层要验的正是「**真建一次**的时候口令进不进日志」。
       不打开的话 ②b 那个 0 就是「这条路没跑」,不是「跑了没泄漏」—— J-58①。 */
    env: { ...process.env, DATA_DIR: dir, PORT: '4139', PLATFORM_ADMIN_BOOTSTRAP: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buf = ''
  /* 🔴 这个 `guard` 必须 `unref()`:上一版把 25 秒兜底定时器留在事件循环里,
     结论早就拿到了、`resolve` 也调了,**Node 还是要等那个定时器烧完才肯退** ——
     于是这一套雷打不动跑满 25 秒,而我两次都在改「等什么」,改错了地方。
     现象是「慢」,根因是「没人清掉兜底定时器」;这也是为什么 09o §三 说
     **先量不先修** —— 我这次就是没量先改,白改两遍。 */
  let guard = null
  const done = (v) => { if (guard) clearTimeout(guard); try { child.kill() } catch { /* 已经走了 */ } resolve(v) }
  /* 🔴 等的是**被测那件事发生的那一刻**,不是「服务完全起来」:
     口令若要泄漏,就泄在 `bootstrapAndReport` 打那一行的同一瞬间(`local-server.mjs:6659`),
     它远早于 listen。等 listen 等于替全新库跑完整套迁移 —— 实测白等满 25 秒。
     (上一版先等「监听/listening」,而服务器根本不打这两个词;这是「判据里的静默失败器」同族:
      条件永不为真 → 悄悄退化成「等满超时」,而断言照样绿。) */
  child.stdout.on('data', (d) => { buf += d; if (/已建平台账号|platform-admin/.test(buf)) setTimeout(() => done(buf), 400) })
  child.stderr.on('data', (d) => { buf += d })
  guard = setTimeout(() => done(buf), 25000)
  guard.unref?.()
})

check(
  '②a 前置:这一台真起来了(起不来的话下面那条 0 是「没测到」不是「没违规」—— J-58①)',
  /platform|监听|listening|4139/.test(bootLog),
  `启动日志前 300 字:${bootLog.slice(0, 300)}`,
)
const pwdLines = bootLog.split('\n').filter((l) => PWD_SHAPE.test(l) && PWD_WORD.test(l))
check(
  `②b 🔴 启动日志里**零**个「口令形状的串」(扫了 ${bootLog.split('\n').length} 行)`,
  pwdLines.length === 0,
  /* 报出行号与字段名,**不报值**(报值等于在判据里又念一遍钥匙) */
  pwdLines.map((l) => l.replace(PWD_SHAPE, '<命中处已遮,不打印>').slice(0, 120)).join(' | '),
)
check(
  '②c 平台账号确实建出来了(没建的话②b 那个 0 同样是「没测到」)',
  /已建平台账号/.test(bootLog),
  '启动日志里没有「已建平台账号」—— 这一支没跑到,②b 不算数',
)
/* ②的刀:把一行含口令形状的假日志喂进同一把尺子,必须红 */
/* 🔴 造病用的那串**当场拼出来,源码里不留字面量** ——
   `test-credential-scan` 现测把它咬成「账号密码对」并判红(本批亲历)。
   判据里放一个长得像口令的字面量,跟产品里放一个是同一类事:**刀认形态,不认你的用意。** */
const FAKE_PWD = ['k7Rm', '9pXt', '4Wq'].join('')
check(
  '②d 🔴 造病:一行「一次性密码:<当场拼的 11 位>」喂进同一把尺子必须咬中',
  [`[platform] 已建平台账号 platform-admin,一次性密码:${FAKE_PWD}`]
    .filter((l) => PWD_SHAPE.test(l) && PWD_WORD.test(l)).length === 1,
)
check(
  '②e 反向守:「一次性口令**未输出**」这种不含值的句子不许被咬中',
  ['[platform] 已建平台账号 platform-admin(首登强制改密)。🔴 一次性口令未输出、也未落盘'].filter((l) => PWD_SHAPE.test(l) && PWD_WORD.test(l)).length === 0,
)

/* ── ③ 🔴 D203 甲支的合同:**不显式打开就不许建**(读写两道闸律的另一面:
 *      ②只验了「建的时候不泄漏」,证不了「默认不建」。两向都要实测。) ─────────── */
const { DatabaseSync } = await import('node:sqlite')
const dir2 = mkdtempSync(join(tmpdir(), 'll-ci-data.'))
const bootLog2 = await new Promise((resolve) => {
  const child = spawn(process.execPath, [join(ROOT, 'apps/api/local-server.mjs')], {
    env: { ...process.env, DATA_DIR: dir2, PORT: '4140', PLATFORM_ADMIN_BOOTSTRAP: '' },   // 故意不打开
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let b = ''
  let g = null
  const fin = (v) => { if (g) clearTimeout(g); try { child.kill() } catch { /* 已走 */ } resolve(v) }
  child.stdout.on('data', (d) => { b += d; if (/\[platform\]/.test(b)) setTimeout(() => fin(b), 400) })
  child.stderr.on('data', (d) => { b += d })
  g = setTimeout(() => fin(b), 25000); g.unref?.()
})
check('③a 前置:这一台也真起来了(起不来的话下面那个 0 是「没测到」)', /\[platform\]/.test(bootLog2),
  `启动日志前 300 字:${bootLog2.slice(0, 300)}`)
check('③b 🔴 不设 `PLATFORM_ADMIN_BOOTSTRAP` → 日志明说「本次未建」', /本次未建/.test(bootLog2))
let seeded = -1
try {
  const dbq = new DatabaseSync(join(dir2, 'lucky-luxe.sqlite'), { readOnly: true })
  seeded = dbq.prepare('SELECT COUNT(*) AS n FROM platform_accounts').get().n
  dbq.close()
} catch (e) { seeded = `读不到:${e.message}` }
check(`③c 🔴 **从库那头验**(不看日志的说法):默认开机后 platform_accounts = ${seeded},必须是 0`,
  seeded === 0, `实测 ${seeded} —— 日志说未建、库里却有行,那就是日志在说谎(J-62:回执不是事实)`)
try { rmSync(dir2, { recursive: true, force: true }) } catch { /* 清不掉不影响结论 */ }

try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清不掉不影响结论 */ }

console.log(`\n1..${checks}`)
if (fail.length) { console.log(`\n🔴 红 ${fail.length} 条:${fail.join(' / ')}`); process.exit(1) }
console.log(`\n✅ 全过(${checks} 条)`)
