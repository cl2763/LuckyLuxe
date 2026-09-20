/* D78 顾客首页轮播 · D79 日结现金手记 —— **路由层**(2026-08-28 批次二)。

   为什么一开始就放在模块里而不是 local-server.mjs:
   《棘轮律》那两个巨型文件只许降不许升;而且 refund-routes 那一刀已经证明,
   路由赖在一万八千行里就是"改一处漏一处"的土壤。

   🔴 搬家的代价同样自己付:门禁扫描器(test-auth-surface)扫的是
   local-server.mjs + 全部 `*-routes.mjs`,本文件天生在扫描面里,
   并且那条**路由条数下限**断言会因为多了这几条而抬高 —— 谁再把它搬走、扫描面缩水,当场红。 */
/* 🔴 J-105(10d):留痕里的「谁」走唯一出口 `./actor-name.mjs`。
   本文件三处涉钱写入(记一笔 · 现金手记 · 现金手记冲销)全部改走它 ——
   两处原来是 `|| ''`(甲档真空),一处是 `|| 'owner'`(乙档角色词)。
   公约④:`actorOf` 我 10b 在 `signed-docs.mjs` 里写过一份,这次**抽成共用出口**,不并排再写第二份。 */
import { makeActorOf } from './actor-name.mjs'

export function createStoreContentRoutes({ apiError, json, readBody, heroSlidesApi, cashNotesApi, constants, localParts, tenantTimezone, currentTenantId, HERO_SLIDE_MAX, insertFinanceTransaction, serializeFinanceTransaction }) {
  const { CASH_NOTE_KINDS, CASH_NOTE_KIND_LABELS } = constants
  const actorOf = makeActorOf({ apiError })
  async function route(req, res, ctx) {
    const { path, query, adminSession } = ctx
    /* 手工「记一笔」写口(08-29 从 local-server.mjs 搬来,同批加付款方式闸)。
       店主原话:「储值卡会在会员界面去动他的值,不会在记一笔这里记。」
       这里只记**不走订单流程**的收支;顾客消费的钱走结算单签署,入账唯一路径=签署。
       付款方式白名单四个(现金/刷卡/转账/其他),唯一作用=判断动不动抽屉 —— 闸在 ./cash-notes.mjs。 */
    if (req.method === 'POST' && path === '/admin/finance/transactions') {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
      const body = await readBody(req)
      const type = body.type === 'expense' ? 'expense' : 'income'
      const amountCents = Math.round(Number(body.amountCents ?? Number(body.amount || 0) * 100))
      if (!Number.isFinite(amountCents) || amountCents <= 0) throw apiError(400, 'BAD_REQUEST', 'A positive amount is required.')
      const category = String(body.category || '').trim()
      if (!category) throw apiError(400, 'BAD_REQUEST', 'category is required.')
      cashNotesApi.assertEntryChannelOk(body.payChannel)
      const occurredOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.occurredOn || '')) ? body.occurredOn : localParts(new Date()).date
      const row = insertFinanceTransaction({
        type,
        source: 'manual',
        category,
        tags: String(body.tags || ''),
        amountCents,
        payChannel: String(body.payChannel || 'unknown'),
        occurredOn,
        note: String(body.note || ''),
        createdBy: actorOf(adminSession)   // J-105:涉钱路径的留痕必须是一个人,不是一个角色
      })
      json(res, 201, { transaction: serializeFinanceTransaction(row) })
      return true
    }
    /* 08-29:「记一笔」的选项与分工句 —— 小程序 finance-entry 页从这里拿
       (网页端搭 GET /admin/finance/transactions 的车,同一个 manualEntryConfig() 出的同一份)。 */
    if (req.method === 'GET' && path === '/admin/finance/entry-config') {
      json(res, 200, cashNotesApi.manualEntryConfig())
      return true
    }
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
        createdBy: actorOf(adminSession)   // 🔴 J-105 甲档:原来是 `|| ''`,抽屉里钞票动了却记不下是谁
      })
      json(res, 201, { note })
      return true
    }
    if (req.method === 'POST' && noteId && path.endsWith('/reverse')) {
      const body = await readBody(req)
      /* 🔴 J-105 甲档:冲销同病(原来是 `adminSession.username || ''`),同改 */
      json(res, 201, { note: cashNotesApi.reverseCashNote(noteId, { createdBy: actorOf(adminSession), note: body.note, reason: body.reason }) })
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
