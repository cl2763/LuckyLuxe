/* S1+S3 镜像屏+顾客端换源 L5 实点走查(图=合同 v1.2 §四§五):
 * ① 商家「服务与目录」页签①:连续 5 次进出页面,shelf 渲染+「¥xxx 起」+开关**实点**往返
 *   (弹层实点律:switch 用 element.tap(),不 setData 糊)每轮 API 复核 storefront 真值。
 * ② 页签② 只读镜像:价档 chips/加项/note。
 * ③ 闭环③ 反向:网页侧(API 模拟)拨下架 → 镜像屏刷新即见 off → 拨回。
 * ④ 顾客端服务 Tab:列表价格全部「¥xxx 起」、零加项/次卡;截图留证。
 * 前置:4128 已还回 + devtools 自动化端口 9420 + handoff/自动化占用中.txt 占用中。 */
import { connect, shot, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const TENANT = 'jics-nail';
const A = (c, m) => { if (!c) throw new Error(m); };

const login = await fetch(BASE + '/admin/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boss-jienail', password: '123456', remember: true }) }).then((r) => r.json());
const TOK = login.auth && login.auth.accessToken;
A(TOK, '老板登录失败');
const api = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { authorization: `Bearer ${TOK}`, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const mp = await connect();
await mp.evaluate((tok, base, tenant) => {
  wx.setStorageSync('lucky_admin_auth', { accessToken: tok, tokenType: 'bearer', apiBase: base });
  wx.setStorageSync('lucky_admin_role', 'owner');
  wx.setStorageSync('lucky_tenant', tenant);
}, TOK, BASE, TENANT);

const itemsOf = async () => (await api('GET', '/admin/pricing/items')).data.items || [];
const target = (await itemsOf()).find((i) => i.itemKind === 'main' && !i.isTimecard && i.isActive !== false && i.storefront);
A(target, '没有可用主项目');
console.log('走查对象:', target.nameZh);

// ── ① L5:5 次进出 + 开关实点往返 ──
for (let i = 1; i <= 5; i += 1) {
  await mp.reLaunch('/pages/merchant/services/index');
  await sleep(2800);
  const p = await mp.currentPage();
  const d = await p.data();
  A(d.tab === 'storefront', `第${i}次:默认页签≠①`);
  A(d.shelf.length > 0, `第${i}次:shelf 空`);
  A(/起/.test(d.shelf[0].sub), `第${i}次:首行无「起」:${d.shelf[0].sub}`);
  const row = d.shelf.findIndex((s) => s.id === target.id);
  A(row >= 0, `第${i}次:找不到走查对象行`);
  const sws = await p.$$('switch');
  A(sws.length === d.shelf.length, `第${i}次:开关数 ${sws.length} ≠ 行数 ${d.shelf.length}`);
  await sws[row].tap();            // 实点拨下架
  await sleep(2600);
  let now = (await itemsOf()).find((x) => x.id === target.id);
  A(now && !now.storefront, `第${i}次:实点后后端 storefront 仍为真`);
  const pub1 = await fetch(BASE + '/services', { headers: { 'x-tenant-id': TENANT } }).then((r) => r.json());
  A(!pub1.services.some((s) => s.id === target.id), `第${i}次:下架后顾客接口仍可见`);
  const p2 = await mp.currentPage();
  const sws2 = await p2.$$('switch');
  await sws2[(await p2.data()).shelf.findIndex((s) => s.id === target.id)].tap();  // 实点拨回
  await sleep(2600);
  now = (await itemsOf()).find((x) => x.id === target.id);
  A(now && now.storefront, `第${i}次:拨回后后端 storefront 仍为假`);
  if (i === 1) await shot(mp, 's1-mirror-tab1');
  console.log(`L5 ${i}/5 ✓ 开关实点往返+双端复核`);
}

// ── ② 页签② 只读镜像 ──
{
  const p = await mp.currentPage();
  const tabs = await p.$$('.tab');
  await tabs[1].tap();
  await sleep(1200);
  const d = await p.data();
  A(d.tab === 'catalog', '页签②未切换');
  A(d.mains.length > 0 && d.mains[0].chips.length > 0, '页签②价档 chips 空');
  A(d.mains.every((m) => m.chips.every((c) => !/undefined|NaN/.test(c))), 'chips 有脏值');
  console.log('页签② ✓ 项目', d.mains.length, '个,加项', d.addons.length, '个');
  await shot(mp, 's1-mirror-tab2');
}

// ── ③ 闭环③ 反向:网页侧拨 → 镜像屏即见 ──
{
  await api('PATCH', `/admin/pricing/items/${target.id}`, { storefront: false });
  await mp.reLaunch('/pages/merchant/services/index');
  await sleep(2800);
  const d = await (await mp.currentPage()).data();
  const row = d.shelf.find((s) => s.id === target.id);
  A(row && row.on === false, '网页侧下架后镜像屏开关未同步 off');
  await api('PATCH', `/admin/pricing/items/${target.id}`, { storefront: true });
  await mp.reLaunch('/pages/merchant/services/index');
  await sleep(2800);
  const d2 = await (await mp.currentPage()).data();
  A(d2.shelf.find((s) => s.id === target.id).on === true, '拨回后镜像屏未同步 on');
  console.log('闭环③ 反向 ✓ 网页拨小程序即见');
}

// ── ④ 顾客端服务 Tab:「¥xxx 起」+零越界 ──
{
  const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT }, body: JSON.stringify({ demoLogin: true, tenantId: TENANT }) }).then((r) => r.json());
  await mp.evaluate((a, tenant) => {
    wx.setStorageSync('lucky_tenant', tenant);
    wx.setStorageSync('lucky_mini_auth', Object.assign({}, a.auth, { tenantId: tenant }));
    ['lucky_store_currency', 'lucky_store_deposit'].forEach((k) => wx.removeStorageSync(k));
  }, d, TENANT);
  await mp.reLaunch('/pages/services/index');
  await sleep(3200);
  const pg = await mp.currentPage();
  const dd = await pg.data();
  A(Array.isArray(dd.serviceList) && dd.serviceList.length > 0, '顾客列表空');
  A(dd.serviceList.every((s) => /起$/.test(s.priceFromLabelZh || '')), '有条目缺「¥xxx 起」:' + JSON.stringify(dd.serviceList.map((s) => s.priceFromLabelZh)));
  await shot(mp, 's1-customer-services');
  console.log('顾客端 ✓', dd.serviceList.length, '条全带「起」');
}

console.log('\nS1 镜像走查:全部通过');
process.exit(0);
