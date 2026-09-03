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
# 用法: bash apps/api/start-sandbox.sh [DATA_DIR 路径] [--ai-env <env 文件>]
#
# --ai-env(04a §四,AI 复测 12 场景用):**可选**,不传 = 现状一个字不变(mock,不花钱)。
#   传了就 node --env-file-if-exists=<文件> 起 —— 文件里只放五行 AI_*,
#   **不要**把 apps/api/.env 整份喂进来:那里面同住生产令牌与三家外部密钥,
#   等于把生产钥匙塞进一个演示/走查用的进程(最小授权)。
set -euo pipefail
# 🔴 2026-08-24:传相对路径会踩坑 —— 下面 cd 到 apps/api 之后,
#   `apps/api/sandbox-data` 会变成 apps/api/apps/api/sandbox-data(新建空库,看起来像"数据又没了")。
#   所以先在**调用者的当前目录**里把相对路径展开成绝对路径,再 cd。
ORIG_PWD="$(pwd)"
# --ai-env <文件>:从参数里摘出来,剩下的仍按「第一个位置参数 = DATA_DIR」处理
AI_ENV=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ai-env) AI_ENV="${2:-}"; shift 2 ;;
    --ai-env=*) AI_ENV="${1#--ai-env=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}
if [ -n "$AI_ENV" ]; then
  case "$AI_ENV" in /*) : ;; *) AI_ENV="$ORIG_PWD/$AI_ENV" ;; esac
  [ -f "$AI_ENV" ] || { echo "!! --ai-env 指的文件不存在:$AI_ENV" >&2; exit 1; }
fi
if [ -n "${1:-}" ]; then
  case "$1" in
    /*) : ;;                       # 已是绝对路径
    *) set -- "$ORIG_PWD/$1" ;;    # 相对路径按调用者目录展开
  esac
fi
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
# 🔴 连 AI env 与门档一起记(2026-09-04 补)。原来只记 DATA_DIR + PORT ——
#    于是全量回归的 restore_sandbox 把沙箱拉回来时**丢掉了真模型**,变成 mock,
#    而谁也不会注意到:接口照样 200,只是 AI 换了个脑子。
#    「还回去」得是**还回原来那个状态**,不是「有个东西在 4310 上听着」。
printf 'SANDBOX_DATA_DIR=%s\nSANDBOX_PORT=4310\nSANDBOX_AI_ENV=%s\nSANDBOX_AI_GATE=%s\n' \
  "$DATA_DIR_ARG" "${AI_ENV:-}" "${AI_GATE:-}" > "$ENV_FILE"
pkill -f "PORT=4310" 2>/dev/null || true
lsof -ti tcp:4310 2>/dev/null | xargs kill 2>/dev/null || true
NODE_ARGS=()
if [ -n "$AI_ENV" ]; then
  NODE_ARGS+=("--env-file-if-exists=$AI_ENV")
  echo "   ⚠️ 带 AI env 起沙箱:$AI_ENV(真模型会**真花钱**;不传 --ai-env 就是现状 mock)"
fi
PORT=4310 DATA_DIR="$DATA_DIR_ARG" ALLOW_DEMO_ADMIN_LOGIN=true TEST_DB_PATH= nohup node ${NODE_ARGS[@]+"${NODE_ARGS[@]}"} local-server.mjs > /tmp/ll-sandbox-4310.log 2>&1 &
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
