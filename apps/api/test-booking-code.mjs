import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { bookingPublicCode } from './booking-code.mjs'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE bookings(public_code TEXT UNIQUE NOT NULL)')
const insert = db.prepare('INSERT INTO bookings(public_code) VALUES (?)')
for (let i = 0; i < 1500; i++) {
  const code = bookingPublicCode(db)
  assert.match(code, /^LL\d{10}$/)
  insert.run(code)
}
insert.run('LL1000000000')
let attempts = 0
assert.equal(bookingPublicCode(db, () => ++attempts < 3 ? 1000000000 : 1000000001), 'LL1000000001')
assert.equal(attempts, 3)
let exhausted = 0
assert.throws(() => bookingPublicCode(db, () => { exhausted++; return 1000000000 }), { status: 503, code: 'BOOKING_CODE_BUSY' })
assert.equal(exhausted, 20)
assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n, 1501)
db.close()
console.log('PASS booking codes: 1500 unique creations, collision retry, bounded exhaustion without writes')
