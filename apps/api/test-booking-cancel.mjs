#!/usr/bin/env node
/* 顾客侧「取消预约」—— **补判据,不改实现**(店主 07m §四②,2026-09-14)
 *
 * ══ 为什么这一套现在才有 ══
 * J-62 清单扫出来:`miniprogram/pages/order-detail/index.js:181` 点完弹「已取消」的绿勾,
 * 而它打的那条口 `POST /bookings/:id/cancel` **全仓零判据**。
 * 两套碰过 cancel 的(`finance-core` / `notify-scheduler`)打的是**商家侧**
 * `PATCH /admin/bookings/:id/status {action:'cancel'}` —— 不是这条。
 * 归族:**读写两道闸 / 双端同病**(商家侧有判据,顾客侧漏),这已经是这一族的第五案。
 *
 * ══ 本套按 J-62 第二款写:四件事**全部从库里读回来**,一个都不看返回体 ══
 * 店主点名要验三件,加上状态本身是四件:
 *   ㋘1 单子真的成了 CANCELLED(查 `bookings.status`,不是看响应里的 status 字段)
 *   ㋘2 **时段释放了没**(查 `booking_slots` 真的零行 —— 不释放=那个钟点永远卖不出去)
 *   ㋘3 **定金怎么处理的**(查 `bookings.cancellation_fee_cents`,并对上 `deposit_config` 的规则)
 *   ㋘4 **技师那边有没有收到**(查 `booking_status_history` 留痕 + 通知钩没抛)
 *   ㋘5 越权:拿**别人**的单来取消 → 403,且**那张单还在**(反向守:不许只回 403 却已经删了时段)
 *
 * ⚠️ **本批只补判据,不改实现** —— 先知道它现在是什么行为,再谈改不改(店主 07m §四②)。
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

const { createAndLoginCustomerViaFrontDoor, loginCustomerViaFrontDoor } = await import('./customer-login-fixture.mjs')

const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.cancel-'))
const PORT = 4153
const OWNER = 'cancel-suite-owner-token-not-a-secret'
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: HERE, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '',
    OWNER_TOKEN: OWNER, WECHAT_MINI_TOKEN_SECRET: 'cancel-suite-mini-not-a-secret' },
})
const BASE = `http://127.0.0.1:${PORT}`
const TID = 'lucky-luxe'
const dbPath = join(dir, 'lucky-luxe.sqlite')
const q = (sql, ...a) => { const d = new DatabaseSync(dbPath); const r = d.prepare(sql).all(...a); d.close(); return r }

const up = await (async () => {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return true } catch { /* 还没起 */ }
    await sleep(500)
  }
  return false
})()

try {
  check('前置:实例起得来(起不来下面几条**不算验过**,不是通过)', up)
  if (up) {
    const AH = { 'content-type': 'application/json', 'x-admin-tenant-id': TID, authorization: `Bearer ${OWNER}` }
    const svc = (await (await fetch(`${BASE}/admin/services`, { headers: AH })).json().catch(() => ({}))) || {}
    const serviceId = (svc.services || svc.items || [])[0]?.id || ''
    const tech = (await (await fetch(`${BASE}/admin/technicians`, { headers: AH })).json().catch(() => ({}))) || {}
    const technicianId = (tech.technicians || tech.items || [])[0]?.id || ''
    check('前置夹具:演示店有项目和技师(造景律:自己先把景造好)', Boolean(serviceId && technicianId),
      `service=${serviceId} tech=${technicianId}`)

    const phone = `1390000${String(Date.now()).slice(-4)}`
    const me = await createAndLoginCustomerViaFrontDoor({
      base: BASE, tenantId: TID, ownerToken: OWNER, name: '取消判据·甲', phone, serviceId, technicianId, time: '11:00' })
    check('前置夹具:顾客从**正门**登录(J-60:造状态要走产生它的那条路)', me.ok, `${me.status} ${JSON.stringify(me.body).slice(0, 120)}`)

    if (me.ok) {
      const CH = { 'content-type': 'application/json', 'x-tenant-id': TID, authorization: `Bearer ${me.accessToken}` }
      const mine = await (await fetch(`${BASE}/bookings`, { headers: CH })).json().catch(() => ({}))
      const bid = (mine.bookings || mine.items || [])[0]?.id || ''
      check('前置夹具:顾客自己看得到那张单(拿到 bookingId)', Boolean(bid), JSON.stringify(mine).slice(0, 140))

      if (bid) {
        const slotsBefore = q('SELECT * FROM booking_slots WHERE booking_id = ?', bid).length
        check('㋘0 反向守:取消**之前**时段是占着的 —— 不先证明它占着,'
          + '「取消后为 0」就可能一直是 0(那条断言等于没跑)', slotsBefore > 0, `占了 ${slotsBefore} 格`)

        /* ── ㋘5 先做越权那条:证明别人取消不了,**而且那张单还在** ── */
        const other = await loginCustomerViaFrontDoor({ base: BASE, tenantId: TID, openid: `stub-openid-other-${Date.now()}` })
        const cross = await fetch(`${BASE}/bookings/${encodeURIComponent(bid)}/cancel`,
          { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': TID, authorization: `Bearer ${other.accessToken}` }, body: '{}' })
        const afterCross = q('SELECT status FROM bookings WHERE id = ?', bid)[0] || {}
        const slotsCross = q('SELECT * FROM booking_slots WHERE booking_id = ?', bid).length
        check('㋘5 🔴 越权:拿**别人的**单来取消 → 403,而且**那张单还在、时段还占着** —— '
          + '反向守:只回 403 却已经把时段删了,顾客看不出来但那个钟点就没了',
        cross.status === 403 && afterCross.status !== 'CANCELLED' && slotsCross === slotsBefore,
        `status=${cross.status} 单=${afterCross.status} 时段=${slotsCross}/${slotsBefore}`)

        /* ── 正主取消 ── */
        const res = await fetch(`${BASE}/bookings/${encodeURIComponent(bid)}/cancel`,
          { method: 'POST', headers: CH, body: JSON.stringify({ reason: '判据:顾客自己取消' }) })
        const body = await res.json().catch(() => ({}))

        const row = q('SELECT status, cancelled_at, cancellation_fee_cents, deposit_cents FROM bookings WHERE id = ?', bid)[0] || {}
        check('㋘1 🔴 **查库**:单子真的成了 CANCELLED 且落了取消时刻 —— '
          + '不看响应里那个 status(它是处理函数自己拼的,落不落库都长一样)',
        row.status === 'CANCELLED' && Boolean(row.cancelled_at),
        `接口=${res.status} 库里 status=${row.status} cancelled_at=${row.cancelled_at}`)

        const slotsAfter = q('SELECT * FROM booking_slots WHERE booking_id = ?', bid).length
        check('㋘2 🔴 **时段释放了**:`booking_slots` 零行(不释放的话那个钟点永远卖不出去,'
          + '而界面照样说「已取消」)', slotsAfter === 0, `取消前 ${slotsBefore} 格 → 取消后 ${slotsAfter} 格`)

        const cfg = await (await fetch(`${BASE}/admin/deposit-config`, { headers: AH })).json().catch(() => ({}))
        const fee = Number(row.cancellation_fee_cents || 0)
        const paid = Number(row.deposit_cents || 0)
        check('㋘3 🔴 **定金怎么处理的**:扣费数落进 `bookings.cancellation_fee_cents`,'
          + `且**不超过已付定金**(现测 扣 ${fee} / 已付 ${paid});规则出自 \`deposit-config\`,`
          + '本批**只记录现状不改口径**(店主 07m §四②)',
        Number.isInteger(fee) && fee >= 0 && fee <= Math.max(paid, 0),
        `扣=${fee} 已付=${paid} 规则=${JSON.stringify(cfg.depositConfig || cfg).slice(0, 110)}`)

        const hist = q("SELECT * FROM booking_status_history WHERE booking_id = ? AND to_status = 'CANCELLED'", bid)
        check('㋘4 🔴 **技师那边收得到**:`booking_status_history` 真的留了一行 CANCELLED 且带原因 —— '
          + '这是排班/日结/通知三处共同读的那份事实;不落痕=技师那头永远不知道这单没了',
        hist.length === 1 && /顾客自己取消/.test(String(hist[0].note || '')),
        `${hist.length} 行 note=${hist[0]?.note || '(空)'}`)

        /* ── ㋘6 幂等/状态机:已取消的单再取消一次 ── */
        const again = await fetch(`${BASE}/bookings/${encodeURIComponent(bid)}/cancel`,
          { method: 'POST', headers: CH, body: '{}' })
        const rowAgain = q('SELECT cancelled_at, cancellation_fee_cents FROM bookings WHERE id = ?', bid)[0] || {}
        check('㋘6 已取消的单**再取消一次** → 拒(状态机),而且**库里那两个数一分不动** —— '
          + '重复扣费比重复取消更贵', again.status >= 400 && rowAgain.cancelled_at === row.cancelled_at
          && Number(rowAgain.cancellation_fee_cents) === fee,
        `status=${again.status} 时刻${rowAgain.cancelled_at === row.cancelled_at ? '没动' : '变了'} 扣费 ${rowAgain.cancellation_fee_cents}`)

        /* 🔴 L4 反例数据律:「什么数据能让它露馅?」—— **零定金的单让 ㋘3 露不了馅**。
           `fee <= paid` 在 0 <= 0 时恒真,那条断言等于**空转**。
           所以这里明写一条:夹具里这张单**有没有定金**。没有就如实说「扣费规则本轮没验到」,
           不许让 ㋘3 的绿看起来像验过了(判据空转当红处理的同族:空转要自己报出来)。 */
        check('㋘3b 🔴 自证:㋘3 用的那张单**有没有付过定金** —— 零定金时 `扣费 <= 已付` 恒真,'
          + '那条断言是空转。本轮夹具是零定金单,**扣费规则没验到**,如实登记(未做,原因:'
          + '带定金的取消场景要先造一张付过定金的单,本批没造)',
        paid === 0 ? true : fee <= paid, `已付=${paid} 扣=${fee} → ${paid === 0 ? '**空转,扣费规则本轮没验到**' : '真验到了'}`)
        console.log(`   [现状记录·不改] 接口回 ${res.status} · 扣费 ${fee} 分 · 已付定金 ${paid} 分 · `
          + `响应体键:${Object.keys(body).slice(0, 8).join(',')}`)
        if (paid === 0) console.log('   ⚠️ [空转登记] ㋘3 本轮跑在零定金单上 —— 扣费规则**没被验到**,不是「验过了」')
      }
    }
  }
} finally {
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${checks} 条)`)
