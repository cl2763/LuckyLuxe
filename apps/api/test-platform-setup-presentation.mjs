import assert from 'node:assert/strict'
import {setupReviewRows} from './setup-review-presentation.mjs'
let checks=0;const check=(name,v)=>{assert.ok(v,name);console.log('ok '+(++checks)+' - '+name)}
const context={currency:'CAD',technicianName:id=>'技师甲',referenceName:(key,id)=>'护理组'}
let d={module:'times',targetId:'p',base:{packages:[{id:'p',name:'五次卡',priceCents:20000,validDays:90}]},body:{priceCents:30000,validDays:180}}
let r=setupReviewRows(d,context);check('老板核对读到原次卡金额与新金额',r[0].before==='CAD 200.00'&&r[0].after==='CAD 300.00');check('有效期比较不丢旧值',r[1].before==='90'&&r[1].after==='180')
d={module:'recharge',targetId:'p',base:{packages:[{id:'p'}],previewResponses:{'/admin/member-pricing/packages/p':{rateBps:10000}}},body:{defaultPersonalDiscount:{expectedRevision:1,rateBps:8500}}};r=setupReviewRows(d,context);check('个人折扣核对无折扣与8.5折',r[0].before.includes('无折扣')&&r[0].after.includes('8.5折')&&!r[0].after.includes('expectedRevision'))
d={module:'settlement',targetId:'s',base:{items:[{id:'s'}],previewResponses:{'/admin/member-pricing/services/s/settlement':{prices:{list:{priceCents:10000}}}}},body:{priceSystemUpdate:{system:'settlement',expectedRevision:1,prices:{list:{priceCents:8000}}}}};r=setupReviewRows(d,context);check('独立结算价比较取实际旧价',r[0].before.includes('CAD 100.00')&&r[0].after.includes('CAD 80.00'))
d={module:'hours',base:{stores:[{hours:[{weekday:1,openTime:'09:00',closeTime:'18:00'}]}]},body:{hours:[{weekday:1,openTime:'10:00',closeTime:'17:00'}]}};r=setupReviewRows(d,context);check('营业时间读出星期及前后时间',r[0].before.includes('星期一')&&r[0].before.includes('09:00')&&r[0].after.includes('10:00'))
d={module:'salary',targetId:'plan',base:{plans:[{id:'plan',flatPct:10,technicianId:'t'}]},body:{flatPct:15,technicianId:'t'}};r=setupReviewRows(d,context);check('薪资仅展示真实变化',r.length===1&&r[0].before==='10%'&&r[0].after==='15%')
d={module:'guide',base:{config:{steps:[]}},body:{revision:0,steps:[{image:'data:image/png;base64,synthetic',description:'正门进入'}]}};r=setupReviewRows(d,context);check('图片只描述不输出编码与版本内部字段',r.length===1&&r[0].after.includes('已提供图片')&&!r[0].after.includes('base64')&&!r[0].after.includes('[object Object]'))
d={module:'priceTypes',base:{config:{membershipEnabled:false,settlementTypes:['list']}},body:{membershipEnabled:true,settlementTypes:['list','member'],expectedRevision:1}};r=setupReviewRows(d,context);check('会员制度核对使用中文开关说明',r[0].label==='启用会员制度'&&r[0].before==='关闭'&&r[0].after==='开启');check('价格类型核对展示价格名称不泄露字段名',r[1].label==='服务结算价格类型'&&r[1].after.includes('原价')&&r[1].after.includes('会员价')&&!r[1].after.includes('member'))

const {applyConfirmedDrafts,batchResultsHtml}=await import('../web/platform-setup-batch.mjs')
const applied=[],handed=[],progress=[],batch=await applyConfirmedDrafts({drafts:[{id:'ok',module:'quote',title:'报价规则'},{id:'blocked',module:'salary',needsOwnerConfirmation:true},{id:'conflict',module:'quote'},{id:'after',module:'accounts'}],apply:async d=>{applied.push(d.id);if(d.id==='conflict')throw Error('配置已变化');return d.id==='after'?{handoff:{username:'synthetic'}}:{}},handoff:async d=>handed.push(d),onProgress:(done,total)=>progress.push([done,total])})
check('批量逐份保留成功、待老板确认与失败结果',batch.map(r=>r.status).join(',')==='applied,blocked,failed,applied')
check('未获老板确认的项目不会调用应用接口',applied.join(',')==='ok,conflict,after')
check('一份版本冲突不会中断其他已确认草稿',batch[2].message==='配置已变化'&&batch[3].status==='applied')
check('账号应用成功后仍交付一次性凭据',handed.length===1&&handed[0].username==='synthetic')
check('进度计入每个已处理项而非仅成功项',JSON.stringify(progress)===JSON.stringify([[1,4],[2,4],[3,4],[4,4]]))
const resultHtml=batchResultsHtml([{id:'<x>',module:'quote',title:'<script>',status:'failed',message:'<img onerror=x>'}])
check('批次回执明确未应用数量并转义失败内容',resultHtml.includes('成功 0 项 · 未应用 1 项')&&!resultHtml.includes('<script>')&&!resultHtml.includes('<img onerror'))
