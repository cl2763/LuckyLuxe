/* v1.4 三件批 devtools 走查:顾客服务 Tab 新结构(两店)——
 * ①无顶部段选;②左栏=平台大类(字典驱动,空类不显示);③项目卡带二级眉标+「¥xxx 起」;
 * ④分类里 0「加项服务」;⑤大类实点切换×3;截图两店留证(四之十)。 */
import { connect, shot, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
const mp = await connect();

async function walkStore(tenant, expectCats, label) {
  const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': tenant }, body: JSON.stringify({ demoLogin: true, tenantId: tenant }) }).then((r) => r.json());
  await mp.evaluate((a, t) => {
    wx.setStorageSync('lucky_tenant', t);
    wx.setStorageSync('lucky_mini_auth', Object.assign({}, a.auth, { tenantId: t }));
    ['lucky_store_currency', 'lucky_store_deposit'].forEach((k) => wx.removeStorageSync(k));
  }, d, tenant);
  await mp.reLaunch('/pages/services/index');
  await sleep(3200);
  const p = await mp.currentPage();
  const dd = await p.data();
  A(Array.isArray(dd.cats) && dd.cats.length === expectCats, `${label}:大类数 ${dd.cats && dd.cats.length} ≠ ${expectCats}`);
  A(!('activeType' in dd) || dd.activeType === undefined || dd.activeType === '', `${label}:旧 activeType 状态残留`);
  A(dd.cats.every((c) => c.label !== '加项服务' && !/加项/.test(c.label)), `${label}:分类含加项`);
  const swArr = await p.$$('.type-switch');
  A(swArr.length === 0, `${label}:顶部段选 DOM 残留`);
  // 逐大类实点:每类列表非空+全带「起」+眉标在
  for (let i = 0; i < dd.cats.length; i += 1) {
    await mp.reLaunch('/pages/services/index');
    await sleep(2600);
    const pg = await mp.currentPage();
    const items = await pg.$$('.category-item');
    await items[i].tap();
    await sleep(1600);
    let cur = await (await mp.currentPage()).data();
    for (let w = 0; w < 5 && !(cur.serviceList && cur.serviceList.length); w += 1) { await sleep(800); cur = await (await mp.currentPage()).data(); }
    A(cur.serviceList.length > 0, `${label}:${cur.cats[i].label} 类空列表`);
    A(cur.serviceList.every((s) => /起$/.test(s.priceFromLabelZh || '')), `${label}:${cur.cats[i].label} 有条目缺「起」`);
    A(cur.serviceList.every((s) => s.category), `${label}:${cur.cats[i].label} 有条目缺二级眉标`);
    // D48:每大类第一条以深链直达详情(reLaunch=最稳原语;护理类=事故现场),断言 service 非空
    const firstId = cur.serviceList[0]._id;
    await mp.reLaunch(`/pages/service-detail/index?id=${firstId}`);
    await sleep(3000);
    let dd2 = await (await mp.currentPage()).data();
    for (let w = 0; w < 5 && !(dd2.service && dd2.service.name); w += 1) { await sleep(900); dd2 = await (await mp.currentPage()).data(); }
    A(dd2.service && dd2.service.name, `${label}:${cur.cats[i].label} 详情 service 为空(D48「服务不存在」)`);
    if (cur.cats[i].label.includes('护理')) await shot(mp, `v14-detail-care-${tenant}`);
    console.log(`  ${label} ${cur.cats[i].label} ✓ ${cur.serviceList.length} 条全带起+眉标;详情「${dd2.service.name}」可开`);
  }
  await mp.reLaunch('/pages/services/index');
  await sleep(2400);
  await shot(mp, `v14-services-${tenant}`);
  console.log(`${label} ✓ 大类 ${dd.cats.map((c) => c.label).join('/')}`);
}

await walkStore('jics-nail', 3, 'jics');
await walkStore('lucky-luxe', 3, 'lucky');   // 本地 lucky 有 care 主项目=3 类
console.log('\nv1.4 服务 Tab 走查:两店全过');
process.exit(0);
