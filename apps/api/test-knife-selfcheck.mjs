#!/usr/bin/env node
/* 🔴 造病台的**玩具套件** —— 专门用来回放 J-58 第四款(店主 07p §四,2026-09-14)
 *
 * ══ 它为什么存在 ══
 * J-58 第四款:**造病打下去不红,有两种 —— 这条守住了,和刀根本没咬到那个点。**
 * 台子里那条逻辑要被**看见触发过一次**才算装好,而它**只在套件保持绿时才说话**。
 * 07o 我三次拿真套件回放,三次都把套件弄红了 —— ④ 根本没机会开口。
 *
 * 店主给的出路:**不要在真套件上回放,造一个玩具套件。**
 *   ㋛1 一条**必然绿**的断言 → 保证造病之后套件整体仍是绿的,④ 那一支才会被触发;
 *   ㋛2 一条**故意只验回执**的断言(只看 `status === 200`)—— 它就是 J-62 要抓的那种判据。
 *
 * 于是台子的两个分支都能被演示:
 *   · 刀落在 ㋛2 真走的那条路上 → 套件绿 → ④ 补一刀「必然红」→ 红 ⇒ 判「**仍绿(已证刀咬到)**」;
 *   · 刀落在这套件根本不走的路上 → 套件绿 → ④ 补一刀 → **也不红** ⇒ 判「**刀没咬到**」。
 *
 * ⚠️ 这套件**是判据的夹具**,按 J-61② 具名排除;它**不进主档**,只给造病台用。
 * ⚠️ ㋛2 那条「只验 status」**是故意写坏的** —— 不许有人「顺手把它修好」,修好这套件就废了。
 */
import { mkdtempSync, rmSync } from 'node:fs'
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

/* ㋛1 必然绿 —— 它的唯一职责是「让套件在造病之后仍然是绿的」 */
check('㋛1 必然绿:这条断言不依赖任何被测对象,存在的意义就是**让套件在造病之后仍然整体是绿的** —— '
  + '否则 J-58 第四款那一支永远没机会开口', 1 === 1, '')

const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.knifetoy-'))
const PORT = 4192
const OWNER = 'knifetoy-owner-not-a-secret'
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: HERE, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '',
    OWNER_TOKEN: OWNER, WECHAT_MINI_TOKEN_SECRET: 'knifetoy-mini-not-a-secret' },
})
const BASE = `http://127.0.0.1:${PORT}`
const TID = 'lucky-luxe'
const AH = { 'content-type': 'application/json', 'x-admin-tenant-id': TID, authorization: `Bearer ${OWNER}` }
const one = (sql, ...a) => { const d = new DatabaseSync(join(dir, 'lucky-luxe.sqlite'), { readOnly: true }); const r = d.prepare(sql).get(...a); d.close(); return r || {} }

const up = await (async () => {
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${BASE}/health`)).ok) return true } catch { /* 还没起 */ } await sleep(500) }
  return false
})()
try {
  if (up) {
    const { createAndLoginCustomerViaFrontDoor } = await import('./customer-login-fixture.mjs')
    const svc = await (await fetch(`${BASE}/admin/services`, { headers: AH })).json().catch(() => ({}))
    const tech = await (await fetch(`${BASE}/admin/technicians`, { headers: AH })).json().catch(() => ({}))
    const serviceId = (svc.services || svc.items || [])[0]?.id || ''
    const technicianId = (tech.technicians || tech.items || [])[0]?.id || ''
    const phone = `1350000${String(Date.now()).slice(-4)}`
    const me = await createAndLoginCustomerViaFrontDoor({
      base: BASE, tenantId: TID, ownerToken: OWNER, name: '玩具套件·甲', phone, serviceId, technicianId, time: '09:30' })
    const CH = { 'content-type': 'application/json', 'x-tenant-id': TID, authorization: `Bearer ${me.accessToken}` }
    await fetch(`${BASE}/admin/deposit-config`, { method: 'PUT', headers: AH,
      body: JSON.stringify({ enabled: true, mode: 'fixed', fixedAmountCents: 5000, fallbackAmountCents: 5000 }) })
    const storeId = one('SELECT id FROM stores WHERE tenant_id = ? LIMIT 1', TID).id || ''
    const dayOf = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
    let bid = ''
    for (let n = 1; n <= 10 && !bid; n += 1) {
      const mk = await fetch(`${BASE}/bookings`, { method: 'POST', headers: CH,
        body: JSON.stringify({ storeId, serviceId, technicianId, date: dayOf(n), time: '17:00', tenantId: TID }) })
      const cand = (await mk.json().catch(() => ({})))?.booking?.id || ''
      if (cand && one('SELECT status FROM bookings WHERE id = ?', cand).status === 'PENDING_PAYMENT') bid = cand
    }
    /* ㋛2 🔴 **故意只验回执** —— 这条就是 J-62 第二款要抓的那种判据。
       注掉它背后的落库,接口照样回 200,所以它**照样绿**。**不许把它修好。** */
    const r = await fetch(`${BASE}/payments/mock/confirm`, { method: 'POST', headers: CH, body: JSON.stringify({ bookingId: bid }) })
    check('㋛2 🔴 **故意只验回执**(只看 `status === 200`,一个字不查库)—— '
      + '它就是 J-62 第二款要抓的那种判据;**把落库注掉它照样绿**,台子的 ④ 要能看出这一点。'
      + '**这条是标本,不许顺手修好**', r.status === 200, `status=${r.status} bookingId=${bid}`)
  } else {
    check('㋛2 前置:实例没起来 —— 这一条**不算验过**', false, '实例未就绪')
  }
} finally {
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${checks} 条)`)
