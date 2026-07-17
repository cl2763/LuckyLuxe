#!/bin/bash
# Lucky Luxe 本地服务器一键启动(自动重载版)
# 只需启动一次并保持窗口开着:代码更新后服务器自动重启,浏览器刷新即可生效。
cd "$(dirname "$0")"
echo "正在停止旧的服务器进程..."
pkill -f "local-server.mjs" 2>/dev/null
sleep 1
NODE_BIN="/Users/changliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then NODE_BIN="node"; fi
echo "正在启动 Lucky Luxe 服务器(自动重载模式,端口 4128)..."
echo "访问: http://127.0.0.1:4128/admin"
echo "此窗口保持开着;按 Ctrl+C 停止服务器。"
ALLOW_DEMO_ADMIN_LOGIN=true PORT=4128 "$NODE_BIN" --env-file-if-exists=apps/api/.env --watch apps/api/local-server.mjs
