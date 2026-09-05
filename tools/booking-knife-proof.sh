#!/usr/bin/env bash
# ③ 预约采集 —— 造病验红(05h §三 点名的三条刀)
#
#   ㋐ 草稿改成每次新建            → 必须红
#   ㋑ 不查 /availability 直接确认  → 必须红
#   ㋒ 7 项表回来                  → 必须红
#
# 四步照《突变自检条》:①造 → ②**重启服务** → ③必须红且报得出是哪一处 → ④还原+重启+重跑必须回绿
# 《刀留痕律》:每把刀打印注入点与改动行;**没有落刀凭据的「刀没红」按「刀没落」处理**。
#
# ⚠️ J-04 的坑:`pkill -f "PORT=4399"` 一次都匹配不上(端口是环境变量,不在命令行上),
#    结果 40 分钟验的全是旧构建。这里一律用 `lsof` 取 PID,并用 `ps -o lstart=` 验「真的换了进程」。
#
# ⚠️ 头一轮两把刀「没红」,查明是**刀砍在走不到的守卫上**(记在 §刀的定义 各自注释里)——
#    刀砍空和判据废,从「没红」这一个现象上分不出来,所以每把刀都要说清它砍的是哪个机制。
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=${KNIFE_PORT:-4399}
SRC=apps/api/booking-intake.mjs
BAK=$(mktemp /tmp/booking-intake.bak.XXXXXX.mjs)
cp "$SRC" "$BAK"
DATA_DIR=${KNIFE_DATA_DIR:-}
LOG=/tmp/knife-server-$PORT.log
FAILED=0

cleanup() { cp "$BAK" "$SRC"; stop_server; rm -f "$BAK"; }
trap cleanup EXIT

pid_on_port() { lsof -ti ":$PORT" -sTCP:LISTEN 2>/dev/null | head -1; }
# 「真的换了进程」用 **PID** 判,不用启动时刻:`ps -o lstart=` 只精确到秒,
# 重启够快时前后两次一模一样,守卫会把好好的一刀误报成「验的是旧构建」(现测栽过)。
started_at()  { pid_on_port; }

stop_server() {
  local p; p=$(pid_on_port)
  [ -n "$p" ] && kill "$p" 2>/dev/null
  for _ in $(seq 40); do [ -z "$(pid_on_port)" ] && return 0; sleep 0.25; done
  p=$(pid_on_port); [ -n "$p" ] && kill -9 "$p" 2>/dev/null; sleep 0.5
  return 0
}

start_server() {
  local before="${1:-}"
  # 门档不钉死 —— 05f 起默认就是 model,钉成 keyword 等于验了一个线上不跑的配置
  DATA_DIR="$DATA_DIR" PORT="$PORT" AI_MODE=mock node apps/api/local-server.mjs >"$LOG" 2>&1 &
  for _ in $(seq 120); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "   🔴 服务起不来,看 $LOG"; tail -5 "$LOG"; return 1; }
  local after; after="$(started_at)"
  echo "   ↻ 重启完成 · PID $(pid_on_port) · 启动于 $after"
  if [ -n "$before" ] && [ "$before" = "$after" ]; then
    echo "   🔴 进程没换 —— 验的是旧构建,拒绝继续"; return 1
  fi
  return 0
}

run_suite() { TEST_BASE_URL="http://127.0.0.1:$PORT" node apps/api/test-booking-intake.mjs 2>&1; }

knife() {   # $1=编号 $2=说明 $3=python 补丁
  local id="$1" desc="$2" patch="$3" before out
  echo ""
  echo "════════ 刀 $id:$desc ════════"
  cp "$BAK" "$SRC"
  if ! python3 -c "$patch"; then echo "   🔴 刀 $id 没落下(替换失败)—— 按「刀没落」处理,不算验过"; FAILED=1; return; fi
  if diff -q "$BAK" "$SRC" >/dev/null; then echo "   🔴 刀 $id 没落下(文件一字未改)—— 按「刀没落」处理"; FAILED=1; return; fi
  echo "   [刀] 注入 $SRC,改动 $(diff "$BAK" "$SRC" | grep -c '^>') 行:"
  diff "$BAK" "$SRC" | grep '^[<>]' | head -4 | sed 's/^/   [刀] /'
  before="$(started_at)"; stop_server
  start_server "$before" || { FAILED=1; return; }
  out="$(run_suite)"
  if echo "$out" | grep -q "^not ok"; then
    echo "   ✅ 红了,咬住的是:"
    echo "$out" | grep "^not ok" | head -3 | sed 's/^/      /'
  else
    echo "   🔴 刀 $id **没红** —— 要么判据看不见这个病,要么刀砍在走不到的分支上"
    echo "$out" | tail -2 | sed 's/^/      /'
    FAILED=1
  fi
}

[ -n "$DATA_DIR" ] || { echo "用法:KNIFE_DATA_DIR=/tmp/ll-ci-data.XXXX bash tools/booking-knife-proof.sh"; exit 2; }
echo "库:$DATA_DIR · 端口:$PORT"

# 归因先行:原状必须绿,否则每把刀都红也分不清是刀咬的还是本来就坏
echo "════════ 基线:原状必须绿 ════════"
stop_server; start_server "" || exit 1
BASE_OUT="$(run_suite)"
if echo "$BASE_OUT" | grep -q "^not ok"; then
  echo "   🔴 原状就红,先修好再验刀"; echo "$BASE_OUT" | grep "^not ok" | head -5 | sed 's/^/      /'; exit 1
fi
echo "   ✅ 原状绿:$(echo "$BASE_OUT" | grep -c '^ok ') 项"

# ㋐ 第一版砍的是 checking 段的 `if (already)` —— 那条在这通对话里**根本走不到**
#    (第二次确认时态已是 drafted,走 drafted 段的复用),刀砍空、判据「没红」。
#    改砍**复用查询本身**:查不到就等于没复用,两个复用点一起失效。
knife "㋐" "复用查询失效(等于草稿每次新建)" '
import io
p="apps/api/booking-intake.mjs"; s=io.open(p,encoding="utf-8").read()
old="existingDraftFor(conversationId)"
assert s.count(old)>=2, "锚点没找到"
s=s.replace(old,"(null)")
io.open(p,"w",encoding="utf-8").write(s)
'

# ㋑ 第一版砍的是 `if (!real || !hit)` 这道**守卫** —— 顺路那通对话要的 15:00 本来就有位,
#    守卫本就不触发,砍了毫无动静。改砍**校验本身**:顾客说什么就认什么,不去集合里对。
#    配套判据是「凌晨三点不许确认」(④g/④h)—— 那才是查了才会拒的时间。
knife "㋑" "不查可约集合,顾客说什么就确认什么" '
import io
p="apps/api/booking-intake.mjs"; s=io.open(p,encoding="utf-8").read()
old="      const hit = timeHit(slots.time, real.times)"
assert s.count(old)==1, "锚点没找到"
s=s.replace(old,"      const hit = slots.time")
io.open(p,"w",encoding="utf-8").write(s)
'

knife "㋒" "7 项表回来(一次把所有槽都问了)" '
import io
p="apps/api/booking-intake.mjs"; s=io.open(p,encoding="utf-8").read()
old="reply: say(zh, miss.zh, miss.en), stage: \x27collecting\x27,"
assert s.count(old)==1, "锚点没找到"
new="reply: say(zh, \x27麻烦提供:项目、哪天、几点、指定技师吗、要不要卸甲\x27, \x27Please provide: service, date, time, technician, removal\x27), stage: \x27collecting\x27,"
s=s.replace(old,new)
io.open(p,"w",encoding="utf-8").write(s)
'

echo ""
echo "════════ 还原 → 必须回绿 ════════"
cp "$BAK" "$SRC"
before="$(started_at)"; stop_server
if start_server "$before"; then
  OUT="$(run_suite)"
  if echo "$OUT" | grep -q "^not ok"; then
    echo "   🔴 还原后仍红 —— 红的不是刀,是本来就坏"
    echo "$OUT" | grep "^not ok" | head -5 | sed 's/^/      /'; FAILED=1
  else
    echo "   ✅ 回绿:$(echo "$OUT" | grep -c '^ok ') 项全过"
  fi
else FAILED=1; fi

echo ""
if [ "$FAILED" = "1" ]; then echo "❌ 造病验红未全过 —— 见上"; exit 1; fi
echo "✅ 三刀各咬一次、还原回绿"
