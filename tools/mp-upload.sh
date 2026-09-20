#!/bin/bash
# 🔴 上传小程序的**唯一入口**(夜16-续 §二.1)——先过闸,再 upload。
# 直接敲 `cli upload` 会绕过这道闸;敲这个不会。
set -u
VER="${1:?用法:bash tools/mp-upload.sh <版本号> <说明>}"
DESC="${2:?用法:bash tools/mp-upload.sh <版本号> <说明>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/tools/mp-upload-guard.mjs" || {
  echo "🔴 没过闸,不上传。" >&2; exit 1
}
CLI="${WX_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
[ -x "$CLI" ] || { echo "🔴 找不到微信开发者工具 cli:$CLI(可用 WX_CLI= 指定)" >&2; exit 1; }
"$CLI" upload --project "$ROOT" --version "$VER" --desc "$DESC"
