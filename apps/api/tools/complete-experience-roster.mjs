#!/usr/bin/env node
/* Complete only a marked, isolated consistent-demo database. Never run on a
 * production or existing merchant database. This is additive and idempotent. */
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { requireTarget } from '../../../tools/db-target.mjs'
import { resolveDemoTargets } from './demo-server-guard.mjs'

const arg = requireTarget({ envName: '--dir', value: process.argv.find((s) => s.startsWith('--dir='))?.slice(6) })
if (!arg.startsWith('/')) throw new Error('Required: --dir=/absolute/isolated-demo-dir')
const dir = realpathSync(resolve(arg))
const markerPath = resolve(dir, 'consistent-demo.json')
const { dbPath } = resolveDemoTargets(dir, 4399)
if (!dir.startsWith('/private/tmp/youji-consistent-') || !existsSync(markerPath) || !existsSync(dbPath)) {
  throw new Error('Refusing: target is not a local marked consistent-demo sandbox')
}
const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
if (marker.generator !== 'youji-consistent-demo-v1' || marker.state !== 'ready' || resolve(marker.dataDir) !== resolve(dir, 'sandbox-data')) {
  throw new Error('Refusing: the isolated demo is not fully built')
}
const db = new DatabaseSync(dbPath)
try {
  db.exec('BEGIN IMMEDIATE')
  const ai = db.prepare("SELECT kind FROM tenants WHERE id='demo-ai'").get()
  const basic = db.prepare("SELECT kind FROM tenants WHERE id='demo-basic'").get()
  if (!ai || !basic || ai.kind !== 'demo') throw new Error('Demo AI/basic roster missing')
  db.prepare("UPDATE tenants SET kind='demo', listed=1 WHERE id='demo-basic'").run()
  if (!db.prepare("SELECT id FROM tenants WHERE id='demo-empty'").get()) {
    const now = new Date().toISOString()
    const hash = (purpose, value) => createHash('sha256').update(`${purpose}:${value}`).digest('hex')
    db.prepare(`INSERT INTO tenants
      (id,name,plan,status,created_at,updated_at,plan_expires_at,finance_password_hash,kind,listed)
      VALUES ('demo-empty','空白新店（模拟演示）','single','active',?,?,?,?, 'demo',1)`)
      .run(now, now, '2030-01-01T00:00:00.000Z', hash('finance:demo-empty', '886688'))
    db.prepare(`INSERT INTO stores
      (id,name,address,phone,timezone,currency,is_active,tenant_id)
      VALUES ('demo-empty-store','空白新店 · 演示店','仅用于体验版测试','','Asia/Shanghai','CNY',1,'demo-empty')`).run()
    db.prepare(`INSERT INTO admin_accounts
      (id,tenant_id,username,display_name,role,technician_id,password_hash,must_change_password,status,created_at,updated_at)
      VALUES ('demo-empty-owner','demo-empty','demo-empty-boss','演示店长','owner',NULL,?,0,'active',?,?)`)
      .run(hash('admin:demo-empty-boss', 'demo1234'), now, now)
  }
  const rows = db.prepare("SELECT id,kind,listed FROM tenants WHERE id IN ('demo-ai','demo-basic','demo-empty') ORDER BY id").all()
  if (rows.length !== 3 || rows.some((r) => r.kind !== 'demo' || r.listed !== 1)) throw new Error('Three-store roster failed validation')
  db.exec('COMMIT')
  console.log(JSON.stringify(rows))
} catch (e) { db.exec('ROLLBACK'); throw e } finally { db.close() }
