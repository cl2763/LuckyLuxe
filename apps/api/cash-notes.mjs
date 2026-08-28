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

/* 🔴 收窄(店主 08-28 六裁:**一个动作一个入口**)。
   她问「现金手记是干嘛用的?我之前已经有记一笔了,两个是不是有重叠」—— 有,是设计漏洞:
   买材料付现 50,点记一笔抽屉不减、点现金手记损益不记,难道记两次?
   裁定:**买东西花钱一律走「记一笔」并选付款方式**;现金手记只留「既不是赚也不是花」的三种。
   `expense` 因此**退役**:老数据还读得出来(账本口径:只追加不删),但**不许再新记**,
   写口会把人指回「记一笔」。 */
export const CASH_NOTE_KINDS = ['float', 'count_diff', 'amend_change']
export const CASH_NOTE_RETIRED_KINDS = ['expense', 'change']   // 只读:历史数据仍要显示得出来
export const CASH_NOTE_KIND_LABELS = {
  float: '备用金调整',
  count_diff: '盘点差异',
  amend_change: '更正后现金找补',
  expense: '现金支出(已退役 → 请用「记一笔」)',
  change: '找零 / 抹零(已退役 → 并入盘点差异)'
}
export const CASH_NOTE_MAX_CENTS = 100000000   // 单笔上限 100 万:手记是零星现金,再大必然是记错了小数点

/* ===== 「记一笔」的付款方式(店主 2026-08-29 收窄)=====
   店主原话:「这个地方记储值卡有什么意义?储值卡会在会员界面去动他的值,不会在记一笔这里记。」
   裁定:**付款方式的唯一作用 = 判断动不动抽屉。**
   「记一笔」只记**不走订单流程**的收支(买材料、房租、报销、杂项);
   顾客消费的钱走结算单签署 —— 入账唯一路径 = 签署,不在这儿记。
   储值卡消费 = 耗卡 = 确认收入,那是结算单干的事;店家不会拿顾客的储值卡去买材料。

   四个选项:现金(唯一动抽屉的)/ 刷卡 / 转账 / 其他 —— 后三个账上作用完全相同,细分只是备注。
   原来两端下拉里的 微信 / 支付宝 并进「转账」;**储值卡删掉**。
   退役手法与现金手记那两类同刀:**写口拒、读口留**(老账的标签仍显示得出来)。 */
export const MANUAL_ENTRY_CHANNELS = [
  { id: 'cash', label: '现金' },
  { id: 'card', label: '刷卡' },
  { id: 'transfer', label: '转账' },
  { id: 'unknown', label: '其他' }
]
/* 读口标签全集:老账里存过的值都认得出来,历史行不许显示成一串英文。只用于显示,下拉不用它。 */
export const MANUAL_ENTRY_CHANNEL_LABELS = {
  cash: '现金', card: '刷卡', transfer: '转账', unknown: '其他',
  stored_value: '储值卡(已退役)', wechat: '微信(旧,归转账)', alipay: '支付宝(旧,归转账)'
}
export const MANUAL_ENTRY_NOTE = '这里只记不走订单的收支(买材料、房租、报销、杂项)。顾客消费的钱走结算单签署,不在这儿记。'

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
    if (CASH_NOTE_RETIRED_KINDS.includes(kind)) {
      throw apiError(400, 'KIND_RETIRED',
        '花出去或收进来的钱请走「记一笔」并选付款方式(选现金时抽屉会自动跟着减)。现金手记只记「既不是赚也不是花」的:备用金 / 盘点差异 / 更正后现金找补。')
    }
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

  /* 🔴 08-28(六)裁「一个动作一个入口」的另一半:手工「记一笔」**选了现金**的,当天抽屉也得动。
     只认明确选了现金的(`pay_channel='cash'`)—— 'unknown' 不算,否则历史上没选过方式的旧账
     会被悄悄拉进抽屉,把她的应有数改掉。`source='manual'` 只认手工那一类:
     签署单 / 充值那些已经在别的腿里算过了,再算一遍就是重复记账(反向守断言守着这一条)。
     金额符号沿用账本口径:收入为正(钱进抽屉)、支出为负(钱出抽屉)。 */
  function manualCashOfDay(date, tenantId = currentTenantId()) {
    const r = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount_cents), 0) s FROM finance_transactions
      WHERE tenant_id = ? AND occurred_on = ? AND source = 'manual' AND pay_channel = 'cash'`).get(tenantId, date)
    return { manualCashCents: r.s, manualCashCount: r.n }
  }

  /* 抽屉那两条手工腿一次给全(日结那边只写一行,免得每加一条腿就往巨型文件里堆参数)。 */
  function drawerInputs(date, tenantId = currentTenantId()) {
    return Object.assign(
      { notesCents: cashNotesTotalCents(date, tenantId), notesCount: listCashNotes(date, tenantId).length },
      manualCashOfDay(date, tenantId)
    )
  }

  /* 「记一笔」写口的付款方式闸(《后端是最终闸律》:前端下拉即使改了,接口直调也要拦)。 */
  function assertEntryChannelOk(payChannel) {
    const ch = String(payChannel || '')
    /* 不传 = 归「其他」(后端落库 || 'unknown',不动抽屉 —— 保守的那一边)。
       拒的是**明确传了非法值**:说明调用方以为自己在选一个存在的选项,那才是要当场纠正的。 */
    if (!ch) return
    if (ch === 'stored_value') {
      throw apiError(400, 'CHANNEL_RETIRED',
        '顾客用储值卡消费走结算单签署,储值动账在会员界面 —— 不在「记一笔」里记。这里只记不走订单的收支。')
    }
    if (ch === 'wechat' || ch === 'alipay') {
      throw apiError(400, 'BAD_REQUEST', '微信 / 支付宝到账属于「转账」,请选「转账」。')
    }
    if (!MANUAL_ENTRY_CHANNELS.some((c) => c.id === ch)) {
      throw apiError(400, 'BAD_REQUEST', `付款方式只能是:${MANUAL_ENTRY_CHANNELS.map((c) => c.label).join(' / ')}。`)
    }
  }

  /* 选项与那句分工话的唯一出口:两端都从这里拿,不许各写一份(网页搭 GET transactions 的车,小程序打 entry-config)。 */
  function manualEntryConfig() {
    return { channels: MANUAL_ENTRY_CHANNELS, note: MANUAL_ENTRY_NOTE }
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

  return { listCashNotes, cashNotesTotalCents, manualCashOfDay, drawerInputs, addCashNote, reverseCashNote, assertNoteOk, assertEntryChannelOk, manualEntryConfig }
}
