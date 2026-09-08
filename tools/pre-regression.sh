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

# ② 棘轮:两个巨型文件只许降不许升 —— **双基线**(店主 09-08 裁,05r 补三)
# 一开始基线写死在这里,结果停在 17751/8550 而实际早降到 17745/8457:**不会收紧的棘轮**,
# 等于「涨了也不红,只是涨得慢一点才红」。改成从上一提交现取,治好了那个;
# 但又留下一个口子:**红着提交一次,下一次基线就跟着抬**。
# 所以取两者中的**小者**:min(上一提交行数, assertion-baseline.json 里记的历史最低)。
# 历史最低值**只许写小不许写大** —— 写大就是偷偷放宽,预检自己红。
# 确有经店主批准的增长,才用 RATCHET_SERVER= / RATCHET_ADMIN= 显式覆盖。
git_lines() { git show "HEAD:$1" 2>/dev/null | wc -l | tr -d ' '; }
floor_of() { node -e 'const d=require("./apps/api/assertion-baseline.json");const v=(d["巨型文件历史最低"]||{})[process.argv[1]];console.log(Number.isInteger(v)?v:"")' "$1" 2>/dev/null; }
pick_base() {   # $1=文件 $2=覆盖值 → 打印「基线 上一提交 历史最低」
  local f="$1" over="$2" head_n floor_n base
  head_n=$(git_lines "$f"); floor_n=$(floor_of "$f")
  [ -n "$head_n" ] && [ "$head_n" -gt 0 ] 2>/dev/null || head_n=""
  [ -n "$floor_n" ] && [ "$floor_n" -gt 0 ] 2>/dev/null || floor_n=""
  if [ -n "$over" ]; then base="$over"
  elif [ -n "$head_n" ] && [ -n "$floor_n" ]; then base=$(( head_n < floor_n ? head_n : floor_n ))
  else base="${head_n:-${floor_n:-999999}}"; fi
  echo "$base ${head_n:-?} ${floor_n:-?}"
}
ratchet() {   # $1=中文名 $2=文件 $3=覆盖值
  local now base head_n floor_n
  now=$(wc -l < "$2" | tr -d ' ')
  read -r base head_n floor_n <<< "$(pick_base "$2" "$3")"
  # 历史最低值写大了 = 偷偷放宽,先咬这一条(判据自己也会坏,也该有判据)
  if [ "$floor_n" != "?" ] && [ "$head_n" != "?" ] && [ "$floor_n" -gt "$head_n" ]; then
    say "$1" "🔴 历史最低 $floor_n > 上一提交 $head_n —— 历史最低只许写小不许写大"; FAIL=1; return
  fi
  if [ "$now" -le "$base" ]; then say "$1" "✅ $now ≤ $base(上一提交 $head_n · 历史最低 $floor_n)"
  else say "$1" "🔴 $now > $base(涨了 $((now-base)) 行;上一提交 $head_n · 历史最低 $floor_n)"; FAIL=1; fi
}
ratchet "local-server.mjs" apps/api/local-server.mjs "${RATCHET_SERVER:-}"
ratchet "admin.js" apps/web/admin.js "${RATCHET_ADMIN:-}"

# ②b J-34:造病还原只许走 tools/knife-backup.sh(店主 09-08 立,05r 补三)
#     `git checkout --` / `git restore` 还原到的是 **HEAD**,不是「造病之前那一刻」;
#     只要文件本批有未提交改动,一条命令就把本批的活儿抹了。08-30 栽过一次(自伤事故),
#     09-08 又栽一次 —— **上一次没兜住是因为教训只写进了回执,没装成护栏**,这就是那条护栏。
#     扫的是**会被执行的东西**(脚本与模块),不扫 handoff/ 文档:那里写的是案情,不是行为。
KNIFE_BAD=$(grep -rln --include='*.sh' --include='*.mjs' --include='*.command' \
              -e 'git checkout --' -e 'git restore' tools apps .command 2>/dev/null \
            | grep -vE '^tools/(pre-regression|knife-backup)\.sh$' || true)
#     白名单精确到文件、各写理由(不许按目录放行):
#       tools/pre-regression.sh —— 本判据自己,检测词就写在这儿;
#       tools/knife-backup.sh   —— 那条**合法路径**本身,它的说明必须点名被禁的命令,否则没人知道禁的是什么。
if [ -z "$KNIFE_BAD" ]; then say "J-34 造病还原路径" "✅ 可执行件里零处 git checkout --/git restore"
else say "J-34 造病还原路径" "🔴 $(echo "$KNIFE_BAD" | tr '\n' ' ')—— 造病还原走 tools/knife-backup.sh"; FAIL=1; fi
KNIFE_LEFT=$(find . -name '*.pre-k' -not -path './.git/*' -not -path './node_modules/*' 2>/dev/null || true)
if [ -z "$KNIFE_LEFT" ]; then say "J-34 造病备份收尾" "✅ 没有残留的 .pre-k"
else say "J-34 造病备份收尾" "🔴 $(echo "$KNIFE_LEFT" | tr '\n' ' ')—— 某把刀没还原"; FAIL=1; fi

# ②c D163 同族:回归脚本里 `export X=` 的 X 必须**登记进 `REGRESSION_ONLY_ENV`**
#     (店主 05s 补三:「以后脚本里新增 export 必须先登记,预检加一条」)。
#     不登记 = 还回去时不会被 `env -u` 掉 = 又一次漏进店主的活服务。
#     白名单三个:DATA_DIR / TEST_DB_PATH 由重启命令自己显式写;`REGRESSION_ONLY_ENV` 是表本身。
UNREG=$(grep -oE '^export [A-Z_][A-Z0-9_]*=' apps/api/run-all-tests.sh 2>/dev/null | sed 's/^export //;s/=$//' | sort -u \
        | while read -r v; do
            if [ "$v" = "DATA_DIR" ] || [ "$v" = "REGRESSION_ONLY_ENV" ]; then continue; fi
            grep -q "REGRESSION_ONLY_ENV=.*$v" apps/api/run-all-tests.sh || echo "$v"
          done)
if [ -z "$UNREG" ]; then say "回归 export 已登记" "✅ 都在 REGRESSION_ONLY_ENV 表里"
else say "回归 export 未登记" "🔴 $(echo "$UNREG" | tr '\n' ' ')—— 新增 export 必须先登记(D163 同族)"; FAIL=1; fi

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
