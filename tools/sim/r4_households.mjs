/* 改判① 干净测试户 ×3(lucky-luxe 本地库,充值/消费/兑换全走新口径,对账与店主末验标准样本):
 * 01:充值 1000 → 签署消费 300 → 三行 300/0/300(充值不计积分,储值抵扣照常积分)
 * 02:签署消费 900 → 兑换 800 分奖品 → 三行 900/800/100
 * 03:签署消费 268 → 三行 268/0/268
 * 绑定=直连库写 wechat_open_id(CI ⑮ 同法);02 的兑换用与服务端同构的 mini token(HMAC 密钥
 * 读 .env,本机域)走 /my/points-mall/redeem 正门 —— 库存/限兑/余额闸全过,不绕账本。
 * 三户按店主指令留库不撤场(标准样本)。幂等:重跑先查同名档案,存在即跳过。 */
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4128';
const OWNER = 'owner-demo-token';
const ROOT = '/Users/changliu/Documents/Codex/2026-04-29/new-chat';
const DB = ROOT + '/apps/api/local-data/lucky-luxe.sqlite';
const A = (c, m) => { if (!c) throw new Error(m); };
async function api(m, p, b, tok, extra) {
  const r = await fetch(BASE + p, { method: m, headers: Object.assign({ authorization: `Bearer ${tok || OWNER}`, 'content-type': 'application/json' }, extra || {}), body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
/* 签名密钥与**正在跑的**服务进程一致:server 无 .env 自动加载,nohup 裸起时密钥链落到
   OWNER_TOKEN 字面量('owner-demo-token');若换 启动服务器.command 起(带 .env 导出)则是
   WECHAT_MINI_SECRET。两个候选逐个探测,探通为准。 */
const env = readFileSync(ROOT + '/apps/api/.env', 'utf8');
const envVal = (k) => (env.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, 'm')) || [])[1] || '';
const CANDIDATES = ['owner-demo-token', envVal('WECHAT_MINI_TOKEN_SECRET'), envVal('WECHAT_MINI_SECRET')].filter(Boolean);
let TOKEN_SECRET = CANDIDATES[0];
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mintTok = (uid) => { const p = b64u({ sub: uid, openid: `fixture-openid-${uid}`, exp: Date.now() + 3600000 }); return `mini.${p}.${createHmac('sha256', TOKEN_SECRET).update(p).digest('base64url')}`; };
async function pickSecret(anyBoundUid) {
  for (const c of CANDIDATES) {
    TOKEN_SECRET = c;
    const r = await api('GET', '/my/points-mall', null, mintTok(anyBoundUid), { 'x-tenant-id': 'lucky-luxe' });
    if (r.status === 200) { console.log('token 密钥候选命中(idx', CANDIDATES.indexOf(c), ')'); return; }
  }
  throw new Error('无候选密钥能通过 requireCustomer');
}

const db = new DatabaseSync(DB);
const dateOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const techs = (await api('GET', '/admin/technicians?roster=1')).data.technicians;
const svcRow = (await api('GET', '/admin/pricing/items')).data.items.find((i) => i.itemKind === 'main' && i.isActive !== false);
A(svcRow && techs.length, '发现 fixture 失败');

async function mkCust(name, slot) {
  const exist = db.prepare("SELECT id FROM users WHERE tenant_id = 'lucky-luxe' AND display_name = ?").get(name);
  if (exist) {
    const done = db.prepare("SELECT 1 FROM settlements WHERE user_id = ? AND tenant_id = 'lucky-luxe' AND status = 'signed' LIMIT 1").get(exist.id);
    if (done) { console.log(`${name} 已完整(有签署单),幂等跳过`); return null; }
    const bk0 = db.prepare("SELECT id FROM bookings WHERE user_id = ? AND tenant_id = 'lucky-luxe' ORDER BY created_at DESC LIMIT 1").get(exist.id);
    console.log(`${name} 半途存在,续跑(booking=${bk0 && bk0.id})`);
    return { id: bk0.id, user: { id: exist.id } };
  }
  for (const t of slot) {
    for (const tech of techs.slice(0, 4)) {
      const r = await api('POST', '/admin/bookings/direct', { newCustomerName: name, serviceId: svcRow.id, technicianId: tech.id, date: dateOffset(2), time: t, notes: '统一口径测试户建档单(标准样本,留库)' });
      if (r.status === 201 || r.status === 200) return r.data.booking;
    }
  }
  throw new Error(name + ' 建档排单失败:时段全占');
}
const uidOf = (b) => (b.user && b.user.id) || b.userId || b.user_id;
const bind = (uid) => db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`fixture-openid-${uid}`, uid);
async function settleSign(userId, bookingId, customName, cents) {
  const mk = await api('POST', '/admin/settlements', {
    userId, payerUserId: userId, cardOwnerUserId: userId, payIntent: 'offline_full',
    settlements: [{ bookingId, tierKey: 'list', items: [], customItems: [{ name: customName, amountCents: cents }], technicians: [{ technicianId: techs[0].id, role: 'main', itemNos: [] }], servedPersonName: '' }]
  });
  A(mk.status === 201, '开单失败 ' + JSON.stringify(mk.data).slice(0, 150));
  const st = mk.data.settlements[0];
  A(st.subtotalCents === cents, `小计 ${st.subtotalCents} ≠ ${cents}`);
  const sg = await api('POST', `/settlements/${encodeURIComponent(st.code)}/sign`, { signature: '测试户样本签', disclaimerAccepted: true }, null, { 'x-tenant-id': 'lucky-luxe' });
  A(sg.status === 200, '签署失败 ' + JSON.stringify(sg.data).slice(0, 120));
}
async function threeLines(uid, tag, want) {
  const tok = mintTok(uid);
  const r = await api('GET', '/my/points-mall', null, tok, { 'x-tenant-id': 'lucky-luxe' });
  A(r.status === 200, tag + ' points-mall ' + r.status);
  const got = `${r.data.earnedTotal}/${r.data.redeemedTotal}/${r.data.balance}`;
  A(got === want, `${tag} 三行 ${got} ≠ 预期 ${want}`);
  console.log(`${tag} 三行 ${got} ✓(正门 API 实测)`);
  return r.data;
}

// ── 01
{
  const bk = await mkCust('测试-统一口径-01', ['18:00', '18:30', '17:30']);
  if (bk) {
    bind(uidOf(bk));
    await pickSecret(uidOf(bk));
    const rc = await api('POST', '/admin/stored-value/recharge', { userId: uidOf(bk), amountCents: 100000, payChannel: 'wechat', note: '统一口径测试户充值(样本)' });
    A(rc.status === 200 || rc.status === 201, '充值失败 ' + JSON.stringify(rc.data).slice(0, 120));
    await settleSign(uidOf(bk), bk.id, '统一口径样本项A', 30000);
    await threeLines(uidOf(bk), '01', '300/0/300');
  }
}
// ── 02
{
  const bk = await mkCust('测试-统一口径-02', ['16:00', '16:30', '15:30']);
  if (bk) {
    bind(uidOf(bk));
    await settleSign(uidOf(bk), bk.id, '统一口径样本项B', 90000);
    const tok = mintTok(uidOf(bk));
    const prizes = (await api('GET', '/my/points-mall', null, tok, { 'x-tenant-id': 'lucky-luxe' })).data.prizes || [];
    const prize = prizes.find((x) => x.costPoints === 800) || prizes.find((x) => x.costPoints <= 900);
    A(prize, '无 ≤900 分在架奖品');
    const rd = await api('POST', '/my/points-mall/redeem', { prizeId: prize.id }, tok, { 'x-tenant-id': 'lucky-luxe' });
    A(rd.status === 200 || rd.status === 201, '兑换失败 ' + JSON.stringify(rd.data).slice(0, 140));
    await threeLines(uidOf(bk), '02', `900/${prize.costPoints}/${900 - prize.costPoints}`);
  }
}
// ── 03
{
  const bk = await mkCust('测试-统一口径-03', ['14:00', '14:30', '13:30']);
  if (bk) {
    bind(uidOf(bk));
    await settleSign(uidOf(bk), bk.id, '统一口径样本项C', 26800);
    await threeLines(uidOf(bk), '03', '268/0/268');
  }
}
console.log('干净测试户三户就绪(留库标准样本)');
