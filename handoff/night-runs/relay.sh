#!/bin/bash
# 夜班接力拉起脚本(Cowork 用)。只在仓目录内、无人确认模式跑 Claude Code。
# 用法:bash handoff/night-runs/relay.sh [自定义提示词]
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
# 店主用 `claude setup-token` 生成的长期令牌放在 handoff/night-runs/.env.relay(gitignored),形如 CLAUDE_CODE_OAUTH_TOKEN=...
[ -f handoff/night-runs/.env.relay ] && set -a && . handoff/night-runs/.env.relay && set +a
cd /Users/changliu/Documents/Codex/2026-04-29/new-chat || exit 1
TS=$(date +%Y%m%dT%H%M%S)
LOG="handoff/night-runs/run_${TS}.log"
PROMPT="${1:-读 handoff/夜班令5_十小时接力_段7续到段11_Cowork每小时代审_2026-09-08.md、handoff/小批05r补五_dc623e9部分收_待裁5裁D150出口包一层改同一行_合并窗改4秒刷新12秒封顶_回归看门狗_段7续_2026-09-08.md、handoff/小批05q_店主六通打分与四条口径_D149平台密码登录_D150-D153_2026-09-07.md,以及 handoff/night-runs/ 下今晚的 进度_*.md 与 待裁_*.md。按夜班令 5 §〇 的段序,从还没完成的那一段开始做,段与段之间不停;待裁写文件跳下一段;停线照令。全部做完写夜班总结后退出。}"
if pgrep -f "claude -p" >/dev/null; then echo "已有接力进程在跑,不重复拉起"; exit 2; fi
nohup claude -p "$PROMPT" --dangerously-skip-permissions --output-format text --max-turns 400 < /dev/null > "$LOG" 2>&1 &
echo $! > handoff/night-runs/relay.pid
echo "started pid=$(cat handoff/night-runs/relay.pid) log=$LOG"
