#!/bin/zsh
# S 组前置·连续全绿基线链(一次连续,分段不算):
# ①42 套件(含 125 断言 CI)→ ②双租户全路径 → ③五跳×5 → ④矩阵 → ⑤随机组合三方对账一轮
set -e
ROOT=/Users/changliu/Documents/Codex/2026-04-29/new-chat
SP=/private/tmp/claude-501/-Users-changliu-Documents-Codex-2026-04-29-new-chat/9dd8a583-7492-4493-b5b6-c2e12753c364/scratchpad/auto
LOG=/tmp/baseline-2026-08-12.log
: > $LOG
echo "基线提交号: $(cd $ROOT && git rev-parse --short=7 HEAD)" | tee -a $LOG

echo "== ① 42 套件全量 ==" | tee -a $LOG
cd $ROOT/apps/api && bash run-all-tests.sh > /tmp/base-42.log 2>&1
grep -q "全部 42 个套件通过" /tmp/base-42.log || { echo "42_FAIL" | tee -a $LOG; grep -E "✗" /tmp/base-42.log | head -3 | tee -a $LOG; exit 1; }
echo "42_OK ($(grep -oE 'ok [0-9]+' /tmp/ll-4300.log 2>/dev/null | tail -1))" | tee -a $LOG
sleep 3; curl -s --max-time 5 http://127.0.0.1:4128/health >/dev/null || { echo "4128_DOWN" | tee -a $LOG; exit 1; }

echo "== ①.5 devtools 整只重启(链内环境卫生步,防长链累积劣化;老配方) ==" | tee -a $LOG
osascript -e 'quit app "wechatwebdevtools"' 2>/dev/null; sleep 5
pkill -f wechatwebdevtools 2>/dev/null; sleep 3
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto --project $ROOT --auto-port 9420 > /tmp/wxcli.log 2>&1 &
sleep 30
lsof -ti tcp:9420 >/dev/null || { echo "DEVTOOLS_FAIL" | tee -a $LOG; exit 1; }
echo "DEVTOOLS_FRESH" | tee -a $LOG

echo "== ② 双租户全路径 ==" | tee -a $LOG
cd $SP
TENANT=jics-nail OWNER_SESS=sess_msnk2ktp_tha9l7_3d1gp3gu node full_path_regression.mjs > /tmp/base-fp-jics.log 2>&1
grep -q "13/13" /tmp/base-fp-jics.log || { echo "FP_JICS_FAIL" | tee -a $LOG; tail -3 /tmp/base-fp-jics.log | tee -a $LOG; exit 1; }
echo "FP_JICS 13/13" | tee -a $LOG
TENANT=lucky-luxe OWNER_SESS=owner-demo-token node full_path_regression.mjs > /tmp/base-fp-lucky.log 2>&1
grep -q "10/10" /tmp/base-fp-lucky.log || { echo "FP_LUCKY_FAIL" | tee -a $LOG; tail -3 /tmp/base-fp-lucky.log | tee -a $LOG; exit 1; }
echo "FP_LUCKY 10/10" | tee -a $LOG

echo "== ③ 五跳×5(逐轮进程) ==" | tee -a $LOG
: > /tmp/base-five.log
for R in 1 2 3 4 5; do ROUND=$R node d40_five.mjs >> /tmp/base-five.log 2>&1 || { echo "FIVE_R${R}_FAIL" | tee -a $LOG; tail -4 /tmp/base-five.log | tee -a $LOG; exit 1; }; done
[ "$(grep -cE '轮全绿' /tmp/base-five.log)" = "5" ] || { echo "FIVE_COUNT_FAIL" | tee -a $LOG; exit 1; }
echo "FIVE 5/5" | tee -a $LOG

echo "== ④ 矩阵(20 户,对照卡驱动) ==" | tee -a $LOG
node matrix_walk.mjs > /tmp/base-matrix.log 2>&1
grep -q "户全绿" /tmp/base-matrix.log || { echo "MATRIX_FAIL" | tee -a $LOG; tail -4 /tmp/base-matrix.log | tee -a $LOG; exit 1; }
grep -E "户全绿" /tmp/base-matrix.log | tee -a $LOG

echo "== ⑤ 随机组合三方对账一轮(fixture 动态造,验后撤) ==" | tee -a $LOG
node $SP/baseline_grp_fixture.mjs > /tmp/base-grpfx.log 2>&1 || { echo "GRPFX_FAIL" | tee -a $LOG; tail -4 /tmp/base-grpfx.log | tee -a $LOG; exit 1; }
source /tmp/base-grpfx.env
FX_TOKEN=$FX_TOKEN FX_USER=$FX_USER FX_BOOKING=$FX_BOOKING FX_GRANT=$FX_GRANT FX_CPN_AMT=$FX_CPN_AMT FX_CPN_MIN=$FX_CPN_MIN FX_DEP=$FX_DEP FX_BAL=$FX_BAL node $SP/grp_random.mjs 1 22 > /tmp/base-grp.log 2>&1 || { echo "GRP_FAIL" | tee -a $LOG; tail -6 /tmp/base-grp.log | tee -a $LOG; node $SP/baseline_grp_teardown.mjs >> $LOG 2>&1 || true; exit 1; }
tail -2 /tmp/base-grp.log | tee -a $LOG
node $SP/baseline_grp_teardown.mjs >> /tmp/base-grpfx.log 2>&1 && echo "GRP_TEARDOWN_OK" | tee -a $LOG

echo "BASELINE_GREEN" | tee -a $LOG
