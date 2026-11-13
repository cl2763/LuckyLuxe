import {makeActorOf} from './actor-name.mjs'
import {createHash} from 'node:crypto'
import {PRICING_CONTEXT} from './member-pricing-policy.mjs'
export const pricingDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function createMemberPricingCalculation({db,policy,apiError,balanceOf}) {
  const actorOf=makeActorOf({apiError})
  function prepare(tid,uid,body,admin) {
    const config=policy.config(tid)
    if(!config.active) throw apiError(409,'PRICING_NOT_ENABLED','新版结算尚未启用。')
    const current=policy.discount(tid,uid),membership=policy.getMembershipConfig(tid)
    const sheets=Array.isArray(body.settlements)?body.settlements:[body]
    if(!sheets.length || sheets.length>100) throw apiError(400,'INVALID_ITEMS','请选择服务项目。')
    for(const sheet of sheets) {
      if(!sheet || typeof sheet!=='object' || Array.isArray(sheet)) throw apiError(400,'INVALID_ITEMS','服务分组无效。')
      const quotedValues=new Map()
      for(const key of ['items','customItems']) {
        if(sheet[key]!==undefined && (!Array.isArray(sheet[key]) || sheet[key].length>100)) throw apiError(400,'INVALID_ITEMS','项目数量无效。')
        for(const item of sheet[key]||[]) {
          if(!item||typeof item!=='object') throw apiError(400,'INVALID_ITEMS','项目格式无效。')
          if(key==='customItems' && (!String(item.name||'').trim() || !Number.isSafeInteger(item.amountCents) || item.amountCents<0 || item.amountCents>100000000)) throw apiError(400,'INVALID_ITEMS','自填服务名称或金额无效。')
          if(key==='items') {
            const service=policy.service(tid,item.serviceId)
            if(service.price_mode==='quote'&&(!Number.isSafeInteger(item.quotedListCents)||item.quotedListCents<0||item.quotedListCents>100000000))throw apiError(400,'QUOTED_PRICE_REQUIRED','需报价项目请先填写本次服务原价，再计算个人折扣。')
            if(service.price_mode==='quote'){if(quotedValues.has(service.id)&&quotedValues.get(service.id)!==item.quotedListCents)throw apiError(400,'INCONSISTENT_QUOTE','同项目采用不同报价时，请拆成两个服务项目组。');quotedValues.set(service.id,item.quotedListCents)}
            if(service.price_mode!=='quote'&&item.quotedListCents!==undefined)throw apiError(400,'PRICE_OVERRIDE_NOT_ALLOWED','固定价项目请通过结算价目表修改原价。')
          }
          for(const q of ['qty','fingers']) if(item[q]!==undefined && (!Number.isSafeInteger(item[q])||item[q]<1||item[q]>1000)) throw apiError(400,'INVALID_ITEMS','项目数量须为1至1000的整数。')
        }
      }
    }
    const recharges=sheets.filter(s=>s.rechargePackageId || s.rechargeAmountCents!==undefined)
    if(recharges.length>1) throw apiError(400,'MULTIPLE_RECHARGES','同一次开单只办理一笔随单充值。')
    const rs=recharges[0]
    let recharge=null,rateBps=current.rateBps,reason='',suggestedRateBps=current.rateBps,suggestionSource=current.rateBps===null?'store-default':'member',manuallySelected=false
    if(rs) {
      if(!['owner','staff'].includes(admin?.role)) throw apiError(403,'FORBIDDEN','需要员工充值权限。')
      const pkg=rs.rechargePackageId?db.prepare("SELECT * FROM membership_packages WHERE tenant_id=? AND id=? AND kind='recharge' AND is_active=1").get(tid,String(rs.rechargePackageId)):null
      if(rs.rechargePackageId&&!pkg) throw apiError(404,'PACKAGE_NOT_FOUND','充值套餐不存在或已下架。')
      const amount=pkg?pkg.price_cents:rs.rechargeAmountCents
      if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000) throw apiError(400,'INVALID_RECHARGE','充值金额无效。')
      const bonus=pkg?.bonus_cents||0
      if(!Number.isSafeInteger(bonus)||bonus<0||bonus>100000000)throw apiError(400,'INVALID_RECHARGE','套餐赠金无效，请先修正套餐。')
      recharge={amountCents:amount,bonusCents:bonus,packageId:pkg?.id||null}
      const suggested=pkg?policy.packageDiscount(tid,pkg.id).rateBps:null
      suggestedRateBps=suggested??current.rateBps
      suggestionSource=suggested!==null?'package':current.rateBps===null?'store-default':'member'
      manuallySelected=rs.personalRateBps!==undefined
      rateBps=rs.personalRateBps===undefined?(suggested??current.rateBps):policy.rate(rs.personalRateBps)
      reason=String(rs.discountReason||'充值确认折扣').trim()
      if(!reason || reason.length>300) throw apiError(400,'REASON_REQUIRED','请填写折扣调整原因。')
    } else if(sheets.some(s=>s.personalRateBps!==undefined)) throw apiError(403,'RECHARGE_REQUIRED','本单没有充值，不能在开单时修改个人折扣。')
    let eligible=current.eligible
    if(recharge && config.membershipEnabled) {
      if(membership.memberQualify==='any_recharge') eligible=true
      if(membership.memberQualify==='balance_gt_0') eligible=balanceOf(uid,tid)+recharge.amountCents+recharge.bonusCents>0
    }
    const context={tenantId:tid,userId:uid,rateBps:eligible?rateBps:null,eligible,oldRevision:current.revision,oldRateBps:current.rateBps,proposedRateBps:rateBps,suggestedRateBps,suggestionSource,manuallySelected,recharge,reason,configRevision:config.revision,membershipDigest:pricingDigest(membership),actor:actorOf(admin),role:admin?.role}
    const prepared=sheets.map(s=>{
      const tier=s.tierKey||(eligible?'member':'list')
      if(!config.settlementTypes.includes(tier)) throw apiError(400,'PRICE_TYPE_DISABLED','本店结算未启用这个价格类型。')
      if(tier==='member'&&!eligible) throw apiError(400,'MEMBER_REQUIRED','顾客当前不具备会员资格，请选择原价。')
      return {...s,tierKey:tier,[PRICING_CONTEXT]:{...context,quotedPrices:Object.fromEntries((s.items||[]).filter(i=>i.quotedListCents!==undefined).map(i=>[i.serviceId,i.quotedListCents])),applyPersonal:tier==='member'&&context.rateBps!==null}}
    })
    return {context,sheets:prepared}
  }
  function priceOf(service,tier,ctx) {
    if(!service) return {priceCents:0,courseTimes:null,tierUsed:tier}
    if(service.price_mode==='quote') {const quoted=ctx.quotedPrices?.[service.id];if(quoted===undefined)throw apiError(400,'QUOTED_PRICE_REQUIRED','请填写本次服务原价。');return {priceCents:quoted,courseTimes:null,tierUsed:'list'}}
    const p=policy.prices(ctx.tenantId,service.id,'settlement').prices
    const wanted=ctx.applyPersonal&&tier==='member'?'list':tier
    const hit=p[wanted] || (wanted==='member'?p.list:null)
    if(!hit) throw apiError(400,'PRICE_NOT_CONFIGURED','该项目尚未配置所选结算价格，请先完善价目表。')
    return {...hit,tierUsed:wanted}
  }
  function apply(lines,rules,ctx) {
    // New calculation represents fixed charges as explicit items so all service charges share the rate.
    for(const rule of rules.filter(r=>r.key==='foot_surcharge')) {
      lines.push({itemNo:lines.length+1,kind:'rule',serviceId:null,name:rule.label,tierKey:ctx.applyPersonal?'member':'list',unit:'once',qty:1,listUnitCents:rule.amountCents,unitPriceCents:rule.amountCents,listAmountCents:rule.amountCents,amountCents:rule.amountCents,ruleApplied:rule.key,isFree:false})
    }
    if(ctx.applyPersonal) {
      const rounded=amount=>Number((BigInt(amount)*BigInt(ctx.rateBps)+5000n)/10000n)
      let base=ctx.roundingBaseCents||0,allocated=rounded(base)
      for(const line of lines) {
        if(line.kind==='timecard') continue
        base+=line.listAmountCents
        const after=rounded(base)
        line.amountCents=after-allocated;allocated=after
        line.unitPriceCents=rounded(line.listUnitCents)
        line.personalRateBps=ctx.rateBps
        line.roundingAdjustmentCents=line.amountCents-line.unitPriceCents*line.qty
        line.isFree=line.amountCents===0
      }
    }
    return {listTotalCents:lines.reduce((n,l)=>n+l.listAmountCents,0),subtotalCents:lines.reduce((n,l)=>n+l.amountCents,0)}
  }
  return {prepare,priceOf,apply}
}
