#!/usr/bin/env bash
# 预检刀(店主 05o 裁 §三 之一)—— **不起全量之前先跑,< 1 分钟**
#
# 立这把刀的原因(Cowork 数出来的):05n 一批跑了 **5 次**全量、每次约 15 分钟,
# 其中 **3 次红是可预判的** —— 护栏清单没重生成、棘轮超了、扫描面没跟着搬。
# 那三次红各自烧掉 15 分钟,然后改一行再跑一遍。
# **两个半小时不是回归慢,是同一批里把全量重复跑了。**
#
# 所以这里先花 1 分钟把「不用起服务就能知道的红」全部问一遍:
#   ① 护栏清单是否与当前提交一致(先 git add 再生成 —— 它按 git ls-files 扫)
#   ② 棘轮两数有没有涨
#   ③ 纯静态的扫描套件
#   ④ 断言基线只读比对(不写回)
# 任一红 → 退出非零,别起全量。
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
say() { printf '  %-34s %s\n' "$1" "$2"; }

echo "════ 预检(不起服务)════"

# ① 护栏清单
BEFORE=$(md5 -q "handoff/写库脚本护栏三列清单.md" 2>/dev/null || echo none)
node tools/gen-guard-checklist.mjs --write >/dev/null 2>&1
AFTER=$(md5 -q "handoff/写库脚本护栏三列清单.md" 2>/dev/null || echo none)
if [ "$BEFORE" = "$AFTER" ]; then say "护栏三列清单" "✅ 已是最新"
else say "护栏三列清单" "⚠️ 刚重生成过(记得 git add;这是 05n 三次红里的一次)"; fi

# ② 棘轮:两个巨型文件只许降不许升
BASE_SRV=${RATCHET_SERVER:-17751}
BASE_ADM=${RATCHET_ADMIN:-8550}
SRV=$(wc -l < apps/api/local-server.mjs | tr -d ' ')
ADM=$(wc -l < apps/web/admin.js | tr -d ' ')
if [ "$SRV" -le "$BASE_SRV" ]; then say "local-server.mjs" "✅ $SRV ≤ $BASE_SRV"
else say "local-server.mjs" "🔴 $SRV > $BASE_SRV(涨了 $((SRV-BASE_SRV)) 行)"; FAIL=1; fi
if [ "$ADM" -le "$BASE_ADM" ]; then say "admin.js" "✅ $ADM ≤ $BASE_ADM"
else say "admin.js" "🔴 $ADM > $BASE_ADM"; FAIL=1; fi

# ③ 语法:所有本仓 .mjs 先过一遍 node --check(比起服务快得多)
BAD=$(for f in apps/api/*.mjs apps/web/*.js tools/*.mjs tools/ai-eval/*.mjs; do
        [ -f "$f" ] || continue
        node --check "$f" >/dev/null 2>&1 || echo "$f"
      done)
if [ -z "$BAD" ]; then say "语法(全仓 .mjs/.js)" "✅ 全过"
else say "语法" "🔴 $(echo "$BAD" | tr '\n' ' ')"; FAIL=1; fi

# ④ 新建/搬出的模块:自由标识符(搬迁后最容易漏的那一类)
NEWMODS=$(git diff --cached --name-only --diff-filter=A 2>/dev/null | grep -E '^apps/api/.*\.mjs$' | grep -v '/test-' || true)
if [ -n "$NEWMODS" ]; then
  OUT=$(node tools/free-identifier-scan.mjs $NEWMODS 2>&1)
  echo "$OUT" | grep -q '❌' && { say "自由标识符(本批新模块)" "🔴"; echo "$OUT" | sed 's/^/    /'; FAIL=1; } \
                             || say "自由标识符(本批新模块)" "✅ $(echo "$NEWMODS" | wc -l | tr -d ' ') 个"
else say "自由标识符" "— 本批没有新模块"; fi

# ⑤ 完整性:被 import 的自研文件都进 git 了没有(05n 撞过两次)
MISS=$(node - <<'JS' 2>/dev/null
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const tracked = new Set(execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n'))
const src = readFileSync('apps/api/local-server.mjs', 'utf8')
const miss = [...src.matchAll(/from '\.\/([a-z0-9-]+\.mjs)'/g)]
  .map((m) => `apps/api/${m[1]}`).filter((f) => !tracked.has(f))
if (miss.length) console.log(miss.join(' '))
JS
)
if [ -z "$MISS" ]; then say "交付完整性(import 都入库)" "✅"
else say "交付完整性" "🔴 没进 git:$MISS"; FAIL=1; fi

# ⑥ J-30(店主 05p 补三):**回执里引用的评测明细,档案目录里必须真有那个文件**
#    案底同一件事两次:05l 裁过「不许写 /tmp」,05p 的到底率三跑又只留在 /tmp ——
#    回执上写着 6/6/7、10/10/10,明细一份没入仓,**数字没法核就等于没有这个数**。
if GHOST=$(node tools/eval-citation-check.mjs 2>&1); then say "回执引用的评测明细" "✅ ${GHOST#*✅ }"
else say "回执引用的评测明细" "🔴"; echo "$GHOST" | sed 's/^/    /'; FAIL=1; fi

echo ""
if [ "$FAIL" = "1" ]; then echo "❌ 预检红 —— **先修这些再起全量**(它们不用等 15 分钟就知道)"; exit 1; fi
echo "✅ 预检全绿,可以起全量"
