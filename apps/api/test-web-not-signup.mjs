#!/usr/bin/env node
/* 🔴 裁 #103 · **网页顾客端永远不是「新顾客的入口」**(店主 07u §三,07v ②)
 *
 * ══ 为什么 ══
 * 不是网页做不了登录,是**网页做不了「认出老顾客」**:
 * 网页只拿得到**一个手机号**;小程序拿得到**微信身份 + 手机号**两个东西。
 * 号在库里找不到时,网页分不出这三种人 ——
 *   从没来过的新顾客 / 老顾客但号没录进去 / 老顾客但换了号。
 * **而如果网页这时候让她「注册」,那就是又开一份档案 —— 正是 D191 的症状。**
 * 还有更简单的一层:**新顾客第一次来,一定是到店或在小程序里。**
 * 没有人会先在网页上注册一个美甲店账号 ⇒
 * **网页允许注册,不会带来一个新顾客,只会制造重复档案。**
 *
 *   ㋝1  网页顾客端「注册 / 创建账号」类**入口 0 处**(注释里的案底不算 —— J-61 数执行不数提及)
 *   ㋝2  网页登录口**不通向「新建 users 行」**
 *   ㋝3  **号在与不在,提示与返回体一致到看不出差别** —— 两个提示不一样,
 *        等于给任何人一个工具:输一串号就能试出谁是这家店的顾客。**美甲店的顾客名单是隐私。**
 */
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const HERE = join(fileURLToPath(new URL('.', import.meta.url)))
const ROOT = join(HERE, '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 剥注释:案底里写着「创建账号」四个字,那是说明不是入口(J-61 数执行不数提及)。
   🔴 夜13 §三 补:原来只剥 `/* *\/` 与**整行** `//`,**行尾 `//` 注释没剥** ——
   现测 `customer.js:178` 那句 `needLogin: '请先登录后继续',   // 裁#103:不许出现「注册」`
   就是被行尾注释里的那两个字咬中的。行尾注释和整行注释是同一类东西。 */
const bare = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/(^|[^:'"\`\\])\/\/[^\n]*$/gm, '$1')   // 行尾 //(避开 http:// 这种)

/* 🔴 夜13 §三 · **扫描面** —— 原来是手列的两个文件,而其中
   `apps/web/customer.html` **根本不存在**,`try/catch { continue }` 把它**静默跳过**:
   于是「全站 0 处」这句话此前是在**实际只扫 1 个文件**的面上得出的(静默失败器族 + J-56 尺子漏层)。
   现在:**机械枚举**顾客端的全部文件 + **文件必须存在**(不存在直接红,不许静默)+ **下限棘轮**。
   现测:换成这个面之后、长相还是旧的那一版,命中仍是 **0** —— 说明这道缺口**当时没有藏东西**,
   但那个 0 在此之前**没有依据**(J-56:尺子漏层,它量出来的结论一律存疑)。 */
const WEB = [
  'apps/web/customer.js',
  'apps/web/index.html',              // ← 网页顾客端真正的那张 HTML(原来扫的 customer.html 不存在)
  'apps/web/customer-auth-copy.js',   // ← 登录/注册那一屏的文案表(07w 摘出去的,原来不在面上)
  'apps/web/customer-recommend.js',
  'apps/web/customer-tags.js',
  'apps/web/customer-wallet.js',
  'apps/web/sign.html',
  'apps/web/share.html',
]

/* 🔴 J-73(店主 08a §五立)· **一把按文本形状找东西的刀,它的 probe 必须为「被找的东西的
   每一种合法写法」各种一个靶子。** 这一把原来只认两种长相(中文文案 / `signup` 小写),
   下面按长相分组列全,每一组在 probe 里都有对应靶子:
     ① 中文文案:创建账号 / 新建账号 / 开通账号 / 立即注册 / 去注册 / 注册账号 / **裸「注册」**
        —— 裸「注册」要排除 **已注册 / 未注册**(那是状态,不是入口);
     ② 英文文案:Create Account / Sign up / Sign-up / Signup;
     ③ 代码标识:`signup` / `signUp` / `sign_up` / `doSignup`;
     ④ 🔴 **入口形态的 register**:路由 `/register` · 按钮 `id="…register…"` ·
        `data-auth-action="register"` · `register(` 调用。
        **刻意不匹配纯键名**(`registerTitle:` / `googleRegister:` 这种)——
        现测那 11 处全是**命名遗留**:键叫 register,值写的是「用微信登录」,**不是入口**。
        (裁 #103 改的是那一屏的文案,键名没跟着改 —— 记一笔,不是缺陷。) */
const SIGNUP_ZH = /创建账号|新建账号|开通账号|立即注册|去注册|注册账号|(?<![已未])注册(?![时日])/
const SIGNUP_EN = /Create\s+(an\s+)?[Aa]ccount|Sign\s*[-_]?[Uu]p/
const SIGNUP_ID = /\bsign[-_]?up\b|\bdoSignup\b|\bsignUp\b/i
const SIGNUP_ROUTE = /['"\`]\/(register|signup|sign-up)\b|id=["'][^"']*[Rr]egister[^"']*["']|data-auth-action=["']register["']|\bregister\s*\(/
const SIGNUP = new RegExp([SIGNUP_ZH, SIGNUP_EN, SIGNUP_ID, SIGNUP_ROUTE].map((r) => r.source).join('|'))

/* 🔴 J-58①⑤(店主 07w §五)· **「全站 0 处」本身就是一个零命中结论,先证刀咬得到再信它。**
   probe 靶子:两个**必然命中**(中英各一)+ 两个**形似而非**(注释里的案底 / 普通代码)。
   probe 不红之前,「全站 0 处」这句话不许写进任何报告。 */
if (process.argv.includes('--probe')) {
  const { probe } = await import('../../tools/scanner-probe.mjs')
  probe('web-not-signup · SIGNUP 扫描(J-73:每一种合法写法各一个靶子)', [
    /* ① 中文文案 */
    { 样本: '<button id="doSignup">创建账号</button>', 该命中: true },
    { 样本: '<a class="btn">立即注册</a>', 该命中: true },
    { 样本: "const t = { cta: '注册' }", 该命中: true },
    /* ② 英文文案 */
    { 样本: '<a href="/x">Create Account</a>', 该命中: true },
    { 样本: '<a href="/x">Sign Up</a>', 该命中: true },
    { 样本: '<a href="/x">Sign-up now</a>', 该命中: true },
    /* ③ 代码标识 */
    { 样本: "location.href = '/signup'", 该命中: true },
    { 样本: 'function signUp() {}', 该命中: true },
    { 样本: 'const sign_up = 1', 该命中: true },
    /* ④ 入口形态的 register */
    { 样本: `location.href = '/register'`, 该命中: true },
    { 样本: '<button data-auth-action="register">x</button>', 该命中: true },
    { 样本: '<button id="googleRegister">x</button>', 该命中: true },
    /* ══ 反面:形似而非 ══ */
    { 样本: '/* 案底:这一屏原来叫「创建账号」 */', 该命中: false },      // 块注释
    { 样本: "const x = 1   // 裁#103:不许出现「注册」", 该命中: false },  // 🔴 行尾注释(本批补)
    { 样本: 'const registeredCount = 3', 该命中: false },                 // registered 不是入口
    { 样本: "const s = '已注册'", 该命中: false },                        // 🔴 状态标签,不是入口
    { 样本: "const s = '未注册'", 该命中: false },
    { 样本: "registerTitle: '用微信登录'", 该命中: false },               // 🔴 命名遗留:键叫 register,值是登录
    { 样本: "googleRegister: '使用 Google 登录'", 该命中: false },
    { 样本: 'const url = "http://x.com/a" // ok', 该命中: false },        // http:// 不许被当行尾注释剥坏
  ], (t) => { const b = bare(String(t)); return b.split('\n').some((ln) => SIGNUP.test(ln)) })
  process.exit(process.exitCode || 0)
}

/* 🔴 **文件不存在 = 红,不许静默跳过**(静默失败器族)。
   案底:原来 `catch { continue }` 把不存在的 `apps/web/customer.html` 悄悄吞了,
   于是扫描面名义 2 个、实际 1 个,而「全站 0 处」照样报了出来。 */
const missing = WEB.filter((f) => !existsSync(join(ROOT, f)))
check(`㋝0 扫描面 ${WEB.length} 个文件**逐个都在**(少一个即红 —— 不许 try/catch 静默跳过)`,
  missing.length === 0, missing.join(' | '))
check(`㋝0b 扫描面下限 ${WEB.length} >= 8(缩水立刻红 —— 判据的覆盖面本身要有判据)`, WEB.length >= 8)

const hits = []
for (const f of WEB) {
  let src = ''
  try { src = bare(readFileSync(join(ROOT, f), 'utf8')) } catch { continue }
  src.split('\n').forEach((ln, i) => { if (SIGNUP.test(ln)) hits.push(`${f}:${i + 1} ${ln.trim().slice(0, 70)}`) })
}
/* 🔴 J-65 第三款(店主 09a §四立)· **一个 0 不带「扫了几个文件」,和一个没有依据的 0 是一回事。**
   案底就是这一条:扫描面里原来有个**不存在的文件**(`apps/web/customer.html`),
   `try/catch` 静默跳过 —— **那个「0 处」是在只扫 1 个文件的面上得出的**,而它报的是 0。
   所以这个数从此**跟扫描面一起出现**,不许单独出现。 */
const SCANNED = WEB.filter((f) => existsSync(join(ROOT, f))).length
check(`㋝1 🔴 网页顾客端**「注册 / 创建账号」类入口 0 处**(剥注释后现扫;**这次扫了 ${SCANNED} / ${WEB.length} 个文件**)—— `
  + '一个都不许有:它不会带来一个新顾客,只会制造重复档案',
  hits.length === 0, hits.join(' | '))
check('㋝1b 自守:这把扫描**认得出**真入口(零命中先证刀能咬,J-58⑤)',
  SIGNUP.test('<button id="signup">创建账号</button>') && SIGNUP.test('Create Account')
  && !SIGNUP.test('const x = 1'), '')

/* ㋝2 静态:网页顾客端调的登录口里,不许有会新建 users 行的 */
const webSrc = bare(readFileSync(join(ROOT, 'apps/web/customer.js'), 'utf8'))
const authCalls = [...webSrc.matchAll(/['"`](\/auth\/[a-z0-9/-]+)['"`]/g)].map((m) => m[1])
const CREATES = ['/auth/email/register']
const bad = authCalls.filter((p) => CREATES.includes(p))
check(`㋝2 🔴 网页登录口**不通向「新建 users 行」** —— 现扫它调的 ${new Set(authCalls).size} 条 `
  + `\`/auth/*\`(${[...new Set(authCalls)].join(' ') || '一条都没有'}),其中会建档的 ${bad.length} 条`,
  bad.length === 0, bad.join(' '))

/* ㋝3 行为层:号在与不在,看不出差别 */
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.websign-'))
const PORT = 4196
const OWNER = 'websign-owner-not-a-secret'
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: HERE, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '',
    OWNER_TOKEN: OWNER, WECHAT_MINI_TOKEN_SECRET: 'websign-mini-not-a-secret' },
})
const BASE = `http://127.0.0.1:${PORT}`
const TID = 'lucky-luxe'
const up = await (async () => {
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${BASE}/health`)).ok) return true } catch { /* 还没起 */ } await sleep(500) }
  return false
})()
try {
  check('前置:实例起得来(起不来下面几条**不算验过**,不是通过)', up)
  if (up) {
    const d = new DatabaseSync(join(dir, 'lucky-luxe.sqlite'), { readOnly: true })
    const anyPhone = d.prepare("SELECT phone FROM users WHERE phone IS NOT NULL AND TRIM(phone) <> '' LIMIT 1").get()
    d.close()
    /* 🔴 裁 #103 达标的最强形态:**网页压根没有「按手机号查/登录」那条路**。
       所以这一条验的是「那条路不存在」——「正门造不出来」有两种,这一格是**保证**不是缺口(裁 #100)。 */
    /* ⚠️ 这条正则修过一次:第一版要求引号里**整串**都是路径字符,
       于是 `'/customers/lookup?phone='` 这种**带 query 的**一命中不了 —— 造病打下去没红才发现。
       **按 J-58④:不红先证咬得到。** 现在 query 后面的部分不参与匹配。 */
    const PHONE_ROUTE = /['"`](\/[a-z0-9/-]*(?:lookup|by-phone|find-user|check-phone)[a-z0-9/-]*)/g
    const phoneRoutes = [...webSrc.matchAll(PHONE_ROUTE)].map((m) => m[1])
    check('㋝3 🔴 **网页顾客端没有任何「按手机号查人 / 按手机号登录」的口** —— '
      + '这是裁 #103 达标的最强形态:**那条路不存在,就没有「号在与不在」的差别可暴露**。'
      + `现扫到 ${phoneRoutes.length} 条(${phoneRoutes.join(' ') || '零条'})`,
      phoneRoutes.length === 0, phoneRoutes.join(' '))
    check('㋝3c 自守:这把扫描**认得出**真的按号查人的口(含带 query 的那种;'
      + '第一版就漏了 `?phone=` 这一类,是造病没红才逮到的)',
      /['"`]\/[a-z0-9/-]*lookup/.test("fetch('/customers/lookup?phone=' + p)")
      && !/['"`]\/[a-z0-9/-]*lookup/.test("const n = 1"), '')
    check('㋝3b 反向守:夹具库里**确实有带手机号的档案**(有号可查,这一条才不是空转)',
      Boolean(anyPhone && String(anyPhone.phone || '').trim()), JSON.stringify(anyPhone || {}))
  }
} finally {
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${checks} 条)`)
