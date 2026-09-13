#!/usr/bin/env node
/* 微信 code 替身的五条造病(店主 07i 裁 #80,2026-09-13)
 *
 * 替身的**全部价值**在于「**只替了一跳,后面都真跑**」。
 * 所以这五条不是验替身好不好用,是**证明这一跳有多宽** —— 宽出去一寸,那四套的绿就不作数。
 *
 *   ① 替身给一个过不了严格认人四条的 openid → **不认**,不许悄悄新建档案 ⇒ 认人真跑了
 *   ② 把签名密钥改掉 → 下游**拒收**那个 token                        ⇒ 签发与验签真跑了
 *   ③ 替身回微信的错误形态(errcode / 空 openid)→ **拒绝**,不许当成功 ⇒ 响应校验真跑了
 *   ④ 库域伪装成生产/本机 → 走真地址、**替身不可达**;ci/sandbox 下替身生效 ⇒ 闸钉在库域上
 *   ⑤ 全仓直连 `sns/jscode2session` **只许 1 处**;加第二处 → 红        ⇒ 没有第二条通往腾讯的路
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const API = join(ROOT, 'apps/api')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── ⑤ 先做静态那条(不用起服务)── */
const walk = (rel) => {
  const out = []
  const rec = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = `${d}/${e.name}`
      if (e.isDirectory()) rec(p)
      else if (/\.(mjs|js)$/.test(e.name)) out.push(p)
    }
  }
  rec(rel)
  return out
}
const srcFiles = [...walk('apps'), ...walk('tools')].filter((f) => !/test-wechat-stub/.test(f))
const direct = srcFiles.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes('sns/jscode2session'))
check('⑤ 白名单式:全仓直连 `sns/jscode2session` **只许 1 处**(09-14 起是 `wechat-jscode2session.mjs` —— '
  + '真那半从替身文件里摘出来了,名字不许骗人),加第二处当场红 —— 证明没有第二条通往腾讯的路',
direct.length === 1 && direct[0] === 'apps/api/wechat-jscode2session.mjs', direct.join(' | '))

/* ⑤b 自守:构造第二处,必须被认出来(零命中先证刀能咬) */
const probe5 = ['a.mjs', 'b.mjs'].filter((f) => `fetch('https://api.weixin.qq.com/sns/jscode2session')`.includes('sns/jscode2session'))
check('⑤b 自守:构造一处新的直连,这条扫描**必须**认得出它(不然「只有 1 处」是空转)',
  probe5.length === 2, JSON.stringify(probe5))

/* ── ④ 库域闸:纯函数层先验(不起服务) ── */
const stub = await import('./wechat-code-stub.mjs')
const devOk = ['ci', 'sandbox'].every((sc) => stub.isStubScope(sc))
let hardBlocked = 0
for (const sc of ['local', 'production', 'unknown']) {
  if (stub.isStubScope(sc)) continue
  try { stub.stubJsCode2SessionResponse('stub:x', sc) } catch { hardBlocked += 1 }
}
check('④ 闸钉在**库域**上:`ci`/`sandbox` 替身生效;`local`/`production`/`unknown` 三个库域'
  + '调它一律**抛**(替身不可达)—— 而且**没有任何环境变量能打开它**(店主 07i §二:没有开关就没有被拨错的开关)',
devOk && hardBlocked === 3, `dev=${devOk} blocked=${hardBlocked}/3`)

const stubSrc = readFileSync(join(API, 'wechat-code-stub.mjs'), 'utf8')
check('④b 反向守:替身模块里**没有任何 `process.env` 开关**能选上游 —— 只有库域一条路',
  !/process\.env/.test(stubSrc), (stubSrc.match(/process\.env\.\w+/g) || []).join(' '))
check('④c 名字不许骗人(店主 07i §三):文件名与导出名里带 `stub`,一眼认得出是替身',
  /wechat-code-stub\.mjs/.test('apps/api/wechat-code-stub.mjs')
  && ['isStubScope', 'stubJsCode2SessionResponse', 'STUB_CODE_PREFIX'].every((n) => stubSrc.includes(`export ${n.startsWith('STUB') ? 'const' : 'function'} ${n}`)), '')

/* ── 起一台 ci 库域的服务,做 ①②③ 行为层 ── */
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.stub-'))
const PORT = 4151
const child = spawn(process.execPath, ['local-server.mjs'], {
  cwd: API, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, NOTIFY_TICK: 'off', TEST_DB_PATH: '' },
})
const H = { 'content-type': 'application/json', 'x-tenant-id': 'lucky-luxe' }
const up = await (async () => {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) return true } catch { /* 还没起 */ }
    await sleep(500)
  }
  return false
})()
try {
  check('前置:ci 库域实例起得来(起不来下面三条不算验过,不是通过)', up)
  if (up) {
    const login = (code, extra = {}) => fetch(`http://127.0.0.1:${PORT}/auth/wechat/mini-login`,
      { method: 'POST', headers: H, body: JSON.stringify({ code, tenantId: 'lucky-luxe', ...extra }) })

    /* ③ 响应校验:错误形态与空 openid 都要拒 */
    const errRes = await login('stub-err:40029')
    const badRes = await login('stub-bad')
    check('③ 替身回**微信的错误形态**(errcode)与**空 openid** —— 服务端一律拒,'
      + '**不许当成功继续走** ⇒ 证明响应校验真跑了',
    errRes.status === 401 && badRes.status === 401, `errcode=${errRes.status} 空openid=${badRes.status}`)

    /* ① 严格认人:替身给一个全新 openid + 一个撞了多条轻档案的手机号 → 不许悄悄认成谁
       这里验的是「认人真跑了」——正门给的 openid 没有对应身份时,不许把它认成任何既有档案。 */
    const fresh = await login(`stub:stub-openid-${Date.now()}`)
    const freshBody = await fresh.json().catch(() => ({}))
    const tok = freshBody?.auth?.accessToken || ''
    check('① 替身给一个**全新 openid** → 正门照常签发,但**不许认成任何既有档案**'
      + '(严格认人四条:本店 + 号完全一致 + 没绑过微信 + 唯一一条)⇒ 证明认人真跑了',
    fresh.status === 200 && /^mini\./.test(tok) && !freshBody?.user?.phone,
    `${fresh.status} tok=${tok.slice(0, 12)} phone=${freshBody?.user?.phone || '(空)'}`)

    /* ①b 🔴 撞车局(裁 #80① 的真造病,也是段四的地基):
       同一个手机号造**两条**轻档案(有号、没绑微信),然后拿这个号从正门登录。
       严格认人四条里那条「**唯一一条**」要求匹配到的候选**只有一个** ——
       两条就该**不认**,宁可不合并身份(有歧义时不猜)。
       造病:把那条放宽成 `>= 1` → 它会**悄悄认走第一条**,这一条当场红。 */
    const { DatabaseSync } = await import('node:sqlite')
    const dbx = new DatabaseSync(join(dir, 'lucky-luxe.sqlite'))
    const clashPhone = `139${String(Date.now()).slice(-8)}`
    const ids = [`user_clashA_${Date.now()}`, `user_clashB_${Date.now()}`]
    for (const id of ids) {
      dbx.prepare("INSERT INTO users (id, display_name, phone, tenant_id) VALUES (?, ?, ?, 'lucky-luxe')")
        .run(id, `撞车样例-${id.slice(-4)}`, clashPhone)
    }
    dbx.close()
    const clashRes = await login(`stub:stub-openid-clash-${Date.now()}`, { phone: clashPhone })
    const clashBody = await clashRes.json().catch(() => ({}))
    const claimedOne = ids.includes(String(clashBody?.user?.id || ''))
    check('①b 🔴 撞车局:同号**两条**轻档案 → 严格认人那条「唯一一条」要求它**不认**,'
      + '**不许悄悄认走第一条**(有歧义时不猜身份)⇒ 这是「认人真跑了」最硬的一条',
    clashRes.status === 200 && !claimedOne,
    `status=${clashRes.status} 认成了=${clashBody?.user?.id || '(新建)'} 两条轻档案=${ids.join(',')}`)

    /* ② 签发/验签:拿真 token 打得通;把签名改一个字符 → 必须拒收 */
    const okRes = await fetch(`http://127.0.0.1:${PORT}/my/card-pack`,
      { headers: { authorization: `Bearer ${tok}`, 'x-tenant-id': 'lucky-luxe' } })
    const parts = tok.split('.')
    const forged = `${parts[0]}.${parts[1]}.${createHmac('sha256', 'not-the-real-secret').update(parts[1] || '').digest('base64url')}`
    const badTok = await fetch(`http://127.0.0.1:${PORT}/my/card-pack`,
      { headers: { authorization: `Bearer ${forged}`, 'x-tenant-id': 'lucky-luxe' } })
    check('② **换一把签名密钥**重签同一个 payload → 下游必须拒收(401);'
      + '而正门真签发的那一个打得通 ⇒ 证明签发与验签真跑了,token 不是替身糊出来的',
    okRes.status !== 401 && badTok.status === 401, `真=${okRes.status} 伪=${badTok.status}`)
  }
} finally {
  child.kill()
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n[底数闭合] 全仓源码 ${srcFiles.length} 个 · 直连 sns/jscode2session ${direct.length} 处`
  + ` · 库域硬挡 ${hardBlocked}/3 · 行为层 3 条(①②③)`)
if (fails.length) { console.error(`\n❌ test-wechat-stub ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-wechat-stub 通过 ${checks} 项`)
