/* 平台控制台密码登录 · 乙支(店主 11p §二 选的那一支,2026-09-23)
 *
 * ══ 案由 ══
 * 店主:「平台控制台账号密码我找不到了,给我重置,我登不进去。」
 * 现查:**生产库 `platform_accounts` = 0 行** —— 不是「找不到」,是**这个账号从来没存在过**。
 * D203 当时把自举默认关了(一次性口令会进 Railway 部署日志且事后删不掉),
 * 并明写「(乙)一旦定下,走环境变量那条:店主亲手灌,代码不生成、不打印、不拷贝」。
 *
 * 🔴 这一套验的核心只有一句:**口令没有任何出口。**
 *    代码不生成它(不再 `randomPassword()`)、日志不打它、哈希与前缀也不打。
 *    开关开着但没给口令 ⇒ **不建**,不是「那就随机一个」—— 回落就等于回到 D203 之前。
 *
 * ⚠️ 本套件**自己起服务、自己造口令**,用的是一串明显的测试串;
 *    它只活在这个进程的环境变量里,不落盘、不进仓库。 */
import { spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = 4188
/* 明显的测试串:一眼看得出不是真口令,也不会被人误当成生产凭据 */
const PW1 = 'TESTONLY-not-a-real-secret-aaaa'
const PW2 = 'TESTONLY-not-a-real-secret-bbbb'

let checks = 0, failed = 0
function check(name, ok, extra = '') {
  checks++
  if (ok) console.log(`ok ${checks} - ${name}`)
  else { failed++; console.log(`not ok ${checks} - ${name}${extra ? ' :: ' + extra : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DATA = mkdtempSync(join(tmpdir(), 'll-ci-data.'))
let child = null
async function boot(env) {
  const logFile = join(DATA, 'boot.log')
  writeFileSync(logFile, '')
  child = spawn(process.execPath, [join(ROOT, 'apps/api/local-server.mjs')], {
    cwd: join(ROOT, 'apps/api'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`http://127.0.0.1:${PORT}/health`); break } catch { await sleep(120) }
  }
  await sleep(200)
  return () => log
}
function down() { if (child) { child.kill(); child = null } }
const login = async (pw) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/platform/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'platform-admin', password: pw }),
  })
  let d = null
  try { d = await r.json() } catch { d = null }
  return { status: r.status, data: d }
}
const acct = () => {
  const db = new DatabaseSync(join(DATA, 'lucky-luxe.sqlite'), { readOnly: true })
  const r = db.prepare("SELECT password_hash, must_change_password, reset_marker FROM platform_accounts WHERE username='platform-admin'").get()
  db.close()
  return r || null
}
const sessions = () => {
  const db = new DatabaseSync(join(DATA, 'lucky-luxe.sqlite'), { readOnly: true })
  const n = db.prepare('SELECT COUNT(*) n FROM platform_auth_sessions').get().n
  db.close()
  return n
}

try {
  /* ══ ① 开关开着、口令没给 ⇒ 不建、不崩、不回落 ══ */
  let log = await boot({ PLATFORM_ADMIN_BOOTSTRAP: '1' })
  check('①a 🔴 开关开着但没给口令 ⇒ **不建**(不回落成随机口令 —— 回落就是回到 D203 之前)',
    acct() === null, JSON.stringify(acct()))
  check('①b 不崩:服务照常起来', (await fetch(`http://127.0.0.1:${PORT}/health`)).status === 200)
  check('①c 日志说清「为什么没建」(而不是默默跳过)', /缺初始口令/.test(log()), log().slice(-160))
  check('①d 这时谁也登不进去', (await login(PW1)).status === 401)
  down(); await sleep(300)

  /* ══ ② 给了口令 ⇒ 建成、能登、首登强制改密 ══ */
  log = await boot({ PLATFORM_ADMIN_BOOTSTRAP: '1', PLATFORM_ADMIN_INITIAL_PASSWORD: PW1 })
  check('②a 建成了', acct() !== null)
  check('②b 首登强制改密', acct()?.must_change_password === 1, String(acct()?.must_change_password))
  const in1 = await login(PW1)
  check('②c 用那串口令登得进(200 且 mustChangePassword=true)',
    in1.status === 200 && in1.data?.session?.mustChangePassword === true, `${in1.status} ${JSON.stringify(in1.data).slice(0, 120)}`)
  check('②d 🟢 **阳性对照**:错口令 401(证明 ②c 的 200 不是「谁来都放行」)', (await login('definitely-wrong')).status === 401)

  /* ══ ③ 🔴 口令没有任何出口 —— 这一套的核心 ══ */
  const out = log()
  check('③a 🔴 **启动全部输出里搜口令原文 = 0 命中**', !out.includes(PW1),
    out.split('\n').filter((l) => l.includes(PW1)).join(' | ').slice(0, 120))
  const sha = createHash('sha256').update(PW1).digest('hex')
  check('③b 🔴 搜它的 sha256 前 8 位 = 0 命中(连「拿值猜值」的入口都不留)', !out.includes(sha.slice(0, 8)))
  check('③c 🔴 也没打长度/前缀', !new RegExp(`${PW1.length}\\s*位|${PW1.slice(0, 4)}`).test(out))
  /* 🟢 反向守:一份「什么都没打」的日志会让上面三条自动全绿。先证明它真的在说话。 */
  check('③d 🟢 **反向守**:日志里确实有「已建」那一句(否则上面三条只是因为日志是空的)',
    /已建平台账号/.test(out), out.slice(-200))
  const src = readFileSync(join(ROOT, 'apps/api/platform-auth.mjs'), 'utf8')
  check('③e 🔴 代码里**不再自己生成**一次性口令(不生成,就没有需要找地方放的东西)',
    !/const initialPassword = randomPassword\(\)/.test(src),
    (src.match(/.{0,40}randomPassword\(\).{0,30}/g) || []).join(' | '))
  down(); await sleep(300)

  /* ══ ④ 幂等:账号已在,再启动一个字不动 ══ */
  const before = acct()?.password_hash
  log = await boot({ PLATFORM_ADMIN_BOOTSTRAP: '1', PLATFORM_ADMIN_INITIAL_PASSWORD: PW2 })
  check('④a 🔴 账号已在 ⇒ 再启动**哈希不变**(哪怕环境变量换了口令)',
    acct()?.password_hash === before, `${String(before).slice(0, 10)} → ${String(acct()?.password_hash).slice(0, 10)}`)
  check('④b 旧口令仍然能登(证明 ④a 不是「两边都坏了所以相等」)', (await login(PW1)).status === 200)
  down(); await sleep(300)

  /* ══ ⑤ 重置:改哈希 + 吊销旧会话 + 同值幂等 ══ */
  const sessBefore = sessions()
  check('⑤0 夹具:重置前确实有会话在(否则「吊销了」没法验)', sessBefore > 0, String(sessBefore))
  log = await boot({ PLATFORM_ADMIN_RESET: '1', PLATFORM_ADMIN_INITIAL_PASSWORD: PW2 })
  check('⑤a 重置把哈希改了', acct()?.password_hash !== before)
  check('⑤b 🔴 旧会话被吊销', sessions() === 0, String(sessions()))
  check('⑤c 旧口令 401', (await login(PW1)).status === 401)
  check('⑤d 新口令 200,且又是首登强制改密', (await login(PW2)).status === 200 && acct()?.must_change_password === 1)
  check('⑤e 🔴 重置那一轮日志里也没有口令', !log().includes(PW2))
  const afterReset = acct()?.password_hash
  down(); await sleep(300)

  /* 🔴 幂等按「做过没有」判,不按「现在是什么」判:
     店主忘了删 RESET=1 的话,否则每次重启都会把她自己改过的新密码打回那一串。 */
  log = await boot({ PLATFORM_ADMIN_RESET: '1', PLATFORM_ADMIN_INITIAL_PASSWORD: PW2 })
  check('⑤f 🔴 **同一个口令第二次重置 ⇒ 不动**(幂等判据律:看「做过没有」,不看「现在是什么」)',
    acct()?.password_hash === afterReset, `${String(afterReset).slice(0, 10)} → ${String(acct()?.password_hash).slice(0, 10)}`)
  check('⑤g 日志说清了是因为「已经生效过」', /同一个口令已经生效过/.test(log()), log().slice(-160))
  down(); await sleep(300)

  /* ══ ⑥ 默认关:两个开关都不设 ⇒ 什么也不做 ══ */
  log = await boot({})
  check('⑥a 🔴 两个开关都不设 ⇒ 不建不改(默认关,漏判也只是「没建」)', /本次未建/.test(log()), log().slice(-160))
  down()

  const EXPECTED_CHECKS = 24
  if (checks !== EXPECTED_CHECKS) {
    console.error(`not ok - 🔴 断言条数对不上:实跑 ${checks} 条,应为 ${EXPECTED_CHECKS} 条(判据五)。`)
    process.exit(1)
  }
  if (failed) { console.error(`\n❌ 平台账号乙支:${failed}/${checks} 条未过`); process.exit(1) }
  console.log(`\n✅ 平台控制台密码登录(乙支) ${checks} 条全过(与声明的 ${EXPECTED_CHECKS} 条一致)`)
} finally {
  down()
  try { rmSync(DATA, { recursive: true, force: true }) } catch { /* 清不掉不阻塞 */ }
}
