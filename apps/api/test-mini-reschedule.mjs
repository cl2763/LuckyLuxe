import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../../miniprogram/utils/order-actions.js',import.meta.url),'utf8')
let calls=[],modals=[],reject=false,pending
const api={adminGet:async()=>({bookings:[]}),adminPost:async(path,body)=>{calls.push({path,body});if(reject)throw Error('时段已被占用');if(pending)await pending}}
const sandbox={module:{exports:{}},require:()=>api,wx:{showToast(){},showModal(o){modals.push(o)}},console}
vm.runInNewContext(source,sandbox)
const page={...sandbox.module.exports,data:{raw:[{id:'book-1',appointmentDate:'2030-10-07',appointmentTime:'10:00',appointmentStart:'2030-10-07T02:00:00.000Z'}],selDate:'2030-10-07'},setData(values){for(const [k,v]of Object.entries(values)){const parts=k.split('.');if(parts.length===2)this.data[parts[0]][parts[1]]=v;else this.data[k]=v}},loadList(){this.reloaded=true},loadDayView(){this.dayReloaded=true}}
let n=0;const failures=[];const check=(name,ok)=>{console.log(`${ok?'ok':'not ok'} ${++n} - ${name}`);if(!ok)failures.push(name)}
page._panelCtx={id:'book-1'};await page.tapGridAct({act:'reschedule'})
check('日历动作能打开真实改期表单',page.data.rescheduleSheet?.id==='book-1')
page.closeReschedule();check('取消不调用写接口',calls.length===0&&page.data.rescheduleSheet===null)
await page.openReschedule('book-1');page.changeRescheduleTime({detail:{value:'16:00'}})
reject=true;await page.submitReschedule()
check('冲突后保留所填时间、展示原因并解锁重试',page.data.rescheduleSheet.time==='16:00'&&!page.data.rescheduleBusy&&modals[0]?.content==='时段已被占用')
reject=false;let release;pending=new Promise(r=>release=r);const first=page.submitReschedule();await page.submitReschedule();page.closeReschedule()
check('提交中防重复提交且不能误关表单',calls.length===2&&page.data.rescheduleSheet!==null)
release();await first
check('成功发送日期时间及版本，刷新列表与日历',calls[1].body.time==='16:00'&&calls[1].body.expectedStart==='2030-10-07T02:00:00.000Z'&&page.reloaded&&page.dayReloaded&&page.data.rescheduleSheet===null)
console.log(`${n} checks; ${failures.length} failures`);process.exitCode=failures.length?1:0
