/* 签署文件留档 —— 顾客档案里的「线下签完的纸,拍照存档」
 *
 * 合同:Artifact「签署文件留档」**v2**(店主 09-15 批 v1,09-20 改第 5 屏)。
 * 🔴 本模块只做**第一步:商家端 + 后端**。顾客端只读是第二步,**本模块一个公开口都不开**(10b §一)。
 *
 * 为什么是新模块:公约① 新功能一律新模块;`local-server.mjs` 只留一行分发。
 *
 * ── 五条定死的口径(图上「口径」那一节,逐条对应到代码)──────────────────
 * ① 挂**顾客档案**,不挂订单           → `signed_docs.user_id` 必填,没有 booking_id
 * ② 🔴 **不能删,只能作废且留痕**       → 没有任何 DELETE 路由 + 两张表各一条 BEFORE DELETE 触发器
 * ③ 一份可多页                          → `signed_doc_pages` 一对多,按 `page_no` 排
 * ④ 店主 + 技师都能传(与小记同档权限)→ 技师锁照抄小记那一把(只限自己服务过的顾客)
 * ⑤ 默认私密                            → `customer_visible`:`other` 落库写 0,另两种写 1
 *
 * ── J-71 判别式:绕过界面、绕过路由、直接连库 DELETE —— 也删不掉 ────────────
 * 触发器住在**最低那一层**。路由层不给删只是"没有入口",触发器才是"做不到"。
 */

/* 🔴 显示名以合同图 v2 为准。
   图上三处(屏2 选项 / 屏4 两行 / 「已拍板①」逐字枚举)都写「价格表确认书」;
   10b §〇 的表里写的是「护理同意书」,而 10b §〇 自己定了「以图 v2 为准」⇒ 取图。
   机器名图上没有(不可见),取 `pricelist` 而不是 10b §三.1 提的 `consent` ——
   一个叫 `consent` 的字段里装价格表,是给下一个人埋雷。**已记入假设清单等裁。** */
export const DOC_TYPES = Object.freeze({
  rights:    { label: '会员充值权益确认书', customerVisible: 1 },
  pricelist: { label: '价格表确认书',       customerVisible: 1 },
  other:     { label: '其他',               customerVisible: 0 },   // 显示名由 title 覆盖
})
export const DOC_TYPE_KEYS = Object.freeze(Object.keys(DOC_TYPES))

/* 建表/迁移。🔴 `CREATE TABLE IF NOT EXISTS` 是静默失败器族(判据一):表在但结构不同就悄悄不建。
   两张都是**全新表**(全仓搜过,没有同名 —— 08-27 `service_notes` 撞名那次的教训:先搜复用,公约④),
   所以这里用它是安全的;而**列一律另走 `try/catch ALTER`**(纪律 8),只写进 CREATE 等于只对全新库生效。
   配套:`test-schema-consistency` 会把「空库新建」与「老库迁移后」逐表逐列 diff,漏写 ALTER 当场红。 */
export function ensureSignedDocsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS signed_docs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    title TEXT,
    page_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    customer_visible INTEGER NOT NULL DEFAULT 1,
    voided_at TEXT, voided_by TEXT, void_reason TEXT,
    created_by TEXT NOT NULL, created_by_name TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS signed_doc_pages (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    page_no INTEGER NOT NULL,
    storage TEXT NOT NULL,
    url TEXT, inline_data TEXT, mime TEXT, bytes INTEGER,
    created_at TEXT NOT NULL
  )`)
  /* 列一律走 try/catch ALTER —— 老库(含生产)不会跟着 CREATE 走 */
  for (const [table, col, decl] of [
    ['signed_docs', 'customer_visible', 'INTEGER NOT NULL DEFAULT 1'],
    ['signed_docs', 'created_by_name', 'TEXT'],
    ['signed_doc_pages', 'bytes', 'INTEGER'],
  ]) { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`) } catch { /* 已有 */ } }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_signed_docs_user ON signed_docs(tenant_id, user_id, created_at DESC)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_signed_doc_pages_doc ON signed_doc_pages(doc_id, page_no)`)
  /* 🔴 口径② 的最低那一层。与账本 `*_no_delete` 那一族同姿态。 */
  db.exec(`CREATE TRIGGER IF NOT EXISTS signed_docs_no_delete BEFORE DELETE ON signed_docs
    BEGIN SELECT RAISE(ABORT, '签字凭证不许删,只能作废'); END`)
  db.exec(`CREATE TRIGGER IF NOT EXISTS signed_doc_pages_no_delete BEFORE DELETE ON signed_doc_pages
    BEGIN SELECT RAISE(ABORT, '签字凭证的页不许删,只能把整份作废'); END`)
}

import { makeActorOf } from './actor-name.mjs'

export function createSignedDocs({ db, iso, randomId, apiError, json, readBody, currentTenantId, cosPutObject, requireCustomer, resolveTenant }) {
  ensureSignedDocsSchema(db)

  const tid = () => currentTenantId()
  const two = (n) => String(n).padStart(2, '0')
  /* 🔴 后端唯一出口出句(假数回落红线③):同一份文件在网页商家端、小程序商家端、
     将来顾客端,三处必须说同一句话 —— 前端零拼串。 */
  const fmt = (isoStr) => {
    const d = String(isoStr || '')
    return { date: d.slice(0, 10), md: `${d.slice(5, 7)}-${d.slice(8, 10)}`, hm: d.slice(11, 16) }
  }
  /* 🔴 J-105(10d):`actorOf` 原来写在本文件里,现在抽成共用出口 `./actor-name.mjs` ——
     10d 要把现金手记那两处也改过去,再留一份在这儿就是「一件事两处真相」。案底全文在那个文件抬头。 */
  const actorOf = makeActorOf({ apiError })
  const titleOf = (row) => (row.doc_type === 'other' ? (row.title || '其他') : DOC_TYPES[row.doc_type]?.label || row.doc_type)

  function shape(row) {
    const t = fmt(row.created_at)
    const v = fmt(row.voided_at)
    const voided = row.status === 'voided'
    return {
      id: row.id, userId: row.user_id, docType: row.doc_type, title: titleOf(row),
      pageCount: row.page_count, status: row.status,
      customerVisible: row.customer_visible === 1,
      uploadedBy: row.created_by_name || '', createdAt: row.created_at,
      voidedAt: row.voided_at || null, voidedBy: row.voided_by || null, voidReason: row.void_reason || null,
      /* 屏1 行副文案 / 屏4 行副文案 / 屏4 徽章 —— 图上逐字 */
      listMetaText: voided ? `${v.date} · ${row.voided_by || '店里'}作废` : `${row.page_count} 页 · ${t.date} ${t.hm}`,
      profileMetaText: `${t.md} 上传 · ${row.created_by_name || ''}`.replace(/ · $/, ''),
      statusText: voided ? '已作废' : '有效',
      uploadedText: `${row.created_by_name || ''} · ${t.md} ${t.hm}`.replace(/^ · /, ''),
      pageCountText: `${row.page_count} 页`,
    }
  }

  /* ── 技师锁:照抄小记那一把(`local-server.mjs` 写口 08-27 补的那段)────────
     🔴 判据二「读写两道闸」:下面 `guardCustomer` 在**读与写两条路上都调**,不是只守一边。
     `service_notes` 正是读口早就守了、写口漏了整整一批。 */
  function guardCustomer(adminSession, userId) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(userId, tid())
    if (!u) throw apiError(404, 'NOT_FOUND', '没有这位顾客的记录。')
    if (adminSession.role !== 'owner') {
      const mine = db.prepare('SELECT 1 AS hit FROM bookings WHERE tenant_id = ? AND technician_id = ? AND user_id = ? LIMIT 1')
        .get(tid(), adminSession.technicianId || '', userId)
      if (!mine) throw apiError(404, 'NOT_FOUND', '没有这位顾客的记录。')
    }
    return u
  }
  /* 取一份 —— 🔴 `tenant_id` 写在 SQL 里,不是取出来再判(跨店一律「不存在」措辞) */
  function getDoc(adminSession, docId) {
    const row = db.prepare('SELECT * FROM signed_docs WHERE id = ? AND tenant_id = ?').get(docId, tid())
    if (!row) throw apiError(404, 'NOT_FOUND', '没有这份文件。')
    guardCustomer(adminSession, row.user_id)
    return row
  }

  async function storePage(docId, pageNo, dataUrl) {
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(String(dataUrl || ''))
    if (!m) throw apiError(400, 'BAD_REQUEST', '图片格式不对(只收拍照/相册上传的图)。')
    const mime = m[1]
    if (!mime.startsWith('image/')) throw apiError(400, 'BAD_REQUEST', '只收图片。')
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length) throw apiError(400, 'BAD_REQUEST', '图片是空的。')
    let url = null
    /* COS 优先;🔴 **存储故障绝不拦住上传**(与签署快照同口径)—— 退回 inline 入库 */
    if (typeof cosPutObject === 'function') {
      const ext = mime.split('/')[1].replace(/[^a-z0-9]/g, '') || 'jpg'
      try { url = await cosPutObject(`signed-docs/${tid()}/${docId}/${pageNo}.${ext}`, buf, mime) } catch { url = null }
    }
    return { storage: url ? 'cos' : 'inline', url, inline: url ? null : String(dataUrl), mime, bytes: buf.length }
  }

  /* ══ 第二步 · 顾客端只读(图 v2 第 5 屏,10d §二 批准开工)══════════════
   * 🔴 这一屏的全部价值在于它能当证据,所以每一条「不能做什么」都写死在代码里:
   *   · **只看自己的** —— 同一家店 + 本人,**两个条件都判**,不是判一个
   *   · **不能传** —— 顾客端一个写口都不开(下面只有 GET)
   *   · **不能删 / 不能作废** —— 连口都没有,不是「有口但拒绝」
   *   · **作废掉的不显示** —— `status='active'` 写进 SQL
   *   · **`other` 默认不给看** —— `customer_visible=1` 写进 SQL(建的时候就落好了)
   * 🔴 还有一条不在图上但必须守:**顾客形状不许把商家那一侧的字段带出去**
   *   (`created_by` / `voided_by` / `void_reason` / `customer_visible` 一个都不出现)——
   *   顾客要看的是「我签过什么」,不是「店里谁经手的、为什么作废」。 */
  function customerShape(row) {
    const t = fmt(row.created_at)
    return {
      id: row.id, docType: row.doc_type, title: titleOf(row),
      pageCount: row.page_count, pageCountText: `${row.page_count} 页`,
      signedAtText: `${t.date} 签署`,
      createdAt: row.created_at,
    }
  }
  async function handleCustomer(req, res, path) {
    let m = path.match(/^\/my\/signed-docs$/)
    if (m && req.method === 'GET') {
      const customer = requireCustomer(req)                 // ← 条件一:本人
      const tid = resolveTenant(req)                        // ← 条件二:同一家店(顾客侧闸,不回落)
      const rows = db.prepare(`SELECT * FROM signed_docs
        WHERE user_id = ? AND tenant_id = ? AND status = 'active' AND customer_visible = 1
        ORDER BY created_at DESC`).all(customer.id, tid)
      return json(res, 200, {
        docs: rows.map(customerShape),
        emptyText: '还没有签署文件',
        emptyHint: '在店里签过的文件,店员上传后会出现在这里',
        blockTitle: '我签署过的文件',
        readOnlyNote: '这些是店里存档的原件,只能查看',
      }), true
    }
    m = path.match(/^\/my\/signed-docs\/([^/]+)\/pages\/(\d+)$/)
    if (m && req.method === 'GET') {
      const customer = requireCustomer(req)
      const tid = resolveTenant(req)
      /* 🔴 取页也要把四个条件全带上 —— 拿到一个 docId 不等于有权看它的页。
         这是《读写两道闸律》的同族:列表收了,取页那条路也得自己收一遍。 */
      const doc = db.prepare(`SELECT id FROM signed_docs
        WHERE id = ? AND user_id = ? AND tenant_id = ? AND status = 'active' AND customer_visible = 1`)
        .get(decodeURIComponent(m[1]), customer.id, tid)
      if (!doc) throw apiError(404, 'NOT_FOUND', '没有这份文件。')
      const page = db.prepare('SELECT page_no AS pageNo, storage, url, inline_data AS data, mime FROM signed_doc_pages WHERE doc_id = ? AND tenant_id = ? AND page_no = ?')
        .get(doc.id, tid, Number(m[2]))
      if (!page) throw apiError(404, 'NOT_FOUND', '没有这一页。')
      return json(res, 200, page), true
    }
    return false
  }

  async function handle(req, res, path, adminSession) {
    const now = () => iso(new Date())
    if (path.startsWith('/my/signed-docs')) return handleCustomer(req, res, path)

    /* 5.1 建一份 ──────────────────────────────────────────────── */
    let m = path.match(/^\/admin\/customers\/([^/]+)\/signed-docs$/)
    if (m && req.method === 'POST') {
      const userId = decodeURIComponent(m[1])
      guardCustomer(adminSession, userId)
      const body = await readBody(req)
      const docType = String(body.docType || '').trim()
      if (!DOC_TYPE_KEYS.includes(docType)) throw apiError(400, 'BAD_REQUEST', '请先选文件类型。')
      const title = String(body.title || '').trim()
      /* 🔴 判据五「后端是最终闸」:`other` 必填名字,前端拦只算体验 */
      if (docType === 'other' && !title) throw apiError(400, 'BAD_REQUEST', '「其他」要自己写个名字。')
      if (title.length > 60) throw apiError(400, 'BAD_REQUEST', '名字太长了(最多 60 字)。')
      const pages = Array.isArray(body.pages) ? body.pages : []
      if (!pages.length) throw apiError(400, 'BAD_REQUEST', '至少要拍一页。')
      if (pages.length > 20) throw apiError(400, 'BAD_REQUEST', '一份最多 20 页。')
      /* 给不给顾客看:图 v2「上传那一格一个开关」;没给就按类型默认 */
      const visible = body.customerVisible === undefined
        ? DOC_TYPES[docType].customerVisible
        : (body.customerVisible ? 1 : 0)
      const id = randomId('sdoc')
      const stored = []
      for (let i = 0; i < pages.length; i += 1) stored.push(await storePage(id, i + 1, pages[i]))
      /* 🔴 又三律·六「动钱多步写律」的同姿态:一份文件 + N 页是**多步写**,
         中途炸了会留下一份 0 页的空壳。包在一个事务里,要么整份成,要么整份不成。 */
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(`INSERT INTO signed_docs
          (id, tenant_id, user_id, doc_type, title, page_count, status, customer_visible,
           created_by, created_by_name, created_at, updated_at)
          VALUES (?,?,?,?,?,?,'active',?,?,?,?,?)`).run(
          id, tid(), userId, docType, title || null, stored.length, visible,
          actorOf(adminSession), actorOf(adminSession), now(), now())
        stored.forEach((p, i) => db.prepare(`INSERT INTO signed_doc_pages
          (id, doc_id, tenant_id, page_no, storage, url, inline_data, mime, bytes, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          randomId('sdpg'), id, tid(), i + 1, p.storage, p.url, p.inline, p.mime, p.bytes, now()))
        db.exec('COMMIT')
      } catch (e) { try { db.exec('ROLLBACK') } catch { /* 已回滚 */ } throw e }
      return json(res, 201, { doc: shape(db.prepare('SELECT * FROM signed_docs WHERE id = ?').get(id)) }), true
    }

    /* 5.4 列表 ──────────────────────────────────────────────── */
    if (m && req.method === 'GET') {
      const userId = decodeURIComponent(m[1])
      guardCustomer(adminSession, userId)
      const rows = db.prepare(`SELECT * FROM signed_docs WHERE tenant_id = ? AND user_id = ?
        ORDER BY (status = 'voided'), created_at DESC`).all(tid(), userId)
      /* 🔴 空态那句也从后端出(图:「还没有签署文件 / 拍照或从相册上传」)—— 两端零拼串 */
      return json(res, 200, {
        docs: rows.map(shape),
        emptyText: '还没有签署文件', emptyHint: '拍照或从相册上传',
        blockTitle: '签署文件',
        moreText: rows.length ? `全部 ${rows.length} 份` : '',
        types: DOC_TYPE_KEYS.map((k) => ({ key: k, label: k === 'other' ? '其他 · 自己写名字' : DOC_TYPES[k].label, customerVisible: DOC_TYPES[k].customerVisible === 1 })),
      }), true
    }

    /* 5.2 加一页 ─────────────────────────────────────────────── */
    m = path.match(/^\/admin\/signed-docs\/([^/]+)\/pages$/)
    if (m && req.method === 'POST') {
      const doc = getDoc(adminSession, decodeURIComponent(m[1]))
      if (doc.status === 'voided') throw apiError(400, 'BAD_REQUEST', '这份已经作废了,不能再加页。')
      const body = await readBody(req)
      if (doc.page_count >= 20) throw apiError(400, 'BAD_REQUEST', '一份最多 20 页。')
      const p = await storePage(doc.id, doc.page_count + 1, body.page)
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(`INSERT INTO signed_doc_pages (id, doc_id, tenant_id, page_no, storage, url, inline_data, mime, bytes, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomId('sdpg'), doc.id, tid(), doc.page_count + 1, p.storage, p.url, p.inline, p.mime, p.bytes, now())
        db.prepare('UPDATE signed_docs SET page_count = page_count + 1, updated_at = ? WHERE id = ? AND tenant_id = ?').run(now(), doc.id, tid())
        db.exec('COMMIT')
      } catch (e) { try { db.exec('ROLLBACK') } catch { /* 已回滚 */ } throw e }
      return json(res, 201, { doc: shape(db.prepare('SELECT * FROM signed_docs WHERE id = ?').get(doc.id)) }), true
    }

    /* 5.3 作废(🔴 没有删除口,一个都没有)──────────────────────── */
    m = path.match(/^\/admin\/signed-docs\/([^/]+)\/void$/)
    if (m && req.method === 'POST') {
      const doc = getDoc(adminSession, decodeURIComponent(m[1]))
      const body = await readBody(req)
      const reason = String(body.reason || '').trim()
      /* 🔴 判据五:原因必填是**后端**拦的。金额更正那一件就栽在「只有网页前端拦」。 */
      if (!reason) throw apiError(400, 'BAD_REQUEST', '作废要写原因。')
      if (doc.status === 'voided') throw apiError(409, 'ALREADY_VOIDED', '这份已经作废过了。')
      db.prepare(`UPDATE signed_docs SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = 'active'`).run(
        now(), actorOf(adminSession), reason, now(), doc.id, tid())
      return json(res, 200, { doc: shape(db.prepare('SELECT * FROM signed_docs WHERE id = ?').get(doc.id)) }), true
    }

    /* 5.6 取某一页 ───────────────────────────────────────────── */
    m = path.match(/^\/admin\/signed-docs\/([^/]+)\/pages\/(\d+)$/)
    if (m && req.method === 'GET') {
      const doc = getDoc(adminSession, decodeURIComponent(m[1]))
      const page = db.prepare('SELECT * FROM signed_doc_pages WHERE doc_id = ? AND tenant_id = ? AND page_no = ?')
        .get(doc.id, tid(), Number(m[2]))
      if (!page) throw apiError(404, 'NOT_FOUND', '没有这一页。')
      return json(res, 200, { pageNo: page.page_no, storage: page.storage, url: page.url, data: page.inline_data, mime: page.mime }), true
    }

    /* 5.5 详情 ──────────────────────────────────────────────── */
    m = path.match(/^\/admin\/signed-docs\/([^/]+)$/)
    if (m && req.method === 'GET') {
      const doc = getDoc(adminSession, decodeURIComponent(m[1]))
      /* 🔴 这里原来 select 的是 `page_no`(蛇形)——而「取某一页」那个口回的是 `pageNo`。
         **同一个事实两种拼法**,前端必然有一处写错;判据 ⑦b 当场咬出来(拿到 [null,null,null])。
         库里是蛇形、出口一律驼峰,在 SQL 里就别名掉。 */
      const pages = db.prepare('SELECT page_no AS pageNo, storage, url, inline_data AS data, mime FROM signed_doc_pages WHERE doc_id = ? AND tenant_id = ? ORDER BY page_no')
        .all(doc.id, tid())
      return json(res, 200, { doc: shape(doc), pages, voidButtonText: '标为作废' }), true
    }

    return false
  }

  /* 🔴 `handle` 里每条命中都写成 `return json(...), true` —— 逗号表达式取右值。
     写成 `return json(...)` 会回一个假值,分发方以为"它不认这条路"而继续往下匹配,
     于是同一个响应可能被写两次。这一层单独一条断言守着(见 test-signed-docs ⑧)。 */
  /* 🔴 写成具名 `async function` 而不是 `handle: async (...a) => …` ——
     预检那把「自由标识符」扫描器会把内联的 `async (` 当成一个用到了却没声明的标识符,
     于是本模块被报 `❌ signed-docs.mjs:async`。**判据没错,是我给了它一个它读不了的写法。** */
  async function handleRoute(req, res, path, adminSession) {
    return Boolean(await handle(req, res, path, adminSession))
  }
  return { handle: handleRoute, shape, ensureSchema: () => ensureSignedDocsSchema(db) }
}
