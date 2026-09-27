// Dedicated process and temporary database; never touches an existing demo/server.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
const dir = await mkdtemp(join(tmpdir(), 'll-ci-data.runtime-'))
const probe = createServer()
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
const child = spawn(process.execPath, ['--experimental-sqlite', 'apps/api/local-server.mjs'], {
  env: { ...process.env, DATA_DIR: join(dir, 'local-data'), NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    OWNER_TOKEN: randomBytes(32).toString('hex'), WECHAT_MINI_TOKEN_SECRET: randomBytes(32).toString('hex'),
    ALLOW_DEMO_ADMIN_LOGIN: 'false', NOTIFY_TICK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b })
const exited = new Promise(resolve => child.once('exit', resolve))
try {
  let health
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, `Production startup exited: ${logs}`)
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) { health = await r.json(); break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(health, 'Production startup must reach healthy state')
  assert.equal(health.demoLoginAllowed, false)
  assert.equal(health.guestIdUnsigned, false)
  assert.equal(health.miniSecretSet, true)
  console.log(`ok - full production-mode startup on Node ${process.versions.node}, demo login disabled`)
} finally {
  child.kill('SIGTERM'); await exited
  await rm(dir, { recursive: true, force: true })
}
