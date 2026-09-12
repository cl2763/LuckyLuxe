#!/usr/bin/env bash
# 交付回执的抬头两行:**提交清单 + 领先数,都由脚本现出**(店主 07e 裁 #65)
#
# 立这条的由来:提交清单已经由脚本产出了,而**领先数还是手写的** ——
# 07d 我报「领先 main 286」,店主现测 **287**。小事,但它属于「同一份交付里,
# 一半的数是量的、一半是抄的」那一类。既然旁边那一行已经现出了,这一行就没理由不现出。
#
# 用法:bash tools/batch-footer.sh <上游提交>    例:bash tools/batch-footer.sh 7120440
set -u
BASE="${1:-}"
[ -n "$BASE" ] || { echo "用法:bash tools/batch-footer.sh <上游提交>" >&2; exit 2; }
cd "$(dirname "$0")/.."
git rev-parse --verify -q "$BASE" >/dev/null || { echo "🔴 认不出这个提交:$BASE" >&2; exit 2; }

N=$(git rev-list --count "$BASE..HEAD")
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '(没有 origin/main)')
HEAD_SHA=$(git rev-parse --short HEAD)

echo "> 本批提交(**$N** 个)· HEAD \`$HEAD_SHA\` · **领先 \`origin/main\` $AHEAD 个** ——"
echo "> 这三个数都由 \`bash tools/batch-footer.sh $BASE\` 现出,**一个都不手写**(裁 #65)"
echo ">"
git log --oneline "$BASE..HEAD" | sed 's/^/> /'
