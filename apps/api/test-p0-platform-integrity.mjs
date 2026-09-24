// 平台网页兜底：选中店写入、AI 三处同值、配置接口与实际数据。
// 只启动自有临时库/端口；夹具经业务接口创建，SQL 只读核验。
import { mkdtempSync, rmSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
const dir = mkdtempSync(join(tmpdir(), 'll-ci-data.p0-platform-'))
const port = Number(process.env.P0_PLATFORM_TEST_PORT || 4337)
const base = `http://127.0.0.1:${port}`
const owner = 'p0-platform-owner-test-only'
const log = openSync(join(dir, 'server.log'), 'w')
const child = spawn(process.execPath, ['local-server.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', log, log],
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, OWNER_TOKEN: owner,
    WECHAT_MINI_TOKEN_SECRET: 'p0-platform-mini-test-only', NOTIFY_TICK: 'off', TEST_DB_PATH: '', COS_BUCKET: '',
    ONLINE_PAYMENT_READY: 'true' } }) // 即使旧变量误开，也不能把占位支付当真实通道。
let db, count = 0
const failures = []
function check(label, ok, detail = '') { count++; console.log(`${ok ? 'ok' : 'not ok'} ${count} - ${label}${!ok ? ' :: '+detail : ''}`); if (!ok) failures.push(label) }
async function req(path, { token = owner, tid, method = 'GET', body } = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(tid ? { 'x-tenant-id': tid } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
try {
  let ready = false
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) break; try { ready = (await req('/health')).status === 200 } catch {} if (ready) break; await new Promise(r => setTimeout(r, 100)) }
  if (!ready) throw new Error(`隔离服务未启动；日志 ${dir}/server.log`)
  db = new DatabaseSync(join(dir, 'lucky-luxe.sqlite'), { readOnly: true })
  const shops = ['plat-a','plat-b','plat-expired']
  for(const tid of shops){
    const result=await req('/platform/tenants',{method:'POST',body:{id:tid,name:tid,plan:tid==='plat-a'?'chain':'single',timezone:'Asia/Shanghai',currency:'CNY'}})
    check('创建隔离店 '+tid,result.status===201,JSON.stringify(result.data).slice(0,150))
  }
  const beforeB=JSON.stringify(db.prepare('SELECT * FROM stores WHERE tenant_id=?').all('plat-b'))
  const fallbackBefore=JSON.stringify(db.prepare('SELECT * FROM stores WHERE tenant_id=?').all('lucky-luxe'))
  const renamed=await req('/admin/store-info',{tid:'plat-a',method:'PUT',body:{name:'平台甲店新名字',address:'上海验收地址',phone:'01012345678'}})
  check('主令牌携 x-tenant-id 修改所选店',renamed.status===200&&db.prepare('SELECT name FROM stores WHERE tenant_id=?').get('plat-a').name==='平台甲店新名字',JSON.stringify(renamed))
  check('改甲店不影响乙店或默认店',beforeB===JSON.stringify(db.prepare('SELECT * FROM stores WHERE tenant_id=?').all('plat-b'))&&fallbackBefore===JSON.stringify(db.prepare('SELECT * FROM stores WHERE tenant_id=?').all('lucky-luxe')))
  const invalid=await req('/admin/store-info',{tid:'missing-tenant',method:'PUT',body:{name:'不应写入'}})
  check('无效目标明确400且默认店不动',invalid.status===400&&fallbackBefore===JSON.stringify(db.prepare('SELECT * FROM stores WHERE tenant_id=?').all('lucky-luxe')))
  const pair = async tid => {
    const m=(await req('/platform/tenants')).data.tenants.find(t=>t.id===tid)
    const b=(await req('/platform/billing')).data.tenants.find(t=>t.id===tid)
    const e=(await req('/admin/tenant/entitlements',{tid})).data.entitlements
    return {m,b,e}
  }
  let views=await pair('plat-a')
  check('平台列表与计费使用新门店名',views.m.name==='平台甲店新名字'&&views.b.name==='平台甲店新名字')
  check('套餐含AI：两页和真实权限初始一致',views.m.aiEnabled===true&&views.b.ai.enabled===true&&views.e.features.ai_customer_service.enabled===true)
  const beforeOverrides=db.prepare("SELECT COUNT(*) n FROM tenant_settings WHERE key='ai_manual_override'").get().n
  check('读取不自动改变店铺开关',beforeOverrides===0)
  for (const enabled of [false,true,false,true]) {
    const changed=await req('/platform/tenants/plat-a/ai-addon',{method:'POST',body:{action:'set_enabled',enabled,reason:'验收开关'}})
    views=await pair('plat-a')
    check('套餐含AI也可手动'+(enabled?'开':'关'),changed.status===200&&views.m.aiEnabled===enabled&&views.b.ai.enabled===enabled&&views.e.features.ai_customer_service.enabled===enabled)
    check('管理页与计费页状态逐字相同',views.m.aiLabel===views.b.ai.label)
    const gate=await req('/admin/ai/booking-summary',{tid:'plat-a',method:'POST',body:{bookingId:'intentionally-missing'}})
    check('运行时闸门实际'+(enabled?'放行至业务校验':'拒绝'),enabled?gate.status===404&&gate.data.error.code==='NOT_FOUND':gate.status===403&&gate.data.error.code==='AI_ADDON_REQUIRED',JSON.stringify(gate))
  }
  check('四次开关有四条追加留痕',db.prepare("SELECT COUNT(*) n FROM platform_ops_log WHERE tenant_id='plat-a' AND action='ai_manual_override'").get().n===4)
  const denied=await req('/platform/tenants/plat-a/ai-addon',{method:'POST',body:{action:'set_enabled',enabled:false}})
  check('缺原因不修改开关',denied.status===400&&(await pair('plat-a')).m.aiEnabled===true)
  await req('/platform/tenants/plat-b/ai-addon',{method:'POST',body:{action:'extend',period:'unlimited'}})
  views=await pair('plat-b')
  check('长期开通不再被显示未开通',views.m.aiEnabled===true&&views.b.ai.source==='unlimited'&&views.m.aiLabel===views.b.ai.label)
  await req('/admin/tenant/entitlements',{tid:'plat-expired',method:'PUT',body:{feature:'ai_customer_service',enabled:true,expiresAt:'2020-01-01T00:00:00.000Z',note:'历史试用'}})
  views=await pair('plat-expired')
  check('过期试用两页均关闭且来源为expired',views.m.aiEnabled===false&&views.b.ai.enabled===false&&views.b.ai.source==='expired',JSON.stringify(views.b.ai))
  const kf=await req('/platform/tenants/plat-a/wecom-kfid',{method:'PUT',body:{openKfid:'kf-p0-a'}})
  const dup=await req('/platform/tenants/plat-b/wecom-kfid',{method:'PUT',body:{openKfid:'kf-p0-a'}})
  check('客服号保存读回、不能绑定两店',kf.status===200&&(await req('/platform/tenants/plat-a/wecom-kfid')).data.openKfid==='kf-p0-a'&&dup.status===409)
  const categories=(await req('/platform/tenants/plat-a/categories')).data.categories
  const payload={headers:['大类','项目名','价格','分享价','会员价','时长'],rows:[[categories[0].name,'导入验收项目','360','320','288','90']]}
  const before=db.prepare("SELECT COUNT(*) n FROM services WHERE tenant_id='plat-a'").get().n
  const preview=await req('/platform/tenants/plat-a/import/services',{method:'POST',body:{...payload,dryRun:true}})
  check('价目试跑通过但不写库',preview.status===200&&preview.data.report.blocked.length===0&&db.prepare("SELECT COUNT(*) n FROM services WHERE tenant_id='plat-a'").get().n===before,JSON.stringify(preview.data))
  for(const price of ['-12.50','abc','12.345']){
    const invalid=await req('/platform/tenants/plat-a/import/services',{method:'POST',body:{...payload,rows:[[categories[0].name,'不应导入',price,'','',90]],dryRun:true}})
    check('价目非法金额 '+price+' 明确阻断',invalid.data.report?.blocked?.some(r=>r.kind==='INVALID_MONEY')&&db.prepare("SELECT COUNT(*) n FROM services WHERE tenant_id='plat-a'").get().n===before,JSON.stringify(invalid.data))
  }
  const imported=await req('/platform/tenants/plat-a/import/services',{method:'POST',body:{...payload,dryRun:false}})
  check('确认后才导入本店，读回三档价格',imported.data.created===1&&db.prepare("SELECT COUNT(*) n FROM service_prices WHERE tenant_id='plat-a'").get().n===3,JSON.stringify(imported.data))
  check('乙店仍没有甲店导入项目',db.prepare("SELECT COUNT(*) n FROM services WHERE tenant_id='plat-b'").get().n===0)
} catch (error) { check('运行前置或流程异常', false, error.stack) }
finally { db?.close(); child.kill('SIGTERM'); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); closeSync(log); if (!failures.length) rmSync(dir, { recursive: true, force: true }); else console.log('失败现场保留：' + dir) }
console.log(`${count} checks; ${failures.length} failures`)
process.exitCode = failures.length ? 1 : 0
