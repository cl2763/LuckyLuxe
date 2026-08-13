/* D39(🔴 换店串店)L5:选店页**实点**换店,双向 5 往返。
 * 每次换店后断言「我的」页头部字段 ≡ 当前店后端真相(demoLogin 同一选人逻辑):
 * 累计消费 / 积分 / 称谓(等级 or 会员)/ 余额 —— 全部不得是上一家店的数。
 * 前置:登录态先造成「lucky 身份」,再真点选店行切 jics(复现店主路径)。 */
import { connect, shot, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
async function truth(tenant) {
  const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tenant }, body: JSON.stringify({ demoLogin: true, tenantId: tenant }) }).then((r) => r.json());
  const u = d.user;
  return { spent: Math.round((u.totalSpentCents || 0) / 100), points: u.points || 0, level: u.membershipTiersEnabled === false ? '会员' : u.memberLevel, balance: Math.round((u.balanceCents || 0) / 100), name: u.displayName };
}
const mp = await connect();
const go = async (r, ms = 3000) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };

// 起点:真实登录流落 lucky 身份(与店主一致:先在 lucky 用)
{
  const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'lucky-luxe' }, body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe' }) }).then((r) => r.json());
  await mp.evaluate((a, uid) => {
    wx.setStorageSync('lucky_tenant', 'lucky-luxe');
    wx.setStorageSync('lucky_mini_auth', Object.assign({}, a, { tenantId: 'lucky-luxe' }));
    wx.setStorageSync('lucky_member', { id: uid });
    ['lucky_store_currency', 'lucky_store_deposit', 'lucky_store_ai', 'lucky_cart', 'lucky_orders', 'lucky_style_preset'].forEach((k) => wx.removeStorageSync(k));
  }, d.auth, d.user.id);
}

async function switchToByTap(nameKey) {
  const p = await go('/pages/shop-select/index', 3000);
  let hit = false;
  for (const el of (await p.$$('.shop')) || []) {
    const t = String(await el.text());
    if (t.includes(nameKey)) { await el.tap(); hit = true; break; }
  }
  A(hit, `选店页找不到「${nameKey}」`);
  await sleep(2200); // applyTenant → reLaunch home
}

async function assertMe(tenant, tag, doShot) {
  const want = await truth(tenant);
  const p = await go('/pages/me/index', 3500);
  const m = await p.data('member');
  const live = await p.data('liveBalance');
  const shownBal = live == null ? (m && m.balance) : Number(live);
  A(m && Number(m.totalSpent) === want.spent, `${tag} 累计消费 ${m && m.totalSpent} ≠ 本店 ${want.spent}(串店?)`);
  A(Number(m.points) === want.points, `${tag} 积分 ${m.points} ≠ 本店 ${want.points}`);
  A(String(m.tiersEnabled === false ? '会员' : m.memberLevel) === String(want.level), `${tag} 称谓 ${m.memberLevel}/${m.tiersEnabled} ≠ 本店 ${want.level}`);
  A(Number(shownBal) === want.balance, `${tag} 余额 ${shownBal} ≠ 本店 ${want.balance}`);
  if (doShot) await shot(mp, `d39-${tag}`);
  return `${tag}: 消费${want.spent}/分${want.points}/${want.level}/余${want.balance}`;
}

// 店名关键字:从 /shops 公开清单发现(不硬编码)
const shops = (await fetch(BASE + '/shops', { headers: { 'x-tenant-id': 'lucky-luxe' } }).then((r) => r.json()).catch(() => ({}))).shops
  || (await fetch(BASE + '/tenants/public').then((r) => r.json()).catch(() => ({}))).shops || [];
let jicsName = (shops.find((x) => x.tenantId === 'jics-nail') || {}).name || 'Jie';
let luckyName = (shops.find((x) => x.tenantId === 'lucky-luxe') || {}).name || 'Lucky';
console.log('选店关键字:', luckyName, '/', jicsName);

for (let i = 1; i <= 5; i += 1) {
  await switchToByTap(jicsName.slice(0, 4));
  console.log(`往 ${i}/5 ✓`, await assertMe('jics-nail', 'jics', i === 1));
  await switchToByTap(luckyName.slice(0, 4));
  console.log(`返 ${i}/5 ✓`, await assertMe('lucky-luxe', 'lucky', i === 1));
}
await mp.disconnect();
console.log('D39 换店往返 L5:双向 5/5 全绿(me 页字段 ≡ 当前店)');
