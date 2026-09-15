#!/usr/bin/env node
/* 🔴 顾客能走、却一次都没被夹具走过的路(店主 07o §二,2026-09-14)
 *
 * ══ 为什么这四条要先走 ══
 * J-60 第二款:**一条从来没有夹具走过的路,等于从来没被走过。** D191 就是这么躺住的。
 * `tools/customer-paths-scan.mjs` 现测:顾客能走的路 40 条,**8 条一次都没走过** ——
 * 其中**两条是支付**。微信支付刚申请下来,上线就要收钱,而收钱那条路一个夹具都没走过。
 *
 * 本套走四条(店主点名的优先级):
 *   ㋚1  `POST /payments/mock/confirm`            —— 涉钱
 *   ㋚2  `POST /payments/stripe/confirm-session`  —— 涉钱
 *   ㋚3  `GET  /my/coupons`                       —— 卡包(顾客直接看)
 *   ㋚4  `GET  /my/points-history`                —— 积分(顾客直接看)
 *
 * ⚠️ 全部按 **J-62 第二款**写:**不许只看返回体,要从库里读回来**。
 * 支付那两条尤其:接口回 200 不代表钱记上了。
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

const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.custpath-'))
const PORT = 4157
const OWNER = 'custpath-owner-not-a-secret'
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: HERE, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '',
    OWNER_TOKEN: OWNER, WECHAT_MINI_TOKEN_SECRET: 'custpath-mini-not-a-secret' },
})
const BASE = `http://127.0.0.1:${PORT}`
const TID = 'lucky-luxe'
const dbPath = join(dir, 'lucky-luxe.sqlite')
const one = (sql, ...a) => { const d = new DatabaseSync(dbPath, { readOnly: true }); const r = d.prepare(sql).get(...a); d.close(); return r || {} }
const all = (sql, ...a) => { const d = new DatabaseSync(dbPath, { readOnly: true }); const r = d.prepare(sql).all(...a); d.close(); return r }
const AH = { 'content-type': 'application/json', 'x-admin-tenant-id': TID, authorization: `Bearer ${OWNER}` }

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

    /* 顾客从正门来(J-60) */
    const phone = `1360000${String(Date.now()).slice(-4)}`
    const me = await createAndLoginCustomerViaFrontDoor({
      base: BASE, tenantId: TID, ownerToken: OWNER, name: '走路判据·甲', phone, serviceId, technicianId, time: '10:30' })
    check('前置夹具:顾客从**正门**登录(J-60:造状态要走产生它的那条路)', me.ok,
      `${me.status} ${JSON.stringify(me.body).slice(0, 120)}`)
    const CH = { 'content-type': 'application/json', 'x-tenant-id': TID, authorization: `Bearer ${me.accessToken}` }

    /* ── 造一张 PENDING_PAYMENT 的单:顾客自己下单 + 本店要定金 ── */
    await fetch(`${BASE}/admin/deposit-config`, { method: 'PUT', headers: AH,
      body: JSON.stringify({ enabled: true, mode: 'fixed', fixedAmountCents: 5000, fallbackAmountCents: 5000 }) })
    const cfgNow = await (await fetch(`${BASE}/admin/deposit-config`, { headers: AH })).json().catch(() => ({}))
    check('㋚0a 造景前置:本店**真的开了定金**(不开的话顾客下单直接 CONFIRMED,'
      + '支付那两条路根本走不到 —— 那就不是「守住了」,是「没走到」,J-58 第四款)',
      Boolean(cfgNow?.config?.enabled), JSON.stringify(cfgNow?.config || {}).slice(0, 140))
    const dayOf = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
    const storeId = one('SELECT id FROM stores WHERE tenant_id = ? LIMIT 1', TID).id || ''
    let bid = ''
    for (let n = 1; n <= 10 && !bid; n += 1) {
      const mk = await fetch(`${BASE}/bookings`, { method: 'POST', headers: CH,
        body: JSON.stringify({ storeId, serviceId, technicianId, date: dayOf(n), time: '15:00', tenantId: TID }) })
      const mb = await mk.json().catch(() => ({}))
      const cand = mb?.booking?.id || ''
      if (cand && one('SELECT status FROM bookings WHERE id = ?', cand).status === 'PENDING_PAYMENT') bid = cand
    }
    check('㋚0 造景:顾客自己下出一张**待付定金**的单(`PENDING_PAYMENT`)—— '
      + '造不出这个状态,支付那两条就没得走(造景律:谁出走查单谁先把景造好)',
      Boolean(bid) && one('SELECT status FROM bookings WHERE id = ?', bid).status === 'PENDING_PAYMENT',
      `bookingId=${bid} 状态=${one('SELECT status FROM bookings WHERE id = ?', bid).status}`)

    if (bid) {
      /* ── ㋚1 `/payments/mock/confirm` ── */
      const payBefore = one("SELECT status, transaction_id FROM payments WHERE booking_id = ? AND provider = 'MOCK'", bid)
      const r1 = await fetch(`${BASE}/payments/mock/confirm`, { method: 'POST', headers: CH, body: JSON.stringify({ bookingId: bid }) })
      const payAfter = one("SELECT status, transaction_id FROM payments WHERE booking_id = ? AND provider = 'MOCK'", bid)
      const bkAfter = one('SELECT status FROM bookings WHERE id = ?', bid)
      const hist = all("SELECT note FROM booking_status_history WHERE booking_id = ? AND to_status = 'CONFIRMED'", bid)
      check('㋚1 🔴 `POST /payments/mock/confirm`(**涉钱,此前零夹具走过**)—— '
        + `**查库**:payments 从 ${payBefore.status || '(无)'} → **${payAfter.status}** 且拿到流水号 · `
        + `预约 → **${bkAfter.status}** · 状态历史留痕 ${hist.length} 行。不看返回体`,
        r1.status === 200 && payAfter.status === 'PAID' && String(payAfter.transaction_id || '').startsWith('mock_')
        && bkAfter.status === 'CONFIRMED' && hist.length === 1,
        `接口=${r1.status} 支付=${payAfter.status}/${payAfter.transaction_id} 预约=${bkAfter.status} 留痕=${hist.length}`)

      /* ㋚1b 幂等:付过的单再付一次 → 拒,且库里一分不动 */
      const again = await fetch(`${BASE}/payments/mock/confirm`, { method: 'POST', headers: CH, body: JSON.stringify({ bookingId: bid }) })
      const payAgain = one("SELECT status, transaction_id FROM payments WHERE booking_id = ? AND provider = 'MOCK'", bid)
      const histAgain = all("SELECT note FROM booking_status_history WHERE booking_id = ? AND to_status = 'CONFIRMED'", bid)
      check('㋚1b 🔴 幂等:付过的单**再付一次 → 拒**,且库里流水号与状态历史**一分不动** —— '
        + '重复确认一笔定金比拒绝一次贵得多',
        again.status >= 400 && payAgain.transaction_id === payAfter.transaction_id && histAgain.length === 1,
        `再付=${again.status} 流水号${payAgain.transaction_id === payAfter.transaction_id ? '没变' : '变了'} 留痕=${histAgain.length}`)

      /* ── ㋚2 `/payments/stripe/confirm-session` ── */
      let bid2 = ''
      for (let n = 1; n <= 10 && !bid2; n += 1) {
        const mk = await fetch(`${BASE}/bookings`, { method: 'POST', headers: CH,
          body: JSON.stringify({ storeId, serviceId, technicianId, date: dayOf(n), time: '16:00', tenantId: TID }) })
        const cand = (await mk.json().catch(() => ({})))?.booking?.id || ''
        if (cand && one('SELECT status FROM bookings WHERE id = ?', cand).status === 'PENDING_PAYMENT') bid2 = cand
      }
      const r2 = await fetch(`${BASE}/payments/stripe/confirm-session`, { method: 'POST', headers: CH, body: JSON.stringify({ bookingId: bid2 }) })
      const bk2 = one('SELECT status FROM bookings WHERE id = ?', bid2)
      const pay2 = one("SELECT status FROM payments WHERE booking_id = ? AND provider = 'MOCK'", bid2)
      check('㋚2 🔴 `POST /payments/stripe/confirm-session`(**涉钱,此前零夹具走过**)—— '
        + `**查库**:预约 → **${bk2.status}** · 支付 → **${pay2.status}**`,
        Boolean(bid2) && r2.status === 200 && bk2.status === 'CONFIRMED' && pay2.status === 'PAID',
        `bookingId=${bid2} 接口=${r2.status} 预约=${bk2.status} 支付=${pay2.status}`)
    }

    /* ── ㋚3 卡包 `/my/coupons` ── */
    const cp = await (await fetch(`${BASE}/admin/coupons`, { method: 'POST', headers: AH,
      body: JSON.stringify({ name: `走路判据券${Date.now()}`, discountType: 'amount', amountCents: 3000, validDays: 30, totalQty: 5, isActive: true }) })).json().catch(() => ({}))
    const couponId = cp?.coupon?.id || ''
    await fetch(`${BASE}/admin/coupons/${encodeURIComponent(couponId)}/grant`, { method: 'POST', headers: AH,
      body: JSON.stringify({ userId: me.userId }) })
    const grantsInDb = all("SELECT id, status FROM coupon_grants WHERE user_id = ? AND tenant_id = ?", me.userId, TID)
    const myCoupons = await (await fetch(`${BASE}/my/coupons`, { headers: CH })).json().catch(() => ({}))
    const listed = (myCoupons.coupons || myCoupons.items || myCoupons.grants || [])
    check('㋚3 🔴 `GET /my/coupons`(卡包,此前零夹具走过)—— '
      + `商家发 1 张 → **库里 ${grantsInDb.length} 张(${grantsInDb.map((g) => g.status).join(',')})** → `
      + `顾客端看得到 **${listed.length}** 张,两边对得上`,
      grantsInDb.length === 1 && grantsInDb[0].status === 'active' && listed.length === grantsInDb.length,
      `库=${JSON.stringify(grantsInDb)} 顾客端=${JSON.stringify(myCoupons).slice(0, 160)}`)

    /* ── ㋚4 积分 `/my/points-history` ── */
    const ptsBefore = all('SELECT id, amount FROM points_transactions WHERE user_id = ? AND tenant_id = ?', me.userId, TID)
    const histEmpty = await (await fetch(`${BASE}/my/points-history`, { headers: CH })).json().catch(() => ({}))
    check('㋚4 🔴 `GET /my/points-history`(积分,此前零夹具走过)· **空态** —— '
      + `她还没消费过,库里 ${ptsBefore.length} 条台账、零张签署单,顾客端出 `
      + `${(histEmpty.records || []).length} 条。空态也要走通、不许 500`,
      Array.isArray(histEmpty.records) && histEmpty.records.length === 0,
      JSON.stringify(histEmpty).slice(0, 140))

    /* ══ ㋚5 🔴 造一条**真积分**再验(店主 07p §五)══
       「0 条空态」只证明了「读得到 0」,**没证明「积分跟过去了」** —— 空态验不出「搬过去了」,
       只验得出「没崩」。所以这里走真路径造一条:**开单 → 顾客签字**。
       ⚠️ 查清了一件要紧的:积分「挣」出来的那部分**不在 `points_transactions` 里** ——
       `pointsEarnRows()` 是从**已签署的结算单**推的(`floor(subtotal_cents / 100)`),
       台账只记兑换与调整。所以这条要比的是**签署单那一行**,而它的 `id` 就是赚分行的 `id`。 */
    const sheetRes = await fetch(`${BASE}/admin/settlements`, { method: 'POST', headers: AH,
      body: JSON.stringify({ cardOwnerUserId: me.userId, settlements: [{ bookingId: bid, tierKey: 'member', payIntent: 'offline_full',
        items: [{ serviceId }], technicians: [{ technicianId, share: 100 }] }] }) })
    const sheetBody = await sheetRes.json().catch(() => ({}))
    const sheet = sheetBody?.settlements?.[0] || {}
    const signRes = await fetch(`${BASE}/settlements/${encodeURIComponent(sheet.code || '')}/sign`,
      { method: 'POST', headers: CH, body: JSON.stringify({ disclaimerAccepted: true, signature: '走路判据·甲' }) })
    const signed = one("SELECT id, code, status, subtotal_cents, user_id FROM settlements WHERE code = ?", sheet.code || '')
    check('㋚5a 造景:开单 + **顾客自己签字**(走正门,不直连库贴)—— '
      + `库里那张单 \`${signed.code || '(没建出来)'}\` 状态 **${signed.status || '?'}**,小计 ${signed.subtotal_cents || 0} 分`,
      signRes.status < 400 && signed.status === 'signed' && Number(signed.subtotal_cents) > 0,
      `建单=${sheetRes.status} 签字=${signRes.status} 库里=${JSON.stringify(signed)}`)

    const histNow = await (await fetch(`${BASE}/my/points-history`, { headers: CH })).json().catch(() => ({}))
    const recs = histNow.records || []
    const wantDelta = Math.floor(Number(signed.subtotal_cents || 0) / 100)
    const hit = recs.find((r) => r.id === signed.id)
    check('㋚5 🔴 **积分真的跟过去了**(按**行 id** 比,和验余额那次同一个法子)—— '
      + `顾客端 \`/my/points-history\` 里有一行 \`id = ${signed.id}\`(**就是那张签署单的 id**),`
      + `分值 **${hit?.delta}** = floor(${signed.subtotal_cents}/100) = **${wantDelta}**;`
      + `台账从 ${ptsBefore.length} 条 → 这次多出来的是**赚分行**不是台账行`,
      Boolean(hit) && hit.delta === wantDelta && wantDelta > 0,
      `记录数 ${recs.length} · 找到=${JSON.stringify(hit)} · 期望 delta=${wantDelta}`)

    /* ══ ㋚6/㋚7/㋚8 · 🔴 签署口三条判据,**从 fail-fast 后面救出来**(店主 07s §七③ / 07v ①)══
     *
     * 案由(夜12 段C 现测):把「签字落库」整条注掉,`scan-sign` 里
     * **没有任何一条说「签字成功了」的断言变红** —— 红的是并发那条,**撞上的**。
     * 而真正该咬到的三条恰恰**全在「没跑到」的 10 条里**:`scan-sign` 是 fail-fast,
     * 半路 `throw` 就断了,它们根本没机会说话。
     * 店主的定性:**「签署结算单就是顾客确认自己花了多少钱」，这条路上的判据是空的。**
     *
     * 所以搬到这里 —— 本套件**不 fail-fast**(check 记账继续),刀落下去它们跑得到。
     * 三条都按 J-62 第二款写:**从事实那头读回来**,不看这一次调用的返回体。 */
    const sheetId = one('SELECT id FROM settlements WHERE code = ?', sheet.code || '').id || ''
    const ro = await (await fetch(`${BASE}/settlements/${encodeURIComponent(sheet.code || '')}`, { headers: CH })).json().catch(() => ({}))
    check('㋚6 🔴 签完**另一入口变已签只读** —— 从别的口再取这张单,它说自己是 `signed`。'
      + '这一条此前在 `scan-sign` 的 fail-fast 后面,刀落下去根本跑不到',
      ro?.settlement?.status === 'signed',
      `另一入口拿到的 status=${ro?.settlement?.status} · 库里=${one('SELECT status FROM settlements WHERE code = ?', sheet.code || '').status}`)

    const qrAgain = await fetch(`${BASE}/admin/settlements/${encodeURIComponent(sheetId)}/sign-token`,
      { method: 'POST', headers: AH, body: '{}' })
    const qrBody = await qrAgain.json().catch(() => ({}))
    check('㋚7 🔴 **已签的单不再出新码** —— 再要一次签字码必须 400 `ALREADY_SIGNED`。'
      + '出得来就等于同一张单能被签第二次',
      qrAgain.status === 400 && qrBody?.error?.code === 'ALREADY_SIGNED',
      `status=${qrAgain.status} code=${qrBody?.error?.code}`)

    const cons = await (await fetch(`${BASE}/admin/finance/deposit-conservation`, { headers: AH })).json().catch(() => ({}))
    check('㋚8 🔴 **财务红线:整条链跑完,定金守恒仍 ok** —— '
      + '这一条是钱的总账,它红意味着定金在某一步对不上',
      cons?.ok === true, JSON.stringify(cons?.broken || cons).slice(0, 180))
  }
} finally {
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${checks} 条)`)
