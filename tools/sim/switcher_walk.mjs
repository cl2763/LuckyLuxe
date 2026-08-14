/* 沙盒「切换演示身份」入口实点走查(弹层实点律):me 页工具条 tap → 名册页 → tap 行 → 回 me 页断言身份已切。×5 */
import { connect, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
const mp = await connect();
const go = async (r, ms = 3000) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };
const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'lucky-luxe' }, body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe' }) }).then((r) => r.json());
await mp.evaluate((a, uid) => { wx.setStorageSync('lucky_tenant', 'lucky-luxe'); wx.setStorageSync('lucky_mini_auth', Object.assign({}, a, { tenantId: 'lucky-luxe' })); wx.setStorageSync('lucky_member', { id: uid, _tenant: 'lucky-luxe' }); }, d.auth, d.user.id);
const targets = ['演示2-02储值客', '演示2-06兑换客', '演示2-lucky-美睫储值户', '演示2-01纯新客', '演示2-lucky-美睫储值户'];
for (let i = 0; i < 5; i += 1) {
  let p = await go('/pages/me/index', 3200);
  let hit = false;
  for (const el of (await p.$$('.sandbox-bar')) || []) { await el.tap(); hit = true; break; }
  A(hit, 'me 页沙盒工具条没渲染(SANDBOX 旗?)');
  await sleep(2000);
  p = await mp.currentPage();
  A(p.path.includes('sandbox-identity'), '没进切换页 ' + p.path);
  let picked = false;
  for (const el of (await p.$$('.row')) || []) {
    if (String(await el.text()).includes(targets[i])) { await el.tap(); picked = true; break; }
  }
  A(picked, '名册里找不到 ' + targets[i]);
  await sleep(2400);
  p = await go('/pages/me/index', 3200);
  const m = await p.data('member');
  A(String(m.nickname) === targets[i], `切换后身份「${m.nickname}」≠「${targets[i]}」`);
  console.log(`切换 ${i + 1}/5 ✓ → ${targets[i]}`);
}
await mp.disconnect();
console.log('沙盒切换入口实点:5/5 全绿');
