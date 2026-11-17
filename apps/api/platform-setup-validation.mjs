// Reject ambiguous input before the shared legacy writers can coerce it to zero or true.
export function validateSetupBody(module,body,apiError){
 const fail=message=>{throw apiError(400,'INVALID_SETUP_VALUE',message)}
 const booleans=new Set(['enabled','isActive','mallVisible','isClosed','onlineDeposit','tiersEnabled','deductible','refundable','enableBase','enableHandwork','enableOvertime','enableCardCommission'])
 function walk(v,path=''){
  if(!v||typeof v!=='object')return
  for(const [key,value] of Object.entries(v)){
   const name=path?path+'.'+key:key
   if(booleans.has(key)&&typeof value!=='boolean')fail(name+'应为开关值。')
   if(/Cents$/.test(key)||['timesCount','costPoints','stock','perUserLimit','totalQty','validDays','expireDays','qualifyValueCents','sortOrder','baseDurationMin','revision','expectedRevision','quantity','weekday','orderTarget'].includes(key)){
    if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>1e12))fail(name+'应为有效的非负整数。')
   }
   if(['pct','priceRuleValue','flatPct','firstRechargePct','renewRechargePct','percentOff','lateForfeitPct','noShowForfeitPct'].includes(key)&&(!Number.isFinite(value)||value<0||value>100))fail(name+'应在0至100之间。')
   if(typeof value==='string'&&!['image','imageUrl'].includes(key)&&value.length>10000)fail(name+'内容过长。')
   walk(value,name)
  }
 }
 walk(body)
 if(['recharge','times','coupons','services','settlement','store'].includes(module))for(const k of ['name','nameZh'])if(body[k]!==undefined&&(typeof body[k]!=='string'||!body[k].trim()))fail('名称不能为空。')
 if(module==='settlement'&&body.unit!==undefined&&!['once','per_finger','per_session'].includes(body.unit))fail('计费单位无效。')
 if(module==='recurring'){if(body.amountCents!==undefined&&body.amountCents<=0)fail('固定费用金额须大于零。');if(!Number.isInteger(body.dayOfMonth)||body.dayOfMonth<1||body.dayOfMonth>31)fail('每月记账日应为1至31日。')}
 if(module==='salary'){
  if(body.template!==undefined&&!['base_ladder','base_flat','commission'].includes(body.template))fail('薪资算法无效。')
  if(body.ladderMode!==undefined&&!['whole','progressive'].includes(body.ladderMode))fail('阶梯算法无效。')
  if(body.overtimeUnitMin!==undefined&&![30,60].includes(body.overtimeUnitMin))fail('加班计时单位应为30或60分钟。')
  if(body.ladder!==undefined&&(!Array.isArray(body.ladder)||body.ladder.length>8))fail('阶梯档位最多8档。')
  if(Array.isArray(body.ladder)){let last=0;body.ladder.forEach((r,i)=>{if(!r||!Number.isSafeInteger(r.minCents)||r.minCents<last||r.maxCents!==null&&(!Number.isSafeInteger(r.maxCents)||r.maxCents<=r.minCents)||r.maxCents===null&&i!==body.ladder.length-1)fail('服务提成档位不能重叠，末档才可不设上限。');last=r.maxCents??Infinity})}
  if(body.customCommissions!==undefined&&(!Array.isArray(body.customCommissions)||body.customCommissions.length>10))fail('自定义提成最多10项。')
 }
 if(module==='quote')for(const [key,max] of [['gapHours',72],['validHours',336]])if(body[key]!==undefined&&(!Number.isInteger(body[key])||body[key]<1||body[key]>max))fail('请填写有效的小时数。')
 if(module==='segments')for(const [key,min,max] of [['aDays',1,365],['aVisits',1,50],['nDays',1,180],['sDays',7,365]])if(body[key]!==undefined&&(!Number.isInteger(body[key])||body[key]<min||body[key]>max))fail(key+'超出允许范围。')
 if(module==='points'&&body.costPoints!==undefined&&body.costPoints<1)fail('兑换积分至少为1。')
 if(module==='coupons'&&body.discountType!==undefined&&!['amount','percent'].includes(body.discountType))fail('优惠类型无效。')
}
