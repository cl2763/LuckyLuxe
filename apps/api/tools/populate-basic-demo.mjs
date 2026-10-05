#!/usr/bin/env node
/* Build a small real-API transaction history for demo-basic in a marked local
 * sandbox. All signatures are simulated; never execute against live merchants. */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, openSync, closeSync, realpathSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { resolveDemoTargets, lockDemoPort, assertDemoPortUnused, assertDemoServerTarget, waitForDemoServer } from './demo-server-guard.mjs'
import { requireTarget } from '../../../tools/db-target.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const arg = requireTarget({ envName: '--dir', value: process.argv.find((s) => s.startsWith('--dir='))?.slice(6) })
if (!arg.startsWith('/') || !realpathSync(arg).startsWith('/private/tmp/youji-consistent-')) throw new Error('Local isolated --dir required')
const { dir, dataDir, dbPath, port, base, markerPath } = resolveDemoTargets(arg, 4399)
if (!existsSync(markerPath) || !existsSync(dbPath)) throw new Error('Marked demo database missing')
const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
if (marker.generator !== 'youji-consistent-demo-v1' || marker.state !== 'ready' || resolve(marker.dataDir) !== dataDir) throw new Error('Demo marker mismatch')
const tid = 'demo-basic'
function inspect() {
  const d = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const n = (table, filter = '') => d.prepare(`SELECT count(*) n FROM ${table} WHERE tenant_id=? ${filter}`).get(tid).n
    return { signed: n('settlements', "AND status='signed'"), completed: n('bookings', "AND status='COMPLETED'"),
      ledger: n('finance_transactions', "AND source='settlement' AND type='income'"),
      users: d.prepare('SELECT id FROM users WHERE tenant_id=? ORDER BY rowid LIMIT 5').all(tid).map((x) => x.id),
      services: d.prepare('SELECT id FROM services WHERE tenant_id=? ORDER BY rowid LIMIT 5').all(tid).map((x) => x.id),
      techs: d.prepare('SELECT id FROM technicians WHERE tenant_id=? ORDER BY rowid LIMIT 2').all(tid).map((x) => x.id) }
  } finally { d.close() }
}
const before = inspect()
if (before.signed) {
  if (before.signed !== before.completed || before.signed !== before.ledger || before.signed < 12) throw new Error('Partial basic history; manual reconciliation required')
  console.log(JSON.stringify({ tenant: tid, ...before, result: 'already complete' })); process.exit(0)
}
if (before.completed || before.ledger || before.users.length < 5 || before.services.length < 5 || before.techs.length < 2) throw new Error('Unexpected basic catalog/ledger; refusing to append')
const releasePort = lockDemoPort(port)
await assertDemoPortUnused(port)
const fd = openSync(resolve(dir, 'basic-build-server.log'), 'w')
const server = spawn(process.execPath, [resolve(root, 'apps/api/local-server.mjs')], {
  cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: String(port),
    OWNER_TOKEN: 'consistent-demo-local-only', ALLOW_DEMO_ADMIN_LOGIN: 'true', NOTIFY_TICK: 'off', MERGE_WINDOW_MS: '0' },
  stdio: ['ignore', fd, fd]
})
async function request(path, { body, token = 'consistent-demo-local-only' } = {}) {
  await assertDemoServerTarget({ server, base, dbPath })
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json',
    'x-tenant-id': tid, 'x-admin-tenant-id': tid, 'x-demo-seed': 'consistent-basic-v1', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined })
  const data = await r.json()
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(data)}`)
  return data
}
try {
  await waitForDemoServer({ server, base, dbPath })
  for (let i = 0; i < 12; i++) {
    const userId = before.users[i % before.users.length]
    const login = await request('/auth/wechat/mini-login', { token: null, body: { tenantId: tid, demoLogin: true, asUserId: userId } })
    const made = await request('/admin/settlements', { body: { userId, settlements: [{ priceTier: 'list', payIntent: 'offline_full',
      items: [{ serviceId: before.services[i % before.services.length], qty: 1 }],
      technicians: [{ technicianId: before.techs[i % 2], role: 'main', itemNos: [1] }] }] } })
    const sheet = made.settlements?.[0]
    if (!sheet?.code) throw new Error('Settlement create did not return a code')
    await request(`/settlements/${encodeURIComponent(sheet.code)}/sign`, { token: login.auth.accessToken,
      body: { signerConfirmed: true, disclaimerAccepted: true, signature: '演示模拟签署（非真人授权）', signedBy: '演示模拟顾客',
        strokes: [[{ x: 10, y: 10 }, { x: 12, y: 28 }, { x: 26, y: 28 }, { x: 28, y: 10 }, { x: 10, y: 10 }]] } })
  }
  const after = inspect()
  if (after.signed !== 12 || after.completed !== 12 || after.ledger !== 12) throw new Error(`Basic reconciliation failed: ${JSON.stringify(after)}`)
  console.log(JSON.stringify({ tenant: tid, signed: after.signed, completed: after.completed, ledger: after.ledger }))
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM')
    await new Promise((done) => (server.exitCode !== null || server.signalCode !== null) ? done() : server.once('exit', done))
  }
  closeSync(fd); releasePort()
}
