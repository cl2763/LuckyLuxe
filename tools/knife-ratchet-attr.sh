#!/usr/bin/env bash
# 夜9 段3 造病 · J-50「棘轮下降要归因」的**造病验红**(店主 07b §二)
#
# ══ 为什么在克隆里造 ══
# 这把被测的刀(tools/ratchet-audit.mjs)读的是 **git 历史**:blame 找「这个数是哪次提交写的」、
# log 读那次提交的信息要归因。要造它的病就必须**真的提交一次**。
# 而真仓里留一次「故意放松判据」的提交,再靠 git 手术擦掉 —— 那正是 J-34 不许的那类还原。
# 所以整场造病在**一次性克隆**里做:同一份代码、同一个 git、真提交、真 blame,
# 跑完 `rm -rf` 整个克隆。**真仓一个字不动、一次提交不留。**
#
# ══ 四刀,验四条分支 ══
#   刀①  放松判据 → 棘轮跟着降 → 提交**不写归因**        ⇒ 必须红「降了却没写归因」
#   刀②  同一处,归因写「判据放松了」                      ⇒ 必须**照样红**,并**报得出是这一种**
#   刀③  另一处缩扫描面,归因写「扫描面缩了」              ⇒ 必须**照样红**,并报得出是这一种
#   刀④  归因写「真修好了」但**不点名**                    ⇒ 必须红「没点名」;补上点名 ⇒ **回绿**
# 刀④ 的后半段是关键:它证明这把刀不是「见降就红」,而是真能分出哪一种(判据四 · 同一把刀)。
# 🔴 夜16-续 兜底:`sed -i ''` 是 **BSD/macOS 专用**语法 —— GNU sed(Linux / CI)上
# 那个空串会被当成**下一个脚本参数**,当场报错或改错文件。这把刀将来若在 CI 上跑就是坏的。
# 归族:J-97「参照系随环境变,而判据把参照系写死了」—— 这里写死的是 sed 的方言。
# 改法:探一次本机 sed 属于哪一方言,**探出来才用**(探不到就明说,不猜)。
if sed --version >/dev/null 2>&1; then _SEDI() { sed -i "$@"; }        # GNU
else                                  _SEDI() { sed -i "" "$@"; }    # BSD / macOS
  # ⚠️ 这一行用的是 `sed -i ""` 不是 `sed -i ''` —— 一模一样的意思,但**不会被
  #    「把 `sed -i \'\'` 全替换成 `_SEDI`」那条批量改动吃掉**。
  #    我刚刚就这么把它改成了 `_SEDI() { _SEDI "$@"; }` —— **无限递归,而且正好只在 macOS 这一档挂**。
  #    J-78:批量替换前先量全;这一次没量,自己把定义替换没了。
fi

set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLONE=${1:-/private/tmp/ll-knife-ratchet-$$}
say() { printf '%s\n' "$*"; }
run() { (cd "$CLONE" && node tools/ratchet-audit.mjs 2>&1); }

say "══ 造病:J-50 棘轮下降归因 ══"
say "[刀留痕] 克隆 → $CLONE(真仓 $ROOT 一个字不动)"
rm -rf "$CLONE"; git -C "$ROOT" clone -q "$ROOT" "$CLONE" || { say "🔴 克隆失败"; exit 2; }
cd "$CLONE"
git config user.email knife@local; git config user.name knife
# 被测的那把刀取**工作区当前这一版**(不是 HEAD 那一版)——
# 第一轮就栽在这:克隆自 HEAD,而修好的刀还没提交,四刀全报「期望 red 实得 green」。
cp "$ROOT/tools/ratchet-audit.mjs" tools/ratchet-audit.mjs
git commit -qam "把工作区那一版被测刀放进克隆" 2>/dev/null
say "[刀留痕] 被测刀 = 工作区版 tools/ratchet-audit.mjs($(wc -l < "$ROOT/tools/ratchet-audit.mjs" | tr -d ' ') 行)" 
FAIL=0
expect() {  # $1=刀名 $2=期望(red|green) $3=必须出现的字样(可空)
  local name="$1" want="$2" needle="${3:-}" out rc
  out=$(run); rc=$?
  local got=green; [ "$rc" -ne 0 ] && got=red
  local hit=ok
  [ -n "$needle" ] && { printf '%s' "$out" | grep -q -- "$needle" || hit=miss; }
  if [ "$got" = "$want" ] && [ "$hit" = ok ]; then
    say "  ✅ $name —— 期望 $want,实得 $got${needle:+;报出了「$needle」}"
  else
    say "  🔴 $name —— 期望 $want 实得 $got${needle:+;字样 $hit}"; FAIL=1
    printf '%s\n' "$out" | sed -n '13,40p' | sed 's/^/      /'
  fi
}

say ""
say "── 刀① 放松判据(styles.css 写死色正则 {3,8} → {6,8}),棘轮跟着降,**不写归因** ──"
BEFORE=$(grep -oE "#[0-9a-fA-F]{3,8}" apps/web/styles.css | wc -l | tr -d ' ')
_SEDI 's/#\[0-9a-fA-F\]{3,8}\\b/#[0-9a-fA-F]{6,8}\\b/' tools/pre-regression.sh
AFTER=$(grep -oE "#[0-9a-fA-F]{6,8}" apps/web/styles.css | wc -l | tr -d ' ')
say "[刀留痕] 注入点 tools/pre-regression.sh:133 正则 {3,8}→{6,8} · 同一份 styles.css 数出来 $BEFORE → $AFTER"
_SEDI "s/\"\$HARDCOLOR\" -le 31/\"\$HARDCOLOR\" -le $AFTER/; s/HARDCOLOR > 31/HARDCOLOR > $AFTER/; s/≤ 31/≤ $AFTER/" tools/pre-regression.sh
grep -n "HARDCOLOR\" -le" tools/pre-regression.sh | sed 's/^/[刀留痕] 落刀后 /'
git commit -qam "刀① 把写死色棘轮从 31 调到 $AFTER"
expect "刀①(降了不写归因)" red "降了却没写归因"

say ""
say "── 刀② 同一处,归因写「判据放松了」—— 认罪不是免罪,必须照样红且点出是这一种 ──"
git commit -q --amend -m "刀② 把写死色棘轮从 31 调到 $AFTER

棘轮归因:判据放松了 —— 把写死色正则从 {3,8} 缩到 {6,8},三位色就不算了"
expect "刀②(归因=判据放松了)" red "这是「判据放松了」导致的下降"

say ""
say "── 刀③ 缩扫描面(小程序 wxss 把 pages 整支排除),归因写「扫描面缩了」 ──"
MB=$(find miniprogram -name "*.wxss" ! -path "*/styles/tokens.wxss" ! -path "*/styles/tokens-component.wxss" ! -path "*/styles/fraunces-digits.wxss" -print0 | xargs -0 grep -ohE "#[0-9a-fA-F]{3,8}\b|rgba?\(" 2>/dev/null | wc -l | tr -d ' ')
_SEDI 's|! -path "\*/styles/fraunces-digits.wxss"|! -path "*/styles/fraunces-digits.wxss" ! -path "*/pages/*"|' tools/pre-regression.sh
MA=$(find miniprogram -name "*.wxss" ! -path "*/styles/tokens.wxss" ! -path "*/styles/tokens-component.wxss" ! -path "*/styles/fraunces-digits.wxss" ! -path "*/pages/*" -print0 | xargs -0 grep -ohE "#[0-9a-fA-F]{3,8}\b|rgba?\(" 2>/dev/null | wc -l | tr -d ' ')
say "[刀留痕] 注入点 tools/pre-regression.sh:191 find 加 ! -path \"*/pages/*\" · 同一批 wxss 数出来 $MB → $MA"
_SEDI "s/\"\$MPCOLOR\" -le 2356/\"\$MPCOLOR\" -le $MA/; s/MPCOLOR > 2356/MPCOLOR > $MA/; s/≤ 2356/≤ $MA/" tools/pre-regression.sh
git commit -qam "刀③ 小程序写死色棘轮 2356 → $MA

棘轮归因:扫描面缩了 —— pages 整支不扫了"
expect "刀③(归因=扫描面缩了)" red "这是「扫描面缩了」导致的下降"

say ""
say "── 刀④ 归因写「真修好了」但不点名 → 必须红;补上点名 → 必须回绿 ──"
git commit -q --amend -m "刀④a 小程序写死色棘轮 2356 → $MA

棘轮归因:真修好了"
expect "刀④a(真修好了但没点名)" red "没点名"
git commit -q --amend -m "刀④b 小程序写死色棘轮 2356 → $MA

棘轮归因:真修好了 —— pages 下 87 处写死色换成 tokens.wxss 的令牌,差额对得上"
# 刀④b 只解开刀③那条;刀②那条(HARDCOLOR)仍红 —— 所以这里验的是**那一行**不再报
OUT=$(run); if printf '%s' "$OUT" | grep -q "小程序 wxss 写死色.*归因:真修好了"; then
  say "  ✅ 刀④b(点名后)—— 那一行翻成「归因:真修好了 …」,不再列进红名单"
else say "  🔴 刀④b —— 点了名还是没翻绿"; FAIL=1; printf '%s\n' "$OUT" | sed -n '13,30p' | sed 's/^/      /'; fi

say ""
say "── 归因对照(判据四:同一把刀要能分出哪层在守)──"
say "  把同一份放松后的代码喂**旧版**刀(段3 之前那一版,只有「判据比数字新」那一列):"
git show eea1872:tools/ratchet-audit.mjs > /tmp/old-audit-$$.mjs 2>/dev/null
if [ -s /tmp/old-audit-$$.mjs ]; then
  cp /tmp/old-audit-$$.mjs tools/_old-audit.mjs
  if (node tools/_old-audit.mjs >/dev/null 2>&1); then say "  ✅ 旧版刀:**绿** —— 说明这两处放松以前一路过,新列不是「数量凑巧对不上」"
  else say "  ⚠️ 旧版刀也红了 —— 得查清它红在哪一列,别把功劳记到新列上"; fi
  rm -f tools/_old-audit.mjs
else say "  ⚠️ 取不到旧版刀,归因对照这一步跳过(如实记)"; fi
rm -f /tmp/old-audit-$$.mjs

cd "$ROOT"
say ""
say "[刀留痕] 还原方式:**整个克隆删掉**($CLONE)—— 真仓无需还原,它一个字没动"
rm -rf "$CLONE"
git -C "$ROOT" status --porcelain | head -5
say ""
if [ "$FAIL" -eq 0 ]; then say "✅ 四刀全按预期(红的红、绿的绿、报得出是哪一种)"; else say "🔴 有刀没按预期 —— 见上"; fi
exit $FAIL
