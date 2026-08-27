/* 业绩基数 · 分成 · 业绩调整行 —— 从 local-server.mjs 搬出(公约①②,2026-08-27)。

   本批动的就是这个领域(金额更正要联动业绩),按「边改边拆」整族搬过来。
   这里是**业绩这一侧的唯一实现**:日结视图取净额、确认时进快照线(daily_close_lines),
   排行/工资/我的业绩/目标全部继承那条快照,任何读方不许自己再算(四之九 双端同病)。 */
export function createPerfAdjust({ db, localParts, tenantTimezone, settlementTechRows }) {
  /* 单技师单不需要分配:整单业绩就是他的,进 daily-close 时直接算,不占「待分配」。
     双技师单必须店长逐单分成 —— 系统不猜,预填只是预填。 */
  function needsAllocation(row, tenantId) {
    const techs = settlementTechRows(row.id, tenantId)
    return techs.length > 1 && row.perf_alloc_status !== 'allocated'
  }

  function perfSplitDefault(tenantId) {
    const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'perf_split_default'").get(tenantId)
    if (row) {
      try {
        const parsed = JSON.parse(row.value || '{}')
        if (Array.isArray(parsed.main) && parsed.main.length) return parsed.main.map(Number)
      } catch { /* 落回默认 */ }
    }
    return [70, 30] // 主 70 / 副 30,店主可在设置里改
  }

  /* 🔴 `perf_base_cents` 是**派生字段,不许直接写**(店主 2026-08-27 登记标死)。
     它有**两个写入者**:业务写一次、开机迁移 `migratePerfBaseToSubtotal()` 按 subtotal_cents 覆盖一次。
     谁把业务值写进去,下次重启就被静默抹掉 —— 08-27 金额更正联动业绩时差点踩进去。
     要调业绩,走本文件的 `perfAdjustRowsOn`(读时调整行,自带自证明细)。
     归族「一个字段只许回答一个问题」。test-ledger-guards 有一条会红的断言守这件事。

     分成/业绩的基数 = **档位小计**(店主 2026-08-09 拍板,设计图规则③)。
     定金是付款时序、券是店铺让利 —— 技师做了多少活,业绩就是多少,两者都不扣。
     落库的 perf_base_cents 是权威值;没有这一列的老行回落到 subtotal_cents(同一口径)。 */
      function settlementPerfBaseCents(row) {
    return row.perf_base_cents || row.subtotal_cents
  }

  // 某张单每位技师分到多少业绩。已分配读 share_cents;单技师整单;双技师未分配返回 null(待分配)
    function settlementPerfShares(row, tenantId) {
    const techs = settlementTechRows(row.id, tenantId)
    if (!techs.length) return []
    if (techs.length === 1) return [{ technicianId: techs[0].technician_id, role: techs[0].role, sharePct: 100, shareCents: settlementPerfBaseCents(row) }]
    if (row.perf_alloc_status !== 'allocated') {
      return techs.map((t) => ({ technicianId: t.technician_id, role: t.role, sharePct: null, shareCents: null }))
    }
    return techs.map((t) => ({ technicianId: t.technician_id, role: t.role, sharePct: t.share_pct, shareCents: t.share_cents || 0 }))
  }

  /* 售后业绩扣回(店主拍板 a 案+三裁,2026-08-21):聚合层负记录的**唯一实现**——
     日结视图净额+确认快照线(daily_close_lines)继承到排行/工资/我的业绩/目标,任何读方不许自己再算(四之九)。
     范围钉死:只有 timecardReleased 更正产生扣回;普通更正/券/定金不动业绩(规则③原样)。
     归属日=返还发生日(裁①案X:已确认日结不追溯漂移;确认后才发生的返还由既有 R1「数字已过期→重开」机制收口;
     跨月售后扣当月=已知后果入册,《财务总逻辑》§十-7 同段写明)。
     技师归属(裁②):单技师全额;双技师按日结 share 比例摊、末位吃余数;未分配即返还(罕见)按店默认比例摊。 */
  /* 业绩调整行的**唯一出口**(读时现算,零落库):
     ①售后返还次卡次数 → 「售后扣回」(原有)
     ②金额更正差额     → 「更正扣回 / 更正补记」(店主 08-27 拍板加的)
     两族都按这张单的技师分成比例摊到人头,末位吃余数(与迁移、售后扣回同一套算法)。
     归属日:售后=返还当天;更正=未确认落**服务日**、已确认落**更正当天**(after_json.perfMode)。 */
  function perfAdjustRowsOn(date, tenantId) {
    const out = perfReleaseRowsOn(date, tenantId)
    const tz = tenantTimezone(tenantId)
    const rows = db.prepare(`SELECT a.after_json, a.amount_delta_cents d, a.amended_at, s.id AS sid, s.code
      FROM settlement_amendments a JOIN settlements s ON s.id = a.settlement_id
      WHERE a.tenant_id = ? AND a.amount_delta_cents <> 0`).all(tenantId)
    for (const r of rows) {
      let meta = {}
      try { meta = JSON.parse(r.after_json || '{}') } catch { meta = {} }
      /* 08-27 之前的老更正行没有 perfMode —— 它们那时**根本没联动业绩**,
         现在补算等于回溯历史业绩(店主口径:已定格的不回溯)。所以老行一律跳过,不认领。 */
      if (!meta.perfMode) continue
      const day = meta.perfMode === 'base'
        ? (meta.serviceDay || '')
        : localParts(new Date(r.amended_at), tz).date
      if (day !== date) continue
      const s = db.prepare('SELECT * FROM settlements WHERE id = ?').get(r.sid)
      const shares = settlementPerfShares(s, tenantId)
      const base = settlementPerfBaseCents(s)
      const deduct = -r.d                       // 单据少收 48 → 业绩扣 48;补收则为负数(=加回去)
      let parts = []
      if (shares.length === 1) {
        parts = [{ technicianId: shares[0].technicianId, deductCents: deduct }]
      } else if (shares.length > 1 && shares.every((x) => x.shareCents !== null) && base > 0) {
        parts = shares.map((x) => ({ technicianId: x.technicianId, deductCents: Math.floor(deduct * x.shareCents / base) }))
        parts[parts.length - 1].deductCents += deduct - parts.reduce((n, p) => n + p.deductCents, 0)
      }
      // 双技师未分配:暂缓(与售后扣回同口径;分配落定后这一行自动出现)
      for (const p of parts) {
        out.push({
          technicianId: p.technicianId, deductCents: p.deductCents, code: s.code, settlementId: s.id,
          itemName: '', releasedAt: r.amended_at, kind: 'amend',
          label: `${r.d < 0 ? '更正扣回' : '更正补记'} · ${s.code}`
        })
      }
    }
    return out
  }

  function perfReleaseRowsOn(date, tenantId) {
    const amendments = db.prepare(`SELECT a.amended_at, s.id AS sid FROM settlement_amendments a
      JOIN settlements s ON s.id = a.settlement_id
      WHERE a.tenant_id = ? AND a.after_json LIKE '%"timecardReleased":true%'`).all(tenantId)
    const out = []
    for (const r of amendments) {
      if (localParts(new Date(r.amended_at), tenantTimezone(tenantId)).date !== date) continue
      const item = db.prepare("SELECT amount_cents, name_snapshot FROM settlement_items WHERE settlement_id = ? AND kind = 'timecard'").get(r.sid)
      const unit = item ? item.amount_cents : 0
      if (!unit) continue
      const s = db.prepare('SELECT * FROM settlements WHERE id = ?').get(r.sid)
      const shares = settlementPerfShares(s, tenantId)
      const base = settlementPerfBaseCents(s)
      let parts
      if (shares.length <= 1) {
        parts = shares.length ? [{ technicianId: shares[0].technicianId, deductCents: unit }] : []
      } else if (shares.every((x) => x.shareCents !== null) && base > 0) {
        parts = shares.map((x) => ({ technicianId: x.technicianId, deductCents: Math.floor(unit * x.shareCents / base) }))
        parts[parts.length - 1].deductCents += unit - parts.reduce((n, p) => n + p.deductCents, 0)
      } else {
        /* 双技师未分配即返还(假设⑥,Cowork 尾②):扣回**暂缓**——不用默认比例猜;
           本函数读时现算,分配落定后扣回行按真实比例自动出现。
           日结确认闸(UNALLOCATED blocker)保证冻结快照永远是分配后的正确版。 */
        parts = []
      }
      for (const p of parts) {
        out.push({
          technicianId: p.technicianId, deductCents: p.deductCents, code: s.code, settlementId: s.id,
          itemName: (item && item.name_snapshot) || '', releasedAt: r.amended_at, kind: 'after_sales',
          label: `售后扣回 · ${s.code}`
        })
      }
    }
    return out
  }

  return { settlementPerfBaseCents, settlementPerfShares, perfReleaseRowsOn, perfAdjustRowsOn, needsAllocation, perfSplitDefault }
}
