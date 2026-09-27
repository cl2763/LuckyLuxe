import assert from 'node:assert/strict'
import lanes from '../../miniprogram/utils/booking-lanes.js'
const b=(id,startTime,endTime)=>({id,startTime,endTime})
const cases=[[],[b('a','10:00','11:00'),b('b','11:00','12:00')],[b('a','10:00','14:00'),b('b','10:30','11:00'),b('c','11:00','12:00')],Array.from({length:8},(_,i)=>b(String(i),'10:00','12:00'))]
for(const input of cases){const output=lanes(input);assert.deepEqual(output.map(b=>b.id).sort(),input.map(b=>b.id).sort());for(const a of output)for(const b of output){if(a.id!==b.id&&a.startTime<b.endTime&&b.startTime<a.endTime)assert.notEqual(a.lane,b.lane)}assert.ok(output.every(b=>b.lane<b.lanes))}
assert.ok(lanes(cases[1]).every(b=>b.lanes===1))
assert.equal(lanes(cases[2])[2].lane,1)
assert.ok(lanes(cases[3]).every(b=>b.lanes===8))
console.log('ok 1 - empty, adjacent, nested/reused and eight-way overlaps retain every booking without collisions')
