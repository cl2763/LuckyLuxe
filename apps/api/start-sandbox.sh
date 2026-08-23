#!/usr/bin/env bash
# 沙箱实例(4310)启动器 —— 演示 / 走查 / 双端实拍都连它。
#
# 为什么要有这个脚本:全量回归的 pkill 打的是**所有** local-server.mjs,沙箱一起被打死。
# run-all-tests.sh 跑完要把它还回去,但 macOS 拿不到别的进程的环境变量(DATA_DIR 探不到),
# 所以这里启动时把参数记到 /tmp/ll-sandbox-4310.env,回归结束照着这份记录原样拉回来。
# 2026-08-23 沙箱第二次被打死、店主正等着演示 —— 教训写进脚本,不靠记性。
#
# 用法: bash apps/api/start-sandbox.sh /path/to/data-dir   (不给就用上次记录的)
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="/tmp/ll-sandbox-4310.env"
DATA_DIR_ARG="${1:-}"
if [ -z "$DATA_DIR_ARG" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  DATA_DIR_ARG="${SANDBOX_DATA_DIR:-}"
fi
if [ -z "$DATA_DIR_ARG" ]; then
  echo "用法: bash apps/api/start-sandbox.sh <DATA_DIR 路径>(第一次要指定,之后会记住)" >&2
  exit 1
fi
printf 'SANDBOX_DATA_DIR=%s\nSANDBOX_PORT=4310\n' "$DATA_DIR_ARG" > "$ENV_FILE"
pkill -f "PORT=4310" 2>/dev/null || true
lsof -ti tcp:4310 2>/dev/null | xargs kill 2>/dev/null || true
PORT=4310 DATA_DIR="$DATA_DIR_ARG" ALLOW_DEMO_ADMIN_LOGIN=true TEST_DB_PATH= nohup node local-server.mjs > /tmp/ll-sandbox-4310.log 2>&1 &
for _ in $(seq 1 20); do
  if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4310/health"; then
    echo "== 沙箱 4310 已起(DATA_DIR=$DATA_DIR_ARG)=="
    curl -s --max-time 3 "http://127.0.0.1:4310/health"; echo
    exit 0
  fi
  sleep 0.5
done
echo "!! 沙箱没起来,看 /tmp/ll-sandbox-4310.log" >&2
exit 1
