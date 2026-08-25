/* 平台代商家导入价目表 —— 受【分类唯一真相律】管(店主 2026-08-25 立)。

   为什么这条律要堵在导入口:**导入口是"配了一半的店"最可能的来源**。
   一个项目没挂大类,进了库就得等谁哪天发现顾客端「8 个分组各 1 项」才回头查。
   堵在入口比事后扫全库便宜得多。

   四条硬规矩(店主原话):
     · 模板**必须有大类列**;
     · 缺大类的行在**试跑报告里标红退回**,不许进库;
     · 报告要能**一眼看出"哪几行缺大类"** —— 不是笼统报个失败数;
     · 一行有问题就整批不落库(要么整批干净进,要么一行不进 —— 半批进库最难收拾)。

   模板列(中英都认,大小写无关):
     大类/category(必填,必须是本店大类字典里已有的名字或 key)
     项目名/name(必填)· 英文名/nameEn · 类型/type(NAIL|LASH|CARE|OTHER,默认按大类推)
     价格/price(元)· 定金/deposit(元)· 时长/duration(分钟)· 排序/sort */

const HEAD = {
  category: ['大类', '分类', 'category', 'categoryname'],
  name: ['项目名', '名称', '项目', 'name', 'namezh'],
  nameEn: ['英文名', 'nameen', 'englishname'],
  type: ['类型', 'type'],
  price: ['价格', '价钱', '售价', 'price'],
  deposit: ['定金', 'deposit'],
  duration: ['时长', '分钟', 'duration', 'durationmin'],
  sort: ['排序', 'sort', 'sortorder']
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s|_|-/g, '')

/* 表头映射:把用户表格里的列名认到我们的字段上。认不出来的列忽略(不报错,免得多一列就整批失败)。 */
export function mapHeaders(headers = []) {
  const out = {}
  headers.forEach((h, i) => {
    const n = norm(h)
    for (const [field, aliases] of Object.entries(HEAD)) {
      if (aliases.some((a) => norm(a) === n)) { out[field] = i; break }
    }
  })
  return out
}

const yuanToCents = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function createServiceImport({ db, apiError, randomId, iso, categoryList }) {
  /* 试跑:逐行判,产出**能一眼看出哪几行缺大类**的报告。 */
  function dryRun(tenantId, { headers = [], rows = [] } = {}) {
    const cols = mapHeaders(headers)
    const cats = categoryList(tenantId)
    const catByName = new Map()
    for (const c of cats) { catByName.set(norm(c.name), c); catByName.set(norm(c.key), c) }

    const report = {
      rowCount: rows.length,
      hasCategoryColumn: cols.category !== undefined,
      categories: cats.map((c) => c.name),
      ok: [],
      blocked: []                 // 🔴 红色退回行:每一行都写清楚**是哪一行、缺什么**
    }
    if (!report.hasCategoryColumn) {
      report.blocked.push({ line: 0, name: '', reason: '模板缺「大类」列 —— 整份文件退回', kind: 'NO_CATEGORY_COLUMN' })
      return report
    }
    rows.forEach((cells, i) => {
      const line = i + 2                                   // +2:第 1 行是表头,人看的行号从 1 起
      const at = (k) => (cols[k] === undefined ? '' : String(cells[cols[k]] ?? '').trim())
      const name = at('name')
      const catRaw = at('category')
      if (!name) { report.blocked.push({ line, name: '', reason: '缺项目名', kind: 'NO_NAME' }); return }
      if (!catRaw) { report.blocked.push({ line, name, reason: '🔴 缺大类 —— 不挂大类不许进库', kind: 'NO_CATEGORY' }); return }
      const cat = catByName.get(norm(catRaw))
      if (!cat) {
        report.blocked.push({ line, name, reason: `🔴 大类「${catRaw}」不在本店大类字典里(现有:${cats.map((c) => c.name).join('/') || '一个都没有'})`, kind: 'UNKNOWN_CATEGORY' })
        return
      }
      const priceCents = yuanToCents(at('price'))
      if (!priceCents) { report.blocked.push({ line, name, reason: '缺价格或价格不是数字', kind: 'NO_PRICE' }); return }
      report.ok.push({
        line, name, nameEn: at('nameEn') || name, categoryId: cat.id, categoryName: cat.name,
        type: (['NAIL', 'LASH', 'CARE', 'OTHER'].includes(at('type').toUpperCase()) ? at('type').toUpperCase() : guessType(cat)),
        priceCents, depositCents: yuanToCents(at('deposit')), durationMin: Math.max(0, Math.round(Number(at('duration')) || 60)),
        sortOrder: Math.round(Number(at('sort')) || 0)
      })
    })
    report.willImport = report.blocked.length ? 0 : report.ok.length
    report.verdict = report.blocked.length
      ? `退回:${report.blocked.length} 行有问题,一行都不会进库(缺大类 ${report.blocked.filter((b) => b.kind === 'NO_CATEGORY').length} 行)`
      : `可以导入:${report.ok.length} 行,全部已挂大类`
    return report
  }

  function guessType(cat) {
    const k = norm(cat.key) + norm(cat.name)
    if (k.includes('nail') || k.includes('美甲')) return 'NAIL'
    if (k.includes('lash') || k.includes('美睫')) return 'LASH'
    return 'CARE'
  }

  /* 执行:**只有零退回行才落库**。一行有问题就整批不进 —— 半批进库最难收拾。 */
  function execute(tenantId, payload) {
    const report = dryRun(tenantId, payload)
    if (report.blocked.length) {
      throw apiError(400, 'IMPORT_BLOCKED', `${report.verdict}。请先补齐后重试(报告里每一行都标了行号)。`)
    }
    let created = 0
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const r of report.ok) {
        const id = randomId('svc')
        // services 表没有 created_at 列(2026-08-25 实测),别凭印象写字段
        /* 表上 description_zh/en、image_url、process_json、notice_json 都是 NOT NULL ——
           导入模板里没有这些列,一律落空值(不是 NULL),让项目建得起来、店主之后自己补。 */
        db.prepare(`INSERT INTO services (id, tenant_id, type, category, name_zh, name_en,
          description_zh, description_en, image_url, price_cents, deposit_cents,
          base_duration_min, sort_order, is_active, storefront, is_timecard, item_kind, category_id, process_json, notice_json)
          VALUES (?, ?, ?, '', ?, ?, '', '', '', ?, ?, ?, ?, 1, 1, 0, 'main', ?, '[]', '[]')`)
          .run(id, tenantId, r.type, r.name.slice(0, 60), r.nameEn.slice(0, 80), r.priceCents, r.depositCents,
            r.durationMin, r.sortOrder, r.categoryId)
        created += 1
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw apiError(500, 'IMPORT_FAILED', `导入失败已回滚(一行没进):${error.message}`)
    }
    return { created, report }
  }

  return { dryRun, execute }
}
