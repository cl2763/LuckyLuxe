// Category writes belong to the platform. Fixtures use that real entry point,
// and never substitute the first category when a requested category is missing.
export async function ensurePricingCategory({base,platformToken,merchantToken,body}){
 const call=async(path,method,token,value)=>{const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json()}}
 const me=await call('/admin/auth/me','GET',merchantToken);const tenantId=me.data.admin?.tenantId;if(!tenantId)throw Error('Category fixture cannot identify merchant tenant')
 const path='/platform/tenants/'+encodeURIComponent(tenantId)+'/categories',r=await call(path,'POST',platformToken,body)
 if(r.status===201)return r.data.category
 if(r.status!==409)throw Error('Category fixture failed: '+(r.data.error?.message||r.status))
 const rows=(await call(path,'GET',platformToken)).data.categories||[],existing=rows.find(c=>c.key===body.key);if(!existing)throw Error('Requested category missing after duplicate response');return existing
}
