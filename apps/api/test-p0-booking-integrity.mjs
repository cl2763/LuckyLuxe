import {randomBytes} from 'node:crypto'
// 真实顾客路径回归：未收≠已收、配置时长≡占位时长、签署文书按门店时区。
// 只启动自有临时库/端口；夹具经业务接口创建，SQL 只读核验。
import { mkdtempSync, rmSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.p0-integrity-'))
const port = Number(process.env.P0_TEST_PORT || 4336)
const base = `http://127.0.0.1:${port}`
const owner = 'p0-integrity-owner-test-only'
const log = openSync(join(dir, 'server.log'), 'w')
const child = spawn(process.execPath, ['local-server.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', log, log],
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, OWNER_TOKEN: owner,
    WECHAT_MINI_TOKEN_SECRET: 'p0-integrity-mini-test-only', NOTIFY_TICK: 'off', TEST_DB_PATH: '', COS_BUCKET: '',
    ONLINE_PAYMENT_READY: 'true' } }) // 即使旧变量误开，也不能把占位支付当真实通道。
let db, count = 0
const failures = []
function check(label, ok, detail = '') { count++; console.log(`${ok ? 'ok' : 'not ok'} ${count} - ${label}${!ok ? ' :: '+detail : ''}`); if (!ok) failures.push(label) }
async function req(path, { token = owner, tid, method = 'GET', body } = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(tid ? { 'x-tenant-id': tid } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
try {
  let ready = false
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) break; try { ready = (await req('/health')).status === 200 } catch {} if (ready) break; await new Promise(r => setTimeout(r, 100)) }
  if (!ready) throw new Error(`隔离服务未启动；日志 ${dir}/server.log`)
  db = new DatabaseSync(join(dir, 'lucky-luxe.sqlite'), { readOnly: true })
  const day = '2030-10-07'
  for (const [tag, tz, utc] of [['sh', 'Asia/Shanghai', '02:00'], ['tor', 'America/Toronto', '14:00']]) {
    const tid = `p0-${tag}`
    const made = await req('/platform/tenants', { method: 'POST', body: { id: tid, name: `P0 ${tag}`, timezone: tz, currency: tag === 'sh' ? 'CNY' : 'CAD', plan: 'chain' } })
    if (made.status !== 201) throw new Error(JSON.stringify(made))
    const account = made.data.owner
    const first = await req('/admin/auth/login', { token: null, method: 'POST', body: { email: account.username, password: account.initialPassword } })
    const password = randomBytes(16).toString('hex')
    await req('/admin/auth/change-password', { token: first.data.auth.accessToken, method: 'POST', body: { oldPassword: account.initialPassword, newPassword: password, confirmPassword: password } })
    const logged = await req('/admin/auth/login', { token: null, method: 'POST', body: { email: account.username, password } })
    const admin = logged.data.auth.accessToken
    const store = (await req('/admin/business-hours', { token: admin })).data.stores[0]
    await req('/admin/business-hours', { token: admin, method: 'PUT', body: { storeId: store.id, hours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, openTime: '08:00', closeTime: '22:00', isClosed: false })) } })
    await req('/admin/deposit-config', { token: admin, method: 'PUT', body: { enabled: true, mode: 'fixed', fixedAmountCents: 10000, fallbackAmountCents: 10000, memberWaive: 'none', deductible: true, cancelPolicy:{rescheduleNoticeHours:24,depositRetainTimes:1} } })
    const svc = (await req(`/platform/tenants/${tid}/services`, { method: 'POST', body: { type: 'NAIL', nameZh: '90分钟项目', nameEn: '90 minute service', priceCents: 36800, baseDurationMin: 90 } })).data.service
    const tech = (await req(`/platform/tenants/${tid}/technicians`, { method: 'POST', body: { name: '验收技师' } })).data.technician
    const login = await req('/auth/wechat/mini-login', { token: null, tid, method: 'POST', body: { code: `stub:p0-${tag}`, tenantId: tid } })
    const customer = login.data.auth.accessToken
    const policy = await req('/store/deposit-policy?serviceId=' + svc.id, { token: null, tid })
    check(`${tag}: 未实装支付不能被环境开关假报可用`, policy.data.onlinePaymentReady === false)
    const input = { storeId: store.id, serviceId: svc.id, technicianId: tech.id, date: day, time: '10:00' }
    const available = await req(`/availability?storeId=${store.id}&serviceId=${svc.id}&technicianId=${tech.id}&date=${day}`, { token: null, tid })
    check(`${tag}: 公开时段按90分钟项目计算`, available.data.durationMin === 90, JSON.stringify(available.data).slice(0, 180))
    const created = await req('/bookings', { token: customer, tid, method: 'POST', body: input })
    if (created.status !== 201) throw new Error(JSON.stringify(created))
    const b = created.data.booking
    check(`${tag}: 到店收取的预约直接确认且不设支付超时`, b.status === 'CONFIRMED' && b.paymentExpiresAt === null, JSON.stringify({ status: b.status, expires: b.paymentExpiresAt }))
    check(`${tag}: 定金应收100，已收0，待收标记真实`, b.depositRequiredCents === 10000 && b.depositCents === 0 && b.depositState === 'unpaid', JSON.stringify({ required: b.depositRequiredCents, paid: b.depositCents, state: b.depositState }))
    check(`${tag}: 未收定金不得从剩余应付中扣除`, b.finalDueCents === 36800, String(b.finalDueCents))
    check(`${tag}: 90分钟项目结束11:30，绝对时间按门店`, b.totalDurationMin === 90 && b.appointmentEndTime === '11:30' && b.appointmentStart === `${day}T${utc}:00.000Z`, JSON.stringify({ end: b.appointmentEndTime, start: b.appointmentStart }))
    const fingerprint = () => JSON.stringify({ booking: db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id), payments: db.prepare('SELECT * FROM payments WHERE booking_id=?').all(b.id), receipts: db.prepare('SELECT * FROM deposit_receipts WHERE booking_id=?').all(b.id) })
    const before = fingerprint()
    for (const path of ['/payments/mock/confirm', '/payments/stripe/create-checkout', '/payments/stripe/confirm-session']) {
      const result = await req(path, { token: customer, tid, method: 'POST', body: { bookingId: b.id } })
      check(`${tag}: ${path} 不能制造收款`, result.status === 410 && fingerprint() === before, String(result.status))
    }
    const conflict = await req('/bookings', { token: customer, tid, method: 'POST', body: { ...input, time: '11:00' } })
    check(`${tag}: 未收款也必须占位防重复预约`, conflict.status === 409, String(conflict.status))
    const next = await req('/bookings', { token: customer, tid, method: 'POST', body: { ...input, time: '11:30' } })
    check(`${tag}: 90分钟边界之后立即可约`, next.status === 201, JSON.stringify(next.data).slice(0, 120))
    const movedBooking=next.data.booking
    const move=(body)=>req(`/admin/bookings/${movedBooking.id}/reschedule`,{token:admin,method:'POST',body})
    const originalRow=JSON.stringify(db.prepare('SELECT * FROM bookings WHERE id=?').get(movedBooking.id))
    const blockedMove=await move({date:day,time:'10:30'})
    check(`${tag}: 改期撞单409且原预约及占位保留`,blockedMove.status===409&&JSON.stringify(db.prepare('SELECT * FROM bookings WHERE id=?').get(movedBooking.id))===originalRow&&db.prepare('SELECT COUNT(*) n FROM booking_slots WHERE booking_id=?').get(movedBooking.id).n===3)
    const invalidMove=await move({date:'2030-02-30',time:'16:00'})
    const pastMove=await move({date:'2020-01-01',time:'16:00'})
    check(`${tag}: 无效日期和过去日期明确拒绝`,invalidMove.status===400&&pastMove.status===400)
    const moved=await move({date:day,time:'16:00',expectedStart:movedBooking.appointmentStart})
    check(`${tag}: 未收定金预约真改到16:00，单号时长金额不变`,moved.status===200&&moved.data.booking?.id===movedBooking.id&&moved.data.booking?.appointmentTime==='16:00'&&moved.data.booking?.totalDurationMin===90&&moved.data.booking?.finalDueCents===36800,JSON.stringify(moved.data).slice(0,160))
    const movedRead=(await req(`/bookings/${movedBooking.id}`,{token:customer,tid})).data.booking
    check(`${tag}: 顾客同单读回新时间`,movedRead.appointmentTime==='16:00')
    const oldFree=await req('/bookings',{token:customer,tid,method:'POST',body:{...input,time:'11:30'}})
    const newTaken=await req('/bookings',{token:customer,tid,method:'POST',body:{...input,time:'16:00'}})
    check(`${tag}: 改期释放旧时段并锁住新时段`,oldFree.status===201&&newTaken.status===409)
    const stale=await move({date:day,time:'18:00',expectedStart:movedBooking.appointmentStart})
    check(`${tag}: 旧页面再次改期被冲突提示拦下`,stale.status===409&&stale.data.error.code==='BOOKING_CHANGED')
    await req(`/admin/bookings/${movedBooking.id}/deposit-receipt`,{token:admin,method:'POST',body:{payChannel:'cash'}})
    const paidMove=await move({date:day,time:'18:00'})
    const policyMove=await move({date:day,time:'20:00'})
    check(`${tag}: 实收定金合规改期保留一次，不重复收取`,paidMove.status===200&&paidMove.data.booking.depositCents===10000&&db.prepare("SELECT COUNT(*) n FROM deposit_receipts WHERE booking_id=? AND kind='receipt'").get(movedBooking.id).n===1)
    check(`${tag}: 超定金保留次数明确拒绝，原单18:00不变`,policyMove.status===409&&policyMove.data.error.code==='DEPOSIT_POLICY_REQUIRED'&&db.prepare('SELECT appointment_start FROM bookings WHERE id=?').get(movedBooking.id).appointment_start===paidMove.data.booking.appointmentStart)
    const lash = (await req(`/platform/tenants/${tid}/services`, { method: 'POST', body: { type: 'LASH', nameZh: '45分钟美睫', nameEn: 'Lash', priceCents: 20000, baseDurationMin: 45 } })).data.service
    const lashInput = { ...input, serviceId: lash.id, time: '14:00', addOns: [{ name: '加项', durationMin: 15, priceCents: 0 }] }
    const lashBooking = await req('/bookings', { token: customer, tid, method: 'POST', body: lashInput })
    check(`${tag}: 美睫45分钟加15分钟，合计60分钟`, lashBooking.data.booking?.totalDurationMin === 60 && lashBooking.data.booking?.appointmentEndTime === '15:00', JSON.stringify(lashBooking.data).slice(0, 100))
    const badDuration = await req('/bookings', { token: customer, tid, method: 'POST', body: { ...lashInput, time: '16:00', addOns: [{ durationMin: -30 }] } })
    check(`${tag}: 负数加项时长被拒绝`, badDuration.status === 400)
    const shortInput={...input,serviceId:lash.id,time:'20:00',addOns:[]}
    const short=await req('/bookings',{token:customer,tid,method:'POST',body:shortInput})
    const overlapOffGrid=await req('/bookings',{token:customer,tid,method:'POST',body:{...shortInput,time:'20:15'}})
    const borderOffGrid=await req('/bookings',{token:customer,tid,method:'POST',body:{...shortInput,time:'20:45'}})
    check(`${tag}: 45分钟真实结束20:45，非半点交叠被拒，紧邻边界可约`,short.data.booking?.appointmentEndTime==='20:45'&&overlapOffGrid.status===409&&borderOffGrid.status===201)
    const publicSlots=(await req(`/availability?storeId=${store.id}&serviceId=${lash.id}&technicianId=${tech.id}&date=${day}`,{token:null,tid})).data.slots.flatMap(x=>x.slots)
    check(`${tag}: 公开可约时段不再错误列出非整点订单占用的21:00`,!publicSlots.includes('20:30')&&!publicSlots.includes('21:00'))
    const paidOld=oldFree.data.booking
    await req(`/admin/bookings/${paidOld.id}/deposit-receipt`,{token:admin,method:'POST',body:{payChannel:'cash'}})
    const retained=await req(`/admin/bookings/${paidOld.id}/reschedule`,{token:admin,method:'POST',body:{reason:'旧流程定金部分使用验收'}})
    check(`${tag}: 旧改期流程确实保留实收100`,retained.status===200&&retained.data.reschedule.retainAmountCents===10000)
    await req('/admin/deposit-config',{token:admin,method:'PUT',body:{fixedAmountCents:5000,fallbackAmountCents:5000}})
    const carried=await req('/bookings',{token:customer,tid,method:'POST',body:{...input,date:'2030-10-08',time:'10:00'}})
    const remainder=db.prepare("SELECT amount_cents FROM deposit_retains WHERE source_booking_id=? AND status='active'").get(paidOld.id)
    check(`${tag}: 100保留定金仅用50，剩余50继续保留`,carried.status===201&&carried.data.booking.depositCents===5000&&remainder?.amount_cents===5000)
    const carry2=await req('/bookings',{token:customer,tid,method:'POST',body:{...input,date:'2030-10-08',time:'12:00'}})
    const remaining=db.prepare("SELECT COUNT(*) n FROM deposit_retains WHERE source_booking_id=? AND status='active'").get(paidOld.id).n
    const ids=[paidOld.id,carried.data.booking.id,carry2.data.booking.id]
    const realTotal=db.prepare(`SELECT SUM(d.amount_cents) n FROM deposit_receipts d WHERE d.booking_id IN (?,?,?) AND d.kind='receipt' AND NOT EXISTS(SELECT 1 FROM deposit_receipts x WHERE x.revoke_of=d.id)`).get(...ids).n
    check(`${tag}: 剩余50可用一次，原收款100在三单合计仍为100`,carry2.status===201&&carry2.data.booking.depositCents===5000&&remaining===0&&realTotal===10000,String(realTotal))
    await req('/admin/deposit-config',{token:admin,method:'PUT',body:{fixedAmountCents:10000,fallbackAmountCents:10000}})
    const unpaidReceipts = db.prepare('SELECT COUNT(*) n FROM deposit_receipts WHERE booking_id=?').get(b.id).n
    check(`${tag}: 未收时不存在虚构收取记录`, unpaidReceipts === 0)
    const receipt = await req(`/admin/bookings/${b.id}/deposit-receipt`, { token: admin, method: 'POST', body: { payChannel: 'cash' } })
    const repeat = await req(`/admin/bookings/${b.id}/deposit-receipt`, { token: admin, method: 'POST', body: { payChannel: 'cash' } })
    check(`${tag}: 商家登记后才已收100，重复登记只有一笔`, receipt.status === 201 && repeat.status === 200 && receipt.data.booking.depositCents === 10000 && db.prepare("SELECT COUNT(*) n FROM deposit_receipts WHERE booking_id=? AND kind='receipt'").get(b.id).n === 1)
    check(`${tag}: 收取后剩余应付268`, receipt.data.booking.finalDueCents === 26800, String(receipt.data.booking.finalDueCents))
    const revoked = await req(`/admin/bookings/${b.id}/deposit-receipt/revoke`, { token: admin, method: 'POST', body: { reason: '验收撤销' } })
    const readBack = (await req(`/bookings/${b.id}`, { token: customer, tid })).data.booking
    check(`${tag}: 撤销收取后应付回368且定金为未收`, revoked.status === 200 && readBack.depositCents === 0 && readBack.finalDueCents === 36800)
    await req(`/admin/bookings/${b.id}/deposit-receipt`, { token: admin, method: 'POST', body: { payChannel: 'cash' } })
    const sheetRes = await req('/admin/settlements', { token: admin, method: 'POST', body: { cardOwnerUserId: b.user.id, settlements: [{ bookingId: b.id, tierKey: 'list', payIntent: 'offline_full', depositApplied: true, items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, share: 100 }] }] } })
    const sheet = sheetRes.data.settlements?.[0]
    if (!sheet) throw new Error(JSON.stringify(sheetRes))
    check(`${tag}: 结算按真实收取抵100，应付268`, sheet.depositDeductCents === 10000 && sheet.totalCents === 26800, JSON.stringify({ deposit: sheet.depositDeductCents, due: sheet.totalCents }))
    check(`${tag}: 签署页的预约显示店内10:00，保留UTC原值`, sheet.appointmentAtText === `${day} 10:00` && sheet.appointmentAt === `${day}T${utc}:00.000Z`, sheet.appointmentAtText)
    const sign = await req(`/settlements/${sheet.code}/sign`, { token: customer, tid, method: 'POST', body: { disclaimerAccepted: true, signature: 'P0验收' } })
    check(`${tag}: 顾客签署成功`, sign.status === 200, JSON.stringify(sign.data).slice(0, 150))
    const signed = (await req(`/settlements/${sheet.code}`, { token: customer, tid })).data.settlement
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(signed.signedAt))
    check(`${tag}: 签署完成时间按各店时区`, signed.signedAtText === local, `${signed.signedAtText} vs ${local}`)
    const snap = db.prepare('SELECT snapshot_inline FROM settlements WHERE code=?').get(sheet.code).snapshot_inline || ''
    check(`${tag}: 新签原件显示店内预约与签署时间`, snap.includes(`${day} 10:00`) && snap.includes(local))
  }
} catch (error) { check('运行前置或流程异常', false, error.stack) }
finally { db?.close(); child.kill('SIGTERM'); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); closeSync(log); if (!failures.length) rmSync(dir, { recursive: true, force: true }); else console.log('失败现场保留：' + dir) }
console.log(`${count} checks; ${failures.length} failures`)
process.exitCode = failures.length ? 1 : 0
