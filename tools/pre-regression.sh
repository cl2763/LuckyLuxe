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

# ⑪ D172(店主 05u 补一 §二 + 夜班令6 段 3):**深色态一次走完**,所以 `styles.css` 里的写死色
#    只许降不许升。案由:店主在系统深色下看到「深底 + 白侧栏 + 浅色台面卡」——
#    根因就是表面底色写死成 `#fff`/`#fffaf6`,令牌翻了它们不翻。
#    本批把 background 位上的写死色换成令牌(497 → 382);这条棘轮盯着它别再涨回去。
#    ⚠️ 数的是**全部** `#RRGGBB`,包含 color 位与品类色 —— 那些不是都该改,
#      所以这是**棘轮**不是硬零:降了就把数字调小,永远不许升。
HARDCOLOR=$(grep -oE "#[0-9a-fA-F]{3,8}\b" apps/web/styles.css | wc -l | tr -d ' ')
if [ "$HARDCOLOR" -le 34 ]; then say "styles.css 写死色棘轮" "✅ $HARDCOLOR ≤ 34(只许降)"
else say "styles.css 写死色棘轮" "🔴 $HARDCOLOR > 34 —— 新增了写死色,深色态会在那一处漏出来"; FAIL=1; fi

# ⑩ 🔴 内联脚本语法(05t 段 6 现场自伤,当场立的护栏):
#    `platform.html` / `admin.html` 里的 `<script>` 整段是**没人检查语法**的 ——
#    我在一个模板字符串里的 HTML 注释里写了一对反引号,反引号把模板字符串提前收了口,
#    整段脚本语法错 → 浏览器一个函数都没定义 → **平台控制台点「进入控制台」毫无反应**。
#    页面照样 200、照样渲染出登录框,肉眼完全看不出来。这类错必须机器检查。
INLINE_BAD=""
for f in apps/web/platform.html apps/web/admin.html; do
  node -e '
    const fs = require("fs"); const vm = require("vm");
    const s = fs.readFileSync(process.argv[1], "utf8");
    let i = 0, bad = 0;
    for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      i += 1
      try { new vm.Script(m[1]) } catch (e) { bad += 1; console.error(`第 ${i} 段:${e.message}`) }
    }
    process.exit(bad ? 1 : 0)
  ' "$f" 2>/tmp/ll-inline-$$.err || INLINE_BAD="$INLINE_BAD $f($(head -1 /tmp/ll-inline-$$.err))"
  rm -f /tmp/ll-inline-$$.err
done
if [ -z "$INLINE_BAD" ]; then say "内联脚本语法" "✅ platform.html · admin.html 逐段可解析"
else say "内联脚本语法" "🔴$INLINE_BAD"; FAIL=1; fi

# ⑨ D167(店主 05s 补五 §四):`mp-*` 三套必须带**单套超时**,超时算「本轮未跑」,
#    不许再让三把与本批无关的刀把整轮拖到看门狗自杀(现测过:整轮 105 套的结果一起没了)。
#    三条一起守,少一条这条护栏就是半截的:
#      ①单套超时分支在,且默认 60 秒;②未跑的套件名传给断言基线刀;③基线刀对未跑有上限棘轮。
MP_T=0
grep -q 'SUITE_TIMEOUT_S=${REGRESSION_SUITE_TIMEOUT_SECONDS:-60}' apps/api/run-all-tests.sh || MP_T=1
grep -q '本轮未跑' apps/api/run-all-tests.sh || MP_T=1
grep -q 'not-run=' apps/api/run-all-tests.sh || MP_T=1
grep -q '未跑豁免有上限' apps/api/test-assertion-baseline.mjs || MP_T=1
if [ "$MP_T" = "0" ]; then say "mp-* 单套超时(D167)" "✅ 60 秒 · 未跑点名 · 基线有上限棘轮"
else say "mp-* 单套超时(D167)" "🔴 三件里缺件 —— 超时/点名/上限棘轮必须同时在"; FAIL=1; fi

# ⑧ D168(店主 05t 段 3 第 2 条):**设计令牌与合同图逐条比对**。
#    「皮跟图不一样」这件事被店主亲眼比出来三次 —— 人眼比 #faf8f3 与 #fbf8f5 是比不出来的。
#    这把刀现从合同图抽 `:root` 三段,与仓里的令牌文件逐条比名与值,差一位就红。
#    放预检:皮不对不用等十五分钟的全量。
if TOK=$(node tools/design-token-diff.mjs 2>&1); then say "设计令牌=合同图" "✅ $(echo "$TOK" | tail -1 | sed 's/✅ //')"
else say "设计令牌=合同图" "🔴"; echo "$TOK" | grep '🔴' | sed 's/^/    /'; FAIL=1; fi

# ⑦ D169(店主 05t 段 2 第 8 条):**全量回归不许依赖演示种子**。
#    回归跑的是自己新建的临时库,里面没有也不该有演示数据;真让它依赖上,
#    以后谁删一次种子就连累整轮回归 —— 而那时红的会是二十个套件,没人会想到是种子。
#    判据按**机械搜索**:run-all-tests.sh 里对 seed-demo-rich / test-seed-rich 的引用必须是 0 处。
SEEDREF=$(grep -c "seed-demo-rich\|test-seed-rich" apps/api/run-all-tests.sh || true)
if [ "$SEEDREF" = "0" ]; then say "回归不依赖演示种子" "✅ 0 处引用"
else say "回归不依赖演示种子" "🔴 run-all-tests.sh 里有 $SEEDREF 处引用 —— 种子只许手动对沙箱跑"; FAIL=1; fi

# ⑨ 裁 #22(店主 05w §三 · 同族扫尽)。「禁新增写死色」那把静态刀原来**只盯网页**,
#    小程序一处没盯 —— 而店主看见的深色不生效,病根正是小程序里的写死色。
#    棘轮 = **实际条数**(03m:不许留空隙);令牌文件 `styles/tokens.wxss` 与生成物
#    `styles/fraunces-digits.wxss` 不算(字面色本来就该住在令牌文件里)。
MPCOLOR=$(find miniprogram -name "*.wxss" ! -path "*/styles/tokens.wxss" ! -path "*/styles/fraunces-digits.wxss" -print0 \
  | xargs -0 grep -ohE "#[0-9a-fA-F]{3,8}\b|rgba?\([0-9 .,]+\)" | wc -l | tr -d ' ')
if [ "$MPCOLOR" -le 2731 ]; then say "小程序 wxss 写死色棘轮" "✅ $MPCOLOR ≤ 2731(只许降)"
else say "小程序 wxss 写死色棘轮" "🔴 $MPCOLOR > 2731 —— 新写死了颜色,那一处的深色态就会漏白"; FAIL=1; fi

# ⑩ #14(店主 05u 裁:「今天先加静态判据禁新写 + 交存量清单」)。
#    `substr(appointment_start, 1, 10)` 取的是 **UTC 日期前缀**,不是门店当天 ——
#    多伦多店晚上 8 点的单,UTC 已经是第二天,按它判天就会把单算到明天去。
#    正确出口是门店时区那一套(`storeToday()` / `todayOf(tenantId)` / `periodRange`)。
#    存量 12 处逐条见 `handoff/UTC判天存量清单_2026-09-09.md`(每条写用途与为什么暂时还在);
#    棘轮 = 实际条数,**只许降**;新写一处立刻红。
UTCDAY=$(grep -rnE "substr\(appointment_start" --include="*.mjs" --include="*.js" apps/api tools miniprogram apps/web 2>/dev/null \
  | grep -vE ":[0-9]+: *(/\*|\*|//)" | wc -l | tr -d ' ')
if [ "$UTCDAY" -le 12 ]; then say "UTC 日期前缀判天棘轮(#14)" "✅ $UTCDAY ≤ 12(只许降;存量清单 handoff/UTC判天存量清单_2026-09-09.md)"
else say "UTC 日期前缀判天棘轮(#14)" "🔴 $UTCDAY > 12 —— 又有人按 UTC 前缀判天了,门店时区那条口径会在那一处破"; FAIL=1; fi

# ⑪ 05z §二:对比度全扫要**跟着样式走**。这把刀要开 Chrome + 活服务,进不了全量回归,
#    所以预检这里做一件它做得到的事:**红榜抬头记的界面文件指纹 ≠ 现在的指纹 = 全扫没重跑** → 红。
#    (06a 改:原来比 mtime —— 还原备份、git checkout 都会把 mtime 改新而内容没变,误红过一次。
#     现在比**内容 sha**:锚在内容上,不锚在代理指标上,同族 J-38/J-39。)
RED_LIST="handoff/night-runs/对比度红榜_修后_2026-09-09.md"
if [ -f "$RED_LIST" ]; then
  WANT_SHA=$(grep -oE '界面文件内容指纹 `[0-9a-f]+`' "$RED_LIST" | grep -oE '[0-9a-f]{6,}' | head -1)
  NOW_SHA=$(cat apps/web/styles.css apps/web/admin.html apps/web/admin.js | shasum -a 256 | cut -c1-12)
  if [ -z "$WANT_SHA" ]; then say "红榜没记界面指纹" "🔴 抬头里没有「界面文件内容指纹」那一行 —— 重跑一次 tools/contrast-sweep.mjs"; FAIL=1
  elif [ "$WANT_SHA" = "$NOW_SHA" ]; then say "对比度全扫跟得上样式" "✅ 指纹一致($NOW_SHA)"
  else say "对比度全扫过期了" "🔴 红榜记的是 $WANT_SHA,现在是 $NOW_SHA —— 样式改过了,重跑 tools/contrast-sweep.mjs 再交"; FAIL=1; fi
else say "对比度红榜在不在" "🔴 找不到 $RED_LIST"; FAIL=1; fi

# ⑫ 裁(店主 05y §三③)· **开批快照进预检**。
#    「未动须有证」那句话要**每一批都有证**,而不是想起来才有证 ——
#    上一批沙箱那一行只能写「按形状看像心跳,不是刀验过的」,原因就是开批时没打快照,
#    而「下一批补上」这种承诺在这个项目里掉过好几次。所以改成开跑前就查:
#    本机库 / 沙箱库 各要有一份**开批快照 + 指纹快照**,缺哪个红并点名缺的是哪个库。
SNAP_DIR="handoff/night-runs/开批快照"
MISS=""
for db in 本机库 沙箱库; do
  [ -f "$SNAP_DIR/${db}_开批.json" ] || MISS="$MISS ${db}(结构快照)"
  [ -f "$SNAP_DIR/${db}_开批.fp.json" ] || MISS="$MISS ${db}(指纹快照)"
done
if [ -z "$MISS" ]; then
  say "开批快照齐不齐" "✅ 本机库 / 沙箱库 各有结构 + 指纹两份"
else
  say "开批快照缺件" "🔴 缺:$MISS —— 开批先打:node tools/db-snapshot.mjs <库绝对路径> $SNAP_DIR/<库名>_开批.json;node tools/tenant-fingerprint.mjs <库绝对路径> $SNAP_DIR/<库名>_开批.fp.json"
  FAIL=1
fi

# ⑬ 裁(店主 05y §三①)· **flaky 要计数**:同一套件崩过第二次就不许再靠重跑洗白。
#    这里只做「有没有人记着」这一半:凡 handoff/night-runs/flaky/*.md 里记了 ≥2 次的,预检点名。
FLAKY_DIR="handoff/night-runs/flaky"
if [ -d "$FLAKY_DIR" ]; then
  HOT=""
  for f in "$FLAKY_DIR"/*.md; do
    [ -e "$f" ] || continue
    # 表格里以 "| <数字> |" 开头的行就是一次记录
    cnt=$(grep -cE '^\| [0-9]+ \|' "$f" || true)
    [ "$cnt" -ge 2 ] && HOT="$HOT $(basename "$f" .md)($cnt 次)"
  done
  if [ -z "$HOT" ]; then say "flaky 计数" "✅ 没有崩过两次的套件"
  else say "flaky 崩过两次" "🔴 $HOT —— 按裁定停线定位,不许再靠重跑洗白"; FAIL=1; fi
else say "flaky 计数目录" "⚠️ 还没有 $FLAKY_DIR(第一次崩的时候建)"; fi

# ⑭ 06a §四(店主提到 P0)· **两台不许同名**,而且要分得出是哪个库。
#    背景要写清楚:`dataScope` 只有 test/live 两档,本机库 / 沙箱库 / 生产库**三个都叫 live**,
#    于是「两台都是 live」看着像「护栏对两台都失效」——**其实 live 正是拒绝档**(现测护栏对两台都拒跑)。
#    但「分不出是哪个库」这件事本身要治:细分名 dataScopeName 由库路径算,4128 必须是 local、4310 必须是 sandbox。
#    服务没起来不判(那是另一件事),起来了就必须对得上,并把两台的值一起打印。
SCOPE_LOCAL=$(curl -s --max-time 3 http://127.0.0.1:4128/health | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).dataScopeName||'(没有这个字段)')}catch{console.log('(取不到)')}})" 2>/dev/null)
SCOPE_SAND=$(curl -s --max-time 3 http://127.0.0.1:4310/health | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).dataScopeName||'(没有这个字段)')}catch{console.log('(取不到)')}})" 2>/dev/null)
if [ "$SCOPE_LOCAL" = "(取不到)" ] && [ "$SCOPE_SAND" = "(取不到)" ]; then
  say "两台库名分得清" "— 两台都没起,这一条本轮没验(不是通过)"
elif [ "$SCOPE_LOCAL" = "$SCOPE_SAND" ]; then
  say "两台库名撞名了" "🔴 4128=$SCOPE_LOCAL · 4310=$SCOPE_SAND —— 分不出是哪个库,护栏与报数都会含糊"; FAIL=1
else
  say "两台库名分得清" "✅ 4128=$SCOPE_LOCAL · 4310=$SCOPE_SAND"
fi

# ⑧ 判据住在跑不到的地方(店主 05w §二 同族一句)。
#    D184 那两把刀写得很好、判据也对,可它们只落在 `test-seed-rich.mjs` 里 ——
#    而 seed-rich 按 D169 **不进全量**,于是全量一次都不会跑到它们。**没人跑的刀等于没立。**
#    这一扫**只提醒不拦**(FAIL 不置位):非全量套件里出现「死判据」字样时点名,
#    由人回答一句「全量那边有没有一份」。拦下来会误伤 —— 那边留一份副本是允许的。
NONSUITE_HITS=""
for f in apps/api/test-*.mjs; do
  base=$(basename "$f" .mjs); name=${base#test-}
  case " $(grep -o 'DEFAULT_SUITES="[^"]*"' apps/api/run-all-tests.sh | sed 's/DEFAULT_SUITES="//;s/"$//') " in
    *" $name "*) continue ;;
  esac
  if grep -q "死判据" "$f"; then NONSUITE_HITS="$NONSUITE_HITS $name"; fi
done
if [ -z "$NONSUITE_HITS" ]; then say "死判据都在全量跑得到的套件里" "✅ 非全量套件里没有「死判据」字样"
else say "死判据住在跑不到的套件里" "⚠️ 提醒(不拦):$NONSUITE_HITS —— 全量那边也得有一份,否则等于没立"; fi

echo ""
if [ "$FAIL" = "1" ]; then echo "❌ 预检红 —— **先修这些再起全量**(它们不用等 15 分钟就知道)"; exit 1; fi
echo "✅ 预检全绿,可以起全量"
