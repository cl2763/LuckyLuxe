/* 店主追加·CTA 实拍:非会员 pill=「成为会员」→ 点进权益页见成为会员承接区;会员=「会员/我的会员」。×5 */
import { connect, shot, sleep } from './lib.mjs';
import { DatabaseSync } from 'node:sqlite';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
const db = new DatabaseSync('/Users/changliu/Documents/Codex/2026-04-29/new-chat/apps/api/local-data/lucky-luxe.sqlite', { readOnly: true });
const mp = await connect();
const go = async (r, ms = 3200) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };
async function as(name) {
  const u = db.prepare("SELECT id FROM users WHERE tenant_id = 'jics-nail' AND display_name = ?").get(name);
  const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'jics-nail' }, body: JSON.stringify({ demoLogin: true, tenantId: 'jics-nail', asUserId: u.id }) }).then((r) => r.json());
  await mp.evaluate((a, uid) => { wx.setStorageSync('lucky_tenant', 'jics-nail'); wx.setStorageSync('lucky_mini_auth', Object.assign({}, a, { tenantId: 'jics-nail' })); wx.setStorageSync('lucky_member', { id: uid, _tenant: 'jics-nail' }); ['lucky_store_currency', 'lucky_store_deposit'].forEach((k) => wx.removeStorageSync(k)); }, d.auth, u.id);
}
async function pillText(p) { const ts = await Promise.all(((await p.$$('.level-pill text')) || []).map((t) => t.text())); return String(ts[0] || '').trim(); }
// 非会员(券户):pill=成为会员 → 权益页承接区
await as('演示2-jics-美甲券户');
for (let i = 1; i <= 5; i += 1) {
  let p = await go('/pages/me/index');
  const t = await pillText(p);
  A(t === '成为会员', `非会员 pill「${t}」≠「成为会员」`);
  p = await go('/pages/member-benefits/index', 3000);
  const title = String(await (await p.$('.pj-title')).text());
  A(title === '成为会员', `承接区标题「${title}」≠「成为会员」`);
  if (i === 1) { await shot(mp, 'd41-cta-join-me'); await shot(mp, 'd41-cta-join-benefits'); }
  console.log(`非会员 CTA ${i}/5 ✓ 成为会员 → 承接区在`);
}
// 会员(翻转户):pill=会员 → 我的会员
await as('演示2-jics-翻转验证户');
for (let i = 1; i <= 5; i += 1) {
  let p = await go('/pages/me/index');
  const t = await pillText(p);
  A(t === '会员', `会员 pill「${t}」≠「会员」`);
  p = await go('/pages/member-benefits/index', 3000);
  const title = String(await (await p.$('.pj-title')).text());
  A(title === '我的会员', `承接区标题「${title}」≠「我的会员」`);
  if (i === 1) await shot(mp, 'd41-cta-member');
  console.log(`会员态 ${i}/5 ✓ 会员 → 我的会员`);
}
await mp.disconnect();
console.log('CTA 实拍:非会员 5/5 + 会员 5/5 全绿');
