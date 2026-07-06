#!/bin/bash
# 双击执行:让 Claude Code 无头执行 handoff/本机任务.md 里的任务队列
# 权限范围刻意收窄:自动允许 文件读写编辑 + git add/commit/push/status/log + npm install;
# 其他命令(删除、系统操作等)无头模式下不会执行,会记录到结果文件里等人工处理。
cd "$(dirname "$0")"

# 代理(Claude API 需要):7890 不通就提醒并退出
if ! nc -z 127.0.0.1 7890 2>/dev/null; then
  echo "⚠ 代理客户端没开(127.0.0.1:7890 不通),请先打开代理再双击本文件。"
  read -n 1 -s -r -p "按任意键关闭..."
  exit 1
fi
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890

if ! command -v claude >/dev/null 2>&1; then
  echo "⚠ 找不到 claude 命令,请先安装 Claude Code。"
  read -n 1 -s -r -p "按任意键关闭..."
  exit 1
fi

echo "== 开始执行 handoff/本机任务.md 的任务队列 =="
claude -p "读取 handoff/本机任务.md 并严格按其中的执行规则完成任务队列,结果写入 handoff/本机任务结果.md(覆盖旧内容,注明本次执行时间)。" \
  --allowedTools "Read" "Write" "Edit" "Glob" "Grep" \
  "Bash(git add:*)" "Bash(git commit:*)" "Bash(git push:*)" "Bash(git status:*)" "Bash(git log:*)" "Bash(git diff:*)" \
  "Bash(npm install:*)" "Bash(node --check:*)" "Bash(bash apps/api/run-all-tests.sh:*)" \
  --max-turns 40

echo ""
echo "== 执行结束,结果已写入 handoff/本机任务结果.md,回 Cowork 告诉 Claude 审查即可 =="
read -n 1 -s -r -p "按任意键关闭..."
