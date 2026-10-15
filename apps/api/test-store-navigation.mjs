import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {withStoreNavigation} from './store-navigation.mjs'
const a={tenant_id:'jics-nail',address:'长兴南街华润悦府13号楼1单元2004室 2005室（20层）'}
const b={tenant_id:'luvia-bj',address:'北京市朝阳区建外街道CBD万达广场6号楼2005室'}
assert.equal(withStoreNavigation(a).navigation.building,true)
assert.equal(withStoreNavigation(b).navigation.building,false)
assert.notEqual(withStoreNavigation(a).navigation.url,withStoreNavigation(b).navigation.url)
for(const bad of [{...a,tenant_id:'other'},{...a,address:'新地址'},{...a,address:''}])assert.equal(withStoreNavigation(bad).navigation,null)
assert.equal(withStoreNavigation(null),null)
let sheet,clipboard,modal,toasts=[]
const box={module:{exports:{}},wx:{showActionSheet:o=>{sheet=o},setClipboardData:o=>{clipboard=o.data;o.success()},showModal:o=>{modal=o},showToast:o=>toasts.push(o.title)}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/store-navigation.js',import.meta.url),'utf8'),box)
for(let i=0;i<5;i++){
 box.module.exports.navigate(withStoreNavigation(a));sheet.success({tapIndex:0});assert.equal(clipboard,withStoreNavigation(a).navigation.url);assert.ok(modal.content.includes('浏览器'))
 sheet.success({tapIndex:1});assert.equal(clipboard,a.address)
}
box.module.exports.navigate({...a,navigation:{url:'javascript:alert(1)'}});assert.equal(sheet.itemList.length,1)
box.module.exports.navigate({});assert.ok(toasts.at(-1).includes('待补充'))
sheet.fail({errMsg:'unexpected'});assert.ok(toasts.at(-1).includes('失败'))
const web={window:{}};vm.runInNewContext(readFileSync(new URL('../web/store-navigation.js',import.meta.url),'utf8'),web)
assert.ok(web.window.StoreNavigation.render(withStoreNavigation(a),false).includes(withStoreNavigation(a).navigation.url))
assert.equal(web.window.StoreNavigation.render({navigation:{url:'javascript:alert(1)'}},false),'')
console.log('ok 1 - verified map destinations, changed-address invalidation, tenant isolation, five repeated clipboard flows, empty/error states and web links')
