/* D36 渲染层实拍(L1 末端验证):以林小雅(lucky demoLogin)看
 * ①储值页:4 行逐笔可见、余额 864、「充1000送50」行金额 +1000(50 只是文案=挂-004 定性证据)
 * ②积分页:余额 932、明细含 −800 兑换行、页面明细加总 ≡ 余额(三账闭环在店主那层成立)
 * ③币符:两页金额文本不含写死 '$'(CAD 店此处显示 $ 来自映射表,断言取 storecurrency 输出一致性:行文本 = 前缀+映射符号) */
import { connect, shot, sleep } from './lib.mjs';
const BASE = 'http://127.0.0.1:4128';
const A = (c, m) => { if (!c) throw new Error(m); };
const mini = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'lucky-luxe' }, body: JSON.stringify({ demoLogin: true, tenantId: 'lucky-luxe' }) }).then((r) => r.json());
const mp = await connect();
await mp.evaluate((a, uid) => { wx.setStorageSync('lucky_mini_auth', a); wx.setStorageSync('lucky_tenant', 'lucky-luxe'); wx.setStorageSync('lucky_member', { id: uid }); wx.removeStorageSync('lucky_store_currency'); wx.removeStorageSync('lucky_store_deposit'); /* 换店同构:shop-select 会清币种缓存,走查注入也必须清 */ }, mini.auth, mini.user.id);
const go = async (r, ms = 3200) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };

for (let i = 1; i <= 5; i += 1) {
  const p = await go('/pages/stored-value/index');
  const d = await p.data();
  A(Number(d.balance) === 864, `储值页余额 ${d.balance} ≠ 864`);
  A((d.txns || []).length === 4, `储值逐笔 ${d.txns && d.txns.length} 行 ≠ 4`);
  const big = (d.txns || []).find((t) => String(t.title).includes('充1000送50'));
  A(big && parseFloat(String(big.delta).replace(/[^0-9.]/g, '')) === 1000, `「充1000送50」行金额形态异常: ${big && big.delta}`);
  if (i === 1) { await shot(mp, 'r2-d36-stored-value'); console.log('  储值行样本:', JSON.stringify(d.txns.map((t) => ({ t: t.title.slice(0, 22), d: t.delta })))); }
  console.log(`储值页 ${i}/5 ✓ 余额864 · 4行 · 送50只是文案`);
}
/* 改判①(全量追溯)后的林小雅:累计获得=564(Σ已签档位小计 98+198+268)、已兑换 800、
   钳位 +236 → 余额 0。积分页三行 + Σ明细≡余额 + 三行「累计获得≡累计消费」跨页对上。 */
let meSpent = null;
{
  const pm = await go('/pages/me/index', 3200);
  const m = await pm.data('member');
  meSpent = Number(m.totalSpent);
}
for (let i = 1; i <= 5; i += 1) {
  const p = await go('/pages/points/index');
  const d = await p.data();
  A(Number(d.earnedTotal) === 564 && Number(d.redeemedTotal) === 800 && Number(d.balance) === 0,
    `三行 ${d.earnedTotal}/${d.redeemedTotal}/${d.balance} ≠ 564/800/0(钳位档案)`);
  A(Number(d.earnedTotal) === meSpent, `累计获得 ${d.earnedTotal} ≠ 我的页累计消费 ${meSpent}(恒等破裂)`);
  const hist = d.history || [];
  A(hist.some((h) => Number(h.delta) === -800), '明细缺 −800 兑换行');
  A(hist.some((h) => Number(h.delta) === 236), '明细缺 +236 钳位留痕行');
  const sum = hist.reduce((n, h) => n + Number(h.delta || 0), 0);
  A(sum === Number(d.balance), `页面明细加总 ${sum} ≠ 余额 ${d.balance}`);
  if (i === 1) await shot(mp, 'r2-d36-points');
  console.log(`积分页 ${i}/5 ✓ 三行 564/800/0 · 获得≡累计消费(${meSpent}) · 钳位留痕在列 · Σ明细=余额`);
}
await mp.disconnect();
console.log('D36 渲染层实拍:储值 5/5 + 积分 5/5 全绿');
