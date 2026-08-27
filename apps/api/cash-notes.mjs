/* 线下现金腿 · 日结手记(D79,店主 2026-08-28 排进批次二)。

   🔴 病:「今晚数钱按这个数」只算**系统内**的现金进出(到店支付 + 现金充值 − 现金退卡)。
   可店里真实发生的现金动作不止这些 —— 买材料付了现金、早上放了备用金、
   金额更正之后当场退了顾客差额……这些系统一律不知道,于是「应有数」永远等不于抽屉。
   店主晚上对不上账,而她不会怀疑"系统少算了一腿",**她会怀疑店员**(与 N-5 那次同一句话)。

   做法:给她一处**手记**。三类:
     · `expense` 现金支出(买材料、打车、临时采购)—— 钱出抽屉,记负数
     · `float`   备用金调整(早上放进去 / 晚上拿走)—— 正负都有
     · `change`  找零 / 抹零差额 —— 通常很小,正负都有
     · `amend_change` 金额更正后的现金找补 —— **08-27 店主登记的那一行就落在这个口**
       (更正把单据改小了,差额若当场退了现金,以前系统没地方记)

   两条硬规矩:
   ① **只追加,不修改**(账本口径)。记错了写一条反向的「冲销」,原始那条留着,
      谁在什么时候记了什么、后来又冲了什么,全留痕 —— 这跟财务账本是同一套做法。
   ② **手记只影响"抽屉应有数",不进损益、不进营业额、不进业绩。**
      买材料的钱是成本不是负收入,更不是技师的业绩;把它混进营业额等于篡改经营数字。
      这条在 cashDrawerOf 的算式里体现:手记只加在现金那一行,收入影响恒为 0。 */

export const CASH_NOTE_KINDS = ['expense', 'float', 'change', 'amend_change']
export const CASH_NOTE_KIND_LABELS = {
  expense: '现金支出',
  float: '备用金调整',
  change: '找零 / 抹零',
  amend_change: '更正后现金找补'
}
export const CASH_NOTE_MAX_CENTS = 100000000   // 单笔上限 100 万:手记是零星现金,再大必然是记错了小数点

/* 建表 + 结构自证(《静默失败器族》:IF NOT EXISTS 在"表在但结构不同"时什么也不做)。 */
export function ensureCashNotesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cash_notes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      store_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      reverses_id TEXT,
      created_at TEXT NOT NULL
    )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_cash_notes_day ON cash_notes (tenant_id, store_date)')
  const need = ['id', 'tenant_id', 'store_date', 'kind', 'amount_cents', 'note', 'created_by', 'reverses_id', 'created_at']
  const have = db.prepare('PRAGMA table_info(cash_notes)').all().map((c) => c.name)
  const missing = need.filter((c) => !have.includes(c))
  if (missing.length) throw new Error(`cash_notes 表结构不符(缺列:${missing.join(', ')})`)
}

export function createCashNotes({ db, apiError, iso, randomId, currentTenantId, formatMoneyCents }) {
  /* ===== 后端最终闸 ===== */
  function assertNoteOk({ kind, amountCents, note, date }) {
    if (!CASH_NOTE_KINDS.includes(kind)) {
      throw apiError(400, 'BAD_REQUEST', `手记类型不对(只能是:${CASH_NOTE_KINDS.join(' / ')})。`)
    }
    if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
      throw apiError(400, 'BAD_REQUEST', '金额必须是整数分。')
    }
    if (amountCents === 0) throw apiError(400, 'BAD_REQUEST', '记 0 元等于没记 —— 金额不能是 0。')
    if (Math.abs(amountCents) > CASH_NOTE_MAX_CENTS) {
      throw apiError(400, 'BAD_REQUEST', '单笔手记金额超出上限,请核对小数点。')
    }
    /* 🔴 原因必填,而且**后端拦**:更正原因那次的教训 —— 只有网页前端拦,
       小程序和接口直调一律放行,而这条会动"今晚数钱按这个数"。 */
    if (!String(note || '').trim()) {
      throw apiError(400, 'NOTE_REQUIRED', '写一句这笔钱是干什么的 —— 月底对账时你要靠它想起来。')
    }
    if (String(note).length > 120) throw apiError(400, 'BAD_REQUEST', '备注最多 120 字。')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw apiError(400, 'BAD_REQUEST', '日期格式不对(要 YYYY-MM-DD)。')
  }

  function serialize(row, tenantId) {
    const money = (c) => formatMoneyCents(c, tenantId, 'auto')
    return {
      id: row.id,
      date: row.store_date,
      kind: row.kind,
      kindLabel: CASH_NOTE_KIND_LABELS[row.kind] || row.kind,
      amountCents: row.amount_cents,
      // 金额句后端唯一出口:正负号跟着数走,前端零拼串
      amountText: `${row.amount_cents < 0 ? '−' : '+'}${money(Math.abs(row.amount_cents))}`,
      note: row.note || '',
      createdBy: row.created_by || '',
      isReversal: Boolean(row.reverses_id),
      reversesId: row.reverses_id || '',
      createdAt: row.created_at
    }
  }

  function listCashNotes(date, tenantId = currentTenantId()) {
    return db.prepare('SELECT * FROM cash_notes WHERE tenant_id = ? AND store_date = ? ORDER BY created_at ASC')
      .all(tenantId, date).map((row) => serialize(row, tenantId))
  }

  /* 当日手记净额:进"抽屉应有数"的就是这一个数。 */
  function cashNotesTotalCents(date, tenantId = currentTenantId()) {
    return db.prepare('SELECT COALESCE(SUM(amount_cents), 0) n FROM cash_notes WHERE tenant_id = ? AND store_date = ?')
      .get(tenantId, date).n
  }

  function addCashNote({ date, kind, amountCents, note, createdBy }, tenantId = currentTenantId()) {
    assertNoteOk({ kind, amountCents, note, date })
    const id = randomId('cashnote')
    db.prepare(`INSERT INTO cash_notes (id, tenant_id, store_date, kind, amount_cents, note, created_by, reverses_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
      .run(id, tenantId, date, kind, amountCents, String(note).trim(), String(createdBy || ''), iso(new Date()))
    return serialize(db.prepare('SELECT * FROM cash_notes WHERE id = ?').get(id), tenantId)
  }

  /* 记错了怎么办:**不删不改**,追加一条金额相反的冲销行,指回原条。
     判据:冲销之后当日净额必须回到"没记过这一笔"的状态,而两条记录都还在。 */
  function reverseCashNote(id, { createdBy, note } = {}, tenantId = currentTenantId()) {
    const src = db.prepare('SELECT * FROM cash_notes WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!src) throw apiError(404, 'NOT_FOUND', '这条手记不存在。')
    if (src.reverses_id) throw apiError(409, 'ALREADY_REVERSAL', '这条本身就是冲销行,不能再冲。')
    const done = db.prepare('SELECT id FROM cash_notes WHERE tenant_id = ? AND reverses_id = ?').get(tenantId, id)
    if (done) throw apiError(409, 'ALREADY_REVERSED', '这条已经冲销过了。')
    const rid = randomId('cashnote')
    db.prepare(`INSERT INTO cash_notes (id, tenant_id, store_date, kind, amount_cents, note, created_by, reverses_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(rid, tenantId, src.store_date, src.kind, -src.amount_cents,
        String(note || `冲销:${src.note}`).slice(0, 120), String(createdBy || ''), id, iso(new Date()))
    return serialize(db.prepare('SELECT * FROM cash_notes WHERE id = ?').get(rid), tenantId)
  }

  return { listCashNotes, cashNotesTotalCents, addCashNote, reverseCashNote, assertNoteOk }
}
