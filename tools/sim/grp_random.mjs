/* ⚠️ 永久护栏(复发登记 2026-08-12:「点了券被吞」D22 家族第 2 例的产出物)
 * 涉钱页每批验收跑一轮;fixture(booking/券 grant/token)按当批实况改常量,跑完照挂账纪律撤场。
 * 跑之前:handoff/自动化占用中.txt 改「占用中」;跑完改回「未占用」。
 */
/* 随机组合价格三方对账(店主点名,2026-08-12)
 * 22 组随机组合:主项目×价档×加项×自选×组②×券/定金/储值 →
 *   三方 = ①页面(formBody+页面 preview) ②后端 computeSettlement(直连重放) ③独立手工计算器(不复用产品代码)
 * 独立计算器规则(全部取自《财务总逻辑》与本批读到的后端契约,自己实现):
 *   行价 = 档位价(null 回落原价)×数量;小计 = Σ行 + Σ自选;原价合计 = Σ原价×数量 + Σ自选;
 *   定金抵扣 = min(收取额, 小计)(仅组①、开着、有预约);
 *   券 = 小计≥门槛 才可用,抵 min(券额, 小计−定金抵扣)(仅组①);
 *   单合计 = 小计 − 定金抵扣 − 券;组合计 = Σ单;储值 = 勾了则 min(余额, 组合计);到店应收 = 组合计 − 储值。
 * 随机池排除 per_finger 与带 priceRule 的条目(计价语义另有规则,不在随机池;如实披露)。
 * 种子固定可复现:LCG seed=20260812。用法: node grp_random.mjs [起始序号] [组数]
 */
import { connect, sleep } from './lib.mjs';

const BASE = 'http://127.0.0.1:4128';
const TOKEN = 'sess_msnk2ktp_tha9l7_3d1gp3gu';
const FX_USER = 'user_msojbzxv_h59nc8';
const FX_BOOKING = 'booking_msoud7nw_pblnec';
const GRANT = 'grant_msouczag_nun3sw';
const COUPON = { amountCents: 3000, minSpendCents: 20000 };
const DEPOSIT_RECEIPT = 10000;

const START = Number(process.argv[2] || 1);
const COUNT = Number(process.argv[3] || 22);

let seed = 20260812;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

async function api(m, p, b) {
  const r = await fetch(BASE + p, { method: m, headers: { authorization: `Bearer ${TOKEN}`, 'x-tenant-id': 'jics-nail', 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status >= 300) throw new Error(`${m} ${p} → ${r.status}`);
  return d;
}

// 目录(独立计算器的价表;字段直读 API,不经过页面)
const CAT = {}; const ITEM = {};
for (const c of (await api('GET', '/admin/pricing/categories')).categories) CAT[c.id] = c;
const rawItems = (await api('GET', '/admin/pricing/items')).items.filter((i) => i.isActive !== false);
let excluded = 0;
for (const i of rawItems) {
  if (i.unit === 'per_finger' || (i.priceRule && i.priceRule !== 'fixed')) { excluded += 1; continue; }
  ITEM[i.id] = i;
}
const TIERS = ['list', 'member', 'share'];
const TF = { list: 'listPriceCents', member: 'memberPriceCents', share: 'sharePriceCents' };
const priceOf = (id, tier) => { const it = ITEM[id]; const v = it[TF[tier]]; return v === null || v === undefined ? it.listPriceCents : v; };

const balance = 49500; // 自动化验证-勿动 当前余额(随机轮零写入,恒定;开跑前已核)

// 独立计算器
function calc(body) {
  const sheets = body.settlements.map((sh, idx) => {
    let subtotal = 0, listTotal = 0;
    for (const it of sh.items) { subtotal += priceOf(it.serviceId, sh.tierKey) * (it.qty || 1); listTotal += ITEM[it.serviceId].listPriceCents * (it.qty || 1); }
    for (const c of sh.customItems || []) { subtotal += c.amountCents; listTotal += c.amountCents; }
    let deposit = 0;
    if (idx === 0 && sh.depositApplied && sh.bookingId) deposit = Math.min(DEPOSIT_RECEIPT, subtotal);
    let coupon = 0;
    if (idx === 0 && sh.couponGrantId) {
      if (subtotal >= COUPON.minSpendCents) coupon = Math.min(COUPON.amountCents, Math.max(0, subtotal - deposit));
    }
    return { subtotal, listTotal, deposit, coupon, total: subtotal - deposit - coupon };
  });
  const g = (k) => sheets.reduce((n, s) => n + s[k], 0);
  const total = g('total');
  const stored = body.payIntent === 'balance_plus_offline' ? Math.min(balance, total) : 0;
  return {
    sheets,
    group: {
      listTotalCents: g('listTotal'), subtotalCents: g('subtotal'),
      discountTotalCents: g('listTotal') - g('subtotal') + g('coupon'), // 后端口径:共优惠含券(页面标签同款)
      couponDiscountCents: g('coupon'), depositDeductCents: g('deposit'),
      totalCents: total, storedUsedCents: stored, offlineDueCents: total - stored
    }
  };
}

const mp = await connect();
const ds = (o) => ({ currentTarget: { dataset: o } });
const dv = (o, v) => ({ currentTarget: { dataset: o }, detail: { value: v } });

let passed = 0, ran = 0;
const report = [];
for (let n = 1; n <= START + COUNT - 1; n += 1) {
  // 先走随机数把序列推进到位(保证任意起点组合一致)
  const spec = {
    tier: pick(TIERS),
    catKind: rnd(), mainRoll: rnd(), addonN: ri(0, 2), addonRolls: [rnd(), rnd()],
    customN: ri(0, 2), customAmts: [ri(1, 99), ri(1, 99)],
    twoGroups: rnd() < 0.5, tier2: pick(TIERS), main2Roll: rnd(),
    coupon: rnd() < 0.4, deposit: rnd() < 0.5, balanceOn: rnd() < 0.6
  };
  if (n < START) continue;
  ran += 1;
  const fails = [];
  try {
    await mp.reLaunch(`/pages/merchant/settlement/index?bookingId=${FX_BOOKING}&userId=${FX_USER}&name=x`); await sleep(2300);
    const page = await mp.currentPage();
    for (let w = 0; w < 14; w += 1) { if (await page.data('ready')) break; await sleep(500); }
    const cats = await page.data('cats');
    // 组①:随机大类(有可选主项的)
    const okCats = cats.filter((c) => Object.values(ITEM).some((i) => i.itemKind === 'main' && i.categoryId === c.id));
    const cat1 = okCats[Math.floor(spec.catKind * okCats.length)];
    await page.callMethod('gPickTier', ds({ g: 0, k: spec.tier })); await sleep(250);
    await page.callMethod('gPickCat', ds({ g: 0, id: cat1.id })); await sleep(350);
    let g0 = (await page.data('groups'))[0];
    const mains0 = g0.mainItems.filter((m) => ITEM[m.id]);
    const main1 = mains0[Math.floor(spec.mainRoll * mains0.length)];
    await page.callMethod('gToggleMain', ds({ g: 0, id: main1.id })); await sleep(500);
    g0 = (await page.data('groups'))[0];
    const addonPool = [];
    for (const ag of g0.addonGroups || []) for (const a of ag.items) if (ITEM[a.id]) addonPool.push(a);
    for (let k = 0; k < Math.min(spec.addonN, addonPool.length); k += 1) {
      const a = addonPool[Math.floor(spec.addonRolls[k] * addonPool.length)];
      const g0n = (await page.data('groups'))[0];
      if (Object.prototype.hasOwnProperty.call(g0n.addonIds, a.id)) continue; // 撞重就跳过
      await page.callMethod('gToggleAddon', ds({ g: 0, id: a.id })); await sleep(300);
    }
    for (let k = 0; k < spec.customN; k += 1) {
      await page.callMethod('gCustomName', dv({ g: 0 }, `随机${k + 1}`));
      await page.callMethod('gCustomAmount', dv({ g: 0 }, String(spec.customAmts[k])));
      await page.callMethod('gAddCustom', ds({ g: 0 })); await sleep(250);
    }
    // 组②
    if (spec.twoGroups) {
      await page.callMethod('addGroup'); await sleep(350);
      const cat2 = okCats[(okCats.indexOf(cat1) + 1) % okCats.length];
      await page.callMethod('gPickTier', ds({ g: 1, k: spec.tier2 })); await sleep(250);
      await page.callMethod('gPickCat', ds({ g: 1, id: cat2.id })); await sleep(350);
      const g1 = (await page.data('groups'))[1];
      const mains1 = g1.mainItems.filter((m) => ITEM[m.id]);
      if (mains1.length) { await page.callMethod('gToggleMain', ds({ g: 1, id: mains1[Math.floor(spec.main2Roll * mains1.length)].id })); await sleep(400); }
    }
    // 券/定金/储值(券要等首轮预览把 couponOptions 拉回来再点,点完再等一轮回显)
    if (spec.coupon) {
      for (let w = 0; w < 10; w += 1) { if (((await page.data('couponOptions')) || []).length) break; await sleep(400); }
      await page.callMethod('pickCoupon', ds({ id: GRANT })); await sleep(900);
      if (process.env.CPN_DEBUG) console.log('    [pick后] grantId=', await page.data('couponGrantId'), 'picked=', JSON.stringify(await page.data('couponPicked')));
    }
    if ((await page.data('depositApplied')) !== spec.deposit) { await page.callMethod('payToggleDeposit'); await sleep(400); }
    if (process.env.CPN_DEBUG) console.log('    [定金后] grantId=', await page.data('couponGrantId'));
    if (((await page.data('payMenu')).useBalance) !== spec.balanceOn) { await page.callMethod('payToggleBalance'); await sleep(400); }
    if (process.env.CPN_DEBUG) console.log('    [储值后] grantId=', await page.data('couponGrantId'));
    await sleep(1500);
    if (process.env.CPN_DEBUG) console.log('    [终态] grantId=', await page.data('couponGrantId'), 'body券=', (await page.callMethod('formBody')).settlements[0].couponGrantId);
    // 三方
    const body = await page.callMethod('formBody');
    const pagePv = (await page.data('preview')).group;
    const direct = (await api('POST', '/admin/settlements/preview', body)).group;
    const mine = calc(body);
    if (JSON.stringify(pagePv) !== JSON.stringify(direct)) fails.push('页面≠后端');
    // 券点了必须挂上,除非有合法落券原因(小计没过门槛)
    if (spec.coupon && !body.settlements[0].couponGrantId && mine.sheets[0].subtotal >= COUPON.minSpendCents) fails.push('券点了却没挂上(无合法落券原因)');
    for (const k of ['listTotalCents', 'subtotalCents', 'discountTotalCents', 'couponDiscountCents', 'depositDeductCents', 'totalCents']) {
      if (direct[k] !== mine.group[k]) fails.push(`后端.${k}=${direct[k]} ≠ 独立算=${mine.group[k]}`);
    }
    if (direct.payment.storedUsedCents !== mine.group.storedUsedCents) fails.push(`储值 ${direct.payment.storedUsedCents}≠${mine.group.storedUsedCents}`);
    if (direct.payment.offlineDueCents !== mine.group.offlineDueCents) fails.push(`应收 ${direct.payment.offlineDueCents}≠${mine.group.offlineDueCents}`);
    const desc = `${spec.tier}${spec.twoGroups ? '+组②' + spec.tier2 : ''} 加项${Object.keys(((await page.data('groups'))[0]).addonIds).length} 自选${spec.customN}` +
      `${spec.coupon ? ' 券' : ''}${spec.deposit ? ' 定金' : ''}${spec.balanceOn ? ' 储值' : ''} → 合计${direct.totalCents / 100} 应收${direct.payment.offlineDueCents / 100}`;
    report.push(`${n}. ${fails.length ? '✗' : '✓'} ${desc}${fails.length ? ' | ' + fails.join(';') : ''}`);
    console.log(`  ${fails.length ? '✗' : '✓'} #${n} ${desc}${fails.length ? ' — ' + fails.join(';') : ''}`);
  } catch (e) { fails.push('异常:' + e.message); console.log(`  ✗ #${n} 异常 ${e.message}`); report.push(`${n}. ✗ 异常 ${e.message}`); }
  if (!fails.length) passed += 1;
}
console.log(`随机组合结果: ${passed}/${ran}(排除池:per_finger/priceRule 条目 ${excluded} 个)`);
console.log('REPORT_LINES=' + JSON.stringify(report));
await mp.disconnect();
process.exit(passed === ran ? 0 : 1);
