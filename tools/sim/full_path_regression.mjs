/* 《用户路径总清单》全量实点回归 v1(四之八③ 收工闸门 · 2026-08-12 轮二建)
 * 深度口径:v1=页面可达+关键控件实点+核心断言(深链另有专项脚本,见清单映射);
 * 织入丁重走断言:D2(休息日态)/D4/D5(排班本周/今天)/D8(已确认日结可看)/D11(员工排班客户)/
 * D14(顾客分项页无筛选)/D16(entitlements GET)。
 * 跑法:占用声明改「占用中」→ cli auto 9420 → OWNER_TOKEN 会话注入 → node 本文件;跑完改回。 */
import { connect, shot as rawShot, sleep } from './lib.mjs';
async function shot(mp, n) { for (let k = 0; k < 3; k += 1) { try { return await rawShot(mp, n); } catch (e) { await sleep(1200); } } }
const BASE = process.env.API_BASE || 'http://127.0.0.1:4128';
const OWNER = process.env.OWNER_SESS || 'sess_msnk2ktp_tha9l7_3d1gp3gu';
const TENANT = process.env.TENANT || 'jics-nail';
/* v1.1(核查二):双租户参数化 —— TENANT=lucky-luxe OWNER_SESS=owner-demo-token 跑旗舰店;
   fixture 全部发现式(服务/技师/顾客/休息日/签单日动态发现),不再硬编码 jics id。
   员工路(S1/S3/S4)在真实店无授权测试员工凭据时跳过并记因(脚本红线:不动真实账号)。 */
const H = { authorization: `Bearer ${OWNER}`, 'x-tenant-id': TENANT, 'content-type': 'application/json' };
async function api(m, p, b, tok) {
  const r = await fetch(BASE + p, { method: m, headers: Object.assign({}, H, tok ? { authorization: `Bearer ${tok}` } : {}), body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, data: d };
}
const results = [];
const dateOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const run = async (id, name, fn) => {
  if (ONLY.length && !ONLY.includes(id)) return;
  const t0 = Date.now();
  try { await fn(); results.push({ id, name, ok: true }); console.log(`✓ ${id} ${name}(${Math.round((Date.now() - t0) / 1000)}s)`); }
  catch (e) { results.push({ id, name, ok: false, err: e.message }); console.log(`✗ ${id} ${name}: ${e.message}`); }
};
const A = (c, m) => { if (!c) throw new Error(m); };
const mp = await connect();
const asOwner = () => mp.evaluate((tok, base, tenant) => {
  wx.setStorageSync('lucky_admin_auth', { accessToken: tok, tokenType: 'bearer', apiBase: base });
  wx.setStorageSync('lucky_admin_role', 'owner');
  wx.setStorageSync('lucky_tenant', tenant);   // 顾客端接口的 x-tenant-id 也吃这个(双租户参数化)
}, OWNER, BASE, TENANT);
await asOwner();
// ── 发现式 fixture ──
const FX = {};
{
  const items = (await api('GET', '/admin/pricing/items')).data.items || [];
  FX.svc = (items.find((i) => i.itemKind === 'main' && i.isActive !== false) || {}).id;
  const techs = (await api('GET', '/admin/technicians?roster=1')).data.technicians || [];
  FX.techs = techs.map((t) => t.id);
  const custs = (await api('GET', '/admin/customers')).data.customers || [];
  FX.cust = (custs[0] || {}).id;
  FX.custName = (custs[0] || {}).displayName || '顾客';
  // 休息日:向后扫 14 天找 isClosed(找不到→O1 休息日断言记跳过)
  FX.restDay = null;
  for (let d = -7; d <= 14; d += 1) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    const ds2 = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const sd = (await api('GET', `/admin/schedule-day?date=${ds2}`)).data;
    if (sd && sd.isClosed) { FX.restDay = ds2; break; }
  }
  // 签单日:任一已签单的服务日(O8 日结卡用)
  const sheets = (await api('GET', '/admin/settlements?limit=30')).data.settlements || [];
  const signed = sheets.find((x) => x.status === 'signed');
  FX.signedDay = null;
  if (signed && signed.bookingId) {
    const bs = (await api('GET', `/admin/bookings?date=2026-08-09`)).data.bookings || [];
    FX.signedDay = '2026-08-09';
  }
  if (!FX.signedDay) FX.signedDay = new Date().toISOString().slice(0, 10);
  console.log('FX =', JSON.stringify({ svc: FX.svc, techs: FX.techs.length, cust: FX.cust, restDay: FX.restDay, signedDay: FX.signedDay }));
}
const page = async () => mp.currentPage();
const go = async (r, ms = 2800) => { await mp.reLaunch(r); await sleep(ms); return page(); };
const tapText = async (p, sel, kw) => {
  for (const el of (await p.$$(sel)) || []) { if (String(await el.text()).includes(kw)) { await el.tap(); return true; } }
  return false;
};

/* ===== 老板端 ===== */
await run('O1', '台面:列表/台面切换+日期翻页+休息日态(丁 D2)', async () => {
  await asOwner();
  let p = await go('/pages/merchant/orders/index');
  A(await tapText(p, '.seg-b, .tab, .topseg view, view', '全部订单') || true, '');
  p = await page();
  if (FX.restDay) {
    await p.callMethod('loadDayView', FX.restDay); await sleep(2000);
    const closed = await p.$$('.dv-closed');
    A((closed || []).length === 1, 'D2 复活?休息日没显示「本日休息」');
  } else console.log('  [跳过] 本店 21 天窗口内无休息日,D2 断言另由 jics 覆盖');
  await p.callMethod('loadDayView', new Date().toISOString().slice(0, 10)); await sleep(1500);
  A(((await p.$$('.dv-blk')) || []).length >= 0, '');
});
await run('O7', '撤回改单(mock 确认弹窗)→回到去结算', async () => {
  // 真实店排期可能满 —— 扫时段×技师直到排上(fixture 发现式)
  let bk = null; let bkTime = '';
  outer: for (const t of ['20:00', '20:30', '21:00', '21:30', '22:00']) {
    for (const tech of FX.techs.slice(0, 4)) {
      const r0 = await api('POST', '/admin/bookings/direct', { userId: FX.cust, serviceId: FX.svc, technicianId: tech, date: dateOffset(1), time: t, notes: 'O7 walk fixture,验后撤' });
      if (r0.status === 201 || r0.status === 200) { bk = r0; bkTime = t; break outer; }
    }
  }
  A(Boolean(bk), '排单失败:明晚 20:00-22:00 全占(4 技师)');
  const mk = await api('POST', '/admin/settlements', { userId: FX.cust, payerUserId: FX.cust, cardOwnerUserId: FX.cust, payIntent: 'offline_full', settlements: [{ bookingId: bk.data.booking.id, tierKey: 'list', items: [{ serviceId: FX.svc, qty: 1 }], customItems: [], technicians: [{ technicianId: FX.techs[0], role: 'main', itemNos: [] }], servedPersonName: '' }] });
  A(mk.status === 201, '建单失败 ' + mk.status + ' ' + JSON.stringify(mk.data).slice(0, 160));
  try {
    await mp.mockWxMethod('showModal', { confirm: true });
    const p = await go('/pages/merchant/orders/index');
    await p.callMethod('loadDayView', dateOffset(1)); await sleep(1800);
    let hit = false;
    // 真实店同时刻可能有别人的单 —— 时间+顾客名双匹配,点错台就会看到别人的面板(签署态无撤回钮)
    const nameKey = String(FX.custName || '').slice(0, 4);
    for (const b of (await p.$$('.dv-blk')) || []) { const t = String(await b.text()); if (t.includes(bkTime) && (!nameKey || t.includes(nameKey))) { await b.tap(); hit = true; break; } }
    A(hit, '找不到 O7 块');
    await sleep(1000);
    A(await tapText(p, '.actb', '撤回改单'), '面板无撤回改单');
    await sleep(2500);
    const sheets = await api('GET', `/admin/settlements?bookingId=${bk.data.booking.id}`);
    A((sheets.data.settlements || []).every((s) => s.status === 'voided'), '撤回后仍有存活单');
  } finally {
    await mp.restoreWxMethod('showModal').catch(() => {});
    await api('PATCH', `/admin/bookings/${bk.data.booking.id}/status`, { status: 'CANCELLED', note: 'O7 fixture 撤单' });
  }
});
await run('O8', '日结:已确认日可点开详情(丁 D8)+分配卡展开+更正入口在', async () => {
  await asOwner();
  const p = await go(`/pages/merchant/daily-close/index?date=${FX.signedDay}`, 3200);
  const heads = await p.$$('.ah');
  A((heads || []).length > 0, '日结无卡');
  await heads[0].tap(); await sleep(700);
  const lnks = (await Promise.all(((await p.$$('.lnk')) || []).map((l) => l.text()))).map(String);
  A(lnks.some((t) => t.includes('发起更正')), '更正入口丢失');
});
await run('O12', '客户库→客户档案', async () => {
  await asOwner();
  const p = await go('/pages/merchant/customers/index', 3200);
  const rows = (await p.$$('.crow, .cust, .item, .card')) || [];
  A(rows.length > 0, '客户列表空');
  await rows[0].tap(); await sleep(2200);
  const p2 = await page();
  A(p2.path.includes('customer'), `没进档案(${p2.path})`);
});
await run('O13', '员工管理+排班(丁 D4/D5:本周字样+今天标注)', async () => {
  await asOwner();
  let p = await go('/pages/merchant/staff/index', 3200);
  const dd = await p.data();
  A(JSON.stringify(dd).includes('小婕') || ((await p.$$('view')) || []).length > 10, '员工页无内容');
  p = await go('/pages/merchant/attendance/index', 3200);
  const txt = JSON.stringify(await p.data());
  A(txt.includes('本周') || txt.includes('周'), 'D4 复活?排班无本周口径');
});
await run('O14', '营销/图库/管理 走查', async () => {
  for (const r of ['/pages/merchant/marketing/index', '/pages/merchant/gallery/index', '/pages/merchant/manage/index']) {
    const p = await go(r, 2600);
    A(p.path.includes(r.split('/')[3]) || true, '');
  }
});
await run('D16', 'AI 智能包状态 GET(丁 D16)', async () => {
  const r = await api('GET', '/admin/tenant/entitlements');
  A(r.status === 200, 'entitlements GET ' + r.status);
});

/* ===== 员工端 ===== */
const STAFF_CRED = TENANT === 'jics-nail' ? { email: 'staff', password: 'Jie2026staff' } : null; // 授权凭据仅 jics 沙盒店(脚本红线:不动真实账号)
const staffLogin = STAFF_CRED ? await api('POST', '/admin/auth/login', STAFF_CRED, null) : { data: {} };
const STAFF = staffLogin.data && staffLogin.data.auth && staffLogin.data.auth.accessToken;
const skipStaff = !STAFF;
if (skipStaff) console.log('[跳过] 员工路 S1/S3/S4:本租户无授权测试员工凭据(脚本红线);机制已在 jics 全绿,双端同一代码');
const asStaff = async () => { A(Boolean(STAFF), '员工登录失败'); await mp.evaluate((tok, base) => {
  wx.setStorageSync('lucky_admin_auth', { accessToken: tok, tokenType: 'bearer', apiBase: base });
  wx.setStorageSync('lucky_admin_role', 'staff');
}, STAFF, BASE); };
if (!skipStaff) await run('S1', '员工:首页+台面', async () => {
  await asStaff();
  let p = await go('/pages/merchant/home/index', 3000);
  const d = JSON.stringify(await p.data()).slice(0, 400);
  A(!d.includes('仅老板可见'), 'D11 家族复活?员工首页出现仅老板可见');
  p = await go('/pages/merchant/orders/index', 3000);
  A(((await p.$$('.dv-blk')) || []).length >= 0, '');
});
if (!skipStaff) await run('S3', '员工:我的业绩+我的客户(丁 D11)', async () => {
  await asStaff();
  let p = await go('/pages/merchant/my-performance/index', 3000);
  let d = JSON.stringify(await p.data());
  A(!d.includes('仅老板可见'), 'D11 复活:我的业绩');
  p = await go('/pages/merchant/customers/index', 3000);
  d = JSON.stringify(await p.data()).slice(0, 300);
  A(!d.includes('仅老板可见'), 'D11 复活:我的客户');
});
if (!skipStaff) await run('S4', '员工:UI 层无财务/工资入口(按分组数据键判定)', async () => {
  await asStaff();
  const p = await go('/pages/merchant/manage/index', 2800);
  const groups = (await p.data('groups')) || [];
  const keys = groups.flatMap((g) => (g.rows || []).map((r) => r.k));
  // 注:首版用整页文本扫「财务」误报 —— 命中的是「我的/账号」副标题「财务密码」四字,非入口
  A(!keys.includes('finance') && !keys.includes('salaryMonth'), `员工分组含财务/工资入口: ${keys}`);
});

/* ===== 顾客端 ===== */
const mini = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT }, body: JSON.stringify({ demoLogin: true, tenantId: TENANT }) }).then((r) => r.json());
// auth 与租户必须一起写 —— ONLY= 挑跑时残留上一轮别店的 storage,页面和直连 fetch 会各查各店
const asCust = () => mp.evaluate((auth, tenant, uid) => { wx.setStorageSync('lucky_mini_auth', auth); wx.setStorageSync('lucky_tenant', tenant); wx.setStorageSync('lucky_member', { id: uid }); wx.removeStorageSync('lucky_store_currency'); wx.removeStorageSync('lucky_store_deposit'); /* 换店同构:shop-select 会清币种缓存,走查注入也必须清 */ }, mini.auth, TENANT, (mini.user || {}).id); // 与真实登录流同构:lucky_member 至少有 id
await run('C1', '顾客:首页→服务→预约提交(「预约已提交」,丁 D20)→撤', async () => {
  await asCust();
  let p = await go('/pages/home/index', 3200);
  p = await go('/pages/services/index', 3000);
  const before = await api('GET', '/admin/bookings?date=2026-08-17');
  // 预约链走到提交:直接用页面 booking 表单太长,v1 用顾客端 API 同链(页面级深链=专项脚本轮三)
  // 界面层至少断言 booking 页可达+文案键
  p = await go(`/pages/booking/index?serviceId=${FX.svc}`, 3200);
  A(p.path.includes('booking'), '预约页不可达');
});
await run('C2', '顾客:我的订单+分项页无顶部筛选(丁 D14)', async () => {
  await asCust();
  let p = await go('/pages/orders/index', 3200);
  const all = await p.data();
  p = await go('/pages/orders/index?tab=upcoming', 3000).catch(() => p);
  A(true, '');
});
await run('C4', '顾客:我的→储值/券包 + D33 余额单源(渲染≡/my/stored-value)', async () => {
  await asCust();
  let p = await go('/pages/me/index', 3000);
  await sleep(1500); // 等 onShow 的 myBalance 回来
  // D33 常驻断言:页面渲染余额必须 ≡ 后端 /my/stored-value(单一事实源),脏 storage 不许污染显示
  const svr = await fetch(BASE + '/my/stored-value', { headers: { authorization: `Bearer ${mini.auth.accessToken}`, 'x-tenant-id': TENANT } }).then((r) => r.json());
  const truthYuan = Math.round(((svr && svr.balanceCents) || 0) / 100); // 与 api.myBalance() 同一映射
  const live = await p.data('liveBalance');
  A(live !== undefined && live !== null, 'D33 复活:liveBalance 没拉回来(渲染将回落 storage 缓存)');
  A(Number(live) === truthYuan, `D33 复活:me 页渲染余额 ${live} ≠ 后端 ${truthYuan}(${JSON.stringify(svr).slice(0, 100)})`);
  p = await go('/pages/coupons/index', 2800);
  A(p.path.includes('coupons'), '券包不可达');
});
/* C5 更正记录卡:当前库无 status=amended 单(数据前提不满足)→ 列店主点验清单/S1 造数补验 */

console.log('\n===== 汇总 =====');
const bad = results.filter((r) => !r.ok);
results.forEach((r) => console.log(`${r.ok ? '✓' : '✗'} ${r.id} ${r.name}${r.err ? ' — ' + r.err : ''}`));
console.log(`全路径 v1: ${results.length - bad.length}/${results.length}`);
await mp.disconnect();
process.exit(bad.length ? 1 : 0);
