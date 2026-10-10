// Page/Behavior contract tests. Mocked wx callbacks, not native permission proof.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const root=new URL('../../miniprogram/',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
let assertions=0; const ok=(v,m)=>{assert.ok(v,m);console.log(`ok ${++assertions} - ${m}`)};
function loadPage(file,wx,api={},app={globalData:{},resolvePrivacyAuthorization(){}}){
 let p,behavior;
 const context={wx,getApp:()=>app,console,Behavior:o=>o,module:{exports:{}},require:()=>({})};
 vm.runInNewContext(read('utils/media-privacy.js'),context);behavior=context.module.exports;
 vm.runInNewContext(read(file),{wx,getApp:()=>app,console,Page:o=>p=o,require:n=>n.endsWith('media-privacy')?behavior:n.endsWith('/api')?api:n.endsWith('/i18n')?{pageCopy:()=>({})}:{} });
 const data=Object.assign({},behavior.data,p.data);Object.assign(p,behavior.methods);p.data=JSON.parse(JSON.stringify(data));p.setData=d=>Object.assign(p.data,d);return p;
}
for(const [name,method] of [['merchant/gallery','upload'],['merchant/service-note','addImages'],['merchant/customer-profile','addShots'],['merchant/work-detail','saveImage'],['booking','chooseImage']]){
 let media=0,need=true,fail=false,toasts=[];const app={globalData:{},resolvePrivacyAuthorization(){need=false}};
 const wx={getPrivacySetting:o=>fail?o.fail():o.success({needAuthorization:need}),chooseMedia:()=>media++,getImageInfo:()=>media++,showToast:o=>toasts.push(o.title)};
 const p=loadPage(`pages/${name}/index.js`,wx,{},app);p.data.curImg='https://example.invalid/fixture.jpg';const event={currentTarget:{dataset:{id:'fixture'}}};
 for(let cycle=0;cycle<5;cycle++){
  need=true;p[method](event);ok(p.data.mediaPrivacyVisible && media===cycle,`${name} cycle${cycle+1} consent before media`);
  p.cancelMediaPrivacy();ok(media===cycle && !p.data.mediaPrivacyVisible,`${name} refusal stops action`);
  p[method](event);p.agreeMediaPrivacy();p.agreeMediaPrivacy();ok(media===cycle+1,`${name} agreement executes once`);
 }
 fail=true;p[method](event);ok(media===5&&toasts.length===1,`${name} settings failure reported without invoking media`);
 const markup=read(`pages/${name}/index.wxml`);ok(markup.includes('templates/media-privacy.wxml'),`${name} visible consent template mounted`);
}
let docsRead=0;const p=loadPage('pages/merchant/customer-profile/index.js',{}, {guardMerchant:()=>true,getCustomerNotes:async()=>({profile:{}}),getSignedDocs:async()=>{docsRead++;return {docs:[{id:'doc-fixture'}],types:[{key:'rights'}]}}});p.data.userId='fixture';await p.onShow();ok(docsRead===1 && p.data.docs.length===1 && p.data.docTypes.length===1,'profile first entry reads signed files and types');ok(!p.data.docsLoading&&!p.data.docsError,'profile successful load settles loading');
const failure=loadPage('pages/merchant/customer-profile/index.js',{}, {getSignedDocs:async()=>{throw Error('offline')}});await failure.loadDocs();ok(!failure.data.docsLoading && failure.data.docsError,'profile failure does not pretend empty');failure.openUpload();ok(!failure.data.uploading,'failed types load cannot open incomplete upload');
// Native chooser accepts at most nine files per invocation even when a document allows twenty pages.
for (const [name, method, field, total] of [['merchant/customer-profile','addShots','shots',20],['merchant/service-note','addImages','images',9]]) {
 let options; const toasts=[];
 const wx={getPrivacySetting:o=>o.success({needAuthorization:false}),chooseMedia:o=>{options=o},showToast:o=>toasts.push(o.title),getFileSystemManager:()=>({readFile:o=>o.fail()})};
 const page=loadPage(`pages/${name}/index.js`,wx);page[method]();
 ok(options.count===9,`${name} first selection never requests more than nine files`);
 await options.success({tempFiles:[{tempFilePath:'unreadable.jpg'}]});
 ok(page.data[field].length===0&&toasts.includes('未能读取图片，请重新选择'),`${name} unreadable image is not silently accepted`);
 page.data[field]=Array(total-1).fill('fixture');page[method]();
 ok(options.count===1,`${name} remaining capacity is respected`);
}
// Inventory all published native media calls so new unguarded pages cannot slip through.
const config=JSON.parse(read('app.json'));const registered=[...config.pages,...config.subPackages.flatMap(s=>s.pages.map(p=>s.root+'/'+p))];
for(const path of registered){const source=read(path+'.js');if(/wx\.(?:chooseMedia|chooseImage|saveImageToPhotosAlbum)\(/.test(source))ok(source.includes('utils/media-privacy'),`${path} published media inventory guarded`)}
// Platform declaration failure must never be blamed on the user's album permission.
for (const name of ['merchant/gallery','merchant/service-note','merchant/customer-profile','booking']) {
 const dialogs=[]; const page=loadPage(`pages/${name}/index.js`,{showModal:o=>dialogs.push(o),showToast:()=>{}});
 page.mediaPrivacyFailure({errno:112,errMsg:'chooseMedia:fail api scope is not declared in the privacy agreement'});
 ok(dialogs.length===1&&dialogs[0].content.includes('不是你的手机相册权限'),`${name} declaration failure identified correctly`);
 page.mediaPrivacyFailure({errMsg:'chooseMedia:fail cancel'});
 ok(dialogs.length===1,`${name} voluntary cancellation stays quiet`);
 page.mediaPrivacyFailure({errMsg:'chooseMedia:fail auth deny'});
 ok(dialogs.length===2&&dialogs[1].content.includes('照片权限未获允许'),`${name} actual device denial remains distinguishable`);
}
console.log(`1..${assertions}`);
