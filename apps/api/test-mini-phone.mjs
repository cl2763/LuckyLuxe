#!/usr/bin/env node
/* 小程序授权手机号:**解密这一步真跑了没有**(店主 夜11 段 B1,2026-09-14)
 *
 * ══ 这套判据要防的那个「站在门后面的绿」══
 * 手机号解密要 `session_key`,而 `session_key` 正是 `jscode2session` 给的 —— **替身给的是假的**。
 * 只要替身随口给一句 `'stub-session'`,「解密」这一步在回归里**根本走不到**:
 * 接口可以 500、可以静默返回空号,套件照样绿。店主点破的就是这个。
 * 所以本套的地基是:**替身给一把确定的 key,夹具用那把 key 按真算法加密,服务端照真算法解密**。
 * 被替的仍然只有「问腾讯这个 code 是谁」那一跳,**加解密两头都是真的**。
 *
 * ══ 判据(每条造病都在日志里留「[刀]」凭据 —— 刀留痕律)══
 *   ㋐1  替身的 `session_key` 是**确定的**:同一 openid 两次登录拿到同一把(不确定就没法造载荷)
 *   ㋐2  纯函数层:真算法加密 → 真算法解密,拿得回原号
 *   ㋐3  🔴 造病:密文改一个字节 → **必须抛**,不许解出个空号
 *   ㋐4  🔴 造病:iv 改一个字节 → 必须抛
 *   ㋐5  🔴 造病:换成**别人的** session_key → 必须抛
 *   ㋐6  行为层正向:走正门登录 → 授权手机号 → **查库**,档案上真的写上了号(不看响应,看库)
 *   ㋐7  行为层反向守:密文改一个字节 → 400 且**库里那一格仍然是空的**
 *        ——「解密失败」不许被静默翻译成「这人没有手机号」(静默失败器族)
 *   ㋐8  越权:拿**别人**的 code 来绑 → 403,不许把别人的号写进自己的档案
 *   ㋐9  未登录 → 401(绑号是写自己的档案,不许匿名写)
 *   ㋐10 「只问一次」的判条件:`needsPhone()` **只看这家店的档案上有没有号**
 *   ㋐11 白名单式反向守:产品代码里**不许有**「解密失败就当没号」的兜底写法
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const API = join(ROOT, 'apps/api')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const knife = (what) => console.log(`   [刀] ${what}`)          // 刀留痕律:落刀要有凭据
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { stubSessionKeyFor, encryptPhonePayloadForStub, decryptWechatPhone } = await import('./wechat-phone.mjs')
const { stubJsCode2SessionResponse } = await import('./wechat-code-stub.mjs')
const { needsPhone } = await import('./mini-phone.mjs')

/* ── ㋐1 替身的 key 必须是确定的 ── */
const k1 = stubJsCode2SessionResponse('stub:zhen-a', 'ci').session_key
const k2 = stubJsCode2SessionResponse('stub:zhen-a', 'ci').session_key
const k3 = stubJsCode2SessionResponse('stub:zhen-b', 'ci').session_key
check('㋐1 替身给的 `session_key` 是**确定的**:同一 openid 两次登录同一把、不同人不同把 '
  + '—— 不确定就没法用它造密文,「解密」这一步就永远走不到',
  Boolean(k1) && k1 === k2 && k1 !== k3 && k1 !== 'stub-session',
  `a1=${k1} a2=${k2} b=${k3}`)

/* ── ㋐2/㋐3/㋐4/㋐5 纯函数层:真算法一圈 + 三把刀 ── */
const SK = stubSessionKeyFor('stub-openid-fn')
const good = encryptPhonePayloadForStub({ sessionKey: SK, phone: '13800001234' })
let round = ''
try { round = decryptWechatPhone({ ...good, sessionKey: SK }).phoneNumber } catch (e) { round = `抛:${e.message}` }
check('㋐2 真算法一圈(AES-128-CBC,key=base64decode(session_key)):加密→解密拿得回原号',
  round === '13800001234', round)

const rejects = (payload, why) => {
  try { const got = decryptWechatPhone(payload); return { red: true, got: got.phoneNumber } }
  catch (e) { return { red: false, msg: String(e.message).slice(0, 40) } }
}
knife('㋐3 把密文的第一个字节改掉')
const r3 = rejects({ ...good, encryptedData: (good.encryptedData[0] === 'A' ? 'B' : 'A') + good.encryptedData.slice(1), sessionKey: SK })
check('㋐3 🔴 造病:密文**改一个字节** → 必须抛,**不许解出个空号照样往下走**',
  r3.red === false, JSON.stringify(r3))

knife('㋐4 把 iv 的第一个字节改掉')
const r4 = rejects({ ...good, iv: (good.iv[0] === 'A' ? 'B' : 'A') + good.iv.slice(1), sessionKey: SK })
check('㋐4 🔴 造病:**iv 改一个字节** → 必须抛', r4.red === false, JSON.stringify(r4))

knife('㋐5 换成别人的 session_key')
const r5 = rejects({ ...good, sessionKey: stubSessionKeyFor('stub-openid-someone-else') })
check('㋐5 🔴 造病:换成**别人的** `session_key` → 必须抛(证明 key 真的参与了运算,不是摆设)',
  r5.red === false, JSON.stringify(r5))

/* ── ㋐10 「只问一次」的判条件 ── */
check('㋐10 「只问一次」的判条件**只有一条**:这家店的档案上有没有号 —— '
  + '有号 → 永远不再问;没号 → 问(空串/空格/null 都算没号)',
  needsPhone({ phone: '' }) && needsPhone({ phone: '   ' }) && needsPhone({}) && !needsPhone({ phone: '13800001234' }), '')

/* ── ㋐11 白名单式反向守:**解密调用点**那个 catch 里不许没有 throw ── */
const prod = ['apps/api/mini-phone.mjs', 'apps/api/wechat-phone.mjs']
const callSites = []
for (const f of prod) {
  const s = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  /* 只看**真的调用**了解密的地方(J-61:认调用不认提及)——
     注释里提一句、判据里写一句,都不算。 */
  const re = /decryptWechatPhone\s*\(/g
  let m
  while ((m = re.exec(s))) {
    if (/(export\s+)?function\s+decryptWechatPhone/.test(s.slice(Math.max(0, m.index - 40), m.index + 22))) continue
    const after = s.slice(m.index, m.index + 700)
    const c = after.indexOf('catch')
    /* 调用点后面必须紧跟一个 catch,且那个 catch 块里必须 throw */
    const body = c < 0 ? '' : after.slice(c, after.indexOf('}', after.indexOf('{', c)) + 1)
    callSites.push({ f, hasCatch: c >= 0, throws: /throw/.test(body) })
  }
}
const leaky = callSites.filter((c) => !c.hasCatch || !c.throws)
check('㋐11 白名单式反向守:全仓**真调用**了 `decryptWechatPhone` 的每一处('
  + `现有 ${callSites.length} 处),都必须被一个**会 throw 的 catch** 包住 —— `
  + '出现一处把解密失败吞掉的,当场红(静默失败器族)。这是 ㋐7 行为层那条的静态补刀,'
  + '**J-61:数的是调用,不是提及**',
  callSites.length >= 1 && leaky.length === 0,
  `调用点=${callSites.length} 漏的=${JSON.stringify(leaky)}`)

/* ══════════ 段 B3:小程序那两条(**源码层**,不是像素层 —— 说清楚)══════════
   这三条量的是小程序源码里的形状。**微信运行时跑不到,所以它们不能替代真机走查** ——
   按 J-37①「在不在 ≠ 看得见」,真机那一层仍然欠着,回执里如实挂。 */
const meJs = readFileSync(join(ROOT, 'miniprogram/pages/me/index.js'), 'utf8')
const meWxml = readFileSync(join(ROOT, 'miniprogram/pages/me/index.wxml'), 'utf8')
const paJs = readFileSync(join(ROOT, 'miniprogram/utils/phone-auth.js'), 'utf8')

/* ㋐12 两端「只问一次」的判条件必须**判出同一个结果**(不比文本,比行为 —— J-61) */
const { needsPhone: needsPhoneMp } = await import('../../miniprogram/utils/phone-auth.js').catch(() => ({ needsPhone: null }))
const samples = [{ phone: '' }, { phone: '  ' }, {}, { phone: '13800001234' }, { phone: '0' }, { phone: null }]
const beVerdict = samples.map((m) => needsPhone(m))
const mpVerdict = needsPhoneMp ? samples.map((m) => needsPhoneMp(m)) : null
check('㋐12 「只问一次」的判条件在**两端判出同一个结果**(拿 6 组样本各跑一遍,比的是结果不是文本)'
  + ' —— 两端各写一份逻辑,已登记**分叉债**,这条判据是它的看守',
  Boolean(mpVerdict) && JSON.stringify(beVerdict) === JSON.stringify(mpVerdict),
  `后端=${JSON.stringify(beVerdict)} 小程序=${JSON.stringify(mpVerdict)}`)

/* ㋐13 「跳过」不许拦路 */
const pendingBlock = /wx:if="\{\{!member\.profileComplete\}\}"[\s\S]{0,600}?profile-pending-desc/.test(meWxml)
const saysNoBlock = /不影响查看会员资料、订单与预约/.test(meWxml)
const noModal = !/wx:if="\{\{!member\.profileComplete\}\}"[\s\S]{0,200}?(modal|mask|overlay)/.test(meWxml)
check('㋐13 头像昵称「跳过」**不许拦路**:没填资料时出的是一块**页内提示卡**(不是遮罩/弹层),'
  + '文案明说「不影响查看会员资料、订单与预约」,顾客可以直接往下用',
  pendingBlock && saysNoBlock && noModal, `卡=${pendingBlock} 文案=${saysNoBlock} 非弹层=${noModal}`)

/* ㋐14 昵称兜底只许落「微信用户」——不许回落到库 id / 会员码(假数回落红线) */
const nickLine = (meJs.match(/nickname: member\.nickname[^\n]*/) || [''])[0]
check('㋐14 🔴 假数回落红线:跳过头像昵称的顾客,名字兜底**只许**落「微信用户」—— '
  + '不许回落到 `member.id` / `member.memberCode`(那是库主键和会员码,两个别的语义,'
  + '顾客会在自己的「我的」页上看到一串 `user_xxxx`)',
  /微信用户/.test(nickLine) && !/member\.id/.test(nickLine) && !/member\.memberCode/.test(nickLine),
  nickLine.trim())

/* ㋐15 绑定失败不许打绿勾 */
const failBranch = /catch[\s\S]{0,400}?phoneAuthorized: false[\s\S]{0,200}?phoneAuthFailed: true/.test(paJs)
check('㋐15 🔴 绑定失败**不许打绿勾**:后端回 400 时小程序必须把 `phoneAuthorized` 置 false 并如实报错 —— '
  + '打了绿勾顾客就以为存住了,而后台永远认不出这个人(静默失败器族)',
  failBranch, '')

/* ══════════ 行为层:起一台 ci 库域的服务 ══════════ */
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.miniphone-'))
const PORT = 4152
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: API, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '' },
})
const BASE = `http://127.0.0.1:${PORT}`
const H = { 'content-type': 'application/json', 'x-tenant-id': 'lucky-luxe' }
const up = await (async () => {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return true } catch { /* 还没起 */ }
    await sleep(500)
  }
  return false
})()
try {
  check('前置:ci 库域实例起得来(起不来下面几条**不算验过**,不是通过)', up)
  if (up) {
    const login = (openid) => fetch(`${BASE}/auth/wechat/mini-login`,
      { method: 'POST', headers: H, body: JSON.stringify({ code: `stub:${openid}`, tenantId: 'lucky-luxe', displayName: '微信用户' }) })
    const bindPhone = (tok, payload) => fetch(`${BASE}/auth/wechat/mini-phone`,
      { method: 'POST', headers: { ...H, authorization: `Bearer ${tok}` }, body: JSON.stringify(payload) })
    const { DatabaseSync } = await import('node:sqlite')
    const dbPath = join(dir, 'lucky-luxe.sqlite')
    const phoneInDb = (uid) => {
      const dbx = new DatabaseSync(dbPath)
      const row = dbx.prepare('SELECT phone, tags_json FROM users WHERE id = ?').get(uid)
      dbx.close()
      return row || {}
    }

    /* ㋐7 先做反向守那条(顺序有意:**先证明坏密文写不进去**,再证明好密文写得进去) */
    const oidBad = `stub-openid-bad-${Date.now()}`
    const bodyBad = await (await login(oidBad)).json()
    const uidBad = bodyBad?.user?.id || ''
    const tokBad = bodyBad?.auth?.accessToken || ''
    const pBad = encryptPhonePayloadForStub({ sessionKey: stubSessionKeyFor(oidBad), phone: '13900007777' })
    knife(`㋐7 行为层:把密文第一个字节改掉再送给 ${'/auth/wechat/mini-phone'}`)
    const resBad = await bindPhone(tokBad, {
      code: `stub:${oidBad}`,
      encryptedData: (pBad.encryptedData[0] === 'A' ? 'B' : 'A') + pBad.encryptedData.slice(1),
      iv: pBad.iv,
    })
    const rowBad = phoneInDb(uidBad)
    check('㋐7 🔴 行为层造病:密文改一个字节 → **400 且库里那一格仍然是空的** —— '
      + '「解密失败」不许被静默翻译成「这人没有手机号」(否则就多出一个后台永远认不出来的人)',
      resBad.status === 400 && !String(rowBad.phone || '').trim(),
      `status=${resBad.status} 库里phone=${JSON.stringify(rowBad.phone)} tags=${rowBad.tags_json}`)

    /* ㋐6 正向:同一个人送好密文 → 库里真的有号了 */
    const pGood = encryptPhonePayloadForStub({ sessionKey: stubSessionKeyFor(oidBad), phone: '13900007777' })
    const resGood = await bindPhone(tokBad, { code: `stub:${oidBad}`, ...pGood })
    const rowGood = phoneInDb(uidBad)
    let tags = []
    try { tags = JSON.parse(rowGood.tags_json || '[]') } catch { tags = ['(解不出来)'] }
    check('㋐6 行为层正向:走正门登录 → 授权手机号 → **查库**,`users.phone` 真的是那个号,'
      + '并且「无手机号」标记被摘掉(不看响应,看库 —— 响应说了不算)',
      resGood.status === 200 && rowGood.phone === '13900007777' && !tags.includes('无手机号'),
      `status=${resGood.status} 库里phone=${JSON.stringify(rowGood.phone)} tags=${rowGood.tags_json}`)

    /* ㋐8 越权:A 拿 B 的 code 上来 */
    const oidOther = `stub-openid-other-${Date.now()}`
    await login(oidOther)
    const pOther = encryptPhonePayloadForStub({ sessionKey: stubSessionKeyFor(oidOther), phone: '13611112222' })
    knife('㋐8 用 A 的登录态 + B 的 code/密文')
    const resCross = await bindPhone(tokBad, { code: `stub:${oidOther}`, ...pOther })
    const rowCross = phoneInDb(uidBad)
    check('㋐8 🔴 越权造病:拿**别人的** code 来绑 → 403,**不许把别人的手机号写进自己的档案**',
      resCross.status === 403 && rowCross.phone === '13900007777',
      `status=${resCross.status} 我的号变成了=${rowCross.phone}`)

    /* ㋐9 未登录 */
    const resAnon = await fetch(`${BASE}/auth/wechat/mini-phone`,
      { method: 'POST', headers: H, body: JSON.stringify({ code: `stub:${oidBad}`, ...pGood }) })
    check('㋐9 未登录 → 401(绑号写的是自己的档案,不许匿名写)', resAnon.status === 401, `status=${resAnon.status}`)
  }
} finally {
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) {
  console.log(`\n🔴 ${fails.length} 条没过:`)
  for (const f of fails) console.log(`   - ${f}`)
  process.exitCode = 1
} else {
  console.log(`\n✅ 全过(${checks} 条)`)
}
