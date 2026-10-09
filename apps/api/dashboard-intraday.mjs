import { bookingVisitAtSql } from './customer-facts.mjs'

// 门店时区的实际事件时间，不将每日合计平均分摊成虚构趋势。
export function intradaySeries({ db, tid, today, timeZone, now = new Date() }) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23' })
  const parts = raw => {
    if (!raw) return null
    const s = String(raw), d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ','T')+'Z' : s)
    if (!Number.isFinite(+d)) return null
    const p = Object.fromEntries(fmt.formatToParts(d).map(x=>[x.type,x.value]))
    return { day:`${p.year}-${p.month}-${p.day}`, hour:Number(p.hour), instant:+d }
  }
  const current = parts(now.toISOString())
  const sum = (rows, future = false) => {
    const bins = Array(6).fill(0)
    for (const row of rows) { const p = parts(row.at); if (p?.day === today) bins[Math.floor(p.hour/4)] += Number(row.c ?? 1) || 0 }
    return bins.map((v,i) => !future && current?.day === today && i*4 > current.hour ? null : v)
  }
  const ledger = db.prepare("SELECT amount_cents AS c, created_at AS at, pay_channel FROM finance_transactions WHERE tenant_id=? AND occurred_on=? AND type='income'").all(tid,today)
  const recharge = db.prepare("SELECT amount_cents AS c, created_at AS at FROM stored_value_transactions WHERE tenant_id=? AND type='recharge'").all(tid)
  const cards = db.prepare('SELECT price_cents AS c, created_at AS at FROM member_timecards WHERE tenant_id=?').all(tid)
  const starts = db.prepare("SELECT user_id, created_at AS at FROM stored_value_transactions WHERE tenant_id=? AND type='recharge' UNION ALL SELECT user_id, created_at AS at FROM member_timecards WHERE tenant_id=?").all(tid,tid)
  const first = new Map()
  for (const row of starts) { const p = parts(row.at); if (p && (!first.has(row.user_id) || p.instant < first.get(row.user_id).instant)) first.set(row.user_id,{...row,instant:p.instant}) }
  return {
    revenue:sum(ledger),
    cash:sum([...ledger.filter(r=>!['stored_value','times_card'].includes(r.pay_channel)),...recharge,...cards]),
    cardUse:sum(ledger.filter(r=>r.pay_channel==='stored_value')),
    newCard:sum([...first.values()]),
    visits:sum(db.prepare(`SELECT ${bookingVisitAtSql()} AS at FROM bookings WHERE tenant_id=?`).all(tid)),
    bookings:sum(db.prepare("SELECT appointment_start AS at FROM bookings WHERE tenant_id=? AND status NOT IN ('CANCELLED','NO_SHOW')").all(tid),true)
  }
}
