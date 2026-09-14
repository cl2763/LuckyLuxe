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
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { execFileSync, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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

/* 🔴 裁 #99(店主 07o §五)· **造病期间,工作区里不许有未提交的真改动**
 *
 * 案由:07m 我用了一次 `git checkout --` 还原 —— 那是 J-34 明令禁入变异流程的命令。
 * **根子不在「手滑」**:造病台在动源码,而我**同时还有未提交的真改动**(J-60 转的那 5 处)
 * 在同一个工作区里 —— **还原的时候就分不开了**,所以我伸手去拿了那把禁用的刀。
 *
 * 所以:**开跑前检查工作区干净,不干净就拒绝开跑并说明原因。**
 * 台子只许还原**它自己动过**的东西;要造病,先提交或先 stash。
 *
 * ⚠️ 例外只有一个:`KNIFE_ALLOW_DIRTY=1` —— 它**不是后门**,是给「我就想看一眼」留的口,
 * 而且**会在输出里大声说出来**,回执里赖不掉。
 */
function assertCleanTree() {
  const out = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 })
  const dirty = out.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!dirty.length) { console.log('[裁#99 自证] 工作区干净 —— 台子还原的时候不会和别的改动搅在一起'); return }
  if (process.env.KNIFE_ALLOW_DIRTY === '1') {
    console.log(`⚠️ [裁#99] 工作区有 ${dirty.length} 处未提交改动,但 KNIFE_ALLOW_DIRTY=1 强开了 ——`)
    console.log('   **这一轮造病的还原不保证干净**,回执里必须写明这一行。')
    for (const d of dirty.slice(0, 8)) console.log(`     ${d}`)
    return
  }
  console.error(`\n🔴 **拒绝开跑**:工作区有 ${dirty.length} 处未提交改动(裁 #99)。`)
  console.error('   台子要动源码再还原,**和你没提交的改动搅在一起就分不开了** —— 07m 那次 `git checkout --` 就是这么来的。')
  console.error('   先 `git commit` 或 `git stash`,再来造病。硬要跑:`KNIFE_ALLOW_DIRTY=1`(会在输出里大声说出来)。')
  for (const d of dirty.slice(0, 8)) console.error(`     ${d}`)
  process.exit(2)
}

/* 🔴 裁 #98(店主 07o §四 / 07p §七④)· **造病台不许借 4128 / 4310**
 *
 * 根子不在「忘了拉回来」,在于台子一开始就不该碰那两台:
 * **4128 是店主自己在用的,4310 是她看顾客端的那台 —— 造病期间它们是坏的,而她不知道。**
 *
 * 以前台子是调 `run-all-tests.sh` 跑套件,而那个脚本**自己就用 4128 起主服务**
 * (`run-all-tests.sh:310  PORT=4128 node local-server.mjs`),跑完再 restore ——
 * 于是每造一次病,店主那两台就被打死再拉起一次。
 *
 * 现在:台子**自己起一台**,自己的端口 + 自己的临时库,全程不碰 4128/4310。
 *   · 自带服务的套件(`spawn(... 'local-server.mjs')`)→ 直接跑,连服务都不用起;
 *   · 靠 `TEST_BASE_URL` 的套件 → 台子起一台**私有**实例给它。
 * 配一条判据:造病全程 4128/4310 的健康口**必须一直是 200**。
 */
const PRIVATE_PORT = Number(process.env.KNIFE_PORT || 4191)
/* 🔴 不写死:`credential-scan ④a` 把「密钥类常量回落到固定字面量」当场咬住了,**咬得对** ——
   而这里根本不需要一个固定值。每跑一次现生成一把,连常量都不存在,也就没有白名单要加。 */
const OWNER_TOKEN = `knife-bench-${randomUUID()}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const portOk = async (p) => { try { return (await fetch(`http://127.0.0.1:${p}/health`)).ok } catch { return false } }

/** 店主那两台现在活着吗 —— 造病前后各量一次,动了就是台子越界 */
async function ownerPortsAlive() {
  return { p4128: await portOk(4128), p4310: await portOk(4310) }
}

/** 这套件自带服务吗(自带的话连私有实例都不用起) */
function bringsOwnServer(suite) {
  try {
    const src = readFileSync(join(ROOT, `apps/api/test-${suite}.mjs`), 'utf8')
    return /spawn\(\s*process\.execPath\s*,\s*\[\s*'local-server\.mjs'/.test(src)
  } catch { return false }
}

/** 隔离跑一套:**不调 run-all-tests.sh**,所以一根手指都碰不到 4128/4310 */
async function runSuiteIsolated(suite) {
  const selfServed = bringsOwnServer(suite)
  const dataDir = mkdtempSync(join(tmpdir(), 'll-ci-data.knife-'))
  const env = { ...process.env, DATA_DIR: dataDir, NOTIFY_TICK: 'off',
    TEST_DB_PATH: join(dataDir, 'lucky-luxe.sqlite'),
    OWNER_TOKEN, TEST_ADMIN_TOKEN: OWNER_TOKEN,
    WECHAT_MINI_TOKEN_SECRET: 'knife-bench-mini-not-a-secret',
    ALLOW_DEMO_ADMIN_LOGIN: 'true' }
  let srv = null
  if (!selfServed) {
    env.PORT = String(PRIVATE_PORT)
    env.TEST_BASE_URL = `http://127.0.0.1:${PRIVATE_PORT}`
    env.BASE_URL = env.TEST_BASE_URL
    srv = spawn(process.execPath, ['local-server.mjs'], { cwd: join(ROOT, 'apps/api'), stdio: 'ignore', env })
    let up = false
    for (let i = 0; i < 60 && !up; i += 1) { up = await portOk(PRIVATE_PORT); if (!up) await sleep(500) }
    if (!up) { srv.kill('SIGTERM'); rmSync(dataDir, { recursive: true, force: true })
      return { failed: true, out: 'BOOT-FAIL 私有实例没起来', bootBroke: true } }
  }
  let out = ''
  let failed = false
  try {
    out = execFileSync(process.execPath, [`test-${suite}.mjs`],
      { cwd: join(ROOT, 'apps/api'), encoding: 'utf8', env, timeout: 15 * 60e3, maxBuffer: 64e6 })
  } catch (e) { failed = true; out = `${e.stdout || ''}${e.stderr || ''}` }
  if (srv) { srv.kill('SIGTERM'); await sleep(300) }
  rmSync(dataDir, { recursive: true, force: true })
  return { failed, out, bootBroke: /BOOT-FAIL|Cannot find module|未就绪/.test(out) }
}

async function knife({ ep, suite, file, needle, claimPat, nth = null }) {
  const abs = join(ROOT, file)
  console.log(`\n══ 造病:${ep} ══`)
  /* 🔴 夜12 段C · **「没跑到」必须单列** —— J-57 在造病台上的复现
   *
   * 案由(07r 现测):`scan-sign` 是 fail-fast(`check()` 里直接 `throw`)——
   * 无刀 53 条,造病后**停在第 44 条,后面 9 条根本没跑到**,
   * 而那 9 条里正有「签完另一入口变已签只读」这种**和被砍的落库直接相关**的。
   * **不能说它们守住了,也不能说没守住 —— 它们没跑。**
   *
   * 全仓 62/128 套是 fail-fast,今夜改不完。但**「没跑到」这个数不用改它们也能精确算**:
   *   先跑一遍**无刀基线**拿到断言名单 → 造病后再跑一遍 →
   *   **没跑到 = 基线里有、造病那轮里一次都没出现(既没 ok 也没 not ok)的那些。**
   * 这比改 62 个文件稳,而且**它本身就是要报的那个数**。
   *
   * ⚠️ **基线必须在落刀之前跑** —— 第一版我把它放在落刀之后,于是「基线」其实是第二次带刀跑,
   * 43 == 43、**「没跑到」漂亮地报 0**。又一次「看起来很干净的 0」(J-58④⑤ 同族)。
   * 现在它排在备份之前,**刀还没碰过源码**。 */
  const baseRun = await runSuiteIsolated(suite)
  const nameOf = (l) => l.replace(/^(?:not )?ok \d+ - /, '').trim()
  const baseNames = (baseRun.out.match(/^(?:not )?ok \d+ - .+$/gm) || []).map(nameOf)


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
  const run1 = await runSuiteIsolated(suite)
  const out = run1.out
  const failed = run1.failed
  restore()
  /* ③ 记**是哪一条**红的 —— 并按店主 07r §二 固定输出「红 N / 仍绿 M / 仍绿点名」
     **造病的产出不是「红了没有」,是「哪几条活下来了」。**
     07m 那次的形状就是这个:套件红了,但红的是隔壁那条幂等,「声称成功」那条原样活下来。 */
  const reds = (out.match(/^(?:not ok \d+ - |✗ |❌ )(.+)$/gm) || []).map((x) => x.replace(/^(not ok \d+ - |✗ |❌ )/, '').slice(0, 110))
  const greens = (out.match(/^ok \d+ - (.+)$/gm) || []).map((x) => x.replace(/^ok \d+ - /, ''))
  /* 「声称成功」的断言:名字里说了成了,或条件在看 2xx —— 与静态筛同一把尺子 */
  const CLAIMS = /成功|已保存|已提交|已发送|已核销|已到账|已确认|已绑定|已更新|写进|落库|创建|生成|新增|入库|真的是|跟过去|查库|对得上|留痕|释放/
  const claimGreens = greens.filter((g) => CLAIMS.test(g))
  const survived = claimPat ? claimGreens.filter((g) => !claimPat.test(g)) : claimGreens
  const ranNames = new Set([...(out.match(/^(?:not )?ok \d+ - .+$/gm) || []).map(nameOf)])
  const notRun = baseNames.filter((n) => !ranNames.has(n))
  console.log(`   [刀账·四个数] 红 ${reds.length} · 仍绿 ${greens.length}`
    + ` · 其中**声称成功却仍绿** ${claimGreens.length} · **没跑到 ${notRun.length}**`
    + `(无刀基线 ${baseNames.length} 条)`)
  if (notRun.length) {
    console.log('   [没跑到点名](套件在半路 throw 断了,这些**既不是守住也不是没守住,是没跑**):')
    for (const n of notRun.slice(0, 12)) console.log(`     ○ ${n.slice(0, 120)}`)
    if (notRun.length > 12) console.log(`     …另 ${notRun.length - 12} 条`)
  }
  if (claimGreens.length) {
    console.log('   [仍绿点名](形状上「声称成功」且造病后仍绿 —— **要人读一眼**:')
    console.log('     与被砍的那条写**无关**的断言,绿是对的,不是发现;有关却绿的才是。')
    for (const g of claimGreens.slice(0, 12)) console.log(`     · ${g.slice(0, 120)}`)
    if (claimGreens.length > 12) console.log(`     …另 ${claimGreens.length - 12} 条`)
  }
  const bootBroke = run1.bootBroke || /在 \d+s 内未就绪|BOOT-FAIL|Cannot find module/.test(out)
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
      const probe = await runSuiteIsolated(suite)
      reached = probe.failed
      execFileSync('bash', [join(ROOT, 'tools/knife-backup.sh'), 'restore', file], { cwd: ROOT, stdio: 'ignore' })
    }
    if (reached === false) {
      console.log('   🔴 **刀没咬到** —— 换成必然会红的形态也没红,说明这条路径压根没被执行到。**不算守住**')
      rows.push({ ep, suite, needle, verdict: '🔴 **刀没咬到**(换成必然会红的形态也不红 ⇒ 这条路径没被执行到)—— 不算守住' })
    } else if (reached === true) {
      console.log('   🔴 仍绿 —— 路径**确实被执行到了**(必然红那一刀红了),所以这条判据验的是回执不是事实')
      rows.push({ ep, suite, needle, verdict: '🔴 **仍绿**(已证刀咬到:必然红那一刀红了)—— 验的是回执不是事实', 账: `红 ${reds.length} / 仍绿 ${greens.length} / 声称成功却仍绿 ${claimGreens.length} / **没跑到 ${notRun.length}**`, 仍绿: claimGreens, 没跑到: notRun })
    } else {
      console.log('   ⚠️ 不红,但必然红那一刀也落不下去 —— 判不了,不算验过')
      rows.push({ ep, suite, needle, verdict: '⚠️ 不红且证不了咬没咬到 —— **不算验过**' })
    }
  } else if (claimReds.length) {
    console.log(`   ✅ 红了,而且红的就是那条:${claimReds[0]}`)
    rows.push({ ep, suite, needle, verdict: `✅ 红,**红的就是声称成功那条**:\`${claimReds[0]}\``,
      账: `红 ${reds.length} / 仍绿 ${greens.length} / 声称成功却仍绿 ${claimGreens.length} / **没跑到 ${notRun.length}**`,
      仍绿: claimGreens, 没跑到: notRun })
  } else {
    console.log(`   ⚠️ 套件红了,但红的不是「声称成功」那条:${reds[0] || '(没抓到红行)'}`)
    rows.push({ ep, suite, needle, verdict: `⚠️ **套件红了但红的是隔壁** —— \`${reds[0] || '没抓到红行'}\`;声称成功那条**仍绿**`, 账: `红 ${reds.length} / 仍绿 ${greens.length} / 声称成功却仍绿 ${claimGreens.length} / **没跑到 ${notRun.length}**`, 仍绿: claimGreens, 没跑到: notRun })
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
  /* 🔴 §四 回放(店主 07p 给的出路):**不在真套件上回放,用玩具套件** `test-knife-selfcheck`。
     它只有两条断言:一条**必然绿**(保证造病后套件整体仍绿,④ 才有机会开口),
     一条**故意只验回执**(标本)。于是 ④ 的两支都能被看见:
       · 【回放A】刀落在 ㋛2 **真走**的那条路上 → 套件绿 → ④ 补一刀「必然红」→ 红
         ⇒ 判「**仍绿(已证刀咬到)**」= 这条判据验的是回执不是事实;
       · 【回放B】刀落在这套件**根本不走**的路上 → 套件绿 → ④ 补一刀 → **也不红**
         ⇒ 判「**刀没咬到**」= 不算守住。
     07o 那三次失败的案底留在回执里:三次都拿真套件回放,三次都把套件弄红,④ 没机会开口。 */
  { ep: '【回放A·J-58④】刀落在玩具套件真走的路上(支付落库)', suite: 'knife-selfcheck',
    file: 'apps/api/local-server.mjs',
    needle: "db.prepare(\"UPDATE payments SET status = 'PAID', transaction_id = ?, updated_at = ? WHERE booking_id = ? AND provider = 'MOCK'\")",
    claimPat: /㋛2/ },
  { ep: '【回放B·J-58④】刀落在玩具套件走不到的路上(积分换券)', suite: 'knife-selfcheck',
    file: 'apps/api/local-server.mjs',
    needle: "db.prepare(`INSERT INTO coupon_grants (id, tenant_id, coupon_id, user_id, code, status, expires_at, created_at, grant_source)",
    nth: 0, claimPat: /㋛2/ },
  /* 🔴 07q §四③:A 类 246 条按**口**聚类后是 **83 个口** —— 一个口造一次就够。
     涉钱那 35 个里挂着最多断言的是 `/settlements/:code/sign`(20 条),先造它。
     用 `customer-paths`:那套件里 ㋚5a 真走了「开单 + 顾客签字」这条路。 */
  /* ⚠️ 靶子与套件要配对:第一次我拿 `customer-paths` 跑签署口的刀 —— 它只有 2 条断言碰那个口,
     于是「仍绿 3 条」点的是**支付和卡包**,跟被砍的口毫无关系,**是噪音不是发现**。
     那 20 条 A 类挂在别的套件上;签署口该跑的是 `scan-sign`(它就是测签字那一套)。
     **「仍绿点名」只在跑了「拥有这个口的断言」的套件时才作数** —— 别的套件的绿不说明任何事。 */
  { ep: '/settlements/:code/sign · 签署落库(涉钱,挂 20 条 A 类)', suite: 'scan-sign',
    file: 'apps/api/local-server.mjs',
    needle: "db.prepare(\"UPDATE settlements SET status = 'signed', signature_data = ?, signed_at = ?",
    claimPat: /㋚5a|㋚5 / },
]
/* 🔴 裁 #98 自证:造病**前后**各量一次店主那两台。动过就是台子越界。 */
assertCleanTree()
const ownerBefore = await ownerPortsAlive()
console.log(`[裁#98 自证·开跑前] 4128=${ownerBefore.p4128 ? '200' : '✗'} · 4310=${ownerBefore.p4310 ? '200' : '✗'}`)
for (const t of TARGETS) { if (ONLY && !t.ep.includes(ONLY)) continue; await knife(t) }
const ownerAfter = await ownerPortsAlive()
console.log(`\n[裁#98 自证·跑完后] 4128=${ownerAfter.p4128 ? '200' : '✗'} · 4310=${ownerAfter.p4310 ? '200' : '✗'}`)
if (ownerBefore.p4128 !== ownerAfter.p4128 || ownerBefore.p4310 !== ownerAfter.p4310) {
  console.log('🔴 **造病台动了店主那两台** —— 裁 #98 明令不许碰。这一轮的造病结果按不可信处理。')
  process.exitCode = 1
} else if (ownerBefore.p4128 && ownerBefore.p4310) {
  console.log('✅ 全程没碰:两台开跑前是 200、跑完还是 200(台子用的是自己的端口 '
    + `${PRIVATE_PORT} + 自己的临时库)`)
} else {
  console.log('⚠️ 开跑前那两台本来就不在(店主没起服务)—— 这一轮证不了「没碰」,如实说')
}

console.log('\n════ 造病表 ════\n')
console.log('| 口 | 判据套件 | 注掉的那条落库 | 造病结果 | 刀账(红/仍绿/声称成功却仍绿)|')
console.log('|---|---|---|---|---|')
for (const r of rows) console.log(`| \`${r.ep}\` | \`${r.suite}\` | \`${r.needle.slice(0, 40)}…\` | ${r.verdict} | ${r.账 || '—'} |`)
const anySurvived = rows.filter((r) => (r.仍绿 || []).length)
if (anySurvived.length) {
  console.log('\n### 🔴 仍绿点名(**造病的产出不是「红了没有」,是「哪几条活下来了」**)\n')
  for (const r of anySurvived) {
    console.log(`**${r.ep}** —— ${r.仍绿.length} 条声称成功却仍绿:`)
    for (const g of r.仍绿.slice(0, 12)) console.log(`- ${g.slice(0, 140)}`)
    console.log('')
  }
}
