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

# 🔴 2026-08-23 复发(第二次踩同一个坑):cleanup 的 pkill 打的是**所有** local-server.mjs,
# 不只是 4128 —— 沙箱 4310(演示/走查用,带 ALLOW_DEMO_ADMIN_LOGIN 和自己的 DATA_DIR)
# 同样被打死,而当时只还了 4128。店主打开小程序=登录失败,以为是功能坏了。
# 现在:开跑前把 4310 的 DATA_DIR 从进程环境里抓下来,跑完用同样参数拉回来。
# 教训写进脚本而不是靠记性 —— 靠记性已经漏过两次。
SANDBOX_WAS_UP=0
SANDBOX_DATA_DIR=""
if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4310/health"; then
  SANDBOX_WAS_UP=1
  # macOS 拿不到别的进程的环境变量(ps 探不到 DATA_DIR),所以读启动器留下的记录文件。
  # 沙箱请用 `bash apps/api/start-sandbox.sh <DATA_DIR>` 起,它会写这份记录。
  if [ -f /tmp/ll-sandbox-4310.env ]; then
    SANDBOX_DATA_DIR="$(grep '^SANDBOX_DATA_DIR=' /tmp/ll-sandbox-4310.env | head -1 | cut -d= -f2- || true)"
  fi
  echo "== 沙箱 4310 在跑(DATA_DIR=${SANDBOX_DATA_DIR:-未探到}),跑完会还回去 =="
fi
restore_sandbox() {
  [ "$SANDBOX_WAS_UP" = "1" ] || return 0
  curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4310/health" && return 0
  if [ -z "$SANDBOX_DATA_DIR" ]; then
    echo "!! 沙箱 4310 被回归打死了,但没探到它的 DATA_DIR —— 请手动用原来的命令拉起来" >&2
    return 0
  fi
  ( cd "$API_DIR" && PORT=4310 DATA_DIR="$SANDBOX_DATA_DIR" ALLOW_DEMO_ADMIN_LOGIN=true TEST_DB_PATH= nohup node local-server.mjs > /tmp/ll-sandbox-restored.log 2>&1 & )
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4310/health" && { echo "== 已把沙箱(4310)重新拉起来 =="; return 0; }
    sleep 0.5
  done
  echo "!! 沙箱 4310 没拉回来,演示/走查前请手动拉起" >&2
}
finish() { cleanup; [ -n "${DATA_DIR:-}" ] && rm -rf "$DATA_DIR"; restore_local; restore_sandbox; }
trap finish EXIT
cleanup; sleep 1

# 等实例真正就绪再发请求:轮询 /health 取代固定 sleep。
# 固定 sleep 在 CI 慢机器上会让测试抢跑(实例尚未 listen)→ tenant-isolation 报 "fetch failed"。
# 🔴 2026-09-03 店主亲自撞出的通道(03r):她在**自己的 4128 服务开着**的时候跑了一次全量回归。
# cleanup 的 pkill 发出去之后,脚本**立刻**起自己的 4128 并调 wait_health ——
# 而 wait_health 只问「/health 答不答话」,**正在死的那个店主服务照样答话**,
# 于是第一个套件连上了她的真库。这次是 08-24 那道测试护栏当场拒跑才没出事
# (本机库逐表对照零写入),但**通道是真的**:护栏顶住 ≠ 通道不存在。
#
# 两道闸,店主定的规格:**端口真空再起服 · 起完先验库域**。
#
# ① 端口真空:pkill 之后必须等到端口**真的没人答话**,才允许起自己的服务。
#    「还答得出话」就是还没空出来 —— 不问答话的是谁,问的是端口空没空。
wait_port_free() {
  local port="$1" label="${2:-$1}" tries=60
  for _ in $(seq 1 "$tries"); do
    curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:${port}/health" || return 0
    sleep 0.5
  done
  echo "!! 端口 ${port}(${label})30s 内没有空出来 —— 上面还挂着一个服务,很可能是店主正在用的。" >&2
  echo "!! 中止,不敢在别人的服务上面起自己的。" >&2
  return 1
}

# ② 验库域:起完之后**不看它自报什么**(/health 压根不下发库路径),
#    看**这个进程真正打开的是哪个 .sqlite 文件** —— 判据律:能验实物就别验元数据。
#    只要不在本轮的 CI 临时库目录下,一律中止,一个套件都不跑。
assert_db_domain() {
  local pid="$1" port="$2" tries=20 opened=""
  for _ in $(seq 1 "$tries"); do
    opened="$(lsof -p "$pid" 2>/dev/null | awk '/\.sqlite$/ {print $NF}' | sort -u | head -1)"
    [ -n "$opened" ] && break
    sleep 0.5
  done
  if [ -z "$opened" ]; then
    echo "!! 端口 ${port} 的实例(pid ${pid})拿不到它打开的库文件 —— 验不了库域就不许往下跑。" >&2
    return 1
  fi
  # 🔴 首跑就把自己咬红了,而红的是**合法的一轮**:macOS 上 /tmp 是 /private/tmp 的软链,
  # lsof 报的是解析后的真路径(/private/tmp/ll-ci-data.X),$DATA_DIR 是 mktemp 给的 /tmp/ll-ci-data.X。
  # 两个字符串不相等,库域其实完全正确 —— 一把**在正确状态下会红**的刀,
  # 迟早被人为了让它绿而放宽,那就再也守不住了。两边都取真路径再比。
  local want; want="$(cd "$DATA_DIR" 2>/dev/null && pwd -P)"
  local got; got="$(cd "$(dirname "$opened")" 2>/dev/null && pwd -P)/$(basename "$opened")"
  case "$got" in
    "$want"/*) echo "   [库域] 端口 ${port} → ${got}  ✔ 在本轮 CI 临时库内(${want})" ;;
    *)
      echo "!! 🔴 库域不对:端口 ${port} 的实例打开的是 ${got}" >&2
      echo "!! 本轮 CI 临时库是 ${want} —— 这正是 03r 那条通道。立刻中止。" >&2
      return 1 ;;
  esac
}

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
wait_port_free 4128 "主服务器"
PORT=4128 node local-server.mjs > /tmp/ll-ci-main.log 2>&1 &
CI_PID_4128=$!
wait_health 4128 "主服务器"
assert_db_domain "$CI_PID_4128" 4128
# 全新库没有订单数据:填充演示数据(幂等,已有数据时自动跳过)
curl -s -X POST -H "authorization: Bearer owner-demo-token" -H "content-type: application/json" \
  -d '{}' http://127.0.0.1:4128/admin/demo/full-seed > /dev/null || true

# 可用 CI_SUITES="a b c" 环境变量跑子集(调试用)
DEFAULT_SUITES="customer-service-matrix working-memory business-hours intent-guards quote-polish silent-handoff human-handoff after-sales-handoff identity-links entitlements tenant-kb finance-core finance-goals stored-value schedule-week special-dates customer-profile staff-portal admin-accounts pricing-model membership-config customer-import tenant-hygiene tenant-timezone deposit-config message-templates settlement daily-close salary-v2 schedule-v2 finance-trend finance-lock perf-viz coupon-settle audit-fix scan-sign double-sheet auth-surface currency-scan settle-stress sign-stability noshow-aftersales demo-seed-guard card-refund amend-linkage ledger-guards backend-gate hero-slides cash-notes mini-money-inputs image-placeholder deposit-audit web-settlement cross-end-effect mini-account-adjust today-board hours-gate crossend-cta tab-colors notify-scheduler quote-state ui-spec observe-fixes file-ratchet delivery-evidence store-name correction-reason credential-scan db-target-guard empty-pill untouched-proof display-text mp-placeholder-size mp-overlap mp-home-sections store-jury"
read -r -a SUITES <<< "${CI_SUITES:-$DEFAULT_SUITES}"

# 🔴 断言基线(店主 02r 裁定一):每套跑完**就地数** `^ok ` 条数,不事后解析日志 ——
# 日志里 auto-return / tenant-isolation 两套没有 `== test-X ==` 行,解析法会张冠李戴。
TALLY="$DATA_DIR/assertion-tally.tsv"; : > "$TALLY"
SUITE_OUT="$DATA_DIR/suite-out.txt"
run_suite() {   # $1=套件名 $2..=node 前缀环境(可空)
  local name="$1"; shift
  "$@" node "test-${name}.mjs" 2>&1 | tee "$SUITE_OUT"
  printf '%s\t%s\n' "$name" "$(grep -c '^ok ' "$SUITE_OUT" || true)" >> "$TALLY"
}

for suite in "${SUITES[@]}"; do
  echo "== test-${suite} =="
  run_suite "$suite" env
done

echo "== 自动回归专用实例 (4129) =="
cleanup; sleep 1
wait_port_free 4129 "冷却实例"
PORT=4129 HUMAN_REPLY_COOLDOWN_MINUTES=0 node local-server.mjs > /tmp/ll-ci-4129.log 2>&1 &
CI_PID_4129=$!
wait_health 4129 "自动回归实例"
run_suite auto-return env TEST_BASE_URL=http://127.0.0.1:4129

# 结构一致性:自己起一份全新库的实例(独立 DATA_DIR + 端口 4177),与其它套件互不干扰
echo "== test-schema-consistency =="
run_suite schema-consistency env

# 分成基数迁移:要重启实例才能验(迁移只在启动时跑),同样自带 DATA_DIR + 端口 4178
echo "== test-perf-base-migration =="
run_suite perf-base-migration env

echo "== 租户隔离双实例 (4128+4131) =="
cleanup; sleep 1
wait_port_free 4128 "隔离A"
PORT=4128 node local-server.mjs > /tmp/ll-ci-a.log 2>&1 &
CI_PID_4128=$!
wait_health 4128 "租户A"
wait_port_free 4131 "隔离B"
PORT=4131 DEFAULT_TENANT_ID=tenant-iso-b node local-server.mjs > /tmp/ll-ci-b.log 2>&1 &
CI_PID_4131=$!
wait_health 4131 "租户B"
run_suite tenant-isolation env

echo ""
# 🔴 断言基线判定(店主 02r 裁定一):降=红并指名哪一套;涨自动更新基线。
# 排在全部套件之后 —— 它要看的是"全场的逐套件数",站在中间看不全。
echo "== test-assertion-baseline =="
node test-assertion-baseline.mjs "$TALLY" "$(( $(echo $DEFAULT_SUITES | wc -w) + 4 ))"

echo ""
# 套件数从清单现算,不写死 —— 写死的数字会随加套件慢慢变成假话
echo "✅ 全部 $(( $(echo $DEFAULT_SUITES | wc -w) + 4 )) 个套件通过(清单 $(echo $DEFAULT_SUITES | wc -w) + auto-return/schema-consistency/perf-base-migration/tenant-isolation)"
