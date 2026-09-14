#!/usr/bin/env bash
# 交付回执的抬头两行:**提交清单 + 领先数,都由脚本现出**(店主 07e 裁 #65)
#
# 立这条的由来:提交清单已经由脚本产出了,而**领先数还是手写的** ——
# 07d 我报「领先 main 286」,店主现测 **287**。小事,但它属于「同一份交付里,
# 一半的数是量的、一半是抄的」那一类。既然旁边那一行已经现出了,这一行就没理由不现出。
#
# 🔴 裁 #93(店主 07m §二,2026-09-14)· **两个数要能互相对上**
#
# 案由:上一批回执写「领先 302」,本批写「5 个提交 · 领先 305」。**302 + 5 = 307 ≠ 305。**
# 查清后是**两个数不是同一把尺子量的**(J-39):
#   · 那个 302 是在 `128a040` 上读的,而**同一句里的「本批 1 个提交」是错的** ——
#     那一刻夜11 已经有 2 个提交,加上回执那一个是 3 个;
#   · 而 07l 的「5」是拿**夜11 的开批点 `fc0195f`** 当基准打出来的,不是 07l 自己的开批点。
#   · **没有任何提交丢失**(reflog 里本区间零 amend/rebase/squash)。
#
# 所以这里加两道:
#   ① **把基准写进输出**,读的人一眼看得见这个「本批 N 个」是从哪儿数的;
#   ② **跨批账本**:每次现出都往 `handoff/night-runs/领先账本.tsv` 记一行,
#      下一次自动核「上批领先 + 这中间的提交数 = 本批领先」,对不上**当场红**。
#      这一条才是真护栏 —— ① 只是让人看得见,② 是机器在对。
set -u
BASE="${1:-}"
[ -n "$BASE" ] || { echo "用法:bash tools/batch-footer.sh <上游提交>" >&2; exit 2; }
cd "$(dirname "$0")/.."
git rev-parse --verify -q "$BASE" >/dev/null || { echo "🔴 认不出这个提交:$BASE" >&2; exit 2; }
git merge-base --is-ancestor "$BASE" HEAD 2>/dev/null || {
  echo "🔴 \`$BASE\` 不是 HEAD 的祖先 —— 「本批 N 个」就没有意义了(尺子的起点不在这条线上)" >&2; exit 2; }

N=$(git rev-list --count "$BASE..HEAD")
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '')
HEAD_SHA=$(git rev-parse --short HEAD)
BASE_SHA=$(git rev-parse --short "$BASE")
BASE_AHEAD=$(git rev-list --count origin/main.."$BASE" 2>/dev/null || echo '')

LEDGER="handoff/night-runs/领先账本.tsv"
RED=0

# ── ② 跨批对账:上一条记录 + 这中间的提交数 = 现在的领先数 ──
if [ -s "$LEDGER" ]; then
  LAST_SHA=$(tail -1 "$LEDGER" | cut -f1)
  LAST_AHEAD=$(tail -1 "$LEDGER" | cut -f2)
  if git rev-parse --verify -q "$LAST_SHA" >/dev/null && git merge-base --is-ancestor "$LAST_SHA" HEAD 2>/dev/null; then
    SINCE=$(git rev-list --count "${LAST_SHA}..HEAD")
    EXPECT=$(( LAST_AHEAD + SINCE ))
    if [ "$EXPECT" != "$AHEAD" ]; then
      echo "🔴 **领先账不平**:上批记录 \`$LAST_SHA\` 领先 $LAST_AHEAD,其后 $SINCE 个提交 → 应为 $EXPECT,现测 $AHEAD(差 $(( AHEAD - EXPECT )))" >&2
      echo "   三选一说清:①上批那个数本来就错 ②有提交被 amend/squash 掉 ③两个数不是同一把尺子量的(裁 #93)" >&2
      RED=1
    fi
  fi
fi

# ── ① 基准写进输出 ──
echo "> 本批提交(**$N** 个,从 \`$BASE_SHA\` 数起)· HEAD \`$HEAD_SHA\` · **领先 \`origin/main\` $AHEAD 个** ——"
echo "> 对账:\`$BASE_SHA\` 领先 $BASE_AHEAD + 本批 $N = **$AHEAD** $([ "$(( BASE_AHEAD + N ))" = "$AHEAD" ] && echo '✅' || echo '🔴 不平')"
echo "> 这些数都由 \`bash tools/batch-footer.sh $BASE\` 现出,**一个都不手写**(裁 #65 / #93)"
echo ">"
git log --oneline "$BASE..HEAD" | sed 's/^/> /'

# 记一行,供下一批对账(--no-record 只看不记)
if [ "${2:-}" != "--no-record" ] && [ -n "$AHEAD" ]; then
  mkdir -p "$(dirname "$LEDGER")"
  printf '%s\t%s\t%s\n' "$HEAD_SHA" "$AHEAD" "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LEDGER"
fi
exit $RED
