#!/usr/bin/env bash
# ④ 审样本页 —— 造病验红(夜班令 §二 点名那一条:回流不带租户 → A 店样本出现在 B 店 → 红)
#
#   ㋐ 反例集不按租户取 → A 店判的「不该答」让 B 店也反问 → 必须红
#   ㋑ 待审队列不按租户取 → A 店的轮次出现在 B 店 → 必须红
#
# 四步照《突变自检条》:造 → **重启服务** → 必须红且报得出哪一处 → 还原+重启+回绿。
# 《刀留痕律》:打印注入点与改动行;没有落刀凭据的「刀没红」按「刀没落」处理。
# J-04:端口是环境变量,`pkill -f "PORT=..."` 匹配不上 —— 一律 lsof 取 PID + ps 验进程真换了。
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=${KNIFE_PORT:-4399}
SRC=apps/api/ai-review-routes.mjs
SRV=apps/api/local-server.mjs
BAK=$(mktemp /tmp/ai-review.bak.XXXXXX); mv "$BAK" "$BAK.mjs"; BAK="$BAK.mjs"   # GNU mktemp 要 X 在结尾
BAK2=$(mktemp /tmp/ll-srv.bak.XXXXXX); mv "$BAK2" "$BAK2.mjs"; BAK2="$BAK2.mjs"   # 同上
cp "$SRC" "$BAK"; cp "$SRV" "$BAK2"
DATA_DIR=${KNIFE_DATA_DIR:-}
LOG=/tmp/knife-server-$PORT.log
FAILED=0
cleanup() { cp "$BAK" "$SRC"; cp "$BAK2" "$SRV"; stop_server; rm -f "$BAK" "$BAK2"; }
trap cleanup EXIT

pid_on_port() { lsof -ti ":$PORT" -sTCP:LISTEN 2>/dev/null | head -1; }
# 「真的换了进程」用 **PID** 判,不用启动时刻:`ps -o lstart=` 只精确到秒,
# 重启够快时前后两次一模一样,守卫会把好好的一刀误报成「验的是旧构建」(现测栽过)。
started_at()  { pid_on_port; }
stop_server() {
  local p; p=$(pid_on_port); [ -n "$p" ] && kill "$p" 2>/dev/null
  for _ in $(seq 40); do [ -z "$(pid_on_port)" ] && return 0; sleep 0.25; done
  p=$(pid_on_port); [ -n "$p" ] && kill -9 "$p" 2>/dev/null; sleep 0.5; return 0
}
start_server() {
  local before="${1:-}" after
  DATA_DIR="$DATA_DIR" PORT="$PORT" AI_MODE=mock node apps/api/local-server.mjs >"$LOG" 2>&1 &
  for _ in $(seq 120); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "   🔴 服务起不来"; tail -5 "$LOG"; return 1; }
  after="$(started_at)"; echo "   ↻ 重启完成 · PID $after"
  [ -n "$before" ] && [ "$before" = "$after" ] && { echo "   🔴 进程没换 —— 验的是旧构建"; return 1; }
  return 0
}
run_suite() { TEST_BASE_URL="http://127.0.0.1:$PORT" node apps/api/test-ai-review.mjs 2>&1; }

knife() {
  local id="$1" desc="$2" patch="$3" before out
  echo ""; echo "════════ 刀 $id:$desc ════════"
  cp "$BAK" "$SRC"; cp "$BAK2" "$SRV"
  if ! python3 -c "$patch"; then echo "   🔴 刀 $id 没落下(替换失败)—— 按「刀没落」处理"; FAILED=1; return; fi
  if diff -q "$BAK" "$SRC" >/dev/null && diff -q "$BAK2" "$SRV" >/dev/null; then echo "   🔴 刀 $id 没落下(两个文件都一字未改)"; FAILED=1; return; fi
  echo "   [刀] 注入:"; { diff "$BAK" "$SRC"; diff "$BAK2" "$SRV"; } | grep '^[<>]' | head -5 | sed 's/^/   [刀] /'
  before="$(started_at)"; stop_server; start_server "$before" || { FAILED=1; return; }
  out="$(run_suite)"
  if echo "$out" | grep -q "^not ok"; then
    echo "   ✅ 红了,咬住的是:"; echo "$out" | grep "^not ok" | head -3 | sed 's/^/      /'
  else
    echo "   🔴 刀 $id **没红** —— 判据看不见这个病,或刀砍在走不到的分支上"; FAILED=1
  fi
}

[ -n "$DATA_DIR" ] || { echo "用法:KNIFE_DATA_DIR=/tmp/ll-ci-data.XXXX bash tools/ai-review-knife-proof.sh"; exit 2; }
echo "库:$DATA_DIR · 端口:$PORT"
echo "════════ 基线:原状必须绿 ════════"
stop_server; start_server "" || exit 1
BASE_OUT="$(run_suite)"
echo "$BASE_OUT" | grep -q "^not ok" && { echo "   🔴 原状就红,先修好再验刀"; echo "$BASE_OUT" | grep "^not ok" | head -4 | sed 's/^/      /'; exit 1; }
echo "   ✅ 原状绿:$(echo "$BASE_OUT" | grep -c '^ok ') 项"

knife "㋐" "反例集不按租户取(回流跨了店)" '
import io
p="apps/api/ai-review-routes.mjs"; s=io.open(p,encoding="utf-8").read()
old="WHERE tenant_id = ? AND verdict = \x27rejected\x27"
assert s.count(old)==1, "锚点没找到"
s=s.replace(old,"WHERE (? IS NOT NULL) AND verdict = \x27rejected\x27")
io.open(p,"w",encoding="utf-8").write(s)
'

# ㋑ 隔离是**两层**守的:我这条 SQL 一层,`readWecomTranscript` 自己按租户读又一层。
#    只砍其中一层不漏 —— 头一版只砍 SQL,刀砍下去判据毫无反应,这不是判据废,是**防线还在**。
#    要证判据真在守,刀必须把**有效边界**整个切开:SQL 不按租户 + 读全录也不按租户。
knife "㋑" "待审两层隔离一起拆(SQL + 全录读口都不按租户)" '
import io
Q = chr(39)
p="apps/api/ai-review-routes.mjs"; s=io.open(p,encoding="utf-8").read()
old="FROM wechat_conversations WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 400"
assert s.count(old)==1, "锚点1没找到"
s=s.replace(old,"FROM wechat_conversations WHERE (? IS NOT NULL) ORDER BY updated_at DESC LIMIT 400")
io.open(p,"w",encoding="utf-8").write(s)

r="apps/api/local-server.mjs"; t=io.open(r,encoding="utf-8").read()
old2="  readWecomTranscript: (cid) => readWecomTranscript(cid),"
assert t.count(old2)==1, "锚点2没找到"
sql = "SELECT transcript_json FROM wechat_conversations WHERE id = ?"
new2 = "  readWecomTranscript: (cid) => parseJson(db.prepare(" + Q + sql + Q + ").get(cid)?.transcript_json),"
t=t.replace(old2,new2)
io.open(r,"w",encoding="utf-8").write(t)
'

echo ""; echo "════════ 还原 → 必须回绿 ════════"
cp "$BAK" "$SRC"; cp "$BAK2" "$SRV"
before="$(started_at)"; stop_server
if start_server "$before"; then
  OUT="$(run_suite)"
  if echo "$OUT" | grep -q "^not ok"; then
    echo "   🔴 还原后仍红 —— 红的不是刀,是本来就坏"; echo "$OUT" | grep "^not ok" | head -4 | sed 's/^/      /'; FAILED=1
  else echo "   ✅ 回绿:$(echo "$OUT" | grep -c '^ok ') 项全过"; fi
else FAILED=1; fi

echo ""
[ "$FAILED" = "1" ] && { echo "❌ 造病验红未全过"; exit 1; }
echo "✅ 两刀各咬一次、还原回绿"
