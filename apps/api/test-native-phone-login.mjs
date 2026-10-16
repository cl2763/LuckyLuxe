import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {requireBoundCustomer} from './customer-phone-gate.mjs'
const error=(status,code,message)=>Object.assign(new Error(message),{status,code})
const req={method:'POST',url:'/bookings'}
assert.throws(()=>requireBoundCustomer(req,{phone:''},'production',error,true),{code:'PHONE_BINDING_REQUIRED'})
assert.equal(requireBoundCustomer(req,{phone:''},'production',error,false).phone,'')
assert.equal(requireBoundCustomer(req,{phone:'13800001234'},'production',error,true).phone,'13800001234')
for(const [method,url] of [['POST','/auth/wechat/mini-phone'],['GET','/auth/wechat/mini-phone-status']])assert.equal(requireBoundCustomer({method,url},{phone:''},'production',error,true).phone,'')
assert.throws(()=>requireBoundCustomer({method:'POST',url:'/auth/wechat/mini-phone-status'},{phone:''},'production',error,true))
console.log('ok 1 - production gate, existing phone, binding-only exceptions and staged rollout')
let need=true,bindCalls=0,fail=false,missingConfirmation=false,shown=0,toasts=[]
const api={loginWithWechat:async()=>{},phoneBindingRequired:()=>need,bindWechatPhone:async()=>{bindCalls++;if(fail)throw Error('credential expired');return {needPhone:missingConfirmation}}}
const box={module:{exports:{}},require:()=>api,wx:{showToast:o=>toasts.push(o.title)}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/phone-auth.js',import.meta.url),'utf8'),box)
const page={data:{lang:'zh',authProfile:{},authModalVisible:true},setData(p){for(const[k,v]of Object.entries(p)){if(k.startsWith('authProfile.'))this.data.authProfile[k.split('.')[1]]=v;else this.data[k]=v}},onShow:async()=>{shown++}}
const auth=box.module.exports
await auth.beginLogin(page);assert.equal(page.data.phoneStep,true);assert.equal(page.data.authModalVisible,true)
await auth.handlePhoneAuthResult(page,{detail:{errMsg:'getPhoneNumber:fail user deny'}});assert.equal(bindCalls,0);assert.equal(shown,0)
await auth.handlePhoneAuthResult(page,{detail:{errno:112,code:'not-used'}});assert.equal(bindCalls,0)
fail=true;await auth.handlePhoneAuthResult(page,{detail:{code:'expired'}});assert.equal(page.data.authModalVisible,true);assert.equal(page.data.phoneBusy,false)
fail=false;missingConfirmation=true;await auth.handlePhoneAuthResult(page,{detail:{code:'missing-confirmation'}});assert.equal(page.data.authModalVisible,true)
missingConfirmation=false;await auth.handlePhoneAuthResult(page,{detail:{code:'valid'}});assert.equal(page.data.authModalVisible,false);assert.equal(shown,1)
need=false;page.data.authModalVisible=true;await auth.beginLogin(page);assert.equal(page.data.authModalVisible,false);assert.equal(shown,2)
page.data.phoneBusy=true;await auth.handlePhoneAuthResult(page,{detail:{code:'duplicate'}});assert.equal(bindCalls,3)
console.log('ok 2 - new/returning customer, refusal, privacy denial, expired credential, missing receipt and double-tap')
const wxml=readFileSync(new URL('../../miniprogram/pages/me/index.wxml',import.meta.url),'utf8'),js=readFileSync(new URL('../../miniprogram/pages/me/index.js',import.meta.url),'utf8')
assert.ok(wxml.includes('open-type="getPhoneNumber"'));assert.ok(!js.includes('0312'));assert.ok(!js.includes('verifySmsCode()'))
console.log('ok 3 - native binding entry exists and fake verification removed; real-device authorization still required')
