/* 拍板②后的新常态 L5 双租户实拍(复核二轮批):
 * lucky-luxe = 分级店(迁移已开 tiersEnabled,梯子=原全局四档)→ 等级+成长条+权益卡全保留 ×5
 * jics-nail  = 不分级店 → 三减法 ×5
 * 不再临时开关配置 —— 这就是两店的常驻口径。 */
import { connect, shot, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
async function login(tenant) {
  return fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tenant }, body: JSON.stringify({ demoLogin: true, tenantId: tenant }) }).then((r) => r.json());
}
const mp = await connect();
const asCust = (mini, tenant) => mp.evaluate((a, t, uid) => { wx.setStorageSync('lucky_mini_auth', a); wx.setStorageSync('lucky_tenant', t); wx.setStorageSync('lucky_member', { id: uid }); wx.removeStorageSync('lucky_store_currency'); wx.removeStorageSync('lucky_store_deposit'); /* 换店同构:shop-select 会清币种缓存,走查注入也必须清 */ }, mini.auth, tenant, (mini.user || {}).id);
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
  if (doShot) await shot(mp, `r2-${tag}-me`);
  const p2 = await go('/pages/member-benefits/index', 3000);
  const cards = (await p2.$$('.level-card')) || [];
  if (!expectTiers) A(cards.length === 0, `${tag}: 权益卡没留空(${cards.length} 张)`);
  else A(cards.length === 4, `${tag}: 权益卡应 4 档(租户梯子),实际 ${cards.length}`);
  if (doShot) await shot(mp, `r2-${tag}-benefits`);
  return { growth: growth.length, title, cards: cards.length };
}

const jics = await login('jics-nail');
for (let i = 1; i <= 5; i += 1) console.log(`jics ${i}/5 三减法 ✓`, JSON.stringify(await checkBranch('jics-nail', jics, false, 'jics', i === 1)));
const ll = await login('lucky-luxe');
for (let i = 1; i <= 5; i += 1) console.log(`lucky ${i}/5 全保留 ✓`, JSON.stringify(await checkBranch('lucky-luxe', ll, true, 'lucky', i === 1)));
await mp.disconnect();
console.log('拍板② L5 双租户新常态:jics 5/5 + lucky 5/5 全绿');
