/* One category-scope policy for web, mini-program and API. Empty legacy scope is unrestricted. */
;(function(root,factory){const policy=factory();if(typeof module==='object'&&module.exports)module.exports=policy;else root.AddonPolicy=policy})(typeof window==='object'?window:this,function(){
  function scope(item){let value=item.addonScope??item.addon_scope_json??[];if(typeof value==='string'){try{value=JSON.parse(value)}catch{return []}}return Array.isArray(value)?value.map(String):[]}
  function matches(item,main){const ids=scope(item);return !ids.length||!!main&&ids.includes(String(main.categoryId??main.category_id??''))}
  function groups(items,main,selected={}){const map=new Map();for(const item of items.filter(i=>(i.itemKind??i.item_kind)==='addon')){if(!matches(item,main)&&!Object.prototype.hasOwnProperty.call(selected,item.id))continue;const title=String(item.addonGroup??item.addon_group??'').trim()||'其他加项';if(!map.has(title))map.set(title,[]);map.get(title).push(item)}return [...map].sort(([a],[b])=>a==='其他加项'?1:b==='其他加项'?-1:0).map(([title,items])=>({title,items}))}
  return {scope,matches,groups}
});
