import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import P from '../web/addon-policy.js'
import {assertAddonScope,catalogInteractionEnabled,settlementUnitPrices} from './addon-policy.mjs'
assert.equal(readFileSync(new URL('../web/addon-policy.js',import.meta.url),'utf8'),readFileSync(new URL('../../miniprogram/pages/merchant/settlement/addon-policy.js',import.meta.url),'utf8'))
const main={id:'main',categoryId:'nail'},care={id:'care',categoryId:'care'},cross={id:'cross',nameZh:'护理分类美甲加项',itemKind:'addon',categoryId:'care',addonScope:['nail'],addonGroup:'修补'},legacy={id:'legacy',itemKind:'addon',categoryId:'lash',addonScope:[]}
assert.equal(P.matches(cross,main),true);assert.equal(P.matches(cross,care),false);assert.equal(P.matches(cross,null),false)
console.log('ok 1 - web and mini share exact category-ID policy, independent of item own category')
assert.equal(P.matches(legacy,main),true);assert.equal(P.matches(legacy,null),true)
assert.deepEqual(P.groups([cross,legacy],null).map(g=>g.items.map(i=>i.id)),[['legacy']])
console.log('ok 2 - unscoped legacy fixed add-ons remain available without a main')
const selected={cross:2};assert.deepEqual(P.groups([cross,legacy],care,selected).map(g=>g.items.map(i=>i.id)),[['cross'],['legacy']]);assert.equal(selected.cross,2)
console.log('ok 3 - incompatible selections remain visible with quantities for explicit correction')
const err=(status,code,message)=>Object.assign(Error(message),{status,code}),row={...cross,item_kind:'addon',addon_scope_json:'["nail"]',addonScope:undefined,name_zh:'护理分类美甲加项'}
assert.doesNotThrow(()=>assertAddonScope(row,{category_id:'nail'},err));assert.throws(()=>assertAddonScope(row,{category_id:'lash'},err),{code:'ADDON_SCOPE_MISMATCH'});assert.throws(()=>assertAddonScope(row,null,err),{code:'ADDON_SCOPE_MISMATCH'})
console.log('ok 4 - API rejects mismatched and missing main for scoped add-ons')
const original=process.env.CATALOG_INLINE_TENANTS;delete process.env.CATALOG_INLINE_TENANTS
assert.equal(catalogInteractionEnabled('demo-ai'),true);assert.equal(catalogInteractionEnabled('nange-nail'),false);process.env.CATALOG_INLINE_TENANTS='nange-nail';assert.equal(catalogInteractionEnabled('demo-ai'),false);assert.equal(catalogInteractionEnabled('nange-nail'),true);if(original===undefined)delete process.env.CATALOG_INLINE_TENANTS;else process.env.CATALOG_INLINE_TENANTS=original
console.log('ok 5 - new rules default to Xingye only; unrelated merchant behavior is unchanged')
let page;vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/settlement/index.js',import.meta.url),'utf8'),{Page:p=>page=p,require:p=>p.endsWith('/addon-policy')?P:{}})
const ctx={data:{pricingConfig:{catalogInteractionV2:true}},allItems:[main,care,cross,legacy]};const group={mainId:'care',addonIds:{cross:2}};assert.deepEqual(Array.from(page.dropMismatchedAddons.call(ctx,group)),[]);assert.equal(group.addonIds.cross,2)
console.log('ok 6 - mini switching main no longer silently discards chosen add-ons in pilot')
const c={svc:{unit:'per_finger',price_rule:'pct_of_tier_price',price_rule_value:10},tierKey:'list',rules:{single_finger:{isActive:true}},tenantId:'demo-ai',mainRow:null,mainTierCents:0,apiError:err,priceOf:()=>({priceCents:10000})};assert.throws(()=>settlementUnitPrices(c),{code:'ADDON_MAIN_REQUIRED'});c.mainRow=main;c.mainTierCents=10000;assert.equal(settlementUnitPrices(c).tierUnit,1000)
console.log('ok 7 - percentage calculation rejects missing main instead of zero; valid base remains 10 percent')
console.log('test-addon-policy: all 7 checks passed')
