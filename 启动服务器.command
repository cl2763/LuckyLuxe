#!/bin/bash
# Lucky Luxe 本地服务器一键启动(自动重载版)
# 只需启动一次并保持窗口开着:代码更新后服务器自动重启,浏览器刷新即可生效。
cd "$(dirname "$0")"
echo "正在停止旧的服务器进程..."
pkill -f "local-server.mjs" 2>/dev/null
sleep 1
# 启动参数**只写在一处**:tools/start-local.sh(店主 07d 裁 #58④)。
# 原来这里和 run-all-tests.sh 的 restore_local 各写一套,两套还不一样 ——
# J-53 之后那个分叉变成了「每跑一次回归本机服务就死一次」。
exec bash tools/start-local.sh
