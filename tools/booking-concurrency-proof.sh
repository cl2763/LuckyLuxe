#!/usr/bin/env bash
# ③b 并发落单 —— **诊断脚本,不是门禁**(跑完一律 exit 0;门禁在 test-booking-intake ⑤a–⑤c)
#
# 🔴 它本来是想当造病刀用的,但**证不出它要证的那件事**,原因查清如下,原样留档:
#
# ① **单进程下这条路走不到**:服务是单线程事件循环,`node:sqlite` 是**同步** API,
#    `createBooking` 从 `assertBookable` 到 `COMMIT` 中间一个 await 都没有 —— 对同进程它就是原子的。
#    两个请求永远排队,第二个的 `assertBookable`(事务外那道)已经看得见第一个的占用。
#    所以「去掉事务内复查」在单进程里**天然咬不动**:不是判据废,是这条路走不到。
# ② **两进程下先撞上的是 SQLite 锁**:同一个库两个 writer,输的那个直接
#    `database is locked` → **500**,轮不到我的复查说话。
#
# 结论(已入回执):
#   · 「两人抢同一时段恰好一个成功」**今天成立**,但成立的原因是单进程原子性,
#     不是事务内复查 —— 复查是**为将来多进程/多 writer 备的**,现在证不了它在起作用;
#   · **若哪天真上多进程,现在的表现是 500「database is locked」,不是人话 409** ——
#     那需要 WAL + busy_timeout + 把锁错误映射成 409。**登记待排,本批没做。**
set -uo pipefail
cd "$(dirname "$0")/.."
PA=${PORT_A:-4401}
PB=${PORT_B:-4402}
DATA_DIR=${KNIFE_DATA_DIR:?用法: KNIFE_DATA_DIR=/tmp/ll-ci-data.XXXX bash tools/booking-concurrency-proof.sh}
SRV=apps/api/local-server.mjs
BAK=$(mktemp /tmp/ll-conc.bak.XXXXXX.mjs); cp "$SRV" "$BAK"
cleanup() { cp "$BAK" "$SRV"; stop 4401; stop 4402; rm -f "$BAK"; }
trap cleanup EXIT

pid_on() { lsof -ti ":$1" -sTCP:LISTEN 2>/dev/null | head -1; }
stop() { local p; p=$(pid_on "$1"); [ -n "$p" ] && kill "$p" 2>/dev/null; for _ in $(seq 30); do [ -z "$(pid_on "$1")" ] && return 0; sleep 0.2; done; return 0; }
start() {
  DATA_DIR="$DATA_DIR" PORT="$1" AI_MODE=mock ALLOW_DEMO_ADMIN_LOGIN=true \
    node "$SRV" >"/tmp/conc-$1.log" 2>&1 &
  for _ in $(seq 120); do curl -sf "http://127.0.0.1:$1/health" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "   🔴 $1 起不来"; tail -4 "/tmp/conc-$1.log"; return 1
}
boot() { stop "$PA"; stop "$PB"; start "$PA" && start "$PB" && echo "   ↻ 两进程就绪 PID $(pid_on "$PA") / $(pid_on "$PB")"; }

OWNER="Bearer ${OWNER_TOKEN:-owner-demo-token}"
# 用 python 同时发两个请求,拿得到两个码
fire() {   # $1=租户 $2=body $3=token → 打印两个状态码
  python3 - "$1" "$2" "$3" "$PA" "$PB" <<'PY'
import sys, json, threading, urllib.request
tid, body, tok, pa, pb = sys.argv[1:6]
codes = {}
def go(port, key):
    req = urllib.request.Request(f'http://127.0.0.1:{port}/bookings', data=body.encode(),
        headers={'content-type':'application/json','authorization':f'Bearer {tok}','x-tenant-id':tid}, method='POST')
    try:
        with urllib.request.urlopen(req) as r: codes[key] = r.status
    except urllib.error.HTTPError as e: codes[key] = e.code
    except Exception: codes[key] = 0
a = threading.Thread(target=go, args=(pa,'a')); b = threading.Thread(target=go, args=(pb,'b'))
a.start(); b.start(); a.join(); b.join()
print(codes.get('a'), codes.get('b'))
PY
}

make_fixture() {
  local id="conc$RANDOM$RANDOM"
  curl -s -X POST "http://127.0.0.1:$PA/platform/tenants" -H 'content-type: application/json' -H "authorization: $OWNER" \
    -d "{\"id\":\"$id\",\"name\":\"并发$id\",\"plan\":\"chain\"}" -o /dev/null
  curl -s -X PUT "http://127.0.0.1:$PA/platform/tenants/$id/business-hours" -H 'content-type: application/json' -H "authorization: $OWNER" \
    -d '{"hours":[{"weekday":0,"openTime":"00:00","closeTime":"23:30","isClosed":false},{"weekday":1,"openTime":"00:00","closeTime":"23:30","isClosed":false},{"weekday":2,"openTime":"00:00","closeTime":"23:30","isClosed":false},{"weekday":3,"openTime":"00:00","closeTime":"23:30","isClosed":false},{"weekday":4,"openTime":"00:00","closeTime":"23:30","isClosed":false},{"weekday":5,"openTime":"00:00","closeTime":"23:30","isClosed":false},{"weekday":6,"openTime":"00:00","closeTime":"23:30","isClosed":false}]}' -o /dev/null
  TECH=$(curl -s -X POST "http://127.0.0.1:$PA/platform/tenants/$id/technicians" -H 'content-type: application/json' -H "authorization: $OWNER" \
    -d "{\"name\":\"技师$id\",\"isActive\":true}" | python3 -c 'import sys,json;print((json.load(sys.stdin).get("technician") or {}).get("id",""))')
  SVC=$(curl -s -X POST "http://127.0.0.1:$PA/platform/tenants/$id/services" -H 'content-type: application/json' -H "authorization: $OWNER" \
    -d "{\"type\":\"NAIL\",\"nameZh\":\"并发$id\",\"nameEn\":\"i\",\"priceCents\":40000,\"depositCents\":5000,\"baseDurationMin\":60,\"isActive\":true}" \
    | python3 -c 'import sys,json;print((json.load(sys.stdin).get("service") or {}).get("id",""))')
  TOK=$(curl -s -X POST "http://127.0.0.1:$PA/auth/email/register" -H 'content-type: application/json' -H "x-tenant-id: $id" \
    -d "{\"email\":\"$id@example.com\",\"displayName\":\"并发客\"}" | python3 -c 'import sys,json;print((json.load(sys.stdin).get("auth") or {}).get("accessToken",""))')
  TID="$id"
  DATE=$(python3 -c "import datetime;print((datetime.date.today()+datetime.timedelta(days=2)).isoformat())")
  [ -n "$TECH" ] && [ -n "$SVC" ] && [ -n "$TOK" ]
}

FAILED=0
echo "库:$DATA_DIR · 端口:$PA + $PB(两个进程,同一个库)"
echo "════════ ① 原状(两进程同打一个库)════════"
boot || exit 1
make_fixture || { echo "   🔴 夹具没造出来"; exit 1; }
BODY="{\"storeId\":\"store-$TID\",\"serviceId\":\"$SVC\",\"technicianId\":\"$TECH\",\"date\":\"$DATE\",\"time\":\"10:00\"}"
OUT=$(fire "$TID" "$BODY" "$TOK"); A=${OUT% *}; B=${OUT#* }
echo "   两进程同时下单 → $A / $B"
echo "   [诊断] 原状两进程同时下单 → $A / $B(单进程门禁见 test-booking-intake ⑤a)"

echo ""
echo "════════ ② 去掉事务内复查后 ════════"
python3 - <<'PY'
import io
p='apps/api/local-server.mjs'; s=io.open(p,encoding='utf-8').read()
old="    if (taken.length) {"
assert s.count(old)==1, "锚点没找到"
s=s.replace(old,"    if (false && taken.length) {")
io.open(p,'w',encoding='utf-8').write(s)
print("   [刀] 已去掉 createBooking 事务内的可约复查")
PY
boot || exit 1
make_fixture || { echo "   🔴 夹具没造出来"; exit 1; }
BODY="{\"storeId\":\"store-$TID\",\"serviceId\":\"$SVC\",\"technicianId\":\"$TECH\",\"date\":\"$DATE\",\"time\":\"10:00\"}"
OUT=$(fire "$TID" "$BODY" "$TOK"); A=${OUT% *}; B=${OUT#* }
echo "   两进程同时下单 → $A / $B"
echo "   [诊断] 去掉事务内复查后 → $A / $B(若为 500/500 即 SQLite 锁先发作,复查轮不上)"

echo ""
echo "════════ ③ 还原后 ════════"
cp "$BAK" "$SRV"
boot || exit 1
make_fixture || { echo "   🔴 夹具没造出来"; exit 1; }
BODY="{\"storeId\":\"store-$TID\",\"serviceId\":\"$SVC\",\"technicianId\":\"$TECH\",\"date\":\"$DATE\",\"time\":\"10:00\"}"
OUT=$(fire "$TID" "$BODY" "$TOK"); A=${OUT% *}; B=${OUT#* }
echo "   两进程同时下单 → $A / $B"
echo "   [诊断] 还原后 → $A / $B"

echo ""
echo "诊断结束(不作门禁,一律 exit 0)。三行结果原样贴进回执。"
exit 0
