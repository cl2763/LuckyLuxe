#!/usr/bin/env bash
# Lucky Luxe 一键全量回归(本机或 CI 通用)
# 用法: bash apps/api/run-all-tests.sh
# 要求: Node 22+;在全新数据库上也能跑(自动填充演示数据)
set -euo pipefail
export ALLOW_DEMO_ADMIN_LOGIN=true  # 测试套件依赖演示登录路径(生产环境默认禁用)
cd "$(dirname "$0")"
API_DIR="$(pwd)"   # 绝对路径:restore_local 结束时要用,那时 cwd 可能已经变了

# 回归全程跑独立临时库(DATA_DIR),不碰 local-data 真实/演示库;结束时自动删除
export DATA_DIR="$(mktemp -d /tmp/ll-ci-data.XXXXXX)"
export TEST_DB_PATH="$DATA_DIR/lucky-luxe.sqlite"  # finance-core 直连库验证防篡改触发器时用
echo "== 测试数据目录: $DATA_DIR =="

cleanup() { pkill -f "local-server.mjs" 2>/dev/null || true; }

# 🔴 2026-08-09 拆脚枪:回归会 pkill 掉**店主正在用的本地服务**(4128),跑完不还回去 ——
# 店主再打开小程序就是"每个接口都连不上"的空壳,看起来像登录坏了。真相是后端被测试打死了。
# 现在:开跑前记下本地服务在不在,跑完自动拉回来(用真实 local-data,不是测试临时库)。
LOCAL_WAS_UP=0
if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4128/health"; then LOCAL_WAS_UP=1; fi
restore_local() {
  [ "$LOCAL_WAS_UP" = "1" ] || return 0
  curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4128/health" && return 0
  # 脚本开头已经 cd 进 apps/api 了,这里再 dirname $0 会踩空 —— 直接用绝对路径
  ( cd "$API_DIR" && PORT=4128 DATA_DIR="./local-data" TEST_DB_PATH= nohup node local-server.mjs > /tmp/ll-local-restored.log 2>&1 & )
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4128/health" && { echo "== 已把店主的本地服务(4128)重新拉起来 =="; return 0; }
    sleep 0.5
  done
  echo "!! 本地服务没拉回来,店主要用的话请双击 启动服务器.command" >&2
}
finish() { cleanup; [ -n "${DATA_DIR:-}" ] && rm -rf "$DATA_DIR"; restore_local; }
trap finish EXIT
cleanup; sleep 1

# 等实例真正就绪再发请求:轮询 /health 取代固定 sleep。
# 固定 sleep 在 CI 慢机器上会让测试抢跑(实例尚未 listen)→ tenant-isolation 报 "fetch failed"。
wait_health() {
  local port="$1" label="${2:-$1}" tries=60
  for _ in $(seq 1 "$tries"); do
    if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:${port}/health"; then return 0; fi
    sleep 0.5
  done
  echo "!! 实例 ${label} (端口 ${port}) 在 30s 内未就绪,中止" >&2
  return 1
}

# 沙盒隔离回归要用:给测试实例配上「看起来齐全但是假的」COS 钥匙 ——
# 目的是让 cosConfigured() 为真、再断言沙盒下 uploadAllowed 仍为假、快照走 inline。
# 值是假的,真要发请求也会失败;而按规则根本不该发。
export COS_SECRET_ID=test-fake-id
export COS_SECRET_KEY=test-fake-key
export COS_REGION=ap-test
export COS_BUCKET=test-bucket-1250000000

echo "== 启动主服务器 (4128) =="
PORT=4128 node local-server.mjs > /tmp/ll-ci-main.log 2>&1 &
wait_health 4128 "主服务器"
# 全新库没有订单数据:填充演示数据(幂等,已有数据时自动跳过)
curl -s -X POST -H "authorization: Bearer owner-demo-token" -H "content-type: application/json" \
  -d '{}' http://127.0.0.1:4128/admin/demo/full-seed > /dev/null || true

# 可用 CI_SUITES="a b c" 环境变量跑子集(调试用)
DEFAULT_SUITES="customer-service-matrix working-memory business-hours intent-guards quote-polish silent-handoff human-handoff after-sales-handoff identity-links entitlements tenant-kb finance-core finance-goals stored-value schedule-week special-dates customer-profile staff-portal admin-accounts pricing-model membership-config customer-import tenant-hygiene tenant-timezone deposit-config message-templates settlement daily-close salary-v2 schedule-v2 finance-trend finance-lock perf-viz coupon-settle audit-fix scan-sign double-sheet auth-surface currency-scan settle-stress sign-stability"
read -r -a SUITES <<< "${CI_SUITES:-$DEFAULT_SUITES}"
for suite in "${SUITES[@]}"; do
  echo "== test-${suite} =="
  node "test-${suite}.mjs"
done

echo "== 自动回归专用实例 (4129) =="
cleanup; sleep 1
PORT=4129 HUMAN_REPLY_COOLDOWN_MINUTES=0 node local-server.mjs > /tmp/ll-ci-4129.log 2>&1 &
wait_health 4129 "自动回归实例"
TEST_BASE_URL=http://127.0.0.1:4129 node test-auto-return.mjs

# 结构一致性:自己起一份全新库的实例(独立 DATA_DIR + 端口 4177),与其它套件互不干扰
echo "== test-schema-consistency =="
node test-schema-consistency.mjs

# 分成基数迁移:要重启实例才能验(迁移只在启动时跑),同样自带 DATA_DIR + 端口 4178
echo "== test-perf-base-migration =="
node test-perf-base-migration.mjs

echo "== 租户隔离双实例 (4128+4131) =="
cleanup; sleep 1
PORT=4128 node local-server.mjs > /tmp/ll-ci-a.log 2>&1 &
wait_health 4128 "租户A"
PORT=4131 DEFAULT_TENANT_ID=tenant-iso-b node local-server.mjs > /tmp/ll-ci-b.log 2>&1 &
wait_health 4131 "租户B"
node test-tenant-isolation.mjs

echo ""
echo "✅ 全部 41 个套件通过"
