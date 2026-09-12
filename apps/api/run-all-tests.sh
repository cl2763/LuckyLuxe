#!/usr/bin/env bash
# Lucky Luxe 一键全量回归(本机或 CI 通用)
# 用法: bash apps/api/run-all-tests.sh
# 要求: Node 22+;在全新数据库上也能跑(自动填充演示数据)
set -euo pipefail
RUN_T0=$SECONDS   # 墙钟起点(计时即证:套件时间 ≠ 整跑时间)

# ══ 🔴 跑机口径之一(店主 05w §六 立):**这把脚本不许接 `| tail` / `| head` 之类的管道** ══
# 案由:它会起后台服务(4128/4310/CI 那台),那些子进程**继承了管道的写端** ——
# 脚本自己早跑完了,`tail` 还在等 EOF,看上去像「卡死 25 分钟」。
# 正确跑法:`bash apps/api/run-all-tests.sh > /tmp/ci.log 2>&1`,然后看日志。
# 判据就写在这儿:标准输出是管道(既不是终端也不是文件)就当场喊一声。
if [ ! -t 1 ] && [ -p /dev/stdout ]; then
  echo '🔴 别把这把脚本接进管道(| tail / | head 之类)——它起的后台服务会攥着管道写端,' >&2
  echo '   于是你那头永远等不到 EOF,看着像卡死。改成:bash apps/api/run-all-tests.sh > /tmp/ci.log 2>&1' >&2
  echo '   (要硬跑:PIPE_OK=1 bash apps/api/run-all-tests.sh | 你的管道)' >&2
  [ "${PIPE_OK:-0}" = "1" ] || exit 2
fi

# ══ 🔴 看门狗(店主 05r 补五 §四 立)══
# 案由,照录:D151 那一批我把 8 秒的合并窗开在回归里,**整轮从 2 分钟变成跑不完**,
# 「22 分钟才反应过来是自己干的」。整跑有基线(~2 分),超它一倍就该有人喊一声 ——
# 以后这一声由脚本喊,不靠人盯。
# 超时自杀,并打印**当时哪一套在跑、跑了多久**(判据红的时候必须能指认现场)。
# 可配 REGRESSION_WATCHDOG_SECONDS;0 = 关掉(只给「我就是要跑很久」那种情况)。
WATCHDOG_S=${REGRESSION_WATCHDOG_SECONDS:-300}
CURRENT_SUITE_FILE="$(mktemp /tmp/ll-ci-current.XXXXXX)"
if [ "$WATCHDOG_S" -gt 0 ]; then
  (
    sleep "$WATCHDOG_S"
    # 还活着 = 超时了。把现场打出来再送它上路。
    if kill -0 $$ 2>/dev/null; then
      echo "" >&2
      echo "🔴 看门狗:整跑超过 ${WATCHDOG_S} 秒(基线约 2 分钟)—— 自杀,免得像 D151 那次跑 22 分钟没人知道。" >&2
      NOW_RUNNING="$(cat "$CURRENT_SUITE_FILE" 2>/dev/null)"
      echo "   当时在跑:${NOW_RUNNING:-(还没跑到套件,卡在预检或起服务那一段)}" >&2
      echo "   常见原因:某个改动让每条 AI 进线都要等(合并窗那一类),或某个套件在等一个永远不来的东西。" >&2
      echo "   要放宽:REGRESSION_WATCHDOG_SECONDS=900 bash apps/api/run-all-tests.sh" >&2
      # 🔴 只 TERM 父进程,让它的 EXIT/TERM 陷阱把 4128/4310 还回去(脚本红线②)。
      #    踩过两次才写对:
      #    ① 直接 `kill -9` —— 陷阱根本不跑,两个端口都留在死的状态;
      #    ② 先 `pkill -P $$` —— **看门狗自己就是 $$ 的子进程**,那一枪把自己也打死了,
      #       后面的 TERM 压根没执行。所以这里什么都不 pkill,清理交给陷阱。
      kill -TERM $$ 2>/dev/null || true
    fi
  ) &
  WATCHDOG_PID=$!
fi
export ALLOW_DEMO_ADMIN_LOGIN=true  # 测试套件依赖演示登录路径(生产环境默认禁用)
# 🔴 D151 入站合并窗在回归里**关掉**(MERGE_WINDOW_MS=0)。
#    原因是现测出来的:窗一开,每一条 AI 进线都要等 8 秒 —— 整轮回归从 2 分钟变成跑不完
#    (AI 那几套一轮几十条消息)。窗本身没错,是「每个套件都被债主等一遍」不合理。
#    D151 的行为层由 `test-merge-window` **自己起一台带窗的实例**来验(与 perf-base-migration 同法),
#    所以关掉这里**不等于没验** —— 那一套里 ④d/④e/④f 三条就是干这个的。
export MERGE_WINDOW_MS=0
# 🔴 D163(店主 05s 补二 亲测咬出来的,红线级):**回归专用的环境变量不许跟着「还回去」进活服务。**
#    案发:上面 `export MERGE_WINDOW_MS=0` 是为了回归不等窗,而跑完重启 4128/4310 时
#    nohup 继承了它 —— 两台活服务的合并窗变成 0,**D151 在店主那儿等于没上线**,
#    她连发三句得到三条回复;而回执里「都还回去了」在窗这件事上是假话。
#    收法:回归专用变量在这里**登记成一张表**,还回去时逐个 `env -u` 掉;
#    真要带的(沙箱的 ALLOW_DEMO_ADMIN_LOGIN)由那条重启命令**自己显式写**,不靠继承。
#    同族一起收:凡是这个脚本 export 出来、只为回归服务的,都进这张表。
REGRESSION_ONLY_ENV="MERGE_WINDOW_MS TEST_DB_PATH ALLOW_DEMO_ADMIN_LOGIN COS_SECRET_ID COS_SECRET_KEY COS_REGION COS_BUCKET"
env_clean() { local a=(); for v in $REGRESSION_ONLY_ENV; do a+=(-u "$v"); done; printf '%s ' "${a[@]}"; }

cd "$(dirname "$0")"
API_DIR="$(pwd)"   # 绝对路径:restore_local 结束时要用,那时 cwd 可能已经变了

# ══ 预检先跑(店主 05o 裁 §三 之一)══
# 05n 那一批跑了 5 次全量,其中 **3 次红是可预判的**(护栏清单没重生成 / 棘轮超 /
# 扫描面没跟着搬)—— 每次都要等 15 分钟才知道,然后改一行再等 15 分钟。
# 这把刀 6 秒钟就能把那三类问一遍。不绿就别起全量。
# 确实要跳过(比如正在排查全量本身):PRE_REGRESSION=skip
if [ "${PRE_REGRESSION:-}" != "skip" ]; then
  if ! bash "$API_DIR/../../tools/pre-regression.sh"; then
    echo ""
    echo "🔴 预检没过 —— 全量不起了。修完再来(或 PRE_REGRESSION=skip 强跑)。"
    exit 1
  fi
  echo ""
fi

# 回归全程跑独立临时库(DATA_DIR),不碰 local-data 真实/演示库;结束时自动删除
export DATA_DIR="$(mktemp -d /tmp/ll-ci-data.XXXXXX)"
export TEST_DB_PATH="$DATA_DIR/lucky-luxe.sqlite"  # finance-core 直连库验证防篡改触发器时用
echo "== 测试数据目录: $DATA_DIR =="

cleanup() { pkill -f "local-server.mjs" 2>/dev/null || true; }

# 🔴 2026-08-09 拆脚枪:回归会 pkill 掉**店主正在用的本地服务**(4128),跑完不还回去 ——
# 店主再打开小程序就是"每个接口都连不上"的空壳,看起来像登录坏了。真相是后端被测试打死了。
# 现在:开跑前记下本地服务在不在,跑完自动拉回来(用真实 local-data,不是测试临时库)。
LOCAL_WAS_UP=0
if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4128/health"; then LOCAL_WAS_UP=1; fi
# 🔴 D176(05t 段 6 现场撞出来,D163 同族第三例):**端口活着 ≠ 还回去了**。
#    回归中途被打断(看门狗开枪)时,租户隔离那一段起的 CI 实例会**赖在 4128 上**,
#    而它开的是 `/tmp/ll-ci-data.XXXX/lucky-luxe.sqlite`(回归临时库)。
#    `restore_local` 一看「4128 有人应答」就早退 —— 于是店主打开本地服务,
#    看到的是一个**空的临时库**,而且那个目录马上会被删。
#    现测:2026-09-08 02:22 的 4128 就是这样,`/health` 自报 dataFile 指着 /tmp/ll-ci-data.CyLqxX。
#    改法:认**库**,不认端口。
local_health_field() {   # $1=端口 $2=字段名
  curl -sf --max-time 2 "http://127.0.0.1:$1/health"     | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)['$2']||'')}catch{console.log('')}})"
}
local_is_owners() {      # 4128 上跑的是不是**店主那台**(库路径必须是本机库)
  case "$(local_health_field 4128 dataFile)" in
    */local-data/lucky-luxe.sqlite) return 0 ;;
    *) return 1 ;;
  esac
}
restore_local() {
  [ "$LOCAL_WAS_UP" = "1" ] || return 0
  if local_is_owners; then return 0; fi
  # 端口有人应答但库不对 = CI 实例赖在 4128 上,先请它走(不然下面拉不起来)
  if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4128/health"; then
    echo "== 4128 上是回归实例(库:$(local_health_field 4128 dataFile))—— 先停掉,再还店主那台 =="
    pkill -f "local-server.mjs" 2>/dev/null || true
    sleep 1
  fi
  # 脚本开头已经 cd 进 apps/api 了,这里再 dirname $0 会踩空 —— 直接用绝对路径
  ( cd "$API_DIR" && nohup env $(env_clean) PORT=4128 DATA_DIR="./local-data" node local-server.mjs > /tmp/ll-local-restored.log 2>&1 & )
  for _ in $(seq 1 20); do
    # 认库不认端口:必须是**本机库**那台起来了才算还回去了
    local_is_owners && { echo "== 已把店主的本地服务(4128)重新拉起来(库:$(local_health_field 4128 dataFile))=="; return 0; }
    sleep 0.5
  done
  echo "!! 本地服务没拉回来,店主要用的话请双击 启动服务器.command" >&2
}

# 🔴 2026-08-23 复发(第二次踩同一个坑):cleanup 的 pkill 打的是**所有** local-server.mjs,
# 不只是 4128 —— 沙箱 4310(演示/走查用,带 ALLOW_DEMO_ADMIN_LOGIN 和自己的 DATA_DIR)
# 同样被打死,而当时只还了 4128。店主打开小程序=登录失败,以为是功能坏了。
# 现在:开跑前把 4310 的 DATA_DIR 从进程环境里抓下来,跑完用同样参数拉回来。
# 教训写进脚本而不是靠记性 —— 靠记性已经漏过两次。
SANDBOX_WAS_UP=0
SANDBOX_DATA_DIR=""
SANDBOX_AI_ENV=""
SANDBOX_AI_GATE=""
if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4310/health"; then
  SANDBOX_WAS_UP=1
  # macOS 拿不到别的进程的环境变量(ps 探不到 DATA_DIR),所以读启动器留下的记录文件。
  # 沙箱请用 `bash apps/api/start-sandbox.sh <DATA_DIR>` 起,它会写这份记录。
  # 🔴 2026-09-04 补:AI env 与门档也要读回来 —— 只还 DATA_DIR 的话,
  #    带真模型起的沙箱会被拉回成 mock,而接口照样 200,没人会发现。
  if [ -f /tmp/ll-sandbox-4310.env ]; then
    SANDBOX_DATA_DIR="$(grep '^SANDBOX_DATA_DIR=' /tmp/ll-sandbox-4310.env | head -1 | cut -d= -f2- || true)"
    SANDBOX_AI_ENV="$(grep '^SANDBOX_AI_ENV=' /tmp/ll-sandbox-4310.env | head -1 | cut -d= -f2- || true)"
    SANDBOX_AI_GATE="$(grep '^SANDBOX_AI_GATE=' /tmp/ll-sandbox-4310.env | head -1 | cut -d= -f2- || true)"
  fi
  echo "== 沙箱 4310 在跑(DATA_DIR=${SANDBOX_DATA_DIR:-未探到} · AI env=${SANDBOX_AI_ENV:-无} · 门档=${SANDBOX_AI_GATE:-默认}),跑完会还回去 =="
fi
restore_sandbox() {
  [ "$SANDBOX_WAS_UP" = "1" ] || return 0
  curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4310/health" && return 0
  if [ -z "$SANDBOX_DATA_DIR" ]; then
    echo "!! 沙箱 4310 被回归打死了,但没探到它的 DATA_DIR —— 请手动用原来的命令拉起来" >&2
    return 0
  fi
  # 🔴 把原来的 AI env 与门档一起还回去(2026-09-04 补):
  #    原来这里只还 DATA_DIR + PORT,沙箱**带真模型起的、拉回来却是 mock** ——
  #    接口照样 200,只是 AI 换了个脑子,谁也不会注意到。「还回去」= 还回原状态。
  SB_NODE_ARGS=()
  [ -n "${SANDBOX_AI_ENV:-}" ] && [ -f "$SANDBOX_AI_ENV" ] && SB_NODE_ARGS+=("--env-file-if-exists=$SANDBOX_AI_ENV")
  ( cd "$API_DIR" && nohup env $(env_clean) PORT=4310 DATA_DIR="$SANDBOX_DATA_DIR" ALLOW_DEMO_ADMIN_LOGIN=true \
      AI_GATE="${SANDBOX_AI_GATE:-}" node ${SB_NODE_ARGS[@]+"${SB_NODE_ARGS[@]}"} local-server.mjs > /tmp/ll-sandbox-restored.log 2>&1 & )
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:4310/health" && { echo "== 已把沙箱(4310)重新拉起来 =="; return 0; }
    sleep 0.5
  done
  echo "!! 沙箱 4310 没拉回来,演示/走查前请手动拉起" >&2
}
finish() {
  # 看门狗先撤(不撤的话,跑完之后它还在后台等着,到点了对着别人的进程开枪)
  [ -n "${WATCHDOG_PID:-}" ] && kill "$WATCHDOG_PID" 2>/dev/null
  rm -f "${CURRENT_SUITE_FILE:-}" 2>/dev/null
  cleanup; [ -n "${DATA_DIR:-}" ] && rm -rf "$DATA_DIR"; restore_local; restore_sandbox
  restore_selfcheck
}

# 🔴 D163 收尾自证:「还回去了」这句话**由这段话打印,人不许手写**(与 receipt-db-proof 同姿态)。
#    还回去 ≠ 端口能连上 —— 上一次两台都活着,而合并窗是 0,D151 在店主那儿等于没上线。
#    所以验的是**还回去的服务是不是原来那台**:窗 4 秒 / 封顶 12 秒(默认值)。
#    判据锚的是「默认值」这件事,不锚 4 这个数字本身 —— 默认值改了,这里跟着 merge-window.mjs 走。
restore_selfcheck() {
  local want_win want_cap bad=0
  # 🔴 取默认值也得**把回归那身环境脱掉**再取 —— 不然这段自己就被 `MERGE_WINDOW_MS=0` 污染,
  #    量出来的「默认」正是那个错值,判据反过来把还对的服务判成错的。
  #    第一版就是这么写的,一跑就露馅(它自己的输出把自己咬了)。
  want_win=$(env $(env_clean) node -e "import('./merge-window.mjs').then(m=>console.log(m.mergeWindowSeconds()))" 2>/dev/null)
  want_cap=$(env $(env_clean) node -e "import('./merge-window.mjs').then(m=>console.log(m.mergeWindowCapSeconds()))" 2>/dev/null)
  [ -n "$want_win" ] || { echo "!! D163 收尾自证:取不到默认窗长,跳过(不算通过)" >&2; return 0; }
  for port in 4128 4310; do
    curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$port/health" || continue   # 本来就没起的不算
    local got_win got_cap
    got_win=$(curl -sf --max-time 2 "http://127.0.0.1:$port/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).mergeWindowSeconds)}catch{console.log("")}})')
    got_cap=$(curl -sf --max-time 2 "http://127.0.0.1:$port/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).mergeWindowCapSeconds)}catch{console.log("")}})')
    local got_db want_db
    got_db=$(local_health_field "$port" dataFile)
    if [ "$port" = "4128" ]; then want_db="local-data"; else want_db="sandbox-data"; fi
    case "$got_db" in
      *"/$want_db/"*) : ;;
      *) echo "🔴 [收尾自证] $port 开的是 ${got_db} —— 不是 ${want_db} 那个库(D176:端口活着≠还回去了)" >&2; bad=1 ;;
    esac
    if [ "$got_win" = "$want_win" ] && [ "$got_cap" = "$want_cap" ]; then
      echo "   [收尾自证] $port 合并窗 ${got_win}s / 封顶 ${got_cap}s ✔ 与默认值一致 · 库 ${got_db##*/new-chat/}"
    else
      echo "🔴 [收尾自证] $port 合并窗 ${got_win}s / 封顶 ${got_cap}s ✖ 默认应为 ${want_win}s / ${want_cap}s" >&2
      echo "   —— 回归专用环境变量漏进了活服务(D163)。**这一轮不许说「都还回去了」。**" >&2
      bad=1
    fi
  done
  [ "$bad" = "0" ] || return 1
}
# 🔴 INT/TERM 也要收(店主 05r 补五 §四 的看门狗会 TERM 自己):
#    只挂 EXIT 的话,被信号打死时陷阱**不跑**,4128/4310 就留在死的状态 ——
#    现测过一次,两个端口都没还回去。脚本红线②要防的就是这个。
trap finish EXIT INT TERM
cleanup; sleep 1

# 等实例真正就绪再发请求:轮询 /health 取代固定 sleep。
# 固定 sleep 在 CI 慢机器上会让测试抢跑(实例尚未 listen)→ tenant-isolation 报 "fetch failed"。
# 🔴 2026-09-03 店主亲自撞出的通道(03r):她在**自己的 4128 服务开着**的时候跑了一次全量回归。
# cleanup 的 pkill 发出去之后,脚本**立刻**起自己的 4128 并调 wait_health ——
# 而 wait_health 只问「/health 答不答话」,**正在死的那个店主服务照样答话**,
# 于是第一个套件连上了她的真库。这次是 08-24 那道测试护栏当场拒跑才没出事
# (本机库逐表对照零写入),但**通道是真的**:护栏顶住 ≠ 通道不存在。
#
# 两道闸,店主定的规格:**端口真空再起服 · 起完先验库域**。
#
# ① 端口真空:pkill 之后必须等到端口**真的没人答话**,才允许起自己的服务。
#    「还答得出话」就是还没空出来 —— 不问答话的是谁,问的是端口空没空。
wait_port_free() {
  local port="$1" label="${2:-$1}" tries=60
  for _ in $(seq 1 "$tries"); do
    curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:${port}/health" || return 0
    sleep 0.5
  done
  echo "!! 端口 ${port}(${label})30s 内没有空出来 —— 上面还挂着一个服务,很可能是店主正在用的。" >&2
  echo "!! 中止,不敢在别人的服务上面起自己的。" >&2
  return 1
}

# ② 验库域:起完之后**不看它自报什么**(/health 压根不下发库路径),
#    看**这个进程真正打开的是哪个 .sqlite 文件** —— 判据律:能验实物就别验元数据。
#    只要不在本轮的 CI 临时库目录下,一律中止,一个套件都不跑。
assert_db_domain() {
  local pid="$1" port="$2" tries=20 opened=""
  for _ in $(seq 1 "$tries"); do
    opened="$(lsof -p "$pid" 2>/dev/null | awk '/\.sqlite$/ {print $NF}' | sort -u | head -1)"
    [ -n "$opened" ] && break
    sleep 0.5
  done
  if [ -z "$opened" ]; then
    echo "!! 端口 ${port} 的实例(pid ${pid})拿不到它打开的库文件 —— 验不了库域就不许往下跑。" >&2
    return 1
  fi
  # 🔴 首跑就把自己咬红了,而红的是**合法的一轮**:macOS 上 /tmp 是 /private/tmp 的软链,
  # lsof 报的是解析后的真路径(/private/tmp/ll-ci-data.X),$DATA_DIR 是 mktemp 给的 /tmp/ll-ci-data.X。
  # 两个字符串不相等,库域其实完全正确 —— 一把**在正确状态下会红**的刀,
  # 迟早被人为了让它绿而放宽,那就再也守不住了。两边都取真路径再比。
  local want; want="$(cd "$DATA_DIR" 2>/dev/null && pwd -P)"
  local got; got="$(cd "$(dirname "$opened")" 2>/dev/null && pwd -P)/$(basename "$opened")"
  case "$got" in
    "$want"/*) echo "   [库域] 端口 ${port} → ${got}  ✔ 在本轮 CI 临时库内(${want})" ;;
    *)
      echo "!! 🔴 库域不对:端口 ${port} 的实例打开的是 ${got}" >&2
      echo "!! 本轮 CI 临时库是 ${want} —— 这正是 03r 那条通道。立刻中止。" >&2
      return 1 ;;
  esac
}

wait_health() {
  local port="$1" label="${2:-$1}" tries=60
  for _ in $(seq 1 "$tries"); do
    if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:${port}/health"; then return 0; fi
    sleep 0.5
  done
  echo "!! 实例 ${label} (端口 ${port}) 在 30s 内未就绪,中止" >&2
  return 1
}

# 沙盒隔离回归要用:给测试实例配上「看起来齐全但是假的」COS 钥匙 ——
# 目的是让 cosConfigured() 为真、再断言沙盒下 uploadAllowed 仍为假、快照走 inline。
# 值是假的,真要发请求也会失败;而按规则根本不该发。
export COS_SECRET_ID=test-fake-id
export COS_SECRET_KEY=test-fake-key
export COS_REGION=ap-test
export COS_BUCKET=test-bucket-1250000000

echo "== 启动主服务器 (4128) =="
wait_port_free 4128 "主服务器"
PORT=4128 node local-server.mjs > /tmp/ll-ci-main.log 2>&1 &
CI_PID_4128=$!
wait_health 4128 "主服务器"
assert_db_domain "$CI_PID_4128" 4128
# 全新库没有订单数据:填充演示数据(幂等,已有数据时自动跳过)
curl -s -X POST -H "authorization: Bearer owner-demo-token" -H "content-type: application/json" \
  -d '{}' http://127.0.0.1:4128/admin/demo/full-seed > /dev/null || true

# 可用 CI_SUITES="a b c" 环境变量跑子集(调试用)
DEFAULT_SUITES="customer-service-matrix working-memory business-hours intent-guards quote-polish silent-handoff human-handoff after-sales-handoff identity-links entitlements tenant-kb finance-core finance-goals stored-value schedule-week special-dates customer-profile staff-portal admin-accounts pricing-model membership-config customer-import tenant-hygiene tenant-timezone deposit-config message-templates settlement daily-close salary-v2 schedule-v2 finance-trend finance-lock perf-viz coupon-settle audit-fix scan-sign double-sheet auth-surface currency-scan settle-stress sign-stability noshow-aftersales demo-seed-guard card-refund amend-linkage ledger-guards backend-gate hero-slides cash-notes mini-money-inputs image-placeholder deposit-audit web-settlement cross-end-effect mini-account-adjust today-board dashboard-pulse dashboard-home hours-gate crossend-cta tab-colors color-usage token-entry danger-cmd notify-scheduler quote-state ui-spec observe-fixes file-ratchet delivery-evidence store-name correction-reason credential-scan exit-code db-target-guard empty-pill untouched-proof display-text tenant-ownership tenant-explicit identity-tenant version-fingerprint tenant-fill-trigger conversation-log ai-gate ai-safety-lines ai-fact-gate booking-intake turn-classify turn-answer ai-review quote-tenant conversation-tenant mini-ai-same-outlet platform-login mp-home-owner v4-five-fixes repeat-guard merge-window three-stores tier-label native-dialog demo-mark txn-rollback mp-placeholder-size mp-overlap mp-home-sections store-jury"
read -r -a SUITES <<< "${CI_SUITES:-$DEFAULT_SUITES}"

# 🔴 断言基线(店主 02r 裁定一):每套跑完**就地数** `^ok ` 条数,不事后解析日志 ——
# 日志里 auto-return / tenant-isolation 两套没有 `== test-X ==` 行,解析法会张冠李戴。
TALLY="$DATA_DIR/assertion-tally.tsv"; : > "$TALLY"
SUITE_OUT="$DATA_DIR/suite-out.txt"
TIMING="$DATA_DIR/suite-timing.tsv"; : > "$TIMING"
# ══ 🔴 D167 · 单套超时(店主 05s 补五 §四 立)══
# 案由:`mp-*` 三套靠 DevTools 自动化会话跑,会话一旦僵死,automator 的调用**没有超时**,
# 于是整轮回归被三套与本批无关的刀拖到 300 秒、被看门狗一枪打死 ——
# 看门狗尽了职,但**其余 105 套的结果一起没了**。
# 裁:`mp-*` 各带 60 秒单套超时;超时算「**本轮未跑**」并在末尾点名,整轮照跑。
SUITE_TIMEOUT_S=${REGRESSION_SUITE_TIMEOUT_SECONDS:-60}
NOT_RUN_FILE="$DATA_DIR/not-run.txt"; : > "$NOT_RUN_FILE"

run_suite() {   # $1=套件名 $2..=node 前缀环境(可空)
  local name="$1"; shift
  # 计时即证(店主 05o 裁 §三 之三):每套打印耗时,末尾出总耗时与最慢 5 套。
  # 「跑了两个半小时」这种话,得能拆开看是谁慢、跑了几次 —— 数不出来就治不了。
  local t0=$SECONDS
  printf '%s(第 %s 秒起跑)' "$name" "$t0" > "$CURRENT_SUITE_FILE" 2>/dev/null || true
  case "$name" in
    mp-*)
      # macOS 没有 `timeout` 命令(现测:command not found)—— 自己数秒:后台跑 + 轮询 + 到点开枪。
      : > "$SUITE_OUT"
      ( "$@" node "test-${name}.mjs" > "$SUITE_OUT" 2>&1 ) &
      local pid=$!
      local waited=0
      while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$SUITE_TIMEOUT_S" ]; do sleep 1; waited=$(( waited + 1 )); done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        cat "$SUITE_OUT"
        echo "⏳ test-${name} 超过 ${SUITE_TIMEOUT_S} 秒没结束 —— **本轮未跑**(多半是 DevTools 自动化会话僵死),整轮继续。"
        echo "$name" >> "$NOT_RUN_FILE"
        local dtx=$(( SECONDS - t0 ))
        printf '%s\t%s\n' "$name" "$dtx" >> "$TIMING"
        echo "   ⏱ test-${name} ${dtx}s(超时未跑)"
        return 0     # 🔴 未跑 ≠ 失败,也 ≠ 通过:不写 TALLY,由断言基线刀按「未跑」点名
      fi
      wait "$pid" 2>/dev/null || true
      cat "$SUITE_OUT"
      ;;
    *)
      "$@" node "test-${name}.mjs" 2>&1 | tee "$SUITE_OUT"
      ;;
  esac
  local dt=$(( SECONDS - t0 ))
  printf '%s\t%s\n' "$name" "$(grep -c '^ok ' "$SUITE_OUT" || true)" >> "$TALLY"
  printf '%s\t%s\n' "$name" "$dt" >> "$TIMING"
  echo "   ⏱ test-${name} ${dt}s"
}

for suite in "${SUITES[@]}"; do
  echo "== test-${suite} =="
  run_suite "$suite" env
done

echo "== 自动回归专用实例 (4129) =="
cleanup; sleep 1
wait_port_free 4129 "冷却实例"
PORT=4129 HUMAN_REPLY_COOLDOWN_MINUTES=0 node local-server.mjs > /tmp/ll-ci-4129.log 2>&1 &
CI_PID_4129=$!
wait_health 4129 "自动回归实例"
run_suite auto-return env TEST_BASE_URL=http://127.0.0.1:4129

# 结构一致性:自己起一份全新库的实例(独立 DATA_DIR + 端口 4177),与其它套件互不干扰
echo "== test-schema-consistency =="
run_suite schema-consistency env

# 分成基数迁移:要重启实例才能验(迁移只在启动时跑),同样自带 DATA_DIR + 端口 4178
echo "== test-perf-base-migration =="
run_suite perf-base-migration env

echo "== 租户隔离双实例 (4128+4131) =="
cleanup; sleep 1
wait_port_free 4128 "隔离A"
PORT=4128 node local-server.mjs > /tmp/ll-ci-a.log 2>&1 &
CI_PID_4128=$!
wait_health 4128 "租户A"
wait_port_free 4131 "隔离B"
PORT=4131 DEFAULT_TENANT_ID=tenant-iso-b node local-server.mjs > /tmp/ll-ci-b.log 2>&1 &
CI_PID_4131=$!
wait_health 4131 "租户B"
run_suite tenant-isolation env

echo ""
# 🔴 断言基线判定(店主 02r 裁定一):降=红并指名哪一套;涨自动更新基线。
# 排在全部套件之后 —— 它要看的是"全场的逐套件数",站在中间看不全。
echo "== test-assertion-baseline =="
# 🔴 D132 口径④(店主 04d §一 第 3 条):回归跑完,**每个还在跑的 CI 服务进程** tenantFallback 必须 0/0。
# 读 /health 不读日志 —— 日志会被下一次跑覆盖,health 读得到。
# 这一条与套件级的 ⑤/⑤b 是**两层**:套件验「拒不拒」,这一条验「整轮回归里有没有夹具还在裸奔」。
FALLBACK_BAD=0
for p in 4128 4129 4131; do
  h="$(curl -s --max-time 3 "http://127.0.0.1:$p/health" || true)"
  [ -z "$h" ] && continue
  n="$(printf '%s' "$h" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).tenantFallback||{};console.log((t.missing||0)+(t.invalid||0))}catch{console.log(0)}})')"
  echo "   [口径④] 端口 $p tenantFallback 合计 $n"
  [ "$n" != "0" ] && FALLBACK_BAD=1
done
if [ "$FALLBACK_BAD" != "0" ]; then
  echo "❌ 口径④:回归里还有顾客侧请求没带/带错门店标识(见上面各端口计数)—— 夹具要补头,不是放宽判据" >&2
  exit 1
fi

node test-assertion-baseline.mjs "$TALLY" "$(( $(echo $DEFAULT_SUITES | wc -w) + 4 ))" --not-run="$(tr '\n' ',' < "$NOT_RUN_FILE" 2>/dev/null)"

echo ""
# 套件数从清单现算,不写死 —— 写死的数字会随加套件慢慢变成假话
# ⏱ 计时汇总(店主 05o 裁 §三 之三:回执固定一行「全量 N 分钟 · 最慢:…」)
if [ -s "$TIMING" ]; then
  TOTAL_S=$(awk -F'\t' '{s+=$2} END{print s+0}' "$TIMING")
  echo ""
  WALL_S=$(( SECONDS - RUN_T0 ))
  # 🔴 套件时间 ≠ 整跑时间。头一次量出来:套件 109 秒,而整跑要几分钟 ——
  #    差额全在**建库铺夹具 + 起三台服务 + 收尾还服务**上。
  #    店主问「为什么一跑两个半小时」,答案得把这两段分开报,不然优化会优化错地方。
  echo "⏱ 整跑 $(( WALL_S / 60 )) 分 $(( WALL_S % 60 )) 秒(其中套件 $(( TOTAL_S / 60 )) 分 $(( TOTAL_S % 60 )) 秒 · 夹具与起停服务 $(( (WALL_S - TOTAL_S) / 60 )) 分 $(( (WALL_S - TOTAL_S) % 60 )) 秒)"
  echo "   最慢 5 套:"
  sort -k2 -rn -t$'\t' "$TIMING" | head -5 | awk -F'\t' '{printf "     %-34s %ss\n", $1, $2}'
  SLOW=$(awk -F'\t' '$2>180 {print $1" ("$2"s)"}' "$TIMING" | tr '\n' ' ')
  [ -n "$SLOW" ] && echo "   ⚠️ 超 3 分钟的(下批看能不能拆):$SLOW"
fi

# ══ 🔴 收摊自证(店主 05w §六:J-33 的「收摊」= **收文件 + 收进程**)══
# 案由:05w 抓到一个**跑了 12 小时的造病刀进程** —— 它跑完没退出,attach 着的连接一直挂着。
# 以后每一跑收尾都自己数一遍:本机还剩几个「刀/跑机」进程活着,活着就点名。
LEFTOVER="$(pgrep -fl 'tools/.*-proof\.mjs|tools/.*-shot\.mjs|knife' 2>/dev/null | grep -v pgrep || true)"
if [ -n "$LEFTOVER" ]; then
  echo ""
  echo "⚠️ 收摊自证:还有跑机/造病进程活着 —— 请确认是不是忘了退(J-33:收摊 = 收文件 + 收进程):"
  echo "$LEFTOVER" | sed 's/^/     /'
else
  echo ""
  echo "🧹 收摊自证:本机没有残留的跑机/造病进程(J-33)"
fi

echo "✅ 全部 $(( $(echo $DEFAULT_SUITES | wc -w) + 4 )) 个套件通过(清单 $(echo $DEFAULT_SUITES | wc -w) + auto-return/schema-consistency/perf-base-migration/tenant-isolation)"
