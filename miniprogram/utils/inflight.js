// Only share pending reads; writes invalidate the join window, never cache results.
const pending=new Map()
function run(key,read,load){
 if(!read){pending.clear();return load()}
 if(pending.has(key))return pending.get(key)
 const p=load().finally(()=>{if(pending.get(key)===p)pending.delete(key)})
 pending.set(key,p);return p
}
module.exports={run}
