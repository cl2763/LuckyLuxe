// Public map destinations verified in Amap UI on 2026-10-15. No merchant records are rewritten.
const destinations = {
 'luvia-bj': {parts:['朝阳','万达广场6号楼','2005'],url:'https://surl.amap.com/12bldG3IK4Jc',building:false},
 'jics-nail': {parts:['长兴南街','华润悦府13号楼','1单元','2005'],url:'https://surl.amap.com/12rAI0OW1z6zH',building:true}
}
export function withStoreNavigation(store) {
 if(!store)return null
 const d=destinations[store.tenant_id],address=String(store.address||'').replace(/\s/g,'')
 const navigation=d&&d.parts.every(part=>address.includes(part))?{url:d.url,building:d.building}:null
 return {...store,navigation}
}
