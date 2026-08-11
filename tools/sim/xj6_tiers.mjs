/* 小件6:不分级会员店顾客端三减法 · L5 双租户实拍
 * A 支(jics,tiersEnabled=false):成长条不渲染 / 称谓只写「会员」/ 权益卡留空 —— ×5
 * B 支(lucky-luxe):临时开启分级(平台口径 PUT /admin/membership/config)→ 全保留 ×5 → 还原
 * 还原口径:lucky-luxe 原本无 membership_config 行(落默认);还原写回「与默认等值」的行并留痕。 */
import { connect, shot, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
async function login(tenant) {
  return fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tenant }, body: JSON.stringify({ demoLogin: true, tenantId: tenant }) }).then((r) => r.json());
}
async function putConfig(body) {
  const r = await fetch(BASE + '/admin/membership/config', { method: 'PUT', headers: { authorization: 'Bearer owner-demo-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const mp = await connect();
// 与真实登录流同构:auth 与 user 并列,lucky_member 至少要有 id(refreshMember 兜底链),否则页面落 mock
const asCust = (mini, tenant) => mp.evaluate((a, t, uid) => { wx.setStorageSync('lucky_mini_auth', a); wx.setStorageSync('lucky_tenant', t); wx.setStorageSync('lucky_member', { id: uid }); }, mini.auth, tenant, (mini.user || {}).id);
const go = async (r, ms = 3000) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };

async function checkBranch(tenant, mini, expectTiers, tag, doShot) {
  await asCust(mini, tenant);
  const p = await go('/pages/me/index', 3200);
  const growth = (await p.$$('.growth-block')) || [];
  const pillTexts = await Promise.all(((await p.$$('.level-pill text')) || []).map((t) => t.text()));
  const title = String(pillTexts[0] || '').trim();
  if (!expectTiers) {
    A(growth.length === 0, `${tag}: 成长条仍渲染(${growth.length})`);
    A(title === '会员' || title === 'Member', `${tag}: 称谓「${title}」≠「会员」`);
  } else {
    A(growth.length === 1, `${tag}: 分级店成长条丢失(${growth.length})`);
    A(title !== '会员' && title !== 'Member' && title.length > 0, `${tag}: 分级店称谓被降级成「${title}」`);
  }
  if (doShot) await shot(mp, `xj6-${tag}-me`);
  const p2 = await go('/pages/member-benefits/index', 3000);
  const cards = (await p2.$$('.level-card')) || [];
  if (!expectTiers) A(cards.length === 0, `${tag}: 权益卡没留空(${cards.length} 张)`);
  else A(cards.length > 0, `${tag}: 分级店权益卡空`);
  if (doShot) await shot(mp, `xj6-${tag}-benefits`);
  return { growth: growth.length, title, cards: cards.length };
}

/* ── A 支:jics 三减法 ×5 ── */
const jics = await login('jics-nail');
for (let i = 1; i <= 5; i += 1) {
  const r = await checkBranch('jics-nail', jics, false, 'jics', i === 1);
  console.log(`A${i}/5 jics 三减法 ✓`, JSON.stringify(r));
}

/* ── B 支:lucky-luxe 临时开分级 → 全保留 ×5 → 还原 ── */
const on = await putConfig({ tiersEnabled: true, tiers: [{ key: 'silver', label: '银卡', minSpendCents: 0 }, { key: 'gold', label: '金卡', minSpendCents: 100000 }] });
A(on.status === 200, 'B 支开分级失败 ' + on.status + JSON.stringify(on.data).slice(0, 120));
console.log('B 支:lucky-luxe 分级临时开启(fixture,验后还原)');
try {
  const ll = await login('lucky-luxe');
  for (let i = 1; i <= 5; i += 1) {
    const r = await checkBranch('lucky-luxe', ll, true, 'll-tiers-on', i === 1);
    console.log(`B${i}/5 lucky-luxe 全保留 ✓`, JSON.stringify(r));
  }
} finally {
  const off = await putConfig({ tiersEnabled: false, memberQualify: 'any_recharge', qualifyValueCents: 0, expireDays: null, tiers: [] });
  console.log('还原 tiersEnabled=false:', off.status, JSON.stringify(off.data.config || off.data).slice(0, 140));
}

/* ── 还原后复核:lucky-luxe 也回到三减法(当前真实口径)── */
const ll2 = await login('lucky-luxe');
const r2 = await checkBranch('lucky-luxe', ll2, false, 'll-restored', true);
console.log('还原复核 lucky-luxe 三减法 ✓', JSON.stringify(r2));
await mp.disconnect();
console.log('小件6 L5 双租户:A 支 5/5 + B 支 5/5 + 还原复核 全绿');
