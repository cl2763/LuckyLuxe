#!/usr/bin/env bash
# 本机服务(4128)的**唯一启动出口**(店主 07d 裁 #58④,2026-09-12)
#
# ══ 为什么要收成一处 ══
# 同一台服务原来有**两套启动参数**,而且两套不一样:
#
#   |                                   | 启动服务器.command | run-all-tests.sh 的 restore_local |
#   | --env-file-if-exists=apps/api/.env | ✅                 | ❌  ← J-53 之后这一条要命          |
#   | ALLOW_DEMO_ADMIN_LOGIN=true        | ✅                 | ❌                                 |
#   | HOST=0.0.0.0                       | ✅                 | ❌  ← 没有它手机连不上做真机调试    |
#   | --watch                            | ✅                 | ❌                                 |
#
# **J-53 之前这个分叉是隐形的**(服务照样起得来,只是少了几样);
# J-53 之后它变成了「**每跑一次回归,店主的本机服务就死一次,而且拉不回来**」——
# 因为 restore 那一套读不到 `.env` 里那把钥匙,闸就把它拒了,
# 而原因埋在 `/tmp/ll-local-restored.log` 里,屏幕上只剩一句「没拉回来」。
#
# 归族「一件事一处真相」:**两个地方各写一套本身就是分叉,J-53 只是把它照出来了。**
#
# 用法:
#   bash tools/start-local.sh          # 前台 + --watch(店主双击那个 .command 走这条)
#   bash tools/start-local.sh --bg     # 后台 nohup,不带 --watch(回归 restore_local 走这条)
#   bash tools/start-local.sh --print  # 只把参数打出来,不启动(给判据看的)
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

# ── 参数**只在这里写一次** ──
LL_PORT="${LL_PORT:-4128}"
LL_HOST="${LL_HOST:-0.0.0.0}"          # 没有它手机连不上(真机调试)
LL_DATA_DIR="${LL_DATA_DIR:-$ROOT/apps/api/local-data}"
LL_ENV_FILE="apps/api/.env"            # 店主那把钥匙住在这里;**本脚本只把路径给 node,不读它**
LL_DEMO="${ALLOW_DEMO_ADMIN_LOGIN:-true}"
NODE_BIN="/Users/changliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="node"

if [ "${1:-}" = "--print" ]; then
  echo "NODE_BIN=$NODE_BIN"
  echo "ENV_FILE=$LL_ENV_FILE"
  echo "HOST=$LL_HOST PORT=$LL_PORT ALLOW_DEMO_ADMIN_LOGIN=$LL_DEMO"
  echo "DATA_DIR=$LL_DATA_DIR"
  exit 0
fi

# 🔴 **回归专用环境变量一律清掉**(D163):这台是给店主用的**活服务**,
#    不许带着回归那一轮的 `MERGE_WINDOW_SECONDS=0` 之类跑 —— 收尾自证当场会咬(现测咬到过)。
#    原来这件事写在 run-all-tests.sh 的 `env_clean` 里;收敛启动出口时我漏了它,
#    结果 4128 起回来是「合并窗 0s」。**清单收在这里**:任何调用方都拿到一台干净的服务。
REGRESSION_ONLY_ENV="MERGE_WINDOW_MS TEST_DB_PATH ALLOW_DEMO_ADMIN_LOGIN COS_SECRET_ID COS_SECRET_KEY COS_REGION COS_BUCKET"
CLEAN=(); for v in $REGRESSION_ONLY_ENV; do CLEAN+=(-u "$v"); done

if [ "${1:-}" = "--bg" ]; then
  LOG=${LL_LOG:-/tmp/ll-local-restored.log}
  # 🔴 赋值必须排在 `-u` **之后**:`env` 按参数顺序处理,放前面会被 -u 抹掉。
  #    自查时就栽在这:`--bg` 起来的 4128 报 demoLogin=false,而 `启动服务器.command` 那条是 true ——
  #    **两条路又不一样了**,正是这次收敛要消灭的东西。两支现在逐字同序。
  nohup env "${CLEAN[@]}" ALLOW_DEMO_ADMIN_LOGIN="$LL_DEMO" HOST="$LL_HOST" PORT="$LL_PORT" DATA_DIR="$LL_DATA_DIR" \
    "$NODE_BIN" --env-file-if-exists="$LL_ENV_FILE" apps/api/local-server.mjs > "$LOG" 2>&1 &
  exit 0
fi

echo "正在启动本机服务器(自动重载模式,端口 $LL_PORT)..."   # 不写店名:店名判据是白名单式,白名单只减不增
echo "访问: http://127.0.0.1:$LL_PORT/admin  (真机调试用局域网IP,启动后另行查看)"
echo "此窗口保持开着;按 Ctrl+C 停止服务器。"
exec env "${CLEAN[@]}" ALLOW_DEMO_ADMIN_LOGIN="$LL_DEMO" HOST="$LL_HOST" PORT="$LL_PORT" DATA_DIR="$LL_DATA_DIR" \
  "$NODE_BIN" --env-file-if-exists="$LL_ENV_FILE" --watch apps/api/local-server.mjs
