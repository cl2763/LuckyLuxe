import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { mountWebHtml } from './web-mount.mjs'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { intradaySeries } from './dashboard-intraday.mjs'
import { createPortfolioMedia, inlineMedia, portfolioImageUrl } from './portfolio-media.mjs'
import { createScheduleBoard } from './schedule-board.mjs'
import { pngSize } from './svg-raster.mjs'
let n=0
function check(name,fn) { fn(); console.log(`ok ${++n} - ${name}`) }
const scopeScript=readFileSync(new URL('../web/web-scope.js',import.meta.url),'utf8')
function webScope(pathname) { const context={window:{location:{pathname}}};vm.runInNewContext(scopeScript,context);return context.window.WebScope }
check('体验网页请求、导航保留隔离前缀且不重复拼接',()=>{const s=webScope('/experience/admin');assert.equal(s.path('/shops'),'/experience/shops');assert.equal(s.path('/experience/shops'),'/experience/shops');assert.equal(s.path('/sign/abc'),'/experience/sign/abc');assert.equal(s.path('/'),'/experience/')})
check('生产网页路径与外部图片地址不变',()=>{assert.equal(webScope('/admin').path('/shops'),'/shops');assert.equal(webScope('/experience/').path('https://external.test/a.png'),'https://external.test/a.png');assert.equal(webScope('/experience/').path('//external.test/a.png'),'//external.test/a.png');assert.equal(webScope('/experiences/').prefix,'')})
check('顾客与商家HTML全部同源根资源跟随体验服务，保留指纹',()=>{for(const name of ['index','admin','share']){const raw=readFileSync(new URL(`../web/${name}.html`,import.meta.url),'utf8');const scoped=mountWebHtml(raw,'https://example.test/experience');assert.ok(scoped.includes('src="/experience/web/web-scope.js"'));assert.ok(!/\b(?:href|src)=["']\/(?!\/|experience\/)/.test(scoped));assert.equal(mountWebHtml(raw,'https://example.test'),raw);assert.equal(mountWebHtml(scoped,'https://example.test/experience'),scoped)}})
check('体验网页列出三家演示店、生产列表保持不裁剪',()=>{const shops=['demo-ai','demo-basic','demo-empty','lucky-luxe'].map(tenantId=>({tenantId}));assert.equal(webScope('/experience/').shopsPath,'/shops?include=demo');assert.deepEqual(webScope('/experience/').filterShops(shops).map(s=>s.tenantId),shops.slice(0,3).map(s=>s.tenantId));assert.strictEqual(webScope('/').filterShops(shops),shops)})
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE finance_transactions(tenant_id,occurred_on,type,amount_cents,created_at,pay_channel);
CREATE TABLE stored_value_transactions(tenant_id,user_id,type,amount_cents,created_at);
CREATE TABLE member_timecards(tenant_id,user_id,price_cents,created_at);
CREATE TABLE bookings(id,tenant_id,status,appointment_start,arrived_at,gallery_status,approved_work_images_json);
CREATE TABLE tenant_settings(tenant_id,key,value,updated_at);
CREATE TABLE technicians(id,tenant_id);
CREATE TABLE staff_nudges(id PRIMARY KEY,tenant_id,technician_id,type,message,created_by,created_at,read_at);
INSERT INTO finance_transactions VALUES('A','2026-10-08','income',12800,'2026-10-08T14:15:00Z','cash'),('B','2026-10-08','income',999999,'2026-10-08T14:15:00Z','cash');
INSERT INTO bookings VALUES('b','A','CONFIRMED','2026-10-08T23:00:00Z',NULL,'approved','[]');
INSERT INTO tenant_settings VALUES('A','duty_enabled','1',''); INSERT INTO technicians VALUES('ta','A'),('tb','B');`)
const opts={db,tid:'A',today:'2026-10-08',timeZone:'America/Toronto',now:new Date('2026-10-08T20:00:00Z')}
let graph=intradaySeries(opts)
check('10:15门店记账落08–12；不混入另一门店',()=>assert.deepEqual(graph.revenue,[0,0,12800,0,0,null]))
check('未来收入未发生留空，已预约的未来时段仍显示',()=>{assert.equal(graph.revenue[5],null);assert.equal(graph.bookings[4],1)})
check('无到店事实不能把预约变成到店人次',()=>assert.equal(graph.visits.reduce((a,b)=>a+(b||0),0),0))
db.exec("INSERT INTO stored_value_transactions VALUES('A','u','recharge',100000,'2026-10-08T16:00:00Z'),('A','u','recharge',200000,'2026-10-08T17:00:00Z')")
graph=intradaySeries(opts)
check('重复充值只新增一位持卡人；充值不成为营业收入',()=>{assert.equal(graph.newCard[3],1);assert.equal(graph.cash[3],300000);assert.equal(graph.revenue[3],0)})
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="90" height="120"><rect width="90" height="120" fill="#bba066"/><text x="5" y="30">Demo</text></svg>'
const source='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')
const media=inlineMedia(source)
check('实际栅格化含文字SVG→可解码PNG',()=>{assert.equal(media?.type,'image/png');assert.equal(pngSize(media.bytes).width,900)})
check('图片缓存重复读取同一PNG，不反复栅格化',()=>assert.strictEqual(inlineMedia(source),media))
check('拒绝含外部引用SVG，不访问第三方或本机文件',()=>assert.equal(inlineMedia('data:image/svg+xml;base64,'+Buffer.from(svg.replace('<rect','<image href="file:///etc/passwd"/><rect')).toString('base64')),null))
db.prepare('UPDATE bookings SET approved_work_images_json=? WHERE id=?').run(JSON.stringify([source]),'b')
const imageHandler=createPortfolioMedia({db,resolveTenant:(_r,q)=>q.tenantId,parseJson:JSON.parse,apiError:(status,code)=>Object.assign(new Error(code),{status})})
let body,headers
const res={writeHead:(status,h)=>{assert.equal(status,200);headers=h},end:b=>body=b}
imageHandler({method:'GET'},res,{path:'/portfolio-image',query:{tenantId:'A',bookingId:'b',index:'0'}})
check('作品媒体HTTP响应PNG且不改原始图片',()=>{assert.equal(headers['Content-Type'],'image/png');assert.ok(pngSize(body));assert.equal(JSON.parse(db.prepare("SELECT approved_work_images_json FROM bookings WHERE id='b'").get().approved_work_images_json)[0],source)})
check('跨店作品媒体不可取',()=>assert.throws(()=>imageHandler({method:'GET'},res,{path:'/portfolio-image',query:{tenantId:'B',bookingId:'b',index:'0'}}),{status:404}))
check('异常索引不可取',()=>assert.throws(()=>imageHandler({method:'GET'},res,{path:'/portfolio-image',query:{tenantId:'A',bookingId:'b',index:'-1'}}),{status:400}))
db.exec("UPDATE bookings SET gallery_status='pending' WHERE id='b'")
check('撤下作品立即停止对外取图',()=>assert.throws(()=>imageHandler({method:'GET'},res,{path:'/portfolio-image',query:{tenantId:'A',bookingId:'b',index:'0'}}),{status:404}))
check('体验图片地址只含一次experience并携带对应门店',()=>{const u=new URL(portfolioImageUrl(source,{base:'https://example.test/experience/',tenantId:'A',bookingId:'b',index:0}));assert.equal(u.pathname,'/experience/portfolio-image');assert.equal(u.searchParams.get('tenantId'),'A')})
const board=createScheduleBoard({db,currentTenantId:()=> 'A',localParts:()=>({date:'2026-10-08'}),iso:d=>d.toISOString(),json:()=>{},readBody:async r=>r.body,apiError:(status,code)=>Object.assign(new Error(code),{status})})
board.ensureSchema()
const route=(body,role='owner')=>board.route({method:'POST',body},{},{path:'/admin/duty/mark',query:{},adminSession:{role,email:'test-owner'}})
await route({date:'2026-10-08',technicianId:'ta',on:true})
check('安排值日与员工站内提醒同步落库',()=>{assert.equal(db.prepare('SELECT COUNT(*) n FROM duty_marks').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM staff_nudges WHERE read_at IS NULL').get().n,1)})
await route({date:'2026-10-08',technicianId:'ta',on:true})
check('重复保存不重复通知',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM staff_nudges').get().n,1))
await assert.rejects(()=>route({date:'2026-10-08',technicianId:'tb',on:true}),{status:404});console.log(`ok ${++n} - 禁止跨店安排值日`)
await assert.rejects(()=>route({date:'2026-10-08',technicianId:'ta',on:true},'staff'),{status:403});console.log(`ok ${++n} - 员工不能代老板安排值日`)
await assert.rejects(()=>route({date:'2026-10-07',technicianId:'ta',on:true}),{status:400});console.log(`ok ${++n} - 历史日不可改写`)
await route({date:'2026-10-08',technicianId:'ta',on:false})
check('取消值日移除标识并撤销未读提醒',()=>{assert.equal(db.prepare('SELECT COUNT(*) n FROM duty_marks').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM staff_nudges WHERE read_at IS NULL').get().n,0)})
db.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON staff_nudges BEGIN SELECT RAISE(ABORT,'test failure'); END")
await assert.rejects(()=>route({date:'2026-10-08',technicianId:'ta',on:true}));
check('通知写入失败时值日回滚，不虚报成功',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM duty_marks').get().n,0))
console.log(`PASS ${n} behavior checks`)
db.close()
