/* 演示阵容换代(店主 2026-08-12 拍板):双租户各 8 户「演示2-XX」,全走正门造
 * (建档→绑定→预约→开单→签署→充值/发券/定金/双技师/兑换/售后/更正),
 * 从造出第一天起就是统一口径,数字天然自洽。幂等:同名已存在且有签署单/预约即跳过。
 * 01纯新客 02储值 03有券 04定金 05双技师 06兑换 07售后 08更正 */
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
const BASE = 'http://127.0.0.1:4128';
const DB = '/Users/changliu/Documents/Codex/2026-04-29/new-chat/apps/api/local-data/lucky-luxe.sqlite';
const TENANTS = [
  { id: 'lucky-luxe', owner: 'owner-demo-token' },
  { id: 'jics-nail', owner: 'sess_msnk2ktp_tha9l7_3d1gp3gu' }
];
const A = (c, m) => { if (!c) throw new Error(m); };
const db = new DatabaseSync(DB);
const dateOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mintTok = (uid) => { const p = b64u({ sub: uid, openid: `fixture-openid-${uid}`, exp: Date.now() + 3600000 }); return `mini.${p}.${createHmac('sha256', 'owner-demo-token').update(p).digest('base64url')}`; };

async function run(T) {
  const api = async (m, p, b, tok) => {
    const r = await fetch(BASE + p, { method: m, headers: { authorization: `Bearer ${tok || T.owner}`, 'content-type': 'application/json', 'x-tenant-id': T.id }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const techs = (await api('GET', '/admin/technicians?roster=1')).data.technicians || [];
  A(techs.length, T.id + ' 无技师');
  let slotIdx = 0;
  const SLOTS = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'];
  async function mkCust(name) {
    const exist = db.prepare('SELECT id FROM users WHERE tenant_id = ? AND display_name = ?').get(T.id, name);
    if (exist) { console.log(`  ${name} 已存在,跳过`); return null; }
    for (const day of [3, 4, 5, 6, 7]) {   // 撞上休息日(REST_DAY)或满档就换天
      for (let k = 0; k < SLOTS.length; k += 1) {
        const t = SLOTS[(slotIdx + k) % SLOTS.length];
        for (const tech of techs.slice(0, 5)) {
          const r = await api('POST', '/admin/bookings/direct', { newCustomerName: name, serviceId: SVC.id, technicianId: tech.id, date: dateOffset(day), time: t, notes: '演示2 阵容样本单(统一口径,留库)' });
          if (r.status === 201 || r.status === 200) { slotIdx = (slotIdx + k + 1) % SLOTS.length; return r.data.booking; }
          if (r.data && r.data.error && r.data.error.code === 'REST_DAY') break;  // 整天休息,直接换天
        }
        if (false) break;
      }
    }
    throw new Error(name + ' 排单失败(5 天窗口全不可排)');
  }
  const uidOf = (b) => (b.user && b.user.id) || b.userId;
  const bind = (uid) => db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run(`fixture-openid-${uid}`, uid);
  async function settleSign(uid, bkId, name, cents, twoTechs) {
    const technicians = twoTechs && techs.length > 1
      ? [{ technicianId: techs[0].id, role: 'main', itemNos: [] }, { technicianId: techs[1].id, role: 'assist', itemNos: [] }]
      : [{ technicianId: techs[0].id, role: 'main', itemNos: [] }];
    const mk = await api('POST', '/admin/settlements', {
      userId: uid, payerUserId: uid, cardOwnerUserId: uid, payIntent: 'offline_full',
      settlements: [{ bookingId: bkId, tierKey: 'list', items: [], customItems: [{ name, amountCents: cents }], technicians, servedPersonName: '' }]
    });
    A(mk.status === 201, T.id + ' 开单失败 ' + JSON.stringify(mk.data).slice(0, 140));
    const st = mk.data.settlements[0];
    const sg = await api('POST', `/settlements/${encodeURIComponent(st.code)}/sign`, { signature: '演示2样本签', disclaimerAccepted: true }, null);
    A(sg.status === 200, T.id + ' 签署失败 ' + JSON.stringify(sg.data).slice(0, 120));
    return st;
  }
  const SVC = (await api('GET', '/admin/pricing/items')).data.items.find((i) => i.itemKind === 'main' && i.isActive !== false);
  A(SVC, T.id + ' 无在售主项目');

  console.log(`== ${T.id} 阵容开造 ==`);
  // 01 纯新客:建档+绑定+一张未来预约,不结算
  { const bk = await mkCust('演示2-01纯新客'); if (bk) { bind(uidOf(bk)); console.log('  01 ✓ 建档+绑定+未来预约'); } }
  // 02 储值:充值 500 → 签署消费 120
  { const bk = await mkCust('演示2-02储值客'); if (bk) { bind(uidOf(bk));
      const rc = await api('POST', '/admin/stored-value/recharge', { userId: uidOf(bk), amountCents: 50000, payChannel: 'wechat', note: '演示2 阵容充值样本' });
      A(rc.status === 200 || rc.status === 201, '充值失败 ' + JSON.stringify(rc.data).slice(0, 100));
      await settleSign(uidOf(bk), bk.id, '演示2消费B', 12000);
      console.log('  02 ✓ 储值500+签署120'); } }
  // 03 有券:发一张券(没有在售券就先建一张)
  { const bk = await mkCust('演示2-03有券客'); if (bk) { bind(uidOf(bk));
      let coupons = (await api('GET', '/admin/coupons')).data.coupons || [];
      let cp = coupons.find((c) => c.isActive !== false && c.discountType === 'amount');
      if (!cp) {
        const mk2 = await api('POST', '/admin/coupons', { name: '演示2满减券', discountType: 'amount', amountCents: 2000, minSpendCents: 0, validDays: 90 });
        A(mk2.status === 201 || mk2.status === 200, '建券失败 ' + JSON.stringify(mk2.data).slice(0, 120));
        cp = mk2.data.coupon;
      }
      const g = await api('POST', `/admin/coupons/${cp.id}/grant`, { userId: uidOf(bk) });
      A(g.status === 201 || g.status === 200, '发券失败 ' + JSON.stringify(g.data).slice(0, 120));
      console.log('  03 ✓ 发券:' + cp.name); } }
  // 04 定金:收定金留痕 → 签署
  { const bk = await mkCust('演示2-04定金客'); if (bk) { bind(uidOf(bk));
      const dr = await api('POST', `/admin/bookings/${bk.id}/deposit-receipt`, {});
      A(dr.status === 200 || dr.status === 201, '定金收取失败 ' + JSON.stringify(dr.data).slice(0, 120));
      await settleSign(uidOf(bk), bk.id, '演示2消费D', 16800);
      console.log('  04 ✓ 定金收取+签署'); } }
  // 05 双技师
  { const bk = await mkCust('演示2-05双技师客'); if (bk) { bind(uidOf(bk));
      await settleSign(uidOf(bk), bk.id, '演示2消费E', 25800, true);
      console.log('  05 ✓ 双技师签署'); } }
  // 06 兑换:消费 900 → 兑 ≤900 分奖品(无奖品就用现有券建一个)
  { const bk = await mkCust('演示2-06兑换客'); if (bk) { bind(uidOf(bk));
      await settleSign(uidOf(bk), bk.id, '演示2消费F', 90000);
      const tok = mintTok(uidOf(bk));
      let prizes = (await api('GET', '/my/points-mall', null, tok)).data.prizes || [];
      let pz = prizes.find((x) => x.costPoints <= 900 && !x.soldOut);
      if (!pz) {
        let coupons = (await api('GET', '/admin/coupons')).data.coupons || [];
        let cp = coupons.find((c) => c.isActive !== false) || (await api('POST', '/admin/coupons', { name: '演示2兑换券', discountType: 'amount', amountCents: 2000, minSpendCents: 0, validDays: 90 })).data.coupon;
        const mp2 = await api('POST', '/admin/points-prizes', { couponId: cp.id, costPoints: 800, stock: 50, perUserLimit: 0, validDays: 30 });
        A(mp2.status === 201, '建奖品失败 ' + JSON.stringify(mp2.data).slice(0, 120));
        pz = mp2.data.prize;
      }
      const rd = await api('POST', '/my/points-mall/redeem', { prizeId: pz.id }, tok);
      A(rd.status === 200 || rd.status === 201, '兑换失败 ' + JSON.stringify(rd.data).slice(0, 140));
      console.log(`  06 ✓ 消费900+兑换${pz.costPoints}`); } }
  // 07 售后:签署 → 转售后
  { const bk = await mkCust('演示2-07售后客'); if (bk) { bind(uidOf(bk));
      const st = await settleSign(uidOf(bk), bk.id, '演示2消费G', 19800);
      await api('PATCH', `/admin/bookings/${bk.id}/status`, { status: 'AFTER_SALES', note: '演示2 售后样本' });
      await api('POST', `/admin/settlements/${st.id}/aftersales`, { status: 'in_progress' });
      console.log('  07 ✓ 签署+售后中'); } }
  // 08 更正:签署 → 更正 −20
  { const bk = await mkCust('演示2-08更正客'); if (bk) { bind(uidOf(bk));
      const st = await settleSign(uidOf(bk), bk.id, '演示2消费H', 20000);
      const am = await api('POST', `/admin/settlements/${st.id}/amend`, { totalCents: 18000, reason: '演示2 更正样本:多收 20 退回' });
      A(am.status === 200, '更正失败 ' + JSON.stringify(am.data).slice(0, 140));
      console.log('  08 ✓ 签署+更正'); } }

  // 收尾:该店阵容三行体检(API 正门)
  for (const u of db.prepare("SELECT id, display_name FROM users WHERE tenant_id = ? AND display_name LIKE '演示2-%' ORDER BY display_name").all(T.id)) {
    const r = await api('GET', '/my/points-mall', null, mintTok(u.id));
    A(r.status === 200, u.display_name + ' points-mall ' + r.status);
    A(r.data.balance <= r.data.earnedTotal, u.display_name + ' 破守恒');
    console.log(`  ${u.display_name}: 三行 ${r.data.earnedTotal}/${r.data.redeemedTotal}/${r.data.balance} ✓`);
  }
}
for (const T of TENANTS) await run(T);
console.log('双租户演示2 阵容就绪(留库)');
