/* 补强批:每店指定演示样板户(店与店名字/单量/内容/金额/币种全不同,一眼可分辨)
 * lucky : 演示2-lucky-美睫储值户 —— 美睫 3 单(268+198+238=704)+充值800+兑换600 → 三行 704/600/104,余额 CAD 800
 * jics  : 演示2-jics-美甲券户   —— 美甲 1 单 158 → 三行 158/0/158,券包 1 张,余额 ¥0
 * 试店  : 演示2-试店-样板户     —— 新建租户「五跳演示店」,2 单(88+66=154)→ 三行 154/0/154
 * demo_identity 配置写 tenant_settings;全部正门造;幂等。 */
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { appendFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4128';
const DB = '/Users/changliu/Documents/Codex/2026-04-29/new-chat/apps/api/local-data/lucky-luxe.sqlite';
const HOP_TENANT = 'hoptest-demo2';
const A = (c, m) => { if (!c) throw new Error(m); };
const db = new DatabaseSync(DB);
const dateOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mintTok = (uid) => { const p = b64u({ sub: uid, openid: `fixture-openid-${uid}`, exp: Date.now() + 3600000 }); return `mini.${p}.${createHmac('sha256', 'owner-demo-token').update(p).digest('base64url')}`; };
async function rawApi(m, p, b, tok, tid) {
  const r = await fetch(BASE + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: `Bearer ${tok}` } : {}, tid ? { 'x-tenant-id': tid } : {}), body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

/* ── 0. 五跳演示店:没有就建(平台正门,owner 首登改密,凭据记 本地自查账号.txt) ── */
let hopOwnerToken = '';
{
  const exists = db.prepare('SELECT 1 FROM tenants WHERE id = ?').get(HOP_TENANT);
  const CRED = '/Users/changliu/Documents/Codex/2026-04-29/new-chat/handoff/本地自查账号.txt';
  if (!exists) {
    const mk = await rawApi('POST', '/platform/tenants', { id: HOP_TENANT, name: '五跳演示店', plan: 'chain' }, 'owner-demo-token');
    A(mk.status === 201, '建店失败 ' + JSON.stringify(mk.data).slice(0, 140));
    const { username, initialPassword } = mk.data.owner;
    const first = await rawApi('POST', '/admin/auth/login', { email: username, password: initialPassword });
    const pass = 'Hop2026demo#1';
    await rawApi('POST', '/admin/auth/change-password', { oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }, first.data.auth.accessToken);
    appendFileSync(CRED, `\n五跳演示店(hoptest-demo2,补强批 2026-08-12 建,演示样板户所在测试店)\n  老板账号:${username} / ${pass}\n`);
    await rawApi('PUT', `/platform/tenants/${HOP_TENANT}/business-hours`, { hours: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, openTime: '09:00', closeTime: '22:00', isClosed: false })) }, 'owner-demo-token');
    await rawApi('POST', `/platform/tenants/${HOP_TENANT}/technicians`, { name: '试店技师' }, 'owner-demo-token');
    await rawApi('POST', `/platform/tenants/${HOP_TENANT}/services`, { type: 'NAIL', nameZh: '试店演示项目', nameEn: 'hop-demo', priceCents: 8800, depositCents: 0, baseDurationMin: 60 }, 'owner-demo-token');
    console.log('五跳演示店已建:', username);
  }
  // 登录拿会话(幂等:每次跑都重新登录)
  const credLine = '五跳演示店';
  const loginName = db.prepare("SELECT username FROM admin_accounts WHERE tenant_id = ? AND role = 'owner'").get(HOP_TENANT);
  const lg = await rawApi('POST', '/admin/auth/login', { email: loginName.username, password: 'Hop2026demo#1' });
  A(lg.status === 200, '试店登录失败 ' + JSON.stringify(lg.data).slice(0, 120));
  hopOwnerToken = lg.data.auth.accessToken;
}

const STORES = [
  { tid: 'lucky-luxe', owner: 'owner-demo-token', name: '演示2-lucky-美睫储值户',
    plan: { items: [['美睫·轻盈浓密(演示样单)', 26800], ['美睫·裸感自然(演示样单)', 19800], ['美睫·山茶花嫁接(演示样单)', 23800]], recharge: 80000, redeemCost: 600, coupon: false } },
  { tid: 'jics-nail', owner: 'sess_msnk2ktp_tha9l7_3d1gp3gu', name: '演示2-jics-美甲券户',
    plan: { items: [['美甲·日式渐变(演示样单)', 15800]], recharge: 0, redeemCost: 0, coupon: true } },
  { tid: HOP_TENANT, owner: () => hopOwnerToken, name: '演示2-试店-样板户',
    plan: { items: [['试店演示样单A', 8800], ['试店演示样单B', 6600]], recharge: 0, redeemCost: 0, coupon: false } }
];

for (const S of STORES) {
  const tok = typeof S.owner === 'function' ? S.owner() : S.owner;
  const api = (m, p, b, t) => rawApi(m, p, b, t === undefined ? tok : t, S.tid);
  const techs = (await api('GET', '/admin/technicians?roster=1')).data.technicians;
  const svc = (await api('GET', '/admin/pricing/items')).data.items.find((i) => i.itemKind === 'main' && i.isActive !== false);
  A(techs && techs.length && svc, S.tid + ' fixture 缺');
  const exist = db.prepare('SELECT id FROM users WHERE tenant_id = ? AND display_name = ?').get(S.tid, S.name);
  let uid;
  if (exist) { uid = exist.id; console.log(`${S.name} 已存在,幂等跳过造数`); }
  else {
    const SLOTS = ['09:30', '10:15', '11:15', '12:15', '13:15', '14:15', '15:15', '16:15', '18:15', '19:15'];
    let made = 0; let firstBk = null; const bks = [];
    outer: for (const day of [4, 5, 6, 7, 8]) {
      for (const t of SLOTS) {
        for (const tech of techs.slice(0, 5)) {
          const body = made === 0 ? { newCustomerName: S.name } : { userId: uid };
          const r = await api('POST', '/admin/bookings/direct', Object.assign({ serviceId: svc.id, technicianId: tech.id, date: dateOffset(day), time: t, notes: '指定样板户样单(对照卡,留库)' }, body));
          if (r.status === 201 || r.status === 200) {
            const bk = r.data.booking; uid = (bk.user && bk.user.id) || uid; bks.push(bk); made += 1;
            if (made >= S.plan.items.length) break outer;
          } else if (r.data && r.data.error && r.data.error.code === 'REST_DAY') break;
        }
      }
    }
    A(made === S.plan.items.length, `${S.name} 只排到 ${made}/${S.plan.items.length} 单`);
    db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`fixture-openid-${uid}`, uid);
    if (S.plan.recharge) {
      const rc = await api('POST', '/admin/stored-value/recharge', { userId: uid, amountCents: S.plan.recharge, payChannel: 'wechat', note: '样板户充值(对照卡)' });
      A(rc.status === 200 || rc.status === 201, '充值失败 ' + JSON.stringify(rc.data).slice(0, 100));
    }
    for (let i = 0; i < S.plan.items.length; i += 1) {
      const [nm, cents] = S.plan.items[i];
      const mk = await api('POST', '/admin/settlements', {
        userId: uid, payerUserId: uid, cardOwnerUserId: uid, payIntent: 'offline_full',
        settlements: [{ bookingId: bks[i].id, tierKey: 'list', items: [], customItems: [{ name: nm, amountCents: cents }], technicians: [{ technicianId: techs[0].id, role: 'main', itemNos: [] }], servedPersonName: '' }]
      });
      A(mk.status === 201, `${S.name} 开单${i}失败 ` + JSON.stringify(mk.data).slice(0, 140));
      const sg = await api('POST', `/settlements/${encodeURIComponent(mk.data.settlements[0].code)}/sign`, { signature: '样板户签', disclaimerAccepted: true }, null);
      A(sg.status === 200, `${S.name} 签署${i}失败`);
    }
    if (S.plan.redeemCost) {
      const ctok = mintTok(uid);
      const prizes = (await rawApi('GET', '/my/points-mall', null, ctok, S.tid)).data.prizes || [];
      const pz = prizes.find((x) => x.costPoints === S.plan.redeemCost && !x.soldOut);
      A(pz, `无 ${S.plan.redeemCost} 分奖品在架`);
      const rd = await rawApi('POST', '/my/points-mall/redeem', { prizeId: pz.id }, ctok, S.tid);
      A(rd.status === 200 || rd.status === 201, '兑换失败 ' + JSON.stringify(rd.data).slice(0, 140));
    }
    if (S.plan.coupon) {
      const cps = (await api('GET', '/admin/coupons')).data.coupons || [];
      const cp = cps.find((c) => c.isActive !== false && c.discountType === 'amount');
      A(cp, S.tid + ' 无在售券');
      const g = await api('POST', `/admin/coupons/${cp.id}/grant`, { userId: uid });
      A(g.status === 201 || g.status === 200, '发券失败');
    }
  }
  // demo_identity 落定(幂等覆盖)
  db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'demo_identity', ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(S.tid, JSON.stringify({ userId: uid, note: '补强批指定样板户(对照卡)' }), new Date().toISOString());
  // 三行+余额实测(对照卡数据源)
  const ctok = mintTok(uid);
  const mall = (await rawApi('GET', '/my/points-mall', null, ctok, S.tid)).data;
  const sv = (await rawApi('GET', '/my/stored-value', null, ctok, S.tid)).data;
  const who = (await rawApi('POST', '/auth/wechat/mini-login', { demoLogin: true, tenantId: S.tid }, null, S.tid)).data.user;
  console.log(`${S.tid} 样板户=${S.name} | demoLogin 选中=${who.displayName} | 三行 ${mall.earnedTotal}/${mall.redeemedTotal}/${mall.balance} | 余额分 ${sv.balanceCents} | 单量 ${who.visits ?? '-'} | 消费 ${who.totalSpentCents / 100}`);
  A(who.displayName === S.name, 'demoLogin 没选中样板户!');
}
console.log('三店指定样板户就绪');
