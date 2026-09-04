#!/usr/bin/env bash
# 回执里「未动 / 有动」那一行 —— **由这把刀打印,人不许手写**(J-23,Cowork 05i §一 立规)
#
# 立规起因(05h 的真事,记着别再犯):
#   我把对照表原文老实贴进了回执 —— 上面写着「🔴 1 张表有差异,不许写『未动』」,
#   然后**在它下面两行手写了「本机库未动 —— 逐表零差异」**。
#   证据和结论互相打架,而且「逐表零差异」是**假话**(明明有一张表差了 5 行)。
#   「未动须有证」的本意是:**证据说什么,结论就写什么**。
#   人一旦有机会手写这一行,就有机会写错 —— 所以把这一行交给刀。
#
# 服务心跳表白名单:只有这里列的表,差异才不算「有动」。
#   每张表的**理由必须写在写它的那段代码旁**(随码复核律),这里只留指针。
HEARTBEAT_TABLES="notify_scan_marks"   # 理由见 apps/api/notify-scheduler.mjs(每天每店一行,4128 开着就长)
set -euo pipefail
SNAP="${1:?用法: bash tools/receipt-db-proof.sh <快照 json> [库绝对路径]}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${2:-$ROOT/apps/api/local-data/lucky-luxe.sqlite}"

# 快照刀**有差异时退出码非 0** —— 那是正常情况(差异要由下面判定是不是心跳表),
# 不能让 `set -e` 在这里把脚本掐死。第一版就栽在这:刀什么都没打印,exit=1。
OUT="$(node "$ROOT/tools/db-snapshot.mjs" "$DB" --diff "$SNAP" 2>&1 || true)"

# 🔴 快照刀「有差异」和「根本没跑起来」**都是退出码 1**,靠退出码分不出来。
#    造病时撞见过最坏的一幕:刀没跑成 → OUT 是报错文本 → 一条差异行都匹配不到 →
#    这里打印「✅ 未动 —— 逐表零差异」。**防假「未动」的工具,自己吐出了最假的那句「未动」。**
#    所以按**输出形状**验:跑成了一定有这一行表头;没有就是没跑成,硬报错,绝不往下走。
if ! echo "$OUT" | grep -q '「未动须有证」对照表'; then
  echo "🔴 快照对照**没跑成**(输出里没有表头)—— 不许据此下任何「未动」结论。原文:" >&2
  echo "$OUT" | head -5 >&2
  exit 2
fi
echo '**本机库对照表原文**(`node tools/db-snapshot.mjs <库绝对路径> --diff '"$SNAP"'`):'
echo
echo '```'
echo "$OUT" | tail -n +2
echo '```'
echo

# 差异行长这样:「  <表名>  行 25→30(+5) · …」;逐行判它是不是心跳表
DIFFS="$(echo "$OUT" | grep -E '^ +[a-z_]+ +行 ' || true)"
NON_HB=""
HB_SEEN=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  t="$(echo "$line" | awk '{print $1}')"
  is_hb=0
  for h in $HEARTBEAT_TABLES; do
    [ "$t" = "$h" ] && is_hb=1
  done
  if [ "$is_hb" = "1" ]; then
    HB_SEEN="$HB_SEEN$t "
  else
    NON_HB="$NON_HB$line"$'\n'
  fi
done <<< "$DIFFS"

if [ -n "$NON_HB" ]; then
  echo "🔴 **本机库:有动** —— 以下表不在服务心跳白名单里,**本批不许写「未动」**:"
  echo '```'
  echo "$NON_HB" | sed '/^$/d'
  echo '```'
elif [ -n "$HB_SEEN" ]; then
  echo "✅ **本机库:未动**(服务心跳表 \`${HB_SEEN% }\` 的行数增长除外 —— 调度器每天每店写一行,与本批代码无关)"
else
  echo "✅ **本机库:未动** —— 逐表零差异"
fi
