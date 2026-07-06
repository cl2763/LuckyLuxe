#!/usr/bin/env bash
# Lucky Luxe 一键全量回归(本机或 CI 通用)
# 用法: bash apps/api/run-all-tests.sh
# 要求: Node 22+;在全新数据库上也能跑(自动填充演示数据)
set -euo pipefail
export ALLOW_DEMO_ADMIN_LOGIN=true  # 测试套件依赖演示登录路径(生产环境默认禁用)
cd "$(dirname "$0")"

cleanup() { pkill -f "local-server.mjs" 2>/dev/null || true; }
trap cleanup EXIT
cleanup; sleep 1

echo "== 启动主服务器 (4128) =="
PORT=4128 node local-server.mjs > /tmp/ll-ci-main.log 2>&1 &
sleep 3
# 全新库没有订单数据:填充演示数据(幂等,已有数据时自动跳过)
curl -s -X POST -H "authorization: Bearer owner-demo-token" -H "content-type: application/json" \
  -d '{}' http://127.0.0.1:4128/admin/demo/full-seed > /dev/null || true

# 可用 CI_SUITES="a b c" 环境变量跑子集(调试用)
DEFAULT_SUITES="customer-service-matrix working-memory business-hours intent-guards quote-polish silent-handoff human-handoff after-sales-handoff identity-links entitlements tenant-kb finance-core finance-goals stored-value schedule-week special-dates customer-profile staff-portal admin-accounts"
read -r -a SUITES <<< "${CI_SUITES:-$DEFAULT_SUITES}"
for suite in "${SUITES[@]}"; do
  echo "== test-${suite} =="
  node "test-${suite}.mjs"
done

echo "== 自动回归专用实例 (4129) =="
cleanup; sleep 1
PORT=4129 HUMAN_REPLY_COOLDOWN_MINUTES=0 node local-server.mjs > /tmp/ll-ci-4129.log 2>&1 &
sleep 3
TEST_BASE_URL=http://127.0.0.1:4129 node test-auto-return.mjs

echo "== 租户隔离双实例 (4128+4131) =="
cleanup; sleep 1
PORT=4128 node local-server.mjs > /tmp/ll-ci-a.log 2>&1 &
sleep 2
PORT=4131 DEFAULT_TENANT_ID=tenant-iso-b node local-server.mjs > /tmp/ll-ci-b.log 2>&1 &
sleep 3
node test-tenant-isolation.mjs

echo ""
echo "✅ 全部 21 个套件通过"
