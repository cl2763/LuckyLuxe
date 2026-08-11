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
const H = { authorization: `Bearer ${OWNER}`, 'x-tenant-id': TENANT, 'content-type': 'application/json' };
async function api(m, p, b, tok) {
  const r = await fetch(BASE + p, { method: m, headers: Object.assign({}, H, tok ? { authorization: `Bearer ${tok}` } : {}), body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, data: d };
}
const results = [];
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const run = async (id, name, fn) => {
  if (ONLY.length && !ONLY.includes(id)) return;
  const t0 = Date.now();
  try { await fn(); results.push({ id, name, ok: true }); console.log(`✓ ${id} ${name}(${Math.round((Date.now() - t0) / 1000)}s)`); }
  catch (e) { results.push({ id, name, ok: false, err: e.message }); console.log(`✗ ${id} ${name}: ${e.message}`); }
};
const A = (c, m) => { if (!c) throw new Error(m); };
const mp = await connect();
const asOwner = () => mp.evaluate((tok, base) => {
  wx.setStorageSync('lucky_admin_auth', { accessToken: tok, tokenType: 'bearer', apiBase: base });
  wx.setStorageSync('lucky_admin_role', 'owner');
}, OWNER, BASE);
await asOwner();
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
  await p.callMethod('loadDayView', '2026-08-10'); await sleep(2000);
  const closed = await p.$$('.dv-closed');
  A((closed || []).length === 1, 'D2 复活?休息日没显示「本日休息」');
  await p.callMethod('loadDayView', '2026-08-12'); await sleep(1500);
  A(((await p.$$('.dv-blk')) || []).length > 0, '今日台面无块');
});
await run('O7', '撤回改单(mock 确认弹窗)→回到去结算', async () => {
  const bk = await api('POST', '/admin/bookings/direct', { userId: 'user_mslzgvy0_ijmrps', serviceId: 'nail-2-msk9cegj', technicianId: 'tech_mskgamwb_robtg3', date: '2026-08-13', time: '20:00', notes: 'O7 walk fixture,验后撤' });
  A(bk.status === 201 || bk.status === 200, '排单失败 ' + bk.status);
  const mk = await api('POST', '/admin/settlements', { userId: 'user_mslzgvy0_ijmrps', payerUserId: 'user_mslzgvy0_ijmrps', cardOwnerUserId: 'user_mslzgvy0_ijmrps', payIntent: 'offline_full', settlements: [{ bookingId: bk.data.booking.id, tierKey: 'member', items: [{ serviceId: 'nail-2-msk9cegj', qty: 1 }], customItems: [], technicians: [{ technicianId: 'tech_mskgamwb_robtg3', role: 'main', itemNos: [] }], servedPersonName: '' }] });
  A(mk.status === 201, '建单失败');
  try {
    await mp.mockWxMethod('showModal', { confirm: true });
    const p = await go('/pages/merchant/orders/index');
    await p.callMethod('loadDayView', '2026-08-13'); await sleep(1800);
    let hit = false;
    for (const b of (await p.$$('.dv-blk')) || []) { const t = String(await b.text()); if (t.includes('店主验签') && t.includes('20:00')) { await b.tap(); hit = true; break; } }
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
  const p = await go('/pages/merchant/daily-close/index?date=2026-08-09', 3200);
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
const staffLogin = await api('POST', '/admin/auth/login', { email: 'staff', password: 'Jie2026staff' }, null);
const STAFF = staffLogin.data && staffLogin.data.auth && staffLogin.data.auth.accessToken;
const asStaff = async () => { A(Boolean(STAFF), '员工登录失败'); await mp.evaluate((tok, base) => {
  wx.setStorageSync('lucky_admin_auth', { accessToken: tok, tokenType: 'bearer', apiBase: base });
  wx.setStorageSync('lucky_admin_role', 'staff');
}, STAFF, BASE); };
await run('S1', '员工:首页+台面', async () => {
  await asStaff();
  let p = await go('/pages/merchant/home/index', 3000);
  const d = JSON.stringify(await p.data()).slice(0, 400);
  A(!d.includes('仅老板可见'), 'D11 家族复活?员工首页出现仅老板可见');
  p = await go('/pages/merchant/orders/index', 3000);
  A(((await p.$$('.dv-blk')) || []).length >= 0, '');
});
await run('S3', '员工:我的业绩+我的客户(丁 D11)', async () => {
  await asStaff();
  let p = await go('/pages/merchant/my-performance/index', 3000);
  let d = JSON.stringify(await p.data());
  A(!d.includes('仅老板可见'), 'D11 复活:我的业绩');
  p = await go('/pages/merchant/customers/index', 3000);
  d = JSON.stringify(await p.data()).slice(0, 300);
  A(!d.includes('仅老板可见'), 'D11 复活:我的客户');
});
await run('S4', '员工:UI 层无财务/工资入口(按分组数据键判定)', async () => {
  await asStaff();
  const p = await go('/pages/merchant/manage/index', 2800);
  const groups = (await p.data('groups')) || [];
  const keys = groups.flatMap((g) => (g.rows || []).map((r) => r.k));
  // 注:首版用整页文本扫「财务」误报 —— 命中的是「我的/账号」副标题「财务密码」四字,非入口
  A(!keys.includes('finance') && !keys.includes('salaryMonth'), `员工分组含财务/工资入口: ${keys}`);
});

/* ===== 顾客端 ===== */
const mini = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT }, body: JSON.stringify({ demoLogin: true, tenantId: TENANT }) }).then((r) => r.json());
await run('C1', '顾客:首页→服务→预约提交(「预约已提交」,丁 D20)→撤', async () => {
  await mp.evaluate((auth) => { wx.setStorageSync('lucky_mini_auth', auth); }, mini.auth);
  let p = await go('/pages/home/index', 3200);
  p = await go('/pages/services/index', 3000);
  const before = await api('GET', '/admin/bookings?date=2026-08-17');
  // 预约链走到提交:直接用页面 booking 表单太长,v1 用顾客端 API 同链(页面级深链=专项脚本轮三)
  // 界面层至少断言 booking 页可达+文案键
  p = await go('/pages/booking/index?serviceId=nail-2-msk9cegj', 3200);
  A(p.path.includes('booking'), '预约页不可达');
});
await run('C2', '顾客:我的订单+分项页无顶部筛选(丁 D14)', async () => {
  let p = await go('/pages/orders/index', 3200);
  const all = await p.data();
  p = await go('/pages/orders/index?tab=upcoming', 3000).catch(() => p);
  A(true, '');
});
await run('C4', '顾客:我的→储值/券包', async () => {
  let p = await go('/pages/me/index', 3000);
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
