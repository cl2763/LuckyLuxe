#!/usr/bin/env bash
# 生成回执里那段「未动须有证」对照表原文 —— **直接粘进回执**,不要转述。
#
# 立这个脚本的原因(05d/05e/05f 连着三批都栽在同一处):
#   我在回执里写「本机库未动」,然后**自己转述**一张表格(「表/行/列/索引全零差异」),
#   `test-untouched-proof` 不认,每次都红,每次我再回头补。
#   规矩是「把工具原话贴上去」——转述会漂,原话不会。
#   连错三次说明这不是记性问题,是**流程里缺一步**:写回执时该先跑这个,不是最后补。
#
# 用法:bash tools/receipt-db-proof.sh <快照 json>  [库路径,默认本机库]
set -euo pipefail
SNAP="${1:?用法: bash tools/receipt-db-proof.sh <快照 json> [库绝对路径]}"
DB="${2:-$(cd "$(dirname "$0")/.." && pwd)/apps/api/local-data/lucky-luxe.sqlite}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo '**本机库对照表原文**(`node tools/db-snapshot.mjs <本机库绝对路径> --diff '"$SNAP"'`):'
echo
echo '```'
node "$ROOT/tools/db-snapshot.mjs" "$DB" --diff "$SNAP" 2>&1 | tail -5
echo '```'
