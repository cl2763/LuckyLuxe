#!/usr/bin/env bash
# CI 专用:给沙箱种上那四套判据要的夹具(夜班令15 §二「(丙)」)
#
# 🔴 为什么要有它:CI 上 `apps/api/sandbox-data/` 不存在(gitignore),`ensureSandbox()` 起的是**空库** ——
# 沙箱服务是好的,缺的是**夹具数据**(09y §一 的裁定,夜15 §一 用「下游跑了」那条正例证过)。
# 于是 `correction-reason` / `tenant-ownership` / `tier-label` / `demo-mark` 四套造不出阳性,按 J-58① 只能红。
#
# 🔴 两条护栏一个字没动:
#   ① 种的是**临时 DATA_DIR**(不碰仓内 sandbox-data、不碰 4128);
#   ② 那个临时目录**以 `sandbox-data` 收尾** —— 种子自带的 `requireSandbox()` 只认路径里这一段,
#      所以「只种临时目录」与「只许沙箱」两条同时成立,**不用改任何护栏**。
# 🔴 夹具一律**走正门**(J-60):租户与顾客都用产品自己的 `/platform/*` 口,不直接写库。
set -euo pipefail
cd "$(dirname "$0")/.."
SB_DIR="${SANDBOX_DATA_DIR:?要先设 SANDBOX_DATA_DIR(必须以 /sandbox-data 收尾)}"
case "$SB_DIR" in *sandbox-data) : ;; *) echo "🔴 SANDBOX_DATA_DIR 必须以 sandbox-data 收尾(种子的 requireSandbox 只认这一段):$SB_DIR" >&2; exit 2 ;; esac
mkdir -p "$SB_DIR"
PORT_SB=4310

echo "① 起沙箱 → $SB_DIR"
( cd apps/api && bash start-sandbox.sh "$SB_DIR" > /tmp/ci-sandbox.log 2>&1 & )
for _ in $(seq 1 60); do curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$PORT_SB/health" && break; sleep 1; done
curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$PORT_SB/health" || { echo "🔴 沙箱拉不起来 —— 见 /tmp/ci-sandbox.log" >&2; tail -20 /tmp/ci-sandbox.log >&2; exit 1; }
echo "   ✅ 沙箱活着"

DB="$SB_DIR/lucky-luxe.sqlite"
echo "② 种样本单 + demo_seed(seed-demo-rich,直接对库,自带 requireSandbox 护栏)"
SEED_DB="$DB" node tools/seed-demo-rich.mjs > /tmp/ci-seed-rich.log 2>&1 || { echo "🔴 seed-demo-rich 失败"; tail -15 /tmp/ci-seed-rich.log >&2; exit 1; }

echo "③ 建 B 店(jics-nail)+ 一个顾客 —— 🔴 走正门(J-60),用产品自己的平台口"
SANDBOX_DATA_DIR="$SB_DIR" node --input-type=module -e "
const B='http://127.0.0.1:$PORT_SB'
const { requireOwnerToken } = await import('./apps/api/owner-token.mjs')
const T = requireOwnerToken({ dataDir: process.env.SANDBOX_DATA_DIR })
const H = { 'content-type':'application/json', authorization: 'Bearer '+T }
let r = await fetch(B+'/platform/tenants', { method:'POST', headers:H, body: JSON.stringify({ id:'jics-nail', name:\"Jie's Nail 小婕\", plan:'chain', currency:'CNY', timezone:'Asia/Shanghai' }) })
if (![200,201,409].includes(r.status)) { console.error('🔴 建租户失败 '+r.status+' '+(await r.text()).slice(0,200)); process.exit(1) }
console.log('   建租户 → '+r.status)
r = await fetch(B+'/platform/tenants/jics-nail/import/customers', { method:'POST', headers:H, body: JSON.stringify({ dryRun:false, rows:[{ displayName:'CI 夹具顾客', phone:'13900000001' }] }) })
if (!r.ok) { console.error('🔴 导顾客失败 '+r.status+' '+(await r.text()).slice(0,200)); process.exit(1) }
console.log('   导顾客 → '+r.status)
"

echo "④ 🔴 逐项验夹具真的在(不验就等于没种)"
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite'
const d = new DatabaseSync('$DB', { readOnly: true })
const n = (s) => { try { return d.prepare(s).get().n } catch { return -1 } }
const b = n(\"SELECT COUNT(*) n FROM users WHERE tenant_id='jics-nail'\")
const a = n(\"SELECT COUNT(*) n FROM bookings WHERE tenant_id='lucky-luxe' AND user_id IS NOT NULL\")
const m = n('SELECT COUNT(*) n FROM bookings WHERE demo_seed IS NOT NULL')
d.close()
console.log(\`   B店顾客=\${b} · A店样本单=\${a} · demo_seed=\${m}\`)
if (b < 1 || a < 1 || m < 1) { console.error('🔴 夹具没齐 —— 四套判据照样造不出阳性,不许假装种好了'); process.exit(1) }
console.log('   ✅ 三样夹具都在')
"
