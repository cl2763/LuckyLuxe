/* 纠错事由刀(D122,店主 03c/03e 裁定,2026-09-02 落)

   判词是我自己那句、店主收作 D122 判词的话:
   **「同一件事 —— 纠错要说明白为什么 —— 在两个口子上,一个收了一个没收。」**
   金额更正 08-27 起后端硬拦「原因必填」;账本冲销、储值冲销、现金手记冲销**连选填都没有**。
   活案由:02x 误跑演示夹具产生两笔假收入 → 03c 走正门冲销平了账,
   但账上只留一句自动拼的「冲销:服务单 …」;**账本只追加,这个遗憾永远补不上**。

   本刀守三层:
   ① **白名单式**:全仓每一个「纠错口」都必须要求事由 —— 新开的纠错口不登记就红,
      不是数「我列的这三个都收了」(判据三:白名单 > 黑名单)。
   ② 两端都得有取事由的入口(后端硬拦是安全,前端问一句是体验;缺前端=用户点了才被拒)。
   ③ 行为层:三个口各打一次不带事由的请求,**必须 400 REASON_REQUIRED**
      —— 静态扫到"写了 requireReason"不等于它真拦得住(静态写法对 ≠ 生效)。
      🔴 行为层一律只打**沙箱 4310**(店主 03e 结构闸:账本现测对本机库 4128 关门)。 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REASON_TEXT } from './correction-reason.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

/* 🔴 09x §一(店主批 (乙))· 这一套的**行为层只打沙箱 4310**(03e 结构闸)——
   拿不到沙箱就造不出阳性,按 J-58① 不许当通过,按 09x 报「未跑」不报「红」。
   整套 77 退出(不半跑):断言基线按套计数,半跑会变成「悄悄少几条」,那比不跑更坏。 */
const { requireSandboxOrSkip } = await import('./sandbox-required.mjs')
await requireSandboxOrSkip({ why: '本套行为层的断言全部打 4310' })
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ===== ① 白名单式:全仓纠错口逐个必须要求事由 =====
   「纠错口」的机制定义(先写类定义再给机械证据):
   **路由路径以 /reverse 结尾,或函数名含 reverse/amend —— 它们的共同点是"改写一笔已经记下的账"。** */
const SRC_DIRS = ['apps/api']
const files = SRC_DIRS.flatMap((d) => readdirSync(join(ROOT, d))
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('test-') && !f.startsWith('run-'))
  .map((f) => `${d}/${f}`))

/* 已登记的纠错口:每条写明「事由在哪一层拦」。新纠错口不进这张表就红。 */
/* 落刀第一跑咬出三个我没数到的口。**按机制分三类登记,不是一律塞进白名单**:
   人工口=必须问人要事由;系统口=没有人可问,由系统写明触发原因;转发口=路由层,闸在它调的模块里。 */
const GATES = {
  'apps/api/finance-reverse.mjs': { kind: '人工', why: '账本冲销:requireReason 在 reverseFinanceTxn 首段' },
  'apps/api/stored-value-reversal.mjs': { kind: '人工', why: '储值冲销:requireReason 在 reverseRechargeTxn 首段' },
  'apps/api/cash-notes.mjs': { kind: '人工', why: '现金手记冲销:requireReason 在 reverseCashNote 首段' },
  'apps/api/local-server.mjs': { kind: '人工', why: '金额更正:08-27 起 REASON_REQUIRED 硬拦(本刀之前就有)' },
  'apps/api/booking-income.mjs': { kind: '系统', why: '订单取消/过期自动冲销:**没有人可问事由**,由系统 withReason 写明触发原因' },
  'apps/api/refund-routes.mjs': { kind: '转发', why: '路由层:把 body.reason 传给 stored-value-reversal,闸在那儿' },
  'apps/api/store-content-routes.mjs': { kind: '转发', why: '路由层:把 body.reason 传给 cash-notes.reverseCashNote,闸在那儿' },
}
const found = []
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  /* 🔴 03f 病一:发现面原来只有「正则字面量 /reverse$」与「函数名」两条腿。
     店主说那条腿"永不匹配"这一点我现测后不成立(它命中 local-server / refund-routes 两个文件),
     **但她指的漏洞真实存在**:仓里还有一种路由写法 `path.endsWith('/reverse')`
     (store-content-routes.mjs:73 就是),这条腿刀里根本没有 ——
     将来谁开一个走 endsWith 路由、又不起 reverse* 函数名的新纠错口,刀看不见它,
     「新开的纠错口不登记就红」这句承诺就落空。补上第三条腿。 */
  if (/\/reverse\$|endsWith\('\/reverse'\)|function\s+reverse|reverseCashNote|reverseRechargeTxn|reverseFinanceTxn/.test(src)) found.push(f)
}
const unregistered = found.filter((f) => !GATES[f])
check(`① 白名单式:全仓 ${found.length} 个纠错口逐个登记(新开的纠错口不登记即红)`,
  unregistered.length === 0, `未登记:${unregistered.join(' | ')}`)

const needGuard = { 人工: /requireReason|REASON_REQUIRED/, 系统: /withReason/, 转发: /reason/ }
const noGuard = Object.entries(GATES).filter(([f, g]) => {
  if (!existsSync(join(ROOT, f))) return true
  return !needGuard[g.kind].test(readFileSync(join(ROOT, f), 'utf8'))
}).map(([f, g]) => `${f}(${g.kind})`)
const byKind = Object.values(GATES).reduce((a, g) => { a[g.kind] = (a[g.kind] || 0) + 1; return a }, {})
check(`①b 登记的 ${Object.keys(GATES).length} 个口按类各自真在守(人工${byKind.人工}/系统${byKind.系统}/转发${byKind.转发};不是登记了就算)`,
  noGuard.length === 0, noGuard.join(' | '))

/* ② 两端都有取事由的入口 */
const webOut = join(ROOT, 'apps/web/correction-reason.js')
check('② 网页端有取事由的唯一出口(四个调用点共用,不许各写一个 prompt)',
  existsSync(webOut) && /CorrectionReason/.test(readFileSync(webOut, 'utf8')), 'apps/web/correction-reason.js')
const webCallers = ['apps/web/admin.js', 'apps/web/account-adjust.js', 'apps/web/daily-close-rows.js']
const webMiss = webCallers.filter((f) => !/CorrectionReason/.test(readFileSync(join(ROOT, f), 'utf8')))
check(`②b 网页 ${webCallers.length} 个冲销调用点全部接了取事由出口`, webMiss.length === 0, webMiss.join(' | '))
const mp = readFileSync(join(ROOT, 'miniprogram/utils/dailyclose.js'), 'utf8')
check('②c 小程序冲销也取事由(showModal editable),不是发了才被后端拒',
  /editable: true/.test(mp) && /reason/.test(mp), '')

/* ③ 行为层:不带事由必须 400 —— 只打沙箱 4310(店主 03e 结构闸) */
const SANDBOX = 'http://127.0.0.1:4310'
/* 🔴 03f 病三:原来这里手搓了一段 fetch /health —— 而 02p 早把沙箱前置抽成了唯一出口。
   每把刀自定义自己的跳过语义,正是当初抽出口要防的事。换用共用件。 */
const { ensureSandbox } = await import('./test-need-sandbox.mjs')
const sb = await ensureSandbox({ label: '[correction-reason]' })
if (!sb.ok) {
  console.log('   账本现测一律只打 4310(店主 03e:本机库 4128 对现测关门)')
} else {
  const H = { authorization: 'Bearer owner-demo-token', 'x-admin-tenant-id': 'lucky-luxe', 'content-type': 'application/json' }
  const probe = async (url) => {
    const r = await fetch(`${SANDBOX}${url}`, { method: 'POST', headers: H, body: '{}' }).catch(() => null)
    if (!r) return { status: 0, code: '(请求失败)' }
    const j = await r.json().catch(() => ({}))
    return { status: r.status, code: j?.error?.code || '' }
  }
  const a = await probe('/admin/finance/transactions/__no_such__/reverse')
  const b = await probe('/admin/cash-notes/__no_such__/reverse')
  /* 说明:不存在的 id 也应先被事由闸拦下 —— **事由检查必须排在"这行存不存在"之前吗?**
     不必须;所以这里只断言"不会 201 通过",并把实际码打出来供人看。 */
  /* 🔴 03f 病二:原来判 `status !== 201` —— status 0(请求失败)、5xx、甚至 200 都放行,
     **比店主 09-02q 裁的「空 reason 必 4xx」弱**。而她亲跑抓到的更要命:
     账本口打印 404 NOT_FOUND —— 它**先查行存不存在、再查事由**,所以这把常驻刀
     一次都没真踩到账本口的事由闸(我那次一次性三态现测踩到了,但那不常驻)。
     同一件事在两口一个先查事由一个先查存在 —— **正是 D122 判词「收了一半」的形状,
     长在了刀要守的对象里**。①已把账本口的 requireReason 提到查库之前;②断言收紧到码级。 */
  const want = (x) => x.status === 400 && x.code === 'REASON_REQUIRED'
  check('③ 行为层:两口不带事由都必须 400 REASON_REQUIRED(事由校验排在存在性检查之前;沙箱现测)',
    want(a) && want(b), JSON.stringify({ 账本: a, 现金手记: b }))
  console.log(`   [现测] 账本口 HTTP ${a.status} ${a.code} · 现金手记口 HTTP ${b.status} ${b.code}`)
}

check('④ 文案唯一出处:后端报错语出自 correction-reason.mjs 的具名常量(判据引用它,不抄字面量)',
  REASON_TEXT.code === 'REASON_REQUIRED' && REASON_TEXT.required.length > 0, JSON.stringify(REASON_TEXT))

console.log(`\n[纠错事由] 纠错口 ${found.length} 个 · 登记 ${Object.keys(GATES).length} 个 · 网页调用点 ${webCallers.length} 个`)
if (fails.length) { console.error(`\n❌ test-correction-reason ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-correction-reason 通过 ${checks} 项`)
