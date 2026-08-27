/* D78 顾客首页轮播 · D79 日结现金手记 —— **路由层**(2026-08-28 批次二)。

   为什么一开始就放在模块里而不是 local-server.mjs:
   《棘轮律》那两个巨型文件只许降不许升;而且 refund-routes 那一刀已经证明,
   路由赖在一万八千行里就是"改一处漏一处"的土壤。

   🔴 搬家的代价同样自己付:门禁扫描器(test-auth-surface)扫的是
   local-server.mjs + 全部 `*-routes.mjs`,本文件天生在扫描面里,
   并且那条**路由条数下限**断言会因为多了这几条而抬高 —— 谁再把它搬走、扫描面缩水,当场红。 */
export function createStoreContentRoutes({ apiError, json, readBody, heroSlidesApi, cashNotesApi, constants, localParts, tenantTimezone, currentTenantId, HERO_SLIDE_MAX }) {
  const { CASH_NOTE_KINDS, CASH_NOTE_KIND_LABELS } = constants
  async function route(req, res, ctx) {
    const { path, query, adminSession } = ctx
  /* D79 现金手记:读=已登录商家看本店当日;写=仅老板(它会动「今晚数钱按这个数」)。
     只追加不修改:记错了走 /reverse 追加一条反向行,原始那条留着。 */
  if (path === '/admin/cash-notes' || path.startsWith('/admin/cash-notes/')) {
    const noteId = path.split('/')[3] || ''
    const day = String(query.date || '').trim() || localParts(new Date(), tenantTimezone(currentTenantId())).date
    if (req.method === 'GET' && !noteId) {
      json(res, 200, {
        date: day,
        kinds: CASH_NOTE_KINDS.map((kind) => ({ kind, label: CASH_NOTE_KIND_LABELS[kind] })),
        items: cashNotesApi.listCashNotes(day),
        totalCents: cashNotesApi.cashNotesTotalCents(day)
      })
      return true
    }
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    if (req.method === 'POST' && !noteId) {
      const body = await readBody(req)
      const note = cashNotesApi.addCashNote({
        date: String(body.date || day), kind: String(body.kind || ''),
        amountCents: Math.round(Number(body.amountCents)), note: body.note,
        createdBy: adminSession.username || adminSession.displayName || ''
      })
      json(res, 201, { note })
      return true
    }
    if (req.method === 'POST' && noteId && path.endsWith('/reverse')) {
      const body = await readBody(req)
      json(res, 201, { note: cashNotesApi.reverseCashNote(noteId, { createdBy: adminSession.username || '', note: body.note }) })
      return true
    }
  }
  /* D78 商家自管轮播:读写两道闸分别验(《读写两道闸律》)——读=已登录商家看本店,写=仅老板。 */
  if (path === '/admin/hero-slides') {
    if (req.method === 'GET') { json(res, 200, { slides: heroSlidesApi.listHeroSlides(), max: HERO_SLIDE_MAX }); return true }
    if (req.method === 'PUT') {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
      const body = await readBody(req)
      json(res, 200, { slides: heroSlidesApi.replaceHeroSlides(body.slides) })
      return true
    }
  }
    return false
  }
  return { route }
}
