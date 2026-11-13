/** Two independent price systems and tenant-scoped personal member discounts.
 * New tables only: existing prices, balances, ledgers and signed records are not migrated.
 * Rates are basis points of the original price: 8000 = 八折 (80% payable).
 */
import { randomUUID } from 'node:crypto'
export const PRICE_SYSTEM_TYPES = ['list', 'member', 'share', 'course']
export const PRICING_CONTEXT = Symbol('server-validated-personal-pricing')
export function ensureMemberPricingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_pricing_settings (
      tenant_id TEXT NOT NULL PRIMARY KEY, config_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_price_systems (
      tenant_id TEXT NOT NULL, service_id TEXT NOT NULL, system TEXT NOT NULL CHECK(system IN ('display','settlement')),
      prices_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id,service_id,system)
    );
    CREATE TABLE IF NOT EXISTS member_personal_discounts (
      tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, rate_bps INTEGER,
      revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS member_discount_events (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
      before_rate_bps INTEGER, after_rate_bps INTEGER, revision INTEGER NOT NULL,
      source TEXT NOT NULL, source_id TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(tenant_id,user_id,source,source_id)
    );
    CREATE TABLE IF NOT EXISTS member_pricing_operations (
      tenant_id TEXT NOT NULL, operation_id TEXT NOT NULL, source TEXT NOT NULL, user_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id,operation_id)
    );
    CREATE TABLE IF NOT EXISTS recharge_package_discounts (
      tenant_id TEXT NOT NULL, package_id TEXT NOT NULL, rate_bps INTEGER,
      revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id,package_id)
    );
    CREATE TRIGGER IF NOT EXISTS member_pricing_operations_no_update BEFORE UPDATE ON member_pricing_operations
      BEGIN SELECT RAISE(ABORT,'pricing operation receipt is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS member_pricing_operations_no_delete BEFORE DELETE ON member_pricing_operations
      BEGIN SELECT RAISE(ABORT,'pricing operation receipt is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS member_discount_events_no_update BEFORE UPDATE ON member_discount_events
      BEGIN SELECT RAISE(ABORT,'discount history is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS member_discount_events_no_delete BEFORE DELETE ON member_discount_events
      BEGIN SELECT RAISE(ABORT,'discount history is immutable'); END;
  `)
}
export function createMemberPricingPolicy({db, apiError, isMemberOf, getMembershipConfig, balanceOf, clock = () => new Date().toISOString()}) {
  const fail = (status, code, message) => { throw apiError(status, code, message) }
  const objectInput=v=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(400,'INVALID_PRICING_VALUE','价格设置格式无效。')}
  const integer = (v, max, label) => {
    if (!Number.isSafeInteger(v) || v < 0 || v > max) fail(400,'INVALID_PRICING_VALUE',`${label}无效。`)
    return v
  }
  const rate = v => {
    if (v === null) return null
    integer(v,10000,'折扣'); if (v < 100 || v % 100 !== 0) fail(400,'INVALID_PRICING_VALUE','折扣须为0.1至9.9折，最多一位小数；无折扣按原价。')
    return v
  }
  const revision = (expected, actual) => {
    if (expected !== actual) fail(409,'PRICING_CHANGED','信息已被更新，请刷新后重新确认。')
  }
  function user(tid, uid) {
    if (!db.prepare('SELECT id FROM users WHERE tenant_id=? AND id=?').get(tid,uid)) fail(404,'NOT_FOUND','顾客不属于本店。')
  }
  function service(tid,id) {
    const row=db.prepare('SELECT * FROM services WHERE tenant_id=? AND id=?').get(tid,id)
    if (!row) fail(404,'NOT_FOUND','项目不属于本店。')
    return row
  }
  function config(tid) {
    const row=db.prepare('SELECT * FROM member_pricing_settings WHERE tenant_id=?').get(tid)
    const c=row ? JSON.parse(row.config_json) : { active:false, membershipEnabled:true, displayTypes:[...PRICE_SYSTEM_TYPES], settlementTypes:[...PRICE_SYSTEM_TYPES] }
    return {...c,revision:row?.revision||0,settlementTypes:[...new Set(['list',...(c.membershipEnabled?['member']:[]),...c.settlementTypes])]}
  }
  function setConfig(tid,input) {
    objectInput(input)
    const old=config(tid);revision(input.expectedRevision,old.revision)
    const out={...old,...input};delete out.expectedRevision;delete out.revision
    for (const key of ['active','membershipEnabled']) if(typeof out[key]!=='boolean') fail(400,'INVALID_PRICING_VALUE',`${key}须为布尔值。`)
    for (const key of ['displayTypes','settlementTypes']) {
      if(!Array.isArray(out[key]) || out[key].some(t=>!PRICE_SYSTEM_TYPES.includes(t)) || !out[key].includes('list')) fail(400,'INVALID_PRICE_TYPES','价格类型无效，原价必须保留。')
      out[key]=[...new Set(out[key])]
    }
    if(out.membershipEnabled && !out.settlementTypes.includes('member')) fail(400,'MEMBER_PRICE_REQUIRED','启用会员制度时，结算会员价必须保留。')
    const clean={active:out.active,membershipEnabled:out.membershipEnabled,displayTypes:out.displayTypes,settlementTypes:out.settlementTypes}
    const write=db.prepare(`INSERT INTO member_pricing_settings VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config_json=excluded.config_json,revision=excluded.revision,updated_at=excluded.updated_at WHERE member_pricing_settings.revision=?`).run(tid,JSON.stringify(clean),old.revision+1,clock(),old.revision)
    if(!write.changes)fail(409,'PRICING_CHANGED','价格配置已更新，请刷新后重试。')
    return config(tid)
  }
  function prices(tid,id,system) {
    if(!['display','settlement'].includes(system)) fail(400,'INVALID_PRICE_SYSTEM','价格体系无效。')
    const s=service(tid,id)
    const row=db.prepare('SELECT * FROM service_price_systems WHERE tenant_id=? AND service_id=? AND system=?').get(tid,id,system)
    let values
    if(row) values=JSON.parse(row.prices_json)
    else {
      values={list:{priceCents:s.price_cents,courseTimes:null}}
      for(const p of db.prepare('SELECT * FROM service_prices WHERE tenant_id=? AND service_id=?').all(tid,id)) values[p.tier_key]={priceCents:p.price_cents,courseTimes:p.course_times||null}
    }
    return {system,serviceId:id,prices:values,revision:row?.revision||0,legacy:!row}
  }
  function setPrices(tid,id,system,input) {
    objectInput(input)
    const old=prices(tid,id,system);revision(input.expectedRevision,old.revision)
    const values=input.prices
    if(!values || typeof values!=='object' || Array.isArray(values) || !values.list) fail(400,'LIST_PRICE_REQUIRED','必须填写原价。')
    const clean={}
    for(const [key,v] of Object.entries(values)) {
      if(!PRICE_SYSTEM_TYPES.includes(key)) fail(400,'INVALID_PRICE_TYPES','价格类型无效。')
      if(v===null && key!=='list') continue
      if(!v || typeof v!=='object') fail(400,'INVALID_PRICING_VALUE','价格格式无效。')
      clean[key]={priceCents:integer(v.priceCents,100000000,'金额'),courseTimes:v.courseTimes==null?null:integer(v.courseTimes,100000,'次数')}
    }
    // Freeze the other side at first split; later legacy edits cannot silently cross systems.
    const other=system==='display'?'settlement':'display', prior=prices(tid,id,other)
    db.exec('SAVEPOINT split_prices')
    try {
      if(prior.legacy) db.prepare('INSERT OR IGNORE INTO service_price_systems VALUES(?,?,?,?,?,?)').run(tid,id,other,JSON.stringify(prior.prices),1,clock())
      const write=db.prepare(`INSERT INTO service_price_systems VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,service_id,system) DO UPDATE SET prices_json=excluded.prices_json,revision=excluded.revision,updated_at=excluded.updated_at WHERE service_price_systems.revision=?`).run(tid,id,system,JSON.stringify(clean),old.revision+1,clock(),old.revision)
      if(!write.changes)fail(409,'PRICING_CHANGED','项目价格已更新，请刷新后重试。')
      db.exec('RELEASE split_prices')
    } catch(e) {db.exec('ROLLBACK TO split_prices');db.exec('RELEASE split_prices');throw e}
    return prices(tid,id,system)
  }
  function publicPrices(tid,id) {
    const c=config(tid),p=prices(tid,id,'display')
    return {system:'display',referenceOnly:true,prices:Object.fromEntries(Object.entries(p.prices).filter(([t])=>c.displayTypes.includes(t)))}
  }
  function discount(tid,uid) {
    user(tid,uid)
    const r=db.prepare('SELECT * FROM member_personal_discounts WHERE tenant_id=? AND user_id=?').get(tid,uid)
    const eligible=config(tid).membershipEnabled && isMemberOf(uid,tid)
    return {userId:uid,rateBps:r?.rate_bps??null,revision:r?.revision||0,eligible,effectiveRateBps:eligible?(r?.rate_bps??null):null,status:!eligible?'ineligible':r?.rate_bps==null?'default':'active',balanceCents:balanceOf(uid,tid)}
  }
  function setDiscount(tid,uid,input,{actor,source='owner',sourceId,role}) {
    objectInput(input)
    user(tid,uid)
    if(role!=='owner' && source!=='recharge') fail(403,'FORBIDDEN','员工只能在办理充值时调整折扣。')
    if(!['owner','staff'].includes(role)) fail(403,'FORBIDDEN','没有调整权限。')
    const id=String(sourceId||'').trim(), reason=String(input.reason||'').trim()
    if(!id || id.length>120 || !actor || !reason || reason.length>300) fail(400,'REASON_REQUIRED','请提供操作编号和调整原因。')
    const next=rate(input.rateBps)
    const existing=db.prepare('SELECT * FROM member_discount_events WHERE tenant_id=? AND user_id=? AND source=? AND source_id=?').get(tid,uid,source,id)
    if(existing) {
      if(existing.after_rate_bps!==next || existing.actor!==String(actor) || existing.reason!==reason) fail(409,'IDEMPOTENCY_CONFLICT','同一操作编号的折扣内容不一致。')
      return {...discount(tid,uid),alreadyApplied:true,eventId:existing.id}
    }
    const old=discount(tid,uid);revision(input.expectedRevision,old.revision)
    const now=clock(),eventId=randomUUID()
    db.exec('SAVEPOINT member_discount')
    try {
      const write=db.prepare(`INSERT INTO member_personal_discounts VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET rate_bps=excluded.rate_bps,revision=excluded.revision,updated_at=excluded.updated_at WHERE member_personal_discounts.revision=?`).run(tid,uid,next,old.revision+1,now,old.revision)
      if(!write.changes)fail(409,'PRICING_CHANGED','个人折扣已更新，请刷新后重新确认。')
      db.prepare('INSERT INTO member_discount_events VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(eventId,tid,uid,old.rateBps,next,old.revision+1,source,id,String(actor),reason,now)
      db.exec('RELEASE member_discount')
    }catch(e){db.exec('ROLLBACK TO member_discount');db.exec('RELEASE member_discount');throw e}
    return {...discount(tid,uid),eventId}
  }
  function packageDiscount(tid,id) {
    if(!db.prepare("SELECT id FROM membership_packages WHERE tenant_id=? AND id=? AND kind='recharge'").get(tid,id)) fail(404,'NOT_FOUND','充值套餐不属于本店。')
    const r=db.prepare('SELECT * FROM recharge_package_discounts WHERE tenant_id=? AND package_id=?').get(tid,id)
    return {packageId:id,rateBps:r?.rate_bps??null,revision:r?.revision||0}
  }
  function setPackageDiscount(tid,id,input) {
    objectInput(input)
    const old=packageDiscount(tid,id);revision(input.expectedRevision,old.revision)
    const next=rate(input.rateBps)
    const write=db.prepare(`INSERT INTO recharge_package_discounts VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,package_id) DO UPDATE SET rate_bps=excluded.rate_bps,revision=excluded.revision,updated_at=excluded.updated_at WHERE recharge_package_discounts.revision=?`).run(tid,id,next,old.revision+1,clock(),old.revision)
    if(!write.changes)fail(409,'PRICING_CHANGED','套餐折扣已更新，请刷新后重试。')
    return packageDiscount(tid,id)
  }
  function history(tid,uid) {user(tid,uid);return db.prepare('SELECT * FROM member_discount_events WHERE tenant_id=? AND user_id=? ORDER BY revision DESC LIMIT 100').all(tid,uid)}
  return {config,setConfig,prices,setPrices,publicPrices,discount,setDiscount,history,packageDiscount,setPackageDiscount,rate,revision,service,getMembershipConfig}
}
