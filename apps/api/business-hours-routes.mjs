import {reviewBusinessHours} from './business-hours-review.mjs'
import {readBookingAcceptance} from './booking-window.mjs'
import { businessHoursRevision,validateBusinessHours, writeBusinessHours } from './business-hours-write.mjs'
/* 营业时间两条路由(GET/PUT /admin/business-hours)—— 2026-08-30 强制设置批从 local-server.mjs
   搬出,**只搬不改**(《棘轮律》+ 公约②边改边拆:动了营业时间域就把该域路由层带走)。
   A2 后端终闸(图 v1.0「至少选择一天营业」)在 PUT 里,与 hours-gate.mjs 的 hoursSavable 同源。
   调用点仍在租户闸门之后(交付纪律 7),门禁扫描器扫全部 *-routes.mjs,本文件天生在面上。 */
export function createBusinessHoursRoutes({ localParts,tenantTimezone, apiError, json, readBody, db, currentTenantId, defaultStoreId, getBusinessHoursRows, serializeBusinessHour, businessHoursText, storeTodayHours, upcomingSpecialDates, iso, hoursSavable, HOURS_GATE_TEXT }) {
  function handle(req, res, ctx, input, json) {
    const { path, adminSession } = ctx
  if (req.method === 'GET' && path === '/admin/business-hours') {
    const stores = db.prepare('SELECT id, name, address, phone, currency, timezone FROM stores WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC').all(currentTenantId())
    json(res, 200, {
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        address: store.address,
        phone: store.phone,
        // 2026-08-07:老板端要按本店币种/时区显示金额与"今天",这两项以前没下发,前端只能写死 CAD + Toronto
        /* 🔴 D140:原来是 `store.currency || 'CAD'` —— 又一处读侧兜底。
           唯一真相是 `stores.currency`,拿不到就回 null,让前端显示「未设置」,
           **不许悄悄给一个加币** —— 境内店会因此按错的单位理解价钱。 */
        currency: store.currency || null,
        timezone: store.timezone || 'America/Toronto',
        configRevision:businessHoursRevision(db,store.id,currentTenantId()),bookingAcceptance:readBookingAcceptance(db,store.id,currentTenantId()),
        hours: getBusinessHoursRows(store.id).map(serializeBusinessHour),
        hoursText: { zh: businessHoursText(store.id, 'zh'), en: businessHoursText(store.id, 'en') },
        // 今日营业句/营业中状态:后端唯一出口(特殊日优先、按门店时区),前端零计算
        todayHours: { zh: storeTodayHours(store, 'zh'), en: storeTodayHours(store, 'en') },
        specialDates: upcomingSpecialDates(store.id, 366).map((row) => ({
          date: row.date,
          isClosed: Boolean(row.is_closed),
          openTime: row.open_time,
          closeTime: row.close_time,
          note: row.note || ''
        }))
      }))
    })
    return true
  }
  if(req.method==='POST'&&path==='/admin/business-hours/review'){
    if(adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','Owner permission is required.')
    json(res,200,reviewBusinessHours({db,apiError,localParts,tenantTimezone},currentTenantId(),input.storeId||defaultStoreId(),input));return true
  }
  if (req.method === 'PUT' && path === '/admin/business-hours') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = input
    const storeId = body.storeId || defaultStoreId()
    const store = db.prepare('SELECT * FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId())
    if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found.')
    const entries = Array.isArray(body.hours) ? body.hours : []
    validateBusinessHours(entries, apiError)
    /* A2 后端终闸(图 v1.0):落库后的合并态必须至少一天营业 —— 前端灰只是体验,这里才是闸 */
    if (!hoursSavable(entries, getBusinessHoursRows(storeId))) {
      throw apiError(400, 'HOURS_ALL_CLOSED', HOURS_GATE_TEXT.saveDisabledNote + '。')
    }
    const now = iso(new Date())
    const updatedBy = adminSession.email || adminSession.provider || 'owner'
    writeBusinessHours(db, storeId, entries, updatedBy, now,body.bookingAcceptance,apiError,body.expectedConfigRevision,currentTenantId())
    json(res, 200, {
      store: { id: store.id, name: store.name },
      bookingAcceptance:readBookingAcceptance(db,storeId,currentTenantId()),
      hours: getBusinessHoursRows(storeId).map(serializeBusinessHour),
      hoursText: { zh: businessHoursText(storeId, 'zh'), en: businessHoursText(storeId, 'en') }
    })
    return true
  }
    return false
  }
  function configure({method,path,body={},adminSession}) {
    let result
    handle({method},null,{path,adminSession},body,(_res,status,data)=>{result={status,data}})
    if(!result)throw apiError(404,'NOT_FOUND','没有这个营业时间配置操作。')
    return result
  }
  async function route(req,res,ctx){
    if(!(ctx.path==='/admin/business-hours'&&['GET','PUT'].includes(req.method))&&!(ctx.path==='/admin/business-hours/review'&&req.method==='POST'))return false
    const result=configure({method:req.method,path:ctx.path,body:req.method==='GET'?{}:await readBody(req),adminSession:ctx.adminSession})
    json(res,result.status,result.data);return true
  }
  return { route, configure }
}
