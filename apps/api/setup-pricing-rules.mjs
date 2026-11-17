import {beginWriteSavepoint} from './write-savepoint.mjs'
// Shared by the merchant editor and platform setup; an update is atomic.
export function configurePricingRules({db,apiError,getPricingRules,putPricingRule},tenantId,body){
 const keys=['foot_surcharge','single_finger','tip_reuse'],incoming=body.rules??body
 if(!incoming||typeof incoming!=='object'||Array.isArray(incoming)||Object.keys(incoming).some(k=>!keys.includes(k)))throw apiError(400,'BAD_PRICING_RULE','计价规则无效。')
 beginWriteSavepoint(db, 'pricing_rules_update', 'pricing_rules')
 try{const current=getPricingRules(tenantId);for(const key of keys){if(incoming[key]===undefined)continue;const r=incoming[key];if(!r||typeof r!=='object'||Array.isArray(r)||r.isActive!==undefined&&typeof r.isActive!=='boolean')throw apiError(400,'BAD_PRICING_RULE','请正确选择计价开关。');const config={...current[key].config,...r.config},v=key==='single_finger'?config.pct:config.amountCents;if(!Number.isFinite(v)||v<0||(key==='single_finger'?v>100:!Number.isSafeInteger(v)||v>1e12))throw apiError(400,'BAD_PRICING_RULE','计价金额或比例无效。');putPricingRule(tenantId,key,{isActive:r.isActive??current[key].isActive,config})}db.exec('RELEASE pricing_rules_update');return {rules:getPricingRules(tenantId)}}catch(e){db.exec('ROLLBACK TO pricing_rules_update; RELEASE pricing_rules_update');throw e}
}
