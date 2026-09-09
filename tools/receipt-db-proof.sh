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
#   🔴 裁 #23(店主 05w §四):`reminder_tasks` 准进,但**不许整表放行** ——
#   它是「同一行状态往前推」,不是「只多几行」,所以另加一把形状刀 `tools/heartbeat-shape.mjs`:
#   只有「只动 status/sent_at/updated_at、其余列一个字节不变」的行才放行,**并把放行的行逐条打印**。
HEARTBEAT_TABLES="notify_scan_marks reminder_tasks"   # 理由见 apps/api/notify-scheduler.mjs(每天每店一行/到点发一条,4128 开着就长)
# 需要过形状刀的表(在上面白名单里、且是「改既有行」那一类)
SHAPED_TABLES="reminder_tasks"
set -euo pipefail
SNAP="${1:?用法: bash tools/receipt-db-proof.sh <快照 json> [库绝对路径]}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${2:-$ROOT/apps/api/local-data/lucky-luxe.sqlite}"

# 🔴 库名不许写死(店主《库名口径》:报数与安全保证一律写全名,四个库四个名字)。
#    05r 补一 现踩:对沙箱库跑这把刀,它照样打印「**本机库:未动**」——
#    一份**专门用来防假「未动」的工具,自己把库名说错了**。名字含糊,这句保证就是含糊的。
case "$DB" in
  */local-data/*)   DBNAME="本机库" ;;
  */sandbox-data/*) DBNAME="沙箱库" ;;
  /app/apps/api/local-data/*) DBNAME="生产库" ;;   # 容器内 Volume 挂载点
  *)                DBNAME="未知库($DB)" ;;
esac

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
echo "**${DBNAME}对照表原文**(\`node tools/db-snapshot.mjs <库绝对路径> --diff $SNAP\`):"
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

# 🔴 J-29(店主 05p 补三 登记):**快照那把刀看不见 UPDATE。**
#    05o-2 实测:在库的副本上把一行既有数据改掉(不加行不删行),
#    逐行指纹当场红,而 `db-snapshot.mjs` **照样绿** —— 它比的是
#    逐表 行/列/索引/触发器/默认值,「行数没变、内容改了」它一栏都看不出来。
#    也就是说:以往凡靠它背书的「某某库未动」,严格说只证到了「结构与行数未动」。
#    裁定:**两把都绿才许打印「未动」**。
#    指纹快照默认取 `<快照>.fp.json`;**没有它就不许下任何「未动」结论**(fail-closed)。
FP="${3:-${SNAP%.json}.fp.json}"
if [ ! -f "$FP" ]; then
  echo "🔴 找不到逐行指纹快照 \`$FP\` —— **不许据此写「未动」**。" >&2
  echo "   开批时先打:node tools/tenant-fingerprint.mjs <库绝对路径> $FP" >&2
  exit 2
fi
FPOUT="$(node "$ROOT/tools/tenant-fingerprint.mjs" "$DB" --diff "$FP" 2>&1 || true)"
if ! echo "$FPOUT" | grep -q '逐租户指纹对照'; then
  echo "🔴 指纹对照**没跑成**(输出里没有表头)—— 不许据此下任何「未动」结论。原文:" >&2
  echo "$FPOUT" | head -5 >&2
  exit 2
fi
echo '**逐行指纹对照原文**(`node tools/tenant-fingerprint.mjs <库绝对路径> --diff '"$FP"'`):'
echo
echo '```'
echo "$FPOUT" | tail -n +2
echo '```'
echo
FP_DIRTY="$(echo "$FPOUT" | grep -E '旧行消失|整表消失|有租户整个消失' || true)"

# 🔴 裁 #23 的形状闸:指纹说「旧行消失」的那几行,如果**全都落在需过形状刀的表**上,
#    就交给 `heartbeat-shape.mjs` 逐行验形状 —— 过了才当心跳,没过照红。
#    形状刀的输出(含**放行清单**)原样贴进回执:店主要的是「几行、哪几个时刻」,不是一句「已放行」。
if [ -n "$FP_DIRTY" ]; then
  OTHER="$FP_DIRTY"
  for t in $SHAPED_TABLES; do OTHER="$(echo "$OTHER" | grep -v " $t " || true)"; done
  OTHER="$(echo "$OTHER" | sed '/^$/d')"
  if [ -z "$OTHER" ]; then
    SHAPEOUT="$(node "$ROOT/tools/heartbeat-shape.mjs" "$DB" "$FP" 2>&1 || echo "__SHAPE_FAILED__")"
    echo '**心跳形状刀原文**(`node tools/heartbeat-shape.mjs <库绝对路径> '"$FP"'`):'
    echo
    echo '```'
    echo "$SHAPEOUT"
    echo '```'
    echo
    case "$SHAPEOUT" in
      *__SHAPE_FAILED__*) : ;;                 # 形状没过 → FP_DIRTY 原样留着,下面照红
      *) FP_DIRTY="" ;;                        # 形状全过 → 这些「旧行消失」是心跳推进,不算有动
    esac
  fi
fi

if [ -n "$FP_DIRTY" ]; then
  echo "🔴 **${DBNAME}:有动** —— 逐行指纹查出既有行被改/被删(快照那把刀看不见这一类):"
  echo '```'
  echo "$FP_DIRTY"
  echo '```'
elif [ -n "$NON_HB" ]; then
  echo "🔴 **${DBNAME}:有动** —— 以下表不在服务心跳白名单里,**本批不许写「未动」**:"
  echo '```'
  echo "$NON_HB" | sed '/^$/d'
  echo '```'
elif [ -n "$HB_SEEN" ]; then
  echo "✅ **${DBNAME}:未动**(快照与逐行指纹**两把都绿**;服务心跳表 \`${HB_SEEN% }\` 除外 —— 调度器每天每店写一行、到点把 PENDING 推成 SENT,行行都过了形状刀,放行清单见上,与本批代码无关)"
else
  echo "✅ **${DBNAME}:未动** —— 快照逐表零差异 **且** 逐行指纹零旧行消失(两把都绿)"
fi
