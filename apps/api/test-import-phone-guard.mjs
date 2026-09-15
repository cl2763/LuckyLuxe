#!/usr/bin/env node
/* 🔴 导入:**没有手机号的行要报出来并挡住,不许静默导进去**(店主 07u §二①,07v ③)
 *
 * ══ 为什么 ══
 * 店主原话:「如果我这边有老顾客名单的话,他们**基本都是**有手机号的。」——D193 据此销号。
 * 但店主自己留了尾巴:**「基本都有」不是「全都有」。**
 *   > **那几个例外要在导入当天被看见,而不是上线后被顾客发现。**
 * 一个没有手机号的档案,扫码时卡在严格四条的**第二条**(号完全一致)——
 * 她会拿到一份空白新档案,而她的余额卡包留在那份再也认不出来的上面(D191 第三形态)。
 *
 *   ㋞1  没号的行**不进库**(查库:导入后那个名字一行都没有)
 *   ㋞2  没号的行**被报出来并点名是哪一行**(`report.skipped` 里有 line + 原因)
 *   ㋞3  反向守:**有号的行照常导进去**(不是「谁来都挡」)
 *   ㋞4  底数闭合:收到的行数 = 导进去的 + 被挡的(J-48,不许有行凭空消失)
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

const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.impguard-'))
const PORT = 4197
const OWNER = 'impguard-owner-not-a-secret'
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: HERE, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '',
    OWNER_TOKEN: OWNER, WECHAT_MINI_TOKEN_SECRET: 'impguard-mini-not-a-secret' },
})
const BASE = `http://127.0.0.1:${PORT}`
const TID = 'lucky-luxe'
const AH = { 'content-type': 'application/json', 'x-admin-tenant-id': TID, authorization: `Bearer ${OWNER}` }
const one = (sql, ...a) => { const d = new DatabaseSync(join(dir, 'lucky-luxe.sqlite'), { readOnly: true }); const r = d.prepare(sql).get(...a); d.close(); return r || {} }

const up = await (async () => {
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${BASE}/health`)).ok) return true } catch { /* 还没起 */ } await sleep(500) }
  return false
})()
try {
  check('前置:实例起得来(起不来下面几条**不算验过**,不是通过)', up)
  if (up) {
    const RUN = Date.now()
    const 有号 = `导入·有号${RUN}`
    const 没号 = `导入·没号${RUN}`
    const rows = [
      { name: 有号, phone: `1380000${String(RUN).slice(-4)}` },
      { name: 没号 },                                   // 🔴 这一行就是被测对象:她没有手机号
    ]
    const dry = await (await fetch(`${BASE}/platform/tenants/${TID}/import/customers`, { method: 'POST', headers: AH,
      body: JSON.stringify({ dryRun: true, rows }) })).json().catch(() => ({}))
    const rep = dry?.report || dry || {}
    const skipped = rep.skipped || []
    const noPhoneSkip = skipped.find((x) => String(x.name || '') === 没号)

    check('㋞2 🔴 没号的行**被报出来并点名是哪一行** —— '
      + `试跑报告里 skipped ${skipped.length} 条,其中那一行 line=${noPhoneSkip?.line} 原因「${noPhoneSkip?.reason || ''}」。`
      + '**「基本都有」不是「全都有」,那几个例外要在导入当天被看见**',
      Boolean(noPhoneSkip) && /手机号/.test(String(noPhoneSkip.reason || '')) && Number.isInteger(noPhoneSkip.line),
      JSON.stringify(skipped).slice(0, 200))

    const sum = Number(rep.balanceSumCents ?? 0)
    await fetch(`${BASE}/platform/tenants/${TID}/import/customers`, { method: 'POST', headers: AH,
      body: JSON.stringify({ dryRun: false, rows, confirmBalanceCents: sum }) })

    const gotYes = one('SELECT id, phone FROM users WHERE display_name = ? AND tenant_id = ?', 有号, TID)
    const gotNo = one('SELECT id FROM users WHERE display_name = ? AND tenant_id = ?', 没号, TID)
    check('㋞1 🔴 **没号的行不进库**(查库,不看返回体)—— '
      + `那个名字在 users 里${gotNo.id ? '**竟然有一行:' + gotNo.id + '**' : '一行都没有'}`,
      !gotNo.id, JSON.stringify(gotNo))
    check('㋞3 反向守:**有号的行照常导进去**(不是「谁来都挡」,那样这条判据就是空转)',
      Boolean(gotYes.id) && String(gotYes.phone || '').trim() !== '',
      JSON.stringify(gotYes))

    const created = Number(rep.toCreate ?? 0)
    check(`㋞4 底数闭合(J-48):收到 ${rows.length} 行 = 要建的 ${created} + 被挡的 ${skipped.length} —— `
      + '不许有行凭空消失(消失的那种最难发现:报告上看不出来,库里也看不出来)',
      created + skipped.length === rows.length,
      `收到=${rows.length} 要建=${created} 被挡=${skipped.length}`)
  }
} finally {
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n1..${checks}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${checks} 条)`)
