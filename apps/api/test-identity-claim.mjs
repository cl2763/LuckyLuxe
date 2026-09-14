#!/usr/bin/env node
/* 🔴 D191 · 老顾客扫码不许变成新人(店主 07n §〇,2026-09-14)
 *
 * ══ 病 ══
 * 严格认人四条第三条「还没绑过微信」原来写成「名下**一行身份记录都没有**」,
 * 而平台导入老顾客时给**每一位**建了一行 `provider='phone'` ——
 * **导入过的人 = 永远认领不了的人**,第一次扫码就拿到一份空白新档案,
 * 储值/卡包/积分/消费记录全留在那份再也认不出来的上面。
 *
 * 店主的定性:**错的是那个等号 —— 「有身份记录」≠「已经绑过微信」**(J-37:存在 ≠ 是那一种)。
 *
 * ══ 本套按 J-62 写:不看「认到了没有」,看**她的东西在不在** ══
 * 「认到了」只是接口说的。真正要证的是:**余额 / 卡包 / 积分 / 消费记录都跟过去了。**
 *
 *   ㋙1  导入的老顾客扫码 → 认到原档案,且**四样东西逐一对上**(现测值,不是「有」)
 *   ㋙2  已经绑过微信的 → 照旧不走手机号认领(放宽不许失守)
 *   ㋙3  同号多条 → 照旧**不认**,进 `identity_merge_queue`
 *   ㋙4  🔴 停线自守:严格四条里**另外三条一个字没动**
 *   ㋙5  白名单式:全仓出现过的 provider **逐个**必须在分类表里,新来的当场红
 *   ㋙6  认不出来的 provider → **挡住**(失败朝安全那边)
 */
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
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
const kinds = await import('./identity-kinds.mjs')

/* ── ㋙4 停线自守:先做静态那条(不用起服务)── */
const SRV = readFileSync(join(HERE, 'local-server.mjs'), 'utf8')
const claimSql = (SRV.match(/const candidates = db\.prepare\(`[\s\S]*?`\)/) || [''])[0]
check('㋙4 🔴 停线自守(店主 07n §八):严格认人四条里**只许改第三条**。'
  + '现读那段 SQL:①本店 `u.tenant_id = ?` ②号完全一致 `u.phone = ?` ③没绑过微信(本批改的那条)'
  + '④唯一一条 `candidates.length === 1` —— **另外三条一个字没动**',
  /u\.tenant_id = \?/.test(claimSql) && /u\.phone = \?/.test(claimSql)
  && /wechat_open_id IS NULL/.test(claimSql) && /notBoundByLoginIdentitySql/.test(claimSql)
  && /candidates\.length === 1/.test(SRV),
  claimSql.replace(/\s+/g, ' ').slice(0, 200))

/* ── ㋙5 白名单式:全仓 provider 逐个对表 ──
   🔴 这把刀返工过一次,案底留着:第一版按 `provider` 这个词扫全仓,
   咬出来一个 `ai_addon` —— 那是**AI 套餐的 provider**,跟身份表半点关系没有。
   **同一个词在两个领域里是两件事**(归族:一个字段只许回答一个问题)。
   现在扫描面按**机制**定:只看真的碰 `user_identities` 那张表的地方。 */
const IDENTITY_CTX = /user_identities|upsertUserIdentity|resolveUserByIdentity|createIdentityUpsert/
const srcFiles = readdirSync(join(ROOT, 'apps/api')).filter((b) => /\.mjs$/.test(b) && !/^test-/.test(b))
  .map((b) => `apps/api/${b}`)
const seen = new Set()
let scanned = 0
for (const f of srcFiles) {
  if (f.endsWith('identity-kinds.mjs')) continue          /* J-61②:分类表自己不算被测对象 */
  const src = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (!IDENTITY_CTX.test(src)) continue
  scanned += 1
  /* 只在**碰身份表的那几行前后**取 provider 字面量 */
  const lines = src.split('\n')
  lines.forEach((ln, i) => {
    const win = lines.slice(Math.max(0, i - 6), i + 7).join('\n')
    if (!IDENTITY_CTX.test(win)) return
    for (const m of ln.matchAll(/provider\s*[,=:]?\s*['"]([a-z_]+)['"]|provider = '([a-z_]+)'/g)) {
      const v = m[1] || m[2]
      if (v && v !== 'provider') seen.add(v)
    }
    for (const m of ln.matchAll(/VALUES \(\?, \?, '([a-z_]+)'/g)) seen.add(m[1])
  })
}
const unclassified = [...seen].filter((p) => !Object.hasOwn(kinds.IDENTITY_PROVIDERS, p))
check(`㋙5 🔴 白名单式(不靠列举):**真的碰 \`user_identities\` 的** ${scanned} 个文件里,`
  + `出现过的 provider 共 ${seen.size} 个,逐个必须在分类表里并写明理由`
  + `(现表 ${Object.keys(kinds.IDENTITY_PROVIDERS).length} 项)—— 新来一个没分类当场红`,
  unclassified.length === 0 && seen.size >= 3 && scanned >= 2,
  `没分类的:${unclassified.join(' / ') || '(无)'} · 扫到:${[...seen].join(' ')} · 扫描面 ${scanned} 个文件`)

check('㋙6 🔴 失败朝安全那边:**认不出来的 provider 一律当成「已被登录身份占用」** —— '
  + '错拦一次顾客会说;错认一次两个人的档案合成一份,钱混在一起而没有人会发现',
  kinds.isWechatLoginProvider('sms_2027_new') === true && kinds.isWechatLoginProvider('phone') === false, '')

/* ══════════ 行为层 ══════════ */
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.claim-'))
const PORT = 4156
const OWNER = 'claim-suite-owner-not-a-secret'
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: HERE, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '',
    OWNER_TOKEN: OWNER, WECHAT_MINI_TOKEN_SECRET: 'claim-suite-mini-not-a-secret',
    /* ㋙2b 需要一个「有登录身份、但没绑微信」的档案,而本仓唯一能从正门造出这个状态的
       是邮箱注册那条路(它在演示闸后面)。**这台是本套件自己起的 ci 库域实例**,
       与店主的 4128/4310 无关;裁 #90 之后 ci 库域本来就是演示门开着的那一档。 */
    ALLOW_DEMO_ADMIN_LOGIN: 'true' },
})
const BASE = `http://127.0.0.1:${PORT}`
const TID = 'lucky-luxe'
const dbPath = join(dir, 'lucky-luxe.sqlite')
const one = (sql, ...a) => { const d = new DatabaseSync(dbPath); const r = d.prepare(sql).get(...a); d.close(); return r || {} }
const all = (sql, ...a) => { const d = new DatabaseSync(dbPath); const r = d.prepare(sql).all(...a); d.close(); return r }
const AH = { 'content-type': 'application/json', 'x-admin-tenant-id': TID, authorization: `Bearer ${OWNER}` }
const CH = { 'content-type': 'application/json', 'x-tenant-id': TID }
const scan = (phone, openid, extra = {}) => fetch(`${BASE}/auth/wechat/mini-login`, { method: 'POST', headers: CH,
  body: JSON.stringify({ code: `stub:${openid}`, tenantId: TID, phone, displayName: '微信用户', ...extra }) })

const up = await (async () => {
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${BASE}/health`)).ok) return true } catch { /* 还没起 */ } await sleep(500) }
  return false
})()
try {
  check('前置:实例起得来(起不来下面几条**不算验过**,不是通过)', up)
  if (up) {
    /* ── ㋙1 用 lucky-luxe 的**真实形态**:平台导入 + provider='phone' 行 ── */
    const PHONE = '13700005880'
    /* 🔴 老顾客的余额是**从老系统迁过来的**,不是在本店充的 —— 所以夹具要走
       「平台导入带期初余额」那条真路(试跑 → 拿回 balanceSumCents → 确认)。
       第一版我用 `/admin/stored-value/recharge` 给她充,余额是 0 ——
       因为 D25 闸挡着:**没绑微信的轻档案不许充值**。
       用错了路子,验的就不是她真实的样子(造景律)。 */
    const row0 = { name: '老顾客·王', phone: PHONE, totalSpendCents: 588000, balanceCents: 55000 }
    const dry = await (await fetch(`${BASE}/platform/tenants/${TID}/import/customers`, { method: 'POST', headers: AH,
      body: JSON.stringify({ dryRun: true, rows: [row0] }) })).json().catch(() => ({}))
    const sum = Number(dry?.report?.balanceSumCents ?? dry?.balanceSumCents ?? 0)
    const imp = await (await fetch(`${BASE}/platform/tenants/${TID}/import/customers`, { method: 'POST', headers: AH,
      body: JSON.stringify({ dryRun: false, rows: [row0], confirmBalanceCents: sum }) })).json().catch(() => ({}))
    const oldId = imp?.users?.[0]?.userId || ''
    const idRows = all('SELECT provider FROM user_identities WHERE user_id = ?', oldId).map((r) => r.provider)
    check('㋙1a 夹具就是**真实形态**:平台导入建出的档案,名下**真的有** `provider=\'phone\'` 那一行,'
      + '而且**期初余额真的进了 legacy 桶** —— 不先证明这两样在,下面那条「认到了」'
      + '就可能是在一个不带病的夹具上验的(造景律)',
      Boolean(oldId) && idRows.includes('phone') && sum === 55000,
      `id=${oldId} 身份行=${idRows.join(',') || '(无)'} 试跑期初=${sum}`)

    /* 🔴 比的是**那几行本身**(按 id),不是总额 ——
       开了演示闸之后登录会铺演示种子,总额会变大;
       「总额相等」会被噪音顶红,而**「原来那几行还是她的」才是真要证的事**。 */
    const before = {
      流水行: all('SELECT id, amount_cents FROM stored_value_transactions WHERE user_id = ? ORDER BY id', oldId),
      老系统消费分: Number(one('SELECT legacy_total_spend_cents n FROM users WHERE id = ?', oldId).n || 0),
    }

    const res = await scan(PHONE, 'stub-openid-laowang-d191')
    const body = await res.json().catch(() => ({}))
    const newId = body?.user?.id || ''
    const rows = all('SELECT id FROM users WHERE phone = ? AND tenant_id = ?', PHONE, TID)
    check('㋙1 🔴 **导入的老顾客扫码 → 认到原档案**,库里这个号**只有一份**档案 '
      + '(不看接口说什么,查库数行)', newId === oldId && rows.length === 1,
    `认成了=${newId} 原档案=${oldId} 这个号的档案数=${rows.length}`)

    const afterRows = all('SELECT id, amount_cents FROM stored_value_transactions WHERE user_id = ? ORDER BY id', newId)
    const after = {
      老系统消费分: Number(one('SELECT legacy_total_spend_cents n FROM users WHERE id = ?', newId).n || 0),
      原来那几行还在: before.流水行.every((r) => afterRows.some((x) => x.id === r.id && x.amount_cents === r.amount_cents)),
      期初那笔: before.流水行.reduce((a, r) => a + Number(r.amount_cents || 0), 0),
    }
    const bound = one('SELECT wechat_open_id FROM users WHERE id = ?', newId).wechat_open_id
    check('㋙1b 🔴 **她的东西都在**(店主 07n:不是「认到了」就算完)—— '
      + `期初余额 ${after.期初那笔} 分(${before.流水行.length} 行,**逐行按 id 还在她名下**)· `
      + `老系统累计消费 ${after.老系统消费分} 分;并且微信真的绑上了`,
      before.流水行.length > 0 && after.原来那几行还在 && after.期初那笔 === 55000
      && after.老系统消费分 === before.老系统消费分 && after.老系统消费分 === 588000
      && bound === 'stub-openid-laowang-d191',
      `前=${JSON.stringify(before)} 后=${JSON.stringify(after)} 绑=${bound}`)

    /* 顾客那一层也要看得见(位面要对:只在库里对上不算) */
    const mine = await (await fetch(`${BASE}/my/stored-value`, { headers: { ...CH, authorization: `Bearer ${body?.auth?.accessToken}` } })).json().catch(() => ({}))
    const sv = mine?.storedValue || mine || {}
    check('㋙1c 🔴 位面要对:**顾客自己在小程序里看得到那笔余额** —— '
      + '库里对上了但顾客端读不到,她在店里看到的还是 0',
      JSON.stringify(sv).includes('55000') || Number(sv.balanceCents || sv.totalBalanceCents || 0) === 55000,
      JSON.stringify(sv).slice(0, 160))

    /* ── ㋙2 已经绑过微信的:不许被手机号认领走 ── */
    const P2 = '13700006001'
    const impB = await (await fetch(`${BASE}/platform/tenants/${TID}/import/customers`, { method: 'POST', headers: AH,
      body: JSON.stringify({ dryRun: false, rows: [{ name: '已绑客·李', phone: P2 }] }) })).json().catch(() => ({}))
    const bId = impB?.users?.[0]?.userId || ''
    await scan(P2, 'stub-openid-libound')                     /* 她先自己绑了微信 */
    const other = await scan(P2, 'stub-openid-someone-else')  /* 另一个微信号拿同一个手机号来 */
    const otherBody = await other.json().catch(() => ({}))
    check('㋙2 🔴 已经绑过微信的顾客,**另一个微信号拿同一个手机号来 → 认不走她** '
      + '(放宽第三条不许让这一条失守)',
      otherBody?.user?.id !== bId && Boolean(otherBody?.user?.id),
      `原档案=${bId} 这次认成了=${otherBody?.user?.id}`)

    /* ── ㋙2b 🔴 **分类表这一层,单独验** ──
       刀② 现测把这一层的实情挖出来了,两步都记着:
       ①㋙2(已绑微信的不被认走)**不是分类表在守**,守它的是另一条 `u.wechat_open_id IS NULL`
         —— 把 `wechat_miniprogram` 错分成「不算占用」,㋙2 照样绿。
         **同一把刀分不出哪层在守,那一层就没被验到**(判据四)。
       ②于是我想造一个「有 `email` 登录身份 + 手机号 + 没绑微信」的档案去压分类表,
         结果发现 **本仓没有任何正门造得出这个状态**:邮箱注册不收手机号
         (`tenant-profile.mjs:61` 那条 INSERT 收 phone,但 `/auth/email/register` 不传),
         `PATCH /admin/customers/:id/profile` 只收 tags/notes/birthday。
         **所以行为层这一格今天够不着** —— 如实登记,不拿一个空转的绿糊过去。
       现在这一层由**函数层**守:错分一个 provider,生成出来的 SQL 必须跟着变。 */
    const sqlNow = kinds.notBoundByLoginIdentitySql('u')
    check('㋙2b 🔴 分类表**函数层**自守:`email` / `google` / `account` 这些登录身份'
      + '**不许**出现在「不算占用」那张名单里 —— 它们一旦被错分,SQL 里就会多出一个豁免,'
      + '那个人就能被别的微信号用手机号认走',
      !/'email'/.test(sqlNow) && !/'google'/.test(sqlNow) && !/'account'/.test(sqlNow)
      && /'phone'/.test(sqlNow),
      sqlNow.replace(/\s+/g, ' '))
    /* ══ ㋙2c 裁 #100(店主 07o §三)· **「正门造不出来」有两种,先分清是哪一种** ══
       - **一种是缺口**:这个状态**该能产生**,但正门没给路 → 补造法;
       - **一种是保证**:这个状态**本来就不该出现** → **不补造法,把「不该有」写成判据。**
       这一格是**后者**:生产上顾客只有微信一条路(邮箱 403 / Google 路由不存在 /
       网页过渡态的死按钮撤了),所以「有 email / google 登录身份的顾客」**本来就不该存在**。
       **我们不是要造出那个状态,是要保证它永远不出现。**
       ⬜ 那个行为层格子**就此销号** —— 不是够不着,是不该有;改由下面这条守着。 */
    const badRows = all(`SELECT provider, COUNT(*) n FROM user_identities
      WHERE provider IN ('email', 'google') GROUP BY provider`)
    const realBad = badRows.reduce((a, r) => a + Number(r.n || 0), 0)
    /* 🔴 防空转(J-58 第四款 / 判据空转当红处理):
       新库里本来就一行 email 身份都没有 —— 那这条断言随便写都绿。
       所以**先证明这条查询咬得动**。
       ⚠️ 怎么造这一行,试过两种,过程记着:
         ①走 `/auth/email/register` 正门造 —— **不行**:`demo-gate-coverage ①e/①f` 立刻咬住
           「又多一套在用旧路」,而那张冻结清单的上限是 5、只许变短。**为了证一条判据去顶另一条棘轮,不划算。**
         ②直连真库插一行 —— **也不行**:J-60 的「直连库贴」棘轮会跟着涨。
       ③现在的做法:**在内存库里**照抄同一张表、种一行,拿同一条 SQL 跑一遍。
         它证的正是「这条查询认得出 email 身份」,而**一行都不碰真库,也不碰任何棘轮**。 */
    const mem = new DatabaseSync(':memory:')
    mem.exec("CREATE TABLE user_identities (id TEXT, user_id TEXT, provider TEXT)")
    const memQ = () => mem.prepare("SELECT COUNT(*) n FROM user_identities WHERE provider IN ('email','google')").get().n
    const memBefore = memQ()
    mem.prepare("INSERT INTO user_identities (id, user_id, provider) VALUES ('x','u','email')").run()
    const memAfter = memQ()
    mem.close()
    check('㋙2c0 🔴 先证刀咬得动:同一条查询,在**内存库**里种一行 `email` 身份 '
      + `→ 它真的数到了(${memBefore} → ${memAfter})。不先证这一步,下面那条「0 条」随便写都绿;`
      + '而且这么证**一行都不碰真库、不顶任何棘轮**',
      memBefore === 0 && memAfter === 1, `内存库 ${memBefore} → ${memAfter}`)

    check('㋙2c 🔴 裁#100:顾客身份**只许有微信一条路** —— `user_identities` 里'
      + `不许出现 \`email\` / \`google\` 的行 —— 现测 **${realBad}** 条。`
      + '这不是「缺口没补」,是**「不该有」被写成了判据**(裁 #100:保证,不是缺口)',
      realBad === 0, `逐 provider:${JSON.stringify(badRows)}`)

    /* ── ㋙3 同号多条:照旧不认,进撞车队列 ── */
    const P3 = '13700007002'
    /* 撞车局要**两条同号档案**。导入那条口按手机号去重(同号第二次是 update 不是 create),
       所以第二条走**另一条正门**:`/admin/bookings/direct` 建轻档案(店里电话预约的新客就是这么来的)。
       两条都是真业务路径 —— J-60:造状态要走产生这个状态的那条路。 */
    await fetch(`${BASE}/platform/tenants/${TID}/import/customers`, { method: 'POST', headers: AH,
      body: JSON.stringify({ dryRun: false, rows: [{ name: `撞车甲${Date.now()}`, phone: P3 }] }) })
    const svcList = await (await fetch(`${BASE}/admin/services`, { headers: AH })).json().catch(() => ({}))
    const techList = await (await fetch(`${BASE}/admin/technicians`, { headers: AH })).json().catch(() => ({}))
    const sid = (svcList.services || svcList.items || [])[0]?.id || ''
    const tidn = (techList.technicians || techList.items || [])[0]?.id || ''
    const dayOf = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
    for (let n = 1; n <= 10; n += 1) {
      const mk = await fetch(`${BASE}/admin/bookings/direct`, { method: 'POST', headers: AH,
        body: JSON.stringify({ newCustomerName: `撞车乙${Date.now()}`, phone: P3, serviceId: sid, technicianId: tidn, date: dayOf(n), time: '13:00' }) })
      const mb = await mk.json().catch(() => ({}))
      if (mb?.error?.code !== 'REST_DAY') break
    }
    const dup = all('SELECT id FROM users WHERE phone = ? AND tenant_id = ?', P3, TID)
    const clash = await (await scan(P3, 'stub-openid-clash-d191')).json().catch(() => ({}))
    check('㋙3 🔴 **同号多条 → 照旧不认**(「唯一一条」那条一个字没动):'
      + `现有 ${dup.length} 条同号档案,扫码**不许认走其中任何一条**,宁可新建`,
      dup.length >= 2 && !dup.map((d) => d.id).includes(String(clash?.user?.id || '')),
      `同号 ${dup.length} 条 认成了=${clash?.user?.id}`)
  }
} finally {
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${checks} 条)`)
