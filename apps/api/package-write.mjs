import {assertRecordActive,activeRecords} from './record-lifecycle.mjs'
import {normalizeGiftItems,readGiftItems} from './gifts.mjs'
import {canonicalPackageKind} from './package-kind.mjs'
export function createPackageWrite({db,apiError,readBody,json,currentTenantId,randomId,assertPackageValueOk,assertProjectGroupValid,serializeMembershipPackage,memberPricing,giftEntitlements}) {
  const number=(v,label,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>100000000)throw apiError(400,'BAD_REQUEST',`${label}须为有效整数，不能为负数或超出上限。`);return v}
  function configure(tid,b,{id:givenId=null}={}) {
    const editing=Boolean(givenId),id=givenId||randomId('pkg')
    const cur=editing?db.prepare('SELECT * FROM membership_packages WHERE id=? AND tenant_id=?').get(id,tid):null
    if(editing)assertRecordActive(db,apiError,tid,'packages',givenId)
    if(editing&&!cur)throw apiError(404,'NOT_FOUND','套餐不存在。')
    const get=(key,col,fallback)=>b[key]===undefined?(cur?.[col]??fallback):b[key]
    const storedKind=get('kind','kind','recharge'),kind=canonicalPackageKind(storedKind);if(!['times','recharge'].includes(kind))throw apiError(400,'BAD_REQUEST','套餐类型无效。')
    const name=String(get('name','name','')).trim();if(!name||name.length>80)throw apiError(400,'BAD_REQUEST','套餐名称必填，最多80字。')
    const price=number(get('priceCents','price_cents',0),'售价'),bonus=number(get('bonusCents','bonus_cents',0),'赠送金额'),times=number(get('timesCount','times_count',0),'次数')
    assertPackageValueOk({kind,priceCents:price,timesCount:times})
    const group=String(get('projectGroup','project_group','')).trim()
    if(!cur||b.projectGroup!==undefined&&group!==String(cur.project_group||''))assertProjectGroupValid(tid,group)
    const previousGifts=cur?readGiftItems(cur):[]
    let giftItems=b.giftItems===undefined?previousGifts:normalizeGiftItems(b.giftItems,apiError)
    // Old clients serialize only name/quantity/value (including null as zero).
    // Preserve the full snapshot when that projection is unchanged; never silently erase typed rights.
    if(cur&&b.giftItems!==undefined&&previousGifts.some(g=>g.kind)&&b.giftSchemaVersion!==1&&!giftItems.some(g=>g.kind)){
      const legacyProjection=items=>JSON.stringify(items.map(g=>({name:g.name,quantity:g.quantity,unitValueCents:g.unitValueCents??0})))
      if(legacyProjection(giftItems)!==legacyProjection(previousGifts))throw apiError(409,'GIFT_EDITOR_UPGRADE_REQUIRED','该套餐包含分类赠送权益，请在新版网页或新版小程序编辑赠品；本次未保存，原配置已保留。')
      giftItems=previousGifts
    }
    if(b.giftItems!==undefined&&giftEntitlements)giftEntitlements.validate(tid,giftItems)
    if(kind!=='recharge'&&b.giftItems?.length)throw apiError(400,'INVALID_GIFT_ITEMS','赠送权益仅适用于充值套餐。')
    const valid=get('validDays','valid_days',null);if(valid!==null&&valid!==''&&valid!==0)number(valid,'有效期',1)
    const active=get('isActive','is_active',true)?1:0,mall=get('mallVisible','mall_visible',true)?1:0
    const values=[storedKind,name,price,bonus,times,String(get('scope','scope','')).slice(0,200)||null,String(get('benefits','benefits','')).slice(0,400)||null,active,number(get('sortOrder','sort_order',0),'排序'),valid||null,group||null,mall,JSON.stringify(kind==='recharge'?giftItems:[])]
    db.exec('SAVEPOINT package_with_discount')
    try {
    if(editing&&b.expectedConfigRevision!==undefined&&b.expectedConfigRevision!==serializeMembershipPackage(cur).configRevision)throw apiError(409,'CONFIG_CHANGED','套餐已在其他设备修改，输入已保留，请核对最新配置后再保存。',{current:serializeMembershipPackage(cur)})
    if(editing)db.prepare('UPDATE membership_packages SET kind=?,name=?,price_cents=?,bonus_cents=?,times_count=?,scope=?,benefits=?,is_active=?,sort_order=?,valid_days=?,project_group=?,mall_visible=?,gift_items_json=? WHERE id=? AND tenant_id=?').run(...values,id,tid)
    else db.prepare('INSERT INTO membership_packages(kind,name,price_cents,bonus_cents,times_count,scope,benefits,is_active,sort_order,valid_days,project_group,mall_visible,gift_items_json,id,tenant_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values,id,tid,new Date().toISOString())
    if(b.defaultPersonalDiscount!==undefined)memberPricing.setPackageDiscount(tid,id,b.defaultPersonalDiscount)
    const result=serializeMembershipPackage(db.prepare('SELECT * FROM membership_packages WHERE id=? AND tenant_id=?').get(id,tid))
    db.exec('RELEASE package_with_discount')
    return {package:result}
    }catch(e){db.exec('ROLLBACK TO package_with_discount; RELEASE package_with_discount');throw e}
  }
  const route=async(req,res,{path,adminSession})=>{
    if(!(req.method==='POST'&&path==='/admin/packages')&&!(req.method==='PATCH'&&/^\/admin\/packages\/[^/]+$/.test(path)))return false
    if(adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','仅老板可修改套餐。')
    const output=configure(currentTenantId(),await readBody(req),{id:req.method==='PATCH'?path.split('/')[3]:null})
    json(res,req.method==='PATCH'?200:201,output);return true
  }
  route.configure=configure
  return route
}
