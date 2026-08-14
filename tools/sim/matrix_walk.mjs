/* 身份×店铺矩阵闸门(店主 2026-08-12:「多做几个用户…机器扫全量,店主只抽验」):
 * 每店全部演示2档案逐户按人登录(mini-login asUserId 正门)→ me 页+积分页断言 ≡ 后端真相
 * (指定样板户与 06兑换户另按对照卡常量双重断);矩阵结果表打印进回归报告。 */
import { connect, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
const LEVELS = {
  'jics-nail::演示2-jics-美甲券户': '顾客',   // 只消费过,从未充值 —— D41 两态之「顾客」
  'jics-nail::演示2-02储值客': '会员',        // 充过 500 —— 两态之「会员」
  'jics-nail::演示2-06兑换客': '顾客',        // 只消费+兑换,没充值
  'hoptest-demo2::演示2-试店-样板户': '顾客',
  'lucky-luxe::演示2-lucky-美睫储值户': 'Gold Member' // 分级店走梯子,不受 D41 影响
};
const CARD = {
  'lucky-luxe::演示2-lucky-美睫储值户': [704, 600, 104],
  'lucky-luxe::演示2-06兑换客': [900, 600, 300],
  'jics-nail::演示2-jics-美甲券户': [158, 0, 158],
  'jics-nail::演示2-06兑换客': [900, 800, 100],
  'hoptest-demo2::演示2-试店-样板户': [154, 0, 154]
};
const mp = await connect();
const go = async (r, ms = 3000) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };
const rows = [];
for (const tid of ['lucky-luxe', 'jics-nail', 'hoptest-demo2']) {
  const roster = (await fetch(BASE + '/sandbox/demo-roster', { headers: { 'x-tenant-id': tid } }).then((r) => r.json())).roster || [];
  A(roster.length, tid + ' 名册空');
  for (const who of roster) {
    const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tid }, body: JSON.stringify({ demoLogin: true, tenantId: tid, asUserId: who.id }) }).then((r) => r.json());
    A(d.user && d.user.id === who.id, tid + '/' + who.name + ' 按人登录失败');
    const mall = await fetch(BASE + '/my/points-mall', { headers: { authorization: `Bearer ${d.auth.accessToken}`, 'x-tenant-id': tid } }).then((r) => r.json());
    await mp.evaluate((t, a, uid) => {
      wx.setStorageSync('lucky_tenant', t);
      wx.setStorageSync('lucky_mini_auth', Object.assign({}, a, { tenantId: t }));
      wx.setStorageSync('lucky_member', { id: uid, _tenant: t });
      ['lucky_store_currency', 'lucky_store_deposit', 'lucky_store_ai', 'lucky_cart', 'lucky_orders', 'lucky_style_preset'].forEach((k) => wx.removeStorageSync(k));
    }, tid, d.auth, d.user.id);
    let p = await go('/pages/me/index', 3200);
    const m = await p.data('member');
    A(String(m.nickname) === who.name, `${tid}/${who.name} me 页姓名「${m.nickname}」不符`);
    A(Number(m.totalSpent) === Math.round((d.user.totalSpentCents || 0) / 100), `${tid}/${who.name} 累计消费不符`);
    A(String(m.memberLevel) === String(d.user.memberLevel), `${tid}/${who.name} 称谓渲染「${m.memberLevel}」≠ 服务端「${d.user.memberLevel}」`);
    if (LEVELS[tid + '::' + who.name]) A(d.user.memberLevel === LEVELS[tid + '::' + who.name], `${tid}/${who.name} 称谓「${d.user.memberLevel}」≠ 卡「${LEVELS[tid + '::' + who.name]}」`);
    p = await go('/pages/points/index', 3000);
    const pd = await p.data();
    A(Number(pd.earnedTotal) === mall.earnedTotal && Number(pd.redeemedTotal) === mall.redeemedTotal && Number(pd.balance) === mall.balance,
      `${tid}/${who.name} 三行渲染 ≠ 后端`);
    A(Number(pd.balance) <= Number(pd.earnedTotal), `${tid}/${who.name} 破守恒`);
    const key = tid + '::' + who.name;
    if (CARD[key]) {
      const [e, r2, b] = CARD[key];
      A(mall.earnedTotal === e && mall.redeemedTotal === r2 && mall.balance === b, `${key} 与对照卡不符:${mall.earnedTotal}/${mall.redeemedTotal}/${mall.balance}`);
    }
    rows.push(`| ${tid} | ${who.name} | ${mall.earnedTotal}/${mall.redeemedTotal}/${mall.balance} | ${d.user.memberLevel} | ✓ |`);
    console.log(`✓ ${tid} ${who.name} 三行 ${mall.earnedTotal}/${mall.redeemedTotal}/${mall.balance}`);
  }
}
await mp.disconnect();
console.log('\n矩阵结果表(贴回归报告):\n| 店 | 档案 | 三行 | 称谓 | 判定 |\n|---|---|---|---|---|\n' + rows.join('\n'));
console.log(`矩阵闸门:${rows.length} 户全绿`);
