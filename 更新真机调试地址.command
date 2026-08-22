#!/bin/bash
# 真机调试:把这台 Mac 当前的局域网 IP 写进小程序 utils/devhost.js(手机与 Mac 须同一 Wi-Fi)
cd "$(dirname "$0")" || exit 1
IP="$(ipconfig getifaddr en0 2>/dev/null)"
[ -z "$IP" ] && IP="$(ipconfig getifaddr en1 2>/dev/null)"
if [ -z "$IP" ]; then
  echo "❌ 没拿到局域网 IP:先确认 Mac 已连上 Wi-Fi(有线用户改 en1/en2 试试)"
  read -n 1 -s -r -p "按任意键关闭"; exit 1
fi
PORT="${1:-4310}"
TODAY="$(date +%F)"
python3 - "$IP" "$PORT" "$TODAY" <<'PY'
import re, sys
ip, port, today = sys.argv[1], sys.argv[2], sys.argv[3]
p = 'miniprogram/utils/devhost.js'
s = open(p).read()
s = re.sub(r"lanHost: '[^']*'", f"lanHost: '{ip}'", s)
s = re.sub(r"port: \d+", f"port: {port}", s)
s = re.sub(r"updatedAt: '[^']*'", f"updatedAt: '{today}'", s)
s = re.sub(r"// 自动写入:[^\n]*", f"// 自动写入:{today}", s)
open(p, 'w').write(s)
print(f"✅ 已写入 utils/devhost.js:{ip}:{port}")
PY
echo ""
echo "手机上要能连通,还差两步(只需做一次):"
echo "  1) 微信开发者工具右上角「详情」→「本地设置」→ 勾上「不校验合法域名、web-view(业务域名)、TLS 版本以及 HTTPS 证书」"
echo "  2) 工具栏点「真机调试」→ 手机微信扫码;手机与这台 Mac 必须连同一个 Wi-Fi"
echo ""
echo "自检:下面这行应该回 {\"ok\":true...},回不了就是 Mac 防火墙挡了(系统设置→网络→防火墙→允许 node 接入)"
curl -s -m 3 "http://$IP:$PORT/health" || echo "(连不上)"
echo ""
read -n 1 -s -r -p "按任意键关闭"
