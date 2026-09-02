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
const SB = join(ROOT, 'apps/api/sandbox-data/lucky-luxe.sqlite')
let dirty = []
try {
  const db = new DatabaseSync(SB, { readOnly: true })
  dirty = db.prepare(`SELECT b.id AS bid, b.tenant_id AS bt, u.tenant_id AS ut, u.display_name AS nm
    FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.tenant_id <> u.tenant_id`).all()
  db.close()
} catch { /* 库不在:下面按"未跑"如实说 */ }
console.log(`   [已知阳性] 沙箱库串味行 ${dirty.length} 条${dirty.length ? `(如 ${dirty[0].bid.slice(0, 22)}:单属 ${dirty[0].bt} / 人属 ${dirty[0].ut})` : ''}`)

/* ═══ ③ 行为层(只打沙箱 4310;店主 03e 结构闸)═══ */
const { ensureSandbox } = await import('./test-need-sandbox.mjs')
const sb = await ensureSandbox({ label: '[tenant-ownership]' })
if (!sb.ok) {
  console.log('   ⚠️ 沙箱不可用 —— **行为层三条本轮未跑**(不静默跳过,如实说)')
} else {
  const SANDBOX = 'http://127.0.0.1:4310'
  const H = (t) => ({ authorization: 'Bearer owner-demo-token', 'x-admin-tenant-id': t, 'content-type': 'application/json' })
  const db = new DatabaseSync(SB, { readOnly: true })
  const pick = (sql, ...a) => db.prepare(sql).get(...a)
  const A = 'lucky-luxe'
  const B = 'jics-nail'
  const bUser = pick('SELECT id, display_name FROM users WHERE tenant_id = ? LIMIT 1', B)
  const aUser = pick('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', A)
  const svc = pick('SELECT id FROM services WHERE tenant_id = ? AND is_active = 1 LIMIT 1', A)
  const tech = pick('SELECT id FROM technicians WHERE tenant_id = ? LIMIT 1', A)
  db.close()

  const mkBooking = async (uid, time) => {
    const r = await fetch(`${SANDBOX}/admin/bookings/direct`, {
      method: 'POST',
      headers: H(A),
      body: JSON.stringify({ userId: uid, serviceId: svc?.id, technicianId: tech?.id, date: '2026-09-10', time, durationMin: 60 }),
    }).catch(() => null)
    if (!r) return { status: 0, code: '(请求失败)', id: '' }
    const j = await r.json().catch(() => ({}))
    return { status: r.status, code: j?.error?.code || '', id: j?.booking?.id || '' }
  }

  /* ③a A 店拿 B 店顾客建单 → 必 4xx */
  const cross = await mkBooking(bUser?.id, '14:00')
  check(`③ 行为层·跨店建单被拒:A 店(${A})拿 B 店(${B})顾客「${bUser?.display_name}」建单 → `
    + `必须 4xx(实测 ${cross.status} ${cross.code})`,
  cross.status >= 400 && cross.status < 500, JSON.stringify(cross))

  /* ③b 反向守:本店顾客必须建得成(不是见谁都拒)—— 造完当场删,不留脏数据。
     🔴 首跑撞 409 SLOT_UNAVAILABLE:那个时段夹具里已有单。
     409 其实说明**所有权那关已经过了**(它走到了排期检查),但断言写死 201 太脆 ——
     判据不该因为夹具里恰好有单就红。改成换时段重试;仍然坚持「必须真建成」,
     不降格成「只要不是所有权错就算过」——那样就验不出写口真能放行本店顾客了。 */
  let same = { status: 0, code: '(没试)', id: '' }
  const slots = ['15:00', '15:30', '16:00', '16:30', '17:00', '17:30']
  for (const t of slots) {
    same = await mkBooking(aUser?.id, t)
    if (same.status !== 409) { console.log(`   [反向守] 用 ${t} 这个时段(前面的撞排期,与所有权无关)`); break }
  }
  check('③b 反向守:同样的请求换成**本店**顾客必须建得成 —— 一把见谁都拒的闸,'
    + `跟没有闸一样守不住任何东西(实测 ${same.status} ${same.code || 'OK'})`,
  same.status === 201 || same.status === 200, JSON.stringify(same))
  if (same.id) {
    /* 夹具收尾(J 族教训:判据不收尾就变成非幂等) */
    const w = new DatabaseSync(SB)
    w.prepare('DELETE FROM bookings WHERE id = ?').run(same.id)
    w.close()
    console.log(`   [收尾] 已删除本轮造的对照单 ${same.id.slice(0, 24)}`)
  }

  /* ③c 读口:A 店订单列表里不得出现任何非本店 tenant 的用户对象。
     🔴 造景律(店主 08-29):D127 清理之后库里**已经没有脏行**,刀就没有阳性可咬了 ——
     「零命中」不等于「守住了」。所以**这一刀自己造景**:临时把一张本店单的 user_id
     指到别店顾客身上(制造一行串味),验读口零下发,**当场还原**。
     造的是我自己指定的那一行,不碰真账;还原后回读确认。 */
  const w = new DatabaseSync(SB)
  const victim = w.prepare('SELECT id, user_id FROM bookings WHERE tenant_id = ? AND user_id IS NOT NULL LIMIT 1').get(A)
  let leaked = []
  let injected = false
  if (victim && bUser?.id) {
    w.prepare('UPDATE bookings SET user_id = ? WHERE id = ?').run(bUser.id, victim.id)
    injected = true
    console.log(`   [刀] 注入点=沙箱 bookings.${victim.id.slice(0, 22)} 的 user_id → ${bUser.id.slice(0, 18)}(属 ${B});回读=${w.prepare('SELECT user_id FROM bookings WHERE id = ?').get(victim.id).user_id.slice(0, 18)}`)
    const r = await fetch(`${SANDBOX}/admin/bookings`, { headers: H(A) }).catch(() => null)
    const list = r ? ((await r.json().catch(() => ({}))).bookings || []) : []
    leaked = list.filter((b) => b.id === victim.id && b.user)
    w.prepare('UPDATE bookings SET user_id = ? WHERE id = ?').run(victim.user_id, victim.id)
    console.log(`   [收尾] 已还原 user_id;回读=${w.prepare('SELECT user_id FROM bookings WHERE id = ?').get(victim.id).user_id.slice(0, 18)}`)
  }
  w.close()
  check('③c 🔴 读口零下发(自己造景验):把一张 A 店单的 user_id 临时指到 B 店顾客身上,'
    + 'A 店订单接口对这一单**不许带 user 对象** —— 造完当场还原',
  injected && leaked.length === 0,
  injected ? `仍在下发:${JSON.stringify(leaked.map((b) => b.user))}`.slice(0, 160) : '没造出阳性(取不到样本单或 B 店顾客)—— 这一条不算验过')

}

console.log(`\n[跨租户所有物] 静态两处闸 · 行为层三条(沙箱;③c 自己造景验)`)
if (fails.length) { console.error(`\n❌ test-tenant-ownership ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-tenant-ownership 通过 ${checks} 项`)
