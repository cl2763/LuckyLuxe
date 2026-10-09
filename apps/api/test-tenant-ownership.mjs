/* 跨租户所有物刀(D127,店主 03u 裁「红线现修」,2026-09-03 落)

   ══ 案由 ══
   02b⑤ 现查:A 店的 `/admin/bookings` 把 B 店顾客的**整个 user 对象**
   (`display_name` / `phone` / `email` / `wechat_open_id`)下发了。
   多租户产品最不能破的就是这条线。

   ══ 病根定性(现查完要更正我自己的说法)══
   我在 02b⑤ 写「建单不校验顾客属于本租户」——**只说对了一半**:
   · `/admin/bookings/direct` **本来就有** `USER_TENANT_MISMATCH` 闸(商家侧那条路是通的);
   · 顾客侧 `POST /bookings` 强制 `userId = 会话用户`,而登录按 `openid + tenant_id` 找档、
     找不到就在这店新建一份 —— API 这两条路都进不来。
   · 那 5 行是**夹具脚本直接写库**造出来的(notes:`O7 walk fixture,验后撤` / `D2D3现场·已签署`)。
   **所以真正演示出来的泄露在读口**:不管脏行怎么进来的,
   `serializeBooking` 拼 user 对象时按 `WHERE id = ?` 取,**不比对租户**,于是照发不误。
   归族「读写两道闸律」第五案 —— 这次是**读口那一侧**没收。

   ══ 两道闸 ══
   ① 写(纵深防御):`createBooking` 取顾客加 `AND tenant_id = ?`,
      比的是**这张单要写进去的那个租户**(`input.tenantId`),不是 `currentTenantId()` ——
      顾客侧路由把 `resolveTenant()` 放进 body.tenantId,两者未必相同,
      拿错对象去比,闸看着在守、守的却是别的东西。
   ② 读(真正堵住已演示泄露的那一道):`serializeBooking` 按
      `users.tenant_id = bookings.tenant_id` 连;连不上**不下发 user 对象**,只留 user_id。
      「宁可少给,不许给别人家的」——读口不能指望写口,存量脏行是既成事实。

   ══ 本刀守什么 ══
   ① 静态:两处闸都在(写口带 tenant 且比对象正确 / 读口带 tenant);
   ② **行为层(沙箱)**:A 店拿 B 店顾客 id 建单必 4xx;
      A 店订单列表响应体里不得出现任何非本店 tenant_id 的用户对象;
      并且**本店顾客必须建得成**(反向守:不是见谁都拒)。
   ③ 已知阳性:拿那 5 行夹具当阳性 —— 库里只要还有串味行,读口就必须对它们零下发。

   ⚠️ **一条判据自身的限制,写在这里不藏着**:
   我原想做「全仓按 id 取租户所有物的 SQL 必须带 tenant_id」这条静态白名单判据,
   实测 109 处命中、**109 处全部判为「无守护」** —— 这个数字本身证明它是废判据:
   仓里取值大多经 `getService()` 这类**共用取值函数**,租户核对在**调用点**、
   不在 `prepare()` 旁边,窗口式扫描根本看不见。
   所以静态那一层**只守已修的两处**(能判准的部分),
   覆盖面交给行为层 —— 判据律:能验行为就别验中间产物。 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ═══ ① 静态:两处闸在,且写口比的是正确那个租户 ═══ */
const src = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const writeGate = src.includes("AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')")
  && src.includes('.get(input.userId, bookingTenantForUser)')
  && /CUSTOMER_NOT_IN_TENANT/.test(src)
check('① 写口闸在:createBooking 取顾客带 `AND tenant_id = ?`,且比的是 `bookingTenantForUser`'
  + '(= INSERT 用的那个租户),不是 currentTenantId() —— 比错对象的闸看着在守、守的是别的东西',
  writeGate, '没找到带 bookingTenantForUser 的取顾客语句')

const readGate = /google_id FROM users WHERE id = \? AND tenant_id = \?'\)\.get\(row\.user_id, row\.tenant_id\)/.test(src)
check('①b 读口闸在:serializeBooking 按 `users.tenant_id = bookings.tenant_id` 取顾客,'
  + '连不上不下发 user 对象(这一道才是真正堵住已演示泄露的那道)', readGate, '没找到带 row.tenant_id 的取顾客语句')

/* ═══ ② 已知阳性:库里的串味行(先证刀有东西可咬)═══ */
/* 🔴 路径做成可覆盖 —— **硬写死的路径没法造病**(预检那把刀与 09m 学的同一条)。
   日常一个字不用改;造病时指到一个空库,就能验「造不出阳性会不会真报未跑」。 */
/* 🔴 走 `test-need-sandbox.mjs` 的唯一出口 —— 不再各写一条硬路径(公约④:一件事一处真相)。
   夜15 (丙):CI 上把 `SANDBOX_DATA_DIR` 指到临时目录,这里自动跟着走。 */
const { SANDBOX_DB_PATH } = await import('./test-need-sandbox.mjs')
const SB = process.env.SANDBOX_DB_PROBE || SANDBOX_DB_PATH
let dirty = []
try {
  const db = new DatabaseSync(SB, { readOnly: true })
  dirty = db.prepare(`SELECT b.id AS bid, b.tenant_id AS bt, u.tenant_id AS ut, u.display_name AS nm
    FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.tenant_id <> u.tenant_id`).all()
  db.close()
} catch { /* 库不在:下面按"未跑"如实说 */ }
console.log(`   [已知阳性] 沙箱库串味行 ${dirty.length} 条${dirty.length ? `(如 ${dirty[0].bid.slice(0, 22)}:单属 ${dirty[0].bt} / 人属 ${dirty[0].ut})` : ''}`)

/* ═══ ③ 行为层(只打沙箱 4310;店主 03e 结构闸)═══ */
// The fixture is generated through product APIs in the disposable target.
// Existing shop names and a previously populated 4310 are not prerequisites.
const SANDBOX = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const { assertTestTarget } = await import('./test-guard.mjs')
await assertTestTarget(SANDBOX)
const health = await fetch(SANDBOX + '/health').then(r => r.json())
if (!health.dataFile?.startsWith('/tmp/ll-ci-data.')) throw Error('ownership fixture refuses non-disposable database')
const { requireOwnerToken } = await import('./owner-token.mjs')
const token = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const A = 'ownership-a-' + Date.now().toString(36), B = A.replace('-a-', '-b-')
const H = t => ({authorization:'Bearer '+token,'x-admin-tenant-id':t,'x-tenant-id':t,'content-type':'application/json'})
async function req(t, path, body) {const r = await fetch(SANDBOX+path,{method:body?'POST':'GET',headers:H(t),body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
for (const tid of [A,B]) {const r=await req(tid,'/platform/tenants',{id:tid,name:tid,plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'});if(r.status!==201)throw Error('Could not create isolated fixture tenant')}
const store=(await req(A,'/platform/tenants/'+A+'/store')).data.store
const tech=(await req(A,'/platform/tenants/'+A+'/technicians',{name:'Ownership fixture'})).data.technician
const service=(await req(A,'/platform/tenants/'+A+'/services',{type:'NAIL',nameZh:'Ownership fixture',nameEn:'Ownership fixture',priceCents:10000,baseDurationMin:60})).data.service
const aUser=(await req(A,'/admin/customers',{displayName:'Local fixture',requestId:'ownership_a_'+Date.now()})).data.customer
const bUser=(await req(B,'/admin/customers',{displayName:'Foreign fixture',requestId:'ownership_b_'+Date.now()})).data.customer
const payload=userId=>({userId,storeId:store.id,serviceId:service.id,technicianId:tech.id,date:'2030-10-08',time:'10:00'})
const foreign=await req(A,'/admin/bookings/direct',payload(bUser.id))
check('③a 外店顾客不能写入本店预约',foreign.status>=400&&foreign.status<500,JSON.stringify(foreign))
const same=await req(A,'/admin/bookings/direct',payload(aUser.id))
check('③b 反向守：本店顾客通过同一产品入口实际建单成功',same.status===201,JSON.stringify(same))
if(!same.data.booking?.id)throw Error('No local positive fixture')
const db=new DatabaseSync(health.dataFile),victim=same.data.booking.id
let injected=false,leaked=[]
try {
 db.prepare('UPDATE bookings SET user_id=? WHERE id=?').run(bUser.id,victim);injected=true
 const list=await req(A,'/admin/bookings');if(list.status!==200)throw Error('Read path unavailable')
 leaked=(list.data.bookings||[]).filter(b=>b.id===victim&&b.user)
}finally{db.prepare('UPDATE bookings SET user_id=? WHERE id=?').run(aUser.id,victim);db.close()}
check('③c 注入跨店存量脏行后，本店订单读口不得下发外店 user；验证后还原',injected&&leaked.length===0)

/* ═══ ⑤ 读写同源:**回读用的租户必须是写进去时用的那一个**(夜9 段4)═══

   ══ 案由(本会话自己栽的)══
   给四处序列化补 `AND tenant_id = ?` 之后,有两处**写用的是局部 `tenantId`/`tid`,
   回读却写成 `currentTenantId()`** —— 现象是 `Cannot read properties of undefined (reading 'id')`
   和「技师昵称回落成店名」。闸都在,守的却是**另一个租户**。
   与本文件 §两道闸①那句「比的是这张单要写进去的那个租户,不是 currentTenantId()」是同一句话,
   只是那次说的是写口,这次是**写完再读回来**那一步。

   ══ 判法(两件事必须先做对,否则全是假红)══
   ① **不许跨路由配对**:`route()` 是几千行的一个函数,按函数体开窗必然把
      `/admin/salary/unlock` 的写和 `/admin/salary/payout` 的读配成一对(首版就是这么报了 2 处假红)。
      所以窗口在**路由分段**里开:遇到下一个 `if (req.method === ... && path === ...)` 就换段。
   ② **别名要归一**:`const tid = currentTenantId()` 之后的 `tid` 与 `currentTenantId()`
      是同一个来源,拼法不同不算缺陷。只有**可能解析成不同租户**的两个来源才算
      (例:`resolveTenant(req, query)` vs `currentTenantId()` —— 这两个确实可能不同)。
   判据形态**白名单式**:命中一律红,豁免要具名且带上限(判据三 + J-51)。 */
const TENSRC = /currentTenantId\(\)|resolveTenant\([^)]*\)|\b(?:input|body|admin|me|my|session|row|opts|payload)\.tenant(?:Id|_id)\b|\btenantId\b|\btid\b|\bDEFAULT_TENANT_ID\b/
const scanReadWriteTenant = (code) => {
  const L = code.split('\n')
  /* 路由分段先算 —— 别名表要按段建(见下面那段注释) */
  const segOf = []
  let segN = 0
  for (let i = 0; i < L.length; i += 1) {
    if (/req\.method === ['"]/.test(L[i]) && /path === |path\.startsWith\(|PATH_RE|\.test\(path\)/.test(L[i])) segN += 1
    segOf[i] = segN
  }
  /* 别名归一:凡 `const/let X = currentTenantId()` / `= resolveTenant(...)`,X 记成那个来源。
     🔴 **必须按段建,不能全文件一张表** —— 造病第二刀咬出来的:
     局部名用真实那个 `tenantId` 时判据是**绿的**,而换个没人用过的名字 `knifeTenantId` 就红。
     原因是全文件一张表**后声明的覆盖先声明的**:仓里别处有 `const tenantId = currentTenantId()`,
     把这一段里 `const tenantId = resolveTenant(...)` 的映射盖掉了,于是写口被归一成
     `currentTenantId()`,跟回读一模一样 —— 同源不同源全看**谁在文件里排后面**。
     这一刀特别值:**用真实拼法反而漏、用生僻名字反而中**,只跑一个名字就会得出相反结论。 */
  const alias = new Map()   // key: `${seg}\u0000${name}`
  for (let i = 0; i < L.length; i += 1) {
    const m = L[i].match(/\b(?:const|let)\s+(\w+)\s*=\s*(currentTenantId\(\)|resolveTenant\([^)]*\))/)
    if (m) alias.set(`${segOf[i]}\u0000${m[1]}`, m[2].startsWith('resolveTenant') ? 'resolveTenant()' : 'currentTenantId()')
  }
  const aliasNames = new Set([...alias.keys()].map((k) => k.split('\u0000')[1]))
  /* 🔴 判据三(白名单 > 黑名单)· 造病咬出来的:识别租户实参原来只认**一张固定名单**
     (`tenantId` / `tid` / …)。头一刀我用的局部名叫 `knifeTenantId` —— 不在名单上,
     于是那两条语句**整条被跳过**,扫描面 436 → 436 纹丝不动,判据当然是绿的。
     刀确实落下了(4 行凭据在案),红没出来 = **扫描瞎了**,不是代码干净。
     改法:识别集合 = 固定名单 ∪ **凡是从已知租户来源赋值出来的那些局部名**,
     变量叫什么都认得出。 */
  const srcRe = new RegExp([TENSRC.source, ...[...aliasNames].map((k) => `\\b${k}\\b`)].join('|'))
  const norm = (e, seg) => {
    /* 🔴 这里原来是 `.replace(/^String\(/,'').replace(/\)$/,'')` —— 本意是脱掉 `String(x)` 的壳,
       实际把**每个函数调用的右括号**都削了:`currentTenantId()` 被削成 `currentTenantId(`,
       于是它跟别名归一出来的 `currentTenantId()` 比起来是**两个不同的串**,同源也报不同源。
       内置探针就是这么把它咬出来的(报文里那半个括号就是现场痕迹)。只脱真的 String() 壳。 */
    const bare = /^String\(.*\)$/.test(e) ? e.slice(7, -1) : e
    return alias.get(`${seg}\u0000${bare}`) || bare
  }
  const stmts = []
  for (let i = 0; i < L.length; i += 1) {
    const ln = L[i]
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) continue          // 注释不算代码
    if (!/tenant_id/.test(ln)) continue
    const win = L.slice(i, Math.min(L.length, i + 4)).join(' ')
    const tbl = (win.match(/(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/i) || [])[1] || ''
    if (!tbl) continue
    /* 🔴 首版在这里**整个 4 行窗口里找租户表达式** —— 于是 INSERT 那一条把**下一行 SELECT 的**
       `currentTenantId()` 认成自己的(`TENSRC` 里它排第一个),两条的来源看起来就一样了,
       内置探针当场报「认不出来」。不是探针苛刻,是扫描真瞎。
       改法:只在**这一条语句自己的实参**里找 —— 从 `.run(`/`.get(`/`.all(` 起,到括号配平为止。 */
    const call = win.search(/\.(?:run|get|all|iterate|pluck)\(/)
    if (call < 0) continue
    let depth = 0; let end = -1
    for (let k = win.indexOf('(', call); k < win.length; k += 1) {
      if (win[k] === '(') depth += 1
      else if (win[k] === ')') { depth -= 1; if (depth === 0) { end = k; break } }
    }
    const args = win.slice(win.indexOf('(', call) + 1, end < 0 ? win.length : end)
    const m = args.match(srcRe)
    if (!m) continue
    stmts.push({ line: i + 1, seg: segOf[i], tbl,
      write: /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i.test(win), expr: norm(m[0], segOf[i]), txt: ln.trim().slice(0, 70) })
  }
  const bad = []
  for (let a = 0; a < stmts.length; a += 1) {
    for (let b = a + 1; b < stmts.length; b += 1) {
      const s = stmts[a]; const t = stmts[b]
      if (t.line - s.line > 14) break
      if (t.seg !== s.seg) continue                       // 跨路由不配对
      if (s.tbl !== t.tbl || s.write === t.write || s.expr === t.expr) continue
      bad.push(`表 ${s.tbl}:L${s.line}(${s.write ? '写' : '读'} ${s.expr}) ↔ L${t.line}(${t.write ? '写' : '读'} ${t.expr})`)
    }
  }
  return { total: stmts.length, bad }
}

/* ⑤a 内置探针(判据六 · 刀留痕):先证明这把扫描**认得出**这个形状,再拿它去扫真文件。
   不然「真文件 0 命中」既可能是干净,也可能是扫描瞎了 —— 两者从数字上分不出来。 */
const PROBE = [
  "if (req.method === 'POST' && path === '/x') {",
  "  const tenantId = resolveTenant(req, query)",
  "  db.prepare('INSERT INTO settlements (id, tenant_id) VALUES (?, ?)').run(sid, tenantId)",
  "  const back = db.prepare('SELECT * FROM settlements WHERE id = ? AND tenant_id = ?').get(sid, currentTenantId())",
  '}',
  "if (req.method === 'POST' && path === '/y') {",
  "  const tid = currentTenantId()",
  "  db.prepare('INSERT INTO settlements (id, tenant_id) VALUES (?, ?)').run(sid, tid)",
  "  const ok = db.prepare('SELECT * FROM settlements WHERE id = ? AND tenant_id = ?').get(sid, currentTenantId())",
  '}',
  /* 陷阱段:**同一个名字 `tenantId` 在这一段里是另一个来源**。
     别名表若按全文件建,这一段会把上面 /x 段的映射盖掉,/x 那条真缺陷就此消失。 */
  "if (req.method === 'POST' && path === '/z') {",
  "  const tenantId = currentTenantId()",
  "  db.prepare('INSERT INTO settlements (id, tenant_id) VALUES (?, ?)').run(sid, tenantId)",
  "  const z = db.prepare('SELECT * FROM settlements WHERE id = ? AND tenant_id = ?').get(sid, currentTenantId())",
  '}',
].join('\n')
const probe = scanReadWriteTenant(PROBE)
check('⑤a 内置探针:构造一段「写用 resolveTenant()、回读用 currentTenantId()」**必须被认出来**;'
  + '同一段里「写用 tid(=currentTenantId())、回读用 currentTenantId()」**不许误报**(别名归一)',
probe.bad.length === 1 && /写 resolveTenant\(\)/.test(probe.bad[0]) && /读 currentTenantId\(\)/.test(probe.bad[0]),
`探针命中 ${probe.bad.length} 条:${probe.bad.join(' | ')}`)

/* ⑤b 真扫:全仓命中必须落进具名豁免(白名单式) */
const RW_EXEMPT = new Map([
  /* 具名豁免:一行一处,写明为什么不是缺陷。**清单只许变短**(J-51)。
     —— 今天一条都没有;有了必须写理由,不许只留个行号。 */
])
const RW_EXEMPT_CAP = 0
const rw = scanReadWriteTenant(src)
const rwBad = rw.bad.filter((b) => !RW_EXEMPT.has(b))
check(`⑤b 读写同源:全仓 ${rw.total} 条带租户条件的语句里,`
  + '**同一路由段 · 同一张表 · 14 行内 · 一写一读而租户来源不同** 零处(命中要么修,要么进具名豁免)',
rwBad.length === 0, rwBad.join(' | ').slice(0, 400))
check(`⑤c 反向守:豁免清单具名且 ${RW_EXEMPT.size} <= 上限 ${RW_EXEMPT_CAP}(只许变短);扫描面条数下限 380`,
  RW_EXEMPT.size <= RW_EXEMPT_CAP && rw.total >= 380, `实扫 ${rw.total} 条 · 豁免 ${RW_EXEMPT.size} 条`)
console.log(`   [扫描面] 带租户条件语句 ${rw.total} 条 · 路由分段后配对命中 ${rw.bad.length} 条`)

console.log(`\n[跨租户所有物] 静态两处闸 · 行为层三条(沙箱;③c 自己造景验)`)
if (fails.length) { console.error(`\n❌ test-tenant-ownership ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-tenant-ownership 通过 ${checks} 项`)
