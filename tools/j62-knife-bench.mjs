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
    console.log('   🔴 仍绿 —— 这条口的判据验的是回执不是事实')
    rows.push({ ep, suite, needle, verdict: '🔴 **仍绿** —— 验的是回执不是事实' })
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
  /* 07l 清单里「涉钱」与「顾客能看见」两条线上、**有判据**的那些口。
     `nth` 是「这个串在文件里的第几处」—— 台子默认**拒绝**在不唯一的串上落刀(落偏了红的就不是判据),
     所以同名语句必须指名道姓。 */
  /* 头像有**两条写口**:新客走 INSERT,老客走 UPDATE。㋐16 用的是新 openid ⇒ INSERT 那条。
     第一版刀砍的是 UPDATE,㋐16 当然照样绿 —— **刀砍在没人走的那条路上,等于没砍**。 */
  { ep: '头像落库·新客 INSERT(顾客·裁#94)', suite: 'mini-phone', file: 'apps/api/local-server.mjs',
    needle: "INSERT INTO users (id, display_name, phone, wechat_open_id, tenant_id, avatar_url)", claimPat: /㋐16/ },
  { ep: '/auth/wechat/mini-phone(顾客·授权手机号)', suite: 'mini-phone', file: 'apps/api/mini-phone.mjs',
    needle: "db.prepare('UPDATE users SET phone = ?, tags_json = ? WHERE id = ?')", claimPat: /㋐6|㋐7|真的是那个号/ },
  { ep: '/bookings/:id/cancel · 释放时段(顾客·07m §四②)', suite: 'booking-cancel', file: 'apps/api/local-server.mjs',
    /* cancelBooking 那一处:`DELETE FROM booking_slots` 全仓 4 处,靠**下一行**把它认出来 */
    needle: "db.prepare('DELETE FROM booking_slots WHERE booking_id = ?').run(id)\n    db.prepare(\"UPDATE bookings SET status = 'CANCELLED'", claimPat: /㋘2|时段释放/ },
  { ep: '/bookings/:id/cancel · 状态历史(技师那头)', suite: 'booking-cancel', file: 'apps/api/local-server.mjs',
    /* 全仓 2 处(:6412 cancelBooking / :15704 商家侧),取第 0 处 = 顾客那条口 */
    needle: "randomId('hist'), id, booking.status, 'CANCELLED', body.reason", nth: 0, claimPat: /㋘4|技师那边/ },
  { ep: '/my/stored-value/confirm(顾客·涉钱)', suite: 'noshow-aftersales', file: 'apps/api/local-server.mjs',
    needle: "db.prepare('UPDATE stored_value_transactions SET customer_confirmed_at = ? WHERE id = ? AND customer_confirmed_at IS NULL')",
    claimPat: /确认成功/ },
]
for (const t of TARGETS) { if (ONLY && !t.ep.includes(ONLY)) continue; await knife(t) }

console.log('\n════ 造病表 ════\n')
console.log('| 口 | 判据套件 | 注掉的那条落库 | 造病结果 |')
console.log('|---|---|---|---|')
for (const r of rows) console.log(`| \`${r.ep}\` | \`${r.suite}\` | \`${r.needle.slice(0, 46)}…\` | ${r.verdict} |`)
