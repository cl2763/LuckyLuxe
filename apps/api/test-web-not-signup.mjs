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
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
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

/* 剥注释:案底里写着「创建账号」四个字,那是说明不是入口(J-61 数执行不数提及) */
const bare = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '')
const WEB = ['apps/web/customer.js', 'apps/web/customer.html']
const SIGNUP = /创建账号|新建账号|立即注册|去注册|注册账号|Create\s+(an\s+)?[Aa]ccount|Sign\s*up|signup/

const hits = []
for (const f of WEB) {
  let src = ''
  try { src = bare(readFileSync(join(ROOT, f), 'utf8')) } catch { continue }
  src.split('\n').forEach((ln, i) => { if (SIGNUP.test(ln)) hits.push(`${f}:${i + 1} ${ln.trim().slice(0, 70)}`) })
}
check('㋝1 🔴 网页顾客端**「注册 / 创建账号」类入口 0 处**(剥注释后现扫)—— '
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
