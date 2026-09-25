import {normalizeGiftItems,readGiftItems} from './gifts.mjs'
export function createPackageWrite({db,apiError,readBody,json,currentTenantId,randomId,assertPackageValueOk,assertProjectGroupValid,serializeMembershipPackage}) {
  const number=(v,label,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>100000000)throw apiError(400,'BAD_REQUEST',`${label}须为有效整数，不能为负数或超出上限。`);return v}
  return async(req,res,{path,adminSession})=>{
    if(!(req.method==='POST'&&path==='/admin/packages')&&!(req.method==='PATCH'&&/^\/admin\/packages\/[^/]+$/.test(path)))return false
    if(adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','仅老板可修改套餐。')
    const tid=currentTenantId(),editing=req.method==='PATCH',id=editing?path.split('/')[3]:randomId('pkg')
    const cur=editing?db.prepare('SELECT * FROM membership_packages WHERE id=? AND tenant_id=?').get(id,tid):null
    if(editing&&!cur)throw apiError(404,'NOT_FOUND','套餐不存在。')
    const b=await readBody(req), get=(key,col,fallback)=>b[key]===undefined?(cur?.[col]??fallback):b[key]
    const kind=get('kind','kind','recharge');if(!['times','recharge'].includes(kind))throw apiError(400,'BAD_REQUEST','套餐类型无效。')
    const name=String(get('name','name','')).trim();if(!name||name.length>80)throw apiError(400,'BAD_REQUEST','套餐名称必填，最多80字。')
    const price=number(get('priceCents','price_cents',0),'售价'),bonus=number(get('bonusCents','bonus_cents',0),'赠送金额'),times=number(get('timesCount','times_count',0),'次数')
    assertPackageValueOk({kind,priceCents:price,timesCount:times})
    const group=String(get('projectGroup','project_group','')).trim()
    if(!cur||b.projectGroup!==undefined&&group!==String(cur.project_group||''))assertProjectGroupValid(tid,group)
    const giftItems=b.giftItems===undefined?(cur?readGiftItems(cur):[]):normalizeGiftItems(b.giftItems,apiError)
    if(kind!=='recharge'&&b.giftItems?.length)throw apiError(400,'INVALID_GIFT_ITEMS','实物赠品仅适用于充值套餐。')
    const valid=get('validDays','valid_days',null);if(valid!==null&&valid!==''&&valid!==0)number(valid,'有效期',1)
    const active=get('isActive','is_active',true)?1:0,mall=get('mallVisible','mall_visible',true)?1:0
    const values=[kind,name,price,bonus,times,String(get('scope','scope','')).slice(0,200)||null,String(get('benefits','benefits','')).slice(0,400)||null,active,number(get('sortOrder','sort_order',0),'排序'),valid||null,group||null,mall,JSON.stringify(kind==='recharge'?giftItems:[])]
    if(editing)db.prepare('UPDATE membership_packages SET kind=?,name=?,price_cents=?,bonus_cents=?,times_count=?,scope=?,benefits=?,is_active=?,sort_order=?,valid_days=?,project_group=?,mall_visible=?,gift_items_json=? WHERE id=? AND tenant_id=?').run(...values,id,tid)
    else db.prepare('INSERT INTO membership_packages(kind,name,price_cents,bonus_cents,times_count,scope,benefits,is_active,sort_order,valid_days,project_group,mall_visible,gift_items_json,id,tenant_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values,id,tid,new Date().toISOString())
    json(res,editing?200:201,{package:serializeMembershipPackage(db.prepare('SELECT * FROM membership_packages WHERE id=? AND tenant_id=?').get(id,tid))});return true
  }
}
