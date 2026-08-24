#!/usr/bin/env bash
# 沙箱实例(4310)启动器 —— 演示 / 走查 / 双端实拍都连它。
#
# 为什么要有这个脚本:全量回归的 pkill 打的是**所有** local-server.mjs,沙箱一起被打死。
# run-all-tests.sh 跑完要把它还回去,但 macOS 拿不到别的进程的环境变量(DATA_DIR 探不到),
# 所以这里启动时把参数记到 /tmp/ll-sandbox-4310.env,回归结束照着这份记录原样拉回来。
# 2026-08-23 沙箱第二次被打死、店主正等着演示 —— 教训写进脚本,不靠记性。
#
# 🔴 2026-08-24:沙箱库从 /private/tmp/... 搬进**仓内固定目录** apps/api/sandbox-data/
#    临时目录被系统清理 = 4310 屡次「挂掉/数据不见」的根因。该目录已进 .gitignore,数据不入库。
#    不带参数就用这个默认目录;仍可显式传路径覆盖(老库迁移/多套数据对照时用)。
#
# 用法: bash apps/api/start-sandbox.sh [DATA_DIR 路径]
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="/tmp/ll-sandbox-4310.env"
DEFAULT_DATA_DIR="$(pwd)/sandbox-data"
DATA_DIR_ARG="${1:-}"
if [ -z "$DATA_DIR_ARG" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  DATA_DIR_ARG="${SANDBOX_DATA_DIR:-}"
fi
# 记录里若还是旧的临时目录(已被清理或即将被清理),一律回到仓内固定目录
case "$DATA_DIR_ARG" in
  /private/tmp/*|/tmp/*|'') DATA_DIR_ARG="$DEFAULT_DATA_DIR" ;;
esac
mkdir -p "$DATA_DIR_ARG"
printf 'SANDBOX_DATA_DIR=%s\nSANDBOX_PORT=4310\n' "$DATA_DIR_ARG" > "$ENV_FILE"
pkill -f "PORT=4310" 2>/dev/null || true
lsof -ti tcp:4310 2>/dev/null | xargs kill 2>/dev/null || true
PORT=4310 DATA_DIR="$DATA_DIR_ARG" ALLOW_DEMO_ADMIN_LOGIN=true TEST_DB_PATH= nohup node local-server.mjs > /tmp/ll-sandbox-4310.log 2>&1 &
for _ in $(seq 1 20); do
  if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4310/health"; then
    echo "== 沙箱 4310 已起 =="
    echo "   库路径: $DATA_DIR_ARG/lucky-luxe.sqlite"   # 一眼确认连的是哪个库(不再猜)
    curl -s --max-time 3 "http://127.0.0.1:4310/health"; echo
    exit 0
  fi
  sleep 0.5
done
echo "!! 沙箱没起来,看 /tmp/ll-sandbox-4310.log" >&2
exit 1
