/* D41 翻转实拍(L5):jics 新建「演示2-jics-翻转验证户」→ 绑定 → me 页称谓「顾客」×5 →
 * 老板充值 ¥50 → me 页称谓「会员」×5(充值那一刻翻转)。留库为两态活样本。 */
import { connect, shot, sleep } from './lib.mjs';
import { DatabaseSync } from 'node:sqlite';
import { requireCred } from './require-cred.mjs'
import { requireTarget } from '../db-target.mjs'
/* 🔴 D124(店主 03o):目标 URL 原来**焊死在代码里**(连 env 都没有)——
   那连"打错"的机会都不给,它永远打 4128。护栏必须**控制目标本身**,
   不是在旁边插一个没人读的变量(我上一版就是那么糊的,已回滚)。 */
const BASE = requireTarget({ envName: 'API_BASE', value: process.env.API_BASE,
  hint: '(沙箱 http://127.0.0.1:4310 / 本机库 http://127.0.0.1:4128;端口会骗人,以库路径为准)' });
const OWNER = requireCred({ envName: 'OWNER_SESS', value: process.env.OWNER_SESS, what: '店主会话令牌' })
const A = (c, m) => { if (!c) throw new Error(m); };
/* 🔴 03q:这条腿原来硬编码着**本机库绝对路径** —— 而上面的 API_BASE 那条腿早接了护栏。
   按文件判的护栏刀只问"文件里有没有 requireTarget 三个字",于是它绿着;
   改按**解析点**判之后这一族(4 个 tools/sim 脚本)才露出来。 */
const DB = requireTarget({ envName: 'SIM_DB_PATH', value: process.env.SIM_DB_PATH,
  hint: '(必须与 API_BASE 指的是同一个库:沙箱 apps/api/sandbox-data/lucky-luxe.sqlite)' })
const db = new DatabaseSync(DB);
const api = async (m, p, b, tok) => {
  const r = await fetch(BASE + p, { method: m, headers: { authorization: `Bearer ${tok || OWNER}`, 'content-type': 'application/json', 'x-tenant-id': 'jics-nail' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const dateOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let uid;
const exist = db.prepare("SELECT id FROM users WHERE tenant_id = 'jics-nail' AND display_name = '演示2-jics-翻转验证户'").get();
if (exist) { uid = exist.id; console.log('翻转户已存在(幂等):余额清不掉,只验当前态'); }
else {
  const techs = (await api('GET', '/admin/technicians?roster=1')).data.technicians;
  const svc = (await api('GET', '/admin/pricing/items')).data.items.find((i) => i.itemKind === 'main' && i.isActive !== false);
  let bk = null;
  outer: for (const day of [4, 5, 6, 7]) for (const t of ['20:15', '20:45', '21:15']) for (const tech of techs.slice(0, 4)) {
    const r = await api('POST', '/admin/bookings/direct', { newCustomerName: '演示2-jics-翻转验证户', serviceId: svc.id, technicianId: tech.id, date: dateOffset(day), time: t, notes: 'D41 翻转两态活样本(留库)' });
    if (r.status === 201 || r.status === 200) { bk = r.data.booking; break outer; }
    if (r.data && r.data.error && r.data.error.code === 'REST_DAY') break;
  }
  A(bk, '翻转户排单失败');
  uid = bk.user.id;
  db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`fixture-openid-${uid}`, uid);
}
const mp = await connect();
const go = async (r, ms = 3200) => { await mp.reLaunch(r); await sleep(ms); return mp.currentPage(); };
async function inject() {
  const d = await fetch(BASE + '/auth/wechat/mini-login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'jics-nail' }, body: JSON.stringify({ demoLogin: true, tenantId: 'jics-nail', asUserId: uid }) }).then((r) => r.json());
  await mp.evaluate((a, u2) => { wx.setStorageSync('lucky_tenant', 'jics-nail'); wx.setStorageSync('lucky_mini_auth', Object.assign({}, a, { tenantId: 'jics-nail' })); wx.setStorageSync('lucky_member', { id: u2, _tenant: 'jics-nail' }); ['lucky_store_currency', 'lucky_store_deposit'].forEach((k) => wx.removeStorageSync(k)); }, d.auth, uid);
  return d.user;
}
const recharged = db.prepare("SELECT 1 FROM stored_value_transactions WHERE user_id = ? AND tenant_id = 'jics-nail' AND type IN ('recharge','migrate_opening') LIMIT 1").get(uid);
if (!recharged) {
  await inject();
  for (let i = 1; i <= 5; i += 1) {
    const p = await go('/pages/me/index');
    const m = await p.data('member');
    A(String(m.memberLevel) === '顾客' && m.tiersEnabled === false, `充值前第${i}次:称谓「${m.memberLevel}」≠「顾客」`);
    if (i === 1) await shot(mp, 'd41-before-guest');
    console.log(`充值前 ${i}/5 ✓ 称谓=顾客`);
  }
  const rc = await api('POST', '/admin/stored-value/recharge', { userId: uid, amountCents: 5000, payChannel: 'cash', note: 'D41 翻转实拍充值(¥50,留库)' });
  A(rc.status === 200 || rc.status === 201, '充值失败 ' + JSON.stringify(rc.data).slice(0, 120));
  console.log('—— 老板充值 ¥50 ——');
}
await inject();
for (let i = 1; i <= 5; i += 1) {
  const p = await go('/pages/me/index');
  const m = await p.data('member');
  A(String(m.memberLevel) === '会员', `充值后第${i}次:称谓「${m.memberLevel}」≠「会员」`);
  if (i === 1) await shot(mp, 'd41-after-member');
  console.log(`充值后 ${i}/5 ✓ 称谓=会员`);
}
await mp.disconnect();
console.log('D41 翻转实拍:前 5/5(顾客)+ 充值 → 后 5/5(会员)全绿');
