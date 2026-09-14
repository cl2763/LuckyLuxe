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
# 🔴 这里**不用 pkill**(09-14 现踩:`danger-cmd ④/⑤` 当场把它咬红了,而且咬得对)——
#    危险命令白名单上限 3、只减不增,要增得报店主;而**按端口收本来就更准**:
#    只打监听 9420 的那一个,不靠模式串去猜(`run-all-tests.sh` 收 4132 用的就是这个姿态)。
# 现踩两次,过程记着:
#   ①第一版用 `pkill -f wechatwebdevtools` —— `danger-cmd ④/⑤` 当场咬红,**咬得对**
#     (危险命令白名单上限 3、只减不增,要增得报店主);
#   ②改成按端口收(`lsof -ti tcp:9420 | xargs kill`)—— **不够**:只杀掉了监听的子进程,
#     整只工具还活着,`cli auto` 附上去但自动化口起不来,**证活那一步直接红**。
#   ③现在用开发者工具自己的 `cli quit`:它把整只工具**正经关掉**,既不用 pkill 也真的关得掉。
echo "① 证死:${PORT} 不应答 426,用 cli quit 把整只工具正经关掉(不用 pkill,也不靠杀端口)"
"$CLI" quit > /dev/null 2>&1 || true
sleep 3
echo "② 拉起:cli auto --project $(pwd)/miniprogram --auto-port ${PORT}"
nohup "$CLI" auto --project "$(pwd)/miniprogram" --auto-port "$PORT" > /tmp/ll-mp-auto.log 2>&1 &
for i in $(seq 1 24); do alive && break; sleep 5; done
if alive; then
  # 两层都报:**端口有人听**(lsof)与**会话是活的**(426)。
  # J-37③ 说的正是这两件事不是一回事 —— 所以判「活」只认 426,lsof 只作为附带信息。
  echo "③ 证活:${PORT} 应答 426 · lsof -ti tcp:${PORT} = $(lsof -ti tcp:"${PORT}" 2>/dev/null | tr '\n' ' ')"
  echo "   —— 三把小程序刀这一轮跑得动(**判活认 426,不认「端口有人听」**)"
else
  echo "🔴 ${PORT} 拉起来了但**不应答** —— 会话僵死,不是端口问题(J-37③)。" >&2
  echo "   日志末 5 行:" >&2; tail -5 /tmp/ll-mp-auto.log >&2
  echo "   这一轮那三把刀会**空转**,按红处理,不许当成通过。" >&2
  exit 1
fi
