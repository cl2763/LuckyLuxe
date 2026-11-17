import {beginWriteSavepoint} from './write-savepoint.mjs'
export const LEGACY_BOOKING_ADDONS=[
 {id:'remove',name:'卸甲/卸睫',priceCents:3000,durationMin:30},
 {id:'reinforce',name:'甲面加固',priceCents:4000,durationMin:15},
 {id:'senior',name:'指定资深技师',priceCents:6000,durationMin:0},
 {id:'extend',name:'延长加项时间',priceCents:5000,durationMin:30}
]
export function createBookingAddons({db,apiError}) {
 const key='booking_addons'
 function read(tid){
  const row=db.prepare('SELECT value FROM tenant_settings WHERE tenant_id=? AND key=?').get(tid,key)
  return row?JSON.parse(row.value):{enabled:true,revision:0,legacy:true,items:LEGACY_BOOKING_ADDONS.map((x,i)=>({...x,isActive:true,serviceIds:[],sortOrder:i,settlementItemId:null}))}
 }
 function visible(tid,serviceId){const c=read(tid);return c.enabled?c.items.filter(x=>x.isActive&&(!serviceId||!x.serviceIds.length||x.serviceIds.includes(serviceId))).sort((a,b)=>a.sortOrder-b.sortOrder):[]}
 function resolve(tid,serviceId,input){
  if(!Array.isArray(input)||input.length>50)throw apiError(400,'INVALID_ADDONS','附加服务格式不正确。')
  const catalog=visible(tid,serviceId),seen=new Set()
  return input.map(item=>{
   if(item&&typeof item==='object'&&['priceCents','durationMin'].some(k=>item[k]!==undefined&&(!Number.isSafeInteger(item[k])||item[k]<0)))throw apiError(400,'INVALID_ADDONS','附加服务金额和时长须为非负整数。')
   const id=typeof item==='string'?item:item?.id,found=catalog.find(x=>x.id===id)
   if(!found||seen.has(id))throw apiError(409,'ADDONS_CHANGED','附加服务已停用、不适用或重复，请重新选择。')
   seen.add(id)
   if(typeof item==='object'&&['priceCents','durationMin'].some(k=>item[k]!==undefined&&item[k]!==found[k]))throw apiError(409,'ADDONS_CHANGED','附加服务价格或时长已更新，请重新核对。')
   return {id:found.id,name:found.name,priceCents:found.priceCents,durationMin:found.durationMin,settlementItemId:found.settlementItemId||null}
  })
 }
 function configure(tid,input){
  const current=read(tid)
  if(input.expectedRevision!==current.revision)throw apiError(409,'CONFIG_CHANGED','附加服务已被修改，请刷新核对后再保存。')
  if(typeof input.enabled!=='boolean'||!Array.isArray(input.items)||input.items.length>50)throw apiError(400,'INVALID_ADDONS','请提供开关及不超过50个附加服务。')
  const seen=new Set(),invalid=m=>{throw apiError(400,'INVALID_ADDONS',m)}
  const items=input.items.map((x,i)=>{
   if(!x||!/^[-\w]{1,80}$/.test(x.id)||seen.has(x.id))invalid('附加服务编号无效或重复。')
   seen.add(x.id);const name=String(x.name||'').trim()
   if(!name||name.length>80)invalid('附加服务名称须为1至80字。')
   if(!Number.isSafeInteger(x.priceCents)||x.priceCents<0||x.priceCents>100000000)invalid('展示金额无效。')
   if(!Number.isInteger(x.durationMin)||x.durationMin<0||x.durationMin>360)invalid('增加时长须为0至360分钟。')
   if(typeof x.isActive!=='boolean'||!Array.isArray(x.serviceIds)||x.serviceIds.length>500)invalid('请核对启用状态及适用项目。')
   for(const sid of x.serviceIds)if(!db.prepare("SELECT id FROM services WHERE id=? AND tenant_id=? AND COALESCE(item_kind,'service')<>'addon'").get(sid,tid))invalid('请选择本店的服务项目，收费加项不能作为适用项目。')
   if(x.settlementItemId&&!db.prepare("SELECT id FROM services WHERE id=? AND tenant_id=? AND item_kind='addon'").get(x.settlementItemId,tid))invalid('请选择本店的结算收费加项。')
   return {id:x.id,name,priceCents:x.priceCents,durationMin:x.durationMin,isActive:x.isActive,serviceIds:[...new Set(x.serviceIds)],sortOrder:Number.isInteger(x.sortOrder)?x.sortOrder:i,settlementItemId:x.settlementItemId||null}
  })
  beginWriteSavepoint(db, 'booking_addon_config', 'tenant_settings')
  try{
   if(read(tid).revision!==input.expectedRevision)throw apiError(409,'CONFIG_CHANGED','配置已更新，请刷新。')
   for(const old of current.items.filter(x=>!seen.has(x.id))){
    const used=db.prepare("SELECT 1 FROM bookings b,json_each(CASE WHEN json_valid(b.addons_json) THEN b.addons_json ELSE '[]' END) a WHERE b.tenant_id=? AND json_extract(a.value,'$.id')=? LIMIT 1").get(tid,old.id)
    if(used)throw apiError(409,'ADDON_IN_USE','附加服务已有预约记录，请停用而非删除。')
   }
   const next={enabled:input.enabled,revision:current.revision+1,items}
   db.prepare('INSERT INTO tenant_settings(tenant_id,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(tid,key,JSON.stringify(next),new Date().toISOString())
   db.exec('RELEASE booking_addon_config');return next
  }catch(e){db.exec('ROLLBACK TO booking_addon_config; RELEASE booking_addon_config');throw e}
 }
 return {read,visible,resolve,configure}
}
