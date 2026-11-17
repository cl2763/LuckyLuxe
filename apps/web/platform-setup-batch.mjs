const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
// Each draft keeps its own server revision, owner confirmation and transaction.
// Partial failure is reported per item; it never becomes an all-success receipt.
export async function applyConfirmedDrafts({drafts,apply,handoff,onProgress}){
 const results=[]
 for(const d of drafts){
  if(d.needsOwnerConfirmation&&!d.ownerConfirmed){results.push({id:d.id,module:d.module,title:d.title,status:'blocked',message:'等待老板确认'});onProgress(results.length,drafts.length);continue}
  let result
  try{result=await apply(d)}catch(e){results.push({id:d.id,module:d.module,title:d.title,status:'failed',message:e.message||'应用失败，请重新核对'});onProgress(results.length,drafts.length);continue}
  results.push({id:d.id,module:d.module,title:d.title,status:'applied',message:'已应用，历史业务记录保持原样'})
  if(result.handoff)await handoff(result.handoff)
  onProgress(results.length,drafts.length)
 }
 return results
}
export function batchResultsHtml(results){if(!results.length)return '';return `<section class="intake-card" data-batch-results><h2>本次配置应用结果</h2><p>成功 ${results.filter(r=>r.status==='applied').length} 项 · 未应用 ${results.filter(r=>r.status!=='applied').length} 项。每项结果以服务器返回为准。</p><div class="tablewrap"><table><thead><tr><th>配置内容</th><th>结果</th><th>说明</th><th>后续操作</th></tr></thead><tbody>${results.map(r=>`<tr data-result="${esc(r.id)}"><td>${esc(r.title||r.module)}</td><td>${r.status==='applied'?'已应用':r.status==='blocked'?'待老板确认':'未应用'}</td><td>${esc(r.message)}</td><td>${r.status==='applied'?`<button data-result-preview="${esc(r.module)}">查看实际效果</button>`:`<button data-edit-draft="${esc(r.id)}">重新核对</button>`}</td></tr>`).join('')}</tbody></table></div><p>仅报告配置应用结果；其他设备读取与真实手机核对分别验收。</p></section>`}
