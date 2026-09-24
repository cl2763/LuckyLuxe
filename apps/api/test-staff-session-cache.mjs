import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import assert from 'node:assert/strict'
const window={};runInNewContext(readFileSync(new URL('../web/staff-workbench.js',import.meta.url),'utf8'),{window,storeToday:()=> '2026-09-24'})
const mount={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null}
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {resolve,reject,promise}}
function deps(name,perf){return {owner:{auth:{accessToken:name,admin:{technicianId:name}}},escapeHtml:String,money:String,request:async p=>p==='/admin/my-performance'?perf:{},toast:()=>{}}}
let count=0
const check=(name,cond)=>{assert.ok(cond,name);console.log(`ok ${++count} - ${name}`)}
await window.StaffWorkbench.render(mount,deps('staff-a',{performance:{note:'员工甲私有业绩'}}))
check('员工甲正常渲染',mount.innerHTML.includes('员工甲私有业绩'))
await window.StaffWorkbench.render(mount,deps('staff-b',{performance:{note:'员工乙私有业绩'}}))
check('切换员工不复用旧缓存',mount.innerHTML.includes('员工乙私有业绩')&&!mount.innerHTML.includes('员工甲私有业绩'))
const slow=deferred(),old=window.StaffWorkbench.render(mount,deps('staff-c',slow.promise))
await window.StaffWorkbench.render(mount,deps('staff-d',{performance:{note:'新会话业绩'}}))
slow.resolve({performance:{note:'旧请求迟到'}});await old
check('旧请求晚到不能覆盖新会话',mount.innerHTML.includes('新会话业绩')&&!mount.innerHTML.includes('旧请求迟到'))
const bad=deferred(),oldBad=window.StaffWorkbench.render(mount,deps('staff-e',bad.promise))
await window.StaffWorkbench.render(mount,deps('staff-f',{performance:{note:'当前会话'}}));bad.reject(Error('旧会话失败'));await oldBad
check('旧请求失败不能覆盖新会话',mount.innerHTML.includes('当前会话')&&!mount.innerHTML.includes('旧会话失败'))
