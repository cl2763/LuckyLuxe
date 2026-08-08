/* 给本地沙盘铺一组「今天」的演示单,供小程序/网页走查与截图用。
   店主 2026-08-08 明确授权:**只对本地测试库**造数据,生产一行都不碰。

   铺什么:
   - 今天的排班(全天班),否则下单会被时段挡住
   - 三张不同状态的预约:待到店 / 到店·进行中 / 待付定金
   - 其中一张走完整闭环:结算开单(主项目 + 加项 + 定金抵扣 + 双技师各勾编号)
     → 推送签字 → 演示顾客签署(生成签署快照)→ 落到当日日结的「待分配」

   日期一律取 /admin/store-clock 的 today(按门店时区),不硬写字符串。
   幂等:已经铺过就跳过,重复跑不会堆一堆单。

   用法:node tools/seed-demo-today.mjs [tenantId ...]     默认两家店都铺 */
const BASE = process.env.SEED_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
const EXTRA = process.argv.includes('--extra') // 跳过幂等检查,再补一条完整闭环
const TENANTS = process.argv.slice(2).filter((a) => a !== '--extra').length
  ? process.argv.slice(2).filter((a) => a !== '--extra')
  : ['jics-nail', 'lucky-luxe']
const MARK = '演示单'
// 生产上已确认的名单(小婕店);本地缺人时照这份补,保证截图上的名字与真实一致
const ROSTER = {
  'jics-nail': [['小婕', '店长'], ['鹤辰', ''], ['苏苏', ''], ['翠花', '']]
}

if (!/127\.0\.0\.1|localhost/.test(BASE)) {
  console.error(`拒绝执行:这个脚本只对本地沙盘用,当前 BASE=${BASE}`)
  process.exit(1)
}

async function call(path, options = {}, tenantId = null) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(tenantId ? { 'x-admin-tenant-id': tenantId, 'x-tenant-id': tenantId } : {}),
      ...(options.headers || {})
    }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 200) } }
  return { status: res.status, data }
}

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} 失败(${r.status}): ${JSON.stringify(r.data).slice(0, 240)}`)
  return r.data
}

async function seedTenant(tenantId) {
  console.log(`\n=== ${tenantId} ===`)
  const clock = must(await call('/admin/store-clock', {}, tenantId), '读门店时钟')
  const today = clock.today
  console.log(`门店今天:${today}(时区 ${clock.timezone || '—'})`)

  // 本地库里技师可能是空的(生产上的名单是 configure-jienail 建的,没同步到本机)。
  // 缺人就按已确认的名单补上 —— 只补本地,生产不动。
  let techs = (must(await call('/admin/technicians?roster=1', {}, tenantId), '读技师')).technicians || []
  if (techs.length < 2) {
    const roster = ROSTER[tenantId] || [['技师A', ''], ['技师B', '']]
    for (const [name, title] of roster) {
      if (techs.some((t) => t.name === name)) continue
      const r = await call(`/platform/tenants/${tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name, title }) })
      if (r.status >= 300) console.log(`  建技师 ${name} 失败(${r.status})`)
    }
    techs = (must(await call('/admin/technicians?roster=1', {}, tenantId), '重读技师')).technicians || []
    console.log(`本地技师名单已补齐:${techs.map((t) => t.name).join('、')}`)
  }
  if (techs.length < 2) throw new Error('这家店技师不足 2 位,双技师单铺不了')
  const items = (must(await call('/admin/pricing/items', {}, tenantId), '读价目表')).items || []
  const mains = items.filter((i) => (i.itemKind || 'main') === 'main' && i.isActive !== false)
  const addons = items.filter((i) => i.itemKind === 'addon' && i.isActive !== false && i.unit !== 'per_finger')
  if (!mains.length) throw new Error('这家店没有在售主项目')

  // 今天先排班,否则下单会被「该技师这天休息 / 时段外」挡住
  for (const t of techs.slice(0, 4)) {
    await call(`/admin/technicians/${encodeURIComponent(t.id)}/schedule`, {
      method: 'PATCH', body: JSON.stringify({ date: today, shift: 'full' })
    }, tenantId)
  }

  // 幂等:今天已经有演示单就不再铺
  const dayView = must(await call(`/admin/schedule-day?date=${today}`, {}, tenantId), '读今日台面')
  if (!EXTRA && (dayView.bookings || []).length >= 3) {
    console.log(`今天已有 ${dayView.bookings.length} 单,跳过铺数据(幂等)`)
    return { today, skipped: true }
  }

  // 顾客:用平台导入建三位(已存在会复用,导入本身幂等按手机号)
  const imported = must(await call(`/platform/tenants/${tenantId}/import/customers`, {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      rows: [
        { name: '小红', phone: '13800000001' },
        { name: 'momo', phone: '13800000002' },
        { name: '阿禾', phone: '13800000003' }
      ]
    })
  }), '导入演示顾客')
  const users = (imported.users || []).map((u) => u.userId)
  console.log(`演示顾客 ${users.length} 位`)

  // 三张不同状态的预约
  const plan = [
    { time: '11:00', tech: 0, user: 0, arrive: false, deposit: true, note: '待到店' },
    { time: '13:30', tech: 0, user: 1, arrive: true, deposit: true, note: '到店·进行中' },
    { time: '15:00', tech: 1, user: 2, arrive: false, deposit: false, note: '待付定金' }
  ]
  // --extra:只补一条到店单用来再走一次闭环(签署快照按当前环境决定 cos/inline)
  if (EXTRA) plan.splice(0, plan.length, { time: '16:30', tech: 1, user: 0, arrive: true, deposit: true, note: '到店·进行中(补)' })
  const made = []
  for (const p of plan) {
    const r = await call('/admin/bookings/direct', {
      method: 'POST',
      body: JSON.stringify({
        serviceId: mains[0].id,
        technicianId: techs[p.tech].id,
        date: today,
        time: p.time,
        durationMin: 90,
        depositPaid: p.deposit,
        userId: users[p.user],
        notes: MARK
      })
    }, tenantId)
    if (r.status >= 300) { console.log(`  ${p.time} ${p.note} 排单失败(${r.status}):${JSON.stringify(r.data).slice(0, 160)}`); continue }
    const booking = r.data.booking || r.data
    made.push({ ...p, id: booking.id })
    if (p.arrive) await call(`/admin/bookings/${encodeURIComponent(booking.id)}/arrival`, { method: 'PATCH', body: JSON.stringify({ arrived: true }) }, tenantId)
    console.log(`  ${p.time} ${p.note} ✓`)
  }

  // 完整闭环:拿「到店·进行中」那张开结算单
  const target = made.find((m) => m.arrive) || made[0]
  if (!target) { console.log('没排上单,闭环跳过'); return { today } }
  const lineItems = [{ serviceId: mains[0].id }]
  if (addons[0]) lineItems.push({ serviceId: addons[0].id })
  const group = must(await call('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      bookingId: target.id,
      cardOwnerUserId: users[target.user],
      settlements: [{
        tierKey: 'member',
        items: lineItems,
        depositApplied: true,
        technicians: [
          { technicianId: techs[0].id, role: 'main', itemNos: [1] },
          { technicianId: techs[1].id, role: 'assist', itemNos: lineItems.length > 1 ? [2] : [1] }
        ]
      }]
    })
  }, tenantId), '开结算单')
  const sheet = group.settlements[0]
  console.log(`  结算单 ${sheet.code} 已推送 · 应收 ${sheet.totalCents / 100}`)

  // 顾客签署(生成签署快照;签完这单就落到当日日结的待分配)
  const signed = await call(`/settlements/${encodeURIComponent(sheet.code)}/sign`, {
    method: 'POST',
    body: JSON.stringify({ disclaimerAccepted: true, signature: '小红', strokes: [[{ x: 10, y: 30 }, { x: 60, y: 12 }, { x: 110, y: 34 }]] })
  }, tenantId)
  if (signed.status >= 300) console.log(`  签署失败(${signed.status}):${JSON.stringify(signed.data).slice(0, 200)}`)
  else console.log(`  顾客已签署 ✓ 快照 ${signed.data.settlement?.snapshot?.storage || '(无)'}`)

  const dc = must(await call(`/admin/daily-close?date=${today}`, {}, tenantId), '读日结')
  console.log(`  日结:${dc.dailyClose.orderCount} 单 · 待分配 ${dc.dailyClose.pendingAllocation.length} 单`)
  return { today, code: sheet.code }
}

async function main() {
  for (const t of TENANTS) {
    try { await seedTenant(t) } catch (e) { console.error(`${t} 铺数据失败:${e.message}`) }
  }
  console.log('\n完成。这些数据只在本地库里,生产未受影响。')
}

main().catch((e) => { console.error(e.message); process.exit(1) })
