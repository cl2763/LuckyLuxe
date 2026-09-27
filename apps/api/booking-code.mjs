import { randomInt } from 'node:crypto'
// Keep the public LL + 10 digits format without a 90-values-per-millisecond limit.
export function bookingPublicCode(db, next = () => randomInt(1_000_000_000, 10_000_000_000)) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = `LL${next()}`
    if (!db.prepare('SELECT 1 FROM bookings WHERE public_code = ?').get(code)) return code
  }
  throw Object.assign(new Error('订单编号暂时生成失败，请重试。'), { status: 503, code: 'BOOKING_CODE_BUSY' })
}
