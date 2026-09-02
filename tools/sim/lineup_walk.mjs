/* 演示2 阵容渲染层走查(接棒 d36_l5 —— 旧档案 0 引用):
 * 双租户各取「演示2-06兑换客」(赚分+兑换都有)进积分页,断言三行渲染 ≡ 后端真相、
 * Σ明细≡余额、守恒 余额≤获得;me 页累计消费 ≡ 积分页累计获得(恒等跨页对上)。×5。 */
import { connect, shot, sleep } from './lib.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { requireTarget } from '../db-target.mjs'
/* 🔴 D124(店主 03o):目标 URL 原来**焊死在代码里**(连 env 都没有)——
   那连"打错"的机会都不给,它永远打 4128。护栏必须**控制目标本身**,
   不是在旁边插一个没人读的变量(我上一版就是那么糊的,已回滚)。 */
const BASE = requireTarget({ envName: 'API_BASE', value: process.env.API_BASE,
  hint: '(沙箱 http://127.0.0.1:4310 / 本机库 http://127.0.0.1:4128;端口会骗人,以库路径为准)' });
/* 🔴 03q:这条腿原来硬编码着**本机库绝对路径** —— 而上面的 API_BASE 那条腿早接了护栏。
   按文件判的护栏刀只问"文件里有没有 requireTarget 三个字",于是它绿着;
   改按**解析点**判之后这一族(4 个 tools/sim 脚本)才露出来。 */
const DB = requireTarget({ envName: 'SIM_DB_PATH', value: process.env.SIM_DB_PATH,
  hint: '(必须与 API_BASE 指的是同一个库:沙箱 apps/api/sandbox-data/lucky-luxe.sqlite)' })
const A = (c, m) => { if (!c) throw new Error(m); };
const db = new DatabaseSync(DB, { readOnly: true });
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mintTok = (uid) => { const p = b64u({ sub: uid, openid: `fixture-openid-${uid}`, exp: Date.now() + 3600000 }); return `mini.${p}.${createHmac('sha256', 'owner-demo-token').update(p).digest('base64url')}`; };
const mp = await connect();
const go = async (r, ms = 3200) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };

for (const tenant of ['lucky-luxe', 'jics-nail']) {
  const u = db.prepare("SELECT id FROM users WHERE tenant_id = ? AND display_name = '演示2-06兑换客'").get(tenant);
  A(u, tenant + ' 缺演示2-06');
  const tok = mintTok(u.id);
  const truth = await fetch(BASE + '/my/points-mall', { headers: { authorization: `Bearer ${tok}`, 'x-tenant-id': tenant } }).then((r) => r.json());
  await mp.evaluate((t, a, uid) => {
    wx.setStorageSync('lucky_tenant', t);
    wx.setStorageSync('lucky_mini_auth', { accessToken: a, tokenType: 'bearer', tenantId: t });
    wx.setStorageSync('lucky_member', { id: uid, _tenant: t });
    ['lucky_store_currency', 'lucky_store_deposit', 'lucky_store_ai', 'lucky_cart', 'lucky_orders', 'lucky_style_preset'].forEach((k) => wx.removeStorageSync(k));
  }, tenant, tok, u.id);
  let meSpent;
  { const p = await go('/pages/me/index'); meSpent = Number((await p.data('member')).totalSpent); }
  for (let i = 1; i <= 5; i += 1) {
    const p = await go('/pages/points/index');
    const d = await p.data();
    A(Number(d.earnedTotal) === truth.earnedTotal && Number(d.redeemedTotal) === truth.redeemedTotal && Number(d.balance) === truth.balance,
      `${tenant} 三行渲染 ${d.earnedTotal}/${d.redeemedTotal}/${d.balance} ≠ 后端 ${truth.earnedTotal}/${truth.redeemedTotal}/${truth.balance}`);
    A(Number(d.balance) <= Number(d.earnedTotal), tenant + ' 破守恒');
    A(Number(d.earnedTotal) === meSpent, `${tenant} 累计获得 ${d.earnedTotal} ≠ me 页累计消费 ${meSpent}`);
    const sum = (d.history || []).reduce((n, h) => n + Number(h.delta || 0), 0);
    A(sum === Number(d.balance), `${tenant} Σ明细 ${sum} ≠ 余额 ${d.balance}`);
    if (i === 1) await shot(mp, `lineup-${tenant}-points`);
    console.log(`${tenant} 积分页 ${i}/5 ✓ 三行 ${d.earnedTotal}/${d.redeemedTotal}/${d.balance} · 获得≡消费 · Σ明细=余额`);
  }
}
await mp.disconnect();
console.log('演示2 阵容渲染层走查:双租户各 5/5 全绿');
