#!/usr/bin/env bash
# 小程序自动化会话自愈(裁 #91 的期限件,店主 07n §七⑦ · 2026-09-14)
#
# 为什么要它:那三把小程序刀靠微信开发者工具的自动化端口驱动,而那个会话
# **不是回归脚本能保证活着的东西** —— 被上一轮超时打死之后不会自己回来。
# 现测两种长相都不好:①各 61s 超时 →「未跑」;②端口不可达 → 1s 打 0 条断言。
#
# 🔴 J-37③:**端口在听 ≠ 会话是活的**(07e 现踩:僵死时 lsof 照样看得见 9420)。
# 所以这里**先证死,再拉起,最后证活** —— 三步都做,不许只做中间那步。
set -u
cd "$(dirname "$0")/.."
CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
PORT="${MP_AUTO_PORT:-9420}"

alive() {   # 会话活着 = 它应答 WebSocket 升级(426),不是「端口有人听」
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}" 2>/dev/null)" = "426" ]
}

if alive; then echo "✅ ${PORT} 会话已经是活的(应答 426),不动它"; exit 0; fi

[ -x "$CLI" ] || { echo "🔴 找不到开发者工具 cli:$CLI —— 这台机器上装了吗?" >&2; exit 2; }
echo "① 证死:${PORT} 不应答 426,先把残留进程收掉"
pkill -f wechatwebdevtools 2>/dev/null || true
sleep 2
echo "② 拉起:cli auto --project $(pwd)/miniprogram --auto-port ${PORT}"
nohup "$CLI" auto --project "$(pwd)/miniprogram" --auto-port "$PORT" > /tmp/ll-mp-auto.log 2>&1 &
for i in $(seq 1 24); do alive && break; sleep 5; done
if alive; then
  echo "③ 证活:${PORT} 应答 426 —— 三把小程序刀这一轮跑得动"
else
  echo "🔴 ${PORT} 拉起来了但**不应答** —— 会话僵死,不是端口问题(J-37③)。" >&2
  echo "   日志末 5 行:" >&2; tail -5 /tmp/ll-mp-auto.log >&2
  echo "   这一轮那三把刀会**空转**,按红处理,不许当成通过。" >&2
  exit 1
fi
