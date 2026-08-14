/* 基线随机对账撤场:该 booking 的存活单全部撤回 → 预约 CANCELLED;券 grant 如未核销则作废接口?
 * 券:随机轮里若被核销进 voided 单会自动退回;残余 active grant 留档(演示户券包多一张,无碍口径)。 */
const BASE = 'http://127.0.0.1:4128';
const TOKEN = 'sess_msnk2ktp_tha9l7_3d1gp3gu';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('/tmp/base-grpfx.env', 'utf8').split('\n').filter(Boolean).map((l) => l.replace('export ', '').split('=')));
const api = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-tenant-id': 'jics-nail' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
(async () => {
  const sheets = (await api('GET', `/admin/settlements?bookingId=${env.FX_BOOKING}`)).data.settlements || [];
  for (const s of sheets) if (s.status === 'pending_sign') await api('POST', `/admin/settlements/${s.id}/void`, { reason: '基线对账撤场' });
  await api('PATCH', `/admin/bookings/${env.FX_BOOKING}/status`, { status: 'CANCELLED', note: '基线对账 fixture 撤单' });
  console.log('teardown ok');
})();
