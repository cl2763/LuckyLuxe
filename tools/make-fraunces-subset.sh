#!/usr/bin/env bash
# D181 · 重新生成 `miniprogram/styles/fraunces-digits.wxss`(夜班令6 段 7)
#
# 为什么留这个脚本:那份 wxss 里是一长串 base64,**是生成物不是手写物**。
# 哪天要换字重、加币符,跑这个脚本重生成,不要去手改那串。
#
# 只取 **0–9 与逗号、句点、四个常用币符** —— 中文一个字都不取(中文仍是系统字体)。
# Fraunces 是 SIL OFL 1.1,可自由内嵌与再分发。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
URL=$(curl -s -m 15 -A "Mozilla/5.0" "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&display=swap" | grep -oE "https://[^)]*\.ttf" | head -1)
[ -n "$URL" ] || { echo "拿不到字体地址(网络?)" >&2; exit 1; }
echo "字体来源:$URL"
curl -s -m 60 -o "$TMP/f.ttf" "$URL"
python3 - "$TMP" <<'PY'
import sys, base64, io, os
from fontTools import subset
tmp = sys.argv[1]
subset.main([f'{tmp}/f.ttf', '--text=0123456789,.¥$€£', '--flavor=woff2',
             '--layout-features=', '--no-hinting', '--desubroutinize',
             f'--output-file={tmp}/sub.woff2'])
print('子集大小:', os.path.getsize(f'{tmp}/sub.woff2'), '字节')
PY
echo "生成好了:$TMP/sub.woff2 —— 把它 base64 后替换 wxss 里那一串(格式见该文件抬头)"
