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
# ① 外部件预检(店主 07c 裁 #56):**开跑之前先看一眼依赖齐不齐**,不许跑到第 n 套件才发现。
#    读的是 handoff/外部件清单.md 那张表 —— 一件事一处真相,表改了这里自动跟着查。
# 🔴 **提醒,不拦**(裁 #58② 同一条道理,这一处是我 07c 自己装反了):
#    缺 automator 时,**三支 mp 刀自己就会红** —— 覆盖面一点没少,判决只是往后挪几分钟。
#    这道闸的价值是「**第 5 秒就点名缺哪一个**」,不是再判一次同样的红;
#    拦住整轮回归等于让一件环境没配好的事,挡住一百多套跟它无关的判据。
if node "$(dirname "$0")/ext-deps-check.mjs" --strict; then say "外部件齐" "✅ 清单逐条现查通过"
else say "外部件缺件" "⚠️ 提醒(不拦):缺哪一个已经点名(装法见 handoff/外部件清单.md §二);缺 automator 时那三支刀会自己红"; fi

ratchet "local-server.mjs" apps/api/local-server.mjs "${RATCHET_SERVER:-}"
ratchet "admin.js" apps/web/admin.js "${RATCHET_ADMIN:-}"

# ②b J-34:造病还原只许走 tools/knife-backup.sh(店主 09-08 立,05r 补三)
#     `git checkout --` / `git restore` 还原到的是 **HEAD**,不是「造病之前那一刻」;
#     只要文件本批有未提交改动,一条命令就把本批的活儿抹了。08-30 栽过一次(自伤事故),
#     09-08 又栽一次 —— **上一次没兜住是因为教训只写进了回执,没装成护栏**,这就是那条护栏。
#     扫的是**会被执行的东西**(脚本与模块),不扫 handoff/ 文档:那里写的是案情,不是行为。
#     🔴 09-14(07q)从 grep 换成 tools/knife-restore-scan.mjs:原来那一行**认词不认执行** ——
#     它咬住了 `j62-knife-bench.mjs` 里两处**提及**(一处注释案底、一处报错文案),
#     也就是「把规矩解释清楚的那段话,自己把规矩顶红了」。
#     新扫描器**剥注释 + 按位置判引号外**,只认真执行;`--probe` 自守证明它分得开真货与提及。
#     (不能整段剥字符串:git 命令的参数本来就住在引号里,剥完就认不出真货 —— danger-cmd 那次先踩过。)
KNIFE_PROBE=$(node tools/knife-restore-scan.mjs --probe 2>&1)
KNIFE_BAD=$(node tools/knife-restore-scan.mjs 2>/dev/null || true)
#     白名单精确到文件、各写理由(不许按目录放行),现在写在扫描器的 SELF 里:
#       tools/knife-restore-scan.mjs —— 本判据自己,检测词就写在这儿;
#       tools/pre-regression.sh      —— 调它的地方;
#       tools/knife-backup.sh        —— 那条**合法路径**本身,它的说明必须点名被禁的命令。
if ! printf '%s' "$KNIFE_PROBE" | grep -q '分得开'; then
  say "J-34 造病还原路径" "🔴 扫描器自守没过($KNIFE_PROBE)—— 刀咬不动,它报的「零处」不算数"; FAIL=1
elif [ -z "$KNIFE_BAD" ]; then say "J-34 造病还原路径" "✅ 可执行件里零处 git checkout --/git restore(自守:分得开真执行与提及)"
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
# 06f §三 归一 `--accent / --accent-dark` 之后,两条定义连值一起没了 → 34 收到 31。**棘轮只许往下收。**
if [ "$HARDCOLOR" -le 31 ]; then say "styles.css 写死色棘轮" "✅ $HARDCOLOR ≤ 31(只许降)"
else say "styles.css 写死色棘轮" "🔴 $HARDCOLOR > 31 —— 新增了写死色,深色态会在那一处漏出来"; FAIL=1; fi

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
MPCOLOR=$(find miniprogram -name "*.wxss" ! -path "*/styles/tokens.wxss" ! -path "*/styles/tokens-component.wxss" ! -path "*/styles/fraunces-digits.wxss" -print0 \
  | xargs -0 grep -ohE "#[0-9a-fA-F]{3,8}\b|rgba?\([0-9 .,]+\)" | wc -l | tr -d ' ')
# 06g §四② 把 33 条「写死金底 + 写死白字」+ 8 条同规则里的旧金换成令牌 → 2443 收到 2356。棘轮只许往下收。
if [ "$MPCOLOR" -le 2350 ]; then say "小程序 wxss 写死色棘轮" "✅ $MPCOLOR ≤ 2350(只许降;07c 2356→2353 · 07d 2353→2350)"
else say "小程序 wxss 写死色棘轮" "🔴 $MPCOLOR > 2350 —— 新写死了颜色,那一处的深色态就会漏白"; FAIL=1; fi

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
# 🔴 06e:红榜文件名带日期,写死一个名字下一批就指到旧文件上(这次就红在这)。
#    改成**取最新那一份**并把用的是哪一份打印出来 —— 宁可啰嗦,也不要静默比错文件。
RED_LIST=$(ls -t handoff/night-runs/对比度红榜_*后台*.md handoff/night-runs/对比度红榜_修后_*.md 2>/dev/null | head -1)
if [ -n "$RED_LIST" ]; then
  WANT_SHA=$(grep -oE '界面文件内容指纹 `[0-9a-f]+`' "$RED_LIST" | grep -oE '[0-9a-f]{6,}' | head -1)
  NOW_SHA=$(cat apps/web/styles.css apps/web/admin.html apps/web/admin.js | shasum -a 256 | cut -c1-12)
  if [ -z "$WANT_SHA" ]; then say "红榜没记界面指纹" "🔴 $(basename "$RED_LIST") 抬头里没有指纹那一行 —— 重跑 tools/contrast-sweep.mjs"; FAIL=1
  elif [ "$WANT_SHA" = "$NOW_SHA" ]; then say "对比度全扫跟得上样式" "✅ 指纹一致($NOW_SHA)· 用的是 $(basename "$RED_LIST")"
  else say "对比度全扫过期了" "🔴 $(basename "$RED_LIST") 记的是 $WANT_SHA,现在是 $NOW_SHA —— 样式改过了,重跑再交"; FAIL=1; fi
else say "对比度红榜在不在" "🔴 找不到 $RED_LIST"; FAIL=1; fi

# ⑪b D188 ③(06h §六)· **运行判据也要跟着界面走**。它同样要开 Chrome + 活服务,进不了全量;
#     所以照 ⑪ 那把的做法:报告抬头记的八个界面文件的内容指纹 ≠ 现在的 = 没重跑 → 红。
#     ⚠️ 这一条防的正是「统一入口挂上了,但后来谁改了页面而没重量」——
#     静态判据在全量里守着「文件里有没有那一行」,这一条守着「浏览器里真取得到没有」。
D188_RPT=$(ls -t handoff/night-runs/D188运行判据_*.md 2>/dev/null | head -1)
if [ -n "$D188_RPT" ]; then
  WANT8=$(grep -oE '界面文件内容指纹 `[0-9a-f]+`' "$D188_RPT" | grep -oE '[0-9a-f]{6,}' | head -1)
  NOW8=$(cat apps/web/design-tokens.css apps/web/styles.css apps/web/admin.html apps/web/index.html \
              apps/web/platform.html apps/web/sign.html apps/web/share.html apps/web/wechat-simulator.html \
         | shasum -a 256 | cut -c1-12)
  if [ -z "$WANT8" ]; then say "D188 运行判据没记指纹" "🔴 $(basename "$D188_RPT") 抬头没有指纹那一行 —— 重跑 tools/token-runtime-probe.mjs"; FAIL=1
  elif [ "$WANT8" = "$NOW8" ]; then say "D188 运行判据跟得上界面" "✅ 指纹一致($NOW8)· 用的是 $(basename "$D188_RPT")"
  else say "D188 运行判据过期了" "🔴 $(basename "$D188_RPT") 记的是 $WANT8,现在是 $NOW8 —— 页面改过了,重跑再交"; FAIL=1; fi
else say "D188 运行判据报告在不在" "🔴 找不到 handoff/night-runs/D188运行判据_*.md —— 跑一次 tools/token-runtime-probe.mjs"; FAIL=1; fi

# ⑪c J-43(店主 06h 裁 #38)· **棘轮初值必须由「已经造病验过红」的那一版判据产出**。
#     这里只做机械对账并**提醒,不拦**:git blame 取「这个数写于哪次提交」,
#     git log 取「产出它的判据文件最后改于哪次」——判据比数字新 = 这个数是旧版判据量的,该重量。
#     不拦的理由:文件级粒度会**过报**(动了同一个文件的别处也会标脏),拦了会变成天天红的噪音;
#     但提醒必须在,否则 J-43 只活在回执里。重量一次很便宜,漏掉一次很贵(06g 那个 3 就是)。
STALE_R=$(node tools/ratchet-audit.mjs 2>/dev/null | grep -c "判据比数字新" || true)
if [ "${STALE_R:-0}" -gt 0 ]; then
  say "J-43 棘轮对账" "⚠️ 提醒(不拦):$STALE_R 个棘轮的数比它的判据旧 —— 交付前跑一次 node tools/ratchet-audit.mjs 并重量"
else say "J-43 棘轮对账" "✅ 在册棘轮的数都出自当前这一版判据"; fi

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
# 端口做成可覆盖:硬写死的端口**没法造病** —— 造「两台撞名」得能把两台起在别处。
# 默认仍是 4128 / 4310,日常一个字都不用改。
PRE_LOCAL_PORT="${PRE_LOCAL_PORT:-4128}"; PRE_SAND_PORT="${PRE_SAND_PORT:-4310}"
SCOPE_LOCAL=$(curl -s --max-time 3 http://127.0.0.1:$PRE_LOCAL_PORT/health | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).dataScopeName||'(没有这个字段)')}catch{console.log('(取不到)')}})" 2>/dev/null)
SCOPE_SAND=$(curl -s --max-time 3 http://127.0.0.1:$PRE_SAND_PORT/health | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).dataScopeName||'(没有这个字段)')}catch{console.log('(取不到)')}})" 2>/dev/null)
# 🔴 裁 #58②(店主 07d):这一条要**分三态**,不许把「没起来」和「配坏了」判成同一件事。
#    立这条的由来:J-53 之后 4128 没配钥匙就起不来,而**全量本身跑在 ci 临时库上,根本不依赖这两台** ——
#    把「没起来」当红,等于让一把还没配的钥匙卡住整个开发回路。
#    ② 那一档还要把 `refusalText()` 里那段「怎么办」打出来,下一台新机器第一次跑就自己解了。
if [ "$SCOPE_LOCAL" = "$SCOPE_SAND" ] && [ "$SCOPE_LOCAL" != "(取不到)" ]; then
  # ③ 起来了却撞名 —— 这条判据当初就是为它立的,原样保留红
  say "两台库名撞名了" "🔴 $PRE_LOCAL_PORT=$SCOPE_LOCAL · $PRE_SAND_PORT=$SCOPE_SAND —— 分不出是哪个库,护栏与报数都会含糊"; FAIL=1
elif [ "$SCOPE_LOCAL" != "(取不到)" ] && [ "$SCOPE_SAND" != "(取不到)" ]; then
  # ① 两台都在、名字分得清
  say "两台库名分得清" "✅ $PRE_LOCAL_PORT=$SCOPE_LOCAL · $PRE_SAND_PORT=$SCOPE_SAND"
else
  # ② 有一台没起来 —— **提醒,不拦**;并打印「怎么办」
  DOWN=""
  [ "$SCOPE_LOCAL" = "(取不到)" ] && DOWN="$PRE_LOCAL_PORT"
  [ "$SCOPE_SAND" = "(取不到)" ] && DOWN="${DOWN:+$DOWN 与 }$PRE_SAND_PORT"
  say "有服务没起来" "⚠️ 提醒(不拦):$DOWN 没起来;全量跑在 ci 临时库上,**不依赖这两台**"
  node "$(dirname "$0")/../apps/api/mini-token-secret.mjs" --howto 2>/dev/null | sed 's/^/     /'
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
