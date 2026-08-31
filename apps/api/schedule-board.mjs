/* 排班域(schedule-week 周网格 / schedule-day 台面日视图)—— 2026-08-30h 从 local-server.mjs 搬出。
   公约②边改边拆 + 棘轮抵扣批(把 +14/+17/+23 的账抵回来)。
   **纯迁移零行为变化**:两段路由体逐字照搬,只把依赖改成注入;搬前后接口响应逐字节对比过
   (证据见 handoff/核验截图_2026-08-30/排班域搬家_字节对比_2026-08-30h.md)。 */

export function createScheduleBoard(deps) {
  const {
    db, json, iso, addMinutes, localParts, localDateTime, currentTenantId, defaultStoreId,
    specialDateFor, hoursUnsetOfStore, getService, isGenericDisplayName, memberCodeForUserId, apiError, readBody
  } = deps

  /* 值日表(店主 31l 小合同六条):按天标记 technician×date,不碰排班 is_working 语义;
     开关=tenant_settings key 'duty_enabled',默认关(合同一);历史日只读(合同五)。 */
  function ensureSchema() {
    db.exec(`CREATE TABLE IF NOT EXISTS duty_marks (
      tenant_id TEXT NOT NULL,
      date TEXT NOT NULL,
      technician_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, date, technician_id)
    )`) 
  }
  function dutyEnabled(tid) {
    const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'duty_enabled'").get(tid)
    return row ? String(row.value).replace(/"/g, '') === '1' : false
  }
  function dutyOf(tid, date) {
    return db.prepare('SELECT technician_id FROM duty_marks WHERE tenant_id = ? AND date = ?').all(tid, date).map((r) => r.technician_id)
  }

  async function route(req, res, ctx) {
    const { path, query } = ctx
    if (req.method === 'GET' && path === '/admin/schedule-week') {
      const from = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : null
      const base = from ? localDateTime(from, '12:00') : new Date()
      // 对齐到周一
      const monday = new Date(base)
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
      const storeId = query.storeId || defaultStoreId()
      const days = []
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(monday)
        d.setDate(monday.getDate() + i)
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const weekday = localDateTime(dateStr, '12:00').getDay()
        const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(storeId, weekday)
        const special = specialDateFor(storeId, dateStr)
        // D84 同族第二处:未设置 ≠ 休息;判定收口到 hoursUnsetOfStore(图 v1.0:七天全关也算未设置)
        const wkUnset = !special && hoursUnsetOfStore(db, storeId)
        days.push({
          date: dateStr,
          weekday,
          hoursUnset: wkUnset,
          isClosed: special ? Boolean(special.is_closed) : (wkUnset ? false : (!hours || Boolean(hours.is_closed))),
          openTime: (special && !special.is_closed && special.open_time) || (hours && !hours.is_closed ? hours.open_time : null),
          closeTime: (special && !special.is_closed && special.close_time) || (hours && !hours.is_closed ? hours.close_time : null),
          specialNote: special?.note || (special ? (special.is_closed ? '特殊休息' : '特殊时段') : '')
        })
      }
      // 排班为团队可见:员工也返回本店全部技师(只读);多租户按店过滤
      const technicians = db.prepare('SELECT * FROM technicians WHERE tenant_id = ? ORDER BY is_active DESC, name ASC').all(currentTenantId())
      const dates = days.map((day) => day.date)
      // 2026-08-07:此前只按日期取,别家店的排班行会一起返回;限定为本店技师
      const techIds = technicians.map((t) => t.id)
      const schedules = (techIds.length ? db.prepare(`SELECT technician_id, date, start_time, end_time, is_working FROM technician_schedules
          WHERE date IN (${dates.map(() => '?').join(',')}) AND technician_id IN (${techIds.map(() => '?').join(',')})`)
        .all(...dates, ...techIds) : [])
        .map((row) => ({ technicianId: row.technician_id, date: row.date, startTime: row.start_time, endTime: row.end_time, isWorking: Boolean(row.is_working) }))
      const bookingCounts = []
      for (const day of days) {
        const dayStart = iso(localDateTime(day.date, '00:00'))
        const dayEnd = iso(addMinutes(localDateTime(day.date, '00:00'), 24 * 60))
        const rows = db.prepare(`SELECT technician_id, COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND status IN ('PENDING_PAYMENT','CONFIRMED') AND appointment_start >= ? AND appointment_start < ? GROUP BY technician_id`).all(currentTenantId(), dayStart, dayEnd)
        for (const row of rows) bookingCounts.push({ technicianId: row.technician_id, date: day.date, count: row.n })
      }
      json(res, 200, {
        weekStart: days[0].date,
        days,
        technicians: technicians.map((tech) => ({ id: tech.id, name: tech.name, title: tech.title, isActive: Boolean(tech.is_active) })),
        schedules,
        bookingCounts
      })
      return true
    }
    // 技师维度·日视图(2026-07-22 P0-①):某天每技师的预约明细,前端画时间轴色块
    if (req.method === 'GET' && path === '/admin/schedule-day') {
      const tid = currentTenantId()
      const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : localParts(new Date()).date
      const storeId = query.storeId || defaultStoreId()
      const weekday = localDateTime(date, '12:00').getDay()
      const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(storeId, weekday)
      const special = specialDateFor(storeId, date)
      /* 🔴 D84(店主 2026-08-29 自诊出的真根因):原来这里 `!hours ||` 把「business_hours 没有这一行
         (= 从来没设置过营业时间)」静默判成「休息」—— 一个缺失配置无声吞掉整个台面功能面,
         还给了误导性文案(明明是没设置,却说本日休息)。静默失败器族(`|| 默认值` 变体)。
         三态口径(空态律:空态说真话):设置了且当天休 → isClosed;**整店从没设置过 → hoursUnset**
         (两端渲染引导墙「还没设置营业时间」+ 直达设置);休息态只留给真休息。
         参照 isClosedDay(D34)早就写对的口径:「没配过排班的店不算休息」。 */
      const hoursUnset = !special && hoursUnsetOfStore(db, storeId)
      const nowParts = localParts(new Date())   // D88:门店时区「现在」,台面裁过去空档用这一份,不裸 new Date
      const isClosed = special ? Boolean(special.is_closed) : (hoursUnset ? false : (!hours || Boolean(hours.is_closed)))
      const openTime = (special && !special.is_closed && special.open_time) || (hours && !hours.is_closed ? hours.open_time : null)
      const closeTime = (special && !special.is_closed && special.close_time) || (hours && !hours.is_closed ? hours.close_time : null)
      const allTechs = db.prepare('SELECT id, name, title, is_active FROM technicians WHERE tenant_id = ? ORDER BY is_active DESC, name ASC').all(tid)
      const dayStart = iso(localDateTime(date, '00:00'))
      const dayEnd = iso(addMinutes(localDateTime(date, '00:00'), 24 * 60))
      /* 裁C(店主 08-22):售后单带徽标上日历,不再蒸发——转售后前它就在台面上,
         行踪不应因售后断链(D66 位面④)。 */
      const rows = db.prepare(`SELECT * FROM bookings WHERE tenant_id = ? AND status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED','AFTER_SALES')
        AND appointment_start >= ? AND appointment_start < ? ORDER BY appointment_start ASC`).all(tid, dayStart, dayEnd)
      // 服务分组(色相):足部美甲/护理由名称识别,其余按类型
      const groupOf = (svc) => {
        if (!svc) return 'hand'
        const n = String(svc.name_zh || '') + String(svc.category || '')
        if (/足|美足|pedicure/i.test(n)) return 'foot'
        if (/护理|护|spa/i.test(n)) return 'care'
        const t = String(svc.type).toUpperCase()
        if (t === 'LASH') return 'lash'
        if (t === 'CARE' || t === 'OTHER') return 'care' // 新类型:台面用护理色相
        return 'hand'
      }
      const bookings = rows.map((row) => {
        const svc = row.service_id ? getService(row.service_id) : null
        const u = row.user_id ? db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(row.user_id) : null
        const startLocal = localParts(row.appointment_start)
        const endLocal = localParts(row.appointment_end)
        const arrivalState = row.status === 'COMPLETED' ? 'done' : (row.arrived_at ? 'active' : 'pending')   // 合同⑤:售后单主状态本就是 COMPLETED
        // 新客:该顾客在本店有没有更早的单(按 appointment_start)
        const earlier = row.user_id
          ? db.prepare(`SELECT 1 FROM bookings WHERE tenant_id = ? AND user_id = ? AND appointment_start < ?
              AND status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED') LIMIT 1`).get(tid, row.user_id, row.appointment_start)
          : null
        const custName = u ? (isGenericDisplayName(u.display_name, u.id) ? memberCodeForUserId(u.id) : u.display_name) : '散客'
        return {
          id: row.id,
          publicCode: row.public_code,
          technicianId: row.technician_id,
          userId: row.user_id,
          status: row.status,
          customerName: custName,
          serviceId: row.service_id || '', // 台面点单 → 去结算,结算页要用它预勾预约项目
          serviceName: svc ? svc.name_zh : '服务',
          serviceType: svc ? svc.type : '',
          group: groupOf(svc),
          arrivalState,
          startTime: startLocal.time,
          endTime: endLocal.time,
          durationMin: row.total_duration_min || Math.max(30, Math.round((new Date(row.appointment_end) - new Date(row.appointment_start)) / 60000)),
          isNewCustomer: !earlier,
          isDesignated: /指定|指名|点名/.test(String(row.notes || '')),
          ownerDirect: row.source_channel === 'owner_direct',
          depositUnpaid: Boolean(row.direct_deposit_unpaid),
          // 裁C:售后单蓝徽标(句后端唯一)
          afterSales: Boolean(row.after_sales_status),             // 合同⑤:台面日历的售后标记读轨道
          afterSalesTag: row.after_sales_status ? '售后' : ''
        }
      })
      const bookingCount = {}
      for (const b of bookings) bookingCount[b.technicianId] = (bookingCount[b.technicianId] || 0) + 1
      // 只显示在岗技师 + 今天有单的技师(避免停用测试技师塞满表头)
      const technicians = allTechs
        .filter((t) => t.is_active || bookingCount[t.id])
        .map((t) => ({ id: t.id, name: t.name, title: t.title, isActive: Boolean(t.is_active), bookingCount: bookingCount[t.id] || 0 }))
      const activeCount = bookings.filter((b) => b.arrivalState === 'active').length
      const pendingCount = bookings.filter((b) => b.arrivalState === 'pending').length
      /* 值日(31l 合同二/四/六):开关关=响应整块不出现(零渲染);开=名单+空态句后端出(两端同句) */
      const dutyBlock = dutyEnabled(tid) ? {
        enabled: true,
        techIds: dutyOf(tid, date),
        canEdit: ctx.adminSession?.role === 'owner' && date === nowParts.date,
        note: dutyOf(tid, date).length ? '' : '今天还没安排值日'
      } : undefined
      json(res, 200, {
        storeNow: nowParts.time, storeToday: nowParts.date,
        date, weekday, isClosed, hoursUnset, openTime, closeTime,
        specialNote: special?.note || '',
        technicians,
        bookings,
        activeCount, pendingCount,
        ...(dutyBlock ? { duty: dutyBlock } : {})
      })
      return true
    }
    /* 值日开关(门店设置;仅老板) */
    if (req.method === 'PUT' && path === '/admin/duty-setting') {
      if (ctx.adminSession?.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可开关值日表。')
      const body = await readBody(req)
      const on = body.enabled === true
      db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'duty_enabled', ?, ?)
        ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(currentTenantId(), on ? '1' : '0', iso(new Date()))
      json(res, 200, { enabled: on })
      return true
    }
    if (req.method === 'GET' && path === '/admin/duty-setting') {
      json(res, 200, { enabled: dutyEnabled(currentTenantId()) })
      return true
    }
    /* 勾/取消(仅老板;合同三勾选即存,合同五历史日只读=只许今天) */
    if (req.method === 'POST' && path === '/admin/duty/mark') {
      if (ctx.adminSession?.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可安排值日。')
      const tid = currentTenantId()
      if (!dutyEnabled(tid)) throw apiError(400, 'BAD_REQUEST', '本店未开启值日表(门店设置里打开)。')
      const body = await readBody(req)
      const date = String(body.date || '')
      const today = localParts(new Date()).date
      if (date !== today) throw apiError(400, 'BAD_REQUEST', '值日只能勾当天(历史日只读)。')
      const techId = String(body.technicianId || '')
      if (!db.prepare('SELECT 1 FROM technicians WHERE id = ? AND tenant_id = ?').get(techId, tid)) throw apiError(404, 'NOT_FOUND', '技师不存在。')
      if (body.on === false) db.prepare('DELETE FROM duty_marks WHERE tenant_id = ? AND date = ? AND technician_id = ?').run(tid, date, techId)
      else db.prepare('INSERT OR IGNORE INTO duty_marks (tenant_id, date, technician_id, created_at) VALUES (?, ?, ?, ?)').run(tid, date, techId, iso(new Date()))
      json(res, 200, { date, techIds: dutyOf(tid, date) })
      return true
    }
    return false
  }

  return { route, ensureSchema }
}
