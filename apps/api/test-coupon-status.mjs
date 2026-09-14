#!/usr/bin/env node
/* 🔴 券的状态:**不许把后端不认识的状态原样下发给顾客**(夜12 段B,2026-09-14)
 *
 * 案由:生产现测 `coupon_grants.status` 里 **`unused` 10 张**(比 `active` 4 张还多),
 * 而 `unused` **在产品代码里一处都没有**;`/my/coupons` 又**不筛状态、原样下发** ⇒
 * **顾客手机上看得见一张后端不认识的券。点了会怎样?没人知道,因为没有代码处理它。**
 * 归族:J-62 家族的又一种 —— **界面显示了一个后端不认识的东西**。
 *
 *   ㋜1  白名单本身:产品认识的状态**逐个在代码里真有读或写**(不许往表里塞一个没人用的)
 *   ㋜2  行为层:库里塞一张 `unused` → **顾客端拿不到它**(而认识的那几张照常拿得到)
 *   ㋜3  🔴 造病:把白名单筛去掉 → ㋜2 必须红(不然那条是空转)
 *   ㋜4  不静默:挡掉的要在服务端日志里点名(看不见 ≠ 不存在)
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const HERE = join(fileURLToPath(new URL('.', import.meta.url)))
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const K = await import('./coupon-status.mjs')

/* ── ㋜1 白名单里每一个都得是产品真在用的 ── */
const SRV = readFileSync(join(HERE, 'local-server.mjs'), 'utf8')
const unusedInTable = Object.keys(K.KNOWN_COUPON_STATUSES)
  .filter((s) => !new RegExp(`status\\s*=\\s*'${s}'|status\\s*===\\s*'${s}'|'${s}'`).test(SRV))
check(`㋜1 白名单里的 ${Object.keys(K.KNOWN_COUPON_STATUSES).length} 个状态**逐个在产品代码里真有读或写** —— `
  + '白名单不许收留没人用的状态(那等于把「不认识」偷偷变成「认识」)',
  unusedInTable.length === 0, `代码里找不到的:${unusedInTable.join(' / ') || '(无)'}`)
check('㋜1b 反向守:`unused` **不在**白名单里(它是这次的被测对象;在的话下面全白验)',
  !K.isKnownCouponStatus('unused') && K.isKnownCouponStatus('active'), '')

/* ══ 行为层 ══ */
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.coupst-'))
const PORT = 4194
const OWNER = 'coupst-owner-not-a-secret'
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '',
    OWNER_TOKEN: OWNER, WECHAT_MINI_TOKEN_SECRET: 'coupst-mini-not-a-secret' },
})
let srvLog = ''
child.stdout.on('data', (c) => { srvLog += c })
child.stderr.on('data', (c) => { srvLog += c })
const BASE = `http://127.0.0.1:${PORT}`
const TID = 'lucky-luxe'
const AH = { 'content-type': 'application/json', 'x-admin-tenant-id': TID, authorization: `Bearer ${OWNER}` }
const dbPath = join(dir, 'lucky-luxe.sqlite')

const up = await (async () => {
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${BASE}/health`)).ok) return true } catch { /* 还没起 */ } await sleep(500) }
  return false
})()
try {
  check('前置:实例起得来(起不来下面几条**不算验过**,不是通过)', up)
  if (up) {
    const { createAndLoginCustomerViaFrontDoor } = await import('./customer-login-fixture.mjs')
    const svc = await (await fetch(`${BASE}/admin/services`, { headers: AH })).json().catch(() => ({}))
    const tech = await (await fetch(`${BASE}/admin/technicians`, { headers: AH })).json().catch(() => ({}))
    const serviceId = (svc.services || svc.items || [])[0]?.id || ''
    const technicianId = (tech.technicians || tech.items || [])[0]?.id || ''
    const phone = `1370000${String(Date.now()).slice(-4)}`
    const me = await createAndLoginCustomerViaFrontDoor({
      base: BASE, tenantId: TID, ownerToken: OWNER, name: '券状态·甲', phone, serviceId, technicianId, time: '11:30' })
    const CH = { 'content-type': 'application/json', 'x-tenant-id': TID, authorization: `Bearer ${me.accessToken}` }

    /* 发一张**认识的**(走正门:商家发券)*/
    const cp = await (await fetch(`${BASE}/admin/coupons`, { method: 'POST', headers: AH,
      body: JSON.stringify({ name: `券状态判据${Date.now()}`, discountType: 'amount', amountCents: 3000, validDays: 30, totalQty: 5, isActive: true }) })).json().catch(() => ({}))
    await fetch(`${BASE}/admin/coupons/${encodeURIComponent(cp?.coupon?.id || '')}/grant`,
      { method: 'POST', headers: AH, body: JSON.stringify({ userId: me.userId }) })

    /* 造一张**不认识的**:直连库改状态 —— 正门产生不了「产品不认识的状态」,
       这正是 J-60 三款里那条明写的例外(造历史脏数据) */
    const d1 = new DatabaseSync(dbPath)
    const g = d1.prepare('SELECT id FROM coupon_grants WHERE user_id = ? LIMIT 1').get(me.userId) || {}
    d1.prepare("INSERT INTO coupon_grants (id, tenant_id, coupon_id, user_id, code, status, created_at) SELECT ?, tenant_id, coupon_id, user_id, ?, 'unused', created_at FROM coupon_grants WHERE id = ?")
      .run(`grant_unused_${Date.now()}`, `UNUSED${Date.now()}`, g.id)
    const inDb = d1.prepare('SELECT status, COUNT(*) n FROM coupon_grants WHERE user_id = ? GROUP BY status').all(me.userId)
    d1.close()
    check('㋜2-前置:库里现在有**两张** —— 一张 `active`(走正门发的)+ 一张 `unused`(产品不认识的)。'
      + '造不出这个状态,下面那条就是空转',
      inDb.length === 2 && inDb.some((r) => r.status === 'active') && inDb.some((r) => r.status === 'unused'),
      JSON.stringify(inDb))

    const mine = await (await fetch(`${BASE}/my/coupons`, { headers: CH })).json().catch(() => ({}))
    const got = mine.coupons || []
    check('㋜2 🔴 **顾客端拿不到那张 `unused`**(认识的那张照常拿得到)—— '
      + `库里 2 张,顾客端出 ${got.length} 张,状态 ${got.map((c) => c.status).join(',') || '(空)'}。`
      + '**界面不许显示一个后端不认识的东西**(J-62 家族)',
      got.length === 1 && got[0]?.status === 'active',
      `顾客端=${JSON.stringify(got.map((c) => c.status))} 库里=${JSON.stringify(inDb)}`)

    await sleep(300)
    check('㋜4 不静默:挡掉的那张在**服务端日志里被点名**(看不见 ≠ 不存在)',
      /\[coupon-status\][^\n]*unused/.test(srvLog),
      (srvLog.match(/\[coupon-status\][^\n]*/g) || []).slice(0, 1).join(' ') || '(日志里没找到)')
  }
} finally {
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${checks} 条)`)
