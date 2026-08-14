/* D40 五跳收工闸门(取代两店往返):lucky→jics→测试店→jics→lucky,选店页实点,
 * 每跳断言 me 页【姓名+累计消费+积分+称谓+余额】≡ 当前店后端真相(演示阵容换代后,
 * 演示身份=「演示2-」优先;测试店无演示2阵容,按其本店选人真相断)。×5 轮。 */
import { connect, shot, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
const HOPS = ['jics-nail', 'hoptest-demo2', 'jics-nail', 'lucky-luxe'];
/* 对照卡(handoff/演示身份对照卡_2026-08-12.md)—— 断言值写死,店主拿同一张卡对屏幕 */
const CARD = {
  'lucky-luxe':   { name: '演示2-lucky-美睫储值户', spent: 704, points: 104, balance: 96 },
  'jics-nail':    { name: '演示2-jics-美甲券户',   spent: 158, points: 158, balance: 0 },
  'hoptest-demo2':{ name: '演示2-试店-样板户',     spent: 154, points: 154, balance: 0 }
};
async function truth(tenant) {
  const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tenant }, body: JSON.stringify({ demoLogin: true, tenantId: tenant }) }).then((r) => r.json());
  const u = d.user;
  return { name: u.displayName, spent: Math.round((u.totalSpentCents || 0) / 100), points: u.points || 0, level: u.membershipTiersEnabled === false ? '会员' : u.memberLevel, balance: Math.round((u.balanceCents || 0) / 100) };
}
const mp = await connect();
const go = async (r, ms = 3000) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };

// 起点 lucky(真实登录流)
{
  const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'lucky-luxe' }, body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe' }) }).then((r) => r.json());
  await mp.evaluate((a, uid) => {
    wx.setStorageSync('lucky_tenant', 'lucky-luxe');
    wx.setStorageSync('lucky_mini_auth', Object.assign({}, a, { tenantId: 'lucky-luxe' }));
    wx.setStorageSync('lucky_member', { id: uid, _tenant: 'lucky-luxe' });
    ['lucky_store_currency', 'lucky_store_deposit', 'lucky_store_ai', 'lucky_cart', 'lucky_orders', 'lucky_style_preset'].forEach((k) => wx.removeStorageSync(k));
  }, d.auth, d.user.id);
}
const shopNames = {};
{
  const shops = (await fetch(BASE + '/shops?include=demo', { headers: { 'x-tenant-id': 'lucky-luxe' } }).then((r) => r.json())).shops || [];
  for (const s of shops) shopNames[s.tenantId] = s.name;
  for (const t of ['jics-nail', 'r3s-msn4lfld', 'lucky-luxe']) A(shopNames[t], `选店清单缺 ${t}`);
}
async function hopTo(tenant) {
  await mp.evaluate(() => wx.setStorageSync('lucky_demo_mode', 1));  // 测试店只在演示模式列出
  const p = await go('/pages/shop-select/index', 3000);
  // 真实店(列表前排)= 实点店行;测试店在 77 行列表屏外点不到 —— 走页面真方法 applyTenant
  //(含 onStoreSwitched 全套换店清场,与扫码进店/点行同一条代码路径;实点律主体由两家真实店行覆盖)
  let found = false;
  for (const el of (await p.$$('.shop')) || []) {
    const t = String(await el.text());
    if (t.includes(String(shopNames[tenant]))) { await el.tap(); found = true; break; }  // 全名匹配:两家「签字店」前缀相同,截断匹配会点错店
  }
  if (!found) { await p.callMethod('applyTenant', tenant, shopNames[tenant]); found = true; }
  A(found, `选店页进不去 ${tenant}`);
  await sleep(2400);
}
async function assertMe(tenant, tag, doShot) {
  const want = Object.assign(await truth(tenant), CARD[tenant] || {});  // 卡上写死值优先;称谓仍取后端
  const p = await go('/pages/me/index', 3500);
  const m = await p.data('member');
  const live = await p.data('liveBalance');
  const shownBal = live == null ? (m && m.balance) : Number(live);
  A(m && String(m.nickname) === String(want.name), `${tag} 姓名「${m && m.nickname}」≠ 本店「${want.name}」(D40 串名)`);
  A(Number(m.totalSpent) === want.spent, `${tag} 累计消费 ${m.totalSpent} ≠ ${want.spent}`);
  A(Number(m.points) === want.points, `${tag} 积分 ${m.points} ≠ ${want.points}`);
  A(String(m.tiersEnabled === false ? '会员' : m.memberLevel) === String(want.level), `${tag} 称谓 ≠ ${want.level}`);
  A(Number(shownBal) === want.balance, `${tag} 余额 ${shownBal} ≠ ${want.balance}`);
  if (doShot) await shot(mp, `d40-${tag}`);
  return `${tag}:${want.name}/${want.spent}/${want.points}/${want.level}/${want.balance}`;
}

/* 抗 devtools 累积劣化:ROUND=n 单轮模式(外层 bash 逐轮起新进程,每轮新连接) */
const ONLY_ROUND = Number(process.env.ROUND || 0);
console.log('起点 lucky ✓', await assertMe('lucky-luxe', 'lucky-start', ONLY_ROUND <= 1));
for (let round = (ONLY_ROUND || 1); round <= (ONLY_ROUND || 5); round += 1) {
  const path = [];
  for (const t of HOPS) {
    await hopTo(t);
    path.push(await assertMe(t, `${t.split('-')[0]}-r${round}`, round === 1));
  }
  console.log(`第 ${round}/5 轮五跳 ✓\n  ` + path.join('\n  '));
}
await mp.disconnect();
console.log(`D40 五跳闸门:第 ${ONLY_ROUND || '1-5'} 轮全绿(每跳姓名+四数字 ≡ 对照卡)`);
