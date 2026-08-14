/* 基线随机对账 fixture(正门):jics 用「演示2-jics-翻转验证户」(已绑已充,不动对照卡三户)
 * 造:①明晚一张预约 ②收定金 ¥100 留痕 ③发一张 满200减30 券 → 写 /tmp/base-grpfx.env */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4128';
const TOKEN = 'sess_msnk2ktp_tha9l7_3d1gp3gu';
const A = (c, m) => { if (!c) throw new Error(m); };
const db = new DatabaseSync('/Users/changliu/Documents/Codex/2026-04-29/new-chat/apps/api/local-data/lucky-luxe.sqlite', { readOnly: true });
const api = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-tenant-id': 'jics-nail' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const dOff = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const u = db.prepare("SELECT id FROM users WHERE tenant_id='jics-nail' AND display_name='演示2-jics-翻转验证户'").get();
A(u, '翻转户不在');
const techs = (await api('GET', '/admin/technicians?roster=1')).data.technicians;
const svc = (await api('GET', '/admin/pricing/items')).data.items.find((i) => i.itemKind === 'main' && i.isActive !== false);
let bk = null;
outer: for (const day of [1, 2, 3]) for (const t of ['21:30', '22:00', '21:00', '20:30']) for (const tech of techs.slice(0, 4)) {
  const r = await api('POST', '/admin/bookings/direct', { userId: u.id, serviceId: svc.id, technicianId: tech.id, date: dOff(day), time: t, notes: '基线随机对账 fixture,验后撤' });
  if (r.status === 201 || r.status === 200) { bk = r.data.booking; break outer; }
  if (r.data && r.data.error && r.data.error.code === 'REST_DAY') break;
}
A(bk, '排单失败');
const dr = await api('POST', `/admin/bookings/${bk.id}/deposit-receipt`, {});
A(dr.status === 200 || dr.status === 201, '定金收取失败 ' + JSON.stringify(dr.data).slice(0, 100));
const cps = (await api('GET', '/admin/coupons')).data.coupons || [];
const cp = cps.find((c) => c.isActive !== false && c.discountType === 'amount' && c.minSpendCents > 0) || cps.find((c) => c.isActive !== false && c.discountType === 'amount');
A(cp, '无在售满减券');
const g = await api('POST', `/admin/coupons/${cp.id}/grant`, { userId: u.id });
A(g.status === 201 || g.status === 200, '发券失败');
// 路由只回 code 不回 id —— 从库回捞该户最新 active grant 的 id
const db2 = new DatabaseSync('/Users/changliu/Documents/Codex/2026-04-29/new-chat/apps/api/local-data/lucky-luxe.sqlite', { readOnly: true });
const grantRow = db2.prepare("SELECT id FROM coupon_grants WHERE user_id = ? AND tenant_id = 'jics-nail' AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(u.id);
A(grantRow, 'grant 回捞失败');
const bal = db2.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM stored_value_transactions WHERE user_id = ? AND tenant_id = 'jics-nail'").get(u.id).s;
writeFileSync('/tmp/base-grpfx.env', `export FX_TOKEN=${TOKEN}\nexport FX_USER=${u.id}\nexport FX_BOOKING=${bk.id}\nexport FX_GRANT=${grantRow.id}\nexport FX_CPN_AMT=${cp.amountCents}\nexport FX_CPN_MIN=${cp.minSpendCents || 0}\nexport FX_DEP=10000\nexport FX_BAL=${bal}\n`);
console.log('fixture ok', bk.id, grantRow.id, cp.amountCents + '/' + (cp.minSpendCents || 0), 'bal=' + bal);
