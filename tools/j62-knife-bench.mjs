#!/usr/bin/env node
/* J-62 第二款 · 第二遍造病台(店主 07m §一,2026-09-14)
 *
 * 判别式:**把落库那一步注掉,断言必须红。还绿的,它验的就是回执不是事实。**
 *
 * ══ 这个台子返工过一次,原因正是 J-62 本身 ══
 * 第一版按**行**切,而 `db.prepare(...).run(...)` 是**跨行**的 —— 切掉第一行,
 * 剩下的续行成了语法错误,服务压根起不来,套件当然红。
 * **「套件红了」于是变成了假阳:红的不是判据咬住,是进程没起来。**
 * 而且它还把 4128/4310 带崩了(回归脚本的收尾拉不回一个起不来的服务)。
 * 所以现在三道闸:
 *   ① 切**整条语句**(按括号配平找到结尾),不按行;
 *   ② 切完先 `node --check`,**不过就判定「刀没落下去」**,不跑;
 *   ③ 记**是哪一条**红的 —— 套件红了但没有一条「声称成功」的断言红,
 *      那还是**仍绿**(07l 那一刀就是被隔壁的幂等撞红的)。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const rows = []

/** 从 needle 处起,按括号配平找到整条语句的结尾
 *  ⚠️ 要跨过**链式调用**:`db.prepare(...).run(...)` 在 `prepare(` 那一对括号配平处并没有结束,
 *  在那里收刀会把 `.run(...)` 留成孤儿 → 语法错 → 服务起不来 → 「套件红了」变成假阳。
 *  现踩:`mini-phone.mjs` 那一刀就是这么落偏的。 */
function cutStatement(src, needle, nth = null) {
  /* 🔴 这里修过一次:`nth = 0` 的默认值让「显式指名第 0 处」和「压根没指名」长得一模一样,
     于是指了名照样被判「不唯一」。**默认值把两种意思合并成一种,就分不出谁在说话** ——
     和「一个字段只许回答一个问题」同族。改成 `null` 才分得开。 */
  const idx = nth === null ? 0 : nth
  let i = -1
  for (let k = 0; k <= idx; k += 1) i = src.indexOf(needle, i + 1)
  if (i < 0) return { err: nth === null ? '找不到' : `找不到第 ${idx + 1} 处` }
  const total = src.split(needle).length - 1
  if (total > 1 && nth === null) return { err: `不唯一(${total} 处),要指名第几处才许落刀` }
  const start = src.lastIndexOf('\n', i) + 1
  let j = i
  for (;;) {
    let d = 0, seen = false
    for (; j < src.length; j += 1) {
      const c = src[j]
      if (c === '(') { d += 1; seen = true } else if (c === ')') { d -= 1; if (seen && d === 0) { j += 1; break } }
    }
    /* 括号配平了,但后面若跟着 `.xxx(` 就是**链式调用**,继续往下吃 */
    let k = j
    while (k < src.length && /[\s\n]/.test(src[k])) k += 1
    if (src[k] === '.') { j = k; continue }
    break
  }
  while (j < src.length && src[j] !== '\n') j += 1
  return { start, end: j }
}

function knife({ ep, suite, file, needle, claimPat, nth = null }) {
  const abs = join(ROOT, file)
  console.log(`\n══ 造病:${ep} ══`)
  execFileSync('bash', [join(ROOT, 'tools/knife-backup.sh'), 'save', file], { cwd: ROOT, stdio: 'ignore' })
  const restore = () => execFileSync('bash', [join(ROOT, 'tools/knife-backup.sh'), 'restore', file], { cwd: ROOT, stdio: 'ignore' })
  const src = readFileSync(abs, 'utf8')
  const cut = cutStatement(src, needle, nth)
  if (cut.err) {
    console.log(`   🔴 刀没落下去:${cut.err} —— **不算验过**`)
    rows.push({ ep, suite, needle, verdict: `🔴 **刀没落下去**(${cut.err})—— 不算验过` })
    restore(); return
  }
  writeFileSync(abs, `${src.slice(0, cut.start)}    /* ☠️ J-62 造病:落库整条注掉,接口照回 200 */\n${src.slice(cut.end + 1)}`)
  /* ② 闸:切完必须还能解析,否则红的是「起不来」不是「判据咬住」 */
  try { execFileSync('node', ['--check', abs], { stdio: 'ignore' }) } catch {
    console.log('   🔴 切完语法不过 —— **刀落偏了,不算验过**')
    rows.push({ ep, suite, needle, verdict: '🔴 **刀落偏**(切完语法不过)—— 不算验过' })
    restore(); return
  }
  console.log(`   [刀] 已注掉 ${file} 里那条落库(整条,语法已过)`)
  let out = ''
  let failed = false
  try {
    execSync(`PRE_REGRESSION=skip CI_SUITES="${suite}" bash apps/api/run-all-tests.sh`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60e3 })
  } catch (e) { failed = true; out = `${e.stdout || ''}${e.stderr || ''}` }
  restore()
  /* ③ 记**是哪一条**红的 */
  const reds = (out.match(/^(?:not ok \d+ - |✗ |❌ )(.+)$/gm) || []).map((x) => x.replace(/^(not ok \d+ - |✗ |❌ )/, '').slice(0, 110))
  const bootBroke = /在 \d+s 内未就绪|BOOT-FAIL|Cannot find module/.test(out)
  if (bootBroke) {
    console.log('   🔴 服务没起来 —— 红的不是判据,**不算验过**')
    rows.push({ ep, suite, needle, verdict: '🔴 **服务没起来**,红的不是判据 —— 不算验过' })
    return
  }
  const claimReds = reds.filter((r) => claimPat.test(r))
  if (!failed) {
    /* ④ J-58 第四款:不红先证咬到 —— 把同一处换成**必然会红**的形态(直接抛),
       它要是也不红,说明这条路径压根没被执行到。 */
    console.log('   ⟳ 不红 —— 按 J-58 第四款先证「刀咬到了没有」:同一处换成必然会红的形态再跑一次')
    const src2 = readFileSync(abs, 'utf8')
    const cut2 = cutStatement(src2, needle, nth)
    let reached = null
    if (!cut2.err) {
      execFileSync('bash', [join(ROOT, 'tools/knife-backup.sh'), 'save', file], { cwd: ROOT, stdio: 'ignore' })
      writeFileSync(abs, `${src2.slice(0, cut2.start)}    throw new Error('J58-4 必然红:这条路径被执行到了')\n${src2.slice(cut2.end + 1)}`)
      try { execFileSync('node', ['--check', abs], { stdio: 'ignore' }) } catch { /* 语法不过就当探不到 */ }
      try {
        execSync(`PRE_REGRESSION=skip CI_SUITES="${suite}" bash apps/api/run-all-tests.sh`,
          { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60e3 })
        reached = false
      } catch { reached = true }
      execFileSync('bash', [join(ROOT, 'tools/knife-backup.sh'), 'restore', file], { cwd: ROOT, stdio: 'ignore' })
    }
    if (reached === false) {
      console.log('   🔴 **刀没咬到** —— 换成必然会红的形态也没红,说明这条路径压根没被执行到。**不算守住**')
      rows.push({ ep, suite, needle, verdict: '🔴 **刀没咬到**(换成必然会红的形态也不红 ⇒ 这条路径没被执行到)—— 不算守住' })
    } else if (reached === true) {
      console.log('   🔴 仍绿 —— 路径**确实被执行到了**(必然红那一刀红了),所以这条判据验的是回执不是事实')
      rows.push({ ep, suite, needle, verdict: '🔴 **仍绿**(已证刀咬到:必然红那一刀红了)—— 验的是回执不是事实' })
    } else {
      console.log('   ⚠️ 不红,但必然红那一刀也落不下去 —— 判不了,不算验过')
      rows.push({ ep, suite, needle, verdict: '⚠️ 不红且证不了咬没咬到 —— **不算验过**' })
    }
  } else if (claimReds.length) {
    console.log(`   ✅ 红了,而且红的就是那条:${claimReds[0]}`)
    rows.push({ ep, suite, needle, verdict: `✅ 红,**红的就是声称成功那条**:\`${claimReds[0]}\`` })
  } else {
    console.log(`   ⚠️ 套件红了,但红的不是「声称成功」那条:${reds[0] || '(没抓到红行)'}`)
    rows.push({ ep, suite, needle, verdict: `⚠️ **套件红了但红的是隔壁** —— \`${reds[0] || '没抓到红行'}\`;声称成功那条**仍绿**` })
  }
}

const ONLY = process.env.KNIFE_ONLY || ""
const TARGETS = [
  /* 07o §二:支付两条 + 卡包 + 积分 —— 「一次都没被夹具走过」那 8 条里最急的四条 */
  { ep: '/payments/mock/confirm · 支付落库(顾客·涉钱)', suite: 'customer-paths', file: 'apps/api/local-server.mjs',
    needle: "db.prepare(\"UPDATE payments SET status = 'PAID', transaction_id = ?, updated_at = ? WHERE booking_id = ? AND provider = 'MOCK'\")",
    claimPat: /㋚1 |payments 从/ },
  { ep: '/payments/mock/confirm · 预约转 CONFIRMED', suite: 'customer-paths', file: 'apps/api/local-server.mjs',
    needle: "db.prepare(\"UPDATE bookings SET status = 'CONFIRMED', updated_at = ? WHERE id = ?\").run(now, bookingId)",
    claimPat: /㋚1 |㋚2 / },
  /* 全仓 4 处 `INSERT INTO coupon_grants`:0=积分换券 · **1=商家发券(㋚3 走的就是这一处)** · 2=批量发 · 3=结算送 */
  { ep: '/my/coupons · 卡包(顾客直接看)', suite: 'customer-paths', file: 'apps/api/local-server.mjs',
    needle: "db.prepare(`INSERT INTO coupon_grants (id, tenant_id, coupon_id, user_id, code, status, expires_at, created_at, grant_source)",
    nth: 1, claimPat: /㋚3/ },
  /* ⚠️ §八.5 的回放**没做成**,如实记着(停线:同一处连改三次不对就停,写清试了哪三种)
     ④ 那一支**只在套件保持绿时**才说话,所以回放要一把「落在套件走不到的地方、且不把套件弄红」的刀。
     三次都没找到:
       ① 积分换券那条写 + `customer-paths` → 套件因别的原因红了;
       ② 平台导入那条身份写 + `mini-phone`   → 套件红(常驻的那 4 套里有人走导入);
       ③ 同上 + `wechat-stub`                → 一样红。
     **结论:④ 的代码装上了,但没有观察到它真的触发 —— 按 ④ 自己的规矩,不算验过。**
     下批换法:给台子加一个「不跑套件、只跑单条断言」的模式,才好构造保持绿的场景。 */
]
for (const t of TARGETS) { if (ONLY && !t.ep.includes(ONLY)) continue; await knife(t) }

console.log('\n════ 造病表 ════\n')
console.log('| 口 | 判据套件 | 注掉的那条落库 | 造病结果 |')
console.log('|---|---|---|---|')
for (const r of rows) console.log(`| \`${r.ep}\` | \`${r.suite}\` | \`${r.needle.slice(0, 46)}…\` | ${r.verdict} |`)
