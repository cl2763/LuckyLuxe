#!/usr/bin/env bash
# J-34 · 造病还原的**唯一合法路径**(店主 2026-09-08 立,05r 补三)
#
# 立规起因是**同一件事发生了两次**:
#   · 2026-08-30(批次五六七):刀1 还原误用 `git checkout`,把重造页滚回旧版 —— 回执里叫「自伤事故」,
#     当时就写下了教训「变异一律 cp 备份还原,git checkout 禁入变异流程」;
#   · 2026-09-08(05r 补二 K10):我又用 `git checkout -- apps/web/admin.js` 还原,
#     一条命令把本批未提交的改动(文案表搬出 + 顶栏出口 + 退出清空)全抹了。
#   **上一次为什么没兜住:教训只写进了回执,没有装成护栏。** 这个文件就是那条护栏。
#
# 为什么 `git checkout --` 在造病流程里必错:它还原到的是 **HEAD**,不是「我造病之前那一刻」。
# 只要这个文件本批有未提交改动,两者就不是一回事 —— 而造病恰恰总在改完之后做。
#
# 用法:
#   bash tools/knife-backup.sh save <文件>...     # 造病前:存成 <文件>.pre-k
#   bash tools/knife-backup.sh restore <文件>...  # 造病后:拷回来,再删掉 .pre-k
#   bash tools/knife-backup.sh check              # 收工前:确认没有残留的 .pre-k
set -euo pipefail
cmd="${1:-}"; shift || true

case "$cmd" in
  save)
    [ $# -gt 0 ] || { echo "用法:bash tools/knife-backup.sh save <文件>..." >&2; exit 2; }
    for f in "$@"; do
      [ -f "$f" ] || { echo "🔴 没有这个文件:$f" >&2; exit 2; }
      # 已经存在 .pre-k = 上一把刀没收尾。**不许覆盖** —— 覆盖了就把真正的原始版盖掉了。
      [ -e "$f.pre-k" ] && { echo "🔴 $f.pre-k 已存在(上一把刀没还原?)。先 restore 再 save。" >&2; exit 2; }
      cp "$f" "$f.pre-k"
      echo "[刀] 已备份 $f → $f.pre-k"
    done
    ;;
  restore)
    [ $# -gt 0 ] || { echo "用法:bash tools/knife-backup.sh restore <文件>..." >&2; exit 2; }
    for f in "$@"; do
      [ -e "$f.pre-k" ] || { echo "🔴 找不到 $f.pre-k —— 没备份过就别还原(不许拿 git checkout 顶替)" >&2; exit 2; }
      cp "$f.pre-k" "$f"
      rm -f "$f.pre-k"
      echo "[刀] 已还原 $f(备份已删)"
    done
    ;;
  check)
    left=$(find . -name '*.pre-k' -not -path './.git/*' -not -path './node_modules/*' 2>/dev/null || true)
    if [ -n "$left" ]; then
      echo "🔴 还有没收尾的造病备份(说明某把刀没还原):" >&2
      echo "$left" | sed 's/^/    /' >&2
      exit 1
    fi
    echo "✅ 没有残留的 .pre-k"
    ;;
  *)
    echo "用法:bash tools/knife-backup.sh {save|restore|check} [文件...]" >&2
    exit 2
    ;;
esac
